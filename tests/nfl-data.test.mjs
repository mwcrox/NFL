import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { buildSnapshot, parseStandings, normalizeBoard, postseasonRequests, rejectRegression } from "../scripts/nfl-data.mjs";

const NOW = new Date("2026-11-01T16:00:00Z");
function fixture(finished = 16) {
    const names = Array.from({ length: 32 }, (_, i) => `Team ${i + 1}`);
    const standings = names.map((name, i) => ({ id: String(i + 1), name, conference: i < 16 ? "AFC" : "NFC", wins: 0, losses: 0, ties: 0, seed: i % 16 + 1, clincher: "" }));
    let rotating = [...names];
    const games = [];
    for (let week = 1; week <= 17; week++) {
        for (let i = 0; i < 16; i++) {
            const home = rotating[i], away = rotating[31 - i];
            const completed = games.length < finished;
            games.push({ id: `regular-${games.length}`, date: `2026-09-10T20:00:00Z`, phase: 2, week, round: 0, home, away, completed, state: completed ? "post" : "pre", detail: completed ? "Final" : "Scheduled", homeScore: 21, awayScore: 14, winner: completed ? home : null });
            if (completed) {
                standings.find(t => t.name === home).wins++;
                standings.find(t => t.name === away).losses++;
            }
        }
        rotating = [rotating[0], rotating.at(-1), ...rotating.slice(1, -1)];
    }
    return { season: 2026, standings, games, now: NOW };
}

test("standings reject a wrong season or incomplete league", () => {
    assert.throws(() => parseStandings({ season: { year: 2025 } }, 2026, []), /wrong season/);
    assert.throws(() => parseStandings({ season: { year: 2026 }, children: [] }, 2026, []), /Missing/);
});

test("the current top seven do not receive playoff points or become final seeds", () => {
    const result = buildSnapshot(fixture());
    assert.equal(result.playoffSeeds.ready, false);
    assert.equal(result.playoffSeeds.AFC[0].team, "AFC 1");
    assert.equal(result.playoffBonus.wildcard.length, 0);
    assert.equal(result.playoffBonus.divisional.length, 0);
});

test("an explicit clinch awards entry points, not a first-round bye", () => {
    const input = fixture();
    input.standings[0].clincher = "Clinched Division";
    input.standings[1].clincher = "Eliminated from Playoff Contention";
    const result = buildSnapshot(input);
    assert.deepEqual(result.playoffBonus.wildcard, ["Team 1"]);
    assert.equal(result.playoffBonus.divisional.length, 0);
});

test("regular-season ties award no win; scheduled games award no points", () => {
    const input = fixture(1), game = input.games[0];
    game.winner = null; game.awayScore = 21;
    input.standings.find(t => t.name === game.home).wins--;
    input.standings.find(t => t.name === game.away).losses--;
    for (const name of [game.home, game.away]) input.standings.find(t => t.name === name).ties++;
    const result = buildSnapshot(input);
    assert.equal(result.teamRecords.reduce((sum, t) => sum + t.wins, 0), 0);
    assert.equal(result.teamRecords.reduce((sum, t) => sum + t.ties, 0), 2);
    assert.equal(result.schedule["Week 1"].length, 16);
});

test("the calendar finds the Super Bowl after a Pro Bowl week", () => {
    const requests = postseasonRequests([{
        value: "3", entries: [
            { value: "1", label: "Wild Card" }, { value: "2", label: "Divisional Round" },
            { value: "3", label: "Conference Championship" }, { value: "4", label: "Pro Bowl" },
            { value: "5", label: "Super Bowl" }
        ]
    }]);
    assert.deepEqual(requests.map(r => r.week), [1, 2, 3, 5]);
});

test("normalization rejects mismatched phases and incomplete final scores", () => {
    assert.throws(() => normalizeBoard({ season: { year: 2026, type: 1 } }, { type: 2, week: 1 }, 2026, []), /wrong season or phase/);
    const board = { season: { year: 2026, type: 2 }, week: { number: 1 }, events: [{ id: "1", date: NOW.toISOString(), season: { year: 2026, type: 2 }, week: { number: 1 }, status: { type: { completed: true } }, competitions: [{ competitors: [{ homeAway: "home", team: { id: "1" } }, { homeAway: "away", team: { id: "2" } }] }] }] };
    assert.throws(() => normalizeBoard(board, { type: 2, week: 1 }, 2026, fixture().standings), /invalid scores/);
});

