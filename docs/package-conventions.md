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

Hub and task chrome should use a compiled Tailwind CSS 3.4 sheet, with a Trial theme. That sheet is not the Project Viz utilities sheet. Do not use the Tailwind Play CDN (`https://cdn.tailwindcss.com`) for new pages.

On main when this file was added, the hub (`index.html`) and these 10 task pages still load `https://cdn.tailwindcss.com`:

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

Replacing that CDN is a later, separate change.

## 3D / WebXR

A-Frame 1.8 is the one 3D/WebXR package (current stable as of 23 June 2026):

`https://aframe.io/releases/1.8.0/aframe.min.js`

Three.js comes only as A-Frame’s own pin. A-Frame 1.8 ships Three r184 / super-three 0.184.0. Do not add a separate Three.js pin, and do not use Project Viz’s r187 here.

On main when this file was added, Spatial Go/No-Go (`orbital_gonogo.html`) still loads A-Frame 1.6.0. Upgrading to 1.8 is a later, separate change that needs a headset smoke check. Other tasks do not load A-Frame or Three.js.

## Plot libraries

Do not add D3, Chart.js, KaTeX, jStat, MathJax, Plotly, Vega-Lite, or another plot library unless a task actually needs them. If that happens, record the exception in this file in the same change.

## Not a library pin

Noematachograph (`noematachograph.html`) loads Google Fonts (Cinzel and Crimson Text) and an Unsplash background. That is a page-local typographic choice, not a library pin for other tasks.
