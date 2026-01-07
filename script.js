/*********************************
 * GLOBAL STATE
 *********************************/

let draftData = {};
let scheduleData = {};
let playoffBonusData = {};
let teamWinsGrouped = {};        // from teamWins.json
let playoffSeeds = {};           // from playoffSeeds.json (frozen seeding)
let playoffBaseline = {};        // fetched but not used for auto-advances
let whatIfState = null;


/*********************************
 * HELPERS
 *********************************/

function safeEl(id) {
    return document.getElementById(id);
}

function uniq(arr) {
    return Array.from(new Set(arr));
}


/*********************************
 * TIME / WEEK LOGIC
 *********************************/

function getCurrentWeekKey() {
    const now = new Date();
    const estNow = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));

    const regularSeasonStart = new Date("2025-09-03T12:00:00-04:00");
    const week1Cutoff = new Date("2025-09-09T12:00:00-04:00");

    if (estNow < week1Cutoff) return "Week 1";

    for (let i = 2; i <= 18; i++) {
        const weekStart = new Date(regularSeasonStart);
        weekStart.setDate(weekStart.getDate() + (i - 1) * 7);
        if (estNow < weekStart) return `Week ${i - 1}`;
    }

    const playoffs = [
        { key: "Wild Card Round", start: new Date("2026-01-05T00:00:00-05:00") },
        { key: "Divisional Round", start: new Date("2026-01-13T00:00:00-05:00") },
        { key: "Conference Championship", start: new Date("2026-01-20T00:00:00-05:00") },
        { key: "Super Bowl", start: new Date("2026-01-26T00:00:00-05:00") }
    ];

    if (estNow < playoffs[0].start) return "Week 18";

    for (let i = 0; i < playoffs.length; i++) {
        const thisRound = playoffs[i];
        const nextRound = playoffs[i + 1];

        const afterThisRoundStarts = estNow >= thisRound.start;
        const beforeNextRoundStarts = !nextRound || estNow < nextRound.start;

        if (afterThisRoundStarts && beforeNextRoundStarts) {
            return thisRound.key;
        }
    }

    return "Super Bowl";
}


/*********************************
 * BASIC UI UPDATES
 *********************************/

function updateTeamLists() {
    const michaelEl = safeEl('michael-teams');
    const zachEl = safeEl('zach-teams');
    if (!michaelEl || !zachEl) return;

    michaelEl.innerHTML = '';
    zachEl.innerHTML = '';

    (draftData.michael || []).forEach(team => {
        const div = document.createElement('div');
        div.className = 'card';
        div.textContent = `${team.name} — ${team.wins} wins`;
        michaelEl.appendChild(div);
    });

    (draftData.zach || []).forEach(team => {
        const div = document.createElement('div');
        div.className = 'card';
        div.textContent = `${team.name} — ${team.wins} wins`;
        zachEl.appendChild(div);
    });
}

function updateKeyMatchups() {
    const currentWeek = getCurrentWeekKey();
    const matchups = scheduleData[currentWeek] || [];

    const michaelTeams = (draftData.michael || []).map(t => t.name);
    const zachTeams = (draftData.zach || []).map(t => t.name);

    const keyGames = matchups.filter(game => {
        const homeOwner = michaelTeams.includes(game.home) ? 'michael' : zachTeams.includes(game.home) ? 'zach' : null;
        const awayOwner = michaelTeams.includes(game.away) ? 'michael' : zachTeams.includes(game.away) ? 'zach' : null;
        return homeOwner && awayOwner && homeOwner !== awayOwner;
    });

    const matchupsEl = safeEl('matchups');
    if (!matchupsEl) return;

    if (keyGames.length === 0) {
        matchupsEl.innerHTML = `<div class="card">No key matchups this week.</div>`;
    } else {
        matchupsEl.innerHTML = keyGames
            .map(game => `<div class="card">${game.away} @ ${game.home}</div>`)
            .join('');
    }
}

function updateCurrentWeekDisplay() {
    const el = safeEl('current-week');
    if (!el) return;
    el.textContent = `Current Week: ${getCurrentWeekKey()}`;
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = safeEl(pageId);
    if (page) page.classList.add('active');

    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    const nav = safeEl('nav-' + pageId);
    if (nav) nav.classList.add('active');
}


