/*
  Device check for Project Trial.

  One page runs one check: the animation callback, setTimeout lateness,
  the step of performance.now(), or the page clock from a color change
  to an input event. The researcher runs it on their own machine.

  Nothing is uploaded. Nothing is written to localStorage except a
  one-key probe that is removed before the function returns. Verdicts
  are not stored. This is not a study and not a photodiode validation.

  TrialDeviceCheck exposes the verdict helpers used by these pages.
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
    var COMMON_RATES_HZ = [50, 60, 75, 90, 120, 144, 165];
    var REFRESH_TOLERANCE_HZ = 5;
    var TIMER_LATENESS_MS = 8;
    var TIMER_ZERO_FAIL_MS = 20;
    var CLOCK_MAX_MEDIAN_MS = 1;
    var SCHEMA = "project-trial.device-check.v2";

    var PAGES = {
        refresh: "diagnostics-refresh.html",
        timers: "diagnostics-timers.html",
        clock: "diagnostics-clock.html",
        "page-clock": "diagnostics-page-clock.html"
    };

    var MARKS = {
        pass: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M7.2 12.5 l3.1 3.1 6.6-7" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
        fail: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8.2 8.2 l7.6 7.6 M15.8 8.2 l-7.6 7.6" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>',
        could_not_run: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M8 12 h8" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/></svg>'
    };

    var VERDICT_LABEL = {
        pass: "Pass",
        fail: "Fail",
        could_not_run: "Could not run"
    };

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

    function libraryVersion() {
        if (global.TrialSite && global.TrialSite.version) return global.TrialSite.version;
        return "0.1.0";
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

    function readEnvironment(storageNote) {
        var nav = global.navigator || {};
        var screen = global.screen || {};
        var perf = global.performance;
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
            visibilityState: global.document ? global.document.visibilityState : "",
            timeOrigin: perf && perf.timeOrigin ? perf.timeOrigin : null,
            storageProbe: storageNote == null ? storageProbe() : storageNote,
            requestAnimationFrame: typeof global.requestAnimationFrame === "function"
        };
    }

    function thresholdsFor(check) {
        if (check === "refresh") {
            return {
                kind: "rules-of-thumb",
                notALabCertificate: true,
                commonRatesHz: COMMON_RATES_HZ.slice(),
                toleranceHz: REFRESH_TOLERANCE_HZ,
                belowHzFails: COMMON_RATES_HZ[0] - REFRESH_TOLERANCE_HZ,
                framesRequested: FRAME_COUNT,
                warmupDropped: WARMUP,
                pass: "The tab stayed visible and the estimated rate is within ±5 Hz of 50, 60, 75, 90, 120, 144, or 165 Hz.",
                fail: "The estimate completed and is not within ±5 Hz of one of those rates. A rate below 45 Hz fails.",
                couldNotRun: "The tab was hidden during the sample, or requestAnimationFrame is missing. The hidden-tab sample is discarded. This is not a machine fail."
            };
        }
        if (check === "timers") {
            return {
                kind: "rules-of-thumb",
                notALabCertificate: true,
                delaysMs: TIMER_DELAYS.slice(),
                reps: TIMER_REPS,
                scoredDelaysMs: [16, 50],
                maxMedianLatenessMs: TIMER_LATENESS_MS,
                zeroDelayFailIfMedianObservedMsGreaterThan: TIMER_ZERO_FAIL_MS,
                pass: "The tab stayed visible and, for the 16 ms and 50 ms delays, the median of observed minus requested is 8 ms or less. The 0 ms delay is not a fail on its own unless its median observed time is above 20 ms.",
                fail: "The 16 ms or 50 ms median lateness is above 8 ms, or the 0 ms median observed time is above 20 ms.",
                couldNotRun: "The tab was hidden during the check. This is not a machine fail."
            };
        }
        if (check === "clock") {
            return {
                kind: "rules-of-thumb",
                notALabCertificate: true,
                maxMedianStepMs: CLOCK_MAX_MEDIAN_MS,
                changesSought: 20,
                pass: "The median performance.now() step is 1 ms or less.",
                fail: "The median step is coarser than 1 ms, or the clock did not move in the sample loop.",
                couldNotRun: "The tab was hidden, or performance.now() is missing. This is not a machine fail."
            };
        }
        return {
            kind: "rules-of-thumb",
            notALabCertificate: true,
            flashes: CLOCK_FLASHES,
            foreperiodMinMs: FOREPERIOD_MIN,
            foreperiodMaxMs: FOREPERIOD_MAX,
            responseWindowMs: RESPONSE_WINDOW_MS,
            scoreMilliseconds: false,
            pass: "All five flashes got a key or a click and returned a page-clock number. The millisecond value is not scored.",
            fail: "Any flash was missed, or a flash did not return a number.",
            couldNotRun: "The run stopped before five flashes finished, the tab was hidden, or requestAnimationFrame is missing. This is not a machine fail."
        };
    }

    function notes() {
        return {
            notAValidation: "This is a support step on this tab. It is not a study, not a photodiode or light-sensor validation, and not a lab certificate.",
            notUploaded: "Nothing is uploaded. The file is written only because you chose Download this report."
        };
    }

    function matchingRates(hz) {
        return COMMON_RATES_HZ.filter(function (rate) {
            return Math.abs(hz - rate) <= REFRESH_TOLERANCE_HZ;
        });
    }

    function rateWords(rates) {
        return rates.map(function (rate) { return rate + " Hz"; }).join(" and ");
    }

    function verdictRefresh(refresh) {
        if (!refresh) {
            return { outcome: null, summary: "Not run yet." };
        }
        if (refresh.aborted) {
            return {
                outcome: "could_not_run",
                summary: (refresh.note || "This check did not run.") + " This is not a machine fail."
            };
        }
        if (refresh.estimatedHz == null) {
            return {
                outcome: "fail",
                summary: "The sample finished, but it did not produce a rate within ±5 Hz of a common refresh."
            };
        }
        var matches = matchingRates(refresh.estimatedHz);
        if (matches.length) {
            return {
                outcome: "pass",
                summary: fmt(refresh.estimatedHz) + " Hz is within ±5 Hz of " + rateWords(matches) + "."
            };
        }
        var below = refresh.estimatedHz < (COMMON_RATES_HZ[0] - REFRESH_TOLERANCE_HZ)
            ? " It is below 45 Hz."
            : "";
        return {
            outcome: "fail",
            summary: fmt(refresh.estimatedHz) + " Hz is not within ±5 Hz of 50, 60, 75, 90, 120, 144, or 165 Hz." + below
        };
    }

    function rowByDelay(timers, ms) {
        var delays = timers && timers.delays ? timers.delays : [];
        var i;
        for (i = 0; i < delays.length; i++) {
            if (delays[i].requestedMs === ms) return delays[i];
        }
        return null;
    }

    function verdictTimers(timers) {
        if (!timers || !timers.delays) {
            return { outcome: "could_not_run", summary: "The timer check did not finish. This is not a machine fail." };
        }
        if (timers.backgrounded) {
            return {
                outcome: "could_not_run",
                summary: "The tab was hidden during the check, so this run was not scored. This is not a machine fail."
            };
        }
        var zero = rowByDelay(timers, 0);
        var mid = rowByDelay(timers, 16);
        var slow = rowByDelay(timers, 50);
        if (!zero || !mid || !slow
            || zero.medianObservedMs == null
            || mid.medianLatenessMs == null
            || slow.medianLatenessMs == null) {
            return {
                outcome: "could_not_run",
                summary: "The timer check did not return a median for every delay. This is not a machine fail."
            };
        }
        var problems = [];
        if (mid.medianLatenessMs > TIMER_LATENESS_MS) {
            problems.push("the 16 ms median lateness is " + fmt(mid.medianLatenessMs) + " ms, above 8 ms");
        }
        if (slow.medianLatenessMs > TIMER_LATENESS_MS) {
            problems.push("the 50 ms median lateness is " + fmt(slow.medianLatenessMs) + " ms, above 8 ms");
        }
        if (zero.medianObservedMs > TIMER_ZERO_FAIL_MS) {
            problems.push("the 0 ms median observed time is " + fmt(zero.medianObservedMs) + " ms, above 20 ms");
        }
        if (problems.length) {
            return { outcome: "fail", summary: problems.join(". ") + "." };
        }
        return {
            outcome: "pass",
            summary: "Median lateness is " + fmt(mid.medianLatenessMs) + " ms at 16 ms and "
                + fmt(slow.medianLatenessMs) + " ms at 50 ms. Both are 8 ms or less. The 0 ms median observed time is "
                + fmt(zero.medianObservedMs) + " ms."
        };
    }

    function verdictClock(step) {
        if (!step) {
            return { outcome: null, summary: "Not run yet." };
        }
        if (step.unavailable || step.aborted || step.backgrounded) {
            return {
                outcome: "could_not_run",
                summary: (step.note || "This check did not run.") + " This is not a machine fail."
            };
        }
        if (!step.samples || step.medianStepMs == null) {
            return {
                outcome: "fail",
                summary: "performance.now() did not move in the sample loop."
            };
        }
        if (step.medianStepMs > CLOCK_MAX_MEDIAN_MS) {
            return {
                outcome: "fail",
                summary: "The median step is " + fmt(step.medianStepMs) + " ms, which is coarser than 1 ms."
            };
        }
        return {
            outcome: "pass",
            summary: "The median step is " + fmt(step.medianStepMs) + " ms, which is 1 ms or finer."
        };
    }

    function verdictPageClock(rc) {
        if (!rc) {
            return { outcome: null, summary: "Not run yet." };
        }
        if (rc.unavailable) {
            return {
                outcome: "could_not_run",
                summary: (rc.note || "This browser could not run the page clock.") + " This is not a machine fail."
            };
        }
        var presses = rc.presses || [];
        if (rc.inProgress) {
            return { outcome: null, label: "Running", summary: "Keep this tab visible until five flashes finish." };
        }
        if (rc.hidden || rc.aborted || rc.stopped || presses.length < CLOCK_FLASHES) {
            var why = "Five flashes did not finish.";
            if (rc.hidden || rc.aborted) {
                why = "The tab was hidden before five flashes finished, so the remaining flashes were stopped.";
            } else if (rc.stopped) {
                why = "The run stopped before five flashes finished.";
            }
            return { outcome: "could_not_run", summary: why + " This is not a machine fail." };
        }
        var backgrounded = false;
        var missed = [];
        var i;
        for (i = 0; i < presses.length; i++) {
            if (presses[i].backgrounded) backgrounded = true;
            if (presses[i].noPress || presses[i].pageClockMs == null) missed.push(presses[i].index);
        }
        if (backgrounded) {
            return {
                outcome: "could_not_run",
                summary: "The tab was in the background during a flash, so this run was not scored. This is not a machine fail."
            };
        }
        if (missed.length) {
            var noun = missed.length === 1 ? "Flash " + missed[0] + " was missed or did not return a number."
                : "Flashes " + missed.join(", ") + " were missed or did not return a number.";
            return {
                outcome: "fail",
                summary: noun + " The millisecond values are not scored."
            };
        }
        return {
            outcome: "pass",
            summary: "All five flashes got a press and returned a page-clock number. Do not enter those milliseconds as a participant's reaction time."
        };
    }

    function clockStep() {
        if (!global.performance || typeof global.performance.now !== "function") {
            return {
                unavailable: true,
                aborted: true,
                samples: 0,
                minStepMs: null,
                medianStepMs: null,
                note: "This browser has no performance.now(), so this page cannot read the clock step."
            };
        }
        if (global.document.hidden) {
            return {
                aborted: true,
                backgrounded: true,
                samples: 0,
                minStepMs: null,
                medianStepMs: null,
                note: "This tab was in the background. Leave it visible and check the clock step again."
            };
        }
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
            var med = round2(median(observed));
            delays.push({
                requestedMs: TIMER_DELAYS[d],
                reps: TIMER_REPS,
                observedMs: observed.map(round2),
                medianObservedMs: med,
                medianLatenessMs: med == null ? null : round2(med - TIMER_DELAYS[d])
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
                unavailable: true,
                note: "This browser has no requestAnimationFrame, so this page cannot estimate a refresh rate."
            };
        }
        if (global.document.hidden) {
            return {
                aborted: true,
                hidden: true,
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
                    hidden: true,
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

    function blockTexts(id) {
        var root = global.document.getElementById(id);
        if (!root) return [];
        var nodes = root.matches("p, li") ? [root] : root.querySelectorAll("p, li");
        return Array.prototype.map.call(nodes, function (node) {
            return node.textContent.replace(/\s+/g, " ").trim();
        }).filter(Boolean);
    }

    global.TrialDeviceCheck = {
        schema: SCHEMA,
        pages: PAGES,
        thresholdsFor: thresholdsFor,
        verdictRefresh: verdictRefresh,
        verdictTimers: verdictTimers,
        verdictClock: verdictClock,
        verdictPageClock: verdictPageClock,
        median: median,
        round2: round2
    };

    function boot() {
        var check = global.document.body && global.document.body.getAttribute("data-device-check");
        if (!PAGES[check]) return;
        if (check === "refresh") initRefresh();
        else if (check === "timers") initTimers();
        else if (check === "clock") initClock();
        else initPageClock();
    }

    function mount(check) {
        var report = {
            schema: SCHEMA,
            source: "project-trial",
            check: check,
            page: PAGES[check],
            notAValidation: true,
            notUploaded: true,
            notAStudy: true,
            notes: notes(),
            libraryVersion: libraryVersion(),
            thresholds: thresholdsFor(check),
            environment: null,
            measurements: null,
            verdict: null,
            verdictSummary: "Not run yet.",
            inProgress: false
        };
        var status = global.document.getElementById("device-status");
        var btnRun = global.document.getElementById("btn-run");
        var btnDownload = global.document.getElementById("btn-download");
        var btnStop = global.document.getElementById("btn-stop");
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

        function showVerdict(result) {
            var outcome = result && result.outcome ? result.outcome : "";
            var box = global.document.getElementById("device-verdict");
            var mark = global.document.getElementById("device-mark");
            var label = global.document.getElementById("device-verdict-label");
            var text = global.document.getElementById("device-verdict-text");
            if (box) {
                box.setAttribute("data-outcome", outcome);
                box.classList.toggle("is-idle", !outcome);
                box.setAttribute("aria-busy", result && result.inProgress ? "true" : "false");
            }
            if (mark) mark.innerHTML = MARKS[outcome] || "";
            if (label) label.textContent = (result && result.label) || VERDICT_LABEL[outcome] || "Not run yet";
            if (text) text.textContent = result && result.summary ? result.summary : "";
            report.verdict = outcome || null;
            report.verdictSummary = result && result.summary ? result.summary : "";
            report.inProgress = !!(result && result.inProgress);
        }

        function running(sentence) {
            showVerdict({ label: "Running", summary: sentence, inProgress: true });
            say(sentence);
        }

        report.environment = readEnvironment(null);
        paintEnvironment(report.environment);
        showVerdict({
            summary: "Not run yet. Pass uses a check icon and the word Pass. Fail uses a cross icon and the word Fail."
        });

        function download() {
            var previous = report.environment && report.environment.storageProbe;
            report.environment = readEnvironment(previous);
            report.libraryVersion = libraryVersion();
            paintEnvironment(report.environment);
            var payload = {
                schema: report.schema,
                source: report.source,
                check: report.check,
                page: report.page,
                notAValidation: true,
                notUploaded: true,
                notAStudy: true,
                notes: report.notes,
                libraryVersion: report.libraryVersion,
                generatedAt: new Date().toISOString(),
                environment: report.environment,
                thresholds: report.thresholds,
                measurements: report.measurements,
                verdict: report.inProgress ? null : report.verdict,
                verdictSummary: report.inProgress ? "This run is still in progress." : report.verdictSummary,
                interpretation: blockTexts("device-interpretation"),
                limits: blockTexts("device-limits")
            };
            var text = JSON.stringify(payload, null, 2) + "\n";
            var blob = new Blob([text], { type: "application/json;charset=utf-8" });
            var url = global.URL.createObjectURL(blob);
            var link = global.document.createElement("a");
            var stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            link.href = url;
            link.download = "project-trial-device-check-" + check + "_" + stamp + ".json";
            global.document.body.appendChild(link);
            link.click();
            global.document.body.removeChild(link);
            global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1500);
            say("Report downloaded on this computer. It was not uploaded.");
        }

        if (btnDownload) btnDownload.addEventListener("click", download);
        if (btnStop) btnStop.disabled = true;

        return {
            report: report,
            say: say,
            setText: setText,
            btnRun: btnRun,
            btnStop: btnStop,
            showVerdict: showVerdict,
            running: running,
            isBusy: function () { return busy; },
            setBusy: function (next) {
                busy = next;
                if (btnRun) btnRun.disabled = next;
            },
            touchVisibility: function () {
                if (!report.environment) return;
                report.environment.visibilityState = global.document.visibilityState;
                setText("fact-visibility", report.environment.visibilityState);
            }
        };
    }

    function initRefresh() {
        var ui = mount("refresh");

        function paint(refresh) {
            if (!refresh) {
                ui.setText("fact-hz", "not run yet");
                ui.setText("fact-median", "—");
                ui.setText("fact-min", "—");
                ui.setText("fact-max", "—");
                ui.setText("fact-long", "—");
                ui.setText("fact-sample", "—");
                ui.setText("fact-note", "Not run yet.");
                return;
            }
            if (refresh.aborted) {
                ui.setText("fact-hz", "not scored");
                ui.setText("fact-median", "—");
                ui.setText("fact-min", "—");
                ui.setText("fact-max", "—");
                ui.setText("fact-long", "—");
                ui.setText("fact-sample", "discarded");
                ui.setText("fact-note", refresh.note);
                return;
            }
            ui.setText("fact-hz", fmt(refresh.estimatedHz) + " Hz");
            ui.setText("fact-median", fmt(refresh.medianIntervalMs) + " ms");
            ui.setText("fact-min", fmt(refresh.minIntervalMs) + " ms");
            ui.setText("fact-max", fmt(refresh.maxIntervalMs) + " ms");
            ui.setText("fact-long", refresh.longIntervals + " of " + refresh.intervalsUsed
                + " longer than 1.5 times the median");
            ui.setText("fact-sample", refresh.framesRequested + " frames requested, first "
                + refresh.warmupDropped + " intervals left out, " + refresh.intervalsUsed + " intervals used");
            ui.setText("fact-note", refresh.note);
        }

        paint(null);
        ui.say("Environment is filled in. Estimate the refresh while this tab is visible.");

        async function run() {
            if (ui.isBusy()) return;
            ui.setBusy(true);
            ui.running("Estimating the animation callback. Keep this tab visible.");
            paint(null);
            try {
                ui.report.measurements = await measureRefresh();
                paint(ui.report.measurements);
                ui.touchVisibility();
                ui.showVerdict(verdictRefresh(ui.report.measurements));
                ui.say("Refresh check finished. Download writes a JSON file on this computer. It was not uploaded.");
            } catch (err) {
                ui.report.measurements = {
                    aborted: true,
                    note: "The check stopped before it finished. Leave this tab visible and run it again."
                };
                paint(ui.report.measurements);
                ui.showVerdict(verdictRefresh(ui.report.measurements));
                ui.say("The check stopped before it finished.");
            } finally {
                ui.setBusy(false);
            }
        }

        if (ui.btnRun) ui.btnRun.addEventListener("click", function () { run(); });
    }

    function initTimers() {
        var ui = mount("timers");
        var tbody = global.document.getElementById("timer-rows");

        function paint(timers) {
            if (tbody) tbody.textContent = "";
            if (!timers) {
                if (tbody) {
                    var empty = global.document.createElement("tr");
                    var cell = global.document.createElement("td");
                    cell.colSpan = 5;
                    cell.textContent = "Not run yet.";
                    empty.appendChild(cell);
                    tbody.appendChild(empty);
                }
                ui.setText("fact-note", "Not run yet.");
                return;
            }
            timers.delays.forEach(function (row) {
                var tr = global.document.createElement("tr");
                var cells = [
                    String(row.requestedMs),
                    String(row.reps),
                    fmt(row.medianObservedMs),
                    fmt(row.medianLatenessMs),
                    row.observedMs.map(fmt).join(", ")
                ];
                cells.forEach(function (text) {
                    var td = global.document.createElement("td");
                    td.textContent = text;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            var tail = timers.backgrounded
                ? " The tab was hidden during at least part of this check."
                : " The tab stayed visible for these callbacks.";
            ui.setText("fact-note", timers.note + tail);
        }

        paint(null);
        ui.say("Environment is filled in. Check the timers while this tab is visible.");

        async function run() {
            if (ui.isBusy()) return;
            ui.setBusy(true);
            ui.running("Checking setTimeout. Keep this tab visible.");
            paint(null);
            try {
                ui.report.measurements = await measureTimers();
                paint(ui.report.measurements);
                ui.touchVisibility();
                ui.showVerdict(verdictTimers(ui.report.measurements));
                ui.say("Timer check finished. Download writes a JSON file on this computer. It was not uploaded.");
            } catch (err) {
                ui.report.measurements = null;
                paint(null);
                ui.showVerdict({
                    outcome: "could_not_run",
                    summary: "The check stopped before it finished. This is not a machine fail."
                });
                ui.say("The check stopped before it finished.");
            } finally {
                ui.setBusy(false);
            }
        }

        if (ui.btnRun) ui.btnRun.addEventListener("click", function () { run(); });
    }

    function initClock() {
        var ui = mount("clock");

        function paint(step) {
            if (!step) {
                ui.setText("fact-median", "not run yet");
                ui.setText("fact-min", "—");
                ui.setText("fact-samples", "—");
                ui.setText("fact-note", "Not run yet.");
                return;
            }
            if (step.aborted) {
                ui.setText("fact-median", "not scored");
                ui.setText("fact-min", "—");
                ui.setText("fact-samples", "0");
                ui.setText("fact-note", step.note);
                return;
            }
            if (step.minStepMs == null) {
                ui.setText("fact-median", "no change");
                ui.setText("fact-min", "no change");
                ui.setText("fact-samples", "0");
                ui.setText("fact-note", step.note);
                return;
            }
            ui.setText("fact-median", fmt(step.medianStepMs) + " ms");
            ui.setText("fact-min", fmt(step.minStepMs) + " ms");
            ui.setText("fact-samples", String(step.samples) + " changes");
            ui.setText("fact-note", step.note);
        }

        paint(null);
        ui.say("Environment is filled in. Check the clock step while this tab is visible.");

        function run() {
            if (ui.isBusy()) return;
            ui.setBusy(true);
            ui.running("Reading performance.now(). Keep this tab visible.");
            try {
                ui.report.measurements = clockStep();
                paint(ui.report.measurements);
                ui.touchVisibility();
                ui.showVerdict(verdictClock(ui.report.measurements));
                ui.say("Clock step finished. Download writes a JSON file on this computer. It was not uploaded.");
            } catch (err) {
                ui.report.measurements = {
                    aborted: true,
                    samples: 0,
                    minStepMs: null,
                    medianStepMs: null,
                    note: "The check stopped before it finished. Leave this tab visible and run it again."
                };
                paint(ui.report.measurements);
                ui.showVerdict(verdictClock(ui.report.measurements));
                ui.say("The check stopped before it finished.");
            } finally {
                ui.setBusy(false);
            }
        }

        if (ui.btnRun) ui.btnRun.addEventListener("click", run);
    }

    function initPageClock() {
        var ui = mount("page-clock");
        var pad = global.document.getElementById("clock-pad");
        var clockRows = global.document.getElementById("clock-rows");
        var clockSummary = global.document.getElementById("clock-summary");
        var runToken = 0;
        var waiting = false;
        var clockLive = false;
        var current = null;
        var responseTimer = null;

        function renderPresses() {
            var presses = ui.report.measurements && ui.report.measurements.presses
                ? ui.report.measurements.presses
                : [];
            if (clockRows) clockRows.textContent = "";
            if (!presses.length && clockRows) {
                var empty = global.document.createElement("tr");
                var cell = global.document.createElement("td");
                cell.colSpan = 5;
                cell.textContent = "No flashes yet.";
                empty.appendChild(cell);
                clockRows.appendChild(empty);
            }
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
                if (clockRows) clockRows.appendChild(tr);
            });
            var scored = presses.filter(function (press) {
                return !press.noPress && press.pageClockMs != null;
            });
            if (!clockSummary) return;
            if (!presses.length) {
                clockSummary.textContent = "No flashes yet.";
                return;
            }
            var med = median(scored.map(function (press) { return press.pageClockMs; }));
            clockSummary.textContent = scored.length
                ? "Median of the presses that landed, on the page clock: " + fmt(med)
                    + " ms. That number is not a reaction-time score, and the verdict does not use it."
                : "No press landed in this run.";
        }

        function endClock() {
            clockLive = false;
            waiting = false;
            if (pad) pad.classList.remove("is-on");
            if (responseTimer) {
                global.clearTimeout(responseTimer);
                responseTimer = null;
            }
            if (ui.btnStop) ui.btnStop.disabled = true;
            if (ui.btnRun) ui.btnRun.disabled = false;
        }

        function finishScored() {
            ui.report.inProgress = false;
            if (ui.report.measurements) ui.report.measurements.inProgress = false;
            endClock();
            ui.showVerdict(verdictPageClock(ui.report.measurements));
        }

        function finishPress(event) {
            if (!waiting || !current || !ui.report.measurements) return;
            waiting = false;
            if (pad) pad.classList.remove("is-on");
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
            ui.report.measurements.presses.push({
                index: ui.report.measurements.presses.length + 1,
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
            if (ui.report.measurements.presses.length >= CLOCK_FLASHES) {
                finishScored();
                ui.say("Five flashes finished. Download writes a JSON file on this computer. It was not uploaded.");
                return;
            }
            scheduleFlash(token);
        }

        function scheduleFlash(token) {
            var fore = FOREPERIOD_MIN + Math.random() * (FOREPERIOD_MAX - FOREPERIOD_MIN);
            var scheduledAt = global.performance.now();
            ui.say("Flash " + (ui.report.measurements.presses.length + 1) + " of " + CLOCK_FLASHES
                + ". Wait for the square to turn light, then press a key or click it.");
            global.setTimeout(function () {
                if (token !== runToken) return;
                global.requestAnimationFrame(function (frameTs) {
                    if (token !== runToken || !ui.report.measurements) return;
                    if (global.document.hidden) {
                        ui.report.measurements.aborted = true;
                        ui.report.measurements.hidden = true;
                        ui.report.measurements.inProgress = false;
                        ui.report.measurements.note = "The tab was hidden, so the remaining flashes were stopped.";
                        ui.report.inProgress = false;
                        endClock();
                        ui.showVerdict(verdictPageClock(ui.report.measurements));
                        ui.say(ui.report.measurements.note);
                        return;
                    }
                    if (pad) pad.classList.add("is-on");
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
            if (ui.isBusy() || clockLive) return;
            if (typeof global.requestAnimationFrame !== "function") {
                ui.report.measurements = {
                    unavailable: true,
                    aborted: true,
                    flashesPlanned: CLOCK_FLASHES,
                    presses: [],
                    note: "This browser has no requestAnimationFrame, so the page clock cannot mark a frame."
                };
                ui.report.inProgress = false;
                renderPresses();
                ui.showVerdict(verdictPageClock(ui.report.measurements));
                ui.say(ui.report.measurements.note);
                return;
            }
            if (global.document.hidden) {
                ui.report.measurements = {
                    aborted: true,
                    hidden: true,
                    flashesPlanned: CLOCK_FLASHES,
                    presses: [],
                    note: "This tab was in the background. Leave it visible and start the flashes again."
                };
                ui.report.inProgress = false;
                renderPresses();
                ui.showVerdict(verdictPageClock(ui.report.measurements));
                ui.say(ui.report.measurements.note);
                return;
            }
            runToken += 1;
            clockLive = true;
            waiting = false;
            if (pad) pad.classList.remove("is-on");
            if (ui.btnRun) ui.btnRun.disabled = true;
            if (ui.btnStop) ui.btnStop.disabled = false;
            ui.report.inProgress = true;
            ui.report.measurements = {
                flashesPlanned: CLOCK_FLASHES,
                foreperiodMinMs: FOREPERIOD_MIN,
                foreperiodMaxMs: FOREPERIOD_MAX,
                responseWindowMs: RESPONSE_WINDOW_MS,
                aborted: false,
                hidden: false,
                stopped: false,
                inProgress: true,
                note: "Each flash waits 500–900 ms, then requestAnimationFrame changes the square. The page clock starts in that callback, when the color change is requested, not when light leaves the glass.",
                presses: []
            };
            renderPresses();
            ui.showVerdict({
                label: "Running",
                summary: "Wait for the square to turn light, then press a key or click it.",
                inProgress: true
            });
            scheduleFlash(runToken);
        }

        function stopClock() {
            if (!clockLive) return;
            runToken += 1;
            if (ui.report.measurements) {
                ui.report.measurements.stopped = true;
                ui.report.measurements.inProgress = false;
                ui.report.measurements.note = "Stopped before five flashes finished.";
            }
            ui.report.inProgress = false;
            endClock();
            ui.showVerdict(verdictPageClock(ui.report.measurements));
            ui.say("Stopped. Presses already listed stay on this page until you start again. Download was not uploaded.");
        }

        renderPresses();
        ui.say("Environment is filled in. Start the flashes while this tab is visible.");
        if (ui.btnRun) ui.btnRun.addEventListener("click", startClock);
        if (ui.btnStop) ui.btnStop.addEventListener("click", stopClock);
        global.document.addEventListener("keydown", onKey);
        if (pad) pad.addEventListener("pointerdown", onPointer);
    }

    if (global.document) {
        if (global.document.readyState === "loading") {
            global.document.addEventListener("DOMContentLoaded", boot);
        } else {
            boot();
        }
    }
})(typeof window !== "undefined" ? window : globalThis);
