"use strict";

/*********************************
 * CONFIGURATION + STATE
 *********************************/

const SHOW_WHATIF_TAB = true;
const DEFAULT_HISTORY_YEAR = "2025";
const SEASON = 2026;
const AUTO_REFRESH_MS = 60 * 1000;
let liveFeedAvailable = false;
let liveRefreshModule = null;

const DATA_PATHS = {
    draft: "draft.json",
    snapshot: "data/season.json"
};

const PAGE_TITLES = {
    home: "Michael vs. Zach | NFL Fantasy Draft",
    teams: "2026 Teams | NFL Fantasy Draft",
    history: "Draft History | NFL Fantasy Draft",
    whatif: "Playoff What If? | NFL Fantasy Draft",
    rules: "Scoring | NFL Fantasy Draft"
};

let draftData = {};
let scheduleData = {};
let playoffBonusData = {};
let teamRecords = [];
let seasonSnapshot = null;
let refreshInFlight = false;
let lastRefreshAttempt = 0;
let refreshFailed = false;
let displayedWeek = null;
let playoffSeeds = {};
let whatIfState = null;
let appReady = false;
let historyLoadedYear = null;
let historyAbortController = null;
let oddsRenderRequest = 0;

const teamOwners = new Map();
const oddsCache = new Map();


/*********************************
 * GENERAL HELPERS
 *********************************/

function byId(id) {
    return document.getElementById(id);
}