/*********************************
 * REAL SCORE LOGIC (unchanged)
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

function updateTotalWins() {
    const michaelTotal = (draftData.michael || []).reduce((sum, team) => {
        const winPoints = (team.wins || 0) * 2;
        const bonusPoints = getBonusPoints(team.name);
        return sum + winPoints + bonusPoints;
    }, 0);

    const zachTotal = (draftData.zach || []).reduce((sum, team) => {
        const winPoints = (team.wins || 0) * 2;
        const bonusPoints = getBonusPoints(team.name);
        return sum + winPoints + bonusPoints;
    }, 0);

    const michaelLogo = `<img src="pictures/Michael.png" alt="Michael" class="team-logo">`;
    const zachLogo = `<img src="pictures/Zach.PNG" alt="Zach" class="team-logo">`;

    const el = safeEl('total-wins');
    if (!el) return;

    el.innerHTML =
        michaelTotal >= zachTotal
            ? `${michaelLogo} ${michaelTotal} - ${zachTotal} ${zachLogo}`
            : `${zachLogo} ${zachTotal} - ${michaelTotal} ${michaelLogo}`;
}


/*********************************
 * HISTORY
 *********************************/

async function loadHistory(year) {
    try {
        const res = await fetch(`History/${year}.json`);
        const data = await res.json();

        const resultsEl = safeEl('history-results');
        if (!resultsEl) return;
        resultsEl.innerHTML = '';

        const finalScoreDiv = document.createElement('div');
        finalScoreDiv.className = 'card final-score';
        finalScoreDiv.innerHTML = `
      <h3>${year} Final Score</h3>
      <p><strong>Michael:</strong> ${data.finalScore.Michael} — <strong>Zach:</strong> ${data.finalScore.Zach}</p>
      <p><em>First Pick: ${data.firstPick}</em></p>
    `;
        resultsEl.appendChild(finalScoreDiv);

        const michaelDiv = document.createElement('div');
        michaelDiv.className = 'team-column';
        michaelDiv.innerHTML = `<h4>Michael's Team</h4>`;
        data.teams.Michael.forEach((team, index) => {
            const div = document.createElement('div');
            div.className = 'card';
            div.textContent = `${index + 1}. ${team.team} — ${team.points} points`;
            michaelDiv.appendChild(div);
        });

        const zachDiv = document.createElement('div');
        zachDiv.className = 'team-column';
        zachDiv.innerHTML = `<h4>Zach's Team</h4>`;
        data.teams.Zach.forEach((team, index) => {
            const div = document.createElement('div');
            div.className = 'card';
            div.textContent = `${index + 1}. ${team.team} — ${team.points} points`;
            zachDiv.appendChild(div);
        });

        const container = document.createElement('div');
        container.className = 'teams-container';
        container.appendChild(michaelDiv);
        container.appendChild(zachDiv);
        resultsEl.appendChild(container);

    } catch (err) {
        console.error(`Failed to load history for ${year}:`, err);
    }
}


/*********************************
 * WHAT-IF: BRACKET + SCORING
 *********************************/

/**
 * playoffSeeds.json format (frozen, end of regular season seeding):
 * {
 *   "AFC": [{"seed":1,"team":"..."}, ... {"seed":7,"team":"..."}],
 *   "NFC": [{"seed":1,"team":"..."}, ... {"seed":7,"team":"..."}]
 * }
 */

function getSeedsForConference(confKey) {
    const list = playoffSeeds?.[confKey];
    if (!Array.isArray(list)) return [];

    return list
        .map(x => ({ seed: Number(x.seed), name: x.team }))
        .filter(x => x.seed >= 1 && x.seed <= 7 && x.name)
        .sort((a, b) => a.seed - b.seed);
}

function seedMapFromSeeds(seeds) {
    const map = {};
    seeds.forEach(s => map[s.name] = s.seed);
    return map;
}

function wildcardMatchupsFromSeeds(seeds) {
    const bySeed = {};
    seeds.forEach(s => bySeed[s.seed] = s.name);
    return [
        { a: bySeed[2], b: bySeed[7] },
        { a: bySeed[3], b: bySeed[6] },
        { a: bySeed[4], b: bySeed[5] }
    ];
}

