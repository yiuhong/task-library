# Package conventions

Project Trial’s package set is intentionally smaller and more task-oriented than Project Viz. Do not copy the Viz plotting stack (D3, Chart.js, KaTeX, jStat, or a separate Three.js pin) into this repo.

New tasks must follow this file. English remains the canonical copy.

## Default for 2D

First-party canvas and the shared shells are the default for 2D tasks:

- shells in `assets/shells`
- the shared theme in `assets/trial-theme.css`
- task cores under `assets/tasks`

No bundler. Load code with plain script tags, consistent with [`assets/SHELL_CONTRACT.md`](../assets/SHELL_CONTRACT.md).

## Tailwind

Hub and task chrome load a compiled Tailwind CSS 3.4 sheet with a Trial theme:

[`assets/tailwind.css`](../assets/tailwind.css)

That sheet is not the Project Viz utilities sheet. Do not use the Tailwind Play CDN (`https://cdn.tailwindcss.com`), and do not add a live `tailwind.config` script.

The hub and these task pages load the compiled sheet (plus the Trial theme and shell CSS they already used):

- `index.html`
- `stroop_game.html`
- `oddball_game.html`
- `gonogo_game.html`
- `flanker_game.html`
- `brightness_game.html`
- `corsi_game.html`
- `vwm_game.html`
- `bandit_game.html`
- `rdk_game.html`
- `numerosity_game.html`

Info pages, `about.html`, `vr.html`, `noematachograph.html`, and `orbital_gonogo.html` do not load Tailwind.

Rebuild the sheet with the Tailwind CLI 3.4.17 from `assets/tailwind/input.css` and `tailwind.config.js`:

`npm run build:css`

The config scans the hub, the `*_game.html` pages, and the task and shell scripts. Commit the rebuilt `assets/tailwind.css` in the same change that adds a utility class. Flanker accent colors stay CSS variables owned by `assets/tasks/flanker.css`. Corsi sets `--trial-tw-mono` so `font-mono` stays JetBrains Mono.

## 3D / WebXR

A-Frame 1.8 is the one 3D/WebXR package (current stable as of 23 June 2026):

`https://aframe.io/releases/1.8.0/aframe.min.js`

Three.js comes only as A-Frame’s own pin. A-Frame 1.8 ships Three r184 / super-three 0.184.0. Do not add a separate Three.js pin, and do not use Project Viz’s r187 here.

Spatial Go/No-Go (`orbital_gonogo.html`) loads that URL. `vr.html` only redirects there. Other pages do not load A-Frame or Three.js.

## Plot libraries

Do not add D3, Chart.js, KaTeX, jStat, MathJax, Plotly, Vega-Lite, or another plot library unless a task actually needs them. If that happens, record the exception in this file in the same change.

## Not a library pin

Noematachograph (`noematachograph.html`) loads Google Fonts (Cinzel and Crimson Text) and an Unsplash background. That is a page-local typographic choice, not a library pin for other tasks.
