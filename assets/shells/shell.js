/*
  Thin shell helper for Project Trial.

  A shell is chrome: mode, theme, HUD slots, copy, and the Gamified |
  Classical control. The task core owns the trial loop. readMode() is
  classical when the page URL has ?mode=classical. An explicit
  ?mode=gamified is gamified. Any other explicit mode value stays
  gamified, so a typo cannot invent a third parameter set. When the URL
  has no mode parameter, the last choice in localStorage
  (project-trial:mode) is used. With no stored choice, the mode is
  gamified.

  apply(mode) stamps data-trial-mode, hides [data-shell-arcade] in the
  classical shell, and shows [data-shell-summary] only there. Elements
  with [data-shell-copy] take their text from data-gamified or
  data-classical. The gamified string defaults to the element's text.
  [data-shell-toggle] becomes the segmented control. Choosing a segment
  stores the mode and reloads the page with ?mode= so the task remounts.

  An explicit classical or gamified URL is written to the same key, so a
  deep link is remembered. A missing mode parameter does not write the
  key. This file does not start audio or trials.

  Load this file before the task script.
*/
(function (global) {
    var MODE_KEY = "project-trial:mode";

    function parseQuery(search) {
        var query = search == null ? "" : String(search);
        try {
            return new URLSearchParams(query);
        } catch (err) {
            return null;
        }
    }

    function namedMode(raw) {
        var value = raw == null ? "" : String(raw).toLowerCase();
        if (value === "classical" || value === "gamified") return value;
        return null;
    }

    function readStoredMode() {
        try {
            if (!global.localStorage) return null;
            return namedMode(global.localStorage.getItem(MODE_KEY));
        } catch (err) {
            return null;
        }
    }

    function writeStoredMode(mode) {
        var named = namedMode(mode);
        if (!named) return;
        try {
            if (global.localStorage) global.localStorage.setItem(MODE_KEY, named);
        } catch (err) {
            /* private mode and blocked storage leave the URL as the choice */
        }
    }

    function readMode(search) {
        var usingLocation = search == null;
        var query = search;
        if (query == null) query = global.location ? global.location.search : "";
        var params = parseQuery(query);
        if (!params) return "gamified";
        if (params.has("mode")) {
            return namedMode(params.get("mode")) === "classical" ? "classical" : "gamified";
        }
        if (!usingLocation) return "gamified";
        return readStoredMode() || "gamified";
    }

    function persistExplicitUrlMode() {
        if (!global.location) return;
        var params = parseQuery(global.location.search);
        if (!params || !params.has("mode")) return;
        var named = namedMode(params.get("mode"));
        if (named) writeStoredMode(named);
    }

    function text(id, value) {
        var el = typeof id === "string" ? global.document.getElementById(id) : id;
        if (!el) return;
        el.textContent = value == null ? "" : String(value);
    }

    function urlForMode(mode) {
        var named = mode === "classical" ? "classical" : "gamified";
        var url = new URL(global.location.href);
        url.searchParams.set("mode", named);
        return url.pathname + url.search + url.hash;
    }

    function switchMode(mode) {
        var named = mode === "classical" ? "classical" : "gamified";
        writeStoredMode(named);
        if (!global.location) return named;
        var next = urlForMode(named);
        var here = global.location.pathname + global.location.search + global.location.hash;
        if (next === here) {
            apply(named);
            return named;
        }
        global.location.assign(next);
        return named;
    }

    function mountToggles(mode) {
        var doc = global.document;
        if (!doc || !doc.querySelectorAll) return;
        var slots = doc.querySelectorAll("[data-shell-toggle]");
        var i;
        for (i = 0; i < slots.length; i++) fillToggle(slots[i], mode);
    }

    function fillToggle(slot, mode) {
        var doc = global.document;
        slot.textContent = "";
        slot.className = "shell-mode";
        slot.setAttribute("role", "radiogroup");
        slot.setAttribute("aria-label", "Presentation");

        var modes = ["gamified", "classical"];
        var labels = { gamified: "Gamified", classical: "Classical" };
        var i;
        for (i = 0; i < modes.length; i++) {
            var value = modes[i];
            var button = doc.createElement("button");
            button.type = "button";
            button.className = "shell-mode-btn";
            button.setAttribute("role", "radio");
            button.setAttribute("data-mode-value", value);
            button.setAttribute("aria-checked", value === mode ? "true" : "false");
            button.tabIndex = value === mode ? 0 : -1;
            button.textContent = labels[value];
            button.addEventListener("click", function (event) {
                event.preventDefault();
                switchMode(event.currentTarget.getAttribute("data-mode-value"));
            });
            slot.appendChild(button);
        }

        if (slot.getAttribute("data-toggle-bound") === "1") return;
        slot.setAttribute("data-toggle-bound", "1");
        slot.addEventListener("keydown", function (event) {
            var key = event.key;
            if (key !== "ArrowRight" && key !== "ArrowLeft" && key !== "ArrowDown" && key !== "ArrowUp") return;
            var group = event.currentTarget;
            var items = group.querySelectorAll(".shell-mode-btn");
            if (!items.length) return;
            var current = 0;
            var n;
            for (n = 0; n < items.length; n++) {
                if (items[n].getAttribute("aria-checked") === "true") current = n;
            }
            var forward = key === "ArrowRight" || key === "ArrowDown";
            var next = forward ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
            event.preventDefault();
            switchMode(items[next].getAttribute("data-mode-value"));
        });
    }

    function apply(mode) {
        var resolved = mode === "classical" ? "classical" : "gamified";
        var doc = global.document;
        doc.documentElement.setAttribute("data-trial-mode", resolved);
        if (doc.body) {
            doc.body.setAttribute("data-trial-mode", resolved);
            doc.body.classList.remove("trial-mode-gamified", "trial-mode-classical");
            doc.body.classList.add("trial-mode-" + resolved);
        }

        var arcade = doc.querySelectorAll("[data-shell-arcade]");
        var summary = doc.querySelectorAll("[data-shell-summary]");
        var i;
        for (i = 0; i < arcade.length; i++) arcade[i].hidden = resolved === "classical";
        for (i = 0; i < summary.length; i++) summary[i].hidden = resolved !== "classical";

        var copies = doc.querySelectorAll("[data-shell-copy]");
        for (i = 0; i < copies.length; i++) {
            var el = copies[i];
            if (!el.hasAttribute("data-gamified")) el.setAttribute("data-gamified", el.textContent);
            var next = el.getAttribute("data-" + resolved);
            if (next != null) el.textContent = next;
        }

        persistExplicitUrlMode();
        mountToggles(resolved);

        var titleEl = doc.querySelector("title");
        if (titleEl && titleEl.textContent) doc.title = titleEl.textContent;
        return resolved;
    }

    function boot() {
        apply(readMode());
    }

    if (global.document && global.document.readyState === "loading") {
        global.document.addEventListener("DOMContentLoaded", boot);
    } else if (global.document) {
        boot();
    }

    global.TrialShell = {
        modes: ["gamified", "classical"],
        storageKey: MODE_KEY,
        readMode: readMode,
        apply: apply,
        switchMode: switchMode,
        text: text
    };
})(window);