function divisionalMatchupsReseed(seeds, wcWinners3) {
    const seedMap = seedMapFromSeeds(seeds);
    const seed1 = seeds.find(s => s.seed === 1)?.name;
    if (!seed1 || wcWinners3.length !== 3) return null;

    const remaining = [seed1, ...wcWinners3].slice();
    remaining.sort((x, y) => seedMap[x] - seedMap[y]);

    const lowest = remaining[remaining.length - 1];
    const others = remaining.filter(t => t !== seed1 && t !== lowest);

    return [
        { a: seed1, b: lowest },
        { a: others[0], b: others[1] }
    ];
}

function initWhatIf() {
    const afcSeeds = getSeedsForConference("AFC");
    const nfcSeeds = getSeedsForConference("NFC");

    if (afcSeeds.length !== 7 || nfcSeeds.length !== 7) {
        console.warn("What-if not initialized: playoffSeeds.json missing/invalid. Need 7 seeds per conference.");
        renderWhatIfMissingSeeds();
        return;
    }

    // No automatic WC advances. User picks all WC winners.
    whatIfState = {
        afc: { seeds: afcSeeds, wcWinners: [null, null, null], divWinners: [null, null], confWinner: null },
        nfc: { seeds: nfcSeeds, wcWinners: [null, null, null], divWinners: [null, null], confWinner: null },
        superBowl: { winner: null }
    };

    const resetBtn = safeEl('whatif-reset');
    if (resetBtn) {
        resetBtn.onclick = () => {
            initWhatIf();
            renderWhatIf();
        };
    }

    renderWhatIf();
}

function renderWhatIfMissingSeeds() {
    const afcEl = safeEl("whatif-afc");
    const nfcEl = safeEl("whatif-nfc");
    const sbEl = safeEl("whatif-superbowl");
    const scoreEl = safeEl("whatif-score");

    if (scoreEl) scoreEl.innerHTML = `<div class="card">Fill in <code>playoffSeeds.json</code> to enable What-if.</div>`;
    if (afcEl) afcEl.innerHTML = `<div class="card">Missing AFC seeds.</div>`;
    if (nfcEl) nfcEl.innerHTML = `<div class="card">Missing NFC seeds.</div>`;
    if (sbEl) sbEl.innerHTML = `<div class="card">Missing seeds.</div>`;
}

/**
 * BONUS RULES (WHAT-IF):
 * - +7 for making playoffs (all 14 seeded teams)
 * - +7 for making divisional round (seed #1 auto + WC winners)
 * - +7 for making conference championship (divisional winners)
 * - +10 for winning conference championship (conference winner)
 * - +7 for winning Super Bowl
 */
function computeWhatIfBonusPoints(teamName) {
    let bonus = 0;

    const afcSeeds = whatIfState?.afc?.seeds || [];
    const nfcSeeds = whatIfState?.nfc?.seeds || [];

    const playoffTeams = new Set([
        ...afcSeeds.map(s => s.name),
        ...nfcSeeds.map(s => s.name)
    ]);

    if (playoffTeams.has(teamName)) bonus += 7; // made playoffs

    // Made divisional: both #1 seeds + WC winners
    const afc1 = afcSeeds.find(s => s.seed === 1)?.name;
    const nfc1 = nfcSeeds.find(s => s.seed === 1)?.name;
    const divTeams = new Set([
        afc1, nfc1,
        ...(whatIfState?.afc?.wcWinners || []).filter(Boolean),
        ...(whatIfState?.nfc?.wcWinners || []).filter(Boolean)
    ].filter(Boolean));

    if (divTeams.has(teamName)) bonus += 7;

    // Made conference championship: divisional winners (2 per conf)
    const confChampTeams = new Set([
        ...(whatIfState?.afc?.divWinners || []).filter(Boolean),
        ...(whatIfState?.nfc?.divWinners || []).filter(Boolean)
    ]);

    if (confChampTeams.has(teamName)) bonus += 7;

    // Won conference championship: conference winners
    if (whatIfState?.afc?.confWinner === teamName) bonus += 10;
    if (whatIfState?.nfc?.confWinner === teamName) bonus += 10;

    // Won Super Bowl
    if (whatIfState?.superBowl?.winner === teamName) bonus += 7;

    return bonus;
}

function computeWhatIfTotals() {
    const michaelTotal = (draftData.michael || []).reduce((sum, team) => {
        return sum + ((team.wins || 0) * 2) + computeWhatIfBonusPoints(team.name);
    }, 0);

    const zachTotal = (draftData.zach || []).reduce((sum, team) => {
        return sum + ((team.wins || 0) * 2) + computeWhatIfBonusPoints(team.name);
    }, 0);

    return { michaelTotal, zachTotal };
}

