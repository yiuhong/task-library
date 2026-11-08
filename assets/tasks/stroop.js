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
  response only during practice. The main block has no per-trial words,
  and no live accuracy or RT. The 400 ms hold and 300 ms blank still run.
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
            timeoutId: 0
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
                var hue = 220 + (state.combo * 10);
                document.body.style.backgroundColor = "hsl(" + hue + ", 45%, 8%)";
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

            var trial = state.trials[state.currentTrialIndex];
            var display = document.getElementById("display-area");
            var feedbackEl = document.getElementById("feedback-area");
            paintCounter();
            feedbackEl.textContent = "";
            feedbackEl.className = "game-title text-2xl opacity-0";
            display.textContent = mode === "classical" ? "+" : "READY?";
            display.style.color = fixationColor();
            display.classList.remove("fire-effect");

            if (policy.audio) tones.tick();
            global.setTimeout(function () {
                if (state.currentTrialIndex >= state.trials.length) return;
                display.textContent = trial.text;
                display.style.color = trial.inkColor;
                if (policy.fire && state.combo > 5) display.classList.add("fire-effect");
                state.startTime = performance.now();
                state.isAcceptingInput = true;
                state.timeoutId = global.setTimeout(function () {
                    if (state.isAcceptingInput) handleInput(null);
                }, CONFIG.timing.timeout);
            }, CONFIG.timing.fixation);
        }

        function handleInput(key) {
            if (!state.isAcceptingInput) return;
            global.clearTimeout(state.timeoutId);
            state.isAcceptingInput = false;

            var rt = performance.now() - state.startTime;
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
                if (policy.id === "arcade") showFeedback("PERFECT!", "text-cyan-400");
                else showFeedback("Correct", "is-quiet");
            } else {
                if (policy.audio) tones.incorrect();
                if (policy.score || policy.combo) state.combo = 0;
                if (policy.id === "arcade") showFeedback(key === null ? "TOO SLOW!" : "OOF!", "text-red-500");
                else showFeedback(key === null ? "No response" : "Incorrect", "is-quiet");
                if (policy.shake) {
                    var container = document.getElementById("stimulus-container");
                    container.classList.add("shake");
                    global.setTimeout(function () { container.classList.remove("shake"); }, 200);
                }
            }

            state.results.push(Object.assign({
                record: "trial",
                trialNum: state.currentTrialIndex + 1,
                type: trial.type,
                responseKey: key || "timeout",
                rt: rt,
                isCorrect: isCorrect,
                mode: mode,
                block: state.block
            }, orientation.fields("response")));
            store.commitTrial(state.results[state.results.length - 1], orientation.events);
            updateUI();

            global.setTimeout(function () {
                document.getElementById("display-area").textContent = "";
                global.setTimeout(function () {
                    state.currentTrialIndex += 1;
                    nextTrial();
                }, CONFIG.timing.isi);
            }, CONFIG.timing.feedback);
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
            if (policy.audio) tones.start();
            state.score = 0;
            state.combo = 0;
            state.maxCombo = 0;
            state.results = [];
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
            document.body.style.backgroundColor = "";
            screens.results.classList.add("hidden");
            screens.welcome.classList.remove("hidden");
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
