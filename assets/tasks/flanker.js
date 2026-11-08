/*
  Flanker task core.

  Parameters, the trial list, response mapping, timing, and feedback policy
  live here. The page shell only paints chrome and passes { mode, audio }.
  Both shells use the same 6 practice and 36 main trials.

  Gamified (arcade) shows TOO SLOW / CORRECT / INCORRECT on practice and main.
  Classical (summary) shows Correct / Incorrect / No response on practice only.
  The main block clears the feedback line. The 400 ms hold and 350 ms blank
  still run. This task is silent: both policies set audio to false.
*/
(function (global) {
  var CONFIG = {
    storageKey: "projectTrial_flanker_v1",
    practiceTrials: 6,          // Balanced: 3 conditions x 2 target directions = 6
    mainTrials: 36,             // Balanced: 3 conditions x 2 target directions x 6 reps = 36
    fixationMinMs: 400,         // Minimum fixation cross duration (ms)
    fixationMaxMs: 600,         // Maximum fixation cross duration (ms)
    stimulusTimeoutMs: 1500,    // Maximum response window (ms)
    feedbackDurationMs: 400,    // Accessible feedback duration (ms)
    itiDurationMs: 350,         // Inter-trial interval blank screen (ms)
    conditions: ["congruent", "incongruent", "neutral"],
    directions: ["left", "right"],
    keyMap: {
      ArrowLeft: "left",
      KeyA: "left",
      ArrowRight: "right",
      KeyL: "right"
    }
  };

  var FEEDBACK = {
    gamified: {
      id: "arcade",
      audio: false,
      score: false,
      trialFeedback: true,
      practiceFeedback: true
    },
    classical: {
      id: "summary",
      audio: false,
      score: false,
      trialFeedback: false,
      practiceFeedback: true
    }
  };

  function mount(host) {
    var options = host || {};
    var mode = options.mode === "classical" ? "classical" : "gamified";
    var policy = FEEDBACK[mode];
    var audio = options.audio || null;

    // Application State
    const state = {
      block: "idle", // "practice" | "main" | "done"
      trialQueue: [],
      trialIndex: 0,
      globalTrialCounter: 0,
      awaitingResponse: false,
      stimOnsetPerf: 0,
      activeTimeoutId: null,
      results: [] // Stores all trials (practice + main)
    };

    // DOM Elements
    const el = {
      progressBar: document.getElementById("progress-bar"),
      hudBlockBadge: document.getElementById("hud-block-badge"),
      hudTrial: document.getElementById("hud-trial"),
      hudAcc: document.getElementById("hud-acc"),
      hudRt: document.getElementById("hud-rt"),

      screenIntro: document.getElementById("screen-intro"),
      screenTransition: document.getElementById("screen-transition"),
      screenTrial: document.getElementById("screen-trial"),
      screenEnd: document.getElementById("screen-end"),

      practiceSummaryText: document.getElementById("practice-summary-text"),
      stimulusDisplay: document.getElementById("stimulus-display"),
      feedbackSubtext: document.getElementById("feedback-subtext"),

      resOverallAcc: document.getElementById("res-overall-acc"),
      resOverallRt: document.getElementById("res-overall-rt"),
      resConflictEffect: document.getElementById("res-conflict-effect"),
      resConditionTbody: document.getElementById("res-condition-tbody"),

      btnStartPractice: document.getElementById("btn-start-practice"),
      btnStartMain: document.getElementById("btn-start-main"),
      btnDownloadCsv: document.getElementById("btn-download-csv"),
      btnRestart: document.getElementById("btn-restart"),

      padLeft: document.getElementById("pad-left"),
      padRight: document.getElementById("pad-right")
    };

    /**
     * Utility: Fisher-Yates shuffle
     */
    function shuffleArray(arr) {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    }

    /**
     * Build a balanced block of trials across the 3 conditions & 2 target directions
     */
    function generateBalancedTrials(totalTrials) {
      const baseCombinations = [];
      for (const condition of CONFIG.conditions) {
        for (const targetDir of CONFIG.directions) {
          let flankerDir = "neutral";
          if (condition === "congruent") {
            flankerDir = targetDir;
          } else if (condition === "incongruent") {
            flankerDir = targetDir === "left" ? "right" : "left";
          }

          const targetChar = targetDir === "left" ? "<" : ">";
          const flankerChar =
            flankerDir === "left" ? "<" : flankerDir === "right" ? ">" : "-";

          const arrayString = `${flankerChar}${flankerChar}${targetChar}${flankerChar}${flankerChar}`;

          baseCombinations.push({
            condition,
            target_dir: targetDir,
            flanker_dir: flankerDir,
            stimulus: arrayString
          });
        }
      }

      const reps = Math.max(1, Math.floor(totalTrials / baseCombinations.length));
      let pool = [];
      for (let r = 0; r < reps; r++) {
        pool = pool.concat(baseCombinations.map(item => ({ ...item })));
      }
      return shuffleArray(pool);
    }

    /**
     * Switch visible screen section
     */
    function showScreen(screenName) {
      el.screenIntro.classList.add("hidden");
      el.screenTransition.classList.add("hidden");
      el.screenTrial.classList.add("hidden");
      el.screenEnd.classList.add("hidden");

      if (screenName === "intro") el.screenIntro.classList.remove("hidden");
      if (screenName === "transition") el.screenTransition.classList.remove("hidden");
      if (screenName === "trial") el.screenTrial.classList.remove("hidden");
      if (screenName === "end") el.screenEnd.classList.remove("hidden");
    }

    /**
     * Update Top HUD & Progress Bar
     */
    function updateHUD() {
      const totalInBlock = state.trialQueue.length;
      const currentNum = Math.min(state.trialIndex + 1, totalInBlock);

      if (state.block === "practice" || state.block === "main") {
        el.hudBlockBadge.textContent = state.block.toUpperCase();
        el.hudTrial.textContent = `${currentNum} / ${totalInBlock}`;
        const pct = totalInBlock > 0 ? (state.trialIndex / totalInBlock) * 100 : 0;
        el.progressBar.style.width = `${pct}%`;
      } else if (state.block === "done") {
        el.hudBlockBadge.textContent = "COMPLETE";
        el.progressBar.style.width = "100%";
      }

      const blockTrials = state.results.filter(r => r.block === state.block);
      if (blockTrials.length > 0) {
        const correctTrials = blockTrials.filter(r => r.correct === 1);
        const acc = Math.round((correctTrials.length / blockTrials.length) * 100);
        el.hudAcc.textContent = `${acc}%`;

        if (correctTrials.length > 0) {
          const meanRt = Math.round(
            correctTrials.reduce((acc, r) => acc + r.rt_ms, 0) / correctTrials.length
          );
          el.hudRt.textContent = `${meanRt} ms`;
        } else {
          el.hudRt.textContent = "-- ms";
        }
      } else {
        el.hudAcc.textContent = "--%";
        el.hudRt.textContent = "-- ms";
      }
    }

    /**
     * Start a Block ("practice" or "main")
     */
    function startBlock(blockType) {
      clearTimeout(state.activeTimeoutId);
      state.block = blockType;
      state.trialIndex = 0;

      const count = blockType === "practice" ? CONFIG.practiceTrials : CONFIG.mainTrials;
      state.trialQueue = generateBalancedTrials(count);

      updateHUD();
      showScreen("trial");
      runNextTrial();
    }

    /**
     * Execute single trial timeline:
     * 1. Jittered fixation (400-600ms)
     * 2. Stimulus array (until response or 1500ms timeout)
     * 3. Accessible feedback (400ms)
     * 4. Blank ITI (350ms)
     */
    function runNextTrial() {
      if (state.trialIndex >= state.trialQueue.length) {
        finishBlock();
        return;
      }

      updateHUD();
      state.awaitingResponse = false;

      // 1. Fixation Cross
      el.stimulusDisplay.className =
        "stimulus-array text-4xl sm:text-6xl font-bold text-slate-400 select-none text-center";
      el.stimulusDisplay.textContent = "+";
      el.feedbackSubtext.textContent = "";

      const fixationDuration =
        Math.floor(
          Math.random() * (CONFIG.fixationMaxMs - CONFIG.fixationMinMs + 1)
        ) + CONFIG.fixationMinMs;

      state.activeTimeoutId = setTimeout(() => {
        presentStimulus();
      }, fixationDuration);
    }

    /**
     * Present the 5-character horizontal flanker array
     */
    function presentStimulus() {
      const currentTrial = state.trialQueue[state.trialIndex];

      el.stimulusDisplay.className =
        "stimulus-array text-4xl sm:text-6xl font-bold text-slate-100 select-none text-center";
      el.stimulusDisplay.textContent = currentTrial.stimulus;
      el.feedbackSubtext.textContent = "";

      state.awaitingResponse = true;
      state.stimOnsetPerf = performance.now();

      // Timeout handler (1500 ms)
      state.activeTimeoutId = setTimeout(() => {
        if (state.awaitingResponse) {
          handleResponse("timeout", null);
        }
      }, CONFIG.stimulusTimeoutMs);
    }

    /**
     * Record response or timeout
     */
    function handleResponse(responseDir, rtMs) {
      if (!state.awaitingResponse) return;
      state.awaitingResponse = false;
      clearTimeout(state.activeTimeoutId);

      const currentTrial = state.trialQueue[state.trialIndex];
      const isTimeout = responseDir === "timeout";
      const isCorrect = !isTimeout && responseDir === currentTrial.target_dir ? 1 : 0;

      state.globalTrialCounter += 1;

      const trialRecord = {
        trial: state.globalTrialCounter,
        block: state.block,
        condition: currentTrial.condition,
        target_dir: currentTrial.target_dir,
        flanker_dir: currentTrial.flanker_dir,
        response: responseDir,
        correct: isCorrect,
        rt_ms: isTimeout ? "" : Math.round(rtMs),
        timestamp: new Date().toISOString(),
        mode: mode
      };

      state.results.push(trialRecord);

      // Visual pad press feedback
      if (responseDir === "left") flashPad(el.padLeft);
      if (responseDir === "right") flashPad(el.padRight);

      // 3. Accessible Feedback (400 ms). Hold and ITI below stay on both shells.
      if (mode !== "classical") {
        if (isTimeout) {
          el.stimulusDisplay.className =
            "font-mono text-2xl sm:text-4xl font-bold text-amber-400 select-none text-center";
          el.stimulusDisplay.textContent = "TOO SLOW";
          el.feedbackSubtext.textContent = "Respond within 1500 ms";
        } else if (isCorrect) {
          el.stimulusDisplay.className =
            "font-mono text-2xl sm:text-4xl font-bold text-emerald-400 select-none text-center";
          el.stimulusDisplay.textContent = "✓ CORRECT";
          el.feedbackSubtext.textContent = `${trialRecord.rt_ms} ms`;
        } else {
          el.stimulusDisplay.className =
            "font-mono text-2xl sm:text-4xl font-bold text-accent neon-text select-none text-center";
          el.stimulusDisplay.textContent = "✕ INCORRECT";
          el.feedbackSubtext.textContent = `Target was ${currentTrial.target_dir.toUpperCase()}`;
        }
      } else if (state.block === "practice" && policy.practiceFeedback) {
        el.stimulusDisplay.className =
          "font-mono text-2xl sm:text-4xl font-bold text-slate-100 select-none text-center";
        el.feedbackSubtext.textContent = "";
        if (isTimeout) {
          el.stimulusDisplay.textContent = "No response";
        } else if (isCorrect) {
          el.stimulusDisplay.textContent = "Correct";
        } else {
          el.stimulusDisplay.textContent = "Incorrect";
        }
      } else {
        el.stimulusDisplay.className =
          "stimulus-array text-4xl sm:text-6xl font-bold text-slate-100 select-none text-center";
        el.stimulusDisplay.textContent = "";
        el.feedbackSubtext.textContent = "";
      }

      updateHUD();

      state.activeTimeoutId = setTimeout(() => {
        // 4. Blank ITI (350 ms)
        el.stimulusDisplay.textContent = "";
        el.feedbackSubtext.textContent = "";

        state.activeTimeoutId = setTimeout(() => {
          state.trialIndex += 1;
          runNextTrial();
        }, CONFIG.itiDurationMs);
      }, CONFIG.feedbackDurationMs);
    }

    /**
     * Handle end of Practice or Main block
     */
    function finishBlock() {
      if (state.block === "practice") {
        const prac = state.results.filter(r => r.block === "practice");
        const corr = prac.filter(r => r.correct === 1);
        const acc = prac.length > 0 ? Math.round((corr.length / prac.length) * 100) : 0;
        const meanRt =
          corr.length > 0
            ? Math.round(corr.reduce((s, r) => s + r.rt_ms, 0) / corr.length)
            : 0;

        el.practiceSummaryText.textContent = `Practice Accuracy: ${acc}% | Mean RT: ${
          meanRt ? meanRt + " ms" : "N/A"
        }`;
        showScreen("transition");
      } else {
        state.block = "done";
        updateHUD();
        computeAndDisplaySummary();
        showScreen("end");
      }
    }

    /**
     * Helper: Mean and SD calculations
     */
    function calcMean(nums) {
      if (!nums.length) return null;
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }

    function calcSD(nums) {
      if (nums.length < 2) return null;
      const m = calcMean(nums);
      const variance =
        nums.reduce((acc, n) => acc + Math.pow(n - m, 2), 0) / (nums.length - 1);
      return Math.sqrt(variance);
    }

    /**
     * Compute Main Block Metrics, Conflict Effect, Table & Save to localStorage
     */
    function computeAndDisplaySummary() {
      const mainTrials = state.results.filter(r => r.block === "main");
      const correctMain = mainTrials.filter(r => r.correct === 1 && typeof r.rt_ms === "number");

      const overallAcc =
        mainTrials.length > 0
          ? Number(((correctMain.length / mainTrials.length) * 100).toFixed(1))
          : 0;
      const overallMeanRt = calcMean(correctMain.map(r => r.rt_ms));

      // Condition stats
      const condSummary = {};
      const examples = {
        congruent: "<<<<<",
        incongruent: ">><>>",
        neutral: "--<--"
      };

      for (const cond of CONFIG.conditions) {
        const subset = mainTrials.filter(r => r.condition === cond);
        const corrSubset = subset.filter(r => r.correct === 1 && typeof r.rt_ms === "number");
        const rts = corrSubset.map(r => r.rt_ms);

        condSummary[cond] = {
          total: subset.length,
          correct: corrSubset.length,
          accuracy_pct:
            subset.length > 0 ? Number(((corrSubset.length / subset.length) * 100).toFixed(1)) : 0,
          mean_rt_ms: rts.length > 0 ? Number(calcMean(rts).toFixed(1)) : null,
          sd_rt_ms: rts.length > 1 ? Number(calcSD(rts).toFixed(1)) : null
        };
      }

      // Flanker Conflict Effect = Incongruent Mean RT - Congruent Mean RT
      const congRt = condSummary.congruent.mean_rt_ms;
      const incongRt = condSummary.incongruent.mean_rt_ms;
      const conflictEffect =
        congRt !== null && incongRt !== null ? Number((incongRt - congRt).toFixed(1)) : null;

      // Render KPIs
      el.resOverallAcc.textContent = `${overallAcc}%`;
      el.resOverallRt.textContent =
        overallMeanRt !== null ? `${Math.round(overallMeanRt)} ms` : "N/A";
      el.resConflictEffect.textContent =
        conflictEffect !== null
          ? `${conflictEffect > 0 ? "+" : ""}${Math.round(conflictEffect)} ms`
          : "N/A";

      // Render Breakdown Table
      el.resConditionTbody.innerHTML = "";
      for (const cond of CONFIG.conditions) {
        const s = condSummary[cond];
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="py-3 px-3 sm:px-4 font-semibold capitalize text-slate-100">${cond}</td>
          <td class="py-3 px-3 sm:px-4 text-slate-400 tracking-widest">${examples[cond]
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</td>
          <td class="py-3 px-3 sm:px-4 text-right">${s.accuracy_pct}%</td>
          <td class="py-3 px-3 sm:px-4 text-right text-accent font-semibold">${
            s.mean_rt_ms !== null ? Math.round(s.mean_rt_ms) + " ms" : "N/A"
          }</td>
          <td class="py-3 px-3 sm:px-4 text-right text-slate-400">${
            s.sd_rt_ms !== null ? Math.round(s.sd_rt_ms) + " ms" : "--"
          }</td>
        `;
        el.resConditionTbody.appendChild(tr);
      }

      // Save summary payload to localStorage["projectTrial_flanker_v1"]
      const summaryPayload = {
        task: "flanker_conflict",
        version: "v1",
        completed_at: new Date().toISOString(),
        overall_accuracy_pct: overallAcc,
        overall_mean_rt_ms: overallMeanRt !== null ? Number(overallMeanRt.toFixed(1)) : null,
        flanker_conflict_effect_ms: conflictEffect,
        conditions: condSummary,
        trials: state.results,
        mode: mode
      };

      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(summaryPayload));
      } catch (err) {
        console.warn("Unable to write to localStorage:", err);
      }
    }

    /**
     * Download CSV with exact requested columns:
     * trial, block, condition, target_dir, flanker_dir, response, correct, rt_ms, timestamp, mode
     */
    function downloadCSV() {
      const headers = [
        "trial",
        "block",
        "condition",
        "target_dir",
        "flanker_dir",
        "response",
        "correct",
        "rt_ms",
        "timestamp",
        "mode"
      ];

      const rows = state.results.map(r =>
        headers.map(h => `${r[h] !== undefined && r[h] !== null ? r[h] : ""}`).join(",")
      );

      const csvContent = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `flanker_conflict_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /**
     * Visual flash on response pad
     */
    function flashPad(padEl) {
      padEl.classList.add("active-press");
      setTimeout(() => padEl.classList.remove("active-press"), 120);
    }

    /**
     * Event Listeners: Pointerdown on Touch Pads + Keyboard (ArrowLeft/Right & A/L)
     */
    function bindInputEvents() {
      el.padLeft.addEventListener("pointerdown", e => {
        e.preventDefault();
        if (state.awaitingResponse) {
          const rt = performance.now() - state.stimOnsetPerf;
          handleResponse("left", rt);
        } else {
          flashPad(el.padLeft);
        }
      });

      el.padRight.addEventListener("pointerdown", e => {
        e.preventDefault();
        if (state.awaitingResponse) {
          const rt = performance.now() - state.stimOnsetPerf;
          handleResponse("right", rt);
        } else {
          flashPad(el.padRight);
        }
      });

      window.addEventListener("keydown", e => {
        if (e.repeat) return;
        const mappedDir = CONFIG.keyMap[e.code] || CONFIG.keyMap[e.key];
        if (!mappedDir) return;

        if (state.awaitingResponse) {
          e.preventDefault();
          const rt = performance.now() - state.stimOnsetPerf;
          handleResponse(mappedDir, rt);
        }
      });

      el.btnStartPractice.addEventListener("click", () => {
        state.results = [];
        state.globalTrialCounter = 0;
        startBlock("practice");
      });

      el.btnStartMain.addEventListener("click", () => {
        startBlock("main");
      });

      el.btnDownloadCsv.addEventListener("click", () => {
        downloadCSV();
      });

      el.btnRestart.addEventListener("click", () => {
        state.results = [];
        state.globalTrialCounter = 0;
        state.block = "idle";
        updateHUD();
        showScreen("intro");
      });
    }

    // Initialize Task
    bindInputEvents();

    global.TrialTasks.flanker.current = {
      mode: mode,
      policyId: policy.id,
      audio: policy.audio ? audio : null
    };
  }

  global.TrialTasks = global.TrialTasks || {};
  global.TrialTasks.flanker = {
    id: "flanker",
    params: CONFIG,
    feedback: FEEDBACK,
    mount: mount,
    current: null
  };
})(window);