function renderWhatIfScore() {
    const scoreEl = safeEl("whatif-score");
    if (!scoreEl) return;

    if (!whatIfState) {
        scoreEl.innerHTML = `<div class="card">What-if not initialized.</div>`;
        return;
    }

    const { michaelTotal, zachTotal } = computeWhatIfTotals();

    const michaelLogo = `<img src="pictures/Michael.png" alt="Michael" class="team-logo">`;
    const zachLogo = `<img src="pictures/Zach.PNG" alt="Zach" class="team-logo">`;

    scoreEl.innerHTML =
        michaelTotal >= zachTotal
            ? `${michaelLogo} ${michaelTotal} - ${zachTotal} ${zachLogo}`
            : `${zachLogo} ${zachTotal} - ${michaelTotal} ${michaelLogo}`;
}

function renderConference(confKey, confState, ids) {
    const wcEl = safeEl(ids.wc);
    const divEl = safeEl(ids.div);
    const confEl = safeEl(ids.conf);
    if (!wcEl || !divEl || !confEl) return;

    const seeds = confState.seeds;
    const seedMap = seedMapFromSeeds(seeds);
    const wcMatchups = wildcardMatchupsFromSeeds(seeds);

    // Ensure fixed slots
    if (!Array.isArray(confState.wcWinners)) confState.wcWinners = [null, null, null];
    if (!Array.isArray(confState.divWinners)) confState.divWinners = [null, null];
    while (confState.wcWinners.length < 3) confState.wcWinners.push(null);
    while (confState.divWinners.length < 2) confState.divWinners.push(null);

    const seed1 = seeds.find(s => s.seed === 1)?.name || "TBD";

    // --- WILD CARD (always visible + clickable) ---
    const wcParts = [];
    wcMatchups.forEach((m, idx) => {
        const selected = confState.wcWinners[idx];
        wcParts.push(`
      <div class="matchup-card">
        <div class="matchup-row ${selected === m.a ? "selected" : ""}"
             data-conf="${confKey}" data-round="wc" data-idx="${idx}" data-team="${m.a}">
          <div><span class="seed">#${seedMap[m.a]}</span>${m.a}</div>
          <div></div>
        </div>
        <div class="matchup-row ${selected === m.b ? "selected" : ""}"
             data-conf="${confKey}" data-round="wc" data-idx="${idx}" data-team="${m.b}">
          <div><span class="seed">#${seedMap[m.b]}</span>${m.b}</div>
          <div></div>
        </div>
      </div>
    `);
    });
    wcEl.innerHTML = wcParts.join("");

    // --- DIVISIONAL (always visible; locked until 3 WC winners) ---
    const wcPicked = confState.wcWinners.filter(Boolean);
    const divLocked = wcPicked.length !== 3;

    const divMatchups = divisionalMatchupsReseed(seeds, wcPicked) || [
        { a: seed1, b: "TBD" },
        { a: "TBD", b: "TBD" }
    ];

    const divParts = [];
    divMatchups.forEach((m, idx) => {
        const selected = confState.divWinners[idx];
        const lockedClass = divLocked ? "locked" : "";

        const a = m.a || "TBD";
        const b = m.b || "TBD";
        const aSeed = seedMap[a] ? `#${seedMap[a]}` : "";
        const bSeed = seedMap[b] ? `#${seedMap[b]}` : "";

        divParts.push(`
      <div class="matchup-card ${lockedClass}">
        <div class="matchup-row ${selected === a ? "selected" : ""}"
             ${(!divLocked && a !== "TBD") ? `data-conf="${confKey}" data-round="div" data-idx="${idx}" data-team="${a}"` : ""}>
          <div>${aSeed ? `<span class="seed">${aSeed}</span>` : ""}${a}</div>
          <div></div>
        </div>
        <div class="matchup-row ${selected === b ? "selected" : ""}"
             ${(!divLocked && b !== "TBD") ? `data-conf="${confKey}" data-round="div" data-idx="${idx}" data-team="${b}"` : ""}>
          <div>${bSeed ? `<span class="seed">${bSeed}</span>` : ""}${b}</div>
          <div></div>
        </div>
      </div>
    `);
    });
    divEl.innerHTML = divParts.join("");

    // --- CONFERENCE CHAMP (always visible; locked until 2 DIV winners) ---
    const confLocked = confState.divWinners.filter(Boolean).length !== 2;
    const teams = confLocked ? ["TBD", "TBD"] : confState.divWinners.slice();
    const confParts = [];

    confParts.push(`
    <div class="matchup-card ${confLocked ? "locked" : ""}">
      <div class="matchup-row ${confState.confWinner === teams[0] ? "selected" : ""}"
           ${(!confLocked && teams[0] !== "TBD") ? `data-conf="${confKey}" data-round="conf" data-team="${teams[0]}"` : ""}>
        <div>${teams[0]}</div>
        <div></div>
      </div>
      <div class="matchup-row ${confState.confWinner === teams[1] ? "selected" : ""}"
           ${(!confLocked && teams[1] !== "TBD") ? `data-conf="${confKey}" data-round="conf" data-team="${teams[1]}"` : ""}>
        <div>${teams[1]}</div>
        <div></div>
      </div>
    </div>
  `);

    confEl.innerHTML = confParts.join("");

    // Attach click handlers for all clickable rows we rendered
    [wcEl, divEl, confEl].forEach(el => {
        el.querySelectorAll('.matchup-row[data-round]').forEach(row => {
            row.addEventListener("click", () => handleWhatIfPick(row.dataset));
        });
    });
}


