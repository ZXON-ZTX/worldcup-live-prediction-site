from __future__ import annotations

import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_JS = ROOT / "data.js"
LIVE_JSON = ROOT / "live-data.json"

ODDS_API_BASE = "https://api.the-odds-api.com/v4"
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard"


def fetch_json(url: str, headers: dict[str, str] | None = None, timeout: int = 25):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "worldcup-live-predictor/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_base_data() -> dict:
    text = DATA_JS.read_text(encoding="utf-8")
    match = re.search(r"window\.WORLD_CUP_PREDICTIONS\s*=\s*(\{.*\});\s*$", text, re.S)
    if not match:
        raise RuntimeError("Cannot parse data.js")
    return json.loads(match.group(1))


def normalize_team(name: str) -> str:
    aliases = {
        "Korea Republic": "韩国",
        "South Korea": "韩国",
        "Czechia": "捷克",
        "Czech Republic": "捷克",
        "South Africa": "南非",
        "Mexico": "墨西哥",
        "Switzerland": "瑞士",
        "Canada": "加拿大",
        "Qatar": "卡塔尔",
        "Brazil": "巴西",
        "Morocco": "摩洛哥",
        "Scotland": "苏格兰",
        "Haiti": "海地",
        "United States": "美国",
        "USA": "美国",
        "Australia": "澳大利亚",
        "Paraguay": "巴拉圭",
        "Turkey": "土耳其",
        "Germany": "德国",
        "Ecuador": "厄瓜多尔",
        "Ivory Coast": "科特迪瓦",
        "Côte d'Ivoire": "科特迪瓦",
        "Curacao": "库拉索",
        "Netherlands": "荷兰",
        "Japan": "日本",
        "Tunisia": "突尼斯",
        "Sweden": "瑞典",
        "Belgium": "比利时",
        "Iran": "伊朗",
        "Egypt": "埃及",
        "New Zealand": "新西兰",
        "Spain": "西班牙",
        "Uruguay": "乌拉圭",
        "Saudi Arabia": "沙特",
        "Cape Verde": "佛得角",
        "France": "法国",
        "Norway": "挪威",
        "Senegal": "塞内加尔",
        "Iraq": "伊拉克",
        "Argentina": "阿根廷",
        "Austria": "奥地利",
        "Algeria": "阿尔及利亚",
        "Jordan": "约旦",
        "Portugal": "葡萄牙",
        "Colombia": "哥伦比亚",
        "DR Congo": "民主刚果",
        "Congo DR": "民主刚果",
        "Uzbekistan": "乌兹别克斯坦",
        "England": "英格兰",
        "Croatia": "克罗地亚",
        "Ghana": "加纳",
        "Panama": "巴拿马",
    }
    return aliases.get(name, name)


def match_key(home: str, away: str) -> str:
    return "|".join(sorted([home, away]))


def build_match_index(base: dict) -> dict[str, dict]:
    index = {}
    for match in base["matches"]:
        index[match_key(match["home"], match["away"])] = match
    return index


def fetch_espn_scores(base: dict) -> tuple[dict, list[str]]:
    """Best-effort score feed. If ESPN endpoint changes or has no events, fail soft."""
    updates: dict[str, dict] = {}
    sources: list[str] = []
    index = build_match_index(base)
    dates = sorted({m["date"].replace("-", "") for m in base["matches"]})
    for date in dates:
        try:
            data = fetch_json(f"{ESPN_SCOREBOARD}?dates={date}")
        except Exception:
            continue
        events = data.get("events") or []
        if events:
            sources.append(f"ESPN scoreboard {date}")
        for event in events:
            competitors = event.get("competitions", [{}])[0].get("competitors", [])
            if len(competitors) < 2:
                continue
            parsed = []
            for competitor in competitors:
                team = competitor.get("team", {})
                name = normalize_team(team.get("displayName") or team.get("shortDisplayName") or "")
                score = competitor.get("score")
                parsed.append((name, int(score) if str(score).isdigit() else 0, competitor.get("homeAway")))
            home = next((x for x in parsed if x[2] == "home"), parsed[0])
            away = next((x for x in parsed if x[2] == "away"), parsed[1])
            base_match = index.get(match_key(home[0], away[0]))
            if not base_match:
                continue
            status = event.get("status", {}).get("type", {})
            clock = event.get("status", {}).get("displayClock")
            minute = None
            if clock:
                minute_match = re.search(r"\d+", str(clock))
                minute = int(minute_match.group(0)) if minute_match else None
            updates[base_match["id"]] = {
                "status": "live" if status.get("state") == "in" else "finished" if status.get("completed") else "upcoming",
                "minute": minute,
                "home": home[1] if home[0] == base_match["home"] else away[1],
                "away": away[1] if away[0] == base_match["away"] else home[1],
                "source": "ESPN scoreboard",
            }
    return updates, sources


def implied_prob(decimal_odds: float) -> float:
    if decimal_odds <= 1:
        return 0
    return 1 / decimal_odds


def decimal_from_american(value: float) -> float:
    if value < 0:
        return 1 + 100 / abs(value)
    return 1 + value / 100


def poisson_mode(lam: float) -> int:
    return max(0, min(6, int(math.floor(lam))))


def adjust_prediction_from_odds(base_match: dict, h2h: list[dict], totals: list[dict] | None = None) -> dict:
    home_prob = draw_prob = away_prob = None
    for outcome in h2h:
        name = normalize_team(outcome.get("name", ""))
        price = outcome.get("price")
        if price is None:
            continue
        decimal = price if price > 0 and price < 20 else decimal_from_american(price)
        prob = implied_prob(decimal)
        if name == base_match["home"]:
            home_prob = prob
        elif name == base_match["away"]:
            away_prob = prob
        elif name.lower() in {"draw", "tie"}:
            draw_prob = prob
    probs = [p for p in [home_prob, draw_prob, away_prob] if p is not None]
    if not probs:
        return {}
    total = sum(probs)
    home = (home_prob or 0) / total
    draw = (draw_prob or 0) / total
    away = (away_prob or 0) / total

    expected_total = base_match["homeScore"] + base_match["awayScore"]
    if totals:
        under_bias = None
        over_bias = None
        for outcome in totals:
            name = str(outcome.get("name", "")).lower()
            price = outcome.get("price")
            point = outcome.get("point")
            if price is None or point is None:
                continue
            prob = implied_prob(price if price < 20 else decimal_from_american(price))
            if name == "under":
                under_bias = (prob, float(point))
            elif name == "over":
                over_bias = (prob, float(point))
        if under_bias and over_bias:
            uv, point = under_bias
            ov, _ = over_bias
            share = uv / max(0.01, uv + ov)
            expected_total = max(1.0, min(4.5, point + (0.5 - share)))

    edge = home - away
    home_lambda = max(0.15, expected_total * (0.5 + edge * 0.55))
    away_lambda = max(0.15, expected_total - home_lambda)
    predicted_home = poisson_mode(home_lambda)
    predicted_away = poisson_mode(away_lambda)
    if draw > max(home, away) - 0.03:
        low = max(0, round(expected_total / 2))
        predicted_home = predicted_away = min(2, low)
    elif home > away and predicted_home <= predicted_away:
        predicted_home = predicted_away + 1
    elif away > home and predicted_away <= predicted_home:
        predicted_away = predicted_home + 1
    return {
        "oddsHomeWin": round(home, 3),
        "oddsDraw": round(draw, 3) if draw_prob is not None else None,
        "oddsAwayWin": round(away, 3),
        "adjustedHomeScore": int(predicted_home),
        "adjustedAwayScore": int(predicted_away),
    }


def fetch_odds_updates(base: dict) -> tuple[dict, list[str], str | None]:
    api_key = os.environ.get("ODDS_API_KEY")
    if not api_key:
        return {}, [], "未配置 ODDS_API_KEY，跳过盘口自动更新。"
    sport_keys = [os.environ.get("ODDS_SPORT_KEY") or "soccer_fifa_world_cup", "soccer_fifa_world_cup_winner"]
    index = build_match_index(base)
    updates: dict[str, dict] = {}
    sources: list[str] = []
    last_error = None
    for sport in sport_keys:
        params = {
            "apiKey": api_key,
            "regions": os.environ.get("ODDS_REGIONS", "us,uk,eu"),
            "markets": "h2h,totals",
            "oddsFormat": os.environ.get("ODDS_FORMAT", "decimal"),
            "dateFormat": "iso",
        }
        url = f"{ODDS_API_BASE}/sports/{sport}/odds?{urllib.parse.urlencode(params)}"
        try:
            events = fetch_json(url)
        except Exception as exc:
            last_error = f"{sport}: {exc}"
            continue
        if not isinstance(events, list) or not events:
            continue
        sources.append(f"The Odds API {sport}")
        for event in events:
            home = normalize_team(event.get("home_team", ""))
            away = normalize_team(event.get("away_team", ""))
            base_match = index.get(match_key(home, away))
            if not base_match:
                continue
            best_h2h = None
            best_totals = None
            bookmaker_key = None
            for bookmaker in event.get("bookmakers", []):
                markets = {market.get("key"): market.get("outcomes", []) for market in bookmaker.get("markets", [])}
                if not best_h2h and markets.get("h2h"):
                    best_h2h = markets["h2h"]
                    best_totals = markets.get("totals")
                    bookmaker_key = bookmaker.get("title") or bookmaker.get("key")
                    break
            if not best_h2h:
                continue
            adjusted = adjust_prediction_from_odds(base_match, best_h2h, best_totals)
            if adjusted:
                updates[base_match["id"]] = {
                    **adjusted,
                    "bookmaker": bookmaker_key,
                    "source": "The Odds API",
                    "lastOddsUpdate": event.get("last_update"),
                }
        if updates:
            break
    return updates, sources, last_error


def main() -> int:
    base = load_base_data()
    score_updates, score_sources = fetch_espn_scores(base)
    odds_updates, odds_sources, odds_note = fetch_odds_updates(base)
    matches: dict[str, dict] = {}
    for match in base["matches"]:
        entry = {}
        if match["id"] in score_updates:
            entry.update(score_updates[match["id"]])
        if match["id"] in odds_updates:
            entry.update(odds_updates[match["id"]])
        if entry:
            matches[match["id"]] = entry
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "automated",
        "note": odds_note or "已尝试更新比分与盘口数据。",
        "sources": sorted(set(score_sources + odds_sources)),
        "matches": matches,
    }
    tmp = LIVE_JSON.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(LIVE_JSON)
    print(json.dumps({"updated": len(matches), "sources": payload["sources"], "note": payload["note"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
