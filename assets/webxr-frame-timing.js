/*
  Headset-frame timing for Spatial Go/No-Go.

  This is the WebXR special case. It is not assets/trial-timing.js and it
  is not wired into the 2D shells. The 2D helper counts page
  requestAnimationFrame callbacks. An immersive-vr session does not use
  that loop: the headset frame is XRSession.requestAnimationFrame, which
  A-Frame 1.8 forwards as the time argument of the scene render callback.

  A-Frame's component tick time is a THREE.Timer elapsed value. This file
  does not use that elapsed value. It uses the render callback's time
  argument, and it runs before renderer.render, so a mesh added from a
  scheduled callback is in the frame that carries that timestamp.

  That timestamp is a DOMHighResTimeStamp. It shares an origin with
  performance.now(). It is when the browser runs the callback, which is
  when this page prepares the frame. It is earlier than the compositor's
  presentation and earlier than photons at the eye.

  When the callback receives an XRFrame, the trial method is
  webxr-animation-frame. XRFrame.predictedDisplayTime is the browser's
  predicted presentation time for an immersive session. It is stored on
  the phase. It is not the onset used for response time, and it is not a
  light measurement.

  When the callback has no XRFrame, the trial method is
  requestAnimationFrame. That is the flat preview, including A-Frame's
  fullscreen Enter VR fallback, which is not an immersive-vr session.
  A desktop run is not labeled as a headset frame.

  Whole-frame rounding matches the 2D helper: nearest frame at the rate
  estimated from that clock's recent deltas, and at least one frame.
  Until eight clean deltas, the scheduler uses a nominal 60 Hz only so
  the first moments still have a rate. Page deltas and headset deltas
  are estimated separately. A switch from one clock to the other does
  not, by itself, look like a dropped frame.

  A hidden document, or a gap longer than 2.5 estimated frames after
  that clock's rate has settled, sets timing_flag. The flag is not
  cleared by coming back. A blank flag is not a headset clearance.
*/
(function (global) {
    "use strict";

    var NOMINAL_FRAME_MS = 1000 / 60;
    var MIN_SAMPLE_MS = 3;
    var MAX_SAMPLE_MS = 40;
    var MIN_SAMPLES = 8;
    var SAMPLE_CAP = 24;
    var GAP_FACTOR = 2.5;
    var NOTE_ID = "webxr-timing-note";
    var METHOD_XR = "webxr-animation-frame";
    var METHOD_PAGE = "requestAnimationFrame";
    var STAMP_XR = "xr-session-animation-frame";
    var STAMP_PAGE = "page-animation-frame";

    function framesFor(intendedMs, frameMs) {
        var fm = frameMs > 0 && isFinite(frameMs) ? frameMs : NOMINAL_FRAME_MS;
        if (!(intendedMs > 0) || !isFinite(intendedMs)) return 0;
        var n = Math.round(intendedMs / fm);
        return n < 1 ? 1 : n;
    }

    function median(values) {
        if (!values.length) return null;
        var xs = values.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(xs.length / 2);
        if (xs.length % 2) return xs[mid];
        return (xs[mid - 1] + xs[mid]) / 2;
    }

    function bucket() {
        return {
            samples: [],
            estimated: null,
            lastTs: null
        };
    }

    function create(options) {
        var opts = options || {};
        var doc = opts.document !== undefined ? opts.document : global.document;
        var jobs = [];
        var pending = [];
        var later = [];
        var page = bucket();
        var headset = bucket();
        var frameIndex = 0;
        var generation = 0;
        var inFrame = false;
        var draining = false;
        var currentTime = 0;
        var currentInfo = describe(null, null);
        var installed = false;
        var reasons = { hidden: false, throttled: false };
        var noteNode = null;

        function now() {
            if (global.performance && typeof global.performance.now === "function") {
                return global.performance.now();
            }
            return currentTime;
        }

        function describe(time, frame) {
            var predicted = null;
            var xr = false;
            if (frame && frame.session && typeof frame.predictedDisplayTime === "number" && isFinite(frame.predictedDisplayTime)) {
                xr = true;
                predicted = frame.predictedDisplayTime;
            }
            return {
                time: time,
                method: xr ? METHOD_XR : METHOD_PAGE,
                stamp: xr ? STAMP_XR : STAMP_PAGE,
                predictedDisplayMs: predicted
            };
        }

        function activeBucket() {
            return currentInfo.method === METHOD_XR ? headset : page;
        }

        function currentFrameMs() {
            return activeBucket().estimated || NOMINAL_FRAME_MS;
        }

        function flagString() {
            if (reasons.hidden && reasons.throttled) return "hidden+throttled";
            if (reasons.hidden) return "hidden";
            if (reasons.throttled) return "throttled";
            return "";
        }

        function noteText() {
            if (reasons.hidden && reasons.throttled) {
                return "This tab was hidden and frames were delayed. Timing for this run is flagged in the download.";
            }
            if (reasons.hidden) {
                return "This tab was hidden. Timing for this run is flagged in the download.";
            }
            return "Frames were delayed. Timing for this run is flagged in the download.";
        }

        function showNote() {
            if (!doc || !doc.body || typeof doc.createElement !== "function") return;
            if (!noteNode || !noteNode.parentNode) {
                noteNode = typeof doc.getElementById === "function" ? doc.getElementById(NOTE_ID) : null;
            }
            if (!noteNode) {
                noteNode = doc.createElement("p");
                noteNode.id = NOTE_ID;
                if (noteNode.setAttribute) {
                    noteNode.setAttribute("role", "status");
                    noteNode.setAttribute("data-webxr-timing-note", "");
                }
                if (noteNode.style) {
                    noteNode.style.position = "fixed";
                    noteNode.style.top = "4.5rem";
                    noteNode.style.left = "0";
                    noteNode.style.right = "0";
                    noteNode.style.zIndex = "40";
                    noteNode.style.margin = "0";
                    noteNode.style.padding = "0.35rem 0.75rem";
                    noteNode.style.textAlign = "center";
                    noteNode.style.font = "600 13px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
                    noteNode.style.color = "#f8fafc";
                    noteNode.style.background = "rgba(15, 23, 42, 0.92)";
                    noteNode.style.pointerEvents = "none";
                }
                doc.body.appendChild(noteNode);
            }
            noteNode.hidden = false;
            noteNode.textContent = noteText();
        }

        function flag(kind) {
            if (reasons[kind]) {
                showNote();
                return;
            }
            reasons[kind] = true;
            showNote();
        }

        function observe(ts, info) {
            var slot = info.method === METHOD_XR ? headset : page;
            if (slot.lastTs != null) {
                var delta = ts - slot.lastTs;
                var settled = slot.samples.length >= MIN_SAMPLES && slot.estimated;
                if (settled && delta > slot.estimated * GAP_FACTOR) {
                    flag("throttled");
                } else if (delta >= MIN_SAMPLE_MS && delta <= MAX_SAMPLE_MS) {
                    if (!settled || (delta >= slot.estimated * 0.75 && delta <= slot.estimated * 1.35)) {
                        slot.samples.push(delta);
                        if (slot.samples.length > SAMPLE_CAP) slot.samples.shift();
                        if (slot.samples.length >= MIN_SAMPLES) slot.estimated = median(slot.samples);
                    }
                }
            }
            slot.lastTs = ts;
            if (doc && doc.hidden) flag("hidden");
        }

        function onVisibility() {
            if (doc && doc.hidden) flag("hidden");
        }

        if (doc && typeof doc.addEventListener === "function") {
            doc.addEventListener("visibilitychange", onVisibility);
            if (doc.hidden) flag("hidden");
        }

        function cancelAll() {
            generation += 1;
            var i;
            for (i = 0; i < jobs.length; i++) jobs[i].cancelled = true;
            jobs = [];
            pending = [];
            later = [];
        }

        function drain() {
            if (draining) return;
            draining = true;
            var guard = 0;
            var i;
            while (pending.length && guard < 16) {
                guard += 1;
                var batch = pending.splice(0, pending.length);
                for (i = 0; i < batch.length; i++) batch[i](currentTime, currentInfo);
            }
            draining = false;
        }

        function frame(fn) {
            pending.push(fn);
            if (inFrame) drain();
        }

        /*
          Queue for the next render callback. Unlike frame(), this does not
          run during the current callback, so a mesh that is not ready yet
          cannot spin the drain loop.
        */
        function nextFrame(fn) {
            later.push(fn);
        }

        function scheduleAfter(onsetTs, intendedMs, fn, frameMs) {
            var rate = frameMs > 0 && isFinite(frameMs) ? frameMs : currentFrameMs();
            var count = framesFor(intendedMs, rate);
            var scheduledMs = count * rate;
            var gen = generation;
            var job = {
                generation: gen,
                onsetFrame: frameIndex,
                targetTs: onsetTs + scheduledMs,
                half: rate / 2,
                cancelled: false,
                fn: fn
            };
            jobs.push(job);
            return {
                cancel: function () { job.cancelled = true; },
                frames: count,
                frameMs: rate,
                scheduledMs: scheduledMs,
                intendedMs: intendedMs
            };
        }

        function fireDue(ts) {
            var snapshot = jobs.slice();
            var due = [];
            var keep = [];
            var i;
            for (i = 0; i < snapshot.length; i++) {
                var job = snapshot[i];
                if (job.cancelled || job.generation !== generation) continue;
                if (frameIndex > job.onsetFrame && ts >= job.targetTs - job.half - 0.05) due.push(job);
                else keep.push(job);
            }
            jobs = keep;
            for (i = 0; i < due.length; i++) {
                if (due[i].cancelled || due[i].generation !== generation) continue;
                due[i].fn(ts, currentInfo);
            }
        }

        function enter(time, frame) {
            if (later.length) pending = pending.concat(later.splice(0, later.length));
            inFrame = true;
            currentTime = time;
            currentInfo = describe(time, frame);
            frameIndex += 1;
            observe(time, currentInfo);
            fireDue(time);
            drain();
        }

        function leave() {
            inFrame = false;
        }

        function pump(time, frame) {
            enter(time, frame);
            leave();
        }

        function rateReport(slot) {
            return {
                refreshHz: slot.estimated ? 1000 / slot.estimated : null,
                frameMs: slot.estimated || null,
                refreshSource: slot.estimated ? "animation-frame-deltas" : "nominal-60hz",
                frameSamples: slot.samples.length,
                nominalFrameMs: NOMINAL_FRAME_MS,
                nominalRefreshHz: 60
            };
        }

        function policy() {
            return {
                scheduler: "assets/webxr-frame-timing.js",
                method: "per-trial",
                perTrialMethod: "timing_method is the clock that stamped that trial's target. webxr-animation-frame only when that frame carried an XRFrame. requestAnimationFrame on a flat preview, including a fullscreen Enter VR fallback that is not an immersive-vr session.",
                clock: "render-callback timestamp, same time origin as performance.now()",
                onsetStamp: "The callback time of the frame that adds the target mesh before renderer.render. A-Frame's tick elapsed time is not used. The stamp is when the page prepares the frame. It is earlier than photons at the eye.",
                responseClock: {
                    webxr: "The same callback time on the headset frame that handles the trigger. A trigger that arrives between headset frames uses the next headset frame. The window end uses the callback time of the frame that closes it.",
                    page: "performance.now() in the trigger handler. The window end uses the page animation-frame timestamp."
                },
                predictedDisplayTime: "When the showing frame has an XRFrame, the stimulus phase stores predictedDisplayMs from XRFrame.predictedDisplayTime. For an immersive session that is the browser's predicted presentation time. It is not onset_perf_ms and not a light measurement.",
                quantization: "nearest whole frame at the refresh rate of the clock that scheduled that phase, and at least one frame",
                nominalUntil: "eight clean deltas on that clock",
                refreshHz: activeBucket().estimated ? 1000 / activeBucket().estimated : null,
                frameMs: activeBucket().estimated || null,
                refreshSource: activeBucket().estimated ? "animation-frame-deltas" : "nominal-60hz",
                headset: rateReport(headset),
                page: rateReport(page),
                minPositiveFrames: 1,
                flag: flagString(),
                immersiveFrame: currentInfo.method === METHOD_XR,
                note: "Headset frames and page frames share the performance timeline and are estimated separately. A blank timing_flag is not a headset clearance and not a light-sensor clearance. Outcome words are removed with setTimeout. That delay is chrome during the gap. It does not time the trial."
            };
        }

        function trial() {
            var phases = [];
            var stimulusMethod = null;
            var stimulusFrameMs = null;

            function open(name, intendedMs, onsetTs, info) {
                var meta = info || currentInfo;
                var hasDeadline = intendedMs != null && intendedMs !== "";
                var rate = currentFrameMs();
                var count = hasDeadline ? framesFor(intendedMs, rate) : null;
                var phase = {
                    name: name,
                    intendedMs: hasDeadline ? intendedMs : null,
                    scheduledMs: count == null ? null : count * rate,
                    frames: count,
                    frameMs: rate,
                    onsetPerfMs: onsetTs,
                    offsetPerfMs: null,
                    actualMs: null,
                    end: null,
                    stamp: meta && meta.stamp ? meta.stamp : STAMP_PAGE,
                    predictedDisplayMs: meta && meta.predictedDisplayMs != null ? meta.predictedDisplayMs : null,
                    offsetPredictedDisplayMs: null
                };
                phases.push(phase);
                if (name === "stimulus") {
                    stimulusMethod = meta && meta.method ? meta.method : METHOD_PAGE;
                    stimulusFrameMs = rate;
                }
                var closed = false;
                return {
                    close: function (offsetTs, end, endInfo) {
                        if (closed) return;
                        closed = true;
                        phase.offsetPerfMs = offsetTs;
                        phase.actualMs = offsetTs - onsetTs;
                        phase.end = end || "frame";
                        if (endInfo && endInfo.predictedDisplayMs != null) {
                            phase.offsetPredictedDisplayMs = endInfo.predictedDisplayMs;
                        }
                    },
                    isOpen: function () { return !closed; },
                    frameMs: rate
                };
            }

            return {
                open: open,
                after: function (onsetTs, intendedMs, fn, frameMs) {
                    return scheduleAfter(onsetTs, intendedMs, fn, frameMs);
                },
                fields: function () {
                    var intended = {};
                    var listed = [];
                    var i;
                    var fm = stimulusFrameMs || NOMINAL_FRAME_MS;
                    for (i = 0; i < phases.length; i++) {
                        var phase = phases[i];
                        intended[phase.name] = phase.intendedMs;
                        if (phase.name === "stimulus" && phase.frameMs) fm = phase.frameMs;
                        listed.push({
                            name: phase.name,
                            intendedMs: phase.intendedMs,
                            scheduledMs: phase.scheduledMs,
                            frames: phase.frames,
                            frameMs: phase.frameMs,
                            onsetPerfMs: phase.onsetPerfMs,
                            offsetPerfMs: phase.offsetPerfMs,
                            actualMs: phase.actualMs,
                            end: phase.end,
                            stamp: phase.stamp,
                            predictedDisplayMs: phase.predictedDisplayMs,
                            offsetPredictedDisplayMs: phase.offsetPredictedDisplayMs
                        });
                    }
                    return {
                        timingMethod: stimulusMethod || METHOD_PAGE,
                        refreshHz: 1000 / fm,
                        frameMs: fm,
                        intendedDurations: intended,
                        phaseTiming: listed,
                        timingFlag: flagString()
                    };
                }
            };
        }

        return {
            now: now,
            frame: frame,
            nextFrame: nextFrame,
            enter: enter,
            leave: leave,
            pump: pump,
            cancelAll: cancelAll,
            trial: trial,
            policy: policy,
            flag: flagString,
            inFrame: function () { return inFrame; },
            frameTime: function () { return currentTime; },
            currentInfo: function () { return currentInfo; },
            method: function () { return currentInfo.method; },
            immersive: function () { return currentInfo.method === METHOD_XR; },
            isInstalled: function () { return installed; },
            markInstalled: function () { installed = true; },
            dispose: function () {
                cancelAll();
                if (doc && typeof doc.removeEventListener === "function") {
                    doc.removeEventListener("visibilitychange", onVisibility);
                }
            }
        };
    }

    function attach(sceneEl) {
        if (!sceneEl) throw new Error("WebxrFrameTiming.attach needs a scene");
        var doc = sceneEl.ownerDocument || global.document;
        var clock = create({ document: doc });

        function install() {
            if (clock.isInstalled()) return;
            if (!sceneEl.renderer || typeof sceneEl.renderer.setAnimationLoop !== "function") return;
            if (typeof sceneEl.render !== "function") return;
            var inner = sceneEl.render;
            function wrapped(time, frame) {
                clock.enter(time, frame);
                try {
                    return inner(time, frame);
                } finally {
                    clock.leave();
                }
            }
            sceneEl.render = wrapped;
            sceneEl.renderer.setAnimationLoop(wrapped);
            clock.markInstalled();
        }

        if (sceneEl.renderStarted) install();
        if (typeof sceneEl.addEventListener === "function") {
            sceneEl.addEventListener("renderstart", install);
        }
        clock.install = install;
        return clock;
    }

    global.WebxrFrameTiming = {
        create: create,
        attach: attach,
        framesFor: framesFor,
        nominalFrameMs: NOMINAL_FRAME_MS,
        METHOD_XR: METHOD_XR,
        METHOD_PAGE: METHOD_PAGE
    };
})(typeof window !== "undefined" ? window : globalThis);
