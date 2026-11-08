/*
  Numerosity comparison task core.

  Parameters, the trial list, dot geometry, timing, and feedback policy
  live here. The page shell paints chrome and passes { mode, audio }.

  Both shells run 6 practice trials and a 36-trial main block. The
  gamified path keeps CORRECT / INCORRECT / TOO SLOW, the response-time
  subtitle, and tones on practice and on the main block. Classical
  practice shows Correct, Incorrect, or No response only. The classical
  main block keeps the 450 ms feedback hold and the 350 ms interval
  with the banner blank. Saved runs append mode.
*/
(function (global) {
  'use strict';

      /**
       * Master Configuration Object
       * All timings (in milliseconds), trial counts, and stimulus geometry parameters.
       */
      const CONFIG = {
        storageKey: 'projectTrial_numerosity_v1',

        // Crisp experimental timings (ms)
        fixationMs: 500,          // Central cross prior to dots
        stimulusMs: 280,          // Brief dot presentation to prevent serial counting
        maskMs: 80,               // Brief visual pattern mask after stimulus
        feedbackMs: 450,          // Correct/Incorrect + RT display duration
        itiMs: 350,               // Inter-trial blank interval
        responseTimeoutMs: 4000,  // Max allowed decision window

        // Block lengths (must be multiples of 6 for balanced difficulty x side)
        practiceTrials: 6,
        mainTrials: 36,

        // Numerosity parameters
        baseCounts: [10, 12, 15, 18, 20],
        difficultyLevels: [
          { id: 'hard',   label: 'Hard (Δ1–2)',   deltas: [1, 2] },
          { id: 'medium', label: 'Medium (Δ3–4)', deltas: [3, 4] },
          { id: 'easy',   label: 'Easy (Δ6–8)',   deltas: [6, 8] }
        ],

        // Dot geometry (logical canvas coordinates: 260 x 260)
        canvasSize: 260,
        boxPadding: 20,           // Keeps dots safely away from border
        dotRadius: 6.5,           // Identical dot size within & across boxes
        minCenterDist: 16.5,      // Minimum center-to-center distance to prevent overlap
        maxPlacementAttempts: 250
      };

  const FEEDBACK = {
    gamified: {
      id: 'arcade',
      audio: true,
      trialFeedback: true,
      practiceFeedback: true
    },
    classical: {
      id: 'summary',
      audio: false,
      trialFeedback: false,
      practiceFeedback: true
    }
  };

  function mount(host) {
    var options = host || {};
    var mode = options.mode === 'classical' ? 'classical' : 'gamified';
    var policy = FEEDBACK[mode];

      // Application State
      const state = {
        phase: 'IDLE', // IDLE | FIXATION | STIMULUS | MASK | RESPONSE | FEEDBACK | TRANSITION | END
        blockType: 'practice', // 'practice' | 'main'
        trialQueue: [],
        currentTrialIndex: 0,
        currentTrial: null,
        stimOnsetTime: 0,
        responseOpenTime: 0,
        activeTimers: [],
        allResults: []
      };

      // DOM Elements Cache
      const el = {
        hudBlockBadge: document.getElementById('hudBlockBadge'),
        hudTrialCount: document.getElementById('hudTrialCount'),
        hudAccuracy: document.getElementById('hudAccuracy'),
        hudMeanRT: document.getElementById('hudMeanRT'),
        hudProgressBar: document.getElementById('hudProgressBar'),
        btnAudioToggle: document.getElementById('btnAudioToggle'),

        screenStart: document.getElementById('screenStart'),
        screenTransition: document.getElementById('screenTransition'),
        screenArena: document.getElementById('screenArena'),
        screenEnd: document.getElementById('screenEnd'),

        lblStimMs: document.getElementById('lblStimMs'),
        lblPracticeCount: document.getElementById('lblPracticeCount'),
        lblMainCount: document.getElementById('lblMainCount'),
        transitionSummaryText: document.getElementById('transitionSummaryText'),

        btnStartPractice: document.getElementById('btnStartPractice'),
        btnStartMain: document.getElementById('btnStartMain'),
        btnDownloadCSV: document.getElementById('btnDownloadCSV'),
        btnRestartTask: document.getElementById('btnRestartTask'),

        arenaPhaseLabel: document.getElementById('arenaPhaseLabel'),
        boxLeftContainer: document.getElementById('boxLeftContainer'),
        boxRightContainer: document.getElementById('boxRightContainer'),
        canvasLeft: document.getElementById('canvasLeft'),
        canvasRight: document.getElementById('canvasRight'),
        fixationCross: document.getElementById('fixationCross'),

        feedbackBanner: document.getElementById('feedbackBanner'),
        feedbackIcon: document.getElementById('feedbackIcon'),
        feedbackText: document.getElementById('feedbackText'),
        feedbackRT: document.getElementById('feedbackRT'),

        padLeft: document.getElementById('padLeft'),
        padRight: document.getElementById('padRight'),

        endTimestamp: document.getElementById('endTimestamp'),
        endAccuracy: document.getElementById('endAccuracy'),
        endMeanRT: document.getElementById('endMeanRT'),
        endMedianRT: document.getElementById('endMedianRT'),
        endDifficultyBreakdown: document.getElementById('endDifficultyBreakdown')
      };

      // Initialize Start Screen Labels from CONFIG
      el.lblStimMs.textContent = CONFIG.stimulusMs;
      el.lblPracticeCount.textContent = `${CONFIG.practiceTrials} Trials`;
      el.lblMainCount.textContent = `${CONFIG.mainTrials} Trials`;

      /**
       * Feedback tones. Duration stays in milliseconds at the call sites.
       * assets/trial-audio.js owns the context, the oscillator, and mute.
       */
      const audio = options.audio || null;
      function playTone(freq, durationMs, type = 'sine', gainVal = 0.06) {
        if (mode === 'classical' || !audio || typeof audio.playTone !== 'function') return;
        audio.playTone(freq, durationMs / 1000, type, gainVal);
      }

      /**
       * High-DPI Canvas Setup
       */
      function setupCanvases() {
        const dpr = window.devicePixelRatio || 1;
        [el.canvasLeft, el.canvasRight].forEach((canvas) => {
          canvas.width = CONFIG.canvasSize * dpr;
          canvas.height = CONFIG.canvasSize * dpr;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
      }
      setupCanvases();
      window.addEventListener('resize', setupCanvases);

      /**
       * Timer Management Utility
       */
      function scheduleTimer(fn, delay) {
        const id = window.setTimeout(fn, delay);
        state.activeTimers.push(id);
        return id;
      }

      function clearAllTimers() {
        while (state.activeTimers.length > 0) {
          window.clearTimeout(state.activeTimers.pop());
        }
      }

      /**
       * Fisher-Yates Array Shuffle
       */
      function shuffleArray(arr) {
        const copy = arr.slice();
        for (let i = copy.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
      }

      /**
       * Generate Balanced Trial List for a Block
       * Balances correct side ('left' vs 'right') and difficulty tiers ('hard', 'medium', 'easy').
       */
      function generateBlockTrials(numTrials, blockType) {
        const trials = [];
        const sides = ['left', 'right'];
        const diffs = CONFIG.difficultyLevels;

        for (let i = 0; i < numTrials; i++) {
          const correctSide = sides[i % 2];
          const diffObj = diffs[Math.floor(i / 2) % diffs.length];
          const baseN = CONFIG.baseCounts[Math.floor(Math.random() * CONFIG.baseCounts.length)];
          const deltaN = diffObj.deltas[Math.floor(Math.random() * diffObj.deltas.length)];
          const largerN = baseN + deltaN;

          const leftN = correctSide === 'left' ? largerN : baseN;
          const rightN = correctSide === 'right' ? largerN : baseN;

          trials.push({
            block: blockType,
            difficulty: diffObj.id,
            difficultyLabel: diffObj.label,
            baseN,
            deltaN,
            leftN,
            rightN,
            correctSide
          });
        }

        return shuffleArray(trials);
      }

      /**
       * Generate Non-Overlapping Random Dot Coordinates Inside Constant-Area Box
       */
      function generateDotPositions(count) {
        const dots = [];
        const minCoord = CONFIG.boxPadding + CONFIG.dotRadius;
        const maxCoord = CONFIG.canvasSize - CONFIG.boxPadding - CONFIG.dotRadius;
        const span = maxCoord - minCoord;

        for (let i = 0; i < count; i++) {
          let placed = false;
          let candidate = { x: 0, y: 0 };

          for (let attempt = 0; attempt < CONFIG.maxPlacementAttempts; attempt++) {
            const x = minCoord + Math.random() * span;
            const y = minCoord + Math.random() * span;

            // Relax minimum distance slightly if placement gets crowded on high N
            const minDist = attempt > 160 ? CONFIG.dotRadius * 2.05 : CONFIG.minCenterDist;

            let overlaps = false;
            for (let j = 0; j < dots.length; j++) {
              const dx = dots[j].x - x;
              const dy = dots[j].y - y;
              if (Math.hypot(dx, dy) < minDist) {
                overlaps = true;
                break;
              }
            }

            if (!overlaps) {
              candidate = { x, y };
              placed = true;
              break;
            }
          }

          // Fallback if box is extremely dense
          if (!placed) {
            candidate = {
              x: minCoord + Math.random() * span,
              y: minCoord + Math.random() * span
            };
          }
          dots.push(candidate);
        }

        return dots;
      }

      /**
       * Canvas Rendering Helpers
       */
      function clearCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);
      }

      function drawDots(canvas, dots) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);

        // Subtle subtle inner frame reference
        ctx.fillStyle = '#f8fafc';
        ctx.shadowColor = mode === 'classical' ? 'transparent' : 'rgba(52, 211, 153, 0.45)';
        ctx.shadowBlur = mode === 'classical' ? 0 : 6;

        for (let i = 0; i < dots.length; i++) {
          ctx.beginPath();
          ctx.arc(dots[i].x, dots[i].y, CONFIG.dotRadius, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.shadowBlur = 0;
      }

      function drawVisualMask(canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);

        // Brief static geometric grid mask to terminate retinal persistence
        const step = 22;
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
        ctx.lineWidth = 1.2;
        for (let x = CONFIG.boxPadding; x <= CONFIG.canvasSize - CONFIG.boxPadding; x += step) {
          for (let y = CONFIG.boxPadding; y <= CONFIG.canvasSize - CONFIG.boxPadding; y += step) {
            ctx.beginPath();
            ctx.arc(x, y, 3.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }

      /**
       * Screen Visibility Switcher
       */
      function showScreen(screenName) {
        el.screenStart.classList.add('hidden');
        el.screenTransition.classList.add('hidden');
        el.screenArena.classList.add('hidden');
        el.screenEnd.classList.add('hidden');

        if (screenName === 'start') el.screenStart.classList.remove('hidden');
        if (screenName === 'transition') el.screenTransition.classList.remove('hidden');
        if (screenName === 'arena') el.screenArena.classList.remove('hidden');
        if (screenName === 'end') el.screenEnd.classList.remove('hidden');
      }

      /**
       * Update Top HUD Scoreboard
       */
      function updateHUD() {
        const totalInBlock = state.trialQueue.length;
        const currentNum = Math.min(state.currentTrialIndex + 1, totalInBlock);

        el.hudBlockBadge.textContent = state.blockType === 'practice' ? 'PRACTICE BLOCK' : 'MAIN BLOCK';
        el.hudBlockBadge.className = state.blockType === 'practice'
          ? 'inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-amber-950/90 text-amber-300 border border-amber-500/40'
          : 'inline-block px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-emerald-950/90 text-emerald-300 border border-emerald-500/40';

        el.hudTrialCount.textContent = totalInBlock ? `${currentNum} / ${totalInBlock}` : '-- / --';

        const pct = totalInBlock ? (state.currentTrialIndex / totalInBlock) * 100 : 0;
        el.hudProgressBar.style.width = `${pct}%`;

        // Calculate running accuracy & mean RT for current block
        const blockResults = state.allResults.filter((r) => r.block === state.blockType);
        if (blockResults.length === 0) {
          el.hudAccuracy.textContent = '--%';
          el.hudMeanRT.textContent = '-- ms';
        } else {
          const correctCount = blockResults.filter((r) => r.correct === 1).length;
          const acc = Math.round((correctCount / blockResults.length) * 100);
          el.hudAccuracy.textContent = `${acc}%`;

          const validRTs = blockResults.filter((r) => r.rt_ms !== null).map((r) => r.rt_ms);
          if (validRTs.length > 0) {
            const meanRT = Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length);
            el.hudMeanRT.textContent = `${meanRT} ms`;
          }
        }
      }

      /**
       * Enable / Disable Response Pads
       */
      function setResponsePadsEnabled(enabled) {
        el.padLeft.disabled = !enabled;
        el.padRight.disabled = !enabled;
      }

      /**
       * Start a Block ('practice' or 'main')
       */
      function startBlock(blockType) {
        clearAllTimers();
        state.blockType = blockType;
        const count = blockType === 'practice' ? CONFIG.practiceTrials : CONFIG.mainTrials;
        state.trialQueue = generateBlockTrials(count, blockType);
        state.currentTrialIndex = 0;

        showScreen('arena');
        updateHUD();
        runNextTrial();
      }

      /**
       * Core Trial State Machine
       * Sequence: FIXATION -> STIMULUS -> MASK -> RESPONSE -> FEEDBACK -> ITI
       */
      function runNextTrial() {
        clearAllTimers();

        if (state.currentTrialIndex >= state.trialQueue.length) {
          finishBlock();
          return;
        }

        state.currentTrial = state.trialQueue[state.currentTrialIndex];
        updateHUD();

        // Pre-compute dot coordinates before fixation begins for zero frame drop
        const leftDots = generateDotPositions(state.currentTrial.leftN);
        const rightDots = generateDotPositions(state.currentTrial.rightN);

        // Reset Visuals
        clearCanvas(el.canvasLeft);
        clearCanvas(el.canvasRight);
        el.boxLeftContainer.classList.remove('active-stim');
        el.boxRightContainer.classList.remove('active-stim');
        el.feedbackBanner.classList.replace('opacity-100', 'opacity-0');
        setResponsePadsEnabled(false);

        // 1. FIXATION PHASE
        state.phase = 'FIXATION';
        el.arenaPhaseLabel.textContent = 'FIXATE AT CENTER';
        el.fixationCross.textContent = '+';
        el.fixationCross.className = 'text-2xl sm:text-3xl font-mono font-light text-emerald-400 leading-none';

        scheduleTimer(() => {
          // 2. STIMULUS PHASE (Dots presented)
          state.phase = 'STIMULUS';
          el.arenaPhaseLabel.textContent = 'OBSERVE';
          el.boxLeftContainer.classList.add('active-stim');
          el.boxRightContainer.classList.add('active-stim');

          drawDots(el.canvasLeft, leftDots);
          drawDots(el.canvasRight, rightDots);

          state.stimOnsetTime = performance.now();
          state.responseOpenTime = state.stimOnsetTime;
          setResponsePadsEnabled(true); // Allow responses starting from stimulus onset

          scheduleTimer(() => {
            // Only transition to MASK if participant hasn't already responded during stimulus
            if (state.phase !== 'STIMULUS') return;

            // 3. BRIEF VISUAL MASK PHASE
            state.phase = 'MASK';
            drawVisualMask(el.canvasLeft);
            drawVisualMask(el.canvasRight);
            el.boxLeftContainer.classList.remove('active-stim');
            el.boxRightContainer.classList.remove('active-stim');

            scheduleTimer(() => {
              if (state.phase !== 'MASK') return;

              // 4. BLANK RESPONSE WINDOW
              state.phase = 'RESPONSE';
              clearCanvas(el.canvasLeft);
              clearCanvas(el.canvasRight);
              el.arenaPhaseLabel.textContent = 'WHICH SIDE HAD MORE DOTS?';
              el.fixationCross.textContent = '?';
              el.fixationCross.className = 'text-2xl sm:text-3xl font-mono font-bold text-slate-200 leading-none';

              // Timeout guard
              scheduleTimer(() => {
                if (state.phase === 'RESPONSE') {
                  handleParticipantChoice('timeout');
                }
              }, CONFIG.responseTimeoutMs);

            }, CONFIG.maskMs);
          }, CONFIG.stimulusMs);
        }, CONFIG.fixationMs);
      }

      /**
       * Process Participant Choice ('left' | 'right' | 'timeout')
       */
      function handleParticipantChoice(choice) {
        if (state.phase !== 'STIMULUS' && state.phase !== 'MASK' && state.phase !== 'RESPONSE') {
          return;
        }

        const now = performance.now();
        clearAllTimers();
        state.phase = 'FEEDBACK';
        setResponsePadsEnabled(false);

        // Clear any leftover dots or masks immediately
        clearCanvas(el.canvasLeft);
        clearCanvas(el.canvasRight);
        el.boxLeftContainer.classList.remove('active-stim');
        el.boxRightContainer.classList.remove('active-stim');

        const isTimeout = choice === 'timeout';
        const rtMs = isTimeout ? null : Math.round(now - state.responseOpenTime);
        const isCorrect = !isTimeout && choice === state.currentTrial.correctSide ? 1 : 0;

        // Visual button press highlight
        if (choice === 'left') {
          el.padLeft.classList.add('pad-pressed');
          setTimeout(() => el.padLeft.classList.remove('pad-pressed'), 140);
        } else if (choice === 'right') {
          el.padRight.classList.add('pad-pressed');
          setTimeout(() => el.padRight.classList.remove('pad-pressed'), 140);
        }

        // Record Trial Data (matches Project Trial CSV specification)
        const trialRecord = {
          trial: state.allResults.length + 1,
          block_trial: state.currentTrialIndex + 1,
          block: state.blockType,
          difficulty: state.currentTrial.difficulty,
          left_n: state.currentTrial.leftN,
          right_n: state.currentTrial.rightN,
          delta_n: state.currentTrial.deltaN,
          correct_side: state.currentTrial.correctSide,
          response: choice,
          correct: isCorrect,
          rt_ms: rtMs,
          timestamp: new Date().toISOString()
        };
        state.allResults.push(trialRecord);

        // Render Non-Color-Only Accessible Feedback.
        // Classical practice is one word and no tone. Classical main leaves
        // the banner blank. The feedback hold and the interval below still run.
        if (mode === 'classical') {
          var showWord = (state.blockType === 'practice' && policy.practiceFeedback)
            || (state.blockType !== 'practice' && policy.trialFeedback);
          el.feedbackIcon.textContent = '';
          el.feedbackRT.textContent = '';
          el.fixationCross.textContent = '';
          if (showWord) {
            el.feedbackText.textContent = isTimeout ? 'No response' : (isCorrect ? 'Correct' : 'Incorrect');
            el.feedbackBanner.className =
              'opacity-100 px-4 py-1.5 rounded-lg border text-xs sm:text-sm font-mono font-semibold tracking-wide transition-opacity duration-75 flex items-center gap-2';
          } else {
            el.feedbackText.textContent = '';
            el.feedbackBanner.className =
              'opacity-0 px-4 py-1.5 rounded-lg border text-xs sm:text-sm font-mono font-semibold tracking-wide transition-opacity duration-75 flex items-center gap-2';
          }
        } else if (isTimeout) {
          el.feedbackIcon.textContent = '⏱';
          el.feedbackText.textContent = 'TOO SLOW';
          el.feedbackRT.textContent = '';
          el.feedbackBanner.className =
            'opacity-100 px-4 py-1.5 rounded-lg border border-amber-500/60 bg-amber-950/90 text-amber-300 text-xs sm:text-sm font-mono font-semibold tracking-wide transition-opacity duration-75 flex items-center gap-2';
          el.fixationCross.textContent = '!';
          el.fixationCross.className = 'text-2xl sm:text-3xl font-mono font-bold text-amber-400 leading-none';
          playTone(220, 160, 'sawtooth', 0.05);
        } else if (isCorrect) {
          el.feedbackIcon.textContent = '✓';
          el.feedbackText.textContent = 'CORRECT';
          el.feedbackRT.textContent = `${rtMs} ms`;
          el.feedbackBanner.className =
            'opacity-100 px-4 py-1.5 rounded-lg border border-emerald-500/60 bg-emerald-950/90 text-emerald-300 text-xs sm:text-sm font-mono font-semibold tracking-wide transition-opacity duration-75 flex items-center gap-2';
          el.fixationCross.textContent = '✓';
          el.fixationCross.className = 'text-2xl sm:text-3xl font-mono font-bold text-emerald-400 leading-none';
          playTone(660, 95, 'sine', 0.06);
        } else {
          el.feedbackIcon.textContent = '✕';
          el.feedbackText.textContent = 'INCORRECT';
          el.feedbackRT.textContent = `${rtMs} ms`;
          el.feedbackBanner.className =
            'opacity-100 px-4 py-1.5 rounded-lg border border-rose-500/60 bg-rose-950/90 text-rose-300 text-xs sm:text-sm font-mono font-semibold tracking-wide transition-opacity duration-75 flex items-center gap-2';
          el.fixationCross.textContent = '✕';
          el.fixationCross.className = 'text-2xl sm:text-3xl font-mono font-bold text-rose-400 leading-none';
          playTone(260, 140, 'triangle', 0.06);
        }

        state.currentTrialIndex += 1;
        updateHUD();

        // Advance after Feedback + ITI
        scheduleTimer(() => {
          el.feedbackBanner.classList.replace('opacity-100', 'opacity-0');
          el.fixationCross.textContent = '';
          el.arenaPhaseLabel.textContent = '';

          scheduleTimer(() => {
            runNextTrial();
          }, CONFIG.itiMs);
        }, CONFIG.feedbackMs);
      }

      /**
       * End of Block Handler
       */
      function finishBlock() {
        clearAllTimers();
        setResponsePadsEnabled(false);
        el.hudProgressBar.style.width = '100%';

        if (state.blockType === 'practice') {
          state.phase = 'TRANSITION';
          const pracTrials = state.allResults.filter((r) => r.block === 'practice');
          const pracCorrect = pracTrials.filter((r) => r.correct === 1).length;
          const pracAcc = pracTrials.length ? Math.round((pracCorrect / pracTrials.length) * 100) : 0;
          const validRTs = pracTrials.filter((r) => r.rt_ms !== null).map((r) => r.rt_ms);
          const meanRT = validRTs.length
            ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length)
            : 0;

          el.transitionSummaryText.textContent = `Practice Accuracy: ${pracAcc}%  |  Mean RT: ${meanRT} ms`;
          showScreen('transition');
        } else {
          state.phase = 'END';
          finalizeSessionAndSave();
          showScreen('end');
        }
      }

      /**
       * Compute Final Psychometric Summary & Save to localStorage
       */
      function finalizeSessionAndSave() {
        const mainTrials = state.allResults.filter((r) => r.block === 'main');
        const total = mainTrials.length;
        const correctCount = mainTrials.filter((r) => r.correct === 1).length;
        const accuracyPct = total ? Number(((correctCount / total) * 100).toFixed(1)) : 0;

        const validRTs = mainTrials.filter((r) => r.rt_ms !== null).map((r) => r.rt_ms);
        const meanRT = validRTs.length
          ? Math.round(validRTs.reduce((a, b) => a + b, 0) / validRTs.length)
          : 0;

        // Calculate Median RT
        let medianRT = 0;
        if (validRTs.length > 0) {
          const sorted = validRTs.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          medianRT = sorted.length % 2 !== 0
            ? sorted[mid]
            : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
        }

        // Populate End Screen KPIs
        const completedAt = new Date().toISOString();
        el.endTimestamp.textContent = completedAt.slice(0, 19).replace('T', ' ');
        el.endAccuracy.textContent = `${accuracyPct}%`;
        el.endMeanRT.textContent = `${meanRT} ms`;
        el.endMedianRT.textContent = `${medianRT} ms`;

        // Breakdown by Difficulty Level
        el.endDifficultyBreakdown.innerHTML = '';
        const byDifficulty = {};

        CONFIG.difficultyLevels.forEach((d) => {
          const sub = mainTrials.filter((t) => t.difficulty === d.id);
          const subCorr = sub.filter((t) => t.correct === 1).length;
          const subAcc = sub.length ? Math.round((subCorr / sub.length) * 100) : 0;
          const subRTs = sub.filter((t) => t.rt_ms !== null).map((t) => t.rt_ms);
          const subMeanRT = subRTs.length
            ? Math.round(subRTs.reduce((a, b) => a + b, 0) / subRTs.length)
            : 0;

          byDifficulty[d.id] = { accuracyPct: subAcc, meanRtMs: subMeanRT, n: sub.length };

          const row = document.createElement('div');
          row.className = 'flex items-center justify-between py-1 border-b border-slate-800/80 last:border-none';
          row.innerHTML = `
            <span class="text-slate-300">${d.label}</span>
            <div class="flex items-center gap-4">
              <span class="text-emerald-400 font-semibold">${subAcc}%</span>
              <span class="text-slate-400 w-16 text-right">${subMeanRT} ms</span>
            </div>
          `;
          el.endDifficultyBreakdown.appendChild(row);
        });

        // Save Project Trial Payload to localStorage
        const summaryPayload = {
          taskId: 'numerosity_comparison_v1',
          completedAt,
          config: {
            stimulusMs: CONFIG.stimulusMs,
            fixationMs: CONFIG.fixationMs,
            maskMs: CONFIG.maskMs,
            practiceTrials: CONFIG.practiceTrials,
            mainTrials: CONFIG.mainTrials
          },
          summary: {
            accuracyPct,
            meanRtMs: meanRT,
            medianRtMs: medianRT,
            totalMainTrials: total,
            byDifficulty
          },
          trials: state.allResults,
          mode: mode
        };

        try {
          localStorage.setItem(CONFIG.storageKey, JSON.stringify(summaryPayload));
        } catch (err) {
          console.warn('Could not save results to localStorage:', err);
        }
      }

      /**
       * Generate and Trigger CSV Download of Trial-Level Data
       */
      function downloadCSV() {
        const headers = [
          'trial',
          'block',
          'left_n',
          'right_n',
          'correct_side',
          'response',
          'correct',
          'rt_ms',
          'timestamp',
          'mode'
        ];

        const rows = state.allResults.map((r) => [
          r.trial,
          r.block,
          r.left_n,
          r.right_n,
          r.correct_side,
          r.response,
          r.correct,
          r.rt_ms !== null ? r.rt_ms : '',
          r.timestamp,
          mode
        ]);

        const csvContent = [
          headers.join(','),
          ...rows.map((row) => row.join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const dateStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        link.setAttribute('href', url);
        link.setAttribute('download', `projectTrial_numerosity_${dateStamp}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      /**
       * Event Listeners: Low-Latency Pointerdown on Touch/Mouse Pads + Keyboard Fallbacks
       */
      el.padLeft.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!el.padLeft.disabled) handleParticipantChoice('left');
      });

      el.padRight.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (!el.padRight.disabled) handleParticipantChoice('right');
      });

      window.addEventListener('keydown', (e) => {
        if (e.repeat) return;
        const key = e.key.toLowerCase();

        if (state.phase === 'STIMULUS' || state.phase === 'MASK' || state.phase === 'RESPONSE') {
          if (e.key === 'ArrowLeft' || key === 'a') {
            e.preventDefault();
            handleParticipantChoice('left');
          } else if (e.key === 'ArrowRight' || key === 'l') {
            e.preventDefault();
            handleParticipantChoice('right');
          }
        }
      });

      // Navigation & Control Buttons
      el.btnStartPractice.addEventListener('click', () => {
        startBlock('practice');
      });

      el.btnStartMain.addEventListener('click', () => {
        startBlock('main');
      });

      el.btnDownloadCSV.addEventListener('click', () => {
        downloadCSV();
      });

      el.btnRestartTask.addEventListener('click', () => {
        state.allResults = [];
        state.currentTrialIndex = 0;
        el.hudProgressBar.style.width = '0%';
        startBlock('practice');
      });

      if (mode === 'classical') {
        /* SFX is hidden. Do not bind, enable, or write project-trial:sfx. */
      } else if (audio && typeof audio.bindToggle === 'function') {
        audio.bindToggle(el.btnAudioToggle, {
          sync(btn, on) {
            btn.textContent = on ? 'SFX: ON' : 'SFX: OFF';
            btn.classList.toggle('text-emerald-400', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        });
      }

      global.TrialTasks.numerosity.current = {
        mode: mode,
        policyId: policy.id
      };
    }

  global.TrialTasks = global.TrialTasks || {};
  global.TrialTasks.numerosity = {
    id: 'numerosity',
    params: CONFIG,
    feedback: FEEDBACK,
    mount: mount,
    current: null
  };
})(window);
