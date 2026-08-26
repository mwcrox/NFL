"use strict";

/*********************************
 * CONFIGURATION + STATE
 *********************************/

const SHOW_WHATIF_TAB = false;
const DEFAULT_HISTORY_YEAR = "2025";

const DATA_PATHS = {
    draft: "draft.json",
    schedule: "schedule.json",
    playoffBonus: "playoff/playoffBonus.json",
    playoffSeeds: "playoff/playoffSeeds.json",
    teamWins: "teamWins.json"
};

const PAGE_TITLES = {
    home: "Michael vs. Zach | NFL Fantasy Draft",
    teams: "2026 Teams | NFL Fantasy Draft",
    history: "Draft History | NFL Fantasy Draft",
    whatif: "Playoff What If? | NFL Fantasy Draft"
};

let draftData = {};
let scheduleData = {};
let playoffBonusData = {};
let teamWinsGrouped = {};
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
        throw new Error("schedule.json must contain weekly matchup data.");
    }

    if (!teamWinsGrouped || typeof teamWinsGrouped !== "object") {
        throw new Error("teamWins.json must contain the AFC and NFC standings.");
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
    const michaelLeads = michaelTotal > zachTotal;
    const zachLeads = zachTotal > michaelTotal;
    const difference = Math.abs(michaelTotal - zachTotal);

    const summary = isTie
        ? `The season is tied at ${michaelTotal} points.`
        : `${michaelLeads ? "Michael" : "Zach"} leads by ${pluralize(difference, "point")}.`;

    element.setAttribute(
        "aria-label",
        `Michael ${michaelTotal} points, Zach ${zachTotal} points. ${summary}`
    );
    element.setAttribute("aria-busy", "false");

    element.innerHTML = `
        <div class="competitor competitor--michael ${michaelLeads ? "is-leading" : ""}">
            <img class="competitor-logo" src="pictures/Michael.webp" width="256" height="256" alt="" decoding="async">
            <div class="competitor-copy">
                <span class="competitor-name">Michael</span>
                <strong class="competitor-score">${michaelTotal}</strong>
                <span class="competitor-status">${michaelLeads ? "Leading" : ""}</span>
            </div>
        </div>

        <span class="score-divider" aria-hidden="true">–</span>

        <div class="competitor competitor--zach ${zachLeads ? "is-leading" : ""}">
            <img class="competitor-logo" src="pictures/Zach.webp" width="256" height="256" alt="" decoding="async">
            <div class="competitor-copy">
                <span class="competitor-name">Zach</span>
                <strong class="competitor-score">${zachTotal}</strong>
                <span class="competitor-status">${zachLeads ? "Leading" : ""}</span>
            </div>
        </div>

        <p class="score-summary">${escapeHTML(summary)}</p>
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

    if (currentWeekEl) {
        currentWeekEl.textContent = getCurrentWeekKey();
    }
}

function renderTeamList(owner) {
    const list = byId(`${owner}-teams`);
    const summary = byId(`${owner}-summary`);
    const teams = draftData[owner] || [];

    if (!list) return;

    list.innerHTML = teams.map((team, index) => {
        const wins = Number(team.wins) || 0;

        return `
            <li class="team-card">
                <span class="draft-number" aria-label="Draft pick ${index + 1}">
                    ${String(index + 1).padStart(2, "0")}
                </span>
                <span class="team-name">${escapeHTML(team.name)}</span>
                <span class="win-total">${pluralize(wins, "win")}</span>
            </li>
        `;
    }).join("");

    list.setAttribute("aria-busy", "false");

    if (summary) {
        const totalWins = teams.reduce(
            (sum, team) => sum + (Number(team.wins) || 0),
            0
        );

        summary.textContent =
            `${pluralize(teams.length, "drafted team")} · ${pluralize(totalWins, "win")}`;
    }
}

function updateTeamLists() {
    renderTeamList("michael");
    renderTeamList("zach");
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

        return `
            <article class="game-card" aria-label="${escapeHTML(game.away)} at ${escapeHTML(game.home)}">
                <div class="game-team">
                    <span class="game-team-name">${escapeHTML(game.away)}</span>
                    <span class="owner-badge owner-badge--${awayOwner}">
                        ${awayOwner === "michael" ? "Michael" : "Zach"}
                    </span>
                </div>

                <span class="game-at" aria-hidden="true">@</span>

                <div class="game-team">
                    <span class="game-team-name">${escapeHTML(game.home)}</span>
                    <span class="owner-badge owner-badge--${homeOwner}">
                        ${homeOwner === "michael" ? "Michael" : "Zach"}
                    </span>
                </div>
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
    const validPages = ["home", "teams", "history"];

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

    if (resolvedPage === "whatif" && appReady && !whatIfState) {
        initWhatIf();
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

    const scoreEl = byId("whatif-score");

    if (scoreEl) {
        scoreEl.innerHTML =
            '<div class="empty-state"><p>Fill in playoff/playoffSeeds.json to enable the simulator.</p></div>';
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
    disabled = false
}) {
    const safeTeam = escapeHTML(team || "TBD");

    const attributes = disabled
        ? 'disabled aria-pressed="false"'
        : `data-conf="${escapeHTML(conference)}" data-round="${escapeHTML(round)}" data-idx="${escapeHTML(index)}" data-team="${safeTeam}" aria-pressed="${selected}" aria-label="Select ${safeTeam} to advance"`;

    const seedMarkup = seed
        ? `<span class="seed">#${escapeHTML(seed)}</span>`
        : "";

    return `
        <button type="button" class="matchup-row" ${attributes}>
            <span class="matchup-team">
                ${seedMarkup}${safeTeam}
            </span>
        </button>
    `;
}

function matchupCard(buttons, locked = false) {
    return `
        <div class="matchup-card ${locked ? "is-locked" : ""}">
            ${buttons.join("")}
        </div>
    `;
}

function renderConference(conference, conferenceState, ids) {
    const wildcardEl = byId(ids.wildcard);
    const divisionalEl = byId(ids.divisional);
    const conferenceEl = byId(ids.conference);

    if (!wildcardEl || !divisionalEl || !conferenceEl) {
        return;
    }

    const seeds = conferenceState.seeds;
    const seedMap = seedMapFromSeeds(seeds);
    const wildcardMatchups = wildcardMatchupsFromSeeds(seeds);

    const firstSeed =
        seeds.find(item => item.seed === 1)?.name || "TBD";

    wildcardEl.innerHTML = wildcardMatchups.map((matchup, index) => {
        const selectedTeam = conferenceState.wcWinners[index];

        return matchupCard([
            matchupButton({
                conference,
                round: "wc",
                index,
                team: matchup.a,
                seed: seedMap[matchup.a],
                selected: selectedTeam === matchup.a
            }),
            matchupButton({
                conference,
                round: "wc",
                index,
                team: matchup.b,
                seed: seedMap[matchup.b],
                selected: selectedTeam === matchup.b
            })
        ]);
    }).join("");

    const wildcardWinners =
        conferenceState.wcWinners.filter(Boolean);

    const divisionalLocked =
        wildcardWinners.length !== 3;

    const divisionalMatchups =
        divisionalMatchupsReseed(seeds, wildcardWinners) || [
            { a: firstSeed, b: "TBD" },
            { a: "TBD", b: "TBD" }
        ];

    divisionalEl.innerHTML = divisionalMatchups.map((matchup, index) => {
        const selectedTeam = conferenceState.divWinners[index];

        return matchupCard([
            matchupButton({
                conference,
                round: "div",
                index,
                team: matchup.a,
                seed: seedMap[matchup.a] || "",
                selected: selectedTeam === matchup.a,
                disabled:
                    divisionalLocked ||
                    matchup.a === "TBD"
            }),
            matchupButton({
                conference,
                round: "div",
                index,
                team: matchup.b,
                seed: seedMap[matchup.b] || "",
                selected: selectedTeam === matchup.b,
                disabled:
                    divisionalLocked ||
                    matchup.b === "TBD"
            })
        ], divisionalLocked);
    }).join("");

    const conferenceLocked =
        conferenceState.divWinners.filter(Boolean).length !== 2;

    const conferenceTeams = conferenceLocked
        ? ["TBD", "TBD"]
        : conferenceState.divWinners.slice();

    conferenceEl.innerHTML = matchupCard(
        conferenceTeams.map(team => matchupButton({
            conference,
            round: "conf",
            team,
            selected: conferenceState.confWinner === team,
            disabled:
                conferenceLocked ||
                team === "TBD"
        })),
        conferenceLocked
    );
}

function renderSuperBowl() {
    const element = byId("whatif-superbowl");

    if (!element || !whatIfState) return;

    const afcWinner =
        whatIfState.afc.confWinner || "TBD";

    const nfcWinner =
        whatIfState.nfc.confWinner || "TBD";

    const isLocked =
        afcWinner === "TBD" ||
        nfcWinner === "TBD";

    element.innerHTML = matchupCard([
        matchupButton({
            round: "sb",
            team: afcWinner,
            selected:
                whatIfState.superBowl.winner === afcWinner,
            disabled: isLocked
        }),
        matchupButton({
            round: "sb",
            team: nfcWinner,
            selected:
                whatIfState.superBowl.winner === nfcWinner,
            disabled: isLocked
        })
    ], isLocked);
}

function handleWhatIfPick(dataset) {
    if (!whatIfState) return;

    const round = dataset.round;
    const team = dataset.team;

    if (round === "sb") {
        whatIfState.superBowl.winner = team;
        renderWhatIf();
        return;
    }

    const conferenceState =
        dataset.conf === "AFC"
            ? whatIfState.afc
            : whatIfState.nfc;

    if (round === "wc") {
        conferenceState.wcWinners[Number(dataset.idx)] = team;
        conferenceState.divWinners = [null, null];
        conferenceState.confWinner = null;
        whatIfState.superBowl.winner = null;
    } else if (round === "div") {
        conferenceState.divWinners[Number(dataset.idx)] = team;
        conferenceState.confWinner = null;
        whatIfState.superBowl.winner = null;
    } else if (round === "conf") {
        conferenceState.confWinner = team;
        whatIfState.superBowl.winner = null;
    }

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
    renderWhatIfScore();
    renderWhatIfOdds();
}


/*********************************
 * INITIALIZATION + EVENTS
 *********************************/

function applyTeamWins() {
    const winsLookup = new Map();

    Object.values(teamWinsGrouped).forEach(conference => {
        Object.values(conference).forEach(division => {
            division.forEach(team => {
                winsLookup.set(
                    team.name,
                    Number(team.wins) || 0
                );
            });
        });
    });

    ["michael", "zach"].forEach(owner => {
        (draftData[owner] || []).forEach(team => {
            team.wins =
                winsLookup.get(team.name) ?? 0;
        });
    });
}

async function init() {
    appReady = false;

    setAppStatus(
        "loading",
        "Loading the 2026 season…"
    );

    try {
        const requests = [
            fetchJSON(DATA_PATHS.draft),
            fetchJSON(DATA_PATHS.schedule),
            fetchJSON(DATA_PATHS.playoffBonus),
            fetchJSON(DATA_PATHS.teamWins)
        ];

        if (SHOW_WHATIF_TAB) {
            requests.push(
                fetchJSON(DATA_PATHS.playoffSeeds)
            );
        }

        const results = await Promise.all(requests);

        [
            draftData,
            scheduleData,
            playoffBonusData,
            teamWinsGrouped
        ] = results;

        playoffSeeds =
            SHOW_WHATIF_TAB
                ? results[4]
                : {};

        validateCoreData();
        applyTeamWins();
        rebuildOwnerMap();

        updateCurrentWeekDisplay();
        updateTotalWins();
        updateTeamLists();
        updateKeyMatchups();

        appReady = true;

        setAppStatus("ready");

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

window.addEventListener("DOMContentLoaded", () => {
    updateWhatIfTabVisibility();
    wireNavigation();
    wireHistory();
    wireWhatIf();
    wireAppRetry();

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