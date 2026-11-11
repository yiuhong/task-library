/*
  Spatial Go/No-Go (Orbital Energy Sorter) — trial plan.

  WebXR special case. This file is not a TrialShell core. The page
  orbital_gonogo.html loads it with a plain script tag. It does not read
  project-trial:mode and it does not write project-trial:sfx.

  Depth is a balanced factor inside one frontal field. Three planes sit
  ahead of the start-of-run eye. Each plane gets the same go and no-go
  counts. Targets keep one physical radius, so a nearer target subtends
  a larger visual angle. Nothing is placed beside or behind the viewer.

  Planes (metres along the fixation axis, eye at the origin => negative z):
    near  2.70
    mid   3.35
    far   4.05
  All three are inside the previous frontal depth range, about 2.5–4.2 m.
  Fixation stays at 3.00 m, between near and mid.

  Each plane: 7 GO + 3 NOGO = 10 trials. Three planes = 30 trials
  (21 GO / 9 NOGO, 70% / 30%). Order is a Fisher–Yates shuffle.

  Placement is a visual angle from fixation, then a point on that plane:
    horizontal  -18° to +18°
    vertical     -5° to +6°
  At the far plane those angles stay inside x about ±2.5 m and y within
  about -0.5 to +0.6 m of eye height.
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
  var H_LIMIT_DEG = 18;
  var V_MIN_DEG = -5;
  var V_MAX_DEG = 6;
  var FIXATION_DISTANCE_M = 3;

  var DEPTH_PLANES = [
    { id: 'near', distance_m: 2.7 },
    { id: 'mid', distance_m: 3.35 },
    { id: 'far', distance_m: 4.05 }
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
    'streak'
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

  function placeOnPlane(planeDistance, eye, baseY, rng) {
    var random = rng || Math.random;
    var hDeg = (random() * 2 - 1) * H_LIMIT_DEG;
    var vDeg = V_MIN_DEG + random() * (V_MAX_DEG - V_MIN_DEG);
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
    var planes = [];
    var p;
    for (p = 0; p < DEPTH_PLANES.length; p++) {
      planes.push({
        id: DEPTH_PLANES[p].id,
        plane_distance_m: DEPTH_PLANES[p].distance_m
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
        horizontal_deg: [-H_LIMIT_DEG, H_LIMIT_DEG],
        vertical_deg: [V_MIN_DEG, V_MAX_DEG],
        stimulus_radius_m: TARGET_RADIUS_M,
        size_rule: 'constant_physical_size'
      },
      stimulus_radius_m: TARGET_RADIUS_M,
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
    H_LIMIT_DEG: H_LIMIT_DEG,
    V_MIN_DEG: V_MIN_DEG,
    V_MAX_DEG: V_MAX_DEG,
    FIXATION_DISTANCE_M: FIXATION_DISTANCE_M,
    DEPTH_PLANES: DEPTH_PLANES,
    CSV_COLUMNS: CSV_COLUMNS,
    createSchedule: createSchedule,
    placeOnPlane: placeOnPlane,
    fixationAt: fixationAt,
    eccentricityDeg: eccentricityDeg,
    distanceM: distanceM,
    visualAngleDeg: visualAngleDeg,
    summarize: summarize,
    toCsv: toCsv,
    buildPayload: buildPayload
  };
})(typeof window !== 'undefined' ? window : globalThis);