test("a full postseason awards all 14 entries, both byes, and 38 champion points", () => {
    const input = fixture(272);
    let id = 0;
    const add = (round, home, away) => input.games.push({ id: `post-${id++}`, date: "2027-02-14T23:00:00Z", phase: 3, week: round, round, home, away, completed: true, state: "post", homeScore: 30, awayScore: 20, winner: home });
    for (const start of [1, 17]) {
        const n = seed => `Team ${start + seed - 1}`;
        add(1, n(2), n(7)); add(1, n(3), n(6)); add(1, n(4), n(5));
        add(2, n(1), n(4)); add(2, n(2), n(3)); add(3, n(1), n(2));
    }
    add(4, "Team 1", "Team 17");
    const result = buildSnapshot(input), bonus = result.playoffBonus;
    assert.equal(result.playoffSeeds.ready, true);
    assert.equal(result.complete, true);
    assert.deepEqual([bonus.wildcard.length, bonus.divisional.length, bonus.championship.length, bonus.superbowl.length], [14, 8, 4, 2]);
    const points = ["wildcard", "divisional", "championship"].reduce((sum, key) => sum + (bonus[key].includes("Team 1") ? 7 : 0), 0) + (bonus.superbowl.includes("Team 1") ? 10 : 0) + (bonus.winner === "Team 1" ? 7 : 0);
    assert.equal(points, 38);
});

test("missing schedule coverage or previously final games cannot erase valid data", () => {
    const input = fixture(); input.games.pop();
    assert.throws(() => buildSnapshot(input), /272/);
    const old = buildSnapshot(fixture(16)), next = buildSnapshot(fixture(15));
    assert.throws(() => rejectRegression(old, next), /Previously final/);
});

function browserContext() {
    const nodes = new Map();
    const document = {
        hidden: false,
        getElementById(id) {
            if (!nodes.has(id)) nodes.set(id, { id, hidden: id === "whatif", innerHTML: "", textContent: "", setAttribute() { }, classList: { toggle() { } } });
            return nodes.get(id);
        },
        querySelectorAll() { return []; }, addEventListener() { }
    };
    const context = vm.createContext({ document, window: { location: { hash: "#home" }, addEventListener() { }, setTimeout() { } }, console, Intl, Date, AbortController, fetch: async () => { throw new Error("offline"); } });
    vm.runInContext(fs.readFileSync(new URL("../script.js", import.meta.url), "utf8"), context);
    const input = fixture(), snapshot = buildSnapshot(input);
    const draft = { michael: input.standings.slice(0, 16).map(t => ({ name: t.name })), zach: input.standings.slice(16).map(t => ({ name: t.name })) };
    vm.runInContext(`draftData=${JSON.stringify(draft)}; applySnapshot(${JSON.stringify(snapshot)}); appReady=true;`, context);
    return { context, snapshot, nodes };
}

test("weekly selection retains the whole week through Monday and rolls over Tuesday noon Eastern", () => {
    const { context } = browserContext();
    for (const [date, week] of [["2026-11-02T23:00:00-05:00", "Week 8"], ["2026-11-03T11:59:59-05:00", "Week 8"], ["2026-11-03T12:00:00-05:00", "Week 9"]]) {
        assert.equal(vm.runInContext(`getCurrentWeekKey(new Date("${date}"))`, context), week);
    }
});

test("background refresh preserves what-if picks and retains scores on a network failure", async () => {
    const { context, snapshot } = browserContext();
    vm.runInContext('whatIfState=freshWhatIfState(getSeedsForConference("AFC"),getSeedsForConference("NFC")); whatIfState.afc.wcWinners[0]="AFC 2";', context);
    const oldScore = vm.runInContext('calculateSeasonTotals().michaelTotal', context);
    const newer = structuredClone(snapshot); newer.updatedAt = "2026-11-01T16:30:00Z"; newer.teamRecords[0].wins++;
    context.fetch = async () => ({ ok: true, json: async () => newer });
    await vm.runInContext('refreshSeason()', context);
    assert.equal(vm.runInContext('whatIfState.afc.wcWinners[0]', context), "AFC 2");
    assert.equal(vm.runInContext('calculateSeasonTotals().michaelTotal', context), oldScore + 2);
    context.fetch = async () => { throw new Error("offline"); };
    await vm.runInContext('refreshSeason()', context);
    assert.equal(vm.runInContext('calculateSeasonTotals().michaelTotal', context), oldScore + 2);
    assert.equal(vm.runInContext('refreshFailed', context), true);
});

function playoffGame(round, home, away, winner = home) {
    return {
        id: `post-${round}-${home}`, date: "2027-02-14T23:00:00Z", phase: 3, week: round, round,
        home, away, completed: true, state: "post", homeScore: winner === home ? 30 : 20,
        awayScore: winner === away ? 30 : 20, winner
    };
}

function playoffContext(games = []) {
    const browser = browserContext(), input = fixture(272);
    input.games.push(...games);
    const snapshot = buildSnapshot(input);
    vm.runInContext(`applySnapshot(${JSON.stringify(snapshot)}); initWhatIf();`, browser.context);
    return { ...browser, input, snapshot };
}