function escapeHTML(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function pluralize(value, singular, plural = `${singular}s`) {
    return `${value} ${value === 1 ? singular : plural}`;
}

function formatNumber(value) {
    return new Intl.NumberFormat("en-US").format(value);
}

async function fetchJSON(path, options = {}) {
    const response = await fetch(path, {
        cache: "no-cache",
        ...options
    });

    if (!response.ok) {
        throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
    }

    try {
        return await response.json();
    } catch {
        throw new Error(`${path} does not contain valid JSON.`);
    }
}

function validateCoreData() {
    if (!Array.isArray(draftData.michael) || !Array.isArray(draftData.zach)) {
        throw new Error("draft.json must include michael and zach team arrays.");
    }

    if (!scheduleData || typeof scheduleData !== "object" || Array.isArray(scheduleData)) {
        throw new Error("The automatic snapshot must contain weekly matchup data.");
    }

    if (teamRecords.length !== 32) {
        throw new Error("The season snapshot must contain all 32 NFL teams.");
    }
}

function setAppStatus(type, message = "") {
    const panel = byId("app-status");
    const messageEl = byId("app-status-message");
    if (!panel) return;

    panel.hidden = type === "ready";
    panel.className = `status-panel status-panel--${type}`;

    if (messageEl) {
        messageEl.textContent = message;
    }
}

function renderFatalError(error) {
    const panel = byId("app-status");
    if (!panel) return;

    panel.hidden = false;
    panel.className = "status-panel status-panel--error";
    panel.setAttribute("role", "alert");
    panel.innerHTML = `
        <h2>The season data could not be loaded</h2>
        <p>${escapeHTML(error.message || "An unexpected error occurred.")} Make sure the site is opened from a web server and that the JSON folders have not been renamed.</p>
        <button type="button" class="button button--primary" data-retry-app>Try again</button>
    `;
}

function teamAbbreviation(name) {
    const abbreviations = {
        "Arizona Cardinals": "ARI",
        "Atlanta Falcons": "ATL",
        "Baltimore Ravens": "BAL",
        "Buffalo Bills": "BUF",
        "Carolina Panthers": "CAR",
        "Chicago Bears": "CHI",
        "Cincinnati Bengals": "CIN",
        "Cleveland Browns": "CLE",
        "Dallas Cowboys": "DAL",
        "Denver Broncos": "DEN",
        "Detroit Lions": "DET",
        "Green Bay Packers": "GB",
        "Houston Texans": "HOU",
        "Indianapolis Colts": "IND",
        "Jacksonville Jaguars": "JAX",
        "Kansas City Chiefs": "KC",
        "Las Vegas Raiders": "LV",
        "Los Angeles Chargers": "LAC",
        "Los Angeles Rams": "LAR",
        "Miami Dolphins": "MIA",
        "Minnesota Vikings": "MIN",
        "New England Patriots": "NE",
        "New Orleans Saints": "NO",
        "New York Giants": "NYG",
        "New York Jets": "NYJ",
        "Philadelphia Eagles": "PHI",
        "Pittsburgh Steelers": "PIT",
        "San Francisco 49ers": "SF",
        "Seattle Seahawks": "SEA",
        "Tampa Bay Buccaneers": "TB",
        "Tennessee Titans": "TEN",
        "Washington Commanders": "WSH"
    };

    return abbreviations[name] || "NFL";
}

function getOwner(teamName) {
    return teamOwners.get(teamName) || null;
}

function rebuildOwnerMap() {
    teamOwners.clear();
    (draftData.michael || []).forEach(team => teamOwners.set(team.name, "michael"));
    (draftData.zach || []).forEach(team => teamOwners.set(team.name, "zach"));
}


/*********************************
 * SEASON WEEK LOGIC
 *********************************/

function getCurrentWeekKey(now = new Date()) {
    const regularSeasonWeekCutoffs = [
        { key: "Week 1", end: new Date("2026-09-15T12:00:00-04:00") },
        { key: "Week 2", end: new Date("2026-09-22T12:00:00-04:00") },
        { key: "Week 3", end: new Date("2026-09-29T12:00:00-04:00") },
        { key: "Week 4", end: new Date("2026-10-06T12:00:00-04:00") },
        { key: "Week 5", end: new Date("2026-10-13T12:00:00-04:00") },
        { key: "Week 6", end: new Date("2026-10-20T12:00:00-04:00") },
        { key: "Week 7", end: new Date("2026-10-27T12:00:00-04:00") },
        { key: "Week 8", end: new Date("2026-11-03T12:00:00-05:00") },
        { key: "Week 9", end: new Date("2026-11-10T12:00:00-05:00") },
        { key: "Week 10", end: new Date("2026-11-17T12:00:00-05:00") },
        { key: "Week 11", end: new Date("2026-11-24T12:00:00-05:00") },
        { key: "Week 12", end: new Date("2026-12-01T12:00:00-05:00") },
        { key: "Week 13", end: new Date("2026-12-08T12:00:00-05:00") },
        { key: "Week 14", end: new Date("2026-12-15T12:00:00-05:00") },
        { key: "Week 15", end: new Date("2026-12-22T12:00:00-05:00") },
        { key: "Week 16", end: new Date("2026-12-29T12:00:00-05:00") },
        { key: "Week 17", end: new Date("2027-01-05T12:00:00-05:00") },
        { key: "Week 18", end: new Date("2027-01-12T12:00:00-05:00") }
    ];

    for (const week of regularSeasonWeekCutoffs) {
        if (now < week.end) return week.key;
    }

    const playoffRounds = [
        { key: "Wild Card Round", start: new Date("2027-01-16T00:00:00-05:00") },
        { key: "Divisional Round", start: new Date("2027-01-23T00:00:00-05:00") },
        { key: "Conference Championship", start: new Date("2027-01-31T00:00:00-05:00") },
        { key: "Super Bowl", start: new Date("2027-02-14T00:00:00-05:00") }
    ];

    if (now < playoffRounds[0].start) return "Week 18";

    for (let index = 0; index < playoffRounds.length; index += 1) {
        const currentRound = playoffRounds[index];
        const nextRound = playoffRounds[index + 1];

        if (now >= currentRound.start && (!nextRound || now < nextRound.start)) {
            return currentRound.key;
        }
    }

    return "Super Bowl";
}


/*********************************
 * CORE SCORING + SCOREBOARD
 *********************************/

function getBonusPoints(teamName) {
    let bonus = 0;

    if (playoffBonusData.wildcard?.includes(teamName)) bonus += 7;
    if (playoffBonusData.divisional?.includes(teamName)) bonus += 7;
    if (playoffBonusData.championship?.includes(teamName)) bonus += 7;
    if (playoffBonusData.superbowl?.includes(teamName)) bonus += 10;
    if (playoffBonusData.winner === teamName) bonus += 7;

    return bonus;
}

function calculateSeasonTotals() {
    const scoreRoster = roster => roster.reduce((total, team) => {
        return total + ((team.wins || 0) * 2) + getBonusPoints(team.name);
    }, 0);

    return {
        michaelTotal: scoreRoster(draftData.michael || []),
        zachTotal: scoreRoster(draftData.zach || [])
    };
}

function renderScoreboard(element, michaelTotal, zachTotal) {
    if (!element) return;

    const isTie = michaelTotal === zachTotal;
    const difference = Math.abs(michaelTotal - zachTotal);
    const summary = isTie
        ? `All tied up at ${formatNumber(michaelTotal)} points`
        : `${michaelTotal > zachTotal ? "Michael" : "Zach"} leads by ${pluralize(difference, "point")}`;

    const projected = element.id === "whatif-score";
    const combined = michaelTotal + zachTotal;
    const michaelShare = combined ? michaelTotal / combined * 100 : 50;

    const owners = [
        {
            id: "michael",
            name: "Michael",
            total: michaelTotal,
            leading: michaelTotal > zachTotal
        },
        {
            id: "zach",
            name: "Zach",
            total: zachTotal,
            leading: zachTotal > michaelTotal
        }
    ];

    element.setAttribute(
        "aria-label",
        `${projected ? "Projected totals. " : ""}Michael ${michaelTotal} points, Zach ${zachTotal} points. ${summary}.`
    );

    element.setAttribute("aria-busy", "false");

    element.innerHTML = owners.map(owner => `
        <article class="score-card score-card--${owner.id}">
            <div class="owner-line">
                <img class="owner-avatar" src="pictures/${owner.name}.webp" width="46" height="46" alt="" decoding="async">
                <div>
                    <h2>${owner.name}</h2>
                    <small>${projected ? "Projected total" : `${(draftData[owner.id] || []).length} drafted teams`}</small>
                </div>
                ${owner.leading ? '<span class="leader-badge">LEADING</span>' : ""}
            </div>
            <div class="score-value">${formatNumber(owner.total)}<small>PTS</small></div>
        </article>
    `).join("") + `
        <div class="score-race">
            <div class="race-bar" aria-hidden="true"><span style="width:${michaelShare}%"></span></div>
            <p class="score-summary">${escapeHTML(summary)}</p>
        </div>
    `;
}

function updateTotalWins() {
    const { michaelTotal, zachTotal } = calculateSeasonTotals();
    renderScoreboard(byId("total-wins"), michaelTotal, zachTotal);
}


/*********************************
 * HOME + TEAM ROSTERS
 *********************************/

function updateCurrentWeekDisplay() {
    const currentWeekEl = byId("current-week");
    displayedWeek = getCurrentWeekKey();

    if (currentWeekEl) {
        currentWeekEl.textContent = displayedWeek;
    }
}

function teamLogo(name) {
    const team = teamRecords.find(record => record.name === name);

    const fallback = `<span class="team-abbr"${team ? " hidden" : ""}>${escapeHTML(teamAbbreviation(name))}</span>`;

    return `<span class="team-mark" aria-hidden="true">${fallback}${team ? `<img class="team-logo" src="pictures/teams/${encodeURIComponent(team.id)}.png" alt="" width="35" height="32" loading="lazy" decoding="async">` : ""}</span>`;
}

function teamRecord(name) {
    const record = teamRecords.find(team => team.name === name);
    return record ? `${record.wins}–${record.losses}–${record.ties}` : "—";
}

function renderAllTeams() {
    const body = byId("all-teams-body");
    if (!body) return;

    const sortedTeams = [...teamRecords].sort((a, b) => {
        const aPoints = a.wins * 2 + getBonusPoints(a.name);
        const bPoints = b.wins * 2 + getBonusPoints(b.name);

        return bPoints - aPoints || a.name.localeCompare(b.name);
    });

    body.innerHTML = sortedTeams.map(team => {
        const owner = getOwner(team.name);

        const ownerName = owner === "michael"
            ? "Michael"
            : owner === "zach"
                ? "Zach"
                : "Undrafted";

        const points = team.wins * 2 + getBonusPoints(team.name);

        return `
            <tr>
                <th scope="row">
                    <span class="table-team">
                        ${teamLogo(team.name)}
                        <span>${escapeHTML(team.name)}</span>
                    </span>
                </th>
                <td>
                    <span class="owner-badge owner-badge--${owner || "none"}">
                        ${ownerName}
                    </span>
                </td>
                <td class="record-cell">${teamRecord(team.name)}</td>
                <td class="points-cell">${formatNumber(points)}</td>
            </tr>
        `;
    }).join("");
}
function renderTeamList(owner) {
    const list = byId(`${owner}-teams`);
    const summary = byId(`${owner}-summary`);
    const total = byId(`${owner}-roster-total`);
    const teams = draftData[owner] || [];

    if (!list) return;

    let rosterPoints = 0;

    list.innerHTML = teams.map((team, index) => {
        const wins = Number(team.wins) || 0;
        const points = wins * 2 + getBonusPoints(team.name);

        rosterPoints += points;

        return `
            <li class="team-card">
                <span class="draft-number" aria-label="Draft pick ${index + 1}">${String(index + 1).padStart(2, "0")}</span>
                ${teamLogo(team.name)}
                <span class="team-copy">
                    <span class="team-name">${escapeHTML(team.name)}</span>
                    <span class="team-meta" aria-label="Regular-season record, wins, losses, ties">${teamRecord(team.name)}</span>
                </span>
                <span class="team-points" aria-label="${points} points">${formatNumber(points)} <small>PTS</small></span>
            </li>
        `;
    }).join("");

    list.setAttribute("aria-busy", "false");

    if (summary) summary.textContent = pluralize(teams.length, "drafted team");
    if (total) total.textContent = formatNumber(rosterPoints);
}

function updateTeamLists() {
    renderTeamList("michael");
    renderTeamList("zach");
    renderAllTeams();
}

function updateKeyMatchups() {
    const currentWeek = getCurrentWeekKey();
    const matchups = scheduleData[currentWeek] || [];

    const keyGames = matchups.filter(game => {
        const homeOwner = getOwner(game.home);
        const awayOwner = getOwner(game.away);

        return homeOwner && awayOwner && homeOwner !== awayOwner;
    });

    const matchupsEl = byId("matchups");

    if (!matchupsEl) return;

    matchupsEl.setAttribute("aria-busy", "false");

    if (keyGames.length === 0) {
        matchupsEl.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon" aria-hidden="true">✓</span>
                <h3>No cross-roster games this week</h3>
                <p>Michael’s and Zach’s drafted teams do not face each other during ${escapeHTML(currentWeek)}.</p>
            </div>
        `;

        return;
    }

    matchupsEl.innerHTML = keyGames.map(game => {
        const awayOwner = getOwner(game.away);
        const homeOwner = getOwner(game.home);
        const regular = currentWeek.startsWith("Week");

        const points = regular
            ? 2
            : currentWeek === "Conference Championship"
                ? 10
                : 7;

        const showScores = game.completed || game.state === "in";

        const row = (name, owner, score) => `
            <div class="game-team ${game.completed && game.winner === name ? "game-team--winner" : ""}">
                ${teamLogo(name)}
                <span class="game-team-name">${escapeHTML(name)}${game.completed && game.winner === name ? '<span class="winner-label">✓ WIN</span>' : ""}</span>
                ${showScores && Number.isFinite(score) ? `<strong class="game-score">${score}</strong>` : ""}
                <span class="owner-badge owner-badge--${owner}">${owner === "michael" ? "Michael" : "Zach"}</span>
            </div>`;

        const gameStatus = game.completed
            ? (game.winner ? "Final" : "Final · Tie")
            : game.state === "in"
                ? game.detail
                : Number.isFinite(Date.parse(game.date))
                    ? new Intl.DateTimeFormat("en-US", {
                        weekday: "short",
                        hour: "numeric",
                        minute: "2-digit",
                        timeZoneName: "short"
                    }).format(new Date(game.date))
                    : "Scheduled";

        return `
            <article class="game-card" aria-label="${escapeHTML(game.away)} at ${escapeHTML(game.home)}">
                <div class="game-top"><span>${escapeHTML(currentWeek.toUpperCase())}</span><span>${escapeHTML(gameStatus)}</span></div>
                ${row(game.away, awayOwner, game.awayScore)}
                ${row(game.home, homeOwner, game.homeScore)}
                <div class="game-foot">${points} points ${regular || currentWeek === "Super Bowl" ? "for the win" : "for advancing"}</div>
            </article>
        `;
    }).join("");
}


/*********************************
 * PAGE NAVIGATION
 *********************************/

function updateWhatIfTabVisibility() {
    const whatIfNav = byId("nav-whatif");

    if (whatIfNav) {
        whatIfNav.hidden = !SHOW_WHATIF_TAB;
    }
}

function routeFromLocation() {
    const requestedPage = window.location.hash.replace("#", "");
    const validPages = ["home", "teams", "history", "rules"];

    if (SHOW_WHATIF_TAB) {
        validPages.push("whatif");
    }

    return validPages.includes(requestedPage)
        ? requestedPage
        : "home";
}

function showPage(pageId, { focusHeading = false } = {}) {
    const resolvedPage =
        pageId === "whatif" && !SHOW_WHATIF_TAB
            ? "home"
            : pageId;

    document.querySelectorAll(".page").forEach(page => {
        const isActive = page.id === resolvedPage;

        page.hidden = !isActive;
        page.classList.toggle("is-active", isActive);
    });

    document.querySelectorAll(".nav-link").forEach(link => {
        if (link.dataset.page === resolvedPage) {
            link.setAttribute("aria-current", "page");
        } else {
            link.removeAttribute("aria-current");
        }
    });

    document.title = PAGE_TITLES[resolvedPage] || PAGE_TITLES.home;

    if (resolvedPage === "history" && appReady && !historyLoadedYear) {
        loadHistory(DEFAULT_HISTORY_YEAR);
    }

    if (resolvedPage === "whatif" && appReady) {
        if (!whatIfState) initWhatIf();
        else renderWhatIf();
    }

    if (focusHeading) {
        const heading = document.querySelector(`#${resolvedPage} h1`);

        if (heading) {
            window.requestAnimationFrame(() => {
                heading.focus({ preventScroll: false });
            });
        }
    }
}

function navigateTo(pageId) {
    const resolvedPage =
        pageId === "whatif" && !SHOW_WHATIF_TAB
            ? "home"
            : pageId;

    const nextHash = `#${resolvedPage}`;

    if (window.location.hash !== nextHash) {
        window.history.pushState(
            { page: resolvedPage },
            "",
            nextHash
        );
    }

    showPage(resolvedPage, { focusHeading: true });
}


/*********************************
 * HISTORY
 *********************************/

function setHistoryButtonsState(selectedYear, isLoading) {
    document.querySelectorAll(".year-button").forEach(button => {
        button.disabled = isLoading;
        button.setAttribute(
            "aria-pressed",
            String(button.dataset.year === selectedYear)
        );
    });
}

function historyTeamRows(teams) {
    return teams.map((team, index) => `
        <li class="history-team-row">
            <span class="draft-number">${String(index + 1).padStart(2, "0")}</span>
            <span class="team-name">${escapeHTML(team.team)}</span>
            <span class="history-team-points">
                ${pluralize(Number(team.points) || 0, "pt")}
            </span>
        </li>
    `).join("");
}

function renderHistory(data, requestedYear) {
    const resultsEl = byId("history-results");

    if (!resultsEl) return;

    const michaelScore = Number(data.finalScore.Michael);
    const zachScore = Number(data.finalScore.Zach);

    const winner = michaelScore === zachScore
        ? "Tie"
        : michaelScore > zachScore
            ? "Michael won"
            : "Zach won";

    const margin = Math.abs(michaelScore - zachScore);

    const resultSummary = winner === "Tie"
        ? "Finished tied"
        : `${winner} by ${pluralize(margin, "point")}`;

    resultsEl.innerHTML = `
        <section class="history-summary" aria-labelledby="history-${requestedYear}-title">
            <div>
                <p class="eyebrow">${escapeHTML(resultSummary)}</p>
                <h2 id="history-${requestedYear}-title">${escapeHTML(requestedYear)} final</h2>
                <p class="history-meta">
                    First pick: <strong>${escapeHTML(data.firstPick)}</strong>
                </p>
            </div>

            <div class="history-score" aria-label="Michael ${michaelScore}, Zach ${zachScore}">
                <span class="michael-score">${michaelScore}</span>
                <span aria-hidden="true">–</span>
                <span class="zach-score">${zachScore}</span>
            </div>
        </section>

        <div class="history-rosters">
            <section class="history-roster history-roster--michael" aria-labelledby="history-michael-${requestedYear}">
                <h3 id="history-michael-${requestedYear}">Michael’s team</h3>
                <ol class="history-team-list">
                    ${historyTeamRows(data.teams.Michael)}
                </ol>
            </section>

            <section class="history-roster history-roster--zach" aria-labelledby="history-zach-${requestedYear}">
                <h3 id="history-zach-${requestedYear}">Zach’s team</h3>
                <ol class="history-team-list">
                    ${historyTeamRows(data.teams.Zach)}
                </ol>
            </section>
        </div>
    `;

    resultsEl.setAttribute("aria-busy", "false");
}

async function loadHistory(year) {
    if (historyAbortController) {
        historyAbortController.abort();
    }

    historyAbortController = new AbortController();
    const activeController = historyAbortController;

    const statusEl = byId("history-status");
    const resultsEl = byId("history-results");

    setHistoryButtonsState(year, true);

    if (statusEl) {
        statusEl.textContent = `Loading ${year} results…`;
    }

    if (resultsEl) {
        resultsEl.setAttribute("aria-busy", "true");
    }

    try {
        const data = await fetchJSON(`History/${year}.json`, {
            signal: activeController.signal
        });

        if (!data.finalScore || !data.teams?.Michael || !data.teams?.Zach) {
            throw new Error(
                `History/${year}.json is missing score or roster data.`
            );
        }

        if (String(data.year) !== String(year)) {
            throw new Error(
                `History/${year}.json identifies itself as the ${data.year} season.`
            );
        }

        renderHistory(data, year);
        historyLoadedYear = year;

        if (statusEl) {
            statusEl.textContent = `${year} results loaded.`;
        }
    } catch (error) {
        if (error.name === "AbortError") return;

        if (resultsEl) {
            resultsEl.setAttribute("aria-busy", "false");

            resultsEl.innerHTML = `
                <div class="error-state">
                    <h2>That season could not be loaded</h2>
                    <p>${escapeHTML(error.message)}</p>
                    <button
                        type="button"
                        class="button button--secondary"
                        data-retry-history="${escapeHTML(year)}"
                    >
                        Try again
                    </button>
                </div>
            `;
        }

        if (statusEl) {
            statusEl.textContent = `Unable to load ${year} results.`;
        }
    } finally {
        if (historyAbortController === activeController) {
            setHistoryButtonsState(year, false);
        }
    }
}


/*********************************
 * WHAT-IF BRACKET + SCORING
 *********************************/

function getSeedsForConference(conference) {
    const seeds = playoffSeeds?.[conference];

    if (!Array.isArray(seeds)) return [];

    return seeds
        .map(item => ({
            seed: Number(item.seed),
            name: item.team
        }))
        .filter(item => item.seed >= 1 && item.seed <= 7 && item.name)
        .sort((a, b) => a.seed - b.seed);
}

function seedMapFromSeeds(seeds) {
    return Object.fromEntries(
        seeds.map(item => [item.name, item.seed])
    );
}

function wildcardMatchupsFromSeeds(seeds) {
    const bySeed = Object.fromEntries(
        seeds.map(item => [item.seed, item.name])
    );

    return [
        { a: bySeed[2], b: bySeed[7] },
        { a: bySeed[3], b: bySeed[6] },
        { a: bySeed[4], b: bySeed[5] }
    ];
}

function divisionalMatchupsReseed(seeds, wildcardWinners) {
    const seedMap = seedMapFromSeeds(seeds);
    const firstSeed = seeds.find(item => item.seed === 1)?.name;

    if (!firstSeed || wildcardWinners.length !== 3) {
        return null;
    }

    const remaining = [firstSeed, ...wildcardWinners]
        .slice()
        .sort((teamA, teamB) => seedMap[teamA] - seedMap[teamB]);

    const lowestRemainingSeed = remaining.at(-1);

    const otherTeams = remaining.filter(
        team => team !== firstSeed && team !== lowestRemainingSeed
    );

    return [
        { a: firstSeed, b: lowestRemainingSeed },
        { a: otherTeams[0], b: otherTeams[1] }
    ];
}

function freshWhatIfState(afcSeeds, nfcSeeds) {
    return {
        afc: {
            seeds: afcSeeds,
            wcWinners: [null, null, null],
            divWinners: [null, null],
            confWinner: null
        },
        nfc: {
            seeds: nfcSeeds,
            wcWinners: [null, null, null],
            divWinners: [null, null],
            confWinner: null
        },
        superBowl: {
            winner: null
        }
    };
}

function actualPlayoffResult(round, teams) {
    const roundNumber = { wc: 1, div: 2, conf: 3, sb: 4 }[round];

    if (
        !roundNumber ||
        teams.length !== 2 ||
        teams.some(team => !team || team === "TBD")
    ) {
        return null;
    }

    return Object.values(scheduleData).flat().find(game =>
        game.phase === 3 &&
        game.round === roundNumber &&
        game.completed &&
        teams.includes(game.home) &&
        teams.includes(game.away) &&
        teams.includes(game.winner)
    ) || null;
}

// Actual results always win over predictions. Preserve a later prediction only
// when its earlier picks still agree, so a corrected result cannot leave a
// hypothetical team advancing through a game it lost.
function reconcileWhatIfState(previous = whatIfState) {
    const next = freshWhatIfState(
        getSeedsForConference("AFC"),
        getSeedsForConference("NFC")
    );

    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    const choose = (round, teams, pick) =>
        actualPlayoffResult(round, teams)?.winner ||
        (teams.includes(pick) ? pick : null);

    let preserveSuperBowl = Boolean(previous);

    for (const key of ["afc", "nfc"]) {
        const current = next[key];
        const old = previous?.[key];

        current.wcWinners = wildcardMatchupsFromSeeds(current.seeds)
            .map((matchup, index) =>
                choose(
                    "wc",
                    [matchup.a, matchup.b],
                    old?.wcWinners[index]
                )
            );

        const wildcardUnchanged = same(
            current.wcWinners,
            old?.wcWinners
        );

        const divisional = getDivisionalMatchupsForConference(current);

        if (divisional) {
            current.divWinners = divisional.map((matchup, index) =>
                choose(
                    "div",
                    [matchup.a, matchup.b],
                    wildcardUnchanged ? old?.divWinners[index] : null
                )
            );
        }

        const divisionalUnchanged =
            wildcardUnchanged &&
            same(current.divWinners, old?.divWinners);

        if (current.divWinners.every(Boolean)) {
            current.confWinner = choose(
                "conf",
                current.divWinners,
                divisionalUnchanged ? old?.confWinner : null
            );
        }

        preserveSuperBowl =
            preserveSuperBowl &&
            divisionalUnchanged &&
            current.confWinner === old?.confWinner;
    }

    if (next.afc.confWinner && next.nfc.confWinner) {
        next.superBowl.winner = choose(
            "sb",
            [next.afc.confWinner, next.nfc.confWinner],
            preserveSuperBowl ? previous?.superBowl.winner : null
        );
    }

    return next;
}

function initWhatIf() {
    const afcSeeds = getSeedsForConference("AFC");
    const nfcSeeds = getSeedsForConference("NFC");

    if (afcSeeds.length !== 7 || nfcSeeds.length !== 7) {
        whatIfState = null;
        renderWhatIfMissingSeeds();
        return;
    }

    whatIfState = freshWhatIfState(afcSeeds, nfcSeeds);
    renderWhatIf();
}

function renderWhatIfMissingSeeds() {
    const targetIds = [
        "whatif-afc-wc",
        "whatif-afc-div",
        "whatif-afc-conf",
        "whatif-nfc-wc",
        "whatif-nfc-div",
        "whatif-nfc-conf",
        "whatif-superbowl"
    ];

    targetIds.forEach(id => {
        const element = byId(id);

        if (element) {
            element.innerHTML =
                '<div class="empty-state"><p>Playoff seeds are not available yet.</p></div>';
        }
    });

    byId("whatif-preview-note").hidden = true;
    byId("whatif-score").hidden = false;
    byId("whatif-odds").hidden = true;
    byId("whatif-odds-note").hidden = true;
    byId("whatif-reset").disabled = true;

    const scoreEl = byId("whatif-score");

    if (scoreEl) {
        scoreEl.innerHTML =
            '<div class="empty-state"><h3>The playoff field is taking shape</h3><p>The what-if simulator will be ready when the playoff teams are set.</p></div>';
    }
}

function computeWhatIfBonusPoints(teamName, state = whatIfState) {
    if (!state) return 0;

    let bonus = 0;

    const afcSeeds = state.afc?.seeds || [];
    const nfcSeeds = state.nfc?.seeds || [];

    const playoffTeams = new Set([
        ...afcSeeds.map(item => item.name),
        ...nfcSeeds.map(item => item.name)
    ]);

    if (playoffTeams.has(teamName)) {
        bonus += 7;
    }

    const divisionalTeams = new Set([
        afcSeeds.find(item => item.seed === 1)?.name,
        nfcSeeds.find(item => item.seed === 1)?.name,
        ...(state.afc?.wcWinners || []).filter(Boolean),
        ...(state.nfc?.wcWinners || []).filter(Boolean)
    ].filter(Boolean));

    if (divisionalTeams.has(teamName)) {
        bonus += 7;
    }

    const conferenceTeams = new Set([
        ...(state.afc?.divWinners || []).filter(Boolean),
        ...(state.nfc?.divWinners || []).filter(Boolean)
    ]);

    if (conferenceTeams.has(teamName)) {
        bonus += 7;
    }

    if (
        state.afc?.confWinner === teamName ||
        state.nfc?.confWinner === teamName
    ) {
        bonus += 10;
    }

    if (state.superBowl?.winner === teamName) {
        bonus += 7;
    }

    return bonus;
}

function computeWhatIfTotals(state = whatIfState) {
    const scoreRoster = roster => roster.reduce((total, team) => {
        return (
            total +
            ((team.wins || 0) * 2) +
            computeWhatIfBonusPoints(team.name, state)
        );
    }, 0);

    return {
        michaelTotal: scoreRoster(draftData.michael || []),
        zachTotal: scoreRoster(draftData.zach || [])
    };
}

function renderWhatIfScore() {
    if (!whatIfState) return;

    const { michaelTotal, zachTotal } = computeWhatIfTotals();

    renderScoreboard(
        byId("whatif-score"),
        michaelTotal,
        zachTotal
    );
}

function matchupButton({
    conference = "",
    round,
    index = "",
    team = "TBD",
    seed = "",
    selected = false,
    disabled = false,
    finalGame = null
}) {
    const safeTeam = escapeHTML(team || "TBD");

    const attributes = disabled || finalGame
        ? `disabled aria-pressed="${selected}" aria-label="${safeTeam}${finalGame ? ` — ${selected ? "winner" : "eliminated"}, result locked` : " — waiting for earlier picks"}"`
        : `data-conf="${escapeHTML(conference)}" data-round="${escapeHTML(round)}" data-idx="${escapeHTML(index)}" data-team="${safeTeam}" aria-pressed="${selected}" aria-label="Select ${safeTeam} to advance"`;

    const seedMarkup = seed
        ? `<span class="seed">#${escapeHTML(seed)}</span>`
        : "";

    const score = finalGame
        ? (finalGame.home === team ? finalGame.homeScore : finalGame.awayScore)
        : null;

    return `
        <button type="button" class="matchup-row" data-owner="${getOwner(team) || ""}" ${attributes}>
            ${teamRecords.some(record => record.name === team) ? teamLogo(team) : ""}
            <span class="matchup-team">
                ${seedMarkup}${safeTeam}
            </span>
            ${Number.isFinite(score) ? `<span class="bracket-score">${score}</span>` : ""}
        </button>
    `;
}

function matchupCard(buttons, locked = false, finalGame = null) {
    return `
        <div class="matchup-card ${locked ? "is-locked" : ""} ${finalGame ? "is-final" : ""}">
            ${buttons.join("")}
            ${finalGame ? '<p class="result-lock">Final · Result locked</p>' : ""}
        </div>
    `;
}

function renderBracketMatchup({
    conference = "",
    round,
    index = "",
    teams,
    selectedTeam,
    seedMap = {},
    waiting = false
}) {
    const finalGame = waiting ? null : actualPlayoffResult(round, teams);

    return matchupCard(
        teams.map(team => matchupButton({
            conference,
            round,
            index,
            team,
            seed: seedMap[team] || "",
            selected: selectedTeam === team,
            disabled: waiting || team === "TBD",
            finalGame
        })),
        waiting,
        finalGame
    );
}

function renderConference(conference, conferenceState, ids) {
    const wildcardEl = byId(ids.wildcard);
    const divisionalEl = byId(ids.divisional);
    const conferenceEl = byId(ids.conference);

    if (!wildcardEl || !divisionalEl || !conferenceEl) return;

    const seedMap = seedMapFromSeeds(conferenceState.seeds);
    const firstSeed = conferenceState.seeds.find(item => item.seed === 1)?.name || "TBD";

    wildcardEl.innerHTML = wildcardMatchupsFromSeeds(conferenceState.seeds)
        .map((matchup, index) =>
            renderBracketMatchup({
                conference,
                round: "wc",
                index,
                teams: [matchup.a, matchup.b],
                selectedTeam: conferenceState.wcWinners[index],
                seedMap
            })
        ).join("");

    const divisional = getDivisionalMatchupsForConference(conferenceState);

    divisionalEl.innerHTML = (
        divisional || [
            { a: firstSeed, b: "TBD" },
            { a: "TBD", b: "TBD" }
        ]
    ).map((matchup, index) =>
        renderBracketMatchup({
            conference,
            round: "div",
            index,
            teams: [matchup.a, matchup.b],
            selectedTeam: conferenceState.divWinners[index],
            seedMap,
            waiting: !divisional
        })
    ).join("");

    const conferenceReady = conferenceState.divWinners.every(Boolean);

    conferenceEl.innerHTML = renderBracketMatchup({
        conference,
        round: "conf",
        teams: conferenceReady ? conferenceState.divWinners : ["TBD", "TBD"],
        selectedTeam: conferenceState.confWinner,
        seedMap,
        waiting: !conferenceReady
    });
}

function renderSuperBowl() {
    const element = byId("whatif-superbowl");

    if (!element || !whatIfState) return;

    const teams = [
        whatIfState.afc.confWinner || "TBD",
        whatIfState.nfc.confWinner || "TBD"
    ];

    element.innerHTML = renderBracketMatchup({
        round: "sb",
        teams,
        selectedTeam: whatIfState.superBowl.winner,
        waiting: teams.includes("TBD")
    });
}

function handleWhatIfPick(dataset) {
    if (!whatIfState) return;

    whatIfState = reconcileWhatIfState();

    const { round, team, conf } = dataset;
    const index = Number(dataset.idx);

    const conference = conf === "AFC"
        ? whatIfState.afc
        : conf === "NFC"
            ? whatIfState.nfc
            : null;

    let teams = [];
    let selected;

    if (round === "sb") {
        teams = [whatIfState.afc.confWinner, whatIfState.nfc.confWinner];
        selected = whatIfState.superBowl.winner;
    } else if (conference) {
        if (round === "wc" || round === "div") {
            const matchups = round === "wc"
                ? wildcardMatchupsFromSeeds(conference.seeds)
                : getDivisionalMatchupsForConference(conference);

            const matchup = Number.isInteger(index)
                ? matchups?.[index]
                : null;

            if (matchup) teams = [matchup.a, matchup.b];

            selected = round === "wc"
                ? conference.wcWinners[index]
                : conference.divWinners[index];
        } else if (round === "conf") {
            teams = conference.divWinners;
            selected = conference.confWinner;
        }
    }

    if (
        teams.length !== 2 ||
        !teams.every(Boolean) ||
        !teams.includes(team) ||
        selected === team ||
        actualPlayoffResult(round, teams)
    ) {
        return;
    }

    applySimulatedPick(
        whatIfState,
        { round, conference: conf, index },
        team
    );

    renderWhatIf();
}


/*********************************
 * WHAT-IF ODDS
 *********************************/

function cloneState(value) {
    return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

function getDivisionalMatchupsForConference(conferenceState) {
    const wildcardWinners =
        conferenceState.wcWinners.filter(Boolean);

    if (wildcardWinners.length !== 3) {
        return null;
    }

    return divisionalMatchupsReseed(
        conferenceState.seeds,
        wildcardWinners
    );
}

function nextWhatIfDecision(state) {
    for (const conference of ["AFC", "NFC"]) {
        const conferenceState =
            conference === "AFC"
                ? state.afc
                : state.nfc;

        const matchups =
            wildcardMatchupsFromSeeds(conferenceState.seeds);

        for (let index = 0; index < 3; index += 1) {
            if (!conferenceState.wcWinners[index]) {
                return {
                    round: "wc",
                    conference,
                    index,
                    teams: [
                        matchups[index].a,
                        matchups[index].b
                    ]
                };
            }
        }
    }

    for (const conference of ["AFC", "NFC"]) {
        const conferenceState =
            conference === "AFC"
                ? state.afc
                : state.nfc;

        const matchups =
            getDivisionalMatchupsForConference(conferenceState);

        if (!matchups) continue;

        for (let index = 0; index < 2; index += 1) {
            if (!conferenceState.divWinners[index]) {
                return {
                    round: "div",
                    conference,
                    index,
                    teams: [
                        matchups[index].a,
                        matchups[index].b
                    ]
                };
            }
        }
    }

    for (const conference of ["AFC", "NFC"]) {
        const conferenceState =
            conference === "AFC"
                ? state.afc
                : state.nfc;

        if (
            !conferenceState.confWinner &&
            conferenceState.divWinners.every(Boolean)
        ) {
            return {
                round: "conf",
                conference,
                teams: conferenceState.divWinners.slice()
            };
        }
    }

    if (
        state.afc.confWinner &&
        state.nfc.confWinner &&
        !state.superBowl.winner
    ) {
        return {
            round: "sb",
            teams: [
                state.afc.confWinner,
                state.nfc.confWinner
            ]
        };
    }

    return null;
}

function applySimulatedPick(state, decision, team) {
    if (decision.round === "sb") {
        state.superBowl.winner = team;
        return;
    }

    const conferenceState =
        decision.conference === "AFC"
            ? state.afc
            : state.nfc;

    if (decision.round === "wc") {
        conferenceState.wcWinners[decision.index] = team;
        conferenceState.divWinners = [null, null];
        conferenceState.confWinner = null;
        state.superBowl.winner = null;
    } else if (decision.round === "div") {
        conferenceState.divWinners[decision.index] = team;
        conferenceState.confWinner = null;
        state.superBowl.winner = null;
    } else if (decision.round === "conf") {
        conferenceState.confWinner = team;
        state.superBowl.winner = null;
    }
}

function whatIfStateKey(state) {
    return JSON.stringify({
        afcWc: state.afc.wcWinners,
        nfcWc: state.nfc.wcWinners,
        afcDiv: state.afc.divWinners,
        nfcDiv: state.nfc.divWinners,
        afcConf: state.afc.confWinner,
        nfcConf: state.nfc.confWinner,
        winner: state.superBowl.winner
    });
}

function computeWinOddsFromState(currentState) {
    const cacheKey = whatIfStateKey(currentState);

    if (oddsCache.has(cacheKey)) {
        return oddsCache.get(cacheKey);
    }

    let michaelWins = 0;
    let zachWins = 0;
    let ties = 0;
    let total = 0;

    function evaluate(state) {
        const decision = nextWhatIfDecision(state);

        if (!decision) {
            if (!state.superBowl.winner) return;

            total += 1;

            const {
                michaelTotal,
                zachTotal
            } = computeWhatIfTotals(state);

            if (michaelTotal > zachTotal) {
                michaelWins += 1;
            } else if (zachTotal > michaelTotal) {
                zachWins += 1;
            } else {
                ties += 1;
            }

            return;
        }

        decision.teams.forEach(team => {
            if (!team || team === "TBD") return;

            const nextState = cloneState(state);

            applySimulatedPick(
                nextState,
                decision,
                team
            );

            evaluate(nextState);
        });
    }

    evaluate(cloneState(currentState));

    const result = total === 0
        ? {
            michaelPct: 0,
            zachPct: 0,
            tiePct: 0,
            total: 0
        }
        : {
            michaelPct: (michaelWins / total) * 100,
            zachPct: (zachWins / total) * 100,
            tiePct: (ties / total) * 100,
            total
        };

    oddsCache.set(cacheKey, result);

    return result;
}

function renderWhatIfOdds() {
    const element = byId("whatif-odds");

    if (!element || !whatIfState) return;

    const requestId = ++oddsRenderRequest;
    const stateSnapshot = cloneState(whatIfState);

    element.innerHTML =
        '<span class="odds-title">Calculating win odds…</span>';

    const calculateAndRender = () => {
        if (requestId !== oddsRenderRequest) return;

        const {
            michaelPct,
            zachPct,
            tiePct,
            total
        } = computeWinOddsFromState(stateSnapshot);

        if (requestId !== oddsRenderRequest) return;

        if (total === 0) {
            element.textContent =
                "Complete more picks to calculate the remaining win odds.";
            return;
        }

        element.innerHTML = `
            <span class="odds-title">Win odds</span>

            <div class="odds-values">
                <span>
                    Michael <strong>${michaelPct.toFixed(1)}%</strong>
                </span>

                <span>
                    Zach <strong>${zachPct.toFixed(1)}%</strong>
                </span>

                ${tiePct > 0
                ? `<span>Tie <strong>${tiePct.toFixed(1)}%</strong></span>`
                : ""}
            </div>

            <span class="odds-scenarios">
                ${formatNumber(total)} equally weighted remaining scenarios
            </span>
        `;
    };

    if ("requestIdleCallback" in window) {
        window.requestIdleCallback(
            calculateAndRender,
            { timeout: 500 }
        );
    } else {
        window.setTimeout(calculateAndRender, 0);
    }
}

function renderWhatIf() {
    if (!whatIfState) return;

    whatIfState = reconcileWhatIfState();

    renderConference("AFC", whatIfState.afc, {
        wildcard: "whatif-afc-wc",
        divisional: "whatif-afc-div",
        conference: "whatif-afc-conf"
    });

    renderConference("NFC", whatIfState.nfc, {
        wildcard: "whatif-nfc-wc",
        divisional: "whatif-nfc-div",
        conference: "whatif-nfc-conf"
    });

    renderSuperBowl();

    const teams = [
        ...whatIfState.afc.seeds,
        ...whatIfState.nfc.seeds
    ].map(item => item.name);

    const assigned =
        teams.length === 14 &&
        new Set(teams).size === 14 &&
        teams.every(name => getOwner(name));

    const note = byId("whatif-preview-note");

    note.hidden = assigned;
    note.textContent = "Bracket preview: the final playoff seeds are not set yet. Try the placeholders below. Teams, score projections, and scenario percentages will appear automatically when the playoff field is set.";

    byId("whatif-reset").disabled = false;
    byId("whatif-score").hidden = !assigned;
    byId("whatif-odds").hidden = !assigned;
    byId("whatif-odds-note").hidden = !assigned;

    if (assigned) {
        renderWhatIfScore();
        renderWhatIfOdds();
    } else {
        // Cancel any pending calculation for a prior set of seeds.
        oddsRenderRequest += 1;
    }
}


/*********************************
 * INITIALIZATION + EVENTS
 *********************************/

function applyTeamWins() {
    const winsLookup = new Map(
        teamRecords.map(team => [team.name, team.wins])
    );

    ["michael", "zach"].forEach(owner => {
        (draftData[owner] || []).forEach(team => {
            team.wins = winsLookup.get(team.name) ?? 0;
        });
    });
}

function updateFreshness() {
    const element = byId("data-freshness");

    if (!element || !seasonSnapshot) return;

    const date = new Date(seasonSnapshot.updatedAt);
    const stale = Date.now() - date.getTime() > 2 * 60 * 60 * 1000;

    element.classList.toggle("is-stale", stale || refreshFailed);

    const timestamp = new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short"
    }).format(date);

    element.textContent = `Scores updated ${timestamp}` +
        (
            stale || refreshFailed
                ? " · Showing the last saved scores; waiting for the next update."
                : liveFeedAvailable
                    ? " · Live feed checked; refreshes every minute"
                    : " · Saved snapshot; live feed not connected"
        );
}

