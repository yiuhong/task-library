/*
  Go / No-Go task core.

  Parameters, the trial list, response mapping, timing, and feedback policy
  live here. The page shell only paints chrome and passes { mode, audio }.
  Both shells use the same 8 practice and 40 main trials.

  Gamified (arcade) shows HIT, WRONG SIDE, FALSE ALARM!, TOO SLOW!, and
  WITHHELD on practice and main. Classical (summary) maps those to Correct,
  Incorrect, or No response on practice only, with no subtitle. The main
  block clears the feedback line. The 400 ms hold and the jittered blank
  still run. The GO / NO-GO badge and the deadline bar stay in both shells.
  This task is silent: both policies set audio to false.
*/
(function (global) {
  var CONFIG = {
    storageKey: "projectTrial_gonogo_v1",
    practiceTrials: 8,
    mainTrials: 40,
    goProbability: 0.75,        // 75% Go trials, 25% No-Go trials
    fixationMs: 400,            // Crisp fixation cross duration
    goWindowMs: 700,            // Speeded response window for Go trials
    nogoWindowMs: 800,          // Inhibition hold window for No-Go trials
    feedbackMs: 400,            // Post-trial feedback duration
    itiMinMs: 250,              // Minimum jittered Inter-Trial Interval
    itiMaxMs: 450               // Maximum jittered Inter-Trial Interval
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

    /**
     * STATE MANAGEMENT
     */
    const state = {
      blockName: "practice",      // "practice" | "main"
      trialList: [],
      currentIndex: 0,
      trialActive: false,
       awaitingResponse: false,
      stimOnsetTime: 0,
      timeoutId: null,
      allLogs: []                 // Stores all rows: practice + main
    };

    /**
     * DOM REFERENCES
     */
    const el = {
      hudMetrics: document.getElementById("hud-metrics"),
      hudBlock: document.getElementById("hud-block"),
      hudTrial: document.getElementById("hud-trial"),
      screenIntro: document.getElementById("screen-intro"),
      screenTransition: document.getElementById("screen-transition"),
      screenArena: document.getElementById("screen-arena"),
      screenResults: document.getElementById("screen-results"),
      practiceSummaryText: document.getElementById("practice-summary-text"),
      deadlineProgress: document.getElementById("deadline-progress"),
      stimulusFrame: document.getElementById("stimulus-frame"),
      stimFixation: document.getElementById("stim-fixation"),
      stimTarget: document.getElementById("stim-target"),
      stimBadge: document.getElementById("stim-badge"),
      stimIcon: document.getElementById("stim-icon"),
      stimFeedback: document.getElementById("stim-feedback"),
      feedbackLabel: document.getElementById("feedback-label"),
      feedbackSub: document.getElementById("feedback-sub"),
      padLeft: document.getElementById("pad-left"),
      padRight: document.getElementById("pad-right"),
      btnStartPractice: document.getElementById("btn-start-practice"),
      btnStartMain: document.getElementById("btn-start-main"),
      btnDownloadCsv: document.getElementById("btn-download-csv"),
      btnRestart: document.getElementById("btn-restart"),
      resGoAcc: document.getElementById("res-go-acc"),
      resGoAccSub: document.getElementById("res-go-acc-sub"),
      resGoRt: document.getElementById("res-go-rt"),
      resGoRtSub: document.getElementById("res-go-rt-sub"),
      resCommission: document.getElementById("res-commission"),
      resCommissionSub: document.getElementById("res-commission-sub"),
      resOmission: document.getElementById("res-omission"),
      resOmissionSub: document.getElementById("res-omission-sub"),
      storageBadge: document.getElementById("storage-badge")
    };

    /**
     * GENERATE BALANCED TRIAL SEQUENCE
     * Ensures exact 75% GO (split evenly Left/Right) and 25% NO-GO trials, shuffled.
     */
    function buildBlockTrials(totalTrials) {
      const goCount = Math.round(totalTrials * CONFIG.goProbability);
      const nogoCount = totalTrials - goCount;
      const trials = [];

      for (let i = 0; i < goCount; i++) {
        trials.push({
          trial_type: "GO",
          target_side: i % 2 === 0 ? "LEFT" : "RIGHT"
        });
      }
      for (let i = 0; i < nogoCount; i++) {
        trials.push({
          trial_type: "NOGO",
          target_side: i % 2 === 0 ? "LEFT" : "RIGHT"
        });
      }

      // Fisher-Yates shuffle
      for (let i = trials.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [trials[i], trials[j]] = [trials[j], trials[i]];
      }
      return trials;
    }

    /**
     * SVG STIMULUS RENDERERS
     */
    function renderTargetGraphic(trialType, targetSide) {
      const arrowRotation = targetSide === "LEFT" ? "rotate(180 12 12)" : "";
      if (trialType === "GO") {
        el.stimulusFrame.className = "relative flex flex-col items-center justify-center my-auto w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-bgCard border-4 border-goLime shadow-[0_0_35px_rgba(132,204,22,0.22)] stimulus-box";
        el.stimBadge.className = "mb-2 px-3 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-lime-500/20 text-goLime border border-lime-500/40";
        el.stimBadge.textContent = `GO ${targetSide}`;
        el.stimIcon.innerHTML = `
          <svg class="w-28 h-28 text-goLime" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8">
            <g transform="${arrowRotation}">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M13 5l7 7-7 7" />
            </g>
          </svg>
        `;
      } else {
        // NO-GO Stop Trial: Red border + prominent X stop symbol overlaid with directional hint
        el.stimulusFrame.className = "relative flex flex-col items-center justify-center my-auto w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-bgCard border-4 border-nogoCoral shadow-[0_0_35px_rgba(251,113,133,0.25)] stimulus-box";
        el.stimBadge.className = "mb-2 px-3 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-widest bg-rose-500/20 text-nogoCoral border border-rose-500/40";
        el.stimBadge.textContent = "NO-GO // STOP";
        el.stimIcon.innerHTML = `
          <svg class="w-28 h-28 text-nogoCoral" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8">
            <circle cx="12" cy="12" r="9" stroke-opacity="0.35" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 7.5l9 9M16.5 7.5l-9 9" />
          </svg>
        `;
      }
    }

    /**
     * SCREEN NAVIGATION
     */
    function showScreen(screenEl) {
      [el.screenIntro, el.screenTransition, el.screenArena, el.screenResults].forEach(s => s.classList.add("hidden"));
      screenEl.classList.remove("hidden");
    }

    /**
     * START BLOCK (Practice or Main)
     */
    function startBlock(blockName) {
      clearTimeout(state.timeoutId);
      state.blockName = blockName;
      state.currentIndex = 0;
      const count = blockName === "practice" ? CONFIG.practiceTrials : CONFIG.mainTrials;
      state.trialList = buildBlockTrials(count);

      el.hudMetrics.classList.remove("hidden");
      el.hudMetrics.classList.add("flex");
      el.hudBlock.textContent = blockName.toUpperCase();
      el.hudTrial.textContent = `1 / ${count}`;

      showScreen(el.screenArena);
      runNextTrial();
    }

    /**
     * CORE TRIAL STATE MACHINE
     * 1. Fixation (400 ms) -> 2. Target Window (700 ms Go / 800 ms No-Go) -> 3. Feedback (400 ms) -> 4. Jittered ITI (250-450 ms)
     */
    function runNextTrial() {
      if (state.currentIndex >= state.trialList.length) {
        finishBlock();
        return;
      }

      const totalInBlock = state.trialList.length;
      el.hudTrial.textContent = `${state.currentIndex + 1} / ${totalInBlock}`;

      // Reset arena visuals for Fixation phase
      state.trialActive = true;
      state.awaitingResponse = false;
      el.stimulusFrame.className = "relative flex flex-col items-center justify-center my-auto w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-bgCard/90 border-2 border-slate-800 shadow-2xl";
      el.stimTarget.classList.add("hidden");
      el.stimFeedback.classList.add("hidden");
      el.stimFixation.classList.remove("hidden");

      // Reset deadline bar
      el.deadlineProgress.style.transition = "none";
      el.deadlineProgress.style.transform = "scaleX(0)";

      state.timeoutId = setTimeout(() => {
        presentStimulus();
      }, CONFIG.fixationMs);
    }

    function presentStimulus() {
      const currentTrial = state.trialList[state.currentIndex];
      const isGo = currentTrial.trial_type === "GO";
      const windowDuration = isGo ? CONFIG.goWindowMs : CONFIG.nogoWindowMs;

      el.stimFixation.classList.add("hidden");
      renderTargetGraphic(currentTrial.trial_type, currentTrial.target_side);
      el.stimTarget.classList.remove("hidden");
      el.stimTarget.classList.add("flex");

      // Animate top deadline bar
      el.deadlineProgress.className = `h-full w-full origin-left ${isGo ? "bg-goLime" : "bg-nogoCoral"}`;
      el.deadlineProgress.style.transition = "none";
      el.deadlineProgress.style.transform = "scaleX(1)";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.deadlineProgress.style.transition = `transform ${windowDuration}ms linear`;
          el.deadlineProgress.style.transform = "scaleX(0)";
        });
      });

      state.awaitingResponse = true;
      state.stimOnsetTime = performance.now();

      state.timeoutId = setTimeout(() => {
        if (state.awaitingResponse) {
          handleTimeout();
        }
      }, windowDuration);
    }

    /**
     * HANDLE PARTICIPANT INPUT (Pointerdown or Keyboard)
     */
    function handleResponse(chosenSide) {
      if (!state.awaitingResponse) return;
      state.awaitingResponse = false;
      clearTimeout(state.timeoutId);

      const rtMs = Math.round(performance.now() - state.stimOnsetTime);
      const currentTrial = state.trialList[state.currentIndex];

      let isCorrect = 0;
      let feedbackTitle = "";
      let feedbackDetail = `${rtMs} ms`;
      let feedbackColor = "";

      if (currentTrial.trial_type === "GO") {
        if (chosenSide === currentTrial.target_side) {
          isCorrect = 1;
          feedbackTitle = "HIT";
          feedbackColor = "text-goLime";
        } else {
          isCorrect = 0;
          feedbackTitle = "WRONG SIDE";
          feedbackColor = "text-nogoCoral";
        }
      } else {
        // Responded on a NO-GO trial -> Commission Error (False Alarm)
        isCorrect = 0;
        feedbackTitle = "FALSE ALARM!";
        feedbackDetail = `Commission Error (${rtMs} ms)`;
        feedbackColor = "text-nogoCoral";
      }

      recordTrialResult(currentTrial, chosenSide, isCorrect, rtMs);
      showTrialFeedback(feedbackTitle, feedbackDetail, feedbackColor);
    }

    /**
     * HANDLE RESPONSE WINDOW EXPIRATION (No input before deadline)
     */
    function handleTimeout() {
      state.awaitingResponse = false;
      const currentTrial = state.trialList[state.currentIndex];

      let isCorrect = 0;
      let feedbackTitle = "";
      let feedbackDetail = "";
      let feedbackColor = "";

      if (currentTrial.trial_type === "GO") {
        // Failed to respond before Go deadline -> Omission Error
        isCorrect = 0;
        feedbackTitle = "TOO SLOW!";
        feedbackDetail = `Omission (> ${CONFIG.goWindowMs} ms)`;
        feedbackColor = "text-amber-400";
      } else {
        // Successfully withheld response on No-Go trial
        isCorrect = 1;
        feedbackTitle = "WITHHELD";
        feedbackDetail = "Successful Inhibition";
        feedbackColor = "text-goLime";
      }

      recordTrialResult(currentTrial, "NONE", isCorrect, "");
      showTrialFeedback(feedbackTitle, feedbackDetail, feedbackColor);
    }

    /**
     * LOG TRIAL DATA ROW
     * Columns: trial, block, trial_type, target_side, response, correct, rt_ms, timestamp, mode
     */
    function recordTrialResult(trialObj, responseSide, correctInt, rtValue) {
      const row = {
        trial: state.currentIndex + 1,
        block: state.blockName,
        trial_type: trialObj.trial_type,
        target_side: trialObj.target_side,
        response: responseSide,
        correct: correctInt,
        rt_ms: rtValue,
        timestamp: new Date().toISOString(),
        mode: mode
      };
      state.allLogs.push(row);
    }

    /**
     * DISPLAY CRISP FEEDBACK (400 ms) THEN JITTERED ITI (250-450 ms)
     */
    function showTrialFeedback(title, subtitle, colorClass) {
      el.deadlineProgress.style.transition = "none";
      el.deadlineProgress.style.transform = "scaleX(0)";

      el.stimTarget.classList.add("hidden");
      el.stimulusFrame.className = "relative flex flex-col items-center justify-center my-auto w-64 h-64 sm:w-72 sm:h-72 rounded-3xl bg-bgCard/90 border-2 border-slate-800 shadow-2xl";

      if (mode !== "classical") {
        el.feedbackLabel.className = `text-2xl font-bold tracking-wide uppercase ${colorClass}`;
        el.feedbackLabel.textContent = title;
        el.feedbackSub.textContent = subtitle;
        el.stimFeedback.classList.remove("hidden");
        el.stimFeedback.classList.add("flex");
      } else if (state.blockName === "practice" && policy.practiceFeedback) {
        var brief = "Incorrect";
        if (title === "HIT" || title === "WITHHELD") brief = "Correct";
        else if (title === "TOO SLOW!") brief = "No response";
        el.feedbackLabel.className = "text-2xl font-bold tracking-wide uppercase text-slate-100";
        el.feedbackLabel.textContent = brief;
        el.feedbackSub.textContent = "";
        el.stimFeedback.classList.remove("hidden");
        el.stimFeedback.classList.add("flex");
      } else {
        el.feedbackLabel.textContent = "";
        el.feedbackSub.textContent = "";
        el.stimFeedback.classList.add("hidden");
        el.stimFeedback.classList.remove("flex");
      }

      state.timeoutId = setTimeout(() => {
        // Clear screen during Jittered ITI
        el.stimFeedback.classList.add("hidden");
        const jitteredIti = Math.floor(
          CONFIG.itiMinMs + Math.random() * (CONFIG.itiMaxMs - CONFIG.itiMinMs + 1)
        );
        state.currentIndex += 1;
        state.timeoutId = setTimeout(runNextTrial, jitteredIti);
      }, CONFIG.feedbackMs);
    }

    /**
     * COMPLETE BLOCK & COMPUTE METRICS
     */
    function finishBlock() {
      state.trialActive = false;
      if (state.blockName === "practice") {
        const pracRows = state.allLogs.filter(r => r.block === "practice");
        const pracCorrect = pracRows.filter(r => r.correct === 1).length;
        const accPct = Math.round((pracCorrect / pracRows.length) * 100);
        el.practiceSummaryText.textContent =
          `You achieved ${accPct}% accuracy across the 8 practice trials. Remember: respond quickly to Green GO arrows, and freeze completely when the Red NO-GO X appears.`;
        showScreen(el.screenTransition);
      } else {
        finalizeSession();
      }
    }

    function computeBlockStats(blockFilter) {
      const rows = state.allLogs.filter(r => r.block === blockFilter);
      const goTrials = rows.filter(r => r.trial_type === "GO");
      const nogoTrials = rows.filter(r => r.trial_type === "NOGO");

      const goHits = goTrials.filter(r => r.correct === 1);
      const goOmissions = goTrials.filter(r => r.response === "NONE");
      const nogoCommissions = nogoTrials.filter(r => r.response !== "NONE");

      const goAccuracy = goTrials.length ? (goHits.length / goTrials.length) * 100 : 0;
      const goMeanRt = goHits.length
        ? Math.round(goHits.reduce((acc, r) => acc + Number(r.rt_ms), 0) / goHits.length)
        : 0;
      const commissionRate = nogoTrials.length
        ? (nogoCommissions.length / nogoTrials.length) * 100
        : 0;
      const omissionRate = goTrials.length
        ? (goOmissions.length / goTrials.length) * 100
        : 0;

      return {
        totalTrials: rows.length,
        goCount: goTrials.length,
        nogoCount: nogoTrials.length,
        goHitsCount: goHits.length,
        goOmissionsCount: goOmissions.length,
        nogoCommissionsCount: nogoCommissions.length,
        goAccuracy: goAccuracy.toFixed(1),
        goMeanRt,
        commissionRate: commissionRate.toFixed(1),
        omissionRate: omissionRate.toFixed(1)
      };
    }

    function finalizeSession() {
      el.hudMetrics.classList.add("hidden");
      const mainStats = computeBlockStats("main");

      // Populate UI Summary Cards
      el.resGoAcc.textContent = `${mainStats.goAccuracy}%`;
      el.resGoAccSub.textContent = `${mainStats.goHitsCount} / ${mainStats.goCount} Go Hits`;

      el.resGoRt.textContent = mainStats.goMeanRt > 0 ? `${mainStats.goMeanRt} ms` : "N/A";
      el.resGoRtSub.textContent = `Across ${mainStats.goHitsCount} Correct Go`;

      el.resCommission.textContent = `${mainStats.commissionRate}%`;
      el.resCommissionSub.textContent = `${mainStats.nogoCommissionsCount} / ${mainStats.nogoCount} False Alarms`;

      el.resOmission.textContent = `${mainStats.omissionRate}%`;
      el.resOmissionSub.textContent = `${mainStats.goOmissionsCount} / ${mainStats.goCount} Missed Go`;

      // Save full session payload to localStorage["projectTrial_gonogo_v1"]
      const payload = {
        task: "gonogo_inhibition_game",
        version: "v1",
        completedAt: new Date().toISOString(),
        config: CONFIG,
        summaryMain: mainStats,
        trials: state.allLogs,
        mode: mode
      };

      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
        el.storageBadge.textContent = `Saved: localStorage["${CONFIG.storageKey}"]`;
      } catch (err) {
        el.storageBadge.textContent = "localStorage unavailable";
      }

      showScreen(el.screenResults);
    }

    /**
     * CSV GENERATION & DOWNLOAD
     * Columns: trial, block, trial_type, target_side, response, correct, rt_ms, timestamp, mode
     */
    function downloadCsv() {
      const headers = ["trial", "block", "trial_type", "target_side", "response", "correct", "rt_ms", "timestamp", "mode"];
      const csvLines = [headers.join(",")];

      for (const row of state.allLogs) {
        const line = [
          row.trial,
          row.block,
          row.trial_type,
          row.target_side,
          row.response,
          row.correct,
          row.rt_ms,
          row.timestamp,
          row.mode
        ].join(",");
        csvLines.push(line);
      }

      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      a.href = url;
      a.download = `projectTrial_gonogo_${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /**
     * EVENT LISTENERS (Pointerdown for zero-latency touch + Keyboard A/L & Arrows)
     */
    function triggerPadVisual(padEl) {
      padEl.classList.add("active-press");
      setTimeout(() => padEl.classList.remove("active-press"), 100);
    }

    el.padLeft.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      triggerPadVisual(el.padLeft);
      handleResponse("LEFT");
    });

    el.padRight.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      triggerPadVisual(el.padRight);
      handleResponse("RIGHT");
    });

    window.addEventListener("keydown", (e) => {
      if (!state.awaitingResponse) return;
      const key = e.key.toLowerCase();
      if (key === "a" || e.key === "ArrowLeft") {
        e.preventDefault();
        triggerPadVisual(el.padLeft);
        handleResponse("LEFT");
      } else if (key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        triggerPadVisual(el.padRight);
        handleResponse("RIGHT");
      }
    });

    el.btnStartPractice.addEventListener("click", () => {
      state.allLogs = [];
      startBlock("practice");
    });

    el.btnStartMain.addEventListener("click", () => {
      startBlock("main");
    });

    el.btnDownloadCsv.addEventListener("click", downloadCsv);

    el.btnRestart.addEventListener("click", () => {
      state.allLogs = [];
      showScreen(el.screenIntro);
    });

    global.TrialTasks.gonogo.current = {
      mode: mode,
      policyId: policy.id,
      audio: policy.audio ? audio : null
    };
  }

  global.TrialTasks = global.TrialTasks || {};
  global.TrialTasks.gonogo = {
    id: "gonogo",
    params: CONFIG,
    feedback: FEEDBACK,
    mount: mount,
    current: null
  };
})(window);
