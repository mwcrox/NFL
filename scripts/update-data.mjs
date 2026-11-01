import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEASON, SCOREBOARD, STANDINGS, parseStandings, postseasonRequests, normalizeBoard, buildSnapshot, rejectRegression } from "./nfl-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function fetchJSON(url) {
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } });
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
            return await response.json();
        } catch (caught) {
            error = caught;
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw error;
}

export async function collectSeason(season, names, now = new Date()) {
    const boardURL = request => `${SCOREBOARD}?dates=${season}&seasontype=${request.type}&week=${request.week}&limit=1000`;
    const firstRequest = { type: 2, week: 1 };
    const [rawStandings, firstBoard] = await Promise.all([
        fetchJSON(`${STANDINGS}?season=${season}&seasontype=2`), fetchJSON(boardURL(firstRequest))
    ]);
    const standings = parseStandings(rawStandings, season, names);
    const games = normalizeBoard(firstBoard, firstRequest, season, standings);
    const requests = [
        ...Array.from({ length: 17 }, (_, i) => ({ type: 2, week: i + 2 })),
        ...postseasonRequests(firstBoard.leagues?.[0]?.calendar)
    ];
    let index = 0;
    const batches = [];
    await Promise.all(Array.from({ length: 4 }, async () => {
        while (index < requests.length) {
            const i = index++;
            const request = requests[i];
            batches[i] = normalizeBoard(await fetchJSON(boardURL(request)), request, season, standings);
        }
    }));
    return buildSnapshot({ season, standings, games: [...games, ...batches.flat()], now });
}

async function main() {
    const draft = JSON.parse(await fs.readFile(path.join(root, "draft.json"), "utf8"));
    const names = [...draft.michael, ...draft.zach].map(team => team.name);
    if (names.length !== 32 || new Set(names).size !== 32) throw new Error("The draft must contain all 32 NFL teams exactly once.");
    const snapshot = await collectSeason(SEASON, names);
    const destination = path.join(root, "data/season.json");
    let previous;
    try { previous = JSON.parse(await fs.readFile(destination, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    rejectRegression(previous, snapshot);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination + ".tmp", JSON.stringify(snapshot, null, 2) + "\n");
    await fs.rename(destination + ".tmp", destination);
    console.log(`${SEASON}: refreshed ${snapshot.completedRegularGames} completed regular-season games; ${snapshot.playoffBonus.wildcard.length} playoff qualifiers. Bracket ${snapshot.playoffSeeds.ready ? "ready" : "waiting for final seeds"}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
