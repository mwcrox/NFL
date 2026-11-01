export const SEASON = 2026;
export const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
export const STANDINGS = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
export const ROUND_NAMES = ["Wild Card Round", "Divisional Round", "Conference Championship", "Super Bowl"];

function requireValue(condition, message) {
    if (!condition) throw new Error(message);
}

export function parseStandings(raw, season, names) {
    requireValue(Number(raw.season?.year) === season, "Standings returned the wrong season.");
    const conferences = raw.children?.filter(c => ["AFC", "NFC"].includes(c.abbreviation)) || [];
    requireValue(conferences.length === 2, "Missing AFC/NFC standings.");
    const records = conferences.flatMap(conference => {
        const entries = conference.standings?.entries || [];
        requireValue(entries.length === 16, `Incomplete ${conference.abbreviation} standings.`);
        return entries.map(entry => {
            const stats = Object.fromEntries((entry.stats || []).map(stat => [stat.name, stat]));
            const record = {
                id: String(entry.team.id), name: entry.team.displayName,
                conference: conference.abbreviation,
                wins: Number(stats.wins?.value), losses: Number(stats.losses?.value),
                ties: Number(stats.ties?.value), seed: Number(stats.playoffSeed?.value),
                clincher: stats.clincher?.description || ""
            };
            requireValue(names.includes(record.name), `Unrecognized team: ${record.name}`);
            requireValue([record.wins, record.losses, record.ties].every(n => Number.isInteger(n) && n >= 0), "Invalid team record.");
            requireValue(record.wins + record.losses + record.ties <= 17, "Invalid regular-season record.");
            return record;
        });
    });
    requireValue(new Set(records.map(t => t.name)).size === 32 && new Set(records.map(t => t.id)).size === 32, "Duplicate standings teams.");
    return records;
}

export function postseasonRequests(calendar) {
    const entries = calendar?.find(section => Number(section.value) === 3)?.entries || [];
    const names = [/wild.?card/i, /divisional/i, /conference.*championship/i, /super bowl/i];
    return names.map((pattern, index) => {
        const entry = entries.find(item => pattern.test(item.label));
        requireValue(entry && Number.isInteger(Number(entry.value)), `Missing ${ROUND_NAMES[index]} calendar entry.`);
        return { type: 3, week: Number(entry.value), round: index + 1 };
    });
}

export function normalizeBoard(raw, request, season, teams) {
    requireValue(Number(raw.season?.year) === season && Number(raw.season?.type) === request.type, "Scoreboard returned the wrong season or phase.");
    requireValue(Number(raw.week?.number) === request.week, "Scoreboard returned the wrong week.");
    requireValue(Array.isArray(raw.events) && raw.events.length < 1000, "Missing or truncated scoreboard.");
    const byId = new Map(teams.map(team => [team.id, team.name]));
    return raw.events.map(event => {
        requireValue(Number(event.season?.year) === season && Number(event.season?.type) === request.type, "Event belongs to another season.");
        requireValue(Number(event.week?.number) === request.week, "Event belongs to another week.");
        const competition = event.competitions?.[0];
        const competitors = competition?.competitors || [];
        const home = competitors.find(team => team.homeAway === "home");
        const away = competitors.find(team => team.homeAway === "away");
        const status = competition?.status?.type || event.status?.type;
        requireValue(status && typeof status.completed === "boolean", "Game status is missing.");
        const homeName = byId.get(String(home?.team?.id)) || null;
        const awayName = byId.get(String(away?.team?.id)) || null;
        const headline = (competition?.notes || []).map(note => note.headline || "").join(" ");
        requireValue(!/pro bowl|all.star/i.test(headline), "Unexpected exhibition game in playoff calendar.");
        if (request.type === 2 || status.completed) {
            requireValue(homeName && awayName && homeName !== awayName, "Game is missing recognized NFL teams.");
        }
        const score = competitor => {
            const value = competitor?.score?.value ?? competitor?.score;
            return value === undefined || value === "" ? null : Number(value);
        };
        const homeScore = score(home), awayScore = score(away);
        if (status.completed) {
            requireValue([homeScore, awayScore].every(n => Number.isInteger(n) && n >= 0), "Final game has invalid scores.");
            requireValue(request.type !== 3 || homeScore !== awayScore, "A playoff game cannot finish tied.");
        }
        requireValue(event.id && Number.isFinite(Date.parse(event.date)), "Invalid game identifier/date.");
        return {
            id: String(event.id), date: event.date, phase: request.type,
            week: request.week, round: request.round || 0,
            home: homeName, away: awayName,
            completed: status.completed, state: status.state,
            detail: status.shortDetail || status.description || "Scheduled",
            homeScore, awayScore,
            winner: !status.completed || homeScore === awayScore ? null : homeScore > awayScore ? homeName : awayName
        };
    });
}

