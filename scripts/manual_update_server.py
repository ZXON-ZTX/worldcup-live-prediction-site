from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = "ZXON-ZTX/worldcup-live-prediction-site"
WORKFLOW = "update-live-data.yml"
PORT = int(os.environ.get("MANUAL_UPDATE_PORT", "8791"))
LOCK = threading.Lock()


def command_path(name: str, fallback: str) -> str:
    return shutil.which(name) or fallback


GIT = command_path("git", r"C:\Program Files\Git\cmd\git.exe")
GH = command_path("gh", r"C:\Program Files\GitHub CLI\gh.exe")


def command_env() -> dict[str, str]:
    env = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"):
        env.setdefault(key, "http://127.0.0.1:7890")
    return env


def run_command(args: list[str], timeout: int = 120) -> str:
    completed = subprocess.run(
        args,
        cwd=ROOT,
        env=command_env(),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=timeout,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stdout.strip() or f"Command failed: {' '.join(args)}")
    return completed.stdout.strip()


def newest_dispatch_run() -> dict:
    raw = run_command(
        [
            GH,
            "run",
            "list",
            "--repo",
            REPO,
            "--workflow",
            WORKFLOW,
            "--json",
            "databaseId,status,conclusion,event,createdAt,url",
            "--limit",
            "8",
        ],
        timeout=60,
    )
    runs = json.loads(raw or "[]")
    for run in runs:
        if run.get("event") == "workflow_dispatch":
            return run
    raise RuntimeError("No workflow_dispatch run found after trigger.")


def wait_for_run(run_id: int) -> dict:
    for _ in range(40):
        raw = run_command(
            [
                GH,
                "run",
                "view",
                str(run_id),
                "--repo",
                REPO,
                "--json",
                "status,conclusion,url",
            ],
            timeout=60,
        )
        data = json.loads(raw)
        if data.get("status") == "completed":
            if data.get("conclusion") != "success":
                raise RuntimeError(f"Workflow finished with {data.get('conclusion')}: {data.get('url')}")
            return data
        time.sleep(5)
    raise RuntimeError("Workflow did not finish within the local wait window.")


def live_summary() -> dict:
    live_path = ROOT / "live-data.json"
    data = json.loads(live_path.read_text(encoding="utf-8"))
    matches = data.get("matches", {})
    odds = [
        entry
        for entry in matches.values()
        if entry.get("bookmaker")
        or isinstance(entry.get("oddsHomeWin"), (int, float))
        or isinstance(entry.get("adjustedHomeScore"), (int, float))
    ]
    return {
        "generatedAt": data.get("generatedAt"),
        "sources": len(data.get("sources", [])),
        "matches": len(matches),
        "odds": len(odds),
        "note": data.get("note", ""),
    }


def trigger_update() -> dict:
    if not LOCK.acquire(blocking=False):
        raise RuntimeError("Manual update is already running.")
    try:
        run_command([GH, "workflow", "run", WORKFLOW, "--repo", REPO, "--ref", "main"], timeout=60)
        time.sleep(4)
        run = newest_dispatch_run()
        finished = wait_for_run(int(run["databaseId"]))
        run_command([GIT, "fetch", "origin", "main"], timeout=120)
        run_command([GIT, "pull", "--ff-only"], timeout=120)
        return {"ok": True, "runUrl": finished.get("url") or run.get("url"), **live_summary()}
    finally:
        LOCK.release()


class Handler(BaseHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.startswith("/api/status"):
            self.send_json(200, {"ok": True, **live_summary()})
            return
        self.send_json(404, {"ok": False, "message": "Not found."})

    def do_POST(self) -> None:
        if self.path.startswith("/api/manual-update"):
            try:
                self.send_json(200, trigger_update())
            except Exception as exc:
                self.send_json(500, {"ok": False, "message": str(exc)})
            return
        self.send_json(404, {"ok": False, "message": "Not found."})

    def log_message(self, format: str, *args) -> None:
        return


def main() -> int:
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Manual update helper listening on http://127.0.0.1:{PORT}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