function applySnapshot(snapshot) {
    const names = [
        ...(draftData.michael || []),
        ...(draftData.zach || [])
    ].map(team => team.name);

    if (
        snapshot.schemaVersion !== 1 ||
        snapshot.season !== SEASON ||
        !Number.isFinite(Date.parse(snapshot.updatedAt)) ||
        !Array.isArray(snapshot.teamRecords) ||
        snapshot.teamRecords.length !== 32 ||
        new Set(snapshot.teamRecords.map(team => team.name)).size !== 32 ||
        !snapshot.teamRecords.every(team =>
            names.includes(team.name) &&
            Number.isInteger(team.wins) &&
            team.wins >= 0 &&
            team.wins <= 17
        ) ||
        !Array.from(
            { length: 18 },
            (_, i) => `Week ${i + 1}`
        ).every(key => Array.isArray(snapshot.schedule?.[key])) ||
        ![
            "wildcard",
            "divisional",
            "championship",
            "superbowl"
        ].every(key => Array.isArray(snapshot.playoffBonus?.[key])) ||
        !["AFC", "NFC"].every(key =>
            Array.isArray(snapshot.playoffSeeds?.[key])
        )
    ) {
        throw new Error(
            "The automatic season snapshot is incomplete or for the wrong season."
        );
    }

    const seedsChanged =
        JSON.stringify(playoffSeeds) !==
        JSON.stringify(snapshot.playoffSeeds);

    seasonSnapshot = snapshot;
    teamRecords = snapshot.teamRecords;
    scheduleData = snapshot.schedule;
    playoffBonusData = snapshot.playoffBonus;
    playoffSeeds = snapshot.playoffSeeds;
    refreshFailed = false;

    if (seedsChanged) whatIfState = null;

    oddsCache.clear();

    validateCoreData();
    applyTeamWins();
    rebuildOwnerMap();
    updateCurrentWeekDisplay();
    updateTotalWins();
    updateTeamLists();
    updateKeyMatchups();
    updateFreshness();

    if (appReady && routeFromLocation() === "whatif") {
        if (!whatIfState) initWhatIf();
        else renderWhatIf();
    }
}