function renderSuperBowl() {
    const el = safeEl("whatif-superbowl");
    if (!el) return;

    const afcWinner = whatIfState?.afc?.confWinner || "TBD";
    const nfcWinner = whatIfState?.nfc?.confWinner || "TBD";
    const sbLocked = (afcWinner === "TBD" || nfcWinner === "TBD");

    const selected = whatIfState?.superBowl?.winner || null;

    el.innerHTML = `
    <div class="matchup-card ${sbLocked ? "locked" : ""}">
      <div class="matchup-row ${selected === afcWinner ? "selected" : ""}"
           ${sbLocked || afcWinner === "TBD" ? "" : `data-round="sb" data-team="${afcWinner}"`}>
        <div>${afcWinner} (AFC)</div>
        <div></div>
      </div>
      <div class="matchup-row ${selected === nfcWinner ? "selected" : ""}"
           ${sbLocked || nfcWinner === "TBD" ? "" : `data-round="sb" data-team="${nfcWinner}"`}>
        <div>${nfcWinner} (NFC)</div>
        <div></div>
      </div>
    </div>
  `;

    el.querySelectorAll('.matchup-row[data-round="sb"]').forEach(row => {
        row.addEventListener("click", () => handleWhatIfPick(row.dataset));
    });
}

function handleWhatIfPick(ds) {
    const round = ds.round;

    if (round === "wc") {
        const confKey = ds.conf;
        const idx = Number(ds.idx);
        const team = ds.team;

        const confState = confKey === "AFC" ? whatIfState.afc : whatIfState.nfc;

        confState.wcWinners[idx] = team;

        // Reset downstream
        confState.divWinners = [null, null];
        confState.confWinner = null;
        whatIfState.superBowl.winner = null;

        renderWhatIf();
        return;
    }

    if (round === "div") {
        const confKey = ds.conf;
        const idx = Number(ds.idx);
        const team = ds.team;

        const confState = confKey === "AFC" ? whatIfState.afc : whatIfState.nfc;

        confState.divWinners[idx] = team;

        // Reset downstream
        confState.confWinner = null;
        whatIfState.superBowl.winner = null;

        renderWhatIf();
        return;
    }

    if (round === "conf") {
        const confKey = ds.conf;
        const team = ds.team;

        const confState = confKey === "AFC" ? whatIfState.afc : whatIfState.nfc;

        confState.confWinner = team;

        // Reset downstream
        whatIfState.superBowl.winner = null;

        renderWhatIf();
        return;
    }

    if (round === "sb") {
        whatIfState.superBowl.winner = ds.team;
        renderWhatIf();
        return;
    }
}

/*********************************
 * WHAT-IF: ODDS (BRUTE FORCE)
 *********************************/

// Deep clone helper (structuredClone is great if available)
function cloneState(obj) {
    if (typeof structuredClone === "function") return structuredClone(obj);
    return JSON.parse(JSON.stringify(obj));
}

function getDivMatchupsForConf(confState) {
    const seeds = confState.seeds || [];
    const wcPicked = (confState.wcWinners || []).filter(Boolean);
    if (wcPicked.length !== 3) return null;
    return divisionalMatchupsReseed(seeds, wcPicked);
}