export function buildSnapshot({ season, standings, games, now = new Date() }) {
    requireValue(new Set(games.map(game => game.id)).size === games.length, "Duplicate games in schedule.");
    const regular = games.filter(game => game.phase === 2);
    requireValue(regular.length === 272, `Expected 272 regular-season games; received ${regular.length}.`);
    const records = standings.map(team => {
        const scheduled = regular.filter(game => game.home === team.name || game.away === team.name);
        requireValue(scheduled.length === 17, `Incomplete schedule for ${team.name}.`);
        const finished = scheduled.filter(game => game.completed);
        const wins = finished.filter(game => game.winner === team.name).length;
        const ties = finished.filter(game => game.winner === null).length;
        const losses = finished.length - wins - ties;
        // A game may finish a little before the standings refresh.
        requireValue(Math.abs(wins - team.wins) <= 1 && Math.abs(losses - team.losses) <= 1, `Schedule/standings disagree for ${team.name}.`);
        return { id: team.id, name: team.name, conference: team.conference, wins, losses, ties };
    });
    const finished = regular.filter(game => game.completed).length;
    requireValue(now < new Date(`${season}-10-01T00:00:00Z`) || finished > 0, "No completed games returned after the season began.");
    const regularComplete = finished === 272;
    const standingsComplete = standings.every(team => team.wins + team.losses + team.ties === 17);
    const playoffSeeds = { season, ready: regularComplete && standingsComplete };
    for (const conference of ["AFC", "NFC"]) {
        if (playoffSeeds.ready) {
            const qualifiers = standings.filter(team => team.conference === conference && team.seed >= 1 && team.seed <= 7).sort((a, b) => a.seed - b.seed);
            requireValue(qualifiers.length === 7 && qualifiers.every((team, i) => team.seed === i + 1), `Invalid final ${conference} seeds.`);
            playoffSeeds[conference] = qualifiers.map(team => ({ seed: team.seed, team: team.name }));
        } else {
            playoffSeeds[conference] = Array.from({ length: 7 }, (_, i) => ({ seed: i + 1, team: `${conference} ${i + 1}` }));
        }
    }

    const bonus = { wildcard: new Set(), divisional: new Set(), championship: new Set(), superbowl: new Set(), winner: null };
    for (const team of standings) {
        if (/clinched.*(?:playoff|wild.?card|division|conference|home.field)/i.test(team.clincher)) bonus.wildcard.add(team.name);
        if (/clinched.*(?:home.field|first.round bye|(?:number|no\.) ?1 seed)/i.test(team.clincher)) bonus.divisional.add(team.name);
    }
    if (playoffSeeds.ready) {
        for (const conference of ["AFC", "NFC"]) {
            for (const team of playoffSeeds[conference]) bonus.wildcard.add(team.team);
            bonus.divisional.add(playoffSeeds[conference][0].team);
        }
    }
    const stages = ["wildcard", "divisional", "championship", "superbowl"];
    const post = games.filter(game => game.phase === 3);
    for (const game of post) {
        const stage = stages[game.round - 1];
        requireValue(stage, "Unrecognized playoff round.");
        for (const team of [game.home, game.away].filter(Boolean)) bonus[stage].add(team);
        if (game.winner) {
            if (game.round === 4) bonus.winner = game.winner;
            else bonus[stages[game.round]].add(game.winner);
        }
    }
    // A team in a later round also qualified for each earlier round.
    for (let i = 3; i > 0; i--) for (const team of bonus[stages[i]]) bonus[stages[i - 1]].add(team);
    for (const [index, limit] of [14, 8, 4, 2].entries()) requireValue(bonus[stages[index]].size <= limit, "Contradictory playoff advancement data.");
    if (bonus.winner) {
        requireValue(regularComplete && post.filter(game => game.completed).length === 13, "Incomplete finished season.");
        requireValue([14, 8, 4, 2].every((count, index) => bonus[stages[index]].size === count), "Incomplete postseason bonuses.");
    }
    const playoffBonus = Object.fromEntries(stages.map(stage => [stage, [...bonus[stage]].sort()]));
    playoffBonus.winner = bonus.winner;
    const schedule = Object.fromEntries([
        ...Array.from({ length: 18 }, (_, i) => `Week ${i + 1}`), ...ROUND_NAMES
    ].map(key => [key, []]));
    for (const game of games) {
        const key = game.phase === 2 ? `Week ${game.week}` : ROUND_NAMES[game.round - 1];
        schedule[key].push(game);
    }
    for (const week of Object.values(schedule)) week.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id));
    return {
        schemaVersion: 1, season, updatedAt: now.toISOString(), source: "ESPN",
        regularComplete, completedRegularGames: finished,
        complete: Boolean(bonus.winner), teamRecords: records, schedule, playoffBonus, playoffSeeds
    };
}

export function rejectRegression(previous, next) {
    if (!previous || previous.season !== next.season) return;
    const games = new Map(Object.values(next.schedule).flat().map(game => [game.id, game]));
    for (const game of Object.values(previous.schedule).flat()) {
        requireValue(!game.completed || games.get(game.id)?.completed, `Previously final game ${game.id} disappeared. Keeping the last valid snapshot.`);
    }
    requireValue(!previous.playoffSeeds.ready || next.playoffSeeds.ready, "Final playoff seeds disappeared.");
}
