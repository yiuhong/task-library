/*
  Optional orientation log for a Project Trial run.

  The page never locks orientation. Call start() when a run begins and stop()
  when it ends. events records the start reading, each turn, and the end
  reading. fields() stamps the reading onto a trial row.

  A turn uses screen.orientation when the browser provides it (type plus
  angle). Otherwise it records portrait or landscape, and degrees only when
  window.orientation exists.
*/
(function (global) {
    function readOrientation() {
        var ori = global.screen && global.screen.orientation;
        if (ori && (ori.type || typeof ori.angle === "number")) {
            return {
                type: ori.type || null,
                angle: typeof ori.angle === "number" ? ori.angle : null
            };
        }
        if (typeof global.orientation === "number") {
            var legacy = global.orientation;
            var legacyPortrait = legacy === 0 || legacy === 180;
            return {
                type: legacyPortrait ? "portrait" : "landscape",
                angle: legacy
            };
        }
        var portrait = true;
        if (global.matchMedia) {
            portrait = global.matchMedia("(orientation: portrait)").matches;
        } else if (global.innerWidth && global.innerHeight) {
            portrait = global.innerHeight >= global.innerWidth;
        }
        return {
            type: portrait ? "portrait" : "landscape",
            angle: null
        };
    }

    function stamp(reading, reason) {
        return {
            reason: reason,
            at: new Date().toISOString(),
            tMs: Math.round(global.performance.now()),
            type: reading.type,
            angle: reading.angle
        };
    }

    function summarize(events) {
        var list = events || [];
        var start = null;
        var changes = 0;
        for (var i = 0; i < list.length; i++) {
            if (list[i].reason === "start" && !start) start = list[i];
            if (list[i].reason === "change") changes += 1;
        }
        if (!start) return "Orientation was not recorded for this run.";
        var angle = start.angle == null ? "angle not reported by this browser" : start.angle + "°";
        return "Started in " + start.type + " (" + angle + "). Turns during the run: " + changes + ". Each turn is timestamped on this session.";
    }

    function createSession(options) {
        var opts = options || {};
        var events = [];
        var active = false;
        var lastKey = "";
        var lastAt = 0;
        var nudgeTimer = 0;
        var nudgeEl = null;

        if (opts.nudge) {
            nudgeEl = document.createElement("p");
            nudgeEl.className = "trial-orient-nudge";
            nudgeEl.setAttribute("role", "status");
            nudgeEl.setAttribute("aria-live", "polite");
            nudgeEl.setAttribute("aria-hidden", "true");
            document.body.appendChild(nudgeEl);
        }

        function showNudge() {
            if (!nudgeEl) return;
            nudgeEl.textContent = "Rotated. This run continues. The turn is saved with the session.";
            nudgeEl.removeAttribute("aria-hidden");
            nudgeEl.classList.add("is-on");
            global.clearTimeout(nudgeTimer);
            nudgeTimer = global.setTimeout(function () {
                nudgeEl.classList.remove("is-on");
                nudgeEl.setAttribute("aria-hidden", "true");
            }, 2200);
        }

        function push(reason) {
            var entry = stamp(readOrientation(), reason);
            events.push(entry);
            lastKey = entry.type + ":" + entry.angle;
            lastAt = global.performance.now();
            return entry;
        }

        function onChange() {
            if (!active) return;
            var reading = readOrientation();
            var key = reading.type + ":" + reading.angle;
            var now = global.performance.now();
            if (key === lastKey && now - lastAt < 400) return;
            var entry = stamp(reading, "change");
            events.push(entry);
            lastKey = key;
            lastAt = now;
            showNudge();
        }

        if (global.screen && global.screen.orientation && global.screen.orientation.addEventListener) {
            global.screen.orientation.addEventListener("change", onChange);
        }
        global.addEventListener("orientationchange", onChange);

        return {
            events: events,
            start: function () {
                events.length = 0;
                active = true;
                push("start");
            },
            stop: function () {
                if (!active) return;
                push("end");
                active = false;
            },
            fields: function (reason) {
                var entry = stamp(readOrientation(), reason || "response");
                return {
                    orientationType: entry.type,
                    orientationAngle: entry.angle,
                    orientationAt: entry.at,
                    orientationTMs: entry.tMs,
                    orientationReason: entry.reason
                };
            },
            summarize: function () {
                return summarize(events);
            }
        };
    }

    global.TrialOrientation = {
        read: readOrientation,
        summarize: summarize,
        createSession: createSession
    };
})(window);