async function refreshSeason() {
    if (!appReady || refreshInFlight) return;

    refreshInFlight = true;
    lastRefreshAttempt = Date.now();

    try {
        // Pick up the complete background snapshot without replacing newer live data.
        try {
            const saved = await fetchJSON(DATA_PATHS.snapshot);

            if (
                Date.parse(saved.updatedAt) >
                Date.parse(seasonSnapshot?.updatedAt || 0)
            ) {
                applySnapshot(saved);
            }
        } catch (error) {
            console.warn("Saved snapshot unavailable:", error.message);
        }

        if (!liveRefreshModule) {
            liveRefreshModule = await import("./scripts/live-data.mjs");
        }

        const names = [
            ...draftData.michael,
            ...draftData.zach
        ].map(team => team.name);

        const live = await liveRefreshModule.refreshLiveSnapshot(
            seasonSnapshot,
            getCurrentWeekKey(),
            names
        );

        applySnapshot(live);

        liveFeedAvailable = true;
        refreshFailed = false;
    } catch (error) {
        liveFeedAvailable = false;
        refreshFailed = true;

        console.warn(
            "Live refresh unavailable; retaining saved scores:",
            error.message
        );
    } finally {
        refreshInFlight = false;
        updateFreshness();
    }
}

function wireAutomaticUpdates() {
    window.setInterval(() => {
        if (!appReady || document.hidden) return;

        if (displayedWeek !== getCurrentWeekKey()) {
            updateCurrentWeekDisplay();
            updateKeyMatchups();
        }

        updateFreshness();

        if (Date.now() - lastRefreshAttempt >= AUTO_REFRESH_MS) {
            refreshSeason();
        }
    }, 15000);

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && appReady) {
            updateCurrentWeekDisplay();
            updateKeyMatchups();
            refreshSeason();
        }
    });
}

