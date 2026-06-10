const data = window.WORLD_CUP_PREDICTIONS;
const state = {
  group: "A",
  status: "all",
  search: "",
  live: JSON.parse(localStorage.getItem("worldcup-live-inputs") || "{}")
};

const groupFilters = document.querySelector("#groupFilters");
const statusFilters = document.querySelector("#statusFilters");
const matchesGrid = document.querySelector("#matchesGrid");
const standingsList = document.querySelector("#standingsList");
const template = document.querySelector("#matchTemplate");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(dateText) {
  const date = new Date(`${dateText}T12:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function matchStatus(match) {
  const live = state.live[match.id];
  if (live && live.minute !== "" && Number(live.minute) > 0 && Number(live.minute) < 90) return "live";
  if (live && Number(live.minute) >= 90) return "finished";
  const today = new Date();
  const matchDate = new Date(`${match.date}T23:59:59`);
  return matchDate < today ? "finished" : "upcoming";
}

function outcome(home, away) {
  if (home > away) return "主胜";
  if (home < away) return "客胜";
  return "平局";
}

function revisedPrediction(match) {
  const live = state.live[match.id];
  if (!live || live.minute === "") {
    return { home: match.homeScore, away: match.awayScore, mode: "base" };
  }

  const minute = Math.max(0, Math.min(130, Number(live.minute || 0)));
  const currentHome = Math.max(0, Number(live.home || 0));
  const currentAway = Math.max(0, Number(live.away || 0));
  if (minute >= 90) {
    return { home: currentHome, away: currentAway, mode: "final" };
  }

  const elapsed = Math.max(0.05, Math.min(1, minute / 90));
  const remaining = Math.max(0, 1 - elapsed);
  const expectedHomeDone = match.homeScore * elapsed;
  const expectedAwayDone = match.awayScore * elapsed;
  const homePressure = currentHome > expectedHomeDone + 0.4 ? 0.55 : 0.95;
  const awayPressure = currentAway > expectedAwayDone + 0.4 ? 0.55 : 0.95;
  const projectedHome = Math.max(currentHome, Math.round(currentHome + Math.max(0, match.homeScore - expectedHomeDone) * remaining * homePressure));
  const projectedAway = Math.max(currentAway, Math.round(currentAway + Math.max(0, match.awayScore - expectedAwayDone) * remaining * awayPressure));
  return { home: projectedHome, away: projectedAway, mode: "live" };
}

function persistLive() {
  localStorage.setItem("worldcup-live-inputs", JSON.stringify(state.live));
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
    return [match.home, match.away, match.market, match.rationale, match.group]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
}

function renderStandings() {
  document.querySelector("#standingsGroup").textContent = `${state.group}组`;
  standingsList.innerHTML = "";
  const rows = data.standings[state.group] || [];
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "standing-row";
    item.innerHTML = `
      <div class="rank">${row.rank}</div>
      <div><strong>${row.team}</strong><br><span>进失球 ${row.goals}</span></div>
      <strong>${row.points}分</strong>
    `;
    standingsList.appendChild(item);
  }
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
    node.querySelector(".market").textContent = match.market;
    node.querySelector(".rationale").textContent = match.rationale;

    const live = state.live[match.id] || {};
    const minuteInput = node.querySelector(".minute-input");
    const homeInput = node.querySelector(".home-input");
    const awayInput = node.querySelector(".away-input");
    minuteInput.value = live.minute ?? "";
    homeInput.value = live.home ?? "";
    awayInput.value = live.away ?? "";

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
  document.querySelector("#updatedAt").textContent = data.updatedAt;
  document.querySelector("#sourceNote").textContent = data.sourceNote;
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

renderClock();
setInterval(renderClock, 1000);
render();
setInterval(render, 60000);
