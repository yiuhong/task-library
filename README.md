# Project Trial

Gamified cognitive and behavioral tasks you can run in the browser.

Public hub: [https://yiuhong.github.io/task-library/](https://yiuhong.github.io/task-library/)

Project Trial is Yiu Hong Ko’s browser collection of attention, perception, and reaction-time tasks. The GitHub repository stays named `task-library`.

## Shells and task cores

Stroop is the pilot for a shell plus task-core split. The shell is chrome: frame, theme, HUD. The core is the science: parameters, trial loop, stimuli, keys, and feedback policy. Gamified and classical Stroop load `assets/tasks/stroop.js`, so the trial list is not copied into a second page.

Open classical Stroop at [`stroop_game.html?mode=classical`](stroop_game.html?mode=classical). `mode=classical` is the only switch. A missing or unknown `mode` stays gamified, and [`stroop_game.html`](stroop_game.html) is still Stroop Dash. The contract is [`assets/SHELL_CONTRACT.md`](assets/SHELL_CONTRACT.md). Other tasks are not on it yet.

## Wordmark

Approved black-and-white lockup, outlined in `assets/`:

- [`assets/project-trial-wordmark.svg`](assets/project-trial-wordmark.svg) — pure black on transparent. This is the black-and-white mark for the personal site.
- [`assets/project-trial-wordmark-dark.svg`](assets/project-trial-wordmark-dark.svg) — white type and a cyan target on transparent. This is the mark on the dark hub.

“Project” is the thin sans, the same lettering as Project Viz. “Trial” is the bold pixel word, set with a clear weight contrast and a slight space between the words. The tittle on the i is a square reticle: a square frame, short ticks at the middle of each side, and a small center mark.

## Live on the hub

- **Stroop Dash** — [`stroop_game.html`](stroop_game.html). Selective attention and Stroop interference. Classical shell, same core: [`stroop_game.html?mode=classical`](stroop_game.html?mode=classical). Parameters: [`stroop-info.html`](stroop-info.html).
- **Oddball** — [`oddball_game.html`](oddball_game.html). Rare-target detection among frequent standards. Parameters: [`oddball-info.html`](oddball-info.html).
- **Brightness Detection** — [`brightness_game.html`](brightness_game.html). Luminance discrimination with confidence ratings. Parameters: [`brightness-info.html`](brightness-info.html).
- **Numerosity Comparison** — [`numerosity_game.html`](numerosity_game.html). Which of two brief dot arrays had more dots. Parameters: [`numerosity-info.html`](numerosity-info.html).
- **RDK Motion Coherence** — [`rdk_game.html`](rdk_game.html). Net direction of a moving dot cloud. Parameters: [`rdk-info.html`](rdk-info.html).
- **Eriksen Flanker** — [`flanker_game.html`](flanker_game.html). Center-arrow direction with congruent, incongruent, and neutral flankers. Parameters: [`flanker-info.html`](flanker-info.html).
- **Visual Working Memory** — [`vwm_game.html`](vwm_game.html). Color change detection at set sizes 4, 6, and 8. Parameters: [`vwm-info.html`](vwm-info.html).
- **Go / No-Go** — [`gonogo_game.html`](gonogo_game.html). Speeded response to a green arrow, withhold on a red X. Parameters: [`gonogo-info.html`](gonogo-info.html).
- **Corsi Span** — [`corsi_game.html`](corsi_game.html). Tap a flashed block sequence back in order. Parameters: [`corsi-info.html`](corsi-info.html).
- **Reversal Learning** — [`bandit_game.html`](bandit_game.html). Two-armed bandit with a silent switch of the better option. Parameters: [`bandit-info.html`](bandit-info.html).

Hub overview: [`about.html`](about.html).

## Shared look

Demos that want the dark Trial look link [`assets/trial-theme.css`](assets/trial-theme.css). The file is CSS variables (color, type, pad size, HUD spacing) plus optional helpers such as `.trial-pad` and `.trial-hud`. A demo can ignore the helpers and draw its own stimulus chrome. Override any variable on the page. `noematachograph.html` and `vr.html` do not use this file.

[`assets/trial-orientation.js`](assets/trial-orientation.js) is a separate opt-in. It records `screen.orientation` (type and angle when the browser provides them) at the start of a run, on each turn, and at the end. It does not lock orientation. The hub games use it. `vr.html` still has its own CSV and `localStorage` backup without this log.

[`assets/trial-store.js`](assets/trial-store.js) is the local log for Stroop, Oddball, and Brightness. Those three save each run in `localStorage` (`project-trial:stroop`, `project-trial:oddball`, `project-trial:brightness`) and can download a CSV of the trial rows plus orientation start, turn, and end rows. Clear saved removes that key. Nothing is uploaded. Stroop sessions store a `mode` of `gamified` or `classical`, and that value is a column on each Stroop CSV row. Oddball and Brightness omit it.

Numerosity Comparison, RDK Motion Coherence, Eriksen Flanker, Visual Working Memory, Go / No-Go, and Reversal Learning each keep one payload (`projectTrial_numerosity_v1`, `projectTrial_rdk_v1`, `projectTrial_flanker_v1`, `projectTrial_vwm_v1`, `projectTrial_gonogo_v1`, `projectTrial_bandit_v1`) and download a CSV of the current run. A later finished run replaces that payload. Corsi Span appends finished runs under `projectTrial_corsi_v1`. These tasks do not use `trial-store.js` or `trial-orientation.js`.

[`assets/trial-audio.js`](assets/trial-audio.js) plays the short Web Audio tones for tasks that already use sound. Mute is one `localStorage` key, `project-trial:sfx`, with values `on` and `off`. When that key is missing, sound is on. Opening or playing a task does not write the key. Noematachograph is the exception: with no stored choice it stays off, so Enable Audio is what a first visit shows, and the tuning fork does not start on its own. A stored `on` or `off` from any task, including Noematachograph, wins everywhere. Stroop Dash, Oddball, Brightness Detection, and [`vr.html`](vr.html) have no mute control of their own and follow the key. Classical Stroop does not call the tone player. Numerosity Comparison (`SFX: ON` / `SFX: OFF`), RDK Motion Coherence (`SFX ON` / `SFX OFF`), and Corsi Span (the setup `AUDIO CUES` select) keep their own controls and write the same key. The script tag has to come before the inline task script, without `defer`, `async`, or `type="module"`. Flanker, Go / No-Go, Visual Working Memory, and Reversal Learning stay silent.

## Not on the hub yet

- [`noematachograph.html`](noematachograph.html) — an illustration of Franciscus Donders’ mental chronometry apparatus. It is not linked from the hub. The on-screen “reaction time” is a fixed trace, not a response you make.
- [`vr.html`](vr.html) — Orbital Energy Sorter, a WebXR spatial go/no-go scene with a local CSV download and a `localStorage` backup. It is not linked from the hub.