function getConfTeamsForConf(confState) {
    const divWinners = (confState.divWinners || []).filter(Boolean);
    if (divWinners.length !== 2) return null;
    return [divWinners[0], divWinners[1]];
}

function findNextDecision(state) {
    // 1) AFC WC
    for (let i = 0; i < 3; i++) {
        if (!state.afc.wcWinners[i]) {
            const wc = wildcardMatchupsFromSeeds(state.afc.seeds);
            return { round: "wc", conf: "AFC", idx: i, teams: [wc[i].a, wc[i].b] };
        }
    }

    // 2) NFC WC
    for (let i = 0; i < 3; i++) {
        if (!state.nfc.wcWinners[i]) {
            const wc = wildcardMatchupsFromSeeds(state.nfc.seeds);
            return { round: "wc", conf: "NFC", idx: i, teams: [wc[i].a, wc[i].b] };
        }
    }

    // 3) AFC Div
    const afcDivMatchups = getDivMatchupsForConf(state.afc);
    if (afcDivMatchups) {
        for (let i = 0; i < 2; i++) {
            if (!state.afc.divWinners[i]) {
                const m = afcDivMatchups[i];
                return { round: "div", conf: "AFC", idx: i, teams: [m.a, m.b] };
            }
        }
    }

    // 4) NFC Div
    const nfcDivMatchups = getDivMatchupsForConf(state.nfc);
    if (nfcDivMatchups) {
        for (let i = 0; i < 2; i++) {
            if (!state.nfc.divWinners[i]) {
                const m = nfcDivMatchups[i];
                return { round: "div", conf: "NFC", idx: i, teams: [m.a, m.b] };
            }
        }
    }

    // 5) AFC Conf
    if (!state.afc.confWinner) {
        const teams = getConfTeamsForConf(state.afc);
        if (teams) return { round: "conf", conf: "AFC", teams };
    }

    // 6) NFC Conf
    if (!state.nfc.confWinner) {
        const teams = getConfTeamsForConf(state.nfc);
        if (teams) return { round: "conf", conf: "NFC", teams };
    }

    // 7) Super Bowl
    const afcWinner = state.afc.confWinner;
    const nfcWinner = state.nfc.confWinner;
    if (afcWinner && nfcWinner && !state.superBowl.winner) {
        return { round: "sb", teams: [afcWinner, nfcWinner] };
    }

    return null;
}

function applyPick(state, decision, pickedTeam) {
    if (decision.round === "wc") {
        const conf = decision.conf === "AFC" ? state.afc : state.nfc;
        conf.wcWinners[decision.idx] = pickedTeam;

        // Reset downstream (same behavior as your click handler)
        conf.divWinners = [null, null];
        conf.confWinner = null;
        state.superBowl.winner = null;
        return;
    }

    if (decision.round === "div") {
        const conf = decision.conf === "AFC" ? state.afc : state.nfc;
        conf.divWinners[decision.idx] = pickedTeam;

        conf.confWinner = null;
        state.superBowl.winner = null;
        return;
    }

    if (decision.round === "conf") {
        const conf = decision.conf === "AFC" ? state.afc : state.nfc;
        conf.confWinner = pickedTeam;

        state.superBowl.winner = null;
        return;
    }

    if (decision.round === "sb") {
        state.superBowl.winner = pickedTeam;
        return;
    }
}

// Enumerate all completions consistent with current picks (each undecided game 50/50)
function computeWinOddsFromState(currentState) {
    if (!currentState) return { michaelPct: 0, zachPct: 0, tiePct: 0, total: 0 };

    let michaelWins = 0;
    let zachWins = 0;
    let ties = 0;
    let total = 0;

    function computeWhatIfTotalsWithState(simState) {
        const old = whatIfState;
        whatIfState = simState;
        const totals = computeWhatIfTotals();
        whatIfState = old;
        return totals;
    }

    function dfs(state) {
        const decision = findNextDecision(state);

        if (!decision) {
            // Only count scenarios that have a Super Bowl winner
            if (!state.superBowl?.winner) return;

            total++;
            const { michaelTotal, zachTotal } = computeWhatIfTotalsWithState(state);
            if (michaelTotal > zachTotal) michaelWins++;
            else if (zachTotal > michaelTotal) zachWins++;
            else ties++;
            return;
        }

        for (const team of decision.teams) {
            if (!team || team === "TBD") continue;
            const next = cloneState(state);
            applyPick(next, decision, team);
            dfs(next);
        }
    }

    dfs(cloneState(currentState));

    if (total === 0) return { michaelPct: 0, zachPct: 0, tiePct: 0, total: 0 };

    return {
        michaelPct: (michaelWins / total) * 100,
        zachPct: (zachWins / total) * 100,
        tiePct: (ties / total) * 100,
        total
    };
}