test("new actual results override a wrong pick, clear later picks, and preserve the other conference", () => {
    const { context, input } = playoffContext();
    vm.runInContext('whatIfState.afc.wcWinners=["Team 7","Team 3","Team 4"]; whatIfState.afc.divWinners=["Team 1","Team 3"]; whatIfState.afc.confWinner="Team 1"; whatIfState.nfc.wcWinners[0]="Team 18"; whatIfState.superBowl.winner="Team 1";', context);
    input.games.push(playoffGame(1, "Team 2", "Team 7"));
    vm.runInContext(`applySnapshot(${JSON.stringify(buildSnapshot(input))}); whatIfState=reconcileWhatIfState();`, context);
    assert.equal(vm.runInContext('JSON.stringify(whatIfState.afc.wcWinners)', context), '["Team 2","Team 3","Team 4"]');
    assert.equal(vm.runInContext('JSON.stringify(whatIfState.afc.divWinners)', context), '[null,null]');
    assert.equal(vm.runInContext('whatIfState.afc.confWinner', context), null);
    assert.equal(vm.runInContext('whatIfState.superBowl.winner', context), null);
    assert.equal(vm.runInContext('whatIfState.nfc.wcWinners[0]', context), "Team 18");
});

test("a matching final result preserves valid later predictions", () => {
    const { context, input } = playoffContext();
    vm.runInContext('whatIfState.afc.wcWinners=["Team 2","Team 3","Team 4"]; whatIfState.afc.divWinners=["Team 1","Team 2"]; whatIfState.afc.confWinner="Team 2";', context);
    input.games.push(playoffGame(1, "Team 2", "Team 7"));
    vm.runInContext(`applySnapshot(${JSON.stringify(buildSnapshot(input))}); whatIfState=reconcileWhatIfState();`, context);
    assert.equal(vm.runInContext('whatIfState.afc.confWinner', context), "Team 2");
});

test("final games lock both buttons, resist changed picks, and survive reset", () => {
    const { context, nodes } = playoffContext([playoffGame(1, "Team 2", "Team 7")]);
    vm.runInContext('handleWhatIfPick({round:"wc",conf:"AFC",idx:"0",team:"Team 7"});', context);
    assert.equal(vm.runInContext('whatIfState.afc.wcWinners[0]', context), "Team 2");
    vm.runInContext('handleWhatIfPick({round:"wc",conf:"AFC",idx:"1",team:"Team 3"});', context);
    assert.equal(vm.runInContext('whatIfState.afc.wcWinners[1]', context), "Team 3");
    vm.runInContext('initWhatIf()', context);
    assert.equal(vm.runInContext('whatIfState.afc.wcWinners[0]', context), "Team 2");
    assert.equal(vm.runInContext('whatIfState.afc.wcWinners[1]', context), null);
    const markup = nodes.get("whatif-afc-wc").innerHTML;
    assert.match(markup, /disabled aria-pressed="true" aria-label="Team 2 — winner, result locked"/);
    assert.match(markup, /disabled aria-pressed="false" aria-label="Team 7 — eliminated, result locked"/);
    assert.match(markup, /Final · Result locked/);
    assert.equal(vm.runInContext('computeWinOddsFromState(whatIfState).total', context), 4096);
});

test("a complete real postseason fills all rounds and projected scores equal actual scores", () => {
    const games = [];
    for (const start of [1, 17]) {
        const n = seed => `Team ${start + seed - 1}`;
        for (const [round, a, b] of [[1, 2, 7], [1, 3, 6], [1, 4, 5], [2, 1, 4], [2, 2, 3], [3, 1, 2]])
            games.push(playoffGame(round, n(a), n(b)));
    }
    games.push(playoffGame(4, "Team 1", "Team 17"));
    const { context } = playoffContext(games);
    assert.equal(vm.runInContext('whatIfState.superBowl.winner', context), "Team 1");
    assert.equal(vm.runInContext('computeWinOddsFromState(whatIfState).total', context), 1);
    for (const owner of ["michael", "zach"]) {
        assert.equal(vm.runInContext(`computeWhatIfTotals(whatIfState).${owner}Total`, context),
            vm.runInContext(`calculateSeasonTotals().${owner}Total`, context));
    }
    vm.runInContext('handleWhatIfPick({round:"sb",team:"Team 17"}); initWhatIf();', context);
    assert.equal(vm.runInContext('whatIfState.superBowl.winner', context), "Team 1");
});

test("rosters keep draft order and all 32 team rows use the same records and totals", () => {
    const { context, nodes } = browserContext();
    const markup = nodes.get("all-teams-body").innerHTML;
    assert.equal((markup.match(/<tr>/g) || []).length, 32);
    assert.equal((markup.match(/class="team-logo"/g) || []).length, 32);
    const points = [...markup.matchAll(/class="points-cell">(\d+)</g)].reduce((sum, match) => sum + Number(match[1]), 0);
    assert.equal(points, vm.runInContext('calculateSeasonTotals().michaelTotal + calculateSeasonTotals().zachTotal', context));
    const roster = nodes.get("michael-teams").innerHTML;
    assert.ok(roster.indexOf('>Team 2</span>') < roster.indexOf('>Team 10</span>'));
    assert.match(roster, /1–0–0/);
});