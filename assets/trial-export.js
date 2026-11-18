/*
  Trial-by-trial export for Project Trial.

  A task core opens one session per run, records one row per finished
  trial, and downloads only when the person presses the button.
  The file is built in the browser. Nothing is uploaded.

  Later tasks:

    var log = TrialExport.session({
      taskId: "example",
      mode: mode,
      params: function () { return { trials: 36 }; },
      summary: function () { return { meanRt: 0 }; }
    });

    log.record({
      trialIndex: 1,
      block: "main",
      stimulus: "what was shown",
      condition: "incongruent",
      response: "left",
      accuracy: 1,
      rtMs: 412,
      timestamp: new Date().toISOString(),
      onsetPerfMs: onset,
      responsePerfMs: responseAt,
      extra: { fixation_ms: 480 }
    });

    log.stamp(function (row) {
      if (row.block !== "main") return {};
      return { example_set_score: 1 };
    });

    log.downloadCsv("example_" + stamp + ".csv");
    log.downloadJson("example_" + stamp + ".json");

  Call clear() when a new run drops the previous log. Leave practice
  rows in the log when the main block should keep them.

  Shared CSV columns, in order, then extra keys in first-seen order:
    task_id, mode, params_json, trial_index, block, stimulus, condition,
    response, accuracy, rt_ms, timestamp, onset_perf_ms, response_perf_ms

  JSON is schema "project-trial.export.v1". params and summary sit once
  on the wrapper. Trial fields use the same names as the CSV, without
  repeating params_json. libraryVersion is the site version when
  TrialSite has loaded. It is not a release bump by itself.

  rt_ms stays the millisecond value the task already scores. The perf
  stamps are performance.now() around that value. A blank rt is stored
  as null in JSON and an empty CSV cell.
*/
(function (global) {
    "use strict";

    var SCHEMA = "project-trial.export.v1";

    var SHARED = [
        "task_id",
        "mode",
        "params_json",
        "trial_index",
        "block",
        "stimulus",
        "condition",
        "response",
        "accuracy",
        "rt_ms",
        "timestamp",
        "onset_perf_ms",
        "response_perf_ms"
    ];

    function copyValue(value) {
        if (value === undefined) return null;
        if (value === null || typeof value !== "object") return value;
        return JSON.parse(JSON.stringify(value));
    }

    function resolve(value) {
        return typeof value === "function" ? value() : value;
    }

    function isBlank(value) {
        return value === undefined || value === null || value === "";
    }

    function csvCell(val) {
        if (isBlank(val)) return "";
        if (typeof val === "number") return isFinite(val) ? String(val) : "";
        if (typeof val === "boolean") return val ? "true" : "false";
        if (typeof val === "object") {
            try {
                val = JSON.stringify(val);
            } catch (err) {
                return "";
            }
        }
        var s = String(val);
        if (/^[=+\-@]/.test(s)) s = "'" + s;
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function libraryVersion() {
        var site = global.TrialSite;
        return site && site.version ? String(site.version) : "";
    }

    function session(spec) {
        var options = spec || {};
        if (!options.taskId || typeof options.taskId !== "string") {
            throw new Error("TrialExport needs a taskId string");
        }
        if (options.mode !== "classical" && options.mode !== "gamified") {
            throw new Error("TrialExport mode must be classical or gamified");
        }

        var taskId = options.taskId;
        var mode = options.mode;
        var rows = [];
        var extraKeys = [];

        function rememberKey(key) {
            if (SHARED.indexOf(key) !== -1) return;
            if (extraKeys.indexOf(key) === -1) extraKeys.push(key);
        }

        function record(row) {
            var source = row || {};
            var extra = {};
            var rawExtra = source.extra || {};
            Object.keys(rawExtra).forEach(function (key) {
                rememberKey(key);
                extra[key] = copyValue(rawExtra[key]);
            });
            var stored = {
                trial_index: isBlank(source.trialIndex) ? null : source.trialIndex,
                block: isBlank(source.block) ? "" : source.block,
                stimulus: isBlank(source.stimulus) ? "" : source.stimulus,
                condition: isBlank(source.condition) ? "" : source.condition,
                response: isBlank(source.response) ? "" : source.response,
                accuracy: isBlank(source.accuracy) ? null : source.accuracy,
                rt_ms: isBlank(source.rtMs) ? null : source.rtMs,
                timestamp: isBlank(source.timestamp) ? "" : source.timestamp,
                onset_perf_ms: isBlank(source.onsetPerfMs) ? null : source.onsetPerfMs,
                response_perf_ms: isBlank(source.responsePerfMs) ? null : source.responsePerfMs,
                extra: extra
            };
            rows.push(stored);
            return stored;
        }

        function stamp(fn) {
            rows.forEach(function (row) {
                var patch = fn({
                    trial_index: row.trial_index,
                    block: row.block,
                    stimulus: row.stimulus,
                    condition: row.condition,
                    response: row.response,
                    accuracy: row.accuracy,
                    rt_ms: row.rt_ms,
                    extra: row.extra
                }) || {};
                Object.keys(patch).forEach(function (key) {
                    rememberKey(key);
                    if (SHARED.indexOf(key) !== -1) return;
                    row.extra[key] = copyValue(patch[key]);
                });
            });
        }

        function clear() {
            rows.length = 0;
            extraKeys.length = 0;
        }

        function pack() {
            var params = copyValue(resolve(options.params) || {});
            if (params === null || typeof params !== "object") params = {};
            var rawSummary = options.summary == null ? null : resolve(options.summary);
            var summary = rawSummary == null ? null : copyValue(rawSummary);
            var paramsJson = JSON.stringify(params);
            var trials = rows.map(function (row) {
                var trial = {
                    task_id: taskId,
                    mode: mode,
                    trial_index: row.trial_index,
                    block: row.block,
                    stimulus: row.stimulus,
                    condition: row.condition,
                    response: row.response,
                    accuracy: row.accuracy,
                    rt_ms: row.rt_ms,
                    timestamp: row.timestamp,
                    onset_perf_ms: row.onset_perf_ms,
                    response_perf_ms: row.response_perf_ms
                };
                extraKeys.forEach(function (key) {
                    var value = row.extra[key];
                    trial[key] = isBlank(value) ? null : value;
                });
                return trial;
            });
            return {
                params: params,
                paramsJson: paramsJson,
                summary: summary,
                trials: trials
            };
        }

        function envelope(packed) {
            return {
                schema: SCHEMA,
                source: "project-trial",
                taskId: taskId,
                mode: mode,
                libraryVersion: libraryVersion(),
                exportedAt: new Date().toISOString(),
                params: packed.params,
                summary: packed.summary,
                trials: packed.trials
            };
        }

        function columns() {
            return SHARED.concat(extraKeys);
        }

        function toCsv() {
            var packed = pack();
            var cols = columns();
            var lines = [cols.map(csvCell).join(",")];
            packed.trials.forEach(function (trial) {
                lines.push(cols.map(function (col) {
                    if (col === "params_json") return csvCell(packed.paramsJson);
                    return csvCell(trial[col]);
                }).join(","));
            });
            return lines.join("\n") + "\n";
        }

        function toJson() {
            return JSON.stringify(envelope(pack()), null, 2) + "\n";
        }

        function download(filename, mime, text) {
            if (!global.document || !global.document.body || !global.URL || !global.Blob) {
                throw new Error("TrialExport download needs a browser");
            }
            var blob = new Blob([text], { type: mime });
            var url = global.URL.createObjectURL(blob);
            var link = global.document.createElement("a");
            link.href = url;
            link.setAttribute("download", filename);
            global.document.body.appendChild(link);
            link.click();
            global.document.body.removeChild(link);
            global.setTimeout(function () {
                global.URL.revokeObjectURL(url);
            }, 1500);
        }

        return {
            record: record,
            stamp: stamp,
            clear: clear,
            columns: columns,
            payload: function () { return envelope(pack()); },
            csv: toCsv,
            json: toJson,
            downloadCsv: function (filename) {
                download(filename, "text/csv;charset=utf-8", toCsv());
            },
            downloadJson: function (filename) {
                download(filename, "application/json;charset=utf-8", toJson());
            }
        };
    }

    global.TrialExport = {
        schema: SCHEMA,
        sharedColumns: SHARED.slice(),
        session: session,
        csvCell: csvCell
    };
})(typeof window !== "undefined" ? window : globalThis);
