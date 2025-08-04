const teamsData = {
    michael: [
        { name: '49ers', wins: 3, playoffs: false, superbowl: false },
        { name: 'Chiefs', wins: 2, playoffs: true, superbowl: true, sbWin: true },
    ],
    friend: [
        { name: 'Bills', wins: 2, playoffs: true },
        { name: 'Cowboys', wins: 4, playoffs: false },
    ],
};

const schedule = [
    { home: '49ers', away: 'Cowboys' },
    { home: 'Bills', away: 'Chiefs' },
    { home: 'Packers', away: 'Bears' },
];

function calculatePoints(team) {
    let points = team.wins * 2;
    if (team.superbowl) points += 10;
    else if (team.playoffs) points += 7;
    if (team.sbWin) points += 7;
    return points;
}

function updateScores() {
    const michaelPoints = teamsData.michael.reduce((sum, t) => sum + calculatePoints(t), 0);
    const friendPoints = teamsData.friend.reduce((sum, t) => sum + calculatePoints(t), 0);
    document.getElementById('scores').innerHTML = `Michael: ${michaelPoints} pts | Friend: ${friendPoints} pts`;
}

function updateMatchups() {
    const mTeams = teamsData.michael.map(t => t.name);
    const fTeams = teamsData.friend.map(t => t.name);
    const keyGames = schedule.filter(g =>
        (mTeams.includes(g.home) && fTeams.includes(g.away)) ||
        (fTeams.includes(g.home) && mTeams.includes(g.away))
    );
    document.getElementById('matchups').innerHTML = keyGames
        .map(g => `<div class='card'>${g.home} vs ${g.away}</div>`)
        .join('');
}

function updateTeamSection() {
    const renderTeam = (team) =>
        `<div class='card'>${team.name}: ${team.wins} wins / ${calculatePoints(team)} pts</div>`;
    document.getElementById('michael-teams').innerHTML = teamsData.michael.map(renderTeam).join('');
    document.getElementById('friend-teams').innerHTML = teamsData.friend.map(renderTeam).join('');
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
        updateScores();
        updateMatchups();
        updateTeamSection();
    }, 2500); // 2.5 seconds delay before content fades in
};
