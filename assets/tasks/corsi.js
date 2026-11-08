/*
  Corsi span task core.

  Parameters, sequences, the staircase, timing, and feedback policy
  live here. The page shell paints chrome and passes { mode, audio }.

  CONFIG.progressionMode is assigned from the progression select when
  a run starts. Do not freeze CONFIG.

  Warmup is 2 trials at span 3. Gamified audio is on: sequence tones,
  tap tones, and the AUDIO CUES select. Classical passes a null audio
  session. This file does not call playTone, setEnabled, or bindToggle
  in that shell, and it does not write project-trial:sfx.
  Flash timing is unchanged.

  Classical practice shows a brief Correct or Incorrect and no tone.
  Classical main shows neither CORRECT SEQUENCE nor INCORRECT SEQUENCE.
  The inter-trial delay still runs. Taps stay visible through that
  delay. The end screen keeps max span, correct sequences, block
  score, product, and mean tap time.
*/
(function (global) {
    "use strict";

    var CONFIG = {
          storageKey: 'projectTrial_corsi_v1',

          // Timing parameters (ms)
          preTrialDelayMs: 650,
          flashDurationMs: 500,
          interBlockGapMs: 250,
          postSequenceGoDelayMs: 200,
          interTrialIntervalMs: 900,

          // Span structure
          practiceSpan: 3,
          practiceTrials: 2,
          minSpan: 3,
          maxSpan: 9,
          trialsPerSpan: 2,

          // Progression mode: 'staircase' (discontinues when 0/2 correct at a span) or 'fixed' (runs all spans 3..9)
          progressionMode: 'staircase',

          // Classic 9-block non-grid pseudorandom normalized coordinates (adapted from Kessels et al., 2000 / Corsi 1972)
          // Values represent percentage centers (x%, y%) inside the square arena with safe margins
          blockCoordinates: [
            { id: 1, x: 52, y: 16 },
            { id: 2, x: 20, y: 22 },
            { id: 3, x: 78, y: 26 },
            { id: 4, x: 34, y: 42 },
            { id: 5, x: 66, y: 47 },
            { id: 6, x: 16, y: 63 },
            { id: 7, x: 48, y: 68 },
            { id: 8, x: 82, y: 74 },
            { id: 9, x: 29, y: 84 }
          ]
        };

    var FEEDBACK = {
        gamified: {
            id: "arcade",
            audio: true,
            score: false,
            practiceFeedback: "banner",
            mainFeedback: "banner"
        },
        classical: {
            id: "summary",
            audio: false,
            score: false,
            practiceFeedback: "brief",
            mainFeedback: "none"
        }
    };


    function freezeTree(value) {
        if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
        var keys = Object.keys(value);
        for (var i = 0; i < keys.length; i++) freezeTree(value[keys[i]]);
        return Object.freeze(value);
    }

    freezeTree(FEEDBACK);

    function mount(host) {
        var options = host || {};
        var mode = options.mode === "classical" ? "classical" : "gamified";
        var policy = FEEDBACK[mode];
        var audio = options.audio || null;

        var requiredIds = ["view-welcome", "view-arena", "view-results", "hud-telemetry", "hud-phase", "hud-span", "hud-trial", "select-mode", "toggle-sound", "btn-start-practice", "corsi-arena", "arena-overlay", "overlay-badge", "overlay-title", "overlay-subtitle", "overlay-btn", "status-dot", "status-text", "tap-progress", "tap-count-label", "btn-clear-seq", "metric-max-span", "metric-total-correct", "metric-total-trials-sub", "metric-block-score", "metric-product-sub", "metric-mean-rt", "results-table-body", "btn-download-csv", "btn-restart", "saved-storage-indicator"];
        for (var rid = 0; rid < requiredIds.length; rid++) {
            if (!document.getElementById(requiredIds[rid])) {
                throw new Error("Corsi shell is missing #" + requiredIds[rid]);
            }
        }

        /**
         * CONFIG: Experimental parameters for the Digital Corsi Block-Tapping Task
         */


        /**
         * Application State
         */
        const STATE = {
          phase: 'IDLE', // 'PRACTICE' | 'MAIN' | 'DONE'
          inputAllowed: false,
          currentSpan: 3,
          trialInSpan: 1, // 1..CONFIG.trialsPerSpan
          correctInCurrentSpan: 0,
          globalTrialIndex: 0,
          targetSequence: [],
          userSequence: [],
          tapTimestamps: [],
          goCueTimestamp: 0,
          trialLogs: []
        };

        /**
         * DOM Elements
         */
        const DOM = {
          viewWelcome: document.getElementById('view-welcome'),
          viewArena: document.getElementById('view-arena'),
          viewResults: document.getElementById('view-results'),
          hudTelemetry: document.getElementById('hud-telemetry'),
          hudPhase: document.getElementById('hud-phase'),
          hudSpan: document.getElementById('hud-span'),
          hudTrial: document.getElementById('hud-trial'),
          selectMode: document.getElementById('select-mode'),
          toggleSound: document.getElementById('toggle-sound'),
          btnStartPractice: document.getElementById('btn-start-practice'),
          arena: document.getElementById('corsi-arena'),
          arenaOverlay: document.getElementById('arena-overlay'),
          overlayBadge: document.getElementById('overlay-badge'),
          overlayTitle: document.getElementById('overlay-title'),
          overlaySubtitle: document.getElementById('overlay-subtitle'),
          overlayBtn: document.getElementById('overlay-btn'),
          statusDot: document.getElementById('status-dot'),
          statusText: document.getElementById('status-text'),
          tapProgress: document.getElementById('tap-progress'),
          tapCountLabel: document.getElementById('tap-count-label'),
          btnClearSeq: document.getElementById('btn-clear-seq'),
          metricMaxSpan: document.getElementById('metric-max-span'),
          metricTotalCorrect: document.getElementById('metric-total-correct'),
          metricTotalTrialsSub: document.getElementById('metric-total-trials-sub'),
          metricBlockScore: document.getElementById('metric-block-score'),
          metricProductSub: document.getElementById('metric-product-sub'),
          metricMeanRt: document.getElementById('metric-mean-rt'),
          resultsTableBody: document.getElementById('results-table-body'),
          btnDownloadCsv: document.getElementById('btn-download-csv'),
          btnRestart: document.getElementById('btn-restart'),
          savedStorageIndicator: document.getElementById('saved-storage-indicator')
        };

        /**
         * Cue tones. Duration stays in milliseconds here.
         * The shell passes an audio session only for the gamified policy.
         * Classical audio is null: do not call playTone, setEnabled, or
         * bindToggle, and do not write project-trial:sfx. Visual timing
         * does not wait on sound.
         */
        function playTone(freq = 440, durationMs = 90, type = 'sine', gainVal = 0.08) {
          if (!policy.audio || !audio || typeof audio.playTone !== 'function') return;
          audio.playTone(freq, durationMs / 1000, type, gainVal);
        }

        function playGoCueAudio() {
          playTone(660, 110, 'triangle', 0.11);
          setTimeout(() => playTone(880, 150, 'triangle', 0.12), 85);
        }

        /**
         * Build the 9 Pseudorandom Corsi Blocks inside the Arena
         */
        const blockElements = new Map();

        function renderArenaBlocks() {
          // Remove any existing blocks
          blockElements.forEach(el => el.remove());
          blockElements.clear();

          CONFIG.blockCoordinates.forEach(coord => {
            const block = document.createElement('div');
            block.className = 'corsi-block disabled-block';
            block.style.left = `${coord.x}%`;
            block.style.top = `${coord.y}%`;
            block.dataset.blockId = String(coord.id);
            block.setAttribute('role', 'button');
            block.setAttribute('aria-label', `Corsi Block ${coord.id}`);

            const badge = document.createElement('span');
            badge.className = 'tap-badge';
            badge.textContent = '';
            block.appendChild(badge);

            // Direct low-latency pointerdown handler
            block.addEventListener('pointerdown', (e) => {
              e.preventDefault();
              handleBlockTap(coord.id);
            });

            DOM.arena.appendChild(block);
            blockElements.set(coord.id, block);
          });
        }

        /**
         * Utility: Promise-based sleep
         */
        function sleep(ms) {
          return new Promise(resolve => setTimeout(resolve, ms));
        }

        /**
         * Generate a random sequence of unique block IDs (1..9) of length `spanLength`
         */
        function generateSequence(spanLength) {
          const pool = CONFIG.blockCoordinates.map(b => b.id);
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          return pool.slice(0, spanLength);
        }

        /**
         * Update HUD and Progress Dots
         */
        function updateHud() {
          DOM.hudPhase.textContent = STATE.phase;
          DOM.hudSpan.textContent = String(STATE.currentSpan);
          const totalForPhase = STATE.phase === 'PRACTICE' ? CONFIG.practiceTrials : CONFIG.trialsPerSpan;
          DOM.hudTrial.textContent = `${STATE.trialInSpan}/${totalForPhase}`;
          DOM.tapCountLabel.textContent = `${STATE.userSequence.length} / ${STATE.currentSpan}`;

          // Render progress indicator dots
          DOM.tapProgress.innerHTML = '';
          for (let i = 0; i < STATE.currentSpan; i++) {
            const dot = document.createElement('span');
            const filled = i < STATE.userSequence.length;
            dot.className = `w-2.5 h-2.5 rounded-full transition-all ${
              filled
                ? 'bg-fuchsia-400 shadow-[0_0_8px_#d946ef] scale-110'
                : 'bg-slate-800 border border-slate-700'
            }`;
            DOM.tapProgress.appendChild(dot);
          }
        }

        /**
         * Set Status Banner State
         */
        function setStatusBanner(mode, text) {
          DOM.statusText.textContent = text;
          DOM.arena.classList.remove('arena-go', 'arena-watch');

          if (mode === 'WATCH') {
            DOM.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
            DOM.statusText.className = 'font-mono text-xs sm:text-sm font-semibold tracking-wider uppercase text-amber-300';
            DOM.arena.classList.add('arena-watch');
          } else if (mode === 'GO') {
            DOM.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-fuchsia-400 shadow-[0_0_10px_#d946ef]';
            DOM.statusText.className = 'font-mono text-xs sm:text-sm font-semibold tracking-wider uppercase text-fuchsia-300';
            DOM.arena.classList.add('arena-go');
          } else if (mode === 'FEEDBACK_OK') {
            DOM.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400';
            DOM.statusText.className = 'font-mono text-xs sm:text-sm font-semibold tracking-wider uppercase text-emerald-300';
          } else if (mode === 'FEEDBACK_ERR') {
            DOM.statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
            DOM.statusText.className = 'font-mono text-xs sm:text-sm font-semibold tracking-wider uppercase text-rose-400';
          }
        }

        /**
         * Clear visual trace badges on blocks
         */
        function clearBlockTraces() {
          blockElements.forEach(el => {
            el.classList.remove('lit', 'tapped', 'selected-trace');
            const badge = el.querySelector('.tap-badge');
            if (badge) badge.textContent = '';
          });
        }

        function setBlocksInteractive(enabled) {
          STATE.inputAllowed = enabled;
          blockElements.forEach(el => {
            if (enabled) {
              el.classList.remove('disabled-block');
            } else {
              el.classList.add('disabled-block');
            }
          });
          DOM.btnClearSeq.disabled = !enabled || STATE.userSequence.length === 0;
        }

        /**
         * Show/Hide Arena Overlay Modal
         */
        function showArenaOverlay({ badge, title, subtitle, buttonText, onButton }) {
          DOM.overlayBadge.textContent = badge || '';
          DOM.overlayTitle.textContent = title || '';
          DOM.overlaySubtitle.textContent = subtitle || '';

          if (buttonText) {
            DOM.overlayBtn.textContent = buttonText;
            DOM.overlayBtn.classList.remove('hidden');
            DOM.overlayBtn.onclick = () => {
              DOM.arenaOverlay.classList.add('hidden');
              if (onButton) onButton();
            };
          } else {
            DOM.overlayBtn.classList.add('hidden');
            DOM.overlayBtn.onclick = null;
          }

          DOM.arenaOverlay.classList.remove('hidden');
        }

        function hideArenaOverlay() {
          DOM.arenaOverlay.classList.add('hidden');
        }

        /**
         * Run a Single Trial
         */
        async function runTrial() {
          setBlocksInteractive(false);
          clearBlockTraces();
          STATE.userSequence = [];
          STATE.tapTimestamps = [];
          STATE.targetSequence = generateSequence(STATE.currentSpan);
          updateHud();

          setStatusBanner('WATCH', 'READY — WATCH SEQUENCE');
          await sleep(CONFIG.preTrialDelayMs);

          // Flash each block in targetSequence
          for (let i = 0; i < STATE.targetSequence.length; i++) {
            const blockId = STATE.targetSequence[i];
            const blockEl = blockElements.get(blockId);

            if (blockEl) {
              blockEl.classList.add('lit');
              playTone(392 + i * 28, 120, 'sine', 0.06);
              await sleep(CONFIG.flashDurationMs);
              blockEl.classList.remove('lit');
            }

            if (i < STATE.targetSequence.length - 1) {
              await sleep(CONFIG.interBlockGapMs);
            }
          }

          await sleep(CONFIG.postSequenceGoDelayMs);

          // Trigger Audio-Visual GO Cue
          playGoCueAudio();
          setStatusBanner('GO', 'GO! TAP BLOCKS IN ORDER');
          STATE.goCueTimestamp = performance.now();
          setBlocksInteractive(true);
        }

        /**
         * Handle User Tapping a Block During Recall
         */
        function handleBlockTap(blockId) {
          if (!STATE.inputAllowed) return;

          const tapTime = performance.now();
          const blockEl = blockElements.get(blockId);

          // Record tap
          STATE.userSequence.push(blockId);
          STATE.tapTimestamps.push(tapTime);

          // Audio + visual feedback
          playTone(520 + STATE.userSequence.length * 35, 75, 'sine', 0.08);

          if (blockEl) {
            blockEl.classList.add('tapped', 'selected-trace');
            const badge = blockEl.querySelector('.tap-badge');
            if (badge) {
              badge.textContent = String(STATE.userSequence.length);
            }
            setTimeout(() => blockEl.classList.remove('tapped'), 140);
          }

          updateHud();
          DOM.btnClearSeq.disabled = STATE.userSequence.length === 0;

          // Auto-submit once sequence reaches target span length
          if (STATE.userSequence.length >= STATE.currentSpan) {
            setBlocksInteractive(false);
            setTimeout(() => evaluateTrial(), 220);
          }
        }

        /**
         * Clear current user sequence before final tap
         */
        function handleClearInput() {
          if (!STATE.inputAllowed || STATE.userSequence.length === 0) return;
          STATE.userSequence = [];
          STATE.tapTimestamps = [];
          clearBlockTraces();
          playTone(260, 90, 'sawtooth', 0.05);
          updateHud();
          DOM.btnClearSeq.disabled = true;
        }

        /**
         * Evaluate Trial Accuracy, Record Telemetry, and Advance Protocol
         */
        async function evaluateTrial() {
          const isCorrect =
            STATE.userSequence.length === STATE.targetSequence.length &&
            STATE.userSequence.every((val, idx) => val === STATE.targetSequence[idx]);

          const lastTapTime = STATE.tapTimestamps.length > 0
            ? STATE.tapTimestamps[STATE.tapTimestamps.length - 1]
            : performance.now();

          const totalRtMs = Math.round(lastTapTime - STATE.goCueTimestamp);

          // Compute mean inter-tap latency (first tap from GO cue, subsequent taps between consecutive taps)
          let intervals = [];
          for (let i = 0; i < STATE.tapTimestamps.length; i++) {
            const prev = i === 0 ? STATE.goCueTimestamp : STATE.tapTimestamps[i - 1];
            intervals.push(STATE.tapTimestamps[i] - prev);
          }
          const meanTapRtMs = intervals.length > 0
            ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length)
            : 0;

          STATE.globalTrialIndex += 1;

          const trialRecord = {
            trial: STATE.globalTrialIndex,
            block: STATE.phase,
            span_length: STATE.currentSpan,
            target_seq: STATE.targetSequence.join('-'),
            user_seq: STATE.userSequence.join('-'),
            correct: isCorrect ? 1 : 0,
            total_rt_ms: totalRtMs,
            mean_tap_rt_ms: meanTapRtMs,
            timestamp: new Date().toISOString()
          };

          STATE.trialLogs.push(trialRecord);

          if (isCorrect) {
            STATE.correctInCurrentSpan += 1;
          }

          var feedbackKind = STATE.phase === 'PRACTICE' ? policy.practiceFeedback : policy.mainFeedback;
          if (feedbackKind === 'banner') {
            if (isCorrect) {
              setStatusBanner('FEEDBACK_OK', 'CORRECT SEQUENCE');
              playTone(784, 110, 'triangle', 0.1);
              setTimeout(() => playTone(1046, 160, 'triangle', 0.1), 100);
            } else {
              setStatusBanner('FEEDBACK_ERR', 'INCORRECT SEQUENCE');
              playTone(220, 220, 'sawtooth', 0.08);
            }
          } else if (feedbackKind === 'brief') {
            setStatusBanner(isCorrect ? 'FEEDBACK_OK' : 'FEEDBACK_ERR', isCorrect ? 'Correct' : 'Incorrect');
          }

          await sleep(CONFIG.interTrialIntervalMs);
          clearBlockTraces();

          // Advance logic for PRACTICE vs MAIN phase
          if (STATE.phase === 'PRACTICE') {
            if (STATE.trialInSpan < CONFIG.practiceTrials) {
              STATE.trialInSpan += 1;
              runTrial();
            } else {
              // Transition from Practice to Main Assessment
              showArenaOverlay({
                badge: 'WARMUP COMPLETE',
                title: 'Ready for Main Assessment',
                subtitle: `The main task starts at Span Length ${CONFIG.minSpan} (2 trials per span length). Tap blocks accurately in the presented order.`,
                buttonText: 'Begin Main Assessment',
                onButton: () => startMainPhase()
              });
            }
            return;
          }

          // MAIN PHASE PROGRESSION
          if (STATE.trialInSpan < CONFIG.trialsPerSpan) {
            STATE.trialInSpan += 1;
            runTrial();
          } else {
            // Completed both trials at this span length
            const passedSpan = STATE.correctInCurrentSpan >= 1;
            const canAdvance =
              CONFIG.progressionMode === 'fixed'
                ? STATE.currentSpan < CONFIG.maxSpan
                : passedSpan && STATE.currentSpan < CONFIG.maxSpan;

            if (canAdvance) {
              STATE.currentSpan += 1;
              STATE.trialInSpan = 1;
              STATE.correctInCurrentSpan = 0;
              runTrial();
            } else {
              finishAssessment();
            }
          }
        }

        /**
         * Phase Starters
         */
        function startPracticePhase() {
          // Gamified only. Classical ignores AUDIO CUES, passes a null
          // session, and must not call setEnabled or write project-trial:sfx.
          // The setup select is the source of truth for a gamified run. Write
          // the shared key only when it disagrees, so an untouched default does
          // not store "on" by itself.
          if (policy.audio && audio) {
            const wantSound = DOM.toggleSound.value !== 'off';
            if (wantSound !== audio.isEnabled()) audio.setEnabled(wantSound);
            audio.ensureContext();
          }
          CONFIG.progressionMode = DOM.selectMode.value;

          STATE.phase = 'PRACTICE';
          STATE.currentSpan = CONFIG.practiceSpan;
          STATE.trialInSpan = 1;
          STATE.correctInCurrentSpan = 0;
          STATE.globalTrialIndex = 0;
          STATE.trialLogs = [];

          DOM.viewWelcome.classList.add('hidden');
          DOM.viewResults.classList.add('hidden');
          DOM.viewArena.classList.remove('hidden');
          DOM.viewArena.classList.add('flex');
          DOM.hudTelemetry.classList.remove('hidden');
          DOM.hudTelemetry.classList.add('flex');

          renderArenaBlocks();
          hideArenaOverlay();
          runTrial();
        }

        function startMainPhase() {
          STATE.phase = 'MAIN';
          STATE.currentSpan = CONFIG.minSpan;
          STATE.trialInSpan = 1;
          STATE.correctInCurrentSpan = 0;
          updateHud();
          runTrial();
        }

        /**
         * Finish Assessment, Compute Summary Metrics, Save to localStorage, Render End Screen
         */
        function finishAssessment() {
          STATE.phase = 'DONE';
          setBlocksInteractive(false);

          const mainTrials = STATE.trialLogs.filter(t => t.block === 'MAIN');
          const correctMainTrials = mainTrials.filter(t => t.correct === 1);

          // Maximum Corsi Span: highest span_length in MAIN with at least 1 correct trial (0 if none)
          const maxCorsiSpan = correctMainTrials.length > 0
            ? Math.max(...correctMainTrials.map(t => t.span_length))
            : 0;

          // Total Correct Sequences in MAIN
          const totalCorrectSeq = correctMainTrials.length;

          // Total Block Score: sum of span_length for all correct sequences in MAIN
          // Also compute Kessels Product Score (Max Span * Total Correct Sequences) for sub-label
          const totalBlockScore = correctMainTrials.reduce((sum, t) => sum + t.span_length, 0);
          const kesselsProduct = maxCorsiSpan * totalCorrectSeq;

          // Mean Inter-Tap Latency (ms) across MAIN trials
          const meanInterTapLatency = mainTrials.length > 0
            ? Math.round(mainTrials.reduce((acc, t) => acc + t.mean_tap_rt_ms, 0) / mainTrials.length)
            : 0;

          // Persist session payload to localStorage["projectTrial_corsi_v1"]
          const sessionSummary = {
            task: 'corsi_block_tapping',
            version: '1.0',
            completedAt: new Date().toISOString(),
            mode: mode,
            config: {
              progressionMode: CONFIG.progressionMode,
              flashDurationMs: CONFIG.flashDurationMs,
              interBlockGapMs: CONFIG.interBlockGapMs
            },
            summary: {
              maxCorsiSpan,
              totalCorrectSequences: totalCorrectSeq,
              totalBlockScore,
              kesselsProductScore: kesselsProduct,
              meanInterTapLatencyMs: meanInterTapLatency
            },
            trials: STATE.trialLogs
          };

          try {
            const existingRaw = localStorage.getItem(CONFIG.storageKey);
            let history = [];
            if (existingRaw) {
              const parsed = JSON.parse(existingRaw);
              history = Array.isArray(parsed) ? parsed : [parsed];
            }
            history.push(sessionSummary);
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(history));
            DOM.savedStorageIndicator.textContent = '✓ Saved to localStorage["projectTrial_corsi_v1"]';
          } catch (err) {
            DOM.savedStorageIndicator.textContent = '⚠ localStorage unavailable in current context';
          }

          // Populate Summary Cards
          DOM.metricMaxSpan.textContent = String(maxCorsiSpan);
          DOM.metricTotalCorrect.textContent = `${totalCorrectSeq} / ${mainTrials.length}`;
          DOM.metricBlockScore.textContent = String(totalBlockScore);
          DOM.metricProductSub.textContent = `Product score: ${kesselsProduct}`;
          DOM.metricMeanRt.textContent = `${meanInterTapLatency} ms`;

          // Populate Trial Table
          DOM.resultsTableBody.innerHTML = '';
          STATE.trialLogs.forEach(row => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-900/60';
            const badgeClass = row.correct === 1
              ? 'text-emerald-400 font-semibold'
              : 'text-rose-400';

            tr.innerHTML = `
              <td class="py-2 px-3 text-slate-400">${row.trial}</td>
              <td class="py-2 px-3">${row.block}</td>
              <td class="py-2 px-3 text-fuchsia-300 font-semibold">${row.span_length}</td>
              <td class="py-2 px-3">${row.target_seq}</td>
              <td class="py-2 px-3">${row.user_seq || '—'}</td>
              <td class="py-2 px-3 ${badgeClass}">${row.correct === 1 ? 'PASS' : 'FAIL'}</td>
              <td class="py-2 px-3 text-right">${row.mean_tap_rt_ms} ms</td>
            `;
            DOM.resultsTableBody.appendChild(tr);
          });

          // Switch View
          DOM.hudTelemetry.classList.add('hidden');
          DOM.viewArena.classList.add('hidden');
          DOM.viewArena.classList.remove('flex');
          DOM.viewResults.classList.remove('hidden');
        }

        /**
         * Export CSV with exact required columns:
         * trial, block, span_length, target_seq, user_seq, correct, total_rt_ms, mean_tap_rt_ms, timestamp
         */
        function downloadCsv() {
          const headers = [
            'trial',
            'block',
            'span_length',
            'target_seq',
            'user_seq',
            'correct',
            'total_rt_ms',
            'mean_tap_rt_ms',
            'timestamp',
            'mode'
          ];

          const rows = STATE.trialLogs.map(r => [
            r.trial,
            r.block,
            r.span_length,
            `"${r.target_seq}"`,
            `"${r.user_seq}"`,
            r.correct,
            r.total_rt_ms,
            r.mean_tap_rt_ms,
            `"${r.timestamp}"`,
            mode
          ]);

          const csvContent = [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);

          const link = document.createElement('a');
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          link.setAttribute('href', url);
          link.setAttribute('download', `projectTrial_corsi_span_${stamp}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }

        /**
         * Wire UI Event Listeners
         */
        if (policy.audio && audio && typeof audio.bindToggle === 'function') {
          audio.bindToggle(DOM.toggleSound, { kind: 'select' });
        }

        DOM.btnStartPractice.addEventListener('click', startPracticePhase);
        DOM.btnClearSeq.addEventListener('click', handleClearInput);
        DOM.btnDownloadCsv.addEventListener('click', downloadCsv);
        DOM.btnRestart.addEventListener('click', () => {
          DOM.viewResults.classList.add('hidden');
          DOM.viewWelcome.classList.remove('hidden');
        });
        var api = {
            mode: mode,
            policyId: policy.id,
            get progressionMode() { return CONFIG.progressionMode; },
        };
        global.TrialTasks.corsi.current = api;
        return api;
    }

    global.TrialTasks = global.TrialTasks || {};
    global.TrialTasks.corsi = {
        id: "corsi",
        params: CONFIG,
        feedback: FEEDBACK,
        mount: mount,
        current: null
    };
})(window);
