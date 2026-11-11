# Project Trial

Gamified cognitive and behavioral tasks you can run in the browser.

Public hub: [https://yiuhong.github.io/task-library/](https://yiuhong.github.io/task-library/)

Project Trial is Yiu Hong Ko’s browser collection of attention, perception, and reaction-time tasks. The GitHub repository stays named `task-library`.

## Shells and task cores

Each hub task is a shell plus a task core. The shell is chrome: frame, theme, HUD, and the Gamified | Classical control on the welcome and results screens. The core is the science: parameters, trial loop, stimuli, keys, and feedback policy. Gamified and classical load the same `assets/tasks/<id>.js`, so the trial list is not copied into a second page.

The control stores the last choice in `localStorage` under `project-trial:mode`. With no stored choice, a task stays gamified unless the URL says `?mode=classical`. `?mode=gamified` and `?mode=classical` still open that shell and update the stored choice. The hub cards do not link a separate Classical entry. Classical runs on the mid-gray canvas, with no live score, accuracy, or mean RT. Practice feedback and a few task-specific exceptions are in [`assets/SHELL_CONTRACT.md`](assets/SHELL_CONTRACT.md). `noematachograph.html` and `orbital_gonogo.html` are not on the contract. `vr.html` redirects to `orbital_gonogo.html`.

## Wordmark

Approved black-and-white lockup, outlined in `assets/`:

- [`assets/project-trial-wordmark.svg`](assets/project-trial-wordmark.svg) — pure black on transparent. This is the black-and-white mark for the personal site.
- [`assets/project-trial-wordmark-dark.svg`](assets/project-trial-wordmark-dark.svg) — white type and a cyan target on transparent. This is the mark on the dark hub.

“Project” is the thin sans, the same lettering as Project Viz. “Trial” is the bold pixel word, set with a clear weight contrast and a slight space between the words. The tittle on the i is a square reticle: a square frame, short ticks at the middle of each side, and a small center mark.

## Live on the hub

- **Stroop Dash** — [`stroop_game.html`](stroop_game.html). Selective attention and Stroop interference. The in-task control switches shells (`?mode=classical` still opens the lab shell directly). Parameters: [`stroop-info.html`](stroop-info.html).
- **Oddball** — [`oddball_game.html`](oddball_game.html). Rare-target detection among frequent standards. Parameters: [`oddball-info.html`](oddball-info.html).
- **Brightness Detection** — [`brightness_game.html`](brightness_game.html). Luminance discrimination with confidence ratings. Parameters: [`brightness-info.html`](brightness-info.html).
- **Numerosity Comparison** — [`numerosity_game.html`](numerosity_game.html). Which of two brief dot arrays had more dots. Parameters: [`numerosity-info.html`](numerosity-info.html).
- **RDK Motion Coherence** — [`rdk_game.html`](rdk_game.html). Net direction of a moving dot cloud. Parameters: [`rdk-info.html`](rdk-info.html).
- **Eriksen Flanker** — [`flanker_game.html`](flanker_game.html). Center-arrow direction with congruent, incongruent, and neutral flankers. Parameters: [`flanker-info.html`](flanker-info.html).
- **Visual Working Memory** — [`vwm_game.html`](vwm_game.html). Color change detection at set sizes 4, 6, and 8. Parameters: [`vwm-info.html`](vwm-info.html).
- **Go / No-Go** — [`gonogo_game.html`](gonogo_game.html). Speeded response to a green arrow, withhold on a red X. Parameters: [`gonogo-info.html`](gonogo-info.html).
- **Spatial Go/No-Go** — [`orbital_gonogo.html`](orbital_gonogo.html). Frontal WebXR go/no-go with balanced near, mid, and far planes. The in-scene title is Orbital Energy Sorter. Phone, tablet, and desktop play without a headset. Parameters: [`orbital_gonogo-info.html`](orbital_gonogo-info.html). [`vr.html`](vr.html) redirects here.
- **Corsi Span** — [`corsi_game.html`](corsi_game.html). Tap a flashed block sequence back in order. Parameters: [`corsi-info.html`](corsi-info.html).
- **Reversal Learning** — [`bandit_game.html`](bandit_game.html). Two-armed bandit with a silent switch of the better option. Parameters: [`bandit-info.html`](bandit-info.html).

Hub overview: [`about.html`](about.html).

## Shared look

Demos that want the dark Trial look link [`assets/trial-theme.css`](assets/trial-theme.css). The file is CSS variables (color, type, pad size, HUD spacing) plus optional helpers such as `.trial-pad` and `.trial-hud`. A demo can ignore the helpers and draw its own stimulus chrome. Override any variable on the page. `noematachograph.html` and `orbital_gonogo.html` do not use this file. `vr.html` only redirects.

[`assets/trial-orientation.js`](assets/trial-orientation.js) is a separate opt-in. It records `screen.orientation` (type and angle when the browser provides them) at the start of a run, on each turn, and at the end. It does not lock orientation. The hub games use it. `orbital_gonogo.html` keeps its own CSV and one replacing `localStorage` payload without this log. `vr.html` redirects to that page.

[`assets/trial-store.js`](assets/trial-store.js) is the local log for Stroop, Oddball, and Brightness. Those three save each run in `localStorage` (`project-trial:stroop`, `project-trial:oddball`, `project-trial:brightness`) and can download a CSV of the trial rows plus orientation start, turn, and end rows. Clear saved removes that key. Nothing is uploaded. Each of those sessions stores a `mode` of `gamified` or `classical`, and that value is a column on each CSV row. Sessions saved before that field leave the cell blank. A classical Oddball download also adds `block` (`practice` or `main`). The gamified Oddball download, and both Brightness downloads, do not add `block`.

Numerosity Comparison, RDK Motion Coherence, Eriksen Flanker, Visual Working Memory, Go / No-Go, and Reversal Learning each keep one payload (`projectTrial_numerosity_v1`, `projectTrial_rdk_v1`, `projectTrial_flanker_v1`, `projectTrial_vwm_v1`, `projectTrial_gonogo_v1`, `projectTrial_bandit_v1`) and download a CSV of the current run. A later finished run replaces that payload. Corsi Span appends finished runs under `projectTrial_corsi_v1`. These tasks do not use `trial-store.js` or `trial-orientation.js`. Each payload and CSV now ends with `mode` (`gamified` or `classical`). Spatial Go/No-Go keeps one replacing payload under `projectTrial_orbital_gonogo_v1` and downloads a CSV of that run. It does not store `mode`. `vr.html` redirects to `orbital_gonogo.html`.

[`assets/trial-audio.js`](assets/trial-audio.js) plays the short Web Audio tones for tasks that already use sound. Mute is one `localStorage` key, `project-trial:sfx`, with values `on` and `off`. When that key is missing, sound is on. Opening or playing a task does not write the key. Noematachograph is the exception: with no stored choice it stays off, so Enable Audio is what a first visit shows, and the tuning fork does not start on its own. A stored `on` or `off` from any task, including Noematachograph, wins everywhere. Stroop Dash, Oddball, and Brightness Detection have no mute control of their own and follow the key. Spatial Go/No-Go (`SFX: ON` / `SFX: OFF` on [`orbital_gonogo.html`](orbital_gonogo.html)) writes the same key and stays audible when the key is missing. It does not use the Noematachograph first-visit off state. [`vr.html`](vr.html) only redirects. A classical shell does not call the tone player and does not write that key. Numerosity Comparison (`SFX: ON` / `SFX: OFF`), RDK Motion Coherence (`SFX ON` / `SFX OFF`), and Corsi Span (the setup `AUDIO CUES` select) keep those controls on the gamified shell and write the same key. The classical shell hides the control. The script tag has to come before the task script, without `defer`, `async`, or `type="module"`. Flanker, Go / No-Go, Visual Working Memory, and Reversal Learning stay silent in both shells.

## Not on the hub yet

- [`noematachograph.html`](noematachograph.html) — an illustration of Franciscus Donders’ mental chronometry apparatus. It is not linked from the hub. The on-screen “reaction time” is a fixed trace, not a response you make.
