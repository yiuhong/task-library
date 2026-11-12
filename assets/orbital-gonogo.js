/*
  Spatial Go/No-Go (Orbital Energy Sorter) — trial plan.

  WebXR special case. This file is not a TrialShell core. The page
  orbital_gonogo.html loads it with a plain script tag. It does not read
  project-trial:mode and it does not write project-trial:sfx.

  Depth is a balanced factor inside one frontal field. Three planes sit
  ahead of the start-of-run eye. Each plane gets the same go and no-go
  counts. Nothing is placed beside or behind the viewer.

  Planes (metres along the straight-ahead depth axis from the
  start-of-run eye; eye at the origin => negative z):
    near  1.80
    mid   3.30
    far   5.50
  Fixation stays at 3.00 m, slightly in front of the mid plane.

  Size is chosen on the start screen. The default is constant physical
  size: radius 0.40 m on every plane, so on-axis visual angles are about
  25.1° / 13.8° / 8.3°. Constant visual angle uses the mid plane as the
  reference (0.40 m at 3.30 m) and scales radius with plane distance, so
  the three planes share that angle. Near is then about 0.218 m and far
  about 0.667 m.

  Fixation during the stimulus is chosen on the start screen. The default
  hides the plus when the target appears and keeps the target opaque. A
  nearer target may cover the fixation spot. The other setting keeps the
  plus up and draws the target translucent, so the plus shows through.

  An optional three-trial practice can run first (near go, mid no-go,
  far go) with the plus visible. Those trials are not part of the 30.
  The default run has no practice block.

  Both shapes stay still. Colour and shape still decide go and no-go.

  Each plane: 7 GO + 3 NOGO = 10 trials. Three planes = 30 trials
  (21 GO / 9 NOGO, 70% / 30%). Order is a Fisher–Yates shuffle.
  The shuffle changes order only. It does not move the target.

  Every trial uses one fixed visual direction, the same azimuth and
  elevation on every plane:
    azimuth    0°  (straight ahead, on the fixation axis)
    elevation  0°  (straight ahead, on the fixation axis)
  Only distance changes, so the target stays at one screen position.
*/
(function (global) {
  'use strict';

  var STORAGE_KEY = 'projectTrial_orbital_gonogo_v1';
  var TOTAL_TRIALS = 30;
  var GO_PER_PLANE = 7;
  var NOGO_PER_PLANE = 3;
  var STIMULUS_TIMEOUT_MS = 1200;
  var ITI_MIN_MS = 800;
  var ITI_MAX_MS = 1400;
  var TARGET_RADIUS_M = 0.4;
  var AZIMUTH_DEG = 0;
  var ELEVATION_DEG = 0;
  var FIXATION_DISTANCE_M = 3;
  var SIZE_PHYSICAL = 'constant_physical';
  var SIZE_ANGLE = 'constant_angle';
  var FIXATION_HIDDEN = 'hidden';
  var FIXATION_VISIBLE = 'visible';
  var BLOCK_MAIN = 'main';
  var BLOCK_PRACTICE = 'practice';
  var REFERENCE_PLANE_ID = 'mid';
  var VISIBLE_TARGET_OPACITY = 0.45;

  var DEPTH_PLANES = [
    { id: 'near', distance_m: 1.8 },
    { id: 'mid', distance_m: 3.3 },
    { id: 'far', distance_m: 5.5 }
  ];

  var PRACTICE_SPEC = [
    { id: 'near', trial_type: 'GO' },
    { id: 'mid', trial_type: 'NOGO' },
    { id: 'far', trial_type: 'GO' }
  ];

  var CSV_COLUMNS = [
    'trial_num',
    'trial_type',
    'depth_plane',
    'plane_distance_m',
    'distance_m',
    'visual_angle_deg',
    'angle_h_deg',
    'angle_v_deg',
    'iti_ms',
    'x_pos',
    'y_pos',
    'z_pos',
    'eccentricity_deg',
    'stimulus_radius_m',
    'response_made',
    'outcome',
    'rt_ms',
    'score_total',
    'streak',
    'size_mode',
    'fixation_mode',
    'fixation_occluded',
    'block'
  ];

  function createSchedule(rng) {
    var random = rng || Math.random;
    var list = [];
    var p;
    var i;
    for (p = 0; p < DEPTH_PLANES.length; p++) {
      for (i = 0; i < GO_PER_PLANE; i++) {
        list.push({
          trial_type: 'GO',
          depth_plane: DEPTH_PLANES[p].id,
          plane_distance_m: DEPTH_PLANES[p].distance_m
        });
      }
      for (i = 0; i < NOGO_PER_PLANE; i++) {
        list.push({
          trial_type: 'NOGO',
          depth_plane: DEPTH_PLANES[p].id,
          plane_distance_m: DEPTH_PLANES[p].distance_m
        });
      }
    }
    for (i = list.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function createPracticeSchedule() {
    var list = [];
    var s;
    var p;
    for (s = 0; s < PRACTICE_SPEC.length; s++) {
      for (p = 0; p < DEPTH_PLANES.length; p++) {
        if (DEPTH_PLANES[p].id !== PRACTICE_SPEC[s].id) continue;
        list.push({
          trial_type: PRACTICE_SPEC[s].trial_type,
          depth_plane: DEPTH_PLANES[p].id,
          plane_distance_m: DEPTH_PLANES[p].distance_m
        });
      }
    }
    return list;
  }

  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  function referenceDistanceM() {
    var i;
    for (i = 0; i < DEPTH_PLANES.length; i++) {
      if (DEPTH_PLANES[i].id === REFERENCE_PLANE_ID) return DEPTH_PLANES[i].distance_m;
    }
    return DEPTH_PLANES[1].distance_m;
  }

  function radiusForPlane(planeDistance, sizeMode) {
    var distance = Number(planeDistance);
    if (!(distance > 0)) return TARGET_RADIUS_M;
    if (sizeMode === SIZE_ANGLE) {
      var reference = referenceDistanceM();
      if (!(reference > 0)) return TARGET_RADIUS_M;
      return TARGET_RADIUS_M * (distance / reference);
    }
    return TARGET_RADIUS_M;
  }

  function shownRadius(planeDistance, sizeMode) {
    return round3(radiusForPlane(planeDistance, sizeMode));
  }

  function placeOnPlane(planeDistance, eye, baseY) {
    var hDeg = AZIMUTH_DEG;
    var vDeg = ELEVATION_DEG;
    var x = eye.x + planeDistance * Math.tan(degToRad(hDeg));
    var y = baseY + planeDistance * Math.tan(degToRad(vDeg));
    var z = eye.z - planeDistance;
    return {
      x: round3(x),
      y: round3(y),
      z: round3(z),
      angle_h_deg: round2(hDeg),
      angle_v_deg: round2(vDeg)
    };
  }

  function fixationAt(eye, baseY) {
    return {
      x: round3(eye.x),
      y: round3(baseY),
      z: round3(eye.z - FIXATION_DISTANCE_M)
    };
  }

  function eccentricityDeg(x, y, z, eye, fixation) {
    var vx = x - eye.x;
    var vy = y - eye.y;
    var vz = z - eye.z;
    var refX = fixation.x - eye.x;
    var refY = fixation.y - eye.y;
    var refZ = fixation.z - eye.z;
    var vMag = Math.sqrt(vx * vx + vy * vy + vz * vz);
    var refMag = Math.sqrt(refX * refX + refY * refY + refZ * refZ);
    if (vMag === 0 || refMag === 0) return 0;
    var dot = vx * refX + vy * refY + vz * refZ;
    var cosTheta = Math.min(1, Math.max(-1, dot / (vMag * refMag)));
    return round2(Math.acos(cosTheta) * (180 / Math.PI));
  }

  function distanceM(x, y, z, eye) {
    var dx = x - eye.x;
    var dy = y - eye.y;
    var dz = z - eye.z;
    return round3(Math.sqrt(dx * dx + dy * dy + dz * dz));
  }

  function visualAngleDeg(radius, distance) {
    if (!(distance > 0)) return 0;
    return round2(2 * Math.atan(radius / distance) * (180 / Math.PI));
  }

  function vectorTo(from, to) {
    return {
      x: to.x - from.x,
      y: to.y - from.y,
      z: to.z - from.z
    };
  }

  function vectorLength(v) {
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  /*
    1 when an opaque target's bounding radius crosses in front of the
    fixation point and covers that direction. The visible-plus setting
    returns 0: the plus stays up through a translucent target.
  */
  function fixationOccluded(fixationMode, placed, radius, eye, fixation) {
    if (fixationMode !== FIXATION_HIDDEN) return 0;
    if (!(radius > 0)) return 0;
    var toTarget = vectorTo(eye, placed);
    var toFix = vectorTo(eye, fixation);
    var targetDist = vectorLength(toTarget);
    var fixDist = vectorLength(toFix);
    if (!(targetDist > 0) || !(fixDist > 0)) return 0;
    if (targetDist - radius >= fixDist - 1e-4) return 0;
    var dot = toTarget.x * toFix.x + toTarget.y * toFix.y + toTarget.z * toFix.z;
    var cosTheta = Math.min(1, Math.max(-1, dot / (targetDist * fixDist)));
    var ecc = Math.acos(cosTheta);
    var half = Math.atan(radius / targetDist);
    return ecc < half ? 1 : 0;
  }

  function mean(values) {
    if (!values.length) return null;
    var sum = 0;
    var i;
    for (i = 0; i < values.length; i++) sum += values[i];
    return sum / values.length;
  }

  function sampleSd(values) {
    if (!values.length) return null;
    if (values.length === 1) return 0;
    var m = mean(values);
    var acc = 0;
    var i;
    for (i = 0; i < values.length; i++) acc += Math.pow(values[i] - m, 2);
    return Math.sqrt(acc / (values.length - 1));
  }

  function hitRts(rows) {
    return rows.filter(function (t) {
      return t.trial_type === 'GO' && t.outcome === 'HIT';
    }).map(function (t) {
      return Number(t.rt_ms);
    }).filter(function (n) {
      return n > 0;
    });
  }

  function planeSummary(rows) {
    var go = rows.filter(function (t) { return t.trial_type === 'GO'; });
    var nogo = rows.filter(function (t) { return t.trial_type === 'NOGO'; });
    var hits = go.filter(function (t) { return t.outcome === 'HIT'; });
    var fas = nogo.filter(function (t) { return t.outcome === 'FALSE_ALARM'; });
    var meanRt = mean(hitRts(rows));
    return {
      trials: rows.length,
      go_n: go.length,
      go_hits: hits.length,
      go_hit_rate_pct: go.length ? round1(hits.length / go.length * 100) : 0,
      mean_go_rt_ms: meanRt === null ? null : round1(meanRt),
      nogo_n: nogo.length,
      nogo_false_alarms: fas.length,
      nogo_fa_rate_pct: nogo.length ? round1(fas.length / nogo.length * 100) : 0
    };
  }

  function summaryForPlane(logs, planeId) {
    return planeSummary(logs.filter(function (t) {
      return t.depth_plane === planeId;
    }));
  }

  function summarize(logs) {
    var go = logs.filter(function (t) { return t.trial_type === 'GO'; });
    var nogo = logs.filter(function (t) { return t.trial_type === 'NOGO'; });
    var hits = go.filter(function (t) { return t.outcome === 'HIT'; });
    var fas = nogo.filter(function (t) { return t.outcome === 'FALSE_ALARM'; });
    var rts = hitRts(logs);
    var meanRt = mean(rts);
    var sdRt = sampleSd(rts);
    var byDepth = {};
    var p;
    for (p = 0; p < DEPTH_PLANES.length; p++) {
      byDepth[DEPTH_PLANES[p].id] = summaryForPlane(logs, DEPTH_PLANES[p].id);
    }
    return {
      go_n: go.length,
      nogo_n: nogo.length,
      go_hits: hits.length,
      go_hit_rate_pct: go.length ? round1(hits.length / go.length * 100) : 0,
      nogo_false_alarms: fas.length,
      nogo_fa_rate_pct: nogo.length ? round1(fas.length / nogo.length * 100) : 0,
      mean_go_rt_ms: meanRt === null ? null : round1(meanRt),
      sd_go_rt_ms: sdRt === null ? null : round1(sdRt),
      by_depth: byDepth
    };
  }

  function buildTrialRow(meta, fields) {
    return {
      trial_num: meta.trial_num,
      trial_type: meta.trial_type,
      depth_plane: meta.depth_plane,
      plane_distance_m: meta.plane_distance_m,
      distance_m: meta.distance_m,
      visual_angle_deg: meta.visual_angle_deg,
      angle_h_deg: meta.angle_h_deg,
      angle_v_deg: meta.angle_v_deg,
      iti_ms: meta.iti_ms,
      x_pos: meta.x_pos,
      y_pos: meta.y_pos,
      z_pos: meta.z_pos,
      eccentricity_deg: meta.eccentricity_deg,
      stimulus_radius_m: meta.stimulus_radius_m,
      response_made: fields.response_made,
      outcome: fields.outcome,
      rt_ms: fields.rt_ms,
      score_total: fields.score_total,
      streak: fields.streak,
      size_mode: meta.size_mode,
      fixation_mode: meta.fixation_mode,
      fixation_occluded: meta.fixation_occluded,
      block: meta.block || BLOCK_MAIN
    };
  }

  function toCsv(logs) {
    var lines = [CSV_COLUMNS.join(',')];
    var r;
    for (r = 0; r < logs.length; r++) {
      var row = logs[r];
      lines.push(CSV_COLUMNS.map(function (col) {
        var value = row[col];
        return value === undefined || value === null ? '' : String(value);
      }).join(','));
    }
    return lines.join('\n');
  }

  function buildPayload(meta) {
    var sizeMode = meta.sizeMode || SIZE_PHYSICAL;
    var fixationMode = meta.fixationMode || FIXATION_HIDDEN;
    var planes = [];
    var p;
    for (p = 0; p < DEPTH_PLANES.length; p++) {
      planes.push({
        id: DEPTH_PLANES[p].id,
        plane_distance_m: DEPTH_PLANES[p].distance_m,
        stimulus_radius_m: shownRadius(DEPTH_PLANES[p].distance_m, sizeMode)
      });
    }
    return {
      task: 'orbital_gonogo',
      version: 'v1',
      title: 'Spatial Go/No-Go',
      wordmark: 'Orbital Energy Sorter',
      storageKey: STORAGE_KEY,
      completedAt: meta.completedAt,
      baseY_m: meta.baseY,
      eye_at_start: meta.eye,
      fixation: meta.fixation,
      depth_planes: planes,
      placement: {
        azimuth_deg: AZIMUTH_DEG,
        elevation_deg: ELEVATION_DEG,
        stimulus_radius_m: TARGET_RADIUS_M,
        size_rule: sizeMode === SIZE_ANGLE ? 'constant_visual_angle' : 'constant_physical_size',
        size_mode: sizeMode,
        fixation_mode: fixationMode,
        reference_plane: REFERENCE_PLANE_ID,
        reference_distance_m: referenceDistanceM(),
        reference_radius_m: TARGET_RADIUS_M,
        practice: meta.practice ? 1 : 0
      },
      stimulus_radius_m: TARGET_RADIUS_M,
      size_mode: sizeMode,
      fixation_mode: fixationMode,
      final_score: meta.finalScore,
      summary: meta.summary,
      trials: meta.trials
    };
  }

  global.OrbitalGonogo = {
    STORAGE_KEY: STORAGE_KEY,
    TOTAL_TRIALS: TOTAL_TRIALS,
    GO_PER_PLANE: GO_PER_PLANE,
    NOGO_PER_PLANE: NOGO_PER_PLANE,
    STIMULUS_TIMEOUT_MS: STIMULUS_TIMEOUT_MS,
    ITI_MIN_MS: ITI_MIN_MS,
    ITI_MAX_MS: ITI_MAX_MS,
    TARGET_RADIUS_M: TARGET_RADIUS_M,
    AZIMUTH_DEG: AZIMUTH_DEG,
    ELEVATION_DEG: ELEVATION_DEG,
    FIXATION_DISTANCE_M: FIXATION_DISTANCE_M,
    SIZE_PHYSICAL: SIZE_PHYSICAL,
    SIZE_ANGLE: SIZE_ANGLE,
    FIXATION_HIDDEN: FIXATION_HIDDEN,
    FIXATION_VISIBLE: FIXATION_VISIBLE,
    BLOCK_MAIN: BLOCK_MAIN,
    BLOCK_PRACTICE: BLOCK_PRACTICE,
    REFERENCE_PLANE_ID: REFERENCE_PLANE_ID,
    VISIBLE_TARGET_OPACITY: VISIBLE_TARGET_OPACITY,
    DEPTH_PLANES: DEPTH_PLANES,
    CSV_COLUMNS: CSV_COLUMNS,
    createSchedule: createSchedule,
    createPracticeSchedule: createPracticeSchedule,
    referenceDistanceM: referenceDistanceM,
    radiusForPlane: radiusForPlane,
    shownRadius: shownRadius,
    placeOnPlane: placeOnPlane,
    fixationAt: fixationAt,
    eccentricityDeg: eccentricityDeg,
    distanceM: distanceM,
    visualAngleDeg: visualAngleDeg,
    fixationOccluded: fixationOccluded,
    summarize: summarize,
    buildTrialRow: buildTrialRow,
    toCsv: toCsv,
    buildPayload: buildPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
