async function loadTeams() {
    try {
        const draftRes = await fetch('draft.json');
        const draft = await draftRes.json();

        const wins = await fetchTeamWins();

        const michaelTeams = draft.michael.map(team => ({
            name: team.name,
            wins: wins[team.name] ?? 0
        }));

        const zachTeams = draft.zach.map(team => ({
            name: team.name,
            wins: wins[team.name] ?? 0
        }));

        renderTeams('michael-teams', michaelTeams);
        renderTeams('friend-teams', zachTeams);
    } catch (err) {
        console.error('Error loading teams or wins:', err);
    }
}

async function fetchTeamWins() {
    const res = await fetch('https://www.thesportsdb.com/api/v1/json/1/lookuptable.php?l=4391&s=2025');
    const data = await res.json();

    const teamWins = {};
    data.table.forEach(team => {
        teamWins[team.name] = parseInt(team.win, 10);
    });

    return teamWins;
}

function renderTeams(containerId, teams) {
    const html = teams
        .map(team => `<div class='card'>${team.name} (${team.wins} wins)</div>`)
        .join('');
    document.getElementById(containerId).innerHTML = html;
}

function showPage(page) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(page).style.display = 'block';
}

window.onload = function () {
    setTimeout(() => {
        document.getElementById('content').classList.remove('hidden');
        document.getElementById('content').classList.add('fade-in');
        loadTeams();
    }, 2500);
};
