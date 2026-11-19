/*
  Frame-locked intervals for Project Trial.

  Brief trial intervals are counted from requestAnimationFrame, not from
  setTimeout. The clock is the performance timeline: the animation-frame
  timestamp and performance.now() share one time origin. Scheduled onsets
  and offsets store the frame timestamp. A key or a pad stores
  performance.now() in the input handler.

  Each positive intended duration is the nearest whole-frame count at the
  refresh rate estimated from recent frame deltas, and it is at least one
  frame. The estimate is the median of those deltas. Until eight clean
  deltas have arrived, the scheduler uses a nominal 60 Hz only so the
  first moments of the page still have a rate. A trial freezes the rate
  it actually quantizes with. The export stores that rate, the intended
  milliseconds, and the frame timestamps.

  A hidden tab, or a frame gap longer than 2.5 estimated frames after the
  rate has settled, flags the run. The flag is not cleared by coming back.
  A short note stays on screen. Nothing is uploaded.

  A task opens one session, then one trial() for each trial:

    var timing = TrialTiming.session();
    var run = timing.trial();
    timing.frame(function (ts) {
      var phase = run.open("fixation", 500, ts);
      run.after(ts, 500, function (endTs) {
        phase.close(endTs, "frame");
      });
    });

  run.after returns { cancel }. timing.cancelAll() drops pending work,
  including a frame that has not started. timing.now() is performance.now().
  timing.policy() is the JSON-safe description to put on the params snapshot.
  run.fields() is the per-trial block for TrialExport.

  Phase end is "frame" when the scheduled frame closed it, or "response"
  when a response removed it early. A phase with a null intended duration
  has no deadline (the visual working memory probe).
*/
(function (global) {
    "use strict";

    var NOMINAL_FRAME_MS = 1000 / 60;
    var MIN_SAMPLE_MS = 3;
    var MAX_SAMPLE_MS = 40;
    var MIN_SAMPLES = 8;
    var SAMPLE_CAP = 24;
    var GAP_FACTOR = 2.5;
    var NOTE_ID = "trial-timing-note";

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

    function session() {
        if (typeof global.requestAnimationFrame !== "function") {
            throw new Error("TrialTiming needs requestAnimationFrame");
        }

        var jobs = [];
        var pending = [];
        var samples = [];
        var estimatedFrameMs = null;
        var lastTs = null;
        var frameIndex = 0;
        var generation = 0;
        var inFrame = false;
        var currentTs = 0;
        var alive = true;
        var reasons = { hidden: false, throttled: false };
        var noteNode = null;

        function now() {
            if (global.performance && typeof global.performance.now === "function") {
                return global.performance.now();
            }
            return currentTs;
        }

        function currentFrameMs() {
            return estimatedFrameMs || NOMINAL_FRAME_MS;
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
            var doc = global.document;
            if (!doc || !doc.body || typeof doc.createElement !== "function") return;
            if (!noteNode || !noteNode.parentNode) {
                noteNode = doc.getElementById(NOTE_ID);
            }
            if (!noteNode) {
                noteNode = doc.createElement("p");
                noteNode.id = NOTE_ID;
                noteNode.setAttribute("role", "status");
                noteNode.setAttribute("data-trial-timing-note", "");
                noteNode.style.position = "fixed";
                noteNode.style.top = "3.25rem";
                noteNode.style.left = "0";
                noteNode.style.right = "0";
                noteNode.style.zIndex = "50";
                noteNode.style.margin = "0";
                noteNode.style.padding = "0.35rem 0.75rem";
                noteNode.style.textAlign = "center";
                noteNode.style.font = "600 13px/1.35 Arial, Helvetica, sans-serif";
                noteNode.style.color = "#f8fafc";
                noteNode.style.background = "rgba(15, 23, 42, 0.92)";
                noteNode.style.pointerEvents = "none";
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

        function observe(ts) {
            if (lastTs != null) {
                var delta = ts - lastTs;
                var settled = samples.length >= MIN_SAMPLES && estimatedFrameMs;
                if (settled && delta > estimatedFrameMs * GAP_FACTOR) {
                    flag("throttled");
                } else if (delta >= MIN_SAMPLE_MS && delta <= MAX_SAMPLE_MS) {
                    if (!settled || (delta >= estimatedFrameMs * 0.75 && delta <= estimatedFrameMs * 1.35)) {
                        samples.push(delta);
                        if (samples.length > SAMPLE_CAP) samples.shift();
                        if (samples.length >= MIN_SAMPLES) estimatedFrameMs = median(samples);
                    }
                }
            }
            lastTs = ts;
            if (global.document && global.document.hidden) flag("hidden");
        }

        function onVisibility() {
            if (global.document && global.document.hidden) flag("hidden");
        }

        if (global.document && typeof global.document.addEventListener === "function") {
            global.document.addEventListener("visibilitychange", onVisibility);
            if (global.document.hidden) flag("hidden");
        }

        function cancelAll() {
            generation += 1;
            var i;
            for (i = 0; i < jobs.length; i++) jobs[i].cancelled = true;
            jobs = [];
            pending = [];
        }

        function frame(fn) {
            if (inFrame) {
                fn(currentTs);
                return;
            }
            var gen = generation;
            pending.push(function (ts) {
                if (gen !== generation) return;
                fn(ts);
            });
        }

        function scheduleAfter(onsetTs, intendedMs, fn, frameMs) {
            if (!inFrame) {
                var outer = {
                    cancel: function () {
                        outer.dead = true;
                        if (outer.inner) outer.inner.cancel();
                    }
                };
                frame(function (ts) {
                    if (outer.dead) return;
                    outer.inner = scheduleAfter(ts, intendedMs, fn, frameMs);
                });
                return outer;
            }
            var rate = frameMs > 0 && isFinite(frameMs) ? frameMs : currentFrameMs();
            var count = framesFor(intendedMs, rate);
            var scheduledMs = count * rate;
            var job = {
                generation: generation,
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

        function pump(ts) {
            if (!alive) return;
            frameIndex += 1;
            observe(ts);
            inFrame = true;
            currentTs = ts;
            var starts = pending.splice(0, pending.length);
            var i;
            for (i = 0; i < starts.length; i++) starts[i](ts);
            var snapshot = jobs.slice();
            var due = [];
            var keep = [];
            for (i = 0; i < snapshot.length; i++) {
                var job = snapshot[i];
                if (job.cancelled || job.generation !== generation) continue;
                if (frameIndex > job.onsetFrame && ts >= job.targetTs - job.half - 0.05) due.push(job);
                else keep.push(job);
            }
            jobs = keep;
            for (i = 0; i < due.length; i++) {
                if (due[i].cancelled || due[i].generation !== generation) continue;
                due[i].fn(ts);
            }
            inFrame = false;
            if (alive) global.requestAnimationFrame(pump);
        }

        global.requestAnimationFrame(pump);

        function policy() {
            var fm = currentFrameMs();
            return {
                method: "requestAnimationFrame",
                clock: "animation-frame timestamp, same time origin as performance.now()",
                responseClock: "performance.now()",
                quantization: "nearest whole frame at the refresh rate used for that trial",
                refreshHz: 1000 / fm,
                frameMs: fm,
                refreshSource: estimatedFrameMs ? "animation-frame-deltas" : "nominal-60hz",
                frameSamples: samples.length,
                minPositiveFrames: 1,
                flag: flagString(),
                note: "Scheduled onsets and offsets use the requestAnimationFrame timestamp. Responses use performance.now(). A positive intended duration is at least one frame. Each trial's frame_ms is the rate that trial quantized with. timing_flag is hidden, throttled, or hidden+throttled when this page saw a hidden tab or a long frame gap. A blank flag is not a light-sensor clearance."
            };
        }

        function trial() {
            var fm = currentFrameMs();
            var phases = [];

            function open(name, intendedMs, onsetTs) {
                var hasDeadline = intendedMs != null && intendedMs !== "";
                var count = hasDeadline ? framesFor(intendedMs, fm) : null;
                var phase = {
                    name: name,
                    intendedMs: hasDeadline ? intendedMs : null,
                    scheduledMs: count == null ? null : count * fm,
                    frames: count,
                    frameMs: fm,
                    onsetPerfMs: onsetTs,
                    offsetPerfMs: null,
                    actualMs: null,
                    end: null
                };
                phases.push(phase);
                var closed = false;
                return {
                    close: function (offsetTs, end) {
                        if (closed) return;
                        closed = true;
                        phase.offsetPerfMs = offsetTs;
                        phase.actualMs = offsetTs - onsetTs;
                        phase.end = end || "frame";
                    },
                    isOpen: function () { return !closed; }
                };
            }

            return {
                frameMs: fm,
                refreshHz: 1000 / fm,
                open: open,
                after: function (onsetTs, intendedMs, fn) {
                    return scheduleAfter(onsetTs, intendedMs, fn, fm);
                },
                fields: function () {
                    var intended = {};
                    var listed = [];
                    var i;
                    for (i = 0; i < phases.length; i++) {
                        var phase = phases[i];
                        intended[phase.name] = phase.intendedMs;
                        listed.push({
                            name: phase.name,
                            intendedMs: phase.intendedMs,
                            scheduledMs: phase.scheduledMs,
                            frames: phase.frames,
                            frameMs: phase.frameMs,
                            onsetPerfMs: phase.onsetPerfMs,
                            offsetPerfMs: phase.offsetPerfMs,
                            actualMs: phase.actualMs,
                            end: phase.end
                        });
                    }
                    return {
                        timingMethod: "requestAnimationFrame",
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
            after: function (onsetTs, intendedMs, fn) {
                return scheduleAfter(onsetTs, intendedMs, fn, currentFrameMs());
            },
            cancelAll: cancelAll,
            trial: trial,
            policy: policy,
            flag: flagString,
            dispose: function () {
                alive = false;
                cancelAll();
                if (global.document && typeof global.document.removeEventListener === "function") {
                    global.document.removeEventListener("visibilitychange", onVisibility);
                }
            }
        };
    }

    global.TrialTiming = {
        session: session,
        framesFor: framesFor,
        nominalFrameMs: NOMINAL_FRAME_MS
    };
})(typeof window !== "undefined" ? window : globalThis);
