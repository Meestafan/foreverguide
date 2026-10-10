# WoW: Forever Route Planner

A standalone WoW: Forever leveling route planner. It runs as a static site with no application build step.

## Features

- Drag-and-drop route builder with separate searchable dungeon and quest pools
- QuestieDB Forever quest names, levels, XP, faction restrictions, NPC/object starts and turn-ins, and available map coordinates
- Quest objective text and known objective locations where QuestieDB provides them
- Editable route dungeons, quests, XP, faction, prerequisites, and ordering
- Alliance and Horde quest filtering
- Dungeon prerequisites and cascading dependencies
- Drag-and-drop dungeon and quest ordering, including moving quests between dungeons
- Fractional starting levels or total XP input
- JSON route import and export
- RestedXP-compatible Forever guide ZIP export with quest tracking and Questie waypoint guidance
- Clickable dungeon and quest reference links

## RestedXP export

The **RestedXP export** button downloads a companion add-on ZIP containing the selected route, Questie-based quest steps and map arrows, a `.toc`, and an installation README. Close WoW, extract the included `Foreverguide_RestedXP` folder into the target game's `Interface/AddOns` folder, restart, enable **Foreverguide RestedXP Route**, then select the generated guide under **Foreverguide Custom Routes** in RestedXP.

The generated route uses the currently selected faction. Quest data comes from QuestieDB; objective locations and XP can be missing or stale, and each waypoint points to the first recorded spawn for that actor/objective. RestedXP is owned by RXP Media LLC; this project is independent and not affiliated with RestedXP. See [RestedXP](https://www.restedxp.com/) and [Questie](https://github.com/Questie/Questie).

## Quest catalog

`quest_catalog.json` is generated from the local QuestieDB Forever addon snapshot. With Node.js installed, regenerate it using:

```bash
npm run build:quest-catalog
```

The script defaults to `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\QuestieDB`. Pass an addon path and optional output path when your installation differs:

```bash
node scripts/build-questie-catalog.cjs "D:\Games\World of Warcraft\_classic_era_\Interface\AddOns\QuestieDB" quest_catalog.json
```

The catalog reflects the installed QuestieDB data snapshot; some quests do not have XP, coordinate, or objective-location data.

## Run locally

The app must be served over HTTP (opening `index.html` directly with `file://` blocks loading the JSON data files). From this directory, start any static server:

```bash
# Python 3
python -m http.server 8000

# or Node.js (no install needed beyond Node itself)
npx http-server -p 8000 -c-1
```

Then open <http://localhost:8000>. If the port is already in use, pick another (for example `8001`) and adjust the URL. Stop the server with `Ctrl+C`.

## Tests

```bash
npm install
npm test
```

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` deploys the repository root to GitHub Pages whenever a commit is pushed to `main`. In repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.