# WoW: Forever Dungeon Leveling Route Planner

A standalone dungeon leveling route planner for WoW: Forever. It runs as a static site with no application build step.

## Features

- Editable dungeon and quest pools with monster XP
- Alliance and Horde quest filtering
- Dungeon prerequisites and cascading dependencies
- Drag-and-drop dungeon and quest ordering, including moving quests between dungeons
- Fractional starting levels or total XP input
- JSON pool import and export, plus shareable route links
- Clickable dungeon and quest reference links

## Run locally

Serve this directory with any static HTTP server, then open its root `index.html`. For example, with Python:

```bash
python -m http.server 8000
```

Open <http://localhost:8000>.

## Tests

```bash
npm install
npm test
```

## GitHub Pages deployment

The workflow in `.github/workflows/pages.yml` deploys the repository root to GitHub Pages whenever a commit is pushed to `main`. In repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.