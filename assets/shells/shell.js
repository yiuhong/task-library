/*
  Thin shell helper for Project Trial.

  A shell is chrome: mode, theme, HUD slots, copy. The task core owns the
  trial loop. readMode() is the only mode switch — classical when the page
  URL has ?mode=classical, otherwise gamified. Unknown values stay gamified
  so a typo cannot invent a third parameter set.

  apply(mode) stamps data-trial-mode, hides [data-shell-arcade] in the
  classical shell, and shows [data-shell-summary] only there. Elements with
  [data-shell-copy] take their text from data-gamified or data-classical.
  The gamified string defaults to the element's text.

  Load this file before the task script. It does not start audio, trials,
  or localStorage.
*/
(function (global) {
    function readMode(search) {
        var query = search;
        if (query == null) query = global.location ? global.location.search : "";
        var params;
        try {
            params = new URLSearchParams(query);
        } catch (err) {
            return "gamified";
        }
        var raw = params.get("mode");
        if (raw && String(raw).toLowerCase() === "classical") return "classical";
        return "gamified";
    }

    function text(id, value) {
        var el = typeof id === "string" ? global.document.getElementById(id) : id;
        if (!el) return;
        el.textContent = value == null ? "" : String(value);
    }

    function apply(mode) {
        var resolved = mode === "classical" ? "classical" : "gamified";
        var doc = global.document;
        doc.documentElement.setAttribute("data-trial-mode", resolved);
        if (doc.body) {
            doc.body.setAttribute("data-trial-mode", resolved);
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

        var titleEl = doc.querySelector("title");
        if (titleEl && titleEl.textContent) doc.title = titleEl.textContent;
        return resolved;
    }

    global.TrialShell = {
        modes: ["gamified", "classical"],
        readMode: readMode,
        apply: apply,
        text: text
    };
})(window);
