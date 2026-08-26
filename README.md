# Michael vs. Zach NFL Fantasy Draft

A dependency-free fantasy football tracker for Michael and Zach’s annual draft. Each player drafts 16 NFL teams, earns points from regular-season wins and playoff advancement, and follows the weekly games where the two rosters meet.

## Features

- Live season score calculated from `teamWins.json` and `playoff/playoffBonus.json`
- Weekly cross-roster matchups from the 2026 schedule
- Both 16-team rosters shown in draft order
- Draft history for 2022–2025
- Optional playoff “What if?” simulator with outcome odds
- Responsive layouts, keyboard-accessible controls, visible focus states, reduced-motion support, and user-facing loading/error states

## Scoring

- **+2 points** for each regular-season win
- **+7 points** for reaching the playoffs
- **+7 points** for reaching the divisional round
- **+7 points** for reaching the conference championship
- **+10 points** for winning a conference championship
- **+7 points** for winning the Super Bowl

## Run locally

The app loads JSON with `fetch()`, so it must be served over HTTP rather than opened directly from the file system.

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Project structure

```text
.
├── index.html
├── style.css
├── script.js
├── draft.json
├── schedule.json
├── teamWins.json
├── History/
│   ├── 2022.json
│   ├── 2023.json
│   ├── 2024.json
│   └── 2025.json
├── playoff/
│   ├── playoffBonus.json
│   └── playoffSeeds.json
└── pictures/
    ├── Background3.0.webp
    ├── Michael.webp
    └── Zach.webp
```

## Updating the season

1. Keep team names identical across `draft.json`, `schedule.json`, `teamWins.json`, and playoff files.
2. Update each team’s wins in `teamWins.json`.
3. Update playoff advancement in `playoff/playoffBonus.json`.
4. Set `SHOW_WHATIF_TAB` in `script.js` to `true` when playoff seeds are complete.

The original full-resolution PNG artwork can remain in `pictures/` as source files. The optimized WebP versions are used by the website for faster loading.