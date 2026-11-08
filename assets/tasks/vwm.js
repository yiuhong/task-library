/*
  Visual working memory task core.

  Parameters, the trial list, stimuli, response mapping, timing, and
  feedback policy live here. The page shell paints chrome and passes
  { mode, audio }.

  Practice is 6 trials and can be skipped. Main is 36. Set sizes are
  4, 6, and 8. Both shells are silent: audio is false, and this file
  does not load trial-audio.js.

  Gamified shows the existing per-trial words, with response time, on
  practice and main. Classical practice shows only Correct, Incorrect,
  or No response, with no response-time subtitle. The probe waits for
  a choice, so a completed trial is Correct or Incorrect. Classical
  main shows no per-trial words. The 500 ms interval still runs.
  The end screen keeps accuracy, mean RT, hit rate, false alarms,
  Cowan's K, and Pashler's K. There is no arcade score.

  CONFIG is frozen. Nothing assigns to it.
*/
(function (global) {
    "use strict";

    var CONFIG = {
            storageKey: 'projectTrial_vwm_v1',
            canvasSize: 420,
            arenaMargin: 52,       // Keep squares safely away from walls
            minCenterDist: 46,     // Avoid overlapping central fixation cross
            minItemDist: 68,       // Center-to-center minimum spacing between squares
            squareSize: 38,        // Side length in canvas pixels
            fixationMs: 500,
            sampleMs: 250,
            delayMs: 900,
            itiMs: 500,
            setSizes: [4, 6, 8],
            // 8 Distinct High-Contrast Colorblind-Safe Colors
            palette: [
              { name: 'Red-Orange', hex: '#F94144' },
              { name: 'Sky Blue',   hex: '#38BDF8' },
              { name: 'Emerald',    hex: '#10B981' },
              { name: 'Amber Gold', hex: '#F59E0B' },
              { name: 'Magenta',    hex: '#EC4899' },
              { name: 'Pure White', hex: '#F8FAFC' },
              { name: 'Violet',     hex: '#A855F7' },
              { name: 'Lime',       hex: '#A3E635' }
            ]
          };

    var FEEDBACK = {
        gamified: {
            id: "arcade",
            audio: false,
            score: false,
            practiceFeedback: "rt",
            mainFeedback: "rt"
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

    freezeTree(CONFIG);
    freezeTree(FEEDBACK);

    function mount(host) {
        var options = host || {};
        var mode = options.mode === "classical" ? "classical" : "gamified";
        var policy = FEEDBACK[mode];
        var audio = options.audio || null;

        var requiredIds = ["hud-block-val", "hud-trial-val", "btn-probe-mode", "probe-mode-label", "select-probe-type", "screen-intro", "screen-transition", "screen-arena", "screen-results", "practice-summary-text", "phase-indicator", "feedback-badge", "vwm-canvas", "pad-same", "pad-diff", "response-footer", "btn-start-practice", "btn-skip-to-main", "btn-start-main", "btn-download-csv", "btn-restart", "stat-acc", "stat-rt", "stat-hit", "stat-fa", "stat-k-mean", "table-setsize-body", "storage-status"];
        for (var rid = 0; rid < requiredIds.length; rid++) {
            if (!document.getElementById(requiredIds[rid])) {
                throw new Error("VWM shell is missing #" + requiredIds[rid]);
            }
        }

        /********************************************************************
         * 1. CONFIGURATION & COLORBLIND-SAFE PALETTE (Okabe-Ito + High-Contrast)
         ********************************************************************/


        /********************************************************************
         * 2. STATE MANAGEMENT
         ********************************************************************/
        const STATE = {
          block: 'IDLE',           // 'PRACTICE' | 'MAIN' | 'DONE'
          probeMode: 'single',     // 'single' | 'full'
          trialQueue: [],
          currentTrialIndex: 0,
          currentTrial: null,
          awaitingResponse: false,
          probeOnsetTime: 0,
          allLogs: [],             // Every recorded trial across blocks
          activeTimers: []
        };

        /********************************************************************
         * 3. DOM REFERENCES
         ********************************************************************/
        const el = {
          hudBlockVal: document.getElementById('hud-block-val'),
          hudTrialVal: document.getElementById('hud-trial-val'),
          btnProbeMode: document.getElementById('btn-probe-mode'),
          probeModeLabel: document.getElementById('probe-mode-label'),
          selectProbeType: document.getElementById('select-probe-type'),

          screenIntro: document.getElementById('screen-intro'),
          screenTransition: document.getElementById('screen-transition'),
          screenArena: document.getElementById('screen-arena'),
          screenResults: document.getElementById('screen-results'),

          practiceSummaryText: document.getElementById('practice-summary-text'),
          phaseIndicator: document.getElementById('phase-indicator'),
          feedbackBadge: document.getElementById('feedback-badge'),
          canvas: document.getElementById('vwm-canvas'),
          ctx: document.getElementById('vwm-canvas').getContext('2d'),

          padSame: document.getElementById('pad-same'),
          padDiff: document.getElementById('pad-diff'),
          responseFooter: document.getElementById('response-footer'),

          btnStartPractice: document.getElementById('btn-start-practice'),
          btnSkipToMain: document.getElementById('btn-skip-to-main'),
          btnStartMain: document.getElementById('btn-start-main'),
          btnDownloadCsv: document.getElementById('btn-download-csv'),
          btnRestart: document.getElementById('btn-restart'),

          statAcc: document.getElementById('stat-acc'),
          statRt: document.getElementById('stat-rt'),
          statHit: document.getElementById('stat-hit'),
          statFa: document.getElementById('stat-fa'),
          statKMean: document.getElementById('stat-k-mean'),
          tableSetSizeBody: document.getElementById('table-setsize-body'),
          storageStatus: document.getElementById('storage-status')
        };

        /********************************************************************
         * 4. UTILITY & EXPERIMENTAL DESIGN GENERATORS
         ********************************************************************/
        function shuffle(array) {
          const arr = array.slice();
          for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
          }
          return arr;
        }

        function clearTimers() {
          while (STATE.activeTimers.length > 0) {
            clearTimeout(STATE.activeTimers.pop());
          }
        }

        function schedule(fn, delayMs) {
          const id = setTimeout(fn, delayMs);
          STATE.activeTimers.push(id);
          return id;
        }

        /**
         * Generates balanced trial list:
         * - Practice: 6 trials (Set sizes 4, 6, 8 x SAME, DIFFERENT)
         * - Main: 36 trials (6 repetitions of each of the 6 cells: 3 set sizes x 2 trial types)
         */
        function buildBlockTrials(blockName, repsPerCell) {
          const list = [];
          const types = ['SAME', 'DIFFERENT'];

          for (let r = 0; r < repsPerCell; r++) {
            for (const setSize of CONFIG.setSizes) {
              for (const trialType of types) {
                list.push({
                  block: blockName,
                  setSize,
                  trialType
                });
              }
            }
          }
          return shuffle(list);
        }

        /**
         * Generates non-overlapping coordinates inside the 420x420 arena
         * with minimum distance from the central fixation cross and between items.
         */
        function generateStimulusItems(setSize, trialType) {
          const center = CONFIG.canvasSize / 2;
          const minCoord = CONFIG.arenaMargin;
          const maxCoord = CONFIG.canvasSize - CONFIG.arenaMargin;

          const positions = [];
          let maxAttempts = 2000;
          let currentMinDist = CONFIG.minItemDist;

          while (positions.length < setSize && maxAttempts > 0) {
            maxAttempts--;
            // Slightly relax spacing only if packing 8 squares hits rare bottleneck
            if (maxAttempts === 800) currentMinDist = 60;

            const x = minCoord + Math.random() * (maxCoord - minCoord);
            const y = minCoord + Math.random() * (maxCoord - minCoord);

            // Distance from central fixation cross
            const distCenter = Math.hypot(x - center, y - center);
            if (distCenter < CONFIG.minCenterDist) continue;

            // Distance from existing items
            let valid = true;
            for (let i = 0; i < positions.length; i++) {
              if (Math.hypot(x - positions[i].x, y - positions[i].y) < currentMinDist) {
                valid = false;
                break;
              }
            }

            if (valid) {
              positions.push({ x, y });
            }
          }

          // Sample distinct colors without replacement from the 8-color palette
          const shuffledPalette = shuffle(CONFIG.palette);
          const items = positions.map((pos, idx) => ({
            x: pos.x,
            y: pos.y,
            color: shuffledPalette[idx].hex,
            colorName: shuffledPalette[idx].name
          }));

          // Choose which item is probed (index 0 .. setSize-1)
          const probeIndex = Math.floor(Math.random() * items.length);
          let probeColor = items[probeIndex].color;

          if (trialType === 'DIFFERENT') {
            // Pick a new color from the palette that is NOT the original color of the probed square
            // Prefer a color not currently on screen if possible, or any distinct palette color
            const otherColors = CONFIG.palette.filter(c => c.hex !== items[probeIndex].color);
            const chosen = otherColors[Math.floor(Math.random() * otherColors.length)];
            probeColor = chosen.hex;
          }

          return {
            items,
            probeIndex,
            probeColor
          };
        }

        /********************************************************************
         * 5. CANVAS RENDERING ENGINE
         ********************************************************************/
        function clearCanvas() {
          const ctx = el.ctx;
          ctx.fillStyle = mode === "classical" ? "#7f7f7f" : "#0b101d";
          ctx.fillRect(0, 0, CONFIG.canvasSize, CONFIG.canvasSize);
          if (mode === "classical") return;

          // Subtle reference grid lines
          ctx.strokeStyle = 'rgba(51, 65, 85, 0.22)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(CONFIG.canvasSize / 2, 0);
          ctx.lineTo(CONFIG.canvasSize / 2, CONFIG.canvasSize);
          ctx.moveTo(0, CONFIG.canvasSize / 2);
          ctx.lineTo(CONFIG.canvasSize, CONFIG.canvasSize / 2);
          ctx.stroke();
        }

        function drawFixation(color = '#f1f5f9') {
          if (mode === "classical") color = "#111111";
          const ctx = el.ctx;
          const c = CONFIG.canvasSize / 2;
          const arm = 9;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(c - arm, c);
          ctx.lineTo(c + arm, c);
          ctx.moveTo(c, c - arm);
          ctx.lineTo(c, c + arm);
          ctx.stroke();
        }

        function drawSquare(x, y, hexColor, isCircled = false) {
          const ctx = el.ctx;
          const s = CONFIG.squareSize;
          const half = s / 2;

          // Subtle dark border for high contrast
          ctx.fillStyle = hexColor;
          ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.lineWidth = 1.5;

          ctx.beginPath();
          ctx.roundRect(x - half, y - half, s, s, 4);
          ctx.fill();
          ctx.stroke();

          // If test probe cue ring is active
          if (isCircled) {
            ctx.strokeStyle = mode === "classical" ? "#111111" : "#38bdf8";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(x, y, half + 10, 0, Math.PI * 2);
            ctx.stroke();

            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y, half + 6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        function renderSampleArray(trialData) {
          clearCanvas();
          drawFixation('#f1f5f9');
          for (const item of trialData.items) {
            drawSquare(item.x, item.y, item.color, false);
          }
        }

        function renderProbeArray(trialData) {
          clearCanvas();
          drawFixation('#94a3b8');

          if (STATE.probeMode === 'single') {
            const target = trialData.items[trialData.probeIndex];
            drawSquare(target.x, target.y, trialData.probeColor, true);
          } else {
            // Full array mode with probed square circled
            trialData.items.forEach((item, idx) => {
              const isTarget = idx === trialData.probeIndex;
              const colorToDraw = isTarget ? trialData.probeColor : item.color;
              drawSquare(item.x, item.y, colorToDraw, isTarget);
            });
          }
        }

        /********************************************************************
         * 6. TRIAL STATE MACHINE
         ********************************************************************/
        function setScreen(screenName) {
          el.screenIntro.classList.add('hidden');
          el.screenTransition.classList.add('hidden');
          el.screenArena.classList.add('hidden');
          el.screenArena.classList.remove('flex');
          el.screenResults.classList.add('hidden');

          if (screenName === 'INTRO') {
            el.screenIntro.classList.remove('hidden');
            el.responseFooter.classList.remove('hidden');
          } else if (screenName === 'TRANSITION') {
            el.screenTransition.classList.remove('hidden');
            el.responseFooter.classList.add('hidden');
          } else if (screenName === 'ARENA') {
            el.screenArena.classList.remove('hidden');
            el.screenArena.classList.add('flex');
            el.responseFooter.classList.remove('hidden');
          } else if (screenName === 'RESULTS') {
            el.screenResults.classList.remove('hidden');
            el.responseFooter.classList.add('hidden');
          }
        }

        function setPadsEnabled(enabled) {
          el.padSame.disabled = !enabled;
          el.padDiff.disabled = !enabled;
        }

        function startBlock(blockType) {
          clearTimers();
          STATE.block = blockType;
          STATE.currentTrialIndex = 0;

          if (blockType === 'PRACTICE') {
            STATE.allLogs = [];
            STATE.trialQueue = buildBlockTrials('practice', 1); // 6 trials
          } else {
            STATE.trialQueue = buildBlockTrials('main', 6);     // 36 trials
          }

          el.hudBlockVal.textContent = blockType;
          setScreen('ARENA');
          runNextTrial();
        }

        function runNextTrial() {
          clearTimers();
          STATE.awaitingResponse = false;
          setPadsEnabled(false);

          if (STATE.currentTrialIndex >= STATE.trialQueue.length) {
            if (STATE.block === 'PRACTICE') {
              showPracticeTransition();
            } else {
              finishExperiment();
            }
            return;
          }

          const spec = STATE.trialQueue[STATE.currentTrialIndex];
          const stimulus = generateStimulusItems(spec.setSize, spec.trialType);

          STATE.currentTrial = {
            trialNumber: STATE.currentTrialIndex + 1,
            block: spec.block,
            setSize: spec.setSize,
            trialType: spec.trialType,
            ...stimulus
          };

          el.hudTrialVal.textContent = `${STATE.currentTrialIndex + 1} / ${STATE.trialQueue.length}`;
          el.feedbackBadge.style.opacity = '0';

          // PHASE 1: Fixation Cross (500 ms)
          el.phaseIndicator.textContent = 'FIXATE (500 MS)';
          clearCanvas();
          drawFixation('#38bdf8');

          schedule(() => {
            // PHASE 2: Sample Array (250 ms)
            el.phaseIndicator.textContent = `SAMPLE ARRAY [N=${spec.setSize}]`;
            renderSampleArray(STATE.currentTrial);

            schedule(() => {
              // PHASE 3: Blank Retention Interval with Fixation (900 ms)
              el.phaseIndicator.textContent = 'RETENTION DELAY (900 MS)';
              clearCanvas();
              drawFixation('#f1f5f9');

              schedule(() => {
                // PHASE 4: Test Probe (Until Response)
                el.phaseIndicator.textContent = 'TEST PROBE — SAME OR DIFFERENT?';
                renderProbeArray(STATE.currentTrial);
                STATE.probeOnsetTime = performance.now();
                STATE.awaitingResponse = true;
                setPadsEnabled(true);
              }, CONFIG.delayMs);

            }, CONFIG.sampleMs);

          }, CONFIG.fixationMs);
        }

        function handleResponse(responseChoice) {
          if (!STATE.awaitingResponse || !STATE.currentTrial) return;

          const rtMs = Math.round(performance.now() - STATE.probeOnsetTime);
          STATE.awaitingResponse = false;
          setPadsEnabled(false);

          // Visual button feedback
          const padEl = responseChoice === 'SAME' ? el.padSame : el.padDiff;
          padEl.classList.add('active-key');
          setTimeout(() => padEl.classList.remove('active-key'), 140);

          const isCorrect = (responseChoice === STATE.currentTrial.trialType) ? 1 : 0;

          // Log trial record
          const record = {
            trial: STATE.allLogs.length + 1,
            block: STATE.currentTrial.block,
            set_size: STATE.currentTrial.setSize,
            trial_type: STATE.currentTrial.trialType,
            response: responseChoice,
            correct: isCorrect,
            rt_ms: rtMs,
            timestamp: new Date().toISOString()
          };
          STATE.allLogs.push(record);

          // Persist immediately to localStorage
          saveToLocalStorage();

          // Gamified: existing words, including RT, on practice and main.
          // Classical practice: Correct / Incorrect / No response, no RT.
          // Classical main: no words. The ITI below still runs.
          var feedbackKind = STATE.block === 'PRACTICE' ? policy.practiceFeedback : policy.mainFeedback;
          if (feedbackKind === 'rt') {
            el.feedbackBadge.textContent = isCorrect ? `✓ CORRECT (${rtMs} ms)` : `✕ INCORRECT (${rtMs} ms)`;
            el.feedbackBadge.className = `transition-opacity duration-150 font-bold ${isCorrect ? 'text-emerald-400' : 'text-rose-400'}`;
            el.feedbackBadge.style.opacity = '1';
          } else if (feedbackKind === 'brief') {
            if (!responseChoice) el.feedbackBadge.textContent = 'No response';
            else el.feedbackBadge.textContent = isCorrect ? 'Correct' : 'Incorrect';
            el.feedbackBadge.className = 'transition-opacity duration-150 font-bold';
            el.feedbackBadge.style.opacity = '1';
          } else {
            el.feedbackBadge.textContent = '';
            el.feedbackBadge.className = 'opacity-0 transition-opacity duration-150 font-bold';
            el.feedbackBadge.style.opacity = '0';
          }

          clearCanvas();
          drawFixation(isCorrect ? '#10b981' : '#f43f5e');

          STATE.currentTrialIndex++;
          schedule(runNextTrial, CONFIG.itiMs);
        }

        function showPracticeTransition() {
          const practiceTrials = STATE.allLogs.filter(t => t.block === 'practice');
          const correctCount = practiceTrials.filter(t => t.correct === 1).length;
          const acc = practiceTrials.length ? Math.round((correctCount / practiceTrials.length) * 100) : 0;
          el.practiceSummaryText.textContent = `Practice Accuracy: ${correctCount} / ${practiceTrials.length} (${acc}%)`;
          setScreen('TRANSITION');
        }

        /********************************************************************
         * 7. PSYCHOMETRICS: COWAN'S K, PASHLER'S K, HIT/FA RATES & CSV
         ********************************************************************/
        function computeMetricsForSubset(trials, setSize = null) {
          const filtered = setSize ? trials.filter(t => t.set_size === setSize) : trials;
          const total = filtered.length;
          if (total === 0) {
            return { acc: 0, meanRt: 0, hitRate: 0, faRate: 0, cowanK: 0, pashlerK: 0 };
          }

          const correctTrials = filtered.filter(t => t.correct === 1);
          const acc = (correctTrials.length / total) * 100;
          const meanRt = Math.round(filtered.reduce((sum, t) => sum + t.rt_ms, 0) / total);

          // Signal Detection convention in Change Detection:
          // Signal = DIFFERENT trial; Hit = Respond DIFFERENT on DIFFERENT trial
          // Noise  = SAME trial;      False Alarm = Respond DIFFERENT on SAME trial
          const diffTrials = filtered.filter(t => t.trial_type === 'DIFFERENT');
          const sameTrials = filtered.filter(t => t.trial_type === 'SAME');

          const hits = diffTrials.filter(t => t.response === 'DIFFERENT').length;
          const fas = sameTrials.filter(t => t.response === 'DIFFERENT').length;

          const hitRate = diffTrials.length > 0 ? hits / diffTrials.length : 0;
          const faRate = sameTrials.length > 0 ? fas / sameTrials.length : 0;

          let cowanK = 0;
          let pashlerK = 0;

          if (setSize) {
            // Cowan (2001): K = N * (H - FA)
            cowanK = Math.max(0, setSize * (hitRate - faRate));
            // Pashler (1988): K = N * ((H - FA) / (1 - FA))
            const denom = (1 - faRate) > 0.001 ? (1 - faRate) : 0.001;
            pashlerK = Math.max(0, Math.min(setSize, setSize * ((hitRate - faRate) / denom)));
          }

          return { acc, meanRt, hitRate, faRate, cowanK, pashlerK };
        }

        function finishExperiment() {
          STATE.block = 'DONE';
          el.hudBlockVal.textContent = 'COMPLETE';

          // Prefer Main block trials for capacity summary; fall back to all trials if needed
          const mainTrials = STATE.allLogs.filter(t => t.block === 'main');
          const evalTrials = mainTrials.length > 0 ? mainTrials : STATE.allLogs;

          const overall = computeMetricsForSubset(evalTrials, null);
          const bySetSize = CONFIG.setSizes.map(n => ({
            n,
            ...computeMetricsForSubset(evalTrials, n)
          }));

          const meanCowanK = bySetSize.reduce((acc, s) => acc + s.cowanK, 0) / bySetSize.length;

          // Populate top KPI cards
          el.statAcc.textContent = `${overall.acc.toFixed(1)}%`;
          el.statRt.textContent = `${overall.meanRt} ms`;
          el.statHit.textContent = overall.hitRate.toFixed(2);
          el.statFa.textContent = overall.faRate.toFixed(2);
          el.statKMean.textContent = meanCowanK.toFixed(2);

          // Populate Set Size Breakdown Table
          el.tableSetSizeBody.innerHTML = bySetSize.map(row => `
            <tr class="hover:bg-slate-900/60">
              <td class="py-2.5 px-3 font-bold text-slate-100">${row.n} Items</td>
              <td class="py-2.5 px-3">${row.acc.toFixed(1)}%</td>
              <td class="py-2.5 px-3">${row.meanRt} ms</td>
              <td class="py-2.5 px-3 text-emerald-400">${row.hitRate.toFixed(2)}</td>
              <td class="py-2.5 px-3 text-rose-400">${row.faRate.toFixed(2)}</td>
              <td class="py-2.5 px-3 font-bold text-sky-400">${row.cowanK.toFixed(2)}</td>
              <td class="py-2.5 px-3 text-slate-300">${row.pashlerK.toFixed(2)}</td>
            </tr>
          `).join('');

          saveToLocalStorage( { overall, bySetSize, meanCowanK } );
          setScreen('RESULTS');
        }

        function saveToLocalStorage(summary = null) {
          try {
            const payload = {
              experiment: 'vWM_change_detection',
              version: 'projectTrial_vwm_v1',
              updatedAt: new Date().toISOString(),
              probeMode: STATE.probeMode,
              mode: mode,
              summary,
              trials: STATE.allLogs
            };
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(payload));
            if (el.storageStatus) {
              el.storageStatus.textContent = `SAVED (${STATE.allLogs.length} TRIALS)`;
            }
          } catch (err) {
            if (el.storageStatus) {
              el.storageStatus.textContent = 'STORAGE ERROR';
            }
          }
        }

        function downloadCSV() {
          const headers = ['trial', 'block', 'set_size', 'trial_type', 'response', 'correct', 'rt_ms', 'timestamp', 'mode'];
          const rows = STATE.allLogs.map(r =>
            headers.map(h => (h === 'mode' ? mode : r[h])).join(',')
          );
          const csvContent = [headers.join(','), ...rows].join('\n');
          const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
          const url = URL.createObjectURL(blob);

          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', `vWM_change_detection_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }

        /********************************************************************
         * 8. EVENT LISTENERS (Touch, Click, Keyboard)
         ********************************************************************/
        function syncProbeModeUI(mode) {
          STATE.probeMode = mode;
          el.selectProbeType.value = mode;
          el.probeModeLabel.textContent = mode === 'single' ? 'SINGLE' : 'FULL ARRAY';
        }

        el.selectProbeType.addEventListener('change', (e) => {
          syncProbeModeUI(e.target.value);
        });

        el.btnProbeMode.addEventListener('click', () => {
          const nextMode = STATE.probeMode === 'single' ? 'full' : 'single';
          syncProbeModeUI(nextMode);
        });

        el.btnStartPractice.addEventListener('click', () => startBlock('PRACTICE'));
        el.btnSkipToMain.addEventListener('click', () => {
          STATE.allLogs = [];
          startBlock('MAIN');
        });
        el.btnStartMain.addEventListener('click', () => startBlock('MAIN'));
        el.btnDownloadCsv.addEventListener('click', downloadCSV);
        el.btnRestart.addEventListener('click', () => {
          clearTimers();
          STATE.block = 'IDLE';
          el.hudBlockVal.textContent = 'READY';
          el.hudTrialVal.textContent = '0 / 0';
          setPadsEnabled(false);
          setScreen('INTRO');
        });

        // Touch & Pointer Listeners on Bottom Pads
        el.padSame.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          handleResponse('SAME');
        });
        el.padDiff.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          handleResponse('DIFFERENT');
        });

        // Keyboard Listeners (A / ArrowLeft = SAME; L / ArrowRight = DIFFERENT)
        window.addEventListener('keydown', (e) => {
          if (!STATE.awaitingResponse) return;
          const key = e.key.toLowerCase();
          if (key === 'a' || e.key === 'ArrowLeft') {
            e.preventDefault();
            handleResponse('SAME');
          } else if (key === 'l' || e.key === 'ArrowRight') {
            e.preventDefault();
            handleResponse('DIFFERENT');
          }
        });

        // Initial Canvas Draw
        clearCanvas();
        drawFixation('#38bdf8');
        var api = {
            mode: mode,
            policyId: policy.id,
        };
        global.TrialTasks.vwm.current = api;
        return api;
    }

    global.TrialTasks = global.TrialTasks || {};
    global.TrialTasks.vwm = {
        id: "vwm",
        params: CONFIG,
        feedback: FEEDBACK,
        mount: mount,
        current: null
    };
})(window);
