let draftData = {};
let scheduleData = {};

function getCurrentWeekKey() {
    const now = new Date();
    const utcNow = now.getTime() + now.getTimezoneOffset() * 60000;
    const mountainOffset = -7 * 60; // MT offset in minutes (adjust if needed)
    const mountainNow = new Date(utcNow + mountainOffset * 60000);

    // TESTING: Week 1 starts today at 10 AM MT
    const week1Start = new Date();
    week1Start.setHours(10, 0, 0, 0);
    const startTime = week1Start.getTime();

    const msPerWeek = 7 * 24 * 60 * 60 * 1000;
    const elapsed = mountainNow.getTime() - startTime;
    const weekNum = Math.floor(elapsed / msPerWeek) + 1;

    return `Week ${weekNum < 1 ? 1 : weekNum}`;
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
    console.log('Michael teams:', draftData.michael);
    console.log('Zach teams:', draftData.zach);
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

async function init() {
    try {
        const draftRes = await fetch('draft.json');
        draftData = await draftRes.json();

        const scheduleRes = await fetch('schedule.json');
        scheduleData = await scheduleRes.json();

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
};
