/*
  Device check for Project Trial.

  Measures this tab's animation callback, setTimeout lateness, the step
  of performance.now(), and the page clock from a color change to an
  input event. The researcher runs it on their own machine.

  Nothing is uploaded. Nothing is written to localStorage except a
  one-key probe that is removed before the function returns. This is
  not a study and not a photodiode validation.
*/
(function (global) {
    "use strict";

    var FRAME_COUNT = 120;
    var WARMUP = 5;
    var TIMER_REPS = 5;
    var TIMER_DELAYS = [0, 16, 50];
    var CLOCK_FLASHES = 5;
    var FOREPERIOD_MIN = 500;
    var FOREPERIOD_MAX = 900;
    var RESPONSE_WINDOW_MS = 3000;

    function median(values) {
        if (!values.length) return null;
        var xs = values.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(xs.length / 2);
        if (xs.length % 2) return xs[mid];
        return (xs[mid - 1] + xs[mid]) / 2;
    }

    function round2(n) {
        if (n == null || !isFinite(n)) return null;
        return Math.round(n * 100) / 100;
    }

    function fmt(n) {
        var rounded = round2(n);
        return rounded == null ? "—" : String(rounded);
    }

    function nextFrame() {
        return new Promise(function (resolve) {
            global.requestAnimationFrame(resolve);
        });
    }

    function delay(ms) {
        return new Promise(function (resolve) {
            var start = global.performance.now();
            global.setTimeout(function () {
                resolve(global.performance.now() - start);
            }, ms);
        });
    }

    function storageProbe() {
        var key = "project-trial:device-check-probe";
        var note = "blocked";
        try {
            global.localStorage.setItem(key, "1");
            note = global.localStorage.getItem(key) === "1"
                ? "write and read succeeded; the probe key was removed"
                : "readback failed; the probe key was removed if it was set";
        } catch (err) {
            note = "blocked";
        }
        try {
            global.localStorage.removeItem(key);
        } catch (err) {}
        return note;
    }

    function clockStep() {
        var steps = [];
        var previous = global.performance.now();
        var guard = 0;
        while (steps.length < 20 && guard < 200000) {
            var now = global.performance.now();
            guard += 1;
            if (now !== previous) {
                steps.push(now - previous);
                previous = now;
            }
        }
        if (!steps.length) {
            return {
                samples: 0,
                minStepMs: null,
                medianStepMs: null,
                note: "Consecutive performance.now() reads did not change inside the sample loop. The step is finer than this loop, or the clock did not move."
            };
        }
        return {
            samples: steps.length,
            minStepMs: round2(steps.slice().sort(function (a, b) { return a - b; })[0]),
            medianStepMs: round2(median(steps)),
            note: "Smallest observed change in performance.now() inside a tight loop on this page. Stimulus timing is still limited by the display and by setTimeout."
        };
    }

    function environment() {
        var nav = global.navigator || {};
        var screen = global.screen || {};
        return {
            userAgent: nav.userAgent || "",
            language: nav.language || "",
            hardwareConcurrency: nav.hardwareConcurrency == null ? null : nav.hardwareConcurrency,
            deviceMemoryGb: nav.deviceMemory == null ? null : nav.deviceMemory,
            devicePixelRatio: global.devicePixelRatio == null ? null : global.devicePixelRatio,
            screen: {
                width: screen.width == null ? null : screen.width,
                height: screen.height == null ? null : screen.height,
                availWidth: screen.availWidth == null ? null : screen.availWidth,
                availHeight: screen.availHeight == null ? null : screen.availHeight,
                colorDepth: screen.colorDepth == null ? null : screen.colorDepth
            },
            viewport: {
                innerWidth: global.innerWidth,
                innerHeight: global.innerHeight
            },
            visibilityState: global.document.visibilityState,
            timeOrigin: global.performance && global.performance.timeOrigin ? global.performance.timeOrigin : null,
            storageProbe: storageProbe(),
            requestAnimationFrame: typeof global.requestAnimationFrame === "function"
        };
    }

    function limitTexts() {
        return Array.prototype.map.call(
            global.document.querySelectorAll("#device-limits li"),
            function (li) { return li.textContent.replace(/\s+/g, " ").trim(); }
        );
    }

    function init() {
        var report = {
            schema: "project-trial.device-check.v1",
            source: "project-trial",
            page: "diagnostics.html",
            notAValidation: true,
            notUploaded: true,
            libraryVersion: global.TrialSite && global.TrialSite.version ? global.TrialSite.version : "",
            generatedAt: null,
            environment: null,
            clock: null,
            timers: null,
            refresh: null,
            responseClock: null
        };

        var status = global.document.getElementById("device-status");
        var btnRun = global.document.getElementById("btn-device-run");
        var btnClock = global.document.getElementById("btn-clock-run");
        var btnClockStop = global.document.getElementById("btn-clock-stop");
        var btnDownload = global.document.getElementById("btn-device-download");
        var pad = global.document.getElementById("clock-pad");
        var clockRows = global.document.getElementById("clock-rows");
        var clockSummary = global.document.getElementById("clock-summary");

        var runToken = 0;
        var waiting = false;
        var clockLive = false;
        var current = null;
        var responseTimer = null;
        var busy = false;

        function say(text) {
            if (status) status.textContent = text;
        }

        function setText(id, text) {
            var node = global.document.getElementById(id);
            if (node) node.textContent = text;
        }

        function paintEnvironment(env) {
            setText("fact-browser", env.userAgent || "blank");
            setText("fact-language", env.language || "blank");
            setText("fact-cores", env.hardwareConcurrency == null ? "not reported" : String(env.hardwareConcurrency));
            setText("fact-memory", env.deviceMemoryGb == null
                ? "not reported by this browser"
                : env.deviceMemoryGb + " GB coarse hint");
            setText("fact-dpr", env.devicePixelRatio == null ? "not reported" : String(env.devicePixelRatio));
            setText("fact-screen", env.screen.width + " × " + env.screen.height
                + " px, avail " + env.screen.availWidth + " × " + env.screen.availHeight
                + ", color depth " + (env.screen.colorDepth == null ? "not reported" : env.screen.colorDepth));
            setText("fact-viewport", env.viewport.innerWidth + " × " + env.viewport.innerHeight + " CSS px");
            setText("fact-visibility", env.visibilityState);
            setText("fact-storage", env.storageProbe);
            setText("fact-raf", env.requestAnimationFrame ? "present" : "missing");
        }

        function paintClockStep(step) {
            if (!step) {
                setText("fact-clock", "not run yet");
                return;
            }
            if (step.minStepMs == null) {
                setText("fact-clock", step.note);
                return;
            }
            setText("fact-clock", "smallest step " + fmt(step.minStepMs) + " ms, median step "
                + fmt(step.medianStepMs) + " ms, over " + step.samples + " changes. " + step.note);
        }

        function paintTimers(timers) {
            if (!timers) {
                setText("fact-timers", "not run yet");
                return;
            }
            var parts = timers.delays.map(function (row) {
                return "asked " + row.requestedMs + " ms, median observed " + fmt(row.medianObservedMs) + " ms";
            });
            setText("fact-timers", parts.join(". ") + ". " + (timers.backgrounded
                ? "The tab was hidden during at least part of this check."
                : "The tab stayed visible for these callbacks."));
        }

        function paintRefresh(refresh) {
            if (!refresh) {
                setText("fact-refresh", "not run yet");
                return;
            }
            if (refresh.aborted) {
                setText("fact-refresh", refresh.note);
                return;
            }
            setText("fact-refresh", fmt(refresh.estimatedHz) + " Hz from a median interval of "
                + fmt(refresh.medianIntervalMs) + " ms. Min " + fmt(refresh.minIntervalMs)
                + " ms, max " + fmt(refresh.maxIntervalMs) + " ms. "
                + refresh.longIntervals + " of " + refresh.intervalsUsed
                + " intervals were longer than 1.5 times the median. "
                + "The first " + refresh.warmupDropped + " intervals were left out. "
                + refresh.note);
        }

        report.environment = environment();
        paintEnvironment(report.environment);
        paintClockStep(null);
        paintTimers(null);
        paintRefresh(null);

        function setBusy(next) {
            busy = next;
            btnRun.disabled = next;
            btnClock.disabled = next;
        }

        async function measureTimers() {
            var backgrounded = global.document.hidden;
            var delays = [];
            var d;
            var r;
            for (d = 0; d < TIMER_DELAYS.length; d++) {
                var observed = [];
                for (r = 0; r < TIMER_REPS; r++) {
                    if (global.document.hidden) backgrounded = true;
                    observed.push(await delay(TIMER_DELAYS[d]));
                }
                delays.push({
                    requestedMs: TIMER_DELAYS[d],
                    reps: TIMER_REPS,
                    observedMs: observed.map(round2),
                    medianObservedMs: round2(median(observed))
                });
            }
            return {
                backgrounded: backgrounded,
                delays: delays,
                note: "setTimeout is not locked to the display. A background tab can delay it further."
            };
        }

        async function measureRefresh() {
            if (typeof global.requestAnimationFrame !== "function") {
                return {
                    aborted: true,
                    note: "This browser has no requestAnimationFrame, so this page cannot estimate a refresh rate."
                };
            }
            if (global.document.hidden) {
                return {
                    aborted: true,
                    note: "This tab was in the background. Leave it visible and estimate the refresh again."
                };
            }
            var stamps = [];
            stamps.push(await nextFrame());
            var i;
            for (i = 0; i < FRAME_COUNT; i++) {
                if (global.document.hidden) {
                    return {
                        aborted: true,
                        note: "The tab went to the background during the sample. That estimate was discarded. Leave the tab visible and run it again."
                    };
                }
                stamps.push(await nextFrame());
            }
            var deltas = [];
            for (i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
            var used = deltas.slice(WARMUP);
            var med = median(used);
            var longCount = 0;
            var min = used[0];
            var max = used[0];
            for (i = 0; i < used.length; i++) {
                if (used[i] < min) min = used[i];
                if (used[i] > max) max = used[i];
                if (med != null && used[i] > med * 1.5) longCount += 1;
            }
            return {
                aborted: false,
                framesRequested: FRAME_COUNT,
                warmupDropped: WARMUP,
                intervalsUsed: used.length,
                medianIntervalMs: round2(med),
                minIntervalMs: round2(min),
                maxIntervalMs: round2(max),
                estimatedHz: med ? round2(1000 / med) : null,
                longIntervals: longCount,
                note: "This is the requestAnimationFrame callback rate while the tab was visible. It can be lower than the rate printed on the monitor. It is not a measurement of when the pixels changed."
            };
        }

        async function runDevice() {
            if (busy || clockLive) return;
            setBusy(true);
            try {
                say("Checking the page clock, then timers, then the animation callback. Keep this tab visible.");
                report.clock = clockStep();
                paintClockStep(report.clock);
                say("Checking setTimeout. Keep this tab visible.");
                report.timers = await measureTimers();
                paintTimers(report.timers);
                say("Estimating the animation callback. Keep this tab visible.");
                report.refresh = await measureRefresh();
                paintRefresh(report.refresh);
                report.environment.visibilityState = global.document.visibilityState;
                setText("fact-visibility", report.environment.visibilityState);
                say("Device check finished. The response-clock flashes are separate. Download writes a JSON file on this computer.");
            } catch (err) {
                say("The check stopped before it finished. Leave this tab visible and run it again.");
            } finally {
                setBusy(false);
            }
        }

        function renderPresses() {
            var presses = report.responseClock ? report.responseClock.presses : [];
            clockRows.textContent = "";
            presses.forEach(function (press) {
                var tr = global.document.createElement("tr");
                var cells = [
                    String(press.index),
                    fmt(press.foreperiodMs),
                    press.noPress ? "no press" : fmt(press.pageClockMs),
                    press.handlerGapMs == null ? "—" : fmt(press.handlerGapMs),
                    press.note
                ];
                cells.forEach(function (text) {
                    var td = global.document.createElement("td");
                    td.textContent = text;
                    tr.appendChild(td);
                });
                clockRows.appendChild(tr);
            });
            var scored = presses.filter(function (press) { return !press.noPress && press.pageClockMs != null; });
            if (!presses.length) {
                clockSummary.textContent = "No flashes yet.";
                return;
            }
            var med = median(scored.map(function (press) { return press.pageClockMs; }));
            clockSummary.textContent = scored.length
                ? "Median of the presses that landed, on the page clock: " + fmt(med) + " ms. That number is not a reaction-time score for a study."
                : "No press landed in this run.";
        }

        function finishPress(event) {
            if (!waiting || !current) return;
            waiting = false;
            pad.classList.remove("is-on");
            if (responseTimer) {
                global.clearTimeout(responseTimer);
                responseTimer = null;
            }
            var token = current.token;
            var now = global.performance.now();
            var pageClock = now - current.onset;
            var stamp = event && typeof event.timeStamp === "number" ? event.timeStamp : null;
            var sameClock = stamp != null && Math.abs(stamp - now) < 60000;
            var noPress = !event;
            report.responseClock.presses.push({
                index: report.responseClock.presses.length + 1,
                foreperiodMs: round2(current.foreperiodMs),
                pageClockMs: noPress ? null : round2(pageClock),
                onsetPerfMs: current.onset,
                frameTs: current.frameTs,
                responsePerfMs: noPress ? null : now,
                eventTimeStamp: stamp,
                handlerGapMs: !noPress && sameClock ? round2(now - stamp) : null,
                eventType: event ? event.type : "",
                noPress: noPress,
                backgrounded: global.document.hidden,
                note: noPress
                    ? "No input before 3 s. The square was cleared."
                    : (sameClock
                        ? "Page clock is performance.now() at the handler minus performance.now() in the frame that changed the color. Handler gap is that handler time minus event.timeStamp."
                        : "event.timeStamp is not on the same clock as performance.now() here, so the handler gap was left blank.")
            });
            renderPresses();
            if (token !== runToken) return;
            if (report.responseClock.presses.length >= CLOCK_FLASHES) {
                say("Five flashes finished. Download includes them. They are a clock check on this page, not a study.");
                endClock();
                return;
            }
            scheduleFlash(token);
        }

        function endClock() {
            clockLive = false;
            btnClockStop.disabled = true;
            if (!busy) btnRun.disabled = false;
        }

        function scheduleFlash(token) {
            var fore = FOREPERIOD_MIN + Math.random() * (FOREPERIOD_MAX - FOREPERIOD_MIN);
            var scheduledAt = global.performance.now();
            say("Flash " + (report.responseClock.presses.length + 1) + " of " + CLOCK_FLASHES + ". Wait for the square to turn light, then press a key or click it.");
            global.setTimeout(function () {
                if (token !== runToken) return;
                global.requestAnimationFrame(function (frameTs) {
                    if (token !== runToken) return;
                    if (global.document.hidden) {
                        report.responseClock.aborted = true;
                        report.responseClock.note = "The tab was hidden, so the remaining flashes were stopped.";
                        say(report.responseClock.note);
                        endClock();
                        return;
                    }
                    pad.classList.add("is-on");
                    var onset = global.performance.now();
                    waiting = true;
                    current = {
                        token: token,
                        onset: onset,
                        frameTs: frameTs,
                        foreperiodMs: onset - scheduledAt
                    };
                    responseTimer = global.setTimeout(function () {
                        finishPress(null);
                    }, RESPONSE_WINDOW_MS);
                });
            }, fore);
        }

        function onKey(event) {
            if (event.key === "Escape" && clockLive) {
                event.preventDefault();
                stopClock();
                return;
            }
            if (!waiting || event.repeat) return;
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            event.preventDefault();
            finishPress(event);
        }

        function onPointer(event) {
            if (!waiting) return;
            if (event.target !== pad) return;
            event.preventDefault();
            finishPress(event);
        }

        function startClock() {
            if (busy || clockLive) return;
            if (typeof global.requestAnimationFrame !== "function") {
                say("This browser has no requestAnimationFrame, so the response clock cannot mark a paint frame.");
                return;
            }
            runToken += 1;
            clockLive = true;
            btnRun.disabled = true;
            waiting = false;
            pad.classList.remove("is-on");
            report.responseClock = {
                flashesPlanned: CLOCK_FLASHES,
                foreperiodMinMs: FOREPERIOD_MIN,
                foreperiodMaxMs: FOREPERIOD_MAX,
                responseWindowMs: RESPONSE_WINDOW_MS,
                aborted: false,
                note: "Each flash waits 500–900 ms, then requestAnimationFrame changes the square. The page clock starts in that callback, when the color change is requested, not when light leaves the glass.",
                presses: []
            };
            renderPresses();
            btnClockStop.disabled = false;
            scheduleFlash(runToken);
        }

        function stopClock() {
            runToken += 1;
            waiting = false;
            pad.classList.remove("is-on");
            if (responseTimer) {
                global.clearTimeout(responseTimer);
                responseTimer = null;
            }
            endClock();
            say("Response-clock run stopped. Presses already listed stay in the report until you start again.");
        }

        function download() {
            var payload = {
                schema: report.schema,
                source: report.source,
                page: report.page,
                notAValidation: true,
                notUploaded: true,
                libraryVersion: global.TrialSite && global.TrialSite.version ? global.TrialSite.version : report.libraryVersion,
                generatedAt: new Date().toISOString(),
                environment: report.environment,
                clock: report.clock,
                timers: report.timers,
                refresh: report.refresh,
                responseClock: report.responseClock,
                limits: limitTexts()
            };
            var text = JSON.stringify(payload, null, 2) + "\n";
            var blob = new Blob([text], { type: "application/json;charset=utf-8" });
            var url = global.URL.createObjectURL(blob);
            var link = global.document.createElement("a");
            var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            link.href = url;
            link.download = "project-trial-device-check_" + stamp + ".json";
            global.document.body.appendChild(link);
            link.click();
            global.document.body.removeChild(link);
            global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1500);
            say("Report downloaded on this computer. It was not uploaded.");
        }

        btnRun.addEventListener("click", function () { runDevice(); });
        btnClock.addEventListener("click", startClock);
        btnClockStop.addEventListener("click", stopClock);
        btnDownload.addEventListener("click", download);
        global.document.addEventListener("keydown", onKey);
        pad.addEventListener("pointerdown", onPointer);
        btnClockStop.disabled = true;
        say("Environment is filled in. Run the device check while this tab is visible. The flashes are optional.");
    }

    if (global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})(typeof window !== "undefined" ? window : globalThis);
