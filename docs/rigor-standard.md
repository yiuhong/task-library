# Rigor standard

This is the bar for a scored task in Project Trial. Architecture C stays: one task core, two shells. The shell is the frame, the type, and the buttons. The core is the trial list, the stimuli, the keys, the score, and the timings.

Visual working memory, numerosity comparison, Eriksen flanker, Stroop, oddball, 2D go/no-go, brightness detection, RDK motion coherence, Corsi span, and reversal learning are on this standard. Spatial Go/No-Go is not: headset-frame timing is a later slice. Noematachograph is not a scored trial task.

## 1. Frame-locked timing and a complete on-device export

Fixation, sample, mask, delay or ISI, stimulus display, and the end of a response window are scheduled from display frames (`requestAnimationFrame`), not from `setTimeout`. Each intended duration is kept as the nearest whole-frame length at the refresh rate estimated from those frames. A positive duration is at least one frame. The download records the intended milliseconds and the actual onset and offset timestamps.

The clock is the performance timeline. Scheduled onsets and offsets use the animation-frame timestamp. A key or a pad uses `performance.now()`. Both share one time origin. Response time is the response timestamp minus the onset of the response-relevant display.

The file stays on the device. Nothing is uploaded. Practice rows stay in the file and are marked practice.

If the tab is hidden, or a frame gap shows that frames were delayed, the run is flagged in the download and a short note stays on screen. A flagged run is not a clean timing run. Coming back to the tab does not clear the flag.

## 2. One experiment-grade core, two shells

Gamified and classical load the same core. The methods note says what a browser can and cannot time, and what the gamified chrome changes. The chrome is the word or the color after the response. It does not change the stimulus, the scheduled intervals, the randomisation, or the score.

Classical stays the quiet mid-gray page, about `#7f7f7f`, with no live score and no live response-time readout during test trials.

## 3. One device check per machine

Use the shared Device check (`diagnostics.html`) on each computer. Do not add a new diagnostic inside a task. Keep the JSON with the protocol notes. The check is a reading of this browser on this machine. It does not replace a light sensor or a calibrated button box, and it does not clear the machine for a methods section on its own.

## 4. A new scored task does not ship until it clears this list

It uses the shared timing helper (`assets/trial-timing.js`), the shared export fields, a methods note, and both shells. A documented special case can say why it does not.

Spatial Go/No-Go is the WebXR special case. It is one scene, not two shells. Headset-frame timing is a later slice. This standard does not change that task.

Noematachograph is not a scored trial task. It does not use the helper or the export.

## What researchers still do

Run the shared device checks on each machine, with the tab visible, and keep the JSON with the protocol notes. Report the task times as browser measurements. A photodiode study, if you run one, is a separate record.
