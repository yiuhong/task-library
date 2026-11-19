/*
  Brightness task core.

  Parameters, the trial list, response mapping, timing, and feedback policy
  live here. The page shell only paints chrome and passes { mode, audio }.
  See assets/SHELL_CONTRACT.md.

  Documented exception: this task rates confidence and does not say whether
  the choice was right. Neither shell has a practice block, and neither
  shows Correct or Incorrect during a trial. Both shells run the same 40
  trials, 10 in each of LL, LH, HL, and HH.

  Gamified plays the neutral tick, choice, rating, start, and end tones,
  and a low buzz when a trial times out. Classical passes no audio, and
  playTone does nothing. Missed trials still skip the confidence rating.
  The end screen is the condition cards and the same interpretation sentence.
  Download CSV and Download JSON use TrialExport for the current run.
  There is no practice block and no correctness word in either shell.

  Fixation, the response window, the pause before a confidence rating
  accepts a key, and the blank between trials are scheduled by
  assets/trial-timing.js. Choice time starts when the patches are shown.
  Confidence time starts when the rating prompt is shown. A timeout
  skips the rating.
*/
(function (global) {
    var CONFIG = {
        trialsPerCondition: 10,
        timing: { fixation: 400, timeout: 3500, isi: 600 },
        conditions: [
            { id: "LL", diff: "Low", abs: "Low", vals: [55, 75] },
            { id: "LH", diff: "Low", abs: "High", vals: [200, 220] },
            { id: "HL", diff: "High", abs: "Low", vals: [40, 120] },
            { id: "HH", diff: "High", abs: "High", vals: [160, 240] }
        ]
    };

    var FEEDBACK = {
        gamified: {
            id: "arcade",
            audio: true,
            score: false,
            trialFeedback: false,
            practiceTrials: 0
        },
        classical: {
            id: "summary",
            audio: false,
            score: false,
            trialFeedback: false,
            practiceTrials: 0
        }
    };

    function freezeTree(value) {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) freezeTree(value[keys[i]]);
        return Object.freeze(value);
    }

    freezeTree(CONFIG);
    freezeTree(FEEDBACK);

    function mount(host) {
        var options = host || {};
        var mode = options.mode === "classical" ? "classical" : "gamified";
        var policy = FEEDBACK[mode];
        var audio = options.audio || null;
        var lastSummary = null;

        if (!global.TrialExport) {
            throw new Error("Brightness requires assets/trial-export.js");
        }
        if (!global.TrialTiming) {
            throw new Error("Brightness requires assets/trial-timing.js");
        }

        var timing = global.TrialTiming.session();

        function timingParams() {
            var snapshot = timing.policy();
            snapshot.responseOnset = "patches";
            snapshot.confidenceOnset = "confidence prompt";
            snapshot.intervals = ["fixation", "stimulus", "confidence-gate", "confidence", "iti"];
            return snapshot;
        }

        var exportLog = global.TrialExport.session({
            taskId: "brightness",
            mode: mode,
            params: function () {
                return {
                    trialsPerCondition: CONFIG.trialsPerCondition,
                    fixationMs: CONFIG.timing.fixation,
                    responseWindowMs: CONFIG.timing.timeout,
                    confidenceGateMs: 250,
                    itiMs: CONFIG.timing.isi,
                    timing: timingParams(),
                    conditions: CONFIG.conditions.map(function (cond) {
                        return {
                            id: cond.id,
                            diff: cond.diff,
                            abs: cond.abs,
                            vals: cond.vals.slice()
                        };
                    }),
                    presentation: {
                        policyId: policy.id,
                        trialFeedback: false,
                        audio: !!policy.audio,
                        score: false
                    }
                };
            },
            summary: function () { return lastSummary; }
        });

        var required = [
            "screen-welcome", "screen-task", "screen-results",
            "btn-start", "btn-restart",
            "trial-counter", "confidence-container",
            "square-left", "square-right", "fixation-cross", "footer-controls",
            "stimulus-container", "stimulus-row", "center-anchor",
            "key-f", "key-j", "key-conf-f", "key-conf-j",
            "conf-f-label", "conf-j-label",
            "interpretation-text", "orientation-note"
        ];
        var conditions = CONFIG.conditions;
        var c;
        for (c = 0; c < conditions.length; c++) {
            var cid = conditions[c].id;
            required.push("res-" + cid + "-corr-count");
            required.push("res-" + cid + "-corr-conf");
            required.push("res-" + cid + "-wrong-count");
            required.push("res-" + cid + "-wrong-conf");
        }
        var id;
        for (id = 0; id < required.length; id++) {
            if (!document.getElementById(required[id])) {
                throw new Error("Brightness shell is missing #" + required[id]);
            }
        }

        var orientation = global.TrialOrientation.createSession({ nudge: true });
        var headers = [
            "trialNum", "condId", "leftColor", "rightColor", "correctKey", "responseKey", "rt", "isCorrect",
            "confidence", "confidenceKey", "confidenceRT",
            "orientationType", "orientationAngle", "orientationAt", "orientationTMs", "orientationReason",
            "record", "sessionId", "startedAt", "endedAt", "complete"
        ];
        headers.push("mode");
        var store = global.TrialStore.create({
            taskId: "brightness",
            fileStem: "luma_clash_data",
            mode: mode,
            headers: headers
        });

        var AudioEngine = {
            playTone: function (freq, type, duration, volume, slideTo) {
                if (!policy.audio || !audio || typeof audio.playTone !== "function") return;
                audio.playTone(freq, duration, type, volume, slideTo == null ? null : slideTo);
            },
            tick: function () {
                this.playTone(800, "sine", 0.02, 0.02);
            },
            boop: function () {
                this.playTone(400, "sine", 0.1, 0.05);
            },
            beep: function () {
                this.playTone(600, "sine", 0.1, 0.05);
            },
            start: function () {
                var self = this;
                this.playTone(440, "square", 0.1, 0.1);
                global.setTimeout(function () { self.playTone(554.37, "square", 0.1, 0.1); }, 100);
                global.setTimeout(function () { self.playTone(659.25, "square", 0.3, 0.1); }, 200);
            },
            complete: function () {
                var self = this;
                var notes = [440, 554.37, 659.25, 880];
                notes.forEach(function (freq, index) {
                    global.setTimeout(function () { self.playTone(freq, "sine", 0.4, 0.1); }, index * 150);
                });
            }
        };

        var state = {
            phase: "idle",
            currentTrialIndex: 0,
            trials: [],
            results: [],
            tempResult: null,
            startTime: null,
            confidenceStartTime: null,
            isAcceptingInput: false,
            trialLog: null,
            openPhase: null,
            pendingExport: null,
            confidenceMapping: { f: "high", j: "low" }
        };

        var screens = {
            welcome: document.getElementById("screen-welcome"),
            task: document.getElementById("screen-task"),
            results: document.getElementById("screen-results")
        };

        function generateTrials() {
            var trials = [];
            CONFIG.conditions.forEach(function (cond) {
                var i;
                for (i = 0; i < CONFIG.trialsPerCondition; i++) {
                    var isLeftBrighter = Math.random() > 0.5;
                    trials.push({
                        condId: cond.id,
                        leftColor: isLeftBrighter ? cond.vals[1] : cond.vals[0],
                        rightColor: isLeftBrighter ? cond.vals[0] : cond.vals[1],
                        correctKey: isLeftBrighter ? "f" : "j"
                    });
                }
            });

            var s;
            for (s = trials.length - 1; s > 0; s--) {
                var j = Math.floor(Math.random() * (s + 1));
                var tmp = trials[s];
                trials[s] = trials[j];
                trials[j] = tmp;
            }
            return trials;
        }

        function nextTrial() {
            if (state.currentTrialIndex >= state.trials.length) {
                finishGame();
                return;
            }

            document.getElementById("trial-counter").textContent = (state.currentTrialIndex + 1) + " / " + state.trials.length;
            state.phase = "fixation";
            state.isAcceptingInput = false;

            timing.frame(function (ts) {
                document.getElementById("confidence-container").classList.add("hidden");
                document.getElementById("square-left").classList.add("invisible");
                document.getElementById("square-right").classList.add("invisible");
                document.getElementById("fixation-cross").classList.remove("invisible");
                document.getElementById("fixation-cross").classList.remove("opacity-20");
                setFooterActive(true);
                AudioEngine.tick();

                var run = timing.trial();
                state.trialLog = run;
                state.pendingExport = null;
                var fixation = run.open("fixation", CONFIG.timing.fixation, ts);
                state.openPhase = fixation;
                run.after(ts, CONFIG.timing.fixation, function (stimTs) {
                    fixation.close(stimTs, "frame");
                    if (state.currentTrialIndex >= state.trials.length) return;
                    presentPatches(stimTs, run);
                });
            });
        }

        function presentPatches(onsetTs, run) {
            var trial = state.trials[state.currentTrialIndex];
            var sqLeft = document.getElementById("square-left");
            var sqRight = document.getElementById("square-right");

            sqLeft.style.backgroundColor = "rgb(" + trial.leftColor + ", " + trial.leftColor + ", " + trial.leftColor + ")";
            sqRight.style.backgroundColor = "rgb(" + trial.rightColor + ", " + trial.rightColor + ", " + trial.rightColor + ")";

            sqLeft.classList.remove("invisible");
            sqRight.classList.remove("invisible");
            document.getElementById("fixation-cross").classList.add("opacity-20");

            sqLeft.classList.add("pop");
            sqRight.classList.add("pop");
            global.setTimeout(function () {
                sqLeft.classList.remove("pop");
                sqRight.classList.remove("pop");
            }, 100);

            state.startTime = onsetTs;
            state.phase = "stimulus";
            state.isAcceptingInput = true;
            var stimulus = run.open("stimulus", CONFIG.timing.timeout, onsetTs);
            state.openPhase = stimulus;
            run.after(onsetTs, CONFIG.timing.timeout, function (endTs) {
                if (!(state.isAcceptingInput && state.phase === "stimulus")) return;
                stimulus.close(endTs, "frame");
                state.openPhase = null;
                handleInput(null, endTs);
            });
        }

        function handleInput(key, scheduledTs) {
            if (!state.isAcceptingInput) return;

            if (state.phase === "stimulus") {
                state.isAcceptingInput = false;
                timing.cancelAll();

                var responsePerf = scheduledTs == null ? timing.now() : scheduledTs;
                var rt = responsePerf - state.startTime;
                var trial = state.trials[state.currentTrialIndex];
                var isCorrect = false;
                if (key !== null) {
                    isCorrect = (key === trial.correctKey);
                }

                state.tempResult = {
                    trialNum: state.currentTrialIndex + 1,
                    condId: trial.condId,
                    leftColor: trial.leftColor,
                    rightColor: trial.rightColor,
                    correctKey: trial.correctKey,
                    responseKey: key || "timeout",
                    rt: key ? Math.round(rt) : null,
                    isCorrect: isCorrect,
                    onsetPerf: state.startTime,
                    responsePerf: responsePerf
                };

                document.getElementById("square-left").classList.add("invisible");
                document.getElementById("square-right").classList.add("invisible");

                if (key === null) {
                    state.tempResult.confidence = "missed";
                    state.tempResult.confidenceKey = "none";
                    state.tempResult.confidenceRT = null;
                    commitTrial(state.tempResult);
                    AudioEngine.playTone(150, "sawtooth", 0.2, 0.1);
                    scheduleBlank(state.trialLog, "frame");
                    return;
                }

                AudioEngine.boop();
                promptConfidence(state.trialLog);
            } else if (state.phase === "confidence") {
                var conf = state.confidenceMapping[key];
                if (!conf) return;

                state.isAcceptingInput = false;
                state.tempResult.confidence = conf;
                state.tempResult.confidenceKey = key;
                state.tempResult.confidenceRT = Math.round(timing.now() - state.confidenceStartTime);
                commitTrial(state.tempResult);

                AudioEngine.beep();

                document.getElementById("confidence-container").classList.add("hidden");
                scheduleBlank(state.trialLog, "response");
            }
        }

        function promptConfidence(run) {
            state.phase = "confidence";
            document.getElementById("fixation-cross").classList.add("invisible");
            setFooterActive(false);
            document.getElementById("confidence-container").classList.remove("hidden");

            timing.frame(function (ts) {
                if (state.openPhase && state.openPhase.isOpen()) {
                    state.openPhase.close(ts, "response");
                }
                state.confidenceStartTime = ts;
                var gate = run.open("confidence-gate", 250, ts);
                run.after(ts, 250, function (openTs) {
                    gate.close(openTs, "frame");
                    state.openPhase = run.open("confidence", null, openTs);
                    state.isAcceptingInput = true;
                });
            });
        }

        function scheduleBlank(run, endReason) {
            timing.frame(function (ts) {
                if (state.openPhase && state.openPhase.isOpen()) {
                    state.openPhase.close(ts, endReason || "frame");
                }
                state.openPhase = null;
                var iti = run.open("iti", CONFIG.timing.isi, ts);
                run.after(ts, CONFIG.timing.isi, function (endTs) {
                    iti.close(endTs, "frame");
                    commitExport();
                    state.currentTrialIndex += 1;
                    nextTrial();
                });
            });
        }

        function commitTrial(result) {
            var orient = orientation.fields("response");
            Object.assign(result, orient, { record: "trial", mode: mode, block: "main" });
            state.results.push(result);
            store.commitTrial(result, orientation.events);
            state.pendingExport = {
                trialIndex: state.results.length,
                block: "main",
                stimulus: "L" + result.leftColor + "/R" + result.rightColor,
                condition: result.condId,
                response: result.responseKey,
                accuracy: result.isCorrect ? 1 : 0,
                rtMs: result.rt,
                timestamp: new Date().toISOString(),
                onsetPerfMs: result.onsetPerf,
                responsePerfMs: result.responsePerf,
                extra: {
                    left_color: result.leftColor,
                    right_color: result.rightColor,
                    correct_key: result.correctKey,
                    confidence: result.confidence,
                    confidence_key: result.confidenceKey,
                    confidence_rt_ms: result.confidenceRT,
                    orientation_type: orient.orientationType,
                    orientation_angle: orient.orientationAngle,
                    orientation_at: orient.orientationAt,
                    orientation_t_ms: orient.orientationTMs,
                    orientation_reason: orient.orientationReason
                }
            };
        }

        function commitExport() {
            if (!state.pendingExport || !state.trialLog) return;
            var row = state.pendingExport;
            var timingFields = state.trialLog.fields();
            state.pendingExport = null;
            row.timingMethod = timingFields.timingMethod;
            row.refreshHz = timingFields.refreshHz;
            row.frameMs = timingFields.frameMs;
            row.intendedDurations = timingFields.intendedDurations;
            row.phaseTiming = timingFields.phaseTiming;
            row.timingFlag = timingFields.timingFlag;
            exportLog.record(row);
        }

        function finishGame() {
            orientation.stop();
            store.finish(orientation.events);
            document.getElementById("orientation-note").textContent = orientation.summarize();
            AudioEngine.complete();
            screens.task.classList.add("hidden");
            screens.results.classList.remove("hidden");

            CONFIG.conditions.forEach(function (cond) {
                var conditionTrials = state.results.filter(function (row) {
                    return row.condId === cond.id && row.confidence !== "missed";
                });
                var correctTrials = conditionTrials.filter(function (row) { return row.isCorrect; });
                var wrongTrials = conditionTrials.filter(function (row) { return !row.isCorrect; });
                var correctHighConf = correctTrials.filter(function (row) { return row.confidence === "high"; }).length;
                var wrongHighConf = wrongTrials.filter(function (row) { return row.confidence === "high"; }).length;
                var correctHighConfPct = correctTrials.length > 0 ? Math.round((correctHighConf / correctTrials.length) * 100) : 0;
                var wrongHighConfPct = wrongTrials.length > 0 ? Math.round((wrongHighConf / wrongTrials.length) * 100) : 0;

                document.getElementById("res-" + cond.id + "-corr-count").textContent = String(correctTrials.length);
                document.getElementById("res-" + cond.id + "-corr-conf").textContent = correctHighConfPct + "%";
                document.getElementById("res-" + cond.id + "-wrong-count").textContent = String(wrongTrials.length);
                document.getElementById("res-" + cond.id + "-wrong-conf").textContent = wrongHighConfPct + "%";
            });

            var responded = state.results.filter(function (row) { return row.confidence !== "missed"; });
            var totalCorrect = state.results.filter(function (row) {
                return row.isCorrect && row.confidence !== "missed";
            }).length;
            var overallAcc = responded.length > 0 ? Math.round((totalCorrect / responded.length) * 100) : 0;
            var missed = state.results.filter(function (row) { return row.confidence === "missed"; }).length;
            var message = "Accuracy on responded trials: " + overallAcc + "% (" + totalCorrect + " of " + responded.length + "). Timeouts, which skip the confidence rating: " + missed + ". ";
            message += "Each card counts correct and wrong responses in that condition, and the share of each that was rated high confidence. This page does not compute d′. ";
            message += "Low-difference pairs are 20 gray levels apart. High-difference pairs are 80 apart.";
            document.getElementById("interpretation-text").textContent = message;
            var byCondition = {};
            CONFIG.conditions.forEach(function (cond) {
                byCondition[cond.id] = {
                    correctN: Number(document.getElementById("res-" + cond.id + "-corr-count").textContent),
                    correctHighConfidencePct: document.getElementById("res-" + cond.id + "-corr-conf").textContent,
                    wrongN: Number(document.getElementById("res-" + cond.id + "-wrong-count").textContent),
                    wrongHighConfidencePct: document.getElementById("res-" + cond.id + "-wrong-conf").textContent
                };
            });
            lastSummary = {
                accuracyPct: overallAcc,
                respondedN: responded.length,
                correctN: totalCorrect,
                missedN: missed,
                byCondition: byCondition
            };
        }

        function exportStamp() {
            return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        }

        function setFooterActive(active) {
            var footer = document.getElementById("footer-controls");
            footer.classList.toggle("opacity-0", !active);
            footer.classList.toggle("pointer-events-none", !active);
            if (active) footer.removeAttribute("inert");
            else footer.setAttribute("inert", "");
        }

        function flashPad(el) {
            if (!el) return;
            el.classList.add("active-key");
            global.setTimeout(function () { el.classList.remove("active-key"); }, 100);
        }

        function bindResponsePad(el) {
            var key = el.dataset.key;
            var lastPointerAt = 0;
            function respond() {
                flashPad(el);
                handleInput(key);
            }
            el.addEventListener("pointerdown", function (event) {
                if (event.isPrimary === false) return;
                if (typeof event.button === "number" && event.button !== 0) return;
                lastPointerAt = event.timeStamp || performance.now();
                if (event.cancelable) event.preventDefault();
                respond();
            });
            el.addEventListener("click", function (event) {
                var stamp = event.timeStamp || performance.now();
                if (stamp - lastPointerAt < 750) {
                    event.preventDefault();
                    return;
                }
                respond();
            });
        }

        document.querySelectorAll("button.trial-pad[data-key]").forEach(bindResponsePad);

        global.addEventListener("keydown", function (event) {
            if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
            var key = event.key.toLowerCase();
            if (key !== "f" && key !== "j") return;
            event.preventDefault();
            var targetId = state.phase === "confidence" ? "key-conf-" + key : "key-" + key;
            flashPad(document.getElementById(targetId));
            handleInput(key);
        });

        document.getElementById("btn-start").addEventListener("click", function () {
            timing.cancelAll();
            AudioEngine.start();
            state.currentTrialIndex = 0;
            state.results = [];
            lastSummary = null;
            exportLog.clear();
            state.trials = generateTrials();
            orientation.start();
            store.begin(orientation.events, { mode: mode });
            screens.welcome.classList.add("hidden");
            screens.task.classList.remove("hidden");
            nextTrial();
        });

        document.getElementById("btn-restart").addEventListener("click", function () {
            timing.cancelAll();
            screens.results.classList.add("hidden");
            screens.welcome.classList.remove("hidden");
        });

        document.getElementById("btn-download-csv").addEventListener("click", function () {
            exportLog.downloadCsv("luma_clash_" + exportStamp() + ".csv");
        });
        document.getElementById("btn-download-json").addEventListener("click", function () {
            exportLog.downloadJson("luma_clash_" + exportStamp() + ".json");
        });

        var api = {
            mode: mode,
            policyId: policy.id,
            getTrials: function () { return state.trials; },
            getResults: function () { return state.results; },
            getBlock: function () { return "main"; }
        };
        global.TrialTasks.brightness.current = api;
        return api;
    }

    global.TrialTasks = global.TrialTasks || {};
    global.TrialTasks.brightness = {
        id: "brightness",
        params: CONFIG,
        feedback: FEEDBACK,
        mount: mount,
        current: null
    };
})(window);
