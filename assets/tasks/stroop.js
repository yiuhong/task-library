/*
  Stroop task core.

  Parameters, the trial list, response mapping, timing, and feedback policy
  live here. The page shell only paints chrome and passes { mode, audio }.
  See assets/SHELL_CONTRACT.md.

  Both shells mount this file. mode picks the feedback policy. The main
  block is 20 trials in both shells. Classical also runs 8 practice trials
  first. Practice uses the same colors, keys, and timings, and it is not
  part of the end-of-run summary.

  Arcade scoring and tones are the gamified policy: speed bonus
  max(0, 1000 − rounded RT) plus combo × 100, with combo incremented
  before that bonus. Classical shows a short Correct / Incorrect / No
  response only during practice. The main block has no per-trial words.
  Live score, combo, accuracy, and mean RT stay off in both shells.
  The colored word is not set on fire, and the page background is not
  tinted by combo, so that cue does not sit on the next trial. The
  400 ms hold and 300 ms blank still run. Download CSV and Download
  JSON use TrialExport for the current run.

  Fixation, the response window, the feedback hold, and the blank
  between trials are scheduled by assets/trial-timing.js. Response time
  starts when the colored word is shown, including a timeout.
*/
(function (global) {
    var CONFIG = {
        colors: [
            { name: "RED", hex: "#ff4b4b", key: "r" },
            { name: "GREEN", hex: "#44ff44", key: "g" },
            { name: "BLUE", hex: "#4444ff", key: "b" },
            { name: "YELLOW", hex: "#ffff44", key: "y" }
        ],
        trials: 20,
        timing: { fixation: 400, timeout: 2000, isi: 300, feedback: 400 }
    };

    var FEEDBACK = {
        gamified: {
            id: "arcade",
            audio: true,
            score: true,
            combo: true,
            shake: true,
            fire: true,
            trialFeedback: true,
            practiceTrials: 0
        },
        classical: {
            id: "summary",
            audio: false,
            score: false,
            combo: false,
            shake: false,
            fire: false,
            trialFeedback: false,
            practiceTrials: 8
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
            throw new Error("Stroop requires assets/trial-export.js");
        }
        if (!global.TrialTiming) {
            throw new Error("Stroop requires assets/trial-timing.js");
        }

        var timing = global.TrialTiming.session();

        function timingParams() {
            var snapshot = timing.policy();
            snapshot.responseOnset = "word";
            snapshot.intervals = ["fixation", "stimulus", "feedback", "iti"];
            return snapshot;
        }

        var exportLog = global.TrialExport.session({
            taskId: "stroop",
            mode: mode,
            params: function () {
                return {
                    trials: CONFIG.trials,
                    colors: CONFIG.colors.map(function (color) {
                        return { name: color.name, hex: color.hex, key: color.key };
                    }),
                    fixationMs: CONFIG.timing.fixation,
                    responseWindowMs: CONFIG.timing.timeout,
                    feedbackMs: CONFIG.timing.feedback,
                    itiMs: CONFIG.timing.isi,
                    timing: timingParams(),
                    practiceTrials: policy.practiceTrials,
                    presentation: {
                        policyId: policy.id,
                        trialFeedback: !!policy.trialFeedback,
                        audio: !!policy.audio,
                        score: !!policy.score
                    }
                };
            },
            summary: function () { return lastSummary; }
        });

        var required = [
            "screen-welcome", "screen-task", "screen-results",
            "btn-start", "btn-restart",
            "display-area", "feedback-area", "stimulus-container",
            "response-bar", "trial-counter", "stat-acc", "stat-rt",
            "result-congruent", "result-incongruent",
            "interpretation-text", "orientation-note",
            "final-acc", "final-mean"
        ];
        var arcadeIds = ["stat-score", "stat-combo", "final-score"];
        var id;
        for (id = 0; id < required.length; id++) {
            if (!document.getElementById(required[id])) {
                throw new Error("Stroop shell is missing #" + required[id]);
            }
        }
        if (policy.id === "arcade") {
            for (id = 0; id < arcadeIds.length; id++) {
                if (!document.getElementById(arcadeIds[id])) {
                    throw new Error("Stroop gamified shell is missing #" + arcadeIds[id]);
                }
            }
        }

        var orientation = global.TrialOrientation.createSession({ nudge: true });
        var headers = [
            "trialNum", "type", "responseKey", "rt", "isCorrect",
            "orientationType", "orientationAngle", "orientationAt",
            "orientationTMs", "orientationReason", "record",
            "sessionId", "startedAt", "endedAt", "complete", "mode"
        ];
        if (policy.practiceTrials) headers.push("block");
        var store = global.TrialStore.create({
            taskId: "stroop",
            fileStem: "stroop_dash_data",
            mode: mode,
            headers: headers
        });

        function playTone(freq, type, duration, volume, slideTo) {
            if (!policy.audio || !audio || typeof audio.playTone !== "function") return;
            audio.playTone(freq, duration, type, volume, slideTo == null ? null : slideTo);
        }

        var tones = {
            correct: function (combo) {
                var baseFreq = 440 + (combo * 40);
                playTone(baseFreq, "sine", 0.2, 0.2, baseFreq * 1.5);
            },
            incorrect: function () {
                playTone(150, "square", 0.4, 0.2, 50);
            },
            tick: function () {
                playTone(880, "sine", 0.05, 0.05);
            },
            start: function () {
                playTone(523.25, "sine", 0.1, 0.1);
                global.setTimeout(function () { playTone(659.25, "sine", 0.1, 0.1); }, 100);
                global.setTimeout(function () { playTone(783.99, "sine", 0.3, 0.1); }, 200);
            },
            complete: function () {
                var notes = [523.25, 659.25, 783.99, 1046.50];
                notes.forEach(function (freq, index) {
                    global.setTimeout(function () { playTone(freq, "square", 0.4, 0.05); }, index * 150);
                });
            }
        };

        var state = {
            currentTrialIndex: 0,
            trials: [],
            results: [],
            startTime: null,
            isAcceptingInput: false,
            score: 0,
            combo: 0,
            maxCombo: 0,
            trialLog: null,
            openPhase: null,
            pendingExport: null
        };

        var screens = {
            welcome: document.getElementById("screen-welcome"),
            task: document.getElementById("screen-task"),
            results: document.getElementById("screen-results")
        };

        function shuffleInPlace(list) {
            for (var i = list.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = list[i];
                list[i] = list[j];
                list[j] = tmp;
            }
            return list;
        }

        function buildBlock(count) {
            var trials = [];
            var half = count / 2;
            var i;
            for (i = 0; i < half; i++) {
                var congruent = CONFIG.colors[i % 4];
                trials.push({
                    type: "congruent",
                    text: congruent.name,
                    inkColor: congruent.hex,
                    correctKey: congruent.key
                });
            }
            for (i = 0; i < half; i++) {
                var textIdx = i % 4;
                var inkIdx = (i + 1) % 4;
                trials.push({
                    type: "incongruent",
                    text: CONFIG.colors[textIdx].name,
                    inkColor: CONFIG.colors[inkIdx].hex,
                    correctKey: CONFIG.colors[inkIdx].key
                });
            }
            return shuffleInPlace(trials);
        }

        function rowsForSummary() {
            return state.results.filter(function (row) { return row.block !== "practice"; });
        }

        function runningStats(rows) {
            var list = rows || state.results;
            var total = list.length;
            var correct = list.filter(function (row) { return row.isCorrect; });
            var acc = total > 0 ? Math.round((correct.length / total) * 100) : 0;
            var avgRt = correct.length
                ? Math.round(correct.reduce(function (sum, row) { return sum + row.rt; }, 0) / correct.length)
                : 0;
            return { total: total, correct: correct, acc: acc, avgRt: avgRt };
        }

        function fixationColor() {
            return global.getComputedStyle(document.body).color || "#ffffff";
        }

        function updateUI() {
            if (policy.score) {
                document.getElementById("stat-score").textContent = state.score.toString().padStart(5, "0");
            }
            if (policy.combo) {
                document.getElementById("stat-combo").textContent = "x" + state.combo;
            }
            if (policy.id === "arcade") {
                var stats = runningStats();
                document.getElementById("stat-acc").textContent = stats.acc + "%";
                document.getElementById("stat-rt").textContent = stats.avgRt + "ms";
            } else {
                document.getElementById("stat-acc").textContent = "";
                document.getElementById("stat-rt").textContent = "";
            }
        }

        function showFeedback(text, colorClass) {
            var el = document.getElementById("feedback-area");
            if (!state.trialFeedback) {
                el.textContent = "";
                el.className = "game-title text-2xl opacity-0";
                return;
            }
            el.textContent = text;
            el.className = "game-title text-2xl opacity-100 transition-all " + colorClass;
        }

        function startBlock(block) {
            state.block = block.name;
            state.trials = block.trials;
            state.trialFeedback = block.feedback;
            state.currentTrialIndex = 0;
        }

        function paintCounter() {
            var label = document.getElementById("trial-label");
            if (label && mode === "classical") {
                label.textContent = state.block === "practice" ? "Practice" : "Trial";
            }
            document.getElementById("trial-counter").textContent = (state.currentTrialIndex + 1) + " / " + state.trials.length;
        }

        function nextTrial() {
            if (state.currentTrialIndex >= state.trials.length) {
                state.blockCursor += 1;
                if (!state.queue || state.blockCursor >= state.queue.length) {
                    finishGame();
                    return;
                }
                startBlock(state.queue[state.blockCursor]);
            }

            var display = document.getElementById("display-area");
            var feedbackEl = document.getElementById("feedback-area");
            paintCounter();
            feedbackEl.textContent = "";
            feedbackEl.className = "game-title text-2xl opacity-0";

            timing.frame(function (ts) {
                display.textContent = mode === "classical" ? "+" : "READY?";
                display.style.color = fixationColor();
                display.classList.remove("fire-effect");
                if (policy.audio) tones.tick();

                var run = timing.trial();
                state.trialLog = run;
                state.pendingExport = null;
                var fixation = run.open("fixation", CONFIG.timing.fixation, ts);
                state.openPhase = fixation;
                run.after(ts, CONFIG.timing.fixation, function (stimTs) {
                    fixation.close(stimTs, "frame");
                    if (state.currentTrialIndex >= state.trials.length) return;
                    presentWord(stimTs, run);
                });
            });
        }

        function presentWord(onsetTs, run) {
            var trial = state.trials[state.currentTrialIndex];
            var display = document.getElementById("display-area");
            display.textContent = trial.text;
            display.style.color = trial.inkColor;
            state.startTime = onsetTs;
            state.isAcceptingInput = true;
            var stimulus = run.open("stimulus", CONFIG.timing.timeout, onsetTs);
            state.openPhase = stimulus;
            run.after(onsetTs, CONFIG.timing.timeout, function (endTs) {
                if (!state.isAcceptingInput) return;
                stimulus.close(endTs, "frame");
                state.openPhase = null;
                handleInput(null, endTs);
            });
        }

        function handleInput(key, scheduledTs) {
            if (!state.isAcceptingInput) return;
            state.isAcceptingInput = false;
            timing.cancelAll();

            var responsePerf = scheduledTs == null ? timing.now() : scheduledTs;
            var rt = responsePerf - state.startTime;
            var trial = state.trials[state.currentTrialIndex];
            var isCorrect = key === trial.correctKey;

            if (isCorrect) {
                if (policy.audio) tones.correct(state.combo);
                if (policy.score || policy.combo) {
                    state.combo += 1;
                    state.maxCombo = Math.max(state.combo, state.maxCombo);
                }
                if (policy.score) {
                    var speedBonus = Math.max(0, 1000 - Math.round(rt));
                    state.score += speedBonus + (state.combo * 100);
                }
            } else {
                if (policy.audio) tones.incorrect();
                if (policy.score || policy.combo) state.combo = 0;
            }

            var orient = orientation.fields("response");
            var stored = Object.assign({
                record: "trial",
                trialNum: state.currentTrialIndex + 1,
                type: trial.type,
                responseKey: key || "timeout",
                rt: rt,
                isCorrect: isCorrect,
                mode: mode,
                block: state.block
            }, orient);
            state.results.push(stored);
            store.commitTrial(stored, orientation.events);
            state.pendingExport = {
                trialIndex: state.results.length,
                block: state.block,
                stimulus: trial.text + "/" + trial.inkColor,
                condition: trial.type,
                response: key || "timeout",
                accuracy: isCorrect ? 1 : 0,
                rtMs: rt,
                timestamp: new Date().toISOString(),
                onsetPerfMs: state.startTime,
                responsePerfMs: responsePerf,
                extra: {
                    trial_in_block: state.currentTrialIndex + 1,
                    word: trial.text,
                    ink: trial.inkColor,
                    correct_key: trial.correctKey,
                    orientation_type: orient.orientationType,
                    orientation_angle: orient.orientationAngle,
                    orientation_at: orient.orientationAt,
                    orientation_t_ms: orient.orientationTMs,
                    orientation_reason: orient.orientationReason
                }
            };

            updateUI();

            var run = state.trialLog;
            var closedBy = key === null ? "frame" : "response";
            timing.frame(function (ts) {
                if (state.openPhase && state.openPhase.isOpen()) {
                    state.openPhase.close(ts, closedBy);
                }
                state.openPhase = null;
                if (isCorrect) {
                    if (policy.id === "arcade") showFeedback("PERFECT!", "text-cyan-400");
                    else showFeedback("Correct", "is-quiet");
                } else {
                    if (policy.id === "arcade") showFeedback(key === null ? "TOO SLOW!" : "OOF!", "text-red-500");
                    else showFeedback(key === null ? "No response" : "Incorrect", "is-quiet");
                    if (policy.shake) {
                        var container = document.getElementById("stimulus-container");
                        container.classList.add("shake");
                        global.setTimeout(function () { container.classList.remove("shake"); }, 200);
                    }
                }
                var feedback = run.open("feedback", CONFIG.timing.feedback, ts);
                run.after(ts, CONFIG.timing.feedback, function (blankTs) {
                    feedback.close(blankTs, "frame");
                    document.getElementById("display-area").textContent = "";
                    var iti = run.open("iti", CONFIG.timing.isi, blankTs);
                    run.after(blankTs, CONFIG.timing.isi, function (nextTs) {
                        iti.close(nextTs, "frame");
                        commitExport();
                        state.currentTrialIndex += 1;
                        nextTrial();
                    });
                });
            });
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
            if (policy.audio) tones.complete();
            screens.task.classList.add("hidden");
            screens.results.classList.remove("hidden");

            if (policy.score) {
                document.getElementById("final-score").textContent = state.score.toLocaleString();
            }

            var summaryRows = rowsForSummary();
            var stats = runningStats(summaryRows);
            document.getElementById("final-acc").textContent = String(stats.acc);
            document.getElementById("final-mean").textContent = String(stats.avgRt);

            var buckets = {};
            ["congruent", "incongruent"].forEach(function (type) {
                var rows = summaryRows.filter(function (row) {
                    return row.type === type && row.isCorrect;
                });
                var avg = rows.length
                    ? Math.round(rows.reduce(function (sum, row) { return sum + row.rt; }, 0) / rows.length)
                    : 0;
                buckets[type] = { avg: avg, n: rows.length };
                document.querySelector("#result-" + type + " .rt-val").textContent = String(avg);
            });

            var message;
            if (buckets.congruent.n === 0 || buckets.incongruent.n === 0) {
                message = "Not enough correct trials to compare conditions (congruent "
                    + buckets.congruent.n + ", incongruent " + buckets.incongruent.n
                    + "). A 0 ms readout means that condition had no correct responses.";
            } else {
                var diff = buckets.incongruent.avg - buckets.congruent.avg;
                if (diff < 0) {
                    message = "On correct trials, incongruent ink was " + Math.abs(diff)
                        + " ms faster than congruent ink. With 10 trials a side, that swing can be noise.";
                } else if (policy.id === "arcade" && diff > 60) {
                    message = "WHOA! Your brain felt the \"Stroop Interference\" hard! You were "
                        + diff + " ms slower when colors didn't match.";
                } else if (policy.id === "arcade") {
                    message = "INSANE FOCUS! You only had a " + diff
                        + " ms delay between conditions. You're a visual filtering machine!";
                } else {
                    message = "On correct trials, incongruent ink was " + diff + " ms slower than congruent ink.";
                }
            }

            if (policy.id === "arcade") message += " Max Combo: " + state.maxCombo + ".";
            document.getElementById("interpretation-text").textContent = message;
            var interferenceMs = (buckets.congruent.n && buckets.incongruent.n)
                ? buckets.incongruent.avg - buckets.congruent.avg
                : null;
            lastSummary = {
                accuracyPct: stats.acc,
                meanCorrectRtMs: stats.avgRt,
                congruentMeanRtMs: buckets.congruent.avg,
                congruentCorrectN: buckets.congruent.n,
                incongruentMeanRtMs: buckets.incongruent.avg,
                incongruentCorrectN: buckets.incongruent.n,
                interferenceMs: interferenceMs,
                score: policy.score ? state.score : null,
                maxCombo: (policy.score || policy.combo) ? state.maxCombo : null
            };
        }

        function exportStamp() {
            return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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

        document.querySelectorAll("#response-bar button.trial-pad[data-key]").forEach(bindResponsePad);

        global.addEventListener("keydown", function (event) {
            if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
            var key = event.key.toLowerCase();
            if (["r", "g", "b", "y"].indexOf(key) === -1) return;
            event.preventDefault();
            flashPad(document.getElementById("key-" + key));
            handleInput(key);
        });

        document.getElementById("btn-start").addEventListener("click", function () {
            timing.cancelAll();
            if (policy.audio) tones.start();
            state.score = 0;
            state.combo = 0;
            state.maxCombo = 0;
            state.results = [];
            lastSummary = null;
            exportLog.clear();
            state.queue = [];
            if (policy.practiceTrials) {
                state.queue.push({
                    name: "practice",
                    trials: buildBlock(policy.practiceTrials),
                    feedback: true
                });
            }
            state.queue.push({
                name: "main",
                trials: buildBlock(CONFIG.trials),
                feedback: policy.id === "arcade"
            });
            state.blockCursor = 0;
            startBlock(state.queue[0]);
            orientation.start();
            store.begin(orientation.events, { mode: mode });
            screens.welcome.classList.add("hidden");
            screens.task.classList.remove("hidden");
            updateUI();
            nextTrial();
        });

        document.getElementById("btn-restart").addEventListener("click", function () {
            timing.cancelAll();
            document.body.style.backgroundColor = "";
            screens.results.classList.add("hidden");
            screens.welcome.classList.remove("hidden");
        });

        document.getElementById("btn-download-csv").addEventListener("click", function () {
            exportLog.downloadCsv("stroop_dash_" + exportStamp() + ".csv");
        });
        document.getElementById("btn-download-json").addEventListener("click", function () {
            exportLog.downloadJson("stroop_dash_" + exportStamp() + ".json");
        });

        var api = {
            mode: mode,
            policyId: policy.id,
            getTrials: function () { return state.trials; },
            getResults: function () { return state.results; },
            getBlock: function () { return state.block; },
            getPlan: function () {
                return (state.queue || []).map(function (block) {
                    return {
                        name: block.name,
                        feedback: block.feedback,
                        trials: block.trials
                    };
                });
            }
        };
        global.TrialTasks.stroop.current = api;
        return api;
    }

    global.TrialTasks = global.TrialTasks || {};
    global.TrialTasks.stroop = {
        id: "stroop",
        params: CONFIG,
        feedback: FEEDBACK,
        mount: mount,
        current: null
    };
})(window);