function renderWhatIfOdds() {
    const el = safeEl("whatif-odds");
    if (!el) return;

    if (!whatIfState) {
        el.innerHTML = ``;
        return;
    }

    const { michaelPct, zachPct, tiePct, total } = computeWinOddsFromState(whatIfState);

    if (total === 0) {
        el.innerHTML = `Win Odds: Complete more picks to calculate.`;
        return;
    }

    el.innerHTML = `
      <div style="font-size: 16px;">
        <strong>Win Odds</strong> (all remaining outcomes equally likely)<br/>
        Michael: <strong>${michaelPct.toFixed(1)}%</strong> &nbsp; | &nbsp;
        Zach: <strong>${zachPct.toFixed(1)}%</strong>
        ${tiePct > 0 ? `&nbsp; | &nbsp; Tie: <strong>${tiePct.toFixed(1)}%</strong>` : ""}
        <br/><span style="font-size: 12px; opacity: 0.8;">Scenarios evaluated: ${total}</span>
      </div>
    `;
}

function renderWhatIf() {
    if (!whatIfState) return;

    renderConference("AFC", whatIfState.afc, {
        wc: "whatif-afc-wc",
        div: "whatif-afc-div",
        conf: "whatif-afc-conf"
    });

    renderConference("NFC", whatIfState.nfc, {
        wc: "whatif-nfc-wc",
        div: "whatif-nfc-div",
        conf: "whatif-nfc-conf"
    });

    renderSuperBowl();
    renderWhatIfScore();

    // ✅ NEW: recompute odds every time bracket changes
    renderWhatIfOdds();
}



/*********************************
 * INIT
 *********************************/

async function init() {
    try {
        const [
            draftRes,
            scheduleRes,
            playoffBonusRes,
            teamWinsRes,
            playoffSeedsRes,
            playoffBaselineRes
        ] = await Promise.all([
            fetch('draft.json'),
            fetch('schedule.json'),
            fetch('playoffBonus.json'),
            fetch('teamWins.json'),
            fetch('playoffSeeds.json')
        ]);

        draftData = await draftRes.json();
        scheduleData = await scheduleRes.json();
        playoffBonusData = await playoffBonusRes.json();
        teamWinsGrouped = await teamWinsRes.json();
        playoffSeeds = await playoffSeedsRes.json();

        // Flatten wins grouped into lookup
        const teamWinsLookup = {};
        Object.values(teamWinsGrouped).forEach(conference => {
            Object.values(conference).forEach(division => {
                division.forEach(team => {
                    teamWinsLookup[team.name] = team.wins;
                });
            });
        });

        // Apply wins to drafted teams
        (draftData.michael || []).forEach(team => {
            team.wins = teamWinsLookup[team.name] ?? 0;
        });

        (draftData.zach || []).forEach(team => {
            team.wins = teamWinsLookup[team.name] ?? 0;
        });

        updateTotalWins();
        updateCurrentWeekDisplay();
        updateTeamLists();
        updateKeyMatchups();

        initWhatIf();

        setTimeout(() => {
            const content = safeEl('content');
            if (content) content.classList.add('fade-in');
        }, 250);

    } catch (error) {
        console.error('Failed to load data:', error);
    }
}


/*********************************
 * NAV EVENTS
 *********************************/

window.addEventListener("DOMContentLoaded", () => {
    const wireNav = (navId, pageId) => {
        const el = safeEl(navId);
        if (!el) return;
        el.addEventListener("click", (e) => {
            e.preventDefault();
            showPage(pageId);
        });
    };

    wireNav('nav-home', 'home');
    wireNav('nav-teams', 'teams');
    wireNav('nav-history', 'history');
    wireNav('nav-whatif', 'whatif');

    document.querySelectorAll('.history-year').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const year = item.dataset.year;
            loadHistory(year);
        });
    });

    init();
});
