/*
  Local-only session log for a Project Trial hub game.

  Saves trial rows and orientation events (start, each turn, end) in
  localStorage for this browser. Download CSV writes that log as a file.
  Clear removes the key. Nothing is uploaded.

  The page keeps the newest 100 sessions. Starting another run drops the
  oldest. An unfinished run stays in the log; the next play does not resume it.
*/
(function (global) {
    var MAX_SESSIONS = 100;

    function storageKey(taskId) {
        return "project-trial:" + taskId;
    }

    function emptyStore(taskId) {
        return {
            version: 1,
            task: taskId,
            updatedAt: null,
            sessions: []
        };
    }

    function copyEvent(event) {
        return {
            reason: event.reason,
            at: event.at,
            tMs: event.tMs,
            type: event.type,
            angle: event.angle
        };
    }

    function copyEvents(events) {
        var list = [];
        if (!events) return list;
        for (var i = 0; i < events.length; i++) {
            if (events[i]) list.push(copyEvent(events[i]));
        }
        return list;
    }

    function copyTrial(trial) {
        var out = {};
        if (!trial) return out;
        var keys = Object.keys(trial);
        for (var i = 0; i < keys.length; i++) out[keys[i]] = trial[keys[i]];
        return out;
    }

    function makeId() {
        return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    }

    function loadStore(taskId) {
        try {
            var raw = global.localStorage.getItem(storageKey(taskId));
            if (!raw) return { store: emptyStore(taskId), ok: true };
            var parsed = JSON.parse(raw);
            if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.sessions)) {
                return { store: emptyStore(taskId), ok: true };
            }
            parsed.task = taskId;
            return { store: parsed, ok: true };
        } catch (err) {
            return { store: emptyStore(taskId), ok: false };
        }
    }

    function csvCell(val) {
        if (val === null || val === undefined) return "";
        if (typeof val === "number") return isFinite(val) ? String(val) : "";
        if (typeof val === "boolean") return val ? "true" : "false";
        var s = String(val);
        if (/^[=+@]/.test(s)) s = "'" + s;
        if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    function decorate(session, row) {
        var out = {};
        var keys = Object.keys(row || {});
        for (var i = 0; i < keys.length; i++) out[keys[i]] = row[keys[i]];
        out.sessionId = session.sessionId;
        out.startedAt = session.startedAt;
        out.endedAt = session.endedAt == null ? "" : session.endedAt;
        out.complete = session.complete ? "true" : "false";
        return out;
    }

    function rowsFromStore(store) {
        var rows = [];
        var sessions = (store && store.sessions) || [];
        for (var i = 0; i < sessions.length; i++) {
            var session = sessions[i];
            if (!session) continue;
            var trials = session.trials || [];
            var events = session.orientationEvents || [];
            var t;
            for (t = 0; t < trials.length; t++) rows.push(decorate(session, trials[t]));
            for (t = 0; t < events.length; t++) {
                var event = events[t];
                if (!event) continue;
                rows.push(decorate(session, {
                    record: "orientation",
                    orientationType: event.type,
                    orientationAngle: event.angle,
                    orientationAt: event.at,
                    orientationTMs: event.tMs,
                    orientationReason: event.reason
                }));
            }
        }
        return rows;
    }

    function buildCsv(store, headers) {
        var rows = rowsFromStore(store);
        var cols = headers || [];
        var lines = [cols.map(csvCell).join(",")];
        for (var i = 0; i < rows.length; i++) {
            var line = [];
            for (var c = 0; c < cols.length; c++) line.push(csvCell(rows[i][cols[c]]));
            lines.push(line.join(","));
        }
        return lines.join("\n");
    }

    function counts(store) {
        var runs = 0;
        var trials = 0;
        var sessions = (store && store.sessions) || [];
        for (var i = 0; i < sessions.length; i++) {
            if (!sessions[i]) continue;
            runs += 1;
            trials += (sessions[i].trials || []).length;
        }
        return { runs: runs, trials: trials };
    }

    function hasDownload(store) {
        return rowsFromStore(store).length > 0;
    }

    function plural(n, word) {
        return n + " " + word + (n === 1 ? "" : "s");
    }

    function downloadFile(filename, csvText) {
        var blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    function create(options) {
        var opts = options || {};
        var taskId = opts.taskId;
        var headers = opts.headers || [];
        var fileStem = opts.fileStem || taskId;
        var loaded = loadStore(taskId);
        var store = loaded.store;
        var writeOk = loaded.ok;
        var current = null;
        var justCleared = false;
        var clearArmed = false;
        var clearTimer = 0;

        function persist() {
            if (writeOk) {
                try {
                    store.updatedAt = new Date().toISOString();
                    global.localStorage.setItem(storageKey(taskId), JSON.stringify(store));
                } catch (err) {
                    writeOk = false;
                }
            }
            render();
        }

        function noteText() {
            var c = counts(store);
            if (!writeOk) {
                if (c.runs === 0) return "This browser blocked localStorage. Nothing is uploaded.";
                return "This browser blocked localStorage. " + plural(c.runs, "run") + " (" + plural(c.trials, "trial") + ") can be downloaded until you leave the page. Nothing is uploaded.";
            }
            if (justCleared && c.runs === 0) return "Cleared. No runs saved in this browser. Nothing is uploaded.";
            if (c.runs === 0) return "No runs saved in this browser. Finished trials stay in localStorage on this device. Nothing is uploaded.";
            var open = false;
            for (var i = 0; i < store.sessions.length; i++) {
                if (store.sessions[i] && !store.sessions[i].complete) open = true;
            }
            var text = "Saved in this browser: " + plural(c.runs, "run") + ", " + plural(c.trials, "trial") + ".";
            if (open) text += " The newest run is still in progress.";
            text += " Download CSV includes orientation start and turn timestamps. Nothing is uploaded.";
            return text;
        }

        function stateName() {
            var c = counts(store);
            if (!writeOk) return "blocked";
            if (justCleared && c.runs === 0) return "cleared";
            if (c.runs === 0) return "empty";
            return "saved";
        }

        function notes() {
            return document.querySelectorAll("[data-trial-store-note]");
        }

        function downloads() {
            return document.querySelectorAll("[data-trial-store-download]");
        }

        function clears() {
            return document.querySelectorAll("[data-trial-store-clear]");
        }

        function disarm() {
            clearArmed = false;
            global.clearTimeout(clearTimer);
            var buttons = clears();
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].textContent = "CLEAR SAVED";
                buttons[i].classList.remove("is-armed");
            }
        }

        function render() {
            var text = noteText();
            var state = stateName();
            var c = counts(store);
            var enabled = hasDownload(store);
            var list = notes();
            var i;
            for (i = 0; i < list.length; i++) {
                list[i].textContent = text;
                list[i].setAttribute("data-state", state);
                list[i].setAttribute("data-runs", String(c.runs));
                list[i].setAttribute("data-trials", String(c.trials));
            }
            list = downloads();
            for (i = 0; i < list.length; i++) list[i].disabled = !enabled;
            list = clears();
            for (i = 0; i < list.length; i++) list[i].disabled = !enabled;
            if (!enabled) disarm();
        }

        function onDownload(event) {
            if (event && event.preventDefault) event.preventDefault();
            if (!hasDownload(store)) return;
            downloadFile(fileStem + "_" + Date.now() + ".csv", buildCsv(store, headers));
        }

        function onClear(event) {
            if (event && event.preventDefault) event.preventDefault();
            if (!hasDownload(store)) return;
            if (!clearArmed) {
                clearArmed = true;
                var buttons = clears();
                for (var i = 0; i < buttons.length; i++) {
                    buttons[i].textContent = "CONFIRM CLEAR";
                    buttons[i].classList.add("is-armed");
                }
                global.clearTimeout(clearTimer);
                clearTimer = global.setTimeout(disarm, 4000);
                return;
            }
            store = emptyStore(taskId);
            current = null;
            justCleared = true;
            try {
                global.localStorage.removeItem(storageKey(taskId));
            } catch (err) {
                writeOk = false;
            }
            disarm();
            render();
        }

        var downloadButtons = downloads();
        var clearButtons = clears();
        var b;
        for (b = 0; b < downloadButtons.length; b++) downloadButtons[b].addEventListener("click", onDownload);
        for (b = 0; b < clearButtons.length; b++) clearButtons[b].addEventListener("click", onClear);
        render();

        return {
            begin: function (events) {
                justCleared = false;
                while (store.sessions.length >= MAX_SESSIONS) store.sessions.shift();
                current = {
                    sessionId: makeId(),
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    complete: false,
                    trials: [],
                    orientationEvents: copyEvents(events)
                };
                store.sessions.push(current);
                persist();
                return current.sessionId;
            },
            commitTrial: function (trial, events) {
                if (!current || current.complete) return;
                current.trials.push(copyTrial(trial));
                current.orientationEvents = copyEvents(events);
                persist();
            },
            finish: function (events) {
                if (!current || current.complete) return;
                current.complete = true;
                current.endedAt = new Date().toISOString();
                current.orientationEvents = copyEvents(events);
                persist();
            },
            download: onDownload,
            clear: function () {
                if (!hasDownload(store)) return;
                clearArmed = true;
                onClear();
            }
        };
    }

    global.TrialStore = {
        storageKey: storageKey,
        rowsFromStore: rowsFromStore,
        buildCsv: buildCsv,
        create: create,
        maxSessions: MAX_SESSIONS
    };
})(window);
