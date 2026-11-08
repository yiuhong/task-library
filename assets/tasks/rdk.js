/*
  RDK motion coherence task core.

  Parameters, the trial list, dot kinematics, timing, and feedback policy
  live here. The page shell paints chrome and passes { mode, audio }.

  Both shells run 6 practice trials and a 36-trial main block. The
  gamified path keeps CORRECT / INCORRECT / TOO SLOW, the response-time
  subtitle, and tones, including the fixation chirp, on practice and on
  the main block. Classical practice shows Correct, Incorrect, or No
  response only. The classical main block keeps the 400 ms feedback hold
  and the 350 ms interval with the badge hidden. Saved runs append mode.
*/
(function (global) {
  'use strict';

    /**
     * TOP-LEVEL EXPERIMENTAL CONFIGURATION
     */
    const CONFIG = {
      storageKey: 'projectTrial_rdk_v1',
      numDots: 150,
      dotRadiusPx: 2.2,
      apertureRadiusPx: 148,
      canvasSizePx: 320,
      dotSpeedPxPerSec: 165,          // Standard speed in pixels/second
      reducedMotionSpeedPxPerSec: 85, // Softened speed if prefers-reduced-motion is active
      dotLifetimeFrames: 24,          // Finite dot lifetime to prevent tracking a single dot

      // Trial Phase Timings (ms)
      fixationMs: 500,
      stimulusDisplayMs: 800,         // Dots actively visible for 800 ms (or until response)
      stimulusMaxMs: 1200,            // Maximum response window from stimulus onset
      feedbackMs: 400,
      itiMs: 350,

      // Coherence Levels (Easy: 40%, Medium: 20%, Hard: 8%)
      coherenceLevels: [
        { label: 'Easy', pct: 40, proportion: 0.40 },
        { label: 'Medium', pct: 20, proportion: 0.20 },
        { label: 'Hard', pct: 8, proportion: 0.08 }
      ],

      // Block Trial Counts (must be multiples of 6 for balanced 3 coherence x 2 directions)
      practiceTrials: 6,
      mainTrials: 36
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

    /**
     * Task cues. The shell passes a TrialAudio session only when this mode
     * allows sound. Durations below are seconds. Classical returns before
     * playTone and does not write project-trial:sfx.
     */
    const audio = options.audio || null;
    const sfx = {
      playFixation() {
        if (mode === 'classical' || !audio || typeof audio.playTone !== 'function') return;
        audio.playTone(520, 0.045, 'sine', 0.04);
      },
      playCorrect() {
        if (mode === 'classical' || !audio || typeof audio.playTone !== 'function') return;
        audio.playTone(880, 0.11, 'triangle', 0.09);
      },
      playError() {
        if (mode === 'classical' || !audio || typeof audio.playTone !== 'function') return;
        audio.playTone(220, 0.18, 'sawtooth', 0.08);
      },
      playTimeout() {
        if (mode === 'classical' || !audio || typeof audio.playTone !== 'function') return;
        audio.playTone(160, 0.22, 'square', 0.07);
      }
    };

    /**
     * APPLICATION STATE
     */
    const state = {
      phase: 'IDLE', // IDLE | FIXATION | STIMULUS | FEEDBACK | ITI | TRANSITION | SUMMARY
      blockType: 'PRACTICE', // PRACTICE | MAIN
      trialSchedule: [],
      currentTrialIndex: 0,
      currentTrial: null,
      trialLogs: [],
      dots: [],
      animFrameId: null,
      phaseTimerId: null,
      stimulusOnsetPerf: 0,
      lastFramePerf: 0,
      awaitingResponse: false,
      prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    };

    /**
     * DOM REFERENCES
     */
    const dom = {
      hudTrial: document.getElementById('hud-trial'),
      hudAccuracy: document.getElementById('hud-accuracy'),
      hudRt: document.getElementById('hud-rt'),
      btnSfx: document.getElementById('btn-sfx'),
      sfxIcon: document.getElementById('sfx-icon'),
      sfxLabel: document.getElementById('sfx-label'),

      screenStart: document.getElementById('screen-start'),
      screenTransition: document.getElementById('screen-transition'),
      screenSummary: document.getElementById('screen-summary'),
      reducedMotionBanner: document.getElementById('reduced-motion-banner'),

      btnStartPractice: document.getElementById('btn-start-practice'),
      btnRepeatPractice: document.getElementById('btn-repeat-practice'),
      btnStartMain: document.getElementById('btn-start-main'),
      btnDownloadCsv: document.getElementById('btn-download-csv'),
      btnRestart: document.getElementById('btn-restart'),

      pracAcc: document.getElementById('prac-acc'),
      pracRt: document.getElementById('prac-rt'),

      sumAccuracy: document.getElementById('sum-accuracy'),
      sumMeanRt: document.getElementById('sum-mean-rt'),
      sumMedianRt: document.getElementById('sum-median-rt'),
      summaryCoherenceRows: document.getElementById('summary-coherence-rows'),

      canvas: document.getElementById('rdk-canvas'),
      feedbackBadge: document.getElementById('feedback-badge'),
      feedbackIcon: document.getElementById('feedback-icon'),
      feedbackText: document.getElementById('feedback-text'),
      feedbackSub: document.getElementById('feedback-sub'),
      trialStatusLabel: document.getElementById('trial-status-label'),

      padLeft: document.getElementById('pad-left'),
      padRight: document.getElementById('pad-right')
    };

    const ctx = dom.canvas.getContext('2d');

    if (state.prefersReducedMotion) {
      dom.reducedMotionBanner.classList.remove('hidden');
    }

    /**
     * BALANCED TRIAL GENERATOR
     * Creates balanced combinations of Coherence (40%, 20%, 8%) x Direction (LEFT, RIGHT)
     */
    function generateBalancedTrials(numTrials, blockName) {
      const pool = [];
      const directions = ['LEFT', 'RIGHT'];
      const baseCombinations = [];

      for (const coh of CONFIG.coherenceLevels) {
        for (const dir of directions) {
          baseCombinations.push({
            block: blockName,
            coherence_pct: coh.pct,
            coherence_prop: coh.proportion,
            coherence_label: coh.label,
            direction: dir
          });
        }
      }

      const repeats = Math.max(1, Math.floor(numTrials / baseCombinations.length));
      for (let r = 0; r < repeats; r++) {
        for (const combo of baseCombinations) {
          pool.push({ ...combo });
        }
      }

      // Fisher-Yates shuffle
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }

      return pool.map((item, idx) => ({
        ...item,
        trialNumberInBlock: idx + 1
      }));
    }

    /**
     * DOT POPULATION INITIALIZATION & KINEMATICS
     */
    function randomPointInCircle(radius) {
      const r = radius * Math.sqrt(Math.random());
      const theta = Math.random() * 2 * Math.PI;
      return {
        x: r * Math.cos(theta),
        y: r * Math.sin(theta)
      };
    }

    function initDotsForTrial(coherenceProp, direction) {
      const dots = [];
      const dirSign = direction === 'RIGHT' ? 1 : -1;
      const numCoherent = Math.round(CONFIG.numDots * coherenceProp);

      for (let i = 0; i < CONFIG.numDots; i++) {
        const pt = randomPointInCircle(CONFIG.apertureRadiusPx);
        const isCoherent = i < numCoherent;
        const randomAngle = Math.random() * 2 * Math.PI;

        dots.push({
          x: pt.x,
          y: pt.y,
          isCoherent,
          vx: isCoherent ? dirSign : Math.cos(randomAngle),
          vy: isCoherent ? 0 : Math.sin(randomAngle),
          age: Math.floor(Math.random() * CONFIG.dotLifetimeFrames)
        });
      }
      state.dots = dots;
    }

    function updateAndDrawDots(dtSec, showDots = true) {
      const cx = CONFIG.canvasSizePx / 2;
      const cy = CONFIG.canvasSizePx / 2;
      const R = CONFIG.apertureRadiusPx;
      const speed = state.prefersReducedMotion
        ? CONFIG.reducedMotionSpeedPxPerSec
        : CONFIG.dotSpeedPxPerSec;

      ctx.clearRect(0, 0, CONFIG.canvasSizePx, CONFIG.canvasSizePx);

      // Clip inside circular aperture
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();

      if (showDots) {
        ctx.fillStyle = '#f8fafc';
        for (let i = 0; i < state.dots.length; i++) {
          const d = state.dots[i];
          d.age += 1;

          // Re-seed dot at random location if lifetime expires (prevents single-dot tracking)
          if (d.age >= CONFIG.dotLifetimeFrames) {
            const pt = randomPointInCircle(R);
            d.x = pt.x;
            d.y = pt.y;
            d.age = 0;
            if (!d.isCoherent) {
              const angle = Math.random() * 2 * Math.PI;
              d.vx = Math.cos(angle);
              d.vy = Math.sin(angle);
            }
          } else {
            d.x += d.vx * speed * dtSec;
            d.y += d.vy * speed * dtSec;

            // Circular boundary wrap-around
            const distSq = d.x * d.x + d.y * d.y;
            if (distSq > R * R) {
              // Reflect across chord with slight random jitter on orthogonal axis
              d.x = -d.x * 0.95;
              d.y = (Math.random() * 2 - 1) * Math.sqrt(Math.max(0, R * R - d.x * d.x));
            }
          }

          ctx.beginPath();
          ctx.arc(cx + d.x, cy + d.y, CONFIG.dotRadiusPx, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw central fixation cross
      drawFixationCross(cx, cy, '#f59e0b');
      ctx.restore();
    }

    function drawFixationCross(cx, cy, color = '#f59e0b') {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      const arm = 7;

      // Dark halo behind fixation cross for high contrast
      ctx.beginPath();
      ctx.arc(cx, cy, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(6, 9, 17, 0.72)';
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(cx - arm, cy);
      ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm);
      ctx.lineTo(cx, cy + arm);
      ctx.stroke();
      ctx.restore();
    }

    function renderStaticAperture(showFixation = true, crossColor = '#f59e0b') {
      const cx = CONFIG.canvasSizePx / 2;
      const cy = CONFIG.canvasSizePx / 2;
      ctx.clearRect(0, 0, CONFIG.canvasSizePx, CONFIG.canvasSizePx);
      if (showFixation) {
        drawFixationCross(cx, cy, crossColor);
      }
    }

    /**
     * BLOCK & TRIAL FLOW CONTROL
     */
    function startBlock(blockType) {
      clearTimers();
      state.blockType = blockType;
      const count = blockType === 'PRACTICE' ? CONFIG.practiceTrials : CONFIG.mainTrials;
      state.trialSchedule = generateBalancedTrials(count, blockType);
      state.currentTrialIndex = 0;

      if (blockType === 'PRACTICE') {
        state.trialLogs = [];
      }

      dom.screenStart.classList.add('hidden');
      dom.screenTransition.classList.add('hidden');
      dom.screenSummary.classList.add('hidden');
      dom.feedbackBadge.classList.add('hidden');

      updateHud();
      runNextTrial();
    }

    function runNextTrial() {
      clearTimers();
      dom.feedbackBadge.classList.add('hidden');

      if (state.currentTrialIndex >= state.trialSchedule.length) {
        if (state.blockType === 'PRACTICE') {
          showTransitionScreen();
        } else {
          showSummaryScreen();
        }
        return;
      }

      state.currentTrial = state.trialSchedule[state.currentTrialIndex];
      updateHud();

      // PHASE 1: FIXATION (500 ms)
      state.phase = 'FIXATION';
      state.awaitingResponse = false;
      dom.trialStatusLabel.textContent = 'Fixate Center (+)'
      renderStaticAperture(true, '#f59e0b');
      sfx.playFixation();

      state.phaseTimerId = setTimeout(() => {
        startStimulusPhase();
      }, CONFIG.fixationMs);
    }

    function startStimulusPhase() {
      const trial = state.currentTrial;
      initDotsForTrial(trial.coherence_prop, trial.direction);

      state.phase = 'STIMULUS';
      state.awaitingResponse = true;
      state.stimulusOnsetPerf = performance.now();
      state.lastFramePerf = state.stimulusOnsetPerf;

      dom.trialStatusLabel.textContent = `Respond: Left or Right (${trial.coherence_pct}% Coherence)`;

      const animate = (now) => {
        if (state.phase !== 'STIMULUS') return;

        const elapsed = now - state.stimulusOnsetPerf;
        const dtSec = Math.min(0.05, Math.max(0.001, (now - state.lastFramePerf) / 1000));
        state.lastFramePerf = now;

        if (elapsed >= CONFIG.stimulusMaxMs) {
          handleResponse('TIMEOUT', CONFIG.stimulusMaxMs);
          return;
        }

        // Display moving dots up to CONFIG.stimulusDisplayMs, then hold fixation until max window
        const showDots = elapsed <= CONFIG.stimulusDisplayMs;
        updateAndDrawDots(dtSec, showDots);

        state.animFrameId = requestAnimationFrame(animate);
      };

      state.animFrameId = requestAnimationFrame(animate);
    }

    function handleResponse(choiceDirection, customRt = null) {
      if (!state.awaitingResponse || state.phase !== 'STIMULUS') return;
      state.awaitingResponse = false;
      clearTimers();

      const rtMs = customRt !== null
        ? Math.round(customRt)
        : Math.max(1, Math.round(performance.now() - state.stimulusOnsetPerf));

      const trial = state.currentTrial;
      const isTimeout = choiceDirection === 'TIMEOUT';
      const isCorrect = !isTimeout && choiceDirection === trial.direction ? 1 : 0;

      // Record trial log
      const record = {
        trial: state.trialLogs.length + 1,
        block: trial.block.toLowerCase(),
        coherence_pct: trial.coherence_pct,
        direction: trial.direction,
        response: choiceDirection,
        correct: isCorrect,
        rt_ms: isTimeout ? '' : rtMs,
        timestamp: new Date().toISOString()
      };
      state.trialLogs.push(record);

      // Visual & Audio Feedback (400 ms)
      state.phase = 'FEEDBACK';
      renderStaticAperture(true, '#475569');
      showFeedbackOverlay(isCorrect === 1, isTimeout, rtMs);

      if (isTimeout) {
        sfx.playTimeout();
      } else if (isCorrect === 1) {
        sfx.playCorrect();
      } else {
        sfx.playError();
      }

      updateHud();

      state.phaseTimerId = setTimeout(() => {
        dom.feedbackBadge.classList.add('hidden');
        // ITI Phase (350 ms)
        state.phase = 'ITI';
        dom.trialStatusLabel.textContent = 'Next Trial...';
        renderStaticAperture(false);

        state.phaseTimerId = setTimeout(() => {
          state.currentTrialIndex += 1;
          runNextTrial();
        }, CONFIG.itiMs);
      }, CONFIG.feedbackMs);
    }

    function showFeedbackOverlay(isCorrect, isTimeout, rtMs) {
      if (mode === 'classical') {
        var showWord = (state.blockType === 'PRACTICE' && policy.practiceFeedback)
          || (state.blockType !== 'PRACTICE' && policy.trialFeedback);
        dom.feedbackIcon.textContent = '';
        dom.feedbackSub.textContent = '';
        if (showWord) {
          dom.feedbackBadge.classList.remove('hidden');
          dom.feedbackIcon.className = 'hidden';
          dom.feedbackText.textContent = isTimeout ? 'No response' : (isCorrect ? 'Correct' : 'Incorrect');
          dom.feedbackText.className = 'font-mono text-sm font-bold tracking-widest uppercase';
        } else {
          dom.feedbackBadge.classList.add('hidden');
          dom.feedbackText.textContent = '';
        }
        return;
      }

      dom.feedbackBadge.classList.remove('hidden');

      if (isTimeout) {
        dom.feedbackIcon.textContent = '⏱';
        dom.feedbackIcon.className = 'text-4xl font-mono font-bold mb-1 text-amber-400';
        dom.feedbackText.textContent = 'TOO SLOW';
        dom.feedbackText.className = 'font-mono text-sm font-bold tracking-widest uppercase text-amber-400';
        dom.feedbackSub.textContent = `>${CONFIG.stimulusMaxMs} ms`;
      } else if (isCorrect) {
        dom.feedbackIcon.textContent = '✓';
        dom.feedbackIcon.className = 'text-4xl font-mono font-bold mb-1 text-emerald-400';
        dom.feedbackText.textContent = 'CORRECT';
        dom.feedbackText.className = 'font-mono text-sm font-bold tracking-widest uppercase text-emerald-400';
        dom.feedbackSub.textContent = `${rtMs} ms`;
      } else {
        dom.feedbackIcon.textContent = '✕';
        dom.feedbackIcon.className = 'text-4xl font-mono font-bold mb-1 text-rose-400';
        dom.feedbackText.textContent = 'INCORRECT';
        dom.feedbackText.className = 'font-mono text-sm font-bold tracking-widest uppercase text-rose-400';
        dom.feedbackSub.textContent = `${rtMs} ms`;
      }
    }

    /**
     * HUD & SUMMARY CALCULATIONS
     */
    function computeStats(logs) {
      if (!logs || logs.length === 0) {
        return { accuracyPct: 0, meanRt: 0, medianRt: 0, count: 0 };
      }
      const correctCount = logs.reduce((acc, r) => acc + r.correct, 0);
      const accuracyPct = Math.round((correctCount / logs.length) * 100);

      const validRts = logs
        .filter(r => typeof r.rt_ms === 'number' && r.rt_ms > 0)
        .map(r => r.rt_ms)
        .sort((a, b) => a - b);

      const meanRt = validRts.length
        ? Math.round(validRts.reduce((a, b) => a + b, 0) / validRts.length)
        : 0;

      let medianRt = 0;
      if (validRts.length > 0) {
        const mid = Math.floor(validRts.length / 2);
        medianRt = validRts.length % 2 !== 0
          ? validRts[mid]
          : Math.round((validRts[mid - 1] + validRts[mid]) / 2);
      }

      return { accuracyPct, meanRt, medianRt, count: logs.length };
    }

    function updateHud() {
      const totalInBlock = state.trialSchedule.length || 0;
      const currentNum = Math.min(state.currentTrialIndex + 1, totalInBlock);
      const prefix = state.blockType === 'PRACTICE' ? 'PRAC' : 'MAIN';

      if (totalInBlock > 0) {
        dom.hudTrial.textContent = `${prefix} ${currentNum}/${totalInBlock}`;
      } else {
        dom.hudTrial.textContent = 'READY';
      }

      const activeBlockLogs = state.trialLogs.filter(
        r => r.block === state.blockType.toLowerCase()
      );
      const stats = computeStats(activeBlockLogs);

      dom.hudAccuracy.textContent = stats.count > 0 ? `${stats.accuracyPct}%` : '--%';
      dom.hudRt.textContent = stats.meanRt > 0 ? `${stats.meanRt} ms` : '-- ms';
    }

    function showTransitionScreen() {
      state.phase = 'TRANSITION';
      renderStaticAperture(true, '#f59e0b');
      const pracLogs = state.trialLogs.filter(r => r.block === 'practice');
      const stats = computeStats(pracLogs);

      dom.pracAcc.textContent = `${stats.accuracyPct}%`;
      dom.pracRt.textContent = stats.meanRt > 0 ? `${stats.meanRt} ms` : '-- ms';
      dom.trialStatusLabel.textContent = 'Practice Complete';
      dom.screenTransition.classList.remove('hidden');
    }

    function showSummaryScreen() {
      state.phase = 'SUMMARY';
      renderStaticAperture(true, '#f59e0b');
      dom.trialStatusLabel.textContent = 'Experiment Complete';

      const mainLogs = state.trialLogs.filter(r => r.block === 'main');
      const targetLogs = mainLogs.length > 0 ? mainLogs : state.trialLogs;
      const overall = computeStats(targetLogs);

      dom.sumAccuracy.textContent = `${overall.accuracyPct}%`;
      dom.sumMeanRt.textContent = overall.meanRt > 0 ? `${overall.meanRt} ms` : '-- ms';
      dom.sumMedianRt.textContent = overall.medianRt > 0 ? `${overall.medianRt} ms` : '-- ms';

      // Breakdown by coherence level
      const byCoherence = {};
      dom.summaryCoherenceRows.innerHTML = '';

      CONFIG.coherenceLevels.forEach(level => {
        const subset = targetLogs.filter(r => r.coherence_pct === level.pct);
        const st = computeStats(subset);
        byCoherence[level.pct] = st;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="py-2.5 px-3 font-semibold text-slate-300">${level.label}</td>
          <td class="py-2.5 px-3 text-amber-400">${level.pct}%</td>
          <td class="py-2.5 px-3 text-right font-bold">${st.accuracyPct}%</td>
          <td class="py-2.5 px-3 text-right text-slate-300">${st.meanRt > 0 ? st.meanRt + ' ms' : '--'}</td>
        `;
        dom.summaryCoherenceRows.appendChild(tr);
      });

      // Persist summary & trial data to localStorage["projectTrial_rdk_v1"]
      const payload = {
        task: 'RDK Motion Coherence Discrimination',
        version: 'v1',
        completedAt: new Date().toISOString(),
        overall: {
          accuracy_pct: overall.accuracyPct,
          mean_rt_ms: overall.meanRt,
          median_rt_ms: overall.medianRt,
          total_main_trials: targetLogs.length
        },
        coherence_breakdown: byCoherence,
        trials: state.trialLogs,
        mode: mode
      };

      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
      } catch (e) {
        // Handle private browsing storage limits gracefully
      }

      dom.screenSummary.classList.remove('hidden');
    }

    /**
     * CSV EXPORT
     */
    function downloadCsv() {
      const headers = [
        'trial',
        'block',
        'coherence_pct',
        'direction',
        'response',
        'correct',
        'rt_ms',
        'timestamp',
        'mode'
      ];
      const rows = state.trialLogs.map(r =>
        headers.map(h => (h === 'mode' ? mode : (r[h] !== undefined ? r[h] : ''))).join(',')
      );
      const csvContent = [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `rdk_motion_data_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }

    function clearTimers() {
      if (state.animFrameId) {
        cancelAnimationFrame(state.animFrameId);
        state.animFrameId = null;
      }
      if (state.phaseTimerId) {
        clearTimeout(state.phaseTimerId);
        state.phaseTimerId = null;
      }
    }

    /**
     * INPUT BINDINGS (Pointerdown Touch Pads + Keyboard ArrowLeft/Right & A/L)
     */
    function triggerPadVisual(padEl) {
      padEl.classList.add('pad-active');
      setTimeout(() => padEl.classList.remove('pad-active'), 110);
    }

    dom.padLeft.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerPadVisual(dom.padLeft);
      handleResponse('LEFT');
    });

    dom.padRight.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      triggerPadVisual(dom.padRight);
      handleResponse('RIGHT');
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || key === 'a') {
        triggerPadVisual(dom.padLeft);
        handleResponse('LEFT');
      } else if (e.key === 'ArrowRight' || key === 'l') {
        triggerPadVisual(dom.padRight);
        handleResponse('RIGHT');
      }
    });

    // SFX toggle writes the shared project-trial:sfx key. Labels stay on this button.
    if (mode === 'classical') {
      /* SFX is hidden. Do not bind, enable, or write project-trial:sfx. */
    } else if (audio && typeof audio.bindToggle === 'function') {
      audio.bindToggle(dom.btnSfx, {
        sync(btn, on) {
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
          dom.sfxIcon.textContent = on ? '🔊' : '🔇';
          dom.sfxLabel.textContent = on ? 'SFX ON' : 'SFX OFF';
        },
        onChange(on) {
          if (on) sfx.playFixation();
        }
      });
    }


    // Screen Navigation Buttons
    dom.btnStartPractice.addEventListener('click', () => {
      if (mode === 'classical') { /* no audio context */ } else if (audio) { audio.ensureContext(); }
      startBlock('PRACTICE');
    });

    dom.btnRepeatPractice.addEventListener('click', () => {
      if (mode === 'classical') { /* no audio context */ } else if (audio) { audio.ensureContext(); }
      startBlock('PRACTICE');
    });

    dom.btnStartMain.addEventListener('click', () => {
      if (mode === 'classical') { /* no audio context */ } else if (audio) { audio.ensureContext(); }
      startBlock('MAIN');
    });

    dom.btnDownloadCsv.addEventListener('click', () => {
      downloadCsv();
    });

    dom.btnRestart.addEventListener('click', () => {
      state.trialLogs = [];
      startBlock('PRACTICE');
    });

    // Initial Aperture Render
    renderStaticAperture(true, '#f59e0b');

    global.TrialTasks.rdk.current = {
      mode: mode,
      policyId: policy.id
    };
  }

  global.TrialTasks = global.TrialTasks || {};
  global.TrialTasks.rdk = {
    id: 'rdk',
    params: CONFIG,
    feedback: FEEDBACK,
    mount: mount,
    current: null
  };
})(window);
