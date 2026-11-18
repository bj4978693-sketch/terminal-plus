# Contributing

1. Fork and clone the repo.
2. `npm install`, then `npm start` to run from source.
3. Make your change. Keep the style of the surrounding code (plain JS, no bundler).
4. Check it runs: `TP_SHOT=out.png npm start` opens the app, saves a screenshot and quits.
5. Open a pull request describing what changed and why.

Layout:
- `main.js` — window, shells (node-pty / ConPTY), shell integration, settings, Windows integration
- `preload.js` — the only bridge between the UI and Node
- `src/renderer.js` — all UI logic; `src/icons.js`, `src/themes.js`, `src/style.css`

Bug reports and feature ideas: use the issue templates.
