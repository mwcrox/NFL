# Michael vs. Zach NFL Fantasy Draft

A static GitHub Pages website for the 2026 NFL season, with automatic scores, weekly head-to-head games, draft history, and the playoff what-if bracket.

## One-time setup

1. Copy all files from this updated project into your NFL repository, including `.github/workflows/update-and-deploy.yml`. Keep the folder names and capitalization.
2. On GitHub, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. Commit and push the files to `main` from VS Code.
4. Open **Actions → Update NFL scores and deploy**. The push starts a run; you can also choose **Run workflow**. Wait for it to succeed.
5. Remove any older deployment workflow that would independently publish a different copy of this same site. This archive contains one complete update-and-deploy workflow.

No API key, paid sports-data service, local server, or npm installation is required for normal hosted operation. The workflow uses the repository's built-in GitHub token. It needs permission to write the generated snapshot and publish Pages; organization policies or protected branches can require repository-specific adjustments.

## Automatic updates

The GitHub Actions workflow is scheduled at minutes 13 and 43 of every hour. It fetches ESPN's regular-season games, standings, and playoff schedule, validates them, writes `data/season.json`, and deploys the updated site. GitHub schedules can be delayed; this is periodic updating, not a real-time feed.

An open browser checks the saved snapshot every five minutes and when you return to the tab. It checks for a week change every minute. The page shows when the scores were last updated. Failed fetches preserve the last valid scores and existing what-if picks.

GitHub can disable scheduled workflows in public repositories after 60 days without repository activity. If updates stop, check the Actions tab and re-enable/run the workflow if needed. The ESPN endpoints are external dependencies; feed changes can require maintenance.

## On the field

The site displays **every game between Michael's and Zach's teams for the selected week**, including games already completed. There is no six-game limit. Games where both teams belong to the same owner are excluded, matching the original site.

The original 2026 regular-season week cutoffs are retained: Tuesday at noon Eastern. The entire week stays displayed through Monday night. The site then switches to the next week automatically, including in an open visible tab. Postseason round dates are also retained from the original 2026 site.

The schedule, kickoff times, game scores, and results now come from the feed. Final games stay displayed until the next weekly cutoff. Scores shown during games reflect the latest saved snapshot.

## Scoring and playoff automation

- 2 points per completed regular-season win; ties earn no win points.
- 7 points for reaching the playoffs.
- 7 points for reaching the divisional round, including the No. 1 seeds' byes.
- 7 points for reaching the conference championship.
- 10 points for winning the conference championship.
- 7 points for winning the Super Bowl.

A Super Bowl champion receives 38 postseason points plus regular-season points. Preseason and Pro Bowl games are excluded.

Playoff entry points use explicit clinches and actual playoff participants. A team's current place in the standings alone does not award a playoff bonus. Advancement points use actual participants/results. The what-if field fills automatically once the regular season is complete and the final seeds are available. Until then, clearly labeled seed placeholders let you try the bracket.

The simulator preserves wild-card matchups, byes, divisional reseeding, conference championships, and the Super Bowl. Changing an earlier pick clears affected later picks. Completed playoff games automatically select the real winner, show the final score, and lock both choices. Reset my picks clears only predictions for games that have not finished. New actual results override conflicting predictions and clear affected later picks; compatible predictions remain. Reloading the page rebuilds every lock from the saved season data. All possible remaining scenarios are weighted equally, assuming 50/50 games; percentages are not predictions of team strength.

## Team logos and totals

The Teams page keeps each roster in draft order and displays team logos, regular-season win–loss–tie records, and fantasy point totals. Expand **All 32 NFL teams & total points** below the rosters for an alphabetical table with each team’s owner, record, and points. The same calculation powers roster points, the table, and the scoreboard.

Team logos also appear in On the field and the playoff bracket. The 32 PNG files in `pictures/teams/` are bundled with the site; they do not need an external image request. They were downloaded from the logo URLs supplied by ESPN’s team metadata. An abbreviation appears if a logo cannot load. Keep this folder and the updated workflow so the logos are deployed.

## Files to keep

- `index.html`, `style.css`, `script.js`: the website and automatic browser refresh.
- `draft.json`: the rosters in draft order. This remains the file you edit after a draft.
- `data/season.json`: automatically generated season snapshot. Keep it; do not manually maintain it.
- `scripts/nfl-data.mjs`: season configuration, feed validation, scoring, playoff qualification, and seeds.
- `scripts/update-data.mjs`: fetches the data and safely writes the snapshot.
- `.github/workflows/update-and-deploy.yml`: schedules the update and publishes GitHub Pages.
- `package.json`: update/test commands used by GitHub Actions.
- `tests/nfl-data.test.mjs`: checks scoring, feed validation, weekly cutoffs, and browser-refresh behavior, completed-game locks, and team totals.
- `History/2022.json` through `History/2025.json`: existing historical drafts/results.
- `pictures/Michael.webp` and `pictures/Zach.webp`: owner artwork.
- `pictures/teams/*.png`: all 32 NFL team logos, named by ESPN team ID.

## Old files you may delete

The automatic version does not read these files, and they are omitted from the updated ZIP:

- `teamWins.json`
- `schedule.json`
- `playoff/playoffBonus.json`
- `playoff/playoffSeeds.json`
- `pictures/Background3.0.webp`

If the `playoff` folder contains only those two JSON files, the whole folder can be removed. Leaving these old files in the repository is harmless, but editing them will no longer affect the website. `README.md` is optional documentation.

## Local development

Use Node 22 or newer (GitHub Actions uses Node 24). No npm packages need to be installed.

```bash
npm test
npm run update
python3 -m http.server 8000
```

Open `http://localhost:8000`. Use a web server because the site loads JSON with `fetch()`.

The updater currently tracks only **2026**, matching the existing NFL site. A future season requires updating the season configuration, displayed labels, weekly date cutoffs, and draft. It will not silently switch your draft to another year.