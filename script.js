async function loadTeams() {
    try {
        const res = await fetch('draft.json');
        const draft = await res.json();

        renderTeams('michael-teams', draft.michael);
        renderTeams('friend-teams', draft.zach);
    } catch (err) {
        console.error('Failed to load draft data:', err);
    }
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
        const content = document.getElementById('content');
        content.classList.remove('hidden');
        content.classList.add('fade-in');
        loadTeams();
    }, 2500);
};
