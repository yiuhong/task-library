# Shell contract

Project Trial phase 1. Architecture C: shared presentation shells, science in task cores. Stroop is the only task on this contract. Other hub tasks stay as they are.

## Roles

A **shell** owns chrome. It supplies the frame, theme tokens, HUD slots, button labels, and optional feedback components (shake, fire, combo pop). It does not choose the next stimulus, the correct key, the trial count, or the timings.

A **task core** owns the science and the feedback policy. It owns parameters, the trial loop, stimuli, response mapping, block structure, and which feedback variant runs. Feedback variants are task config (`arcade`, `summary`), not extra skins.

Shells must not copy a core's parameter object into a second file. Two skins that each carry their own trial list will drift.

## Mode

One page loads one core. The shell reads the query string.

| URL | Shell |
| --- | --- |
| `stroop_game.html` | gamified (default) |
| `stroop_game.html?mode=gamified` | gamified |
| `stroop_game.html?mode=classical` | classical |

`TrialShell.readMode()` returns `classical` only when `mode` is `classical`, ignoring case. Any other value, including a missing parameter, is `gamified`. The live Stroop Dash URL stays the gamified entry.

`TrialShell.apply(mode)` does four things:

1. Sets `data-trial-mode` on `<html>` and `<body>`.
2. Hides `[data-shell-arcade]` in the classical shell. Score, combo, and other game chrome use this attribute.
3. Shows `[data-shell-summary]` only in the classical shell. Accuracy and mean RT on the end screen use this attribute.
4. Writes `[data-shell-copy]` text from `data-gamified` or `data-classical`. If `data-gamified` is omitted, the element's text is the gamified string.

Theme CSS:

- `assets/trial-theme.css` is the shared dark Trial theme. Gamified Stroop uses it.
- `assets/shells/gamified.css` holds optional feedback components (combo bounce, shake, fire) and the neon stimulus glow.
- `assets/shells/classical.css` is the quiet lab theme. The run canvas is PsychoPy mid-gray `#7f7f7f`. Every rule is scoped to `html[data-trial-mode="classical"]`.
- `assets/trial-audio.js` is the tone player. The shell passes an audio session only when the core's policy for that mode sets `audio: true`. Classical Stroop passes `null` and does not call `playTone`.

## What a task core exposes

Hang the core on `TrialTasks.<id>` with a plain script tag. No bundler.

```js
TrialTasks.example = {
  id: "example",
  params: { /* frozen science parameters */ },
  feedback: {
    gamified: { id: "arcade", audio: true, score: true },
    classical: { id: "summary", audio: false, score: false }
  },
  mount: function (host) { /* wire the shell's DOM, then run */ }
};
```

`host` is `{ mode, audio }`.

- `mode` is `"gamified"` or `"classical"`.
- `audio` is a `TrialAudio.create()` session, or `null`.

The core may use `TrialStore` and `TrialOrientation`. Pass `mode` into `TrialStore.create({ mode: mode })` and `store.begin(events, { mode: mode })` so saved runs and CSV rows carry `mode`. Do not put the mode into the science parameters.

`mount` may publish `TrialTasks.<id>.current` with read-only handles (`mode`, `policyId`, getters). Shells do not write `params`.

## What a shell page does

```html
<script src="assets/shells/shell.js"></script>
<script>
  TrialShell.apply(TrialShell.readMode());
</script>
<link rel="stylesheet" href="assets/trial-theme.css">
<link rel="stylesheet" href="assets/shells/gamified.css">
<link rel="stylesheet" href="assets/shells/classical.css">
<!-- task layout CSS, then the landmarks the core documents -->
<script src="assets/trial-orientation.js"></script>
<script src="assets/trial-store.js"></script>
<script src="assets/trial-audio.js"></script>
<script src="assets/tasks/example.js"></script>
<script>
  var mode = TrialShell.apply(TrialShell.readMode());
  TrialTasks.example.mount({
    mode: mode,
    audio: TrialTasks.example.feedback[mode].audio ? TrialAudio.create() : null
  });
</script>
```

The head `apply` stamps `data-trial-mode` before CSS, so the classical theme is the first paint, and it can retitle the page. The bottom `apply` runs after the landmarks exist and swaps the visible copy and HUD slots. Calling it twice is safe.

## Stroop slots

`assets/tasks/stroop.js` requires these ids: `screen-welcome`, `screen-task`, `screen-results`, `btn-start`, `btn-restart`, `display-area`, `feedback-area`, `stimulus-container`, `response-bar` (buttons `data-key` `r` `g` `b` `y`, ids `key-r` `key-g` `key-b` `key-y`), `trial-counter`, `stat-acc`, `stat-rt`, `result-congruent`, `result-incongruent` (each with `.rt-val`), `interpretation-text`, `orientation-note`, `final-acc`, `final-mean`.

The arcade policy also requires `stat-score`, `stat-combo`, and `final-score`. Classical keeps those nodes in the page and hides them with `[data-shell-arcade]`. The core does not write a score unless the policy says so.

Stroop main block (both shells): 20 trials, 10 congruent and 10 incongruent, colors RED `#ff4b4b` / GREEN `#44ff44` / BLUE `#4444ff` / YELLOW `#ffff44`, keys R G B Y, fixation 400 ms (`READY?`), response window 2000 ms, feedback hold 400 ms, blank 300 ms. The gamified shell has no practice block. Classical adds 8 practice trials with the same builder, colors, keys, and timings. Those trials are not part of the main-block summary. Details match `stroop-info.html`.

Stroop feedback:

| | Gamified `arcade` | Classical `summary` |
| --- | --- | --- |
| Live score, combo, accuracy, RT | yes | no |
| Practice | none | 8 trials, brief Correct / Incorrect / No response |
| Main-block words after a trial | `PERFECT!` / `OOF!` / `TOO SLOW!` | none |
| Shake, fire, hue shift | yes | no |
| Reward, tick, start, and end tones | yes | no |
| End screen | score, condition means, arcade sentence | main-block accuracy, mean RT, condition means |

The response path is the same: one answer per trial while the colored word is up, pads and keys share that path, a click within 750 ms of the same press is ignored.