async function init() {
    appReady = false;

    setAppStatus(
        "loading",
        "Loading the 2026 season…"
    );

    try {
        lastRefreshAttempt = Date.now();

        const [draft, snapshot] = await Promise.all([
            fetchJSON(DATA_PATHS.draft),
            fetchJSON(DATA_PATHS.snapshot)
        ]);

        draftData = draft;
        applySnapshot(snapshot);

        appReady = true;

        setAppStatus("ready");
        void refreshSeason();

        const currentPage = routeFromLocation();

        if (
            currentPage === "history" &&
            !historyLoadedYear
        ) {
            loadHistory(DEFAULT_HISTORY_YEAR);
        } else if (currentPage === "whatif") {
            initWhatIf();
        }
    } catch (error) {
        console.error(
            "Failed to initialize the site:",
            error
        );

        renderFatalError(error);
    }
}

function wireNavigation() {
    document
        .querySelectorAll(".nav-link, .brand")
        .forEach(link => {
            link.addEventListener("click", event => {
                event.preventDefault();

                const pageId =
                    link.dataset.page || "home";

                navigateTo(pageId);
            });
        });

    window.addEventListener("popstate", () => {
        showPage(
            routeFromLocation(),
            { focusHeading: true }
        );
    });
}

function wireHistory() {
    const historyPage = byId("history");

    if (!historyPage) return;

    historyPage.addEventListener("click", event => {
        const yearButton =
            event.target.closest(".year-button");

        if (yearButton) {
            loadHistory(yearButton.dataset.year);
            return;
        }

        const retryButton =
            event.target.closest("[data-retry-history]");

        if (retryButton) {
            loadHistory(
                retryButton.dataset.retryHistory
            );
        }
    });
}

