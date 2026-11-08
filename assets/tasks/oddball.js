/*
  Oddball task core.

  Parameters, the trial list, response mapping, timing, and feedback policy
  live here. The page shell only paints chrome and passes { mode, audio }.
  See assets/SHELL_CONTRACT.md.

  Both shells mount this file. mode picks the feedback policy. The main
  block is 30 trials in both shells: floor(30 * 0.2) = 6 oddball and 24
  standard, first two forced to standard. Classical also runs 10 practice
  trials from the same generator (2 oddball, 8 standard, first two
  standard) and then the main block, with no interstitial click. Practice
  is not part of the end-of-run summary.

  Arcade scoring and tones are the gamified policy. A hit adds
  max(0, 1200 − rounded RT) plus 500 * (1 + combo * 0.1). A correct
  withhold adds 50 * (1 + combo * 0.1). Both use the combo from before
  it increases. Classical shows Correct / Incorrect / No response only
  during practice. No response is a timeout on an oddball. The main
  block has no per-trial words, and no live score, accuracy, RT, or
  combo. The 300 ms hold and 400 ms blank still run.
*/
(function (global) {
    var CONFIG = {
        trials: 30,
        oddballRatio: 0.2,
        stimuli: {
            standard: { char: "O", color: "#06b6d4", key: null, type: "standard" },
            oddball: { char: "X", color: "#ec4899", key: "j", type: "oddball" }
        },
        timing: { fixation: 300, timeout: 1200, isi: 400, feedback: 300 }
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
            practiceTrials: 10
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
            "response-bar", "trial-counter", "trial-label",
            "stat-acc", "stat-rt",
            "result-standard", "result-oddball", "result-accuracy",
            "interpretation-text", "orientation-note", "final-acc", "key-j"
        ];
        var arcadeIds = ["stat-score", "stat-combo", "final-score"];
        var id;
        for (id = 0; id < required.length; id++) {
            if (!document.getElementById(required[id])) {
                throw new Error("Oddball shell is missing #" + required[id]);
            }
        }
        if (!document.querySelector("#result-standard .acc-val")) {
            throw new Error("Oddball shell is missing #result-standard .acc-val");
        }
        if (!document.querySelector("#result-oddball .rt-val")) {
            throw new Error("Oddball shell is missing #result-oddball .rt-val");
        }
        if (policy.id === "arcade") {
            for (id = 0; id < arcadeIds.length; id++) {
                if (!document.getElementById(arcadeIds[id])) {
                    throw new Error("Oddball gamified shell is missing #" + arcadeIds[id]);
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
            taskId: "oddball",
            fileStem: "oddball_dash_data",
            mode: mode,
            headers: headers
        });

        function playTone(freq, type, duration, volume, slideTo) {
            if (!policy.audio || !audio || typeof audio.playTone !== "function") return;
            audio.playTone(freq, duration, type, volume, slideTo == null ? null : slideTo);
        }

        var tones = {
            correct: function (combo, type) {
                if (type === "oddball") {
                    playTone(880, "square", 0.3, 0.2, 1760);
                } else {
                    var baseFreq = 440 + (combo * 10);
                    playTone(baseFreq, "sine", 0.15, 0.15, baseFreq * 1.2);
                }
            },
            incorrect: function () {
                playTone(150, "sawtooth", 0.4, 0.2, 50);
            },
            tick: function () {
                playTone(1200, "sine", 0.03, 0.02);
            },
            start: function () {
                playTone(440, "square", 0.1, 0.1);
                global.setTimeout(function () { playTone(554.37, "square", 0.1, 0.1); }, 100);
                global.setTimeout(function () { playTone(659.25, "square", 0.3, 0.1); }, 200);
            },
            complete: function () {
                var notes = [440, 554.37, 659.25, 880];
                notes.forEach(function (freq, index) {
                    global.setTimeout(function () { playTone(freq, "sine", 0.4, 0.1); }, index * 150);
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
            timeoutId: 0,
            block: "main",
            trialFeedback: false,
            queue: null,
            blockCursor: 0
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

        function copyStimulus(src) {
            return {
                char: src.char,
                color: src.color,
                key: src.key,
                type: src.type
            };
        }

        function generateTrials(count) {
            var total = count == null ? CONFIG.trials : count;
            var trials = [];
            var oddballCount = Math.floor(total * CONFIG.oddballRatio);
            var standardCount = total - oddballCount;
            var i;
            for (i = 0; i < standardCount; i++) trials.push(copyStimulus(CONFIG.stimuli.standard));
            for (i = 0; i < oddballCount; i++) trials.push(copyStimulus(CONFIG.stimuli.oddball));

            shuffleInPlace(trials);

            // Force the first 2 trials to be standard to establish the baseline rhythm
            var standardFound = 0;
            for (i = 0; i < trials.length; i++) {
                if (standardFound >= 2) break;
                if (trials[i].type !== "standard") {
                    var swapIdx = -1;
                    var k;
                    for (k = i + 1; k < trials.length; k++) {
                        if (trials[k].type === "standard") {
                            swapIdx = k;
                            break;
                        }
                    }
                    if (swapIdx > -1) {
                        var swapped = trials[i];
                        trials[i] = trials[swapIdx];
                        trials[swapIdx] = swapped;
                    }
                }
                standardFound++;
            }

            return trials;
        }

        function rowsForSummary() {
            return state.results.filter(function (row) { return row.block !== "practice"; });
        }

        function updateUI() {
            if (policy.score) {
                document.getElementById("stat-score").textContent = Math.round(state.score).toString().padStart(5, "0");
            }
            if (policy.combo) {
                document.getElementById("stat-combo").textContent = "x" + state.combo;
            }
            if (policy.id === "arcade") {
                var total = state.results.length;
                var correct = state.results.filter(function (row) { return row.isCorrect; }).length;
                var acc = total > 0 ? Math.round((correct / total) * 100) : 0;
                var hitTrials = state.results.filter(function (row) {
                    return row.isCorrect && row.type === "oddball";
                });
                var avgRt = hitTrials.length > 0
                    ? Math.round(hitTrials.reduce(function (sum, row) { return sum + row.rt; }, 0) / hitTrials.length)
                    : 0;
                document.getElementById("stat-acc").textContent = acc + "%";
                document.getElementById("stat-rt").textContent = avgRt + "ms";
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

            display.textContent = "+";
            display.style.color = "#475569";
            display.style.textShadow = "none";
            display.classList.remove("fire-effect", "scale-110");

            if (policy.audio) tones.tick();
            global.setTimeout(function () {
                if (state.currentTrialIndex >= state.trials.length) return;
                display.textContent = trial.char;
                display.style.color = trial.color;
                if (policy.id === "arcade") {
                    display.style.textShadow = "0 0 30px " + trial.color + "80";
                } else {
                    display.style.textShadow = "none";
                }
                display.classList.add("scale-110");
                if (policy.fire && state.combo > 10) display.classList.add("fire-effect");

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
            var isCorrect = false;

            if (key !== null) {
                isCorrect = (trial.type === "oddball" && key === trial.key);
            } else {
                isCorrect = (trial.type === "standard");
            }

            if (isCorrect) {
                if (key !== null) {
                    if (policy.audio) tones.correct(state.combo, trial.type);
                    if (policy.score) {
                        var speedBonus = Math.max(0, CONFIG.timing.timeout - Math.round(rt));
                        state.score += (speedBonus + (500 * (1 + (state.combo * 0.1))));
                    }
                    if (policy.id === "arcade") showFeedback("CAUGHT IT!", "text-pink-400");
                    else showFeedback("Correct", "is-quiet");
                } else {
                    if (policy.audio) tones.correct(state.combo, "standard");
                    if (policy.score) {
                        state.score += 50 * (1 + (state.combo * 0.1));
                    }
                    if (policy.id === "arcade") showFeedback("GOOD", "text-cyan-400");
                    else showFeedback("Correct", "is-quiet");
                }
                if (policy.score || policy.combo) {
                    state.combo += 1;
                    state.maxCombo = Math.max(state.combo, state.maxCombo);
                }
            } else {
                if (policy.audio) tones.incorrect();
                if (policy.score || policy.combo) state.combo = 0;
                if (policy.id === "arcade") showFeedback(key === null ? "MISS!" : "FALSE ALARM!", "text-red-500");
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
                responseKey: key || "withhold",
                rt: key ? rt : null,
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
                document.getElementById("final-score").textContent = Math.round(state.score).toLocaleString();
            }

            var summaryRows = rowsForSummary();
            var overallCorrect = summaryRows.filter(function (row) { return row.isCorrect; }).length;
            var overallAcc = summaryRows.length > 0 ? Math.round((overallCorrect / summaryRows.length) * 100) : 0;
            document.getElementById("final-acc").textContent = String(overallAcc);

            var standardRows = summaryRows.filter(function (row) { return row.type === "standard"; });
            var standardCorrect = standardRows.filter(function (row) { return row.isCorrect; }).length;
            var standardAcc = standardRows.length > 0 ? Math.round((standardCorrect / standardRows.length) * 100) : 0;
            document.querySelector("#result-standard .acc-val").textContent = String(standardAcc);

            var oddballHits = summaryRows.filter(function (row) {
                return row.type === "oddball" && row.isCorrect;
            });
            var oddballSpeed = oddballHits.length > 0
                ? Math.round(oddballHits.reduce(function (sum, row) { return sum + row.rt; }, 0) / oddballHits.length)
                : 0;
            document.querySelector("#result-oddball .rt-val").textContent = String(oddballSpeed);

            var message;
            if (oddballHits.length === 0) {
                message = "You missed the oddballs completely! It's easy to get lulled into doing nothing.";
            } else if (standardAcc < 80) {
                message = "You caught the targets at " + oddballSpeed + "ms, but struggled to inhibit your reactions on standard trials (" + standardAcc + "% Acc). This shows impulsivity!";
            } else {
                message = "Incredible vigilance and inhibition! You successfully withheld responses on standard trials and reacted to targets in " + oddballSpeed + "ms. This is a classic test of sustained attention.";
            }

            if (policy.id === "arcade") {
                message += " Max Combo Achieved: " + state.maxCombo + ".";
            } else if (oddballHits.length === 0) {
                message = "Standard accuracy was " + standardAcc + "%. There were no oddball hits.";
            } else {
                message = "Accuracy was " + overallAcc + "%. Standard accuracy was " + standardAcc + "%. Mean response time on oddball hits was " + oddballSpeed + " ms.";
            }
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
            if (key !== "j") return;
            event.preventDefault();
            flashPad(document.getElementById("key-j"));
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
                    trials: generateTrials(policy.practiceTrials),
                    feedback: true
                });
            }
            state.queue.push({
                name: "main",
                trials: generateTrials(),
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
        global.TrialTasks.oddball.current = api;
        return api;
    }

    global.TrialTasks = global.TrialTasks || {};
    global.TrialTasks.oddball = {
        id: "oddball",
        params: CONFIG,
        feedback: FEEDBACK,
        mount: mount,
        current: null
    };
})(window);
