/*
  Shared Web Audio tones for Project Trial tasks.

  One AudioContext per page. ensureContext() creates it and resumes a
  suspended context. Call ensureContext() or playTone() from a click or key
  handler so the browser allows sound. playTone() is a no-op while muted.

  Mute is one localStorage key shared by every task that loads this file:

      project-trial:sfx

  Stored values are the strings "on" and "off". Anything else is ignored.
  setEnabled() and bindToggle() write the key. isEnabled() only reads it.
  A choice stored in one task is the choice in the next task.

  When the key is missing, sound is on. That shared default is
  TrialAudio.defaultEnabled (true). create(), ensureContext(), and
  playTone() do not write the key. A missing key stays missing until
  the user toggles mute, SFX, or audio cues. setEnabled() and
  bindToggle() are what store "on" or "off".

  Pass defaultEnabled only to opt out of that shared default.
  noematachograph.html is the only caller that does:
  create({ defaultEnabled: false }). A first visit with no stored key
  stays on Enable Audio, so the tuning fork and shout spikes do not
  start by themselves. A stored "on" or "off" from any task, including
  Noematachograph, wins on every page.

  Stroop Dash, Oddball, and Brightness Detection have no mute
  control. They still honor project-trial:sfx and stay audible when the
  key is missing.

  orbital_gonogo.html (Spatial Go/No-Go) binds an SFX: ON / SFX: OFF
  control with bindToggle and uses the shared default, so sound is on
  when the key is missing. It does not pass defaultEnabled: false.
  vr.html only redirects to orbital_gonogo.html.

  Load this file with a plain script tag before the inline task script.
  Do not use defer, async, or type="module", or TrialAudio will be missing
  when the task script runs.

  playTone(freq, durationSec, type, gain, slideTo)
    freq         Hz
    durationSec  seconds, default 0.1. Not milliseconds.
    type         oscillator type, default "sine"
    gain         linear peak gain, default 0.08
    slideTo      optional Hz. Frequency glides exponentially across the note.

  Object form:
    playTone({ freq, duration, type, gain, slideTo, stepTo, stepAt })
    stepTo / stepAt jump the frequency once, stepAt seconds after the start.
    Use that for a two-pitch chime. slideTo wins if both are set.

  The Noematachograph tuning fork is a long-lived oscillator. The page
  builds it on the context from ensureContext() and gates it with
  isEnabled(). Short spikes go through playTone().

  bindToggle(el, options) wires a button or a <select> without picking
  the label chrome:
    kind     "button" (default) or "select". A <select> is detected.
    sync     function (el, enabled) paints the control. Default button
             paint sets text from onLabel / offLabel and aria-pressed.
             Default select paint sets the value to "on" or "off".
    onChange function (enabled) runs after a user gesture, not on the
             initial paint.
    onLabel / offLabel   button text. Defaults "SFX: ON" / "SFX: OFF".

  A select writes the key when its value changes. Option values are "on"
  and "off". Corsi keeps that setup select and applies it at the start
  of a run.
*/
(function (global) {
    var STORAGE_KEY = "project-trial:sfx";
    var DEFAULT_ENABLED = true;
    var GAIN_FLOOR = 0.0001;

    var ctx = null;
    var enabled = true;
    var ready = false;
    var persistEnabled = true;

    function readStored() {
        try {
            var raw = global.localStorage.getItem(STORAGE_KEY);
            if (raw === "on") return true;
            if (raw === "off") return false;
        } catch (err) {
            return null;
        }
        return null;
    }

    function writeStored(value) {
        if (!persistEnabled) return;
        try {
            global.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
        } catch (err) {}
    }

    function create(options) {
        var opts = options || {};
        if (!ready) {
            ready = true;
            persistEnabled = opts.persist !== false;
            var fallback = DEFAULT_ENABLED;
            if (typeof opts.defaultEnabled === "boolean") fallback = opts.defaultEnabled;
            if (!persistEnabled) {
                enabled = fallback;
            } else {
                var stored = readStored();
                enabled = stored === null ? fallback : stored;
            }
        }
        return session;
    }

    function ensureContext() {
        var AudioCtx = global.AudioContext || global.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!ctx) {
            try {
                ctx = new AudioCtx();
            } catch (err) {
                return null;
            }
        }
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
            var pending = ctx.resume();
            if (pending && typeof pending.catch === "function") pending.catch(function () {});
        }
        return ctx;
    }

    function normalizeTone(freqOrOpts, durationSec, type, gain, slideTo) {
        if (freqOrOpts && typeof freqOrOpts === "object") {
            return {
                freq: freqOrOpts.freq,
                duration: freqOrOpts.duration == null ? 0.1 : freqOrOpts.duration,
                type: freqOrOpts.type || "sine",
                gain: freqOrOpts.gain == null ? 0.08 : freqOrOpts.gain,
                slideTo: freqOrOpts.slideTo == null ? null : freqOrOpts.slideTo,
                stepTo: freqOrOpts.stepTo == null ? null : freqOrOpts.stepTo,
                stepAt: freqOrOpts.stepAt == null ? null : freqOrOpts.stepAt
            };
        }
        return {
            freq: freqOrOpts,
            duration: durationSec == null ? 0.1 : durationSec,
            type: type || "sine",
            gain: gain == null ? 0.08 : gain,
            slideTo: slideTo == null ? null : slideTo,
            stepTo: null,
            stepAt: null
        };
    }

    function playTone(freqOrOpts, durationSec, type, gain, slideTo) {
        if (!isEnabled()) return;
        var tone = normalizeTone(freqOrOpts, durationSec, type, gain, slideTo);
        if (!(tone.freq > 0) || !(tone.gain > 0)) return;
        var context = ensureContext();
        if (!context) return;
        var duration = tone.duration > 0 ? tone.duration : 0.1;
        try {
            var now = context.currentTime;
            var osc = context.createOscillator();
            var amp = context.createGain();
            osc.type = tone.type;
            osc.frequency.setValueAtTime(tone.freq, now);
            if (tone.slideTo > 0 && tone.slideTo !== tone.freq) {
                osc.frequency.exponentialRampToValueAtTime(tone.slideTo, now + duration);
            } else if (tone.stepTo > 0 && tone.stepAt > 0) {
                osc.frequency.setValueAtTime(tone.stepTo, now + tone.stepAt);
            }
            var peak = tone.gain > GAIN_FLOOR ? tone.gain : GAIN_FLOOR;
            amp.gain.setValueAtTime(peak, now);
            if (peak > GAIN_FLOOR) {
                amp.gain.exponentialRampToValueAtTime(GAIN_FLOOR, now + duration);
            }
            osc.connect(amp);
            amp.connect(context.destination);
            osc.start(now);
            osc.stop(now + duration);
            osc.onended = function () {
                try {
                    osc.disconnect();
                    amp.disconnect();
                } catch (err) {}
            };
        } catch (err) {}
    }

    function setEnabled(value) {
        enabled = !!value;
        ready = true;
        writeStored(enabled);
    }

    function isEnabled() {
        if (!ready) create();
        return enabled;
    }

    function paintToggle(el, opts, on) {
        if (typeof opts.sync === "function") {
            opts.sync(el, on);
            return;
        }
        if (opts.kind === "select") {
            el.value = on ? "on" : "off";
            return;
        }
        var onLabel = opts.onLabel || "SFX: ON";
        var offLabel = opts.offLabel || "SFX: OFF";
        el.textContent = on ? onLabel : offLabel;
        el.setAttribute("aria-pressed", on ? "true" : "false");
    }

    function bindToggle(el, options) {
        if (!el) return;
        var opts = options || {};
        if (!opts.kind) {
            opts.kind = el.tagName === "SELECT" ? "select" : "button";
        }
        paintToggle(el, opts, isEnabled());
        function commit(next) {
            setEnabled(next);
            if (next) ensureContext();
            paintToggle(el, opts, isEnabled());
            if (typeof opts.onChange === "function") opts.onChange(isEnabled());
        }
        if (opts.kind === "select") {
            el.addEventListener("change", function () {
                commit(el.value !== "off");
            });
            return;
        }
        el.addEventListener("click", function () {
            commit(!isEnabled());
        });
    }

    var session = {
        ensureContext: ensureContext,
        playTone: playTone,
        setEnabled: setEnabled,
        isEnabled: isEnabled,
        bindToggle: bindToggle
    };

    global.TrialAudio = {
        storageKey: STORAGE_KEY,
        defaultEnabled: DEFAULT_ENABLED,
        create: create
    };
})(window);
