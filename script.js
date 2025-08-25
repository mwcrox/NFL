let draftData = {};
let scheduleData = {};
let playoffBonusData = {};

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

    for (let i = 0; i < playoffs.length; i++) {
        const thisRound = playoffs[i];
        const nextRound = playoffs[i + 1];
        if (!nextRound || estNow < nextRound.start) {
            return thisRound.key;
        }
    }

    return "Super Bowl";
}

function updateTeamLists() {
    const michaelEl = document.getElementById('michael-teams');
    const zachEl = document.getElementById('zach-teams');

    michaelEl.innerHTML = '';
    zachEl.innerHTML = '';

    draftData.michael.forEach(team => {
        const div = document.createElement('div');
        div.className = 'card';
        div.textContent = `${team.name} — ${team.wins} wins`;
        michaelEl.appendChild(div);
    });

    draftData.zach.forEach(team => {
        const div = document.createElement('div');
        div.className = 'card';
        div.textContent = `${team.name} — ${team.wins} wins`;
        zachEl.appendChild(div);
    });
}

function updateKeyMatchups() {
    const currentWeek = getCurrentWeekKey();
    const matchups = scheduleData[currentWeek] || [];

    const michaelTeams = draftData.michael.map(t => t.name);
    const zachTeams = draftData.zach.map(t => t.name);

    const keyGames = matchups.filter(game => {
        const homeOwner = michaelTeams.includes(game.home) ? 'michael' : zachTeams.includes(game.home) ? 'zach' : null;
        const awayOwner = michaelTeams.includes(game.away) ? 'michael' : zachTeams.includes(game.away) ? 'zach' : null;
        return homeOwner && awayOwner && homeOwner !== awayOwner;
    });

    const matchupsEl = document.getElementById('matchups');
    if (keyGames.length === 0) {
        matchupsEl.innerHTML = `<div class="card">No key matchups this week.</div>`;
    } else {
        matchupsEl.innerHTML = keyGames
            .map(game => `<div class="card">${game.away} @ ${game.home}</div>`)
            .join('');
    }
}

function updateCurrentWeekDisplay() {
    const el = document.getElementById('current-week');
    el.textContent = `Current Week: ${getCurrentWeekKey()}`;
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');

    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.getElementById('nav-' + pageId).classList.add('active');
}

async function fetchLiveWins() {
    const apiKey = '123';  // Replace with your TheSportsDB API key
    const url = `https://www.thesportsdb.com/api/v1/json/${apiKey}/lookuptable.php?l=4391&s=2025`;

    try {
        const res = await fetch(url);
        const data = await res.json();

        const teamWinsLookup = {};
        if (data.table) {
            data.table.forEach(team => {
                teamWinsLookup[team.name] = parseInt(team.win, 10);
            });
        }

        return teamWinsLookup;
    } catch (err) {
        console.error('Failed to fetch live wins:', err);
        return {};
    }
}

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
    const michaelTotal = draftData.michael.reduce((sum, team) => {
        const winPoints = (team.wins || 0) * 2;
        const bonusPoints = getBonusPoints(team.name);
        return sum + winPoints + bonusPoints;
    }, 0);

    const zachTotal = draftData.zach.reduce((sum, team) => {
        const winPoints = (team.wins || 0) * 2;
        const bonusPoints = getBonusPoints(team.name);
        return sum + winPoints + bonusPoints;
    }, 0);

    const michaelLogo = `<img src="pictures/Michael.png" alt="Michael" class="team-logo">`;
    const zachLogo = `<img src="pictures/Zach.PNG" alt="Zach" class="team-logo">`;

    let displayHTML = '';
    if (michaelTotal >= zachTotal) {
        displayHTML = `${michaelLogo} ${michaelTotal} - ${zachTotal} ${zachLogo}`;
    } else {
        displayHTML = `${zachLogo} ${zachTotal} - ${michaelTotal} ${michaelLogo}`;
    }

    document.getElementById('total-wins').innerHTML = displayHTML;
}

// Render history from JSON
async function loadHistory(year) {
    try {
        const res = await fetch(`history/${year}.json`);
        const data = await res.json();

        const resultsEl = document.getElementById('history-results');
        resultsEl.innerHTML = '';

        // Final Score header
        const finalScoreDiv = document.createElement('div');
        finalScoreDiv.className = 'card final-score';
        finalScoreDiv.innerHTML = `
            <h3>${year} Final Score</h3>
            <p><strong>Michael:</strong> ${data.finalScore.Michael} — <strong>Zach:</strong> ${data.finalScore.Zach}</p>
            <p><em>First Pick: ${data.firstPick}</em></p>
        `;
        resultsEl.appendChild(finalScoreDiv);

        // Michael's Teams
        const michaelDiv = document.createElement('div');
        michaelDiv.className = 'team-column';
        michaelDiv.innerHTML = `<h4>Michael's Team</h4>`;
        data.teams.Michael.forEach((team, index) => {
            const div = document.createElement('div');
            div.className = 'card';
            div.textContent = `${index + 1}. ${team.team} — ${team.points} points`;
            michaelDiv.appendChild(div);
        });

        // Zach's Teams
        const zachDiv = document.createElement('div');
        zachDiv.className = 'team-column';
        zachDiv.innerHTML = `<h4>Zach's Team</h4>`;
        data.teams.Zach.forEach((team, index) => {
            const div = document.createElement('div');
            div.className = 'card';
            div.textContent = `${index + 1}. ${team.team} — ${team.points} points`;
            zachDiv.appendChild(div);
        });

        // Wrap both columns
        const container = document.createElement('div');
        container.className = 'teams-container';
        container.appendChild(michaelDiv);
        container.appendChild(zachDiv);
        resultsEl.appendChild(container);

    } catch (err) {
        console.error(`Failed to load history for ${year}:`, err);
    }
}

async function init() {
    try {
        const [draftRes, scheduleRes, playoffBonusRes] = await Promise.all([
            fetch('draft.json'),
            fetch('schedule.json'),
            fetch('playoffBonus.json')
        ]);

        draftData = await draftRes.json();
        scheduleData = await scheduleRes.json();
        playoffBonusData = await playoffBonusRes.json();

        const liveWins = await fetchLiveWins();

        draftData.michael.forEach(team => {
            team.wins = liveWins[team.name] ?? 0;
        });

        draftData.zach.forEach(team => {
            team.wins = liveWins[team.name] ?? 0;
        });

        updateTotalWins();
        updateCurrentWeekDisplay();
        updateTeamLists();
        updateKeyMatchups();

        setTimeout(() => {
            document.getElementById('content').classList.add('fade-in');
        }, 2500);

    } catch (error) {
        console.error('Failed to load data:', error);
    }
}

window.onload = () => {
    init();

    document.getElementById('nav-home').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('home');
    });

    document.getElementById('nav-teams').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('teams');
    });

    document.getElementById('nav-history').addEventListener('click', (e) => {
        e.preventDefault();
        showPage('history');
    });

    document.querySelectorAll('.history-year').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const year = e.target.dataset.year;
            loadHistory(year);
        });
    });
};
