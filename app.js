const data = window.WORLD_CUP_PREDICTIONS;

const state = {
  group: "A",
  status: "all",
  search: "",
  live: JSON.parse(localStorage.getItem("worldcup-live-inputs") || "{}"),
  feed: { generatedAt: "", note: "正在读取自动数据源...", sources: [], matches: {} },
  feedError: "",
  manualBusy: false,
  manualStatus: "等待数据源"
};

const groupFilters = document.querySelector("#groupFilters");
const statusFilters = document.querySelector("#statusFilters");
const matchesGrid = document.querySelector("#matchesGrid");
const standingsList = document.querySelector("#standingsList");
const template = document.querySelector("#matchTemplate");
const manualUpdateButton = document.querySelector("#manualUpdate");
const manualRefreshButton = document.querySelector("#manualRefresh");
const manualUpdateStatus = document.querySelector("#manualUpdateStatus");
const workflowLink = document.querySelector("#workflowLink");

const MANUAL_HELPER_URL = "http://127.0.0.1:8791/api/manual-update";
const WORKFLOW_URL = "https://github.com/ZXON-ZTX/worldcup-live-prediction-site/actions/workflows/update-live-data.yml";

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatFeedTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function feedEntry(match) {
  return state.feed.matches?.[match.id] || {};
}

function marketPrediction(match) {
  const feed = feedEntry(match);
  if (Number.isFinite(feed.adjustedHomeScore) && Number.isFinite(feed.adjustedAwayScore)) {
    return { home: feed.adjustedHomeScore, away: feed.adjustedAwayScore, mode: "odds" };
  }
  return { home: match.homeScore, away: match.awayScore, mode: "base" };
}

function liveInput(match) {
  const manual = state.live[match.id];
  if (manual && manual.minute !== "") {
    return {
      minute: Number(manual.minute || 0),
      home: Number(manual.home || 0),
      away: Number(manual.away || 0),
      source: "手动录入"
    };
  }
  const feed = feedEntry(match);
  if (feed.status === "live" || feed.status === "finished") {
    return {
      minute: Number(feed.minute ?? (feed.status === "finished" ? 90 : 0)),
      home: Number(feed.home ?? 0),
      away: Number(feed.away ?? 0),
      source: feed.source || "自动比分源"
    };
  }
  return null;
}

function matchStatus(match) {
  const input = liveInput(match);
  if (input && input.minute > 0 && input.minute < 90) return "live";
  if (input && input.minute >= 90) return "finished";
  const feed = feedEntry(match);
  if (feed.status === "live" || feed.status === "finished") return feed.status;
  const today = new Date();
  const matchDate = new Date(`${match.date}T23:59:59`);
  return matchDate < today ? "finished" : "upcoming";
}

function outcome(home, away) {
  if (home > away) return "主胜";
  if (home < away) return "客胜";
  return "平局";
}

function groupTeams(group) {
  const teams = new Set();
  for (const match of data.matches) {
    if (match.group !== group) continue;
    teams.add(match.home);
    teams.add(match.away);
  }
  return [...teams];
}

