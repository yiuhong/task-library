/*
  Reversal Learning task core.

  Parameters, the reversal schedule, payoffs, and feedback policy live
  here. The page shell paints chrome and passes { mode, audio }.

  Both shells use the same science: 6 practice trials, 48 main trials,
  high probability 0.80, low probability 0.20, payoffs +10 and +0,
  feedback 750 ms, blank 280 ms, and the same reversal rules. CONFIG is
  not mutated.

  Partial-feedback exception: the per-trial +10 or +0 stays visible on
  practice and on the main block in both modes. That payoff is the
  reward the participant learns from. It is not replaced with Correct
  or Incorrect, and it is not arcade chrome. Classical hides the live
  point total (policy.score is false; the page marks that HUD
  data-shell-arcade). The practice screen total and the end screen stay.
  The task is silent, so both policies set audio false.

  Saved runs still replace localStorage["projectTrial_bandit_v1"].
  The payload and the CSV gain mode ("gamified" or "classical") at the end.
*/
(function (global) {
  "use strict";

  var CONFIG = {
    practiceTrials: 6,
    mainTrials: 48,
    highProbReward: 0.80,
    lowProbReward: 0.20,
    winPoints: 10,
    lossPoints: 0,
    feedbackDurationMs: 750,
    itiDurationMs: 280,
    minIntervalReversal: 15,
    maxIntervalReversal: 18,
    storageKey: "projectTrial_bandit_v1"
  };

  var FEEDBACK = {
    gamified: {
      id: "arcade",
      audio: false,
      score: true,
      trialFeedback: true
    },
    classical: {
      id: "summary",
      audio: false,
      score: false,
      trialFeedback: true
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

    var required = [
      "hud-phase-badge", "hud-trial", "hud-score",
      "screen-welcome", "screen-transition", "screen-arena", "screen-results",
      "cfg-reversal-mode", "cfg-stimulus-mapping",
      "btn-start-practice", "btn-start-main", "transition-prac-score",
      "arena-prompt", "card-left", "card-right", "card-left-tag", "card-right-tag",
      "symbol-left", "symbol-right",
      "fixation-cross", "feedback-display", "feedback-box", "feedback-icon",
      "feedback-pts", "feedback-sub",
      "pad-left", "pad-right",
      "res-total-score", "res-reward-rate", "res-optimal-pct", "res-optimal-count",
      "res-win-stay", "res-win-stay-sub", "res-lose-shift", "res-lose-shift-sub",
      "res-perseverative", "res-reversals-count", "res-mean-rt",
      "timeline-strip", "res-total-rows", "telemetry-tbody",
      "btn-restart", "btn-download-csv"
    ];
    var id;
    for (id = 0; id < required.length; id++) {
      if (!global.document.getElementById(required[id])) {
        throw new Error("Bandit shell is missing #" + required[id]);
      }
    }

    if (!policy.trialFeedback) {
      throw new Error("Bandit reward feedback is required in every mode");
    }

    /* =========================================================================
       1. ABSTRACT GEOMETRIC SVG SYMBOLS
       Two distinct, high-contrast geometric glyphs rendered inside the cards.
       ========================================================================= */
    const SYMBOLS = {
      A: {
        id: 'SYM-A',
        name: 'Concentric Rhombus',
        svg: `
          <svg viewBox="0 0 120 120" class="w-full h-full stroke-yellow-500" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="60,8 112,60 60,112 8,60" stroke-width="5" fill="rgba(234,179,8,0.08)" />
            <polygon points="60,28 92,60 60,92 28,60" stroke-width="3.5" stroke="#f1f5f9" />
            <circle cx="60" cy="60" r="8" fill="#eab308" />
          </svg>
        `
      },
      B: {
        id: 'SYM-B',
        name: 'Hexagonal Triad',
        svg: `
          <svg viewBox="0 0 120 120" class="w-full h-full stroke-slate-200" fill="none" xmlns="http://www.w3.org/2000/svg">
            <polygon points="60,10 105,35 105,85 60,110 15,85 15,35" stroke-width="5" stroke="#eab308" fill="rgba(234,179,8,0.08)" />
            <circle cx="60" cy="60" r="24" stroke-width="3.5" stroke="#f1f5f9" />
            <rect x="52" y="52" width="16" height="16" fill="#eab308" />
          </svg>
        `
      }
    };

    /* =========================================================================
       2. TASK CONFIGURATION & STATE
       ========================================================================= */
    const state = {
      phase: 'welcome', // 'welcome' | 'practice' | 'transition' | 'main' | 'results'
      reversalMode: 'fixed_interval', // 'fixed_interval' | 'performance_criterion'
      stimulusMapping: 'fixed_side',  // 'fixed_side' | 'randomized_side'
      
      blockName: 'practice',
      totalBlockTrials: 0,
      currentTrialIndex: 0, // 1-based within current block
      globalTrialIndex: 0,  // 1-based across entire session
      
      reversalPhase: 0,     // 0 in initial phase, increments on every contingency reversal
      trialsSinceLastReversal: 0,
      nextScheduledReversalGap: 16,
      recentOptimalWindow: [], // tracks last 10 choices for criterion mode
      
      // What is currently the high-probability option?
      // In 'fixed_side' mode, highProbTarget tracks 'left' or 'right'.
      // In 'randomized_side' mode, highProbTarget tracks symbol 'A' or 'B', and we map that symbol to left/right each trial.
      highProbTarget: 'left',
      currentHighProbSide: 'left',
      leftSymbolKey: 'A',
      rightSymbolKey: 'B',

      totalScore: 0,
      practiceScore: 0,
      acceptingInput: false,
      trialStartPerfTime: 0,

      logs: [] // Array of trial telemetry records
    };

    /* =========================================================================
       3. DOM ELEMENT REFERENCES
       ========================================================================= */
    const dom = {
      hudPhaseBadge: document.getElementById('hud-phase-badge'),
      hudTrial: document.getElementById('hud-trial'),
      hudScore: document.getElementById('hud-score'),

      screenWelcome: document.getElementById('screen-welcome'),
      screenTransition: document.getElementById('screen-transition'),
      screenArena: document.getElementById('screen-arena'),
      screenResults: document.getElementById('screen-results'),

      cfgReversalMode: document.getElementById('cfg-reversal-mode'),
      cfgStimulusMapping: document.getElementById('cfg-stimulus-mapping'),

      btnStartPractice: document.getElementById('btn-start-practice'),
      btnStartMain: document.getElementById('btn-start-main'),
      transitionPracScore: document.getElementById('transition-prac-score'),

      arenaPrompt: document.getElementById('arena-prompt'),
      cardLeft: document.getElementById('card-left'),
      cardRight: document.getElementById('card-right'),
      cardLeftTag: document.getElementById('card-left-tag'),
      cardRightTag: document.getElementById('card-right-tag'),
      symbolLeft: document.getElementById('symbol-left'),
      symbolRight: document.getElementById('symbol-right'),

      fixationCross: document.getElementById('fixation-cross'),
      feedbackDisplay: document.getElementById('feedback-display'),
      feedbackBox: document.getElementById('feedback-box'),
      feedbackIcon: document.getElementById('feedback-icon'),
      feedbackPts: document.getElementById('feedback-pts'),
      feedbackSub: document.getElementById('feedback-sub'),

      padLeft: document.getElementById('pad-left'),
      padRight: document.getElementById('pad-right'),

      resTotalScore: document.getElementById('res-total-score'),
      resRewardRate: document.getElementById('res-reward-rate'),
      resOptimalPct: document.getElementById('res-optimal-pct'),
      resOptimalCount: document.getElementById('res-optimal-count'),
      resWinStay: document.getElementById('res-win-stay'),
      resWinStaySub: document.getElementById('res-win-stay-sub'),
      resLoseShift: document.getElementById('res-lose-shift'),
      resLoseShiftSub: document.getElementById('res-lose-shift-sub'),
      resPerseverative: document.getElementById('res-perseverative'),
      resReversalsCount: document.getElementById('res-reversals-count'),
      resMeanRt: document.getElementById('res-mean-rt'),
      timelineStrip: document.getElementById('timeline-strip'),
      resTotalRows: document.getElementById('res-total-rows'),
      telemetryTbody: document.getElementById('telemetry-tbody'),

      btnRestart: document.getElementById('btn-restart'),
      btnDownloadCsv: document.getElementById('btn-download-csv')
    };

    /* =========================================================================
       4. HELPER UTILITIES
       ========================================================================= */
    function randomIntBetween(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function showScreen(screenKey) {
      dom.screenWelcome.classList.add('hidden');
      dom.screenTransition.classList.add('hidden');
      dom.screenArena.classList.add('hidden');
      dom.screenResults.classList.add('hidden');

      if (screenKey === 'welcome') dom.screenWelcome.classList.remove('hidden');
      if (screenKey === 'transition') dom.screenTransition.classList.remove('hidden');
      if (screenKey === 'arena') dom.screenArena.classList.remove('hidden');
      if (screenKey === 'results') dom.screenResults.classList.remove('hidden');
    }

    function updateHud() {
      dom.hudTrial.textContent = `${state.currentTrialIndex} / ${state.totalBlockTrials}`;
      if (policy.score) dom.hudScore.textContent = `${state.totalScore} PTS`;

      if (state.phase === 'practice') {
        dom.hudPhaseBadge.textContent = 'PRACTICE BLOCK';
        dom.hudPhaseBadge.className = 'px-2 py-0.5 text-xs font-mono rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/40';
      } else if (state.phase === 'main') {
        dom.hudPhaseBadge.textContent = 'MAIN BLOCK';
        dom.hudPhaseBadge.className = 'px-2 py-0.5 text-xs font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
      } else if (state.phase === 'results') {
        dom.hudPhaseBadge.textContent = 'COMPLETE';
        dom.hudPhaseBadge.className = 'px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-yellow-400 border border-yellow-500/40';
      } else {
        dom.hudPhaseBadge.textContent = 'STANDBY';
        dom.hudPhaseBadge.className = 'px-2 py-0.5 text-xs font-mono rounded bg-slate-800 text-slate-300 border border-slate-700';
      }
    }

    /* =========================================================================
       5. BLOCK & CONTINGENCY MANAGEMENT
       ========================================================================= */
    function initBlock(blockType) {
      state.reversalMode = dom.cfgReversalMode.value;
      state.stimulusMapping = dom.cfgStimulusMapping.value;

      state.blockName = blockType;
      state.phase = blockType;
      state.currentTrialIndex = 0;
      state.reversalPhase = 0;
      state.trialsSinceLastReversal = 0;
      state.recentOptimalWindow = [];
      state.nextScheduledReversalGap = randomIntBetween(CONFIG.minIntervalReversal, CONFIG.maxIntervalReversal);

      if (blockType === 'practice') {
        state.totalBlockTrials = CONFIG.practiceTrials;
        state.totalScore = 0;
        state.practiceScore = 0;
        state.globalTrialIndex = 0;
        state.logs = [];
      } else {
        state.totalBlockTrials = CONFIG.mainTrials;
        // Reset score for main experimental block so score reflects main task performance
        state.totalScore = 0;
      }

      // Randomly initialize which option starts as High-Reward (80%)
      if (state.stimulusMapping === 'fixed_side') {
        state.highProbTarget = Math.random() < 0.5 ? 'left' : 'right';
      } else {
        state.highProbTarget = Math.random() < 0.5 ? 'A' : 'B';
      }

      showScreen('arena');
      updateHud();
      startNextTrial();
    }

    function checkAndApplyReversalIfDue() {
      // Reversals occur during the Main block (48 trials -> 2 to 3 reversals)
      if (state.blockName !== 'main') return;
      if (state.currentTrialIndex <= 1) return;

      // Avoid reversing on the very final 3 trials of the 48-trial block so post-reversal behavior can be measured
      const remainingTrials = state.totalBlockTrials - state.currentTrialIndex + 1;
      if (remainingTrials < 4) return;

      let shouldReverse = false;

      if (state.reversalMode === 'fixed_interval') {
        if (state.trialsSinceLastReversal >= state.nextScheduledReversalGap) {
          shouldReverse = true;
        }
      } else {
        // Performance criterion: at least 12 trials in current phase AND >=8/10 recent optimal, OR max 18 trials reached
        const windowSum = state.recentOptimalWindow.reduce((acc, v) => acc + v, 0);
        const metAccuracyCriterion = (state.trialsSinceLastReversal >= 12 && state.recentOptimalWindow.length >= 10 && windowSum >= 8);
        const metMaxCap = (state.trialsSinceLastReversal >= CONFIG.maxIntervalReversal);
        if (metAccuracyCriterion || metMaxCap) {
          shouldReverse = true;
        }
      }

      if (shouldReverse) {
        state.reversalPhase += 1;
        state.trialsSinceLastReversal = 0;
        state.recentOptimalWindow = [];
        state.nextScheduledReversalGap = randomIntBetween(CONFIG.minIntervalReversal, CONFIG.maxIntervalReversal);

        // Silently flip the high-probability target
        if (state.stimulusMapping === 'fixed_side') {
          state.highProbTarget = state.highProbTarget === 'left' ? 'right' : 'left';
        } else {
          state.highProbTarget = state.highProbTarget === 'A' ? 'B' : 'A';
        }
      }
    }

    function assignStimuliForTrial() {
      if (state.stimulusMapping === 'fixed_side') {
        state.leftSymbolKey = 'A';
        state.rightSymbolKey = 'B';
        state.currentHighProbSide = state.highProbTarget; // 'left' or 'right'
      } else {
        // Randomize left/right symbol placement each trial
        if (Math.random() < 0.5) {
          state.leftSymbolKey = 'A';
          state.rightSymbolKey = 'B';
        } else {
          state.leftSymbolKey = 'B';
          state.rightSymbolKey = 'A';
        }
        state.currentHighProbSide = (state.leftSymbolKey === state.highProbTarget) ? 'left' : 'right';
      }

      dom.symbolLeft.innerHTML = SYMBOLS[state.leftSymbolKey].svg;
      dom.symbolRight.innerHTML = SYMBOLS[state.rightSymbolKey].svg;
      dom.cardLeftTag.textContent = SYMBOLS[state.leftSymbolKey].id;
      dom.cardRightTag.textContent = SYMBOLS[state.rightSymbolKey].id;
    }

    /* =========================================================================
       6. TRIAL EXECUTION FLOW
       ========================================================================= */
    function startNextTrial() {
      if (state.currentTrialIndex >= state.totalBlockTrials) {
        if (state.blockName === 'practice') {
          state.practiceScore = state.totalScore;
          state.phase = 'transition';
          dom.transitionPracScore.textContent = `${state.practiceScore} PTS`;
          updateHud();
          showScreen('transition');
        } else {
          finishExperiment();
        }
        return;
      }

      state.currentTrialIndex += 1;
      state.globalTrialIndex += 1;

      // Check whether a silent contingency reversal occurs prior to this trial
      checkAndApplyReversalIfDue();

      // Render geometric stimuli
      assignStimuliForTrial();

      // Reset visual card states
      dom.cardLeft.classList.remove('selected', 'unselected-dim');
      dom.cardRight.classList.remove('selected', 'unselected-dim');
      dom.feedbackDisplay.classList.add('hidden');
      dom.fixationCross.classList.remove('opacity-0');
      dom.arenaPrompt.textContent = 'Select Left or Right Card';

      updateHud();

      state.acceptingInput = true;
      state.trialStartPerfTime = performance.now();
    }

    function handleChoice(choiceSide) {
      if (!state.acceptingInput) return;
      state.acceptingInput = false;

      const rtMs = Math.max(1, Math.round(performance.now() - state.trialStartPerfTime));
      const choseOptimal = (choiceSide === state.currentHighProbSide) ? 1 : 0;

      // Determine probabilistic reward outcome (80% if optimal, 20% if suboptimal)
      const winProbability = choseOptimal === 1 ? CONFIG.highProbReward : CONFIG.lowProbReward;
      const isRewarded = Math.random() < winProbability;
      const rewardPts = isRewarded ? CONFIG.winPoints : CONFIG.lossPoints;

      state.totalScore += rewardPts;
      state.trialsSinceLastReversal += 1;
      state.recentOptimalWindow.push(choseOptimal);
      if (state.recentOptimalWindow.length > 10) {
        state.recentOptimalWindow.shift();
      }

      // Highlight chosen slot card and dim unselected card
      if (choiceSide === 'left') {
        dom.cardLeft.classList.add('selected');
        dom.cardRight.classList.add('unselected-dim');
        triggerPadVisual(dom.padLeft);
      } else {
        dom.cardRight.classList.add('selected');
        dom.cardLeft.classList.add('unselected-dim');
        triggerPadVisual(dom.padRight);
      }

      // Record trial telemetry
      const trialRecord = {
        trial: state.currentTrialIndex,
        block: state.blockName,
        reversal_phase: state.reversalPhase,
        high_prob_side: state.currentHighProbSide,
        choice_side: choiceSide,
        chose_optimal: choseOptimal,
        reward: rewardPts,
        rt_ms: rtMs,
        timestamp: new Date().toISOString()
      };
      state.logs.push(trialRecord);

      updateHud();
      presentOutcomeFeedback(rewardPts);

      setTimeout(() => {
        dom.feedbackDisplay.classList.add('hidden');
        setTimeout(() => {
          startNextTrial();
        }, CONFIG.itiDurationMs);
      }, CONFIG.feedbackDurationMs);
    }

    function triggerPadVisual(padElem) {
      padElem.classList.add('active-press');
      setTimeout(() => padElem.classList.remove('active-press'), 140);
    }

    function presentOutcomeFeedback(rewardPts) {
      dom.fixationCross.classList.add('opacity-0');
      dom.feedbackDisplay.classList.remove('hidden');
      dom.feedbackBox.classList.remove('feedback-win', 'feedback-null');

      // Force reflow for crisp animation replay
      void dom.feedbackBox.offsetWidth;

      if (rewardPts > 0) {
        dom.arenaPrompt.textContent = 'Outcome // Reward Delivered';
        dom.feedbackBox.className = 'px-4 py-3 sm:px-5 sm:py-3.5 rounded-xl border-2 border-yellow-400 bg-[#11151f] text-yellow-400 flex flex-col items-center justify-center shadow-2xl min-w-[125px] sm:min-w-[148px] feedback-win';
        dom.feedbackIcon.textContent = '★ WIN';
        dom.feedbackPts.textContent = '+10 PTS';
        dom.feedbackSub.textContent = 'REWARDED';
      } else {
        dom.arenaPrompt.textContent = 'Outcome // No Reward';
        dom.feedbackBox.className = 'px-4 py-3 sm:px-5 sm:py-3.5 rounded-xl border-2 border-slate-600 border-dashed bg-[#090b10] text-slate-300 flex flex-col items-center justify-center shadow-2xl min-w-[125px] sm:min-w-[148px] feedback-null';
        dom.feedbackIcon.textContent = 'Ø NULL';
        dom.feedbackPts.textContent = '+0 PTS';
        dom.feedbackSub.textContent = 'NO PAYOUT';
      }
    }

    /* =========================================================================
       7. BEHAVIORAL METRICS, LOCALSTORAGE & CSV EXPORT
       ========================================================================= */
    function computeBehavioralMetrics(trials) {
      const n = trials.length;
      if (n === 0) {
        return {
          totalScore: 0,
          rewardRatePct: 0,
          optimalCount: 0,
          optimalPct: 0,
          winStayPct: 0,
          winStayNum: 0,
          winStayDenom: 0,
          loseShiftPct: 0,
          loseShiftNum: 0,
          loseShiftDenom: 0,
          perseverativeErrors: 0,
          reversalsCount: 0,
          meanRtMs: 0
        };
      }

      let totalScore = 0;
      let rewardedTrials = 0;
      let optimalCount = 0;
      let sumRt = 0;

      let winStayNum = 0;
      let winStayDenom = 0;
      let loseShiftNum = 0;
      let loseShiftDenom = 0;

      for (let i = 0; i < n; i++) {
        const t = trials[i];
        totalScore += t.reward;
        if (t.reward > 0) rewardedTrials += 1;
        if (t.chose_optimal === 1) optimalCount += 1;
        sumRt += t.rt_ms;

        // Win-Stay / Lose-Shift: compare trial i with trial i+1 within the block
        if (i < n - 1) {
          const nextT = trials[i + 1];
          // Staying is defined wrt choice_side in fixed_side mode, or chosen stimulus in randomized_side
          const stayedSameSide = (nextT.choice_side === t.choice_side);

          if (t.reward > 0) {
            winStayDenom += 1;
            if (stayedSameSide) winStayNum += 1;
          } else {
            loseShiftDenom += 1;
            if (!stayedSameSide) loseShiftNum += 1;
          }
        }
      }

      // Perseverative Errors Post-Reversal:
      // For each reversal phase >= 1, count consecutive suboptimal choices (choosing the previously reinforced option)
      // immediately following the reversal, or suboptimal choices after the first post-reversal non-rewarded trial
      // before switching to the newly optimal option.
      let perseverativeErrors = 0;
      const maxRevPhase = trials.reduce((maxP, t) => Math.max(maxP, t.reversal_phase), 0);

      for (let phaseIdx = 1; phaseIdx <= maxRevPhase; phaseIdx++) {
        const phaseTrials = trials.filter(t => t.reversal_phase === phaseIdx);
        // Count consecutive suboptimal choices from the start of the new reversal phase until the participant makes their first optimal choice (after at least 1 trial)
        let switchedToNewOptimal = false;
        for (let j = 0; j < phaseTrials.length; j++) {
          if (phaseTrials[j].chose_optimal === 0) {
            if (!switchedToNewOptimal) {
              perseverativeErrors += 1;
            }
          } else {
            switchedToNewOptimal = true;
          }
        }
      }

      return {
        totalScore,
        rewardRatePct: (rewardedTrials / n) * 100,
        optimalCount,
        optimalPct: (optimalCount / n) * 100,
        winStayPct: winStayDenom > 0 ? (winStayNum / winStayDenom) * 100 : 0,
        winStayNum,
        winStayDenom,
        loseShiftPct: loseShiftDenom > 0 ? (loseShiftNum / loseShiftDenom) * 100 : 0,
        loseShiftNum,
        loseShiftDenom,
        perseverativeErrors,
        reversalsCount: maxRevPhase,
        meanRtMs: Math.round(sumRt / n)
      };
    }

    function finishExperiment() {
      state.phase = 'results';
      updateHud();
      showScreen('results');

      const mainTrials = state.logs.filter(r => r.block === 'main');
      const metrics = computeBehavioralMetrics(mainTrials);

      // Populate summary KPI cards
      dom.resTotalScore.textContent = `${metrics.totalScore} PTS`;
      dom.resRewardRate.textContent = `${metrics.rewardRatePct.toFixed(1)}% Trials Rewarded`;

      dom.resOptimalPct.textContent = `${metrics.optimalPct.toFixed(1)}%`;
      dom.resOptimalCount.textContent = `${metrics.optimalCount} / ${mainTrials.length} High-Prob`;

      dom.resWinStay.textContent = `${metrics.winStayPct.toFixed(1)}%`;
      dom.resWinStaySub.textContent = `${metrics.winStayNum} / ${metrics.winStayDenom} Post-Win`;

      dom.resLoseShift.textContent = `${metrics.loseShiftPct.toFixed(1)}%`;
      dom.resLoseShiftSub.textContent = `${metrics.loseShiftNum} / ${metrics.loseShiftDenom} Post-Loss`;

      dom.resPerseverative.textContent = `${metrics.perseverativeErrors}`;
      dom.resReversalsCount.textContent = `Across ${metrics.reversalsCount} Reversals`;
      dom.resMeanRt.textContent = `Mean RT: ${metrics.meanRtMs} ms`;

      // Render timeline strip
      dom.timelineStrip.innerHTML = '';
      let prevRevPhase = 0;
      mainTrials.forEach((t) => {
        if (t.reversal_phase !== prevRevPhase) {
          const divider = document.createElement('div');
          divider.className = 'w-1 h-8 bg-red-400 rounded flex-shrink-0 mx-0.5';
          divider.title = `Contingency Reversal #${t.reversal_phase} (Trial ${t.trial})`;
          dom.timelineStrip.appendChild(divider);
          prevRevPhase = t.reversal_phase;
        }

        const bar = document.createElement('div');
        const isOpt = t.chose_optimal === 1;
        bar.className = `h-7 flex-1 min-w-[8px] rounded-sm transition ${
          isOpt ? 'bg-yellow-500' : 'bg-slate-700'
        }`;
        bar.title = `Trial ${t.trial} | Choice: ${t.choice_side.toUpperCase()} (${isOpt ? 'Optimal' : 'Suboptimal'}) | +${t.reward} PTS | ${t.rt_ms}ms`;
        dom.timelineStrip.appendChild(bar);
      });

      // Render telemetry table rows
      dom.resTotalRows.textContent = `${state.logs.length} trials logged`;
      dom.telemetryTbody.innerHTML = '';
      state.logs.forEach((row) => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-slate-800/50';
        tr.innerHTML = `
          <td class="py-1.5 px-3">${row.trial}</td>
          <td class="py-1.5 px-3">${row.block}</td>
          <td class="py-1.5 px-3">${row.reversal_phase}</td>
          <td class="py-1.5 px-3 uppercase">${row.high_prob_side}</td>
          <td class="py-1.5 px-3 uppercase">${row.choice_side}</td>
          <td class="py-1.5 px-3 ${row.chose_optimal ? 'text-yellow-400 font-bold' : 'text-slate-500'}">${row.chose_optimal}</td>
          <td class="py-1.5 px-3 ${row.reward > 0 ? 'text-yellow-400 font-bold' : 'text-slate-400'}">+${row.reward}</td>
          <td class="py-1.5 px-3">${row.rt_ms}</td>
        `;
        dom.telemetryTbody.appendChild(tr);
      });

      // Save payload to localStorage["projectTrial_bandit_v1"]
      const payload = {
        task: 'probabilistic_reversal_learning_bandit',
        version: 'v1',
        completedAt: new Date().toISOString(),
        config: {
          reversalMode: state.reversalMode,
          stimulusMapping: state.stimulusMapping,
          highProbReward: CONFIG.highProbReward,
          lowProbReward: CONFIG.lowProbReward
        },
        summary: metrics,
        trials: state.logs,
        mode: mode
      };

      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
      } catch (err) {
        console.warn('Unable to write to localStorage:', err);
      }
    }

    function generateCsvString() {
      const headers = [
        'trial',
        'block',
        'reversal_phase',
        'high_prob_side',
        'choice_side',
        'chose_optimal',
        'reward',
        'rt_ms',
        'timestamp',
        'mode'
      ];
      const rows = [headers.join(',')];

      state.logs.forEach((r) => {
        const line = [
          r.trial,
          r.block,
          r.reversal_phase,
          r.high_prob_side,
          r.choice_side,
          r.chose_optimal,
          r.reward,
          r.rt_ms,
          `"${r.timestamp}"`,
          mode
        ].join(',');
        rows.push(line);
      });

      return rows.join('\n');
    }

    function downloadCsv() {
      const csvContent = generateCsvString();
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.setAttribute('download', `bandit_reversal_${ts}.csv`);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    /* =========================================================================
       8. EVENT LISTENERS (POINTERDOWN + KEYBOARD A/L & ARROWS)
       ========================================================================= */
    dom.btnStartPractice.addEventListener('click', () => {
      initBlock('practice');
    });

    dom.btnStartMain.addEventListener('click', () => {
      initBlock('main');
    });

    dom.btnRestart.addEventListener('click', () => {
      state.phase = 'welcome';
      state.currentTrialIndex = 0;
      state.totalBlockTrials = 0;
      state.totalScore = 0;
      updateHud();
      showScreen('welcome');
    });

    dom.btnDownloadCsv.addEventListener('click', downloadCsv);

    // Large Left / Right Touch Pads via pointerdown for sub-millisecond responsiveness
    dom.padLeft.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleChoice('left');
    });

    dom.padRight.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleChoice('right');
    });

    // Also allow direct pointerdown on the Left / Right Slot Cards
    dom.cardLeft.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleChoice('left');
    });

    dom.cardRight.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      handleChoice('right');
    });

    // Keyboard Controls: A / ArrowLeft for Left, L / ArrowRight for Right
    window.addEventListener('keydown', (e) => {
      if (!state.acceptingInput) return;
      if (e.repeat) return;

      const key = e.key.toLowerCase();
      if (key === 'a' || e.key === 'ArrowLeft') {
        e.preventDefault();
        handleChoice('left');
      } else if (key === 'l' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleChoice('right');
      }
    });

    var api = {
      mode: mode,
      policyId: policy.id,
      getPhase: function () { return state.phase; },
      getBlock: function () { return state.blockName; },
      getScore: function () { return state.totalScore; },
      getPracticeScore: function () { return state.practiceScore; },
      getLogs: function () { return state.logs.slice(); },
      getTrialIndex: function () { return state.currentTrialIndex; }
    };
    global.TrialTasks.bandit.current = api;
    return api;
  }

  global.TrialTasks = global.TrialTasks || {};
  global.TrialTasks.bandit = {
    id: "bandit",
    params: CONFIG,
    feedback: FEEDBACK,
    mount: mount,
    current: null
  };
})(window);
