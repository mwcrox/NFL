import {
    SCOREBOARD,
    STANDINGS,
    ROUND_NAMES,
    parseStandings,
    normalizeBoard,
    postseasonRequests,
    buildSnapshot,
    rejectRegression
} from './nfl-data.mjs';

// Refresh every regular-season week with an unfinished game already due to
// start, plus the displayed week. This includes delayed games from older weeks.
export async function refreshLiveSnapshot(
    previous,
    weekKey,
    names,
    fetcher = fetch,
    now = new Date()
) {
    const get = async url => {
        const response = await fetcher(url, {
            cache: 'no-store',
            signal: AbortSignal.timeout(15000)
        });

        if (!response.ok) {
            throw new Error(`Live feed HTTP ${response.status}`);
        }

        return response.json();
    };

    const season = previous.season;

    const standings = parseStandings(
        await get(`${STANDINGS}?season=${season}&seasontype=2`),
        season,
        names
    );

    const weeks = new Set();

    if (/^Week \d+$/.test(weekKey)) {
        weeks.add(Number(weekKey.split(' ')[1]));
    }

    for (const game of Object.values(previous.schedule).flat()) {
        if (
            game.phase === 2 &&
            !game.completed &&
            Date.parse(game.date) <= now.getTime()
        ) {
            weeks.add(game.week);
        }
    }

    const requests = [...weeks].map(week => ({
        type: 2,
        week
    }));

    // Always refresh all postseason rounds so qualification, byes, seeds and
    // completed results remain consistent, including on the final regular week.
    const calendarBoard = await get(
        `${SCOREBOARD}?dates=${season}&seasontype=2&week=1&limit=1000`
    );

    requests.push(
        ...postseasonRequests(calendarBoard.leagues?.[0]?.calendar)
    );

    const schedule = { ...previous.schedule };

    await Promise.all(
        requests.map(async request => {
            const board = await get(
                `${SCOREBOARD}?dates=${season}&seasontype=${request.type}&week=${request.week}&limit=1000`
            );

            const games = normalizeBoard(
                board,
                request,
                season,
                standings
            );

            const key = request.type === 2
                ? `Week ${request.week}`
                : ROUND_NAMES[request.round - 1];

            schedule[key] = games;
        })
    );

    const next = buildSnapshot({
        season,
        standings,
        games: Object.values(schedule).flat(),
        now
    });

    rejectRegression(previous, next);

    return next;
}