function wireWhatIf() {
    const whatIfPage = byId("whatif");

    if (!whatIfPage) return;

    whatIfPage.addEventListener("click", event => {
        const matchup =
            event.target.closest(
                ".matchup-row[data-round]"
            );

        if (matchup && !matchup.disabled) {
            handleWhatIfPick(matchup.dataset);
        }
    });

    const resetButton = byId("whatif-reset");

    if (resetButton) {
        resetButton.addEventListener("click", () => {
            oddsCache.clear();
            initWhatIf();
        });
    }
}

function wireAppRetry() {
    const panel = byId("app-status");

    if (!panel) return;

    panel.addEventListener("click", event => {
        if (event.target.closest("[data-retry-app]")) {
            panel.setAttribute("role", "status");

            panel.innerHTML = `
                <span class="spinner" aria-hidden="true"></span>
                <span id="app-status-message">
                    Loading the 2026 season…
                </span>
            `;

            init();
        }
    });
}

// Keep an abbreviation visible if a logo file cannot be loaded.
document.addEventListener("error", event => {
    const image = event.target;

    if (!image.classList?.contains("team-logo")) return;

    image.hidden = true;

    const fallback = image.parentElement.querySelector(".team-abbr");

    if (fallback) fallback.hidden = false;
}, true);

window.addEventListener("DOMContentLoaded", () => {
    updateWhatIfTabVisibility();
    wireNavigation();
    wireHistory();
    wireWhatIf();
    wireAppRetry();
    wireAutomaticUpdates();

    const initialPage = routeFromLocation();

    if (
        !window.location.hash ||
        (
            window.location.hash === "#whatif" &&
            !SHOW_WHATIF_TAB
        )
    ) {
        window.history.replaceState(
            { page: initialPage },
            "",
            `#${initialPage}`
        );
    }

    showPage(initialPage);
    init();
});