function calculateLiveStandings(group) {
  const table = new Map();
  for (const team of groupTeams(group)) {
    table.set(team, { team, played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0 });
  }

  for (const match of data.matches.filter(item => item.group === group)) {
    const prediction = revisedPrediction(match);
    const home = table.get(match.home);
    const away = table.get(match.away);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += prediction.home;
    home.goalsAgainst += prediction.away;
    away.goalsFor += prediction.away;
    away.goalsAgainst += prediction.home;

    if (prediction.home > prediction.away) {
      home.wins += 1;
      away.losses += 1;
      home.points += 3;
    } else if (prediction.home < prediction.away) {
      away.wins += 1;
      home.losses += 1;
      away.points += 3;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += 1;
      away.points += 1;
    }
  }

  return [...table.values()]
    .sort((a, b) => {
      const goalDiffA = a.goalsFor - a.goalsAgainst;
      const goalDiffB = b.goalsFor - b.goalsAgainst;
      return b.points - a.points
        || goalDiffB - goalDiffA
        || b.goalsFor - a.goalsFor
        || a.goalsAgainst - b.goalsAgainst
        || a.team.localeCompare(b.team, "zh-CN");
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function revisedPrediction(match) {
  const base = marketPrediction(match);
  const input = liveInput(match);
  if (!input) return base;

  const minute = Math.max(0, Math.min(130, input.minute));
  const currentHome = Math.max(0, input.home);
  const currentAway = Math.max(0, input.away);
  if (minute >= 90) {
    return { home: currentHome, away: currentAway, mode: "final" };
  }

  const elapsed = Math.max(0.05, Math.min(1, minute / 90));
  const remaining = Math.max(0, 1 - elapsed);
  const expectedHomeDone = base.home * elapsed;
  const expectedAwayDone = base.away * elapsed;
  const homePressure = currentHome > expectedHomeDone + 0.4 ? 0.55 : 0.95;
  const awayPressure = currentAway > expectedAwayDone + 0.4 ? 0.55 : 0.95;
  const projectedHome = Math.max(currentHome, Math.round(currentHome + Math.max(0, base.home - expectedHomeDone) * remaining * homePressure));
  const projectedAway = Math.max(currentAway, Math.round(currentAway + Math.max(0, base.away - expectedAwayDone) * remaining * awayPressure));
  return { home: projectedHome, away: projectedAway, mode: input.source === "手动录入" ? "manual-live" : "feed-live" };
}

function persistLive() {
  localStorage.setItem("worldcup-live-inputs", JSON.stringify(state.live));
}

function renderManualStatus() {
  if (manualUpdateStatus) {
    manualUpdateStatus.textContent = state.manualStatus || "等待数据源";
  }
  if (manualUpdateButton) {
    manualUpdateButton.disabled = state.manualBusy;
  }
  if (manualRefreshButton) {
    manualRefreshButton.disabled = state.manualBusy;
  }
  if (workflowLink) {
    workflowLink.href = WORKFLOW_URL;
  }
}

async function fetchLiveData(options = {}) {
  const previousGeneratedAt = state.feed.generatedAt;
  if (options.manual) {
    state.manualBusy = true;
    state.manualStatus = "正在读取最新数据...";
    renderManualStatus();
  }
  try {
    const response = await fetch(`./live-data.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.feed = await response.json();
    state.feedError = "";
    if (options.manual) {
      const label = formatFeedTime(state.feed.generatedAt);
      state.manualStatus = state.feed.generatedAt && state.feed.generatedAt !== previousGeneratedAt
        ? `已读取新数据：${label}`
        : `已检查：当前数据 ${label}`;
    }
  } catch (error) {
    state.feedError = `自动数据源暂不可用：${error.message}`;
    if (options.manual) {
      state.manualStatus = `读取失败：${error.message}`;
    }
  } finally {
    if (options.manual) {
      state.manualBusy = false;
    }
  }
  render();
}

async function triggerManualUpdate() {
  if (state.manualBusy) return;
  state.manualBusy = true;
  state.manualStatus = "正在触发后台抓取...";
  renderManualStatus();

  try {
    const response = await fetch(MANUAL_HELPER_URL, { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.message || `HTTP ${response.status}`);
    }
    await fetchLiveData();
    state.manualStatus = `手动更新完成：${formatFeedTime(result.generatedAt || state.feed.generatedAt)}，盘口覆盖 ${result.odds ?? "-"} / ${result.matches ?? "-"}`;
  } catch (error) {
    state.manualStatus = "未连接本地更新助手，可打开后台任务手动运行。";
  } finally {
    state.manualBusy = false;
    render();
  }
}

function renderGroups() {
  const groups = [...new Set(data.matches.map(match => match.group))].sort();
  groupFilters.innerHTML = "";
  for (const group of groups) {
    const button = document.createElement("button");
    button.textContent = `${group}组`;
    button.dataset.group = group;
    button.className = group === state.group ? "active" : "";
    button.addEventListener("click", () => {
      state.group = group;
      render();
    });
    groupFilters.appendChild(button);
  }
}

function filteredMatches() {
  const term = state.search.trim().toLowerCase();
  return data.matches.filter(match => {
    if (match.group !== state.group) return false;
    const status = matchStatus(match);
    if (state.status !== "all" && status !== state.status) return false;
    if (!term) return true;
    const feed = feedEntry(match);
    return [match.home, match.away, match.market, match.rationale, match.group, feed.source, feed.bookmaker]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
}

function renderStandings() {
  document.querySelector("#standingsGroup").textContent = `${state.group}组 · 实时表`;
  standingsList.innerHTML = "";
  const rows = calculateLiveStandings(state.group);
  for (const row of rows) {
    const goals = `${row.goalsFor}-${row.goalsAgainst}`;
    const item = document.createElement("div");
    item.className = "standing-row";
    item.innerHTML = `
      <div class="rank">${row.rank}</div>
      <div><strong>${row.team}</strong><br><span>进失球 ${goals}</span></div>
      <strong>${row.points}分</strong>
    `;
    standingsList.appendChild(item);
  }
}

function feedText(match) {
  const feed = feedEntry(match);
  const parts = [];
  if (feed.source) parts.push(`自动源：${feed.source}`);
  if (feed.bookmaker) parts.push(`盘口公司：${feed.bookmaker}`);
  if (Number.isFinite(feed.oddsHomeWin) && Number.isFinite(feed.oddsAwayWin)) {
    const draw = Number.isFinite(feed.oddsDraw) ? ` / 平 ${(feed.oddsDraw * 100).toFixed(1)}%` : "";
    parts.push(`去水倾向：主 ${(feed.oddsHomeWin * 100).toFixed(1)}%${draw} / 客 ${(feed.oddsAwayWin * 100).toFixed(1)}%`);
  }
  if (feed.status === "live" || feed.status === "finished") {
    parts.push(`当前比分：${feed.home ?? 0}-${feed.away ?? 0}${feed.minute ? `，${feed.minute}分钟` : ""}`);
  }
  return parts.join("；");
}

function renderMatches() {
  const matches = filteredMatches();
  matchesGrid.innerHTML = "";
  document.querySelector("#visibleCount").textContent = matches.length;

  if (!matches.length) {
    matchesGrid.innerHTML = `<div class="empty">没有符合当前筛选的比赛。</div>`;
    return;
  }

  for (const match of matches) {
    const node = template.content.firstElementChild.cloneNode(true);
    const prediction = revisedPrediction(match);
    const status = matchStatus(match);
    if (status === "live") node.classList.add("live");

    node.querySelector(".group-pill").textContent = `${match.group}组`;
    node.querySelector(".date-text").textContent = formatDate(match.date);
    node.querySelector(".home-team").textContent = match.home;
    node.querySelector(".away-team").textContent = match.away;
    node.querySelector(".base-score").textContent = `${match.homeScore} - ${match.awayScore}`;
    node.querySelector(".live-score").textContent = `${prediction.home} - ${prediction.away}`;
    node.querySelector(".confidence").textContent = `置信度 ${match.confidence}`;
    if (match.confidence.includes("中")) node.querySelector(".confidence").classList.add("mid");
    node.querySelector(".outcome").textContent = outcome(prediction.home, prediction.away);
    node.querySelector(".market").textContent = [match.market, feedText(match)].filter(Boolean).join(" ｜ ");
    node.querySelector(".rationale").textContent = match.rationale;

    const manual = state.live[match.id] || {};
    const minuteInput = node.querySelector(".minute-input");
    const homeInput = node.querySelector(".home-input");
    const awayInput = node.querySelector(".away-input");
    minuteInput.value = manual.minute ?? "";
    homeInput.value = manual.home ?? "";
    awayInput.value = manual.away ?? "";

    const updateLive = () => {
      state.live[match.id] = {
        minute: minuteInput.value,
        home: homeInput.value,
        away: awayInput.value
      };
      if (!minuteInput.value && !homeInput.value && !awayInput.value) {
        delete state.live[match.id];
      }
      persistLive();
      render();
    };

    minuteInput.addEventListener("input", updateLive);
    homeInput.addEventListener("input", updateLive);
    awayInput.addEventListener("input", updateLive);
    matchesGrid.appendChild(node);
  }
}

function renderMetrics() {
  document.querySelector("#matchCount").textContent = data.matches.length;
  const feedTime = state.feed.generatedAt ? formatFeedTime(state.feed.generatedAt) : data.updatedAt;
  document.querySelector("#updatedAt").textContent = feedTime;
  const oddsCoverage = data.matches.filter(match => {
    const feed = feedEntry(match);
    return feed.bookmaker || Number.isFinite(feed.oddsHomeWin) || Number.isFinite(feed.adjustedHomeScore);
  }).length;
  const sourceLine = state.feed.sources?.length
    ? `自动数据源：已接入 ${state.feed.sources.length} 个比分/盘口更新源；盘口覆盖 ${oddsCoverage}/${data.matches.length} 场`
    : "自动数据源：等待定时任务或 API 配置";
  document.querySelector("#sourceNote").textContent = state.feedError || `${data.sourceNote} ${sourceLine}。${state.feed.note || ""}`;
  const next = data.matches.find(match => matchStatus(match) === "upcoming");
  document.querySelector("#nextMatch").textContent = next ? `${formatDate(next.date)} ${next.home} vs ${next.away}` : "暂无未赛";
}

function renderClock() {
  const now = new Date();
  document.querySelector("#clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function render() {
  renderGroups();
  document.querySelectorAll("#statusFilters button").forEach(button => {
    button.classList.toggle("active", button.dataset.status === state.status);
  });
  renderStandings();
  renderMatches();
  renderMetrics();
  renderManualStatus();
}

document.querySelector("#searchInput").addEventListener("input", event => {
  state.search = event.target.value;
  render();
});

statusFilters.addEventListener("click", event => {
  const button = event.target.closest("button[data-status]");
  if (!button) return;
  state.status = button.dataset.status;
  render();
});

document.querySelector("#resetLive").addEventListener("click", () => {
  state.live = {};
  persistLive();
  render();
});

manualRefreshButton?.addEventListener("click", () => {
  fetchLiveData({ manual: true });
});

manualUpdateButton?.addEventListener("click", () => {
  triggerManualUpdate();
});

renderClock();
render();
fetchLiveData();
setInterval(renderClock, 1000);
setInterval(fetchLiveData, 300000);
