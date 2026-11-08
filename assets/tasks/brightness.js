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
            timeoutId: null,
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

            var trial = state.trials[state.currentTrialIndex];
            document.getElementById("trial-counter").textContent = (state.currentTrialIndex + 1) + " / " + state.trials.length;

            state.phase = "stimulus";
            document.getElementById("confidence-container").classList.add("hidden");
            document.getElementById("square-left").classList.add("invisible");
            document.getElementById("square-right").classList.add("invisible");
            document.getElementById("fixation-cross").classList.remove("invisible");
            document.getElementById("fixation-cross").classList.remove("opacity-20");
            setFooterActive(true);

            AudioEngine.tick();
            global.setTimeout(function () {
                if (state.currentTrialIndex >= state.trials.length) return;
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

                state.startTime = performance.now();
                state.isAcceptingInput = true;

                state.timeoutId = global.setTimeout(function () {
                    if (state.isAcceptingInput && state.phase === "stimulus") handleInput(null);
                }, CONFIG.timing.timeout);
            }, CONFIG.timing.fixation);
        }

        function handleInput(key) {
            if (!state.isAcceptingInput) return;

            if (state.phase === "stimulus") {
                global.clearTimeout(state.timeoutId);
                state.isAcceptingInput = false;

                var rt = performance.now() - state.startTime;
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
                    isCorrect: isCorrect
                };

                document.getElementById("square-left").classList.add("invisible");
                document.getElementById("square-right").classList.add("invisible");

                if (key === null) {
                    state.tempResult.confidence = "missed";
                    state.tempResult.confidenceKey = "none";
                    state.tempResult.confidenceRT = null;
                    commitTrial(state.tempResult);
                    AudioEngine.playTone(150, "sawtooth", 0.2, 0.1);

                    global.setTimeout(function () {
                        state.currentTrialIndex += 1;
                        nextTrial();
                    }, CONFIG.timing.isi);
                    return;
                }

                AudioEngine.boop();
                promptConfidence();
            } else if (state.phase === "confidence") {
                var conf = state.confidenceMapping[key];
                if (!conf) return;

                state.isAcceptingInput = false;
                state.tempResult.confidence = conf;
                state.tempResult.confidenceKey = key;
                state.tempResult.confidenceRT = Math.round(performance.now() - state.confidenceStartTime);
                commitTrial(state.tempResult);

                AudioEngine.beep();

                document.getElementById("confidence-container").classList.add("hidden");

                global.setTimeout(function () {
                    state.currentTrialIndex += 1;
                    nextTrial();
                }, CONFIG.timing.isi);
            }
        }

        function promptConfidence() {
            state.phase = "confidence";
            document.getElementById("fixation-cross").classList.add("invisible");
            setFooterActive(false);

            document.getElementById("confidence-container").classList.remove("hidden");

            state.confidenceStartTime = performance.now();

            global.setTimeout(function () { state.isAcceptingInput = true; }, 250);
        }

        function commitTrial(result) {
            Object.assign(result, orientation.fields("response"), { record: "trial", mode: mode });
            state.results.push(result);
            store.commitTrial(result, orientation.events);
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
            AudioEngine.start();
            state.currentTrialIndex = 0;
            state.results = [];
            state.trials = generateTrials();
            orientation.start();
            store.begin(orientation.events, { mode: mode });
            screens.welcome.classList.add("hidden");
            screens.task.classList.remove("hidden");
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
