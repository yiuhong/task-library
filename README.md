# Project Trial

Gamified cognitive and behavioral tasks you can run in the browser.

Public hub: [https://yiuhong.github.io/task-library/](https://yiuhong.github.io/task-library/)

Project Trial is Yiu Hong Ko’s browser collection of attention, perception, and reaction-time tasks. The GitHub repository stays named `task-library`.

## Wordmark

Approved black-and-white lockup, outlined in `assets/`:

- [`assets/project-trial-wordmark.svg`](assets/project-trial-wordmark.svg) — pure black on transparent. This is the black-and-white mark for the personal site.
- [`assets/project-trial-wordmark-dark.svg`](assets/project-trial-wordmark-dark.svg) — white type and a cyan target on transparent. This is the mark on the dark hub.

“Project” is the thin sans, the same lettering as Project Viz. “Trial” is the bold pixel word, set with a clear weight contrast and a slight space between the words. The tittle on the i is a square reticle: a square frame, short ticks at the middle of each side, and a small center mark.

## Live on the hub

- **Stroop Dash** — [`stroop_game.html`](stroop_game.html). Selective attention and Stroop interference. Parameters: [`stroop-info.html`](stroop-info.html).
- **Oddball** — [`oddball_game.html`](oddball_game.html). Rare-target detection among frequent standards. Parameters: [`oddball-info.html`](oddball-info.html).
- **Brightness Detection** — [`brightness_game.html`](brightness_game.html). Luminance discrimination with confidence ratings. Parameters: [`brightness-info.html`](brightness-info.html).
- **Numerosity Comparison** — [`numerosity_game.html`](numerosity_game.html). Which of two brief dot arrays had more dots. Parameters: [`numerosity-info.html`](numerosity-info.html).

Hub overview: [`about.html`](about.html).

## Shared look

Demos that want the dark Trial look link [`assets/trial-theme.css`](assets/trial-theme.css). The file is CSS variables (color, type, pad size, HUD spacing) plus optional helpers such as `.trial-pad` and `.trial-hud`. A demo can ignore the helpers and draw its own stimulus chrome. Override any variable on the page. `noematachograph.html` and `vr.html` do not use this file.

[`assets/trial-orientation.js`](assets/trial-orientation.js) is a separate opt-in. It records `screen.orientation` (type and angle when the browser provides them) at the start of a run, on each turn, and at the end. It does not lock orientation. The hub games use it. `vr.html` still has its own CSV and `localStorage` backup without this log.

[`assets/trial-store.js`](assets/trial-store.js) is the local log for Stroop, Oddball, and Brightness. Those three save each run in `localStorage` (`project-trial:stroop`, `project-trial:oddball`, `project-trial:brightness`) and can download a CSV of the trial rows plus orientation start, turn, and end rows. Clear saved removes that key. Nothing is uploaded.

Numerosity Comparison keeps its own payload under `projectTrial_numerosity_v1` and downloads a CSV of the current run. A later finished run replaces that payload. It does not use `trial-store.js` or `trial-orientation.js`.

## Not on the hub yet

- [`noematachograph.html`](noematachograph.html) — an illustration of Franciscus Donders’ mental chronometry apparatus. It is not linked from the hub. The on-screen “reaction time” is a fixed trace, not a response you make.
- [`vr.html`](vr.html) — Orbital Energy Sorter, a WebXR spatial go/no-go scene with a local CSV download and a `localStorage` backup. It is not linked from the hub.
