/*
  Builds the stage-select landing from .trial-hub-section nodes.
  Add a section (data-domain, --area-accent, heading, optional art,
  .trial-hub-card children) and it becomes another tile. No fixed list.
*/
(function () {
    var hub = document.getElementById("task-hub");
    var source = document.getElementById("task-hub-source");
    var ring = document.getElementById("stage-ring");
    var map = document.getElementById("stage-map");
    var board = document.getElementById("stage-board");
    var slot = document.getElementById("stage-board-slot");
    var back = document.getElementById("stage-back");
    var live = document.getElementById("stage-live");
    var boardCount = document.getElementById("stage-board-count");

    if (!hub || !source || !ring || !map || !board || !slot) {
        document.documentElement.classList.remove("js");
        return;
    }

    var sections = Array.prototype.slice.call(source.querySelectorAll(".trial-hub-section"));
    var tiles = [];
    var n = sections.length;
    var split = Math.floor(n / 2);
    var activeDomain = null;
    var pushed = false;
    var restoreFocus = null;

    map.style.setProperty("--n", String(Math.max(n, 1)));
    map.style.setProperty("--split", String(split));
    ring.style.setProperty("--n", String(Math.max(n, 1)));

    function pad2(value) {
        return (value < 10 ? "0" : "") + value;
    }

    function taskLabel(count) {
        return count === 1 ? "1 task" : count + " tasks";
    }

    function sectionName(section) {
        var heading = section.querySelector(".trial-hub-heading");
        var text = heading ? heading.textContent : section.getAttribute("data-domain");
        return String(text || "Area").replace(/\s+/g, " ").trim();
    }

    function sectionFor(domain) {
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].getAttribute("data-domain") === domain) return sections[i];
        }
        return null;
    }

    function hashDomain() {
        var raw = (location.hash || "").replace(/^#/, "");
        try {
            raw = decodeURIComponent(raw);
        } catch (error) {
            raw = "";
        }
        return /^[a-z0-9-]+$/.test(raw) ? raw : "";
    }

    function fallbackArt(name) {
        var letter = (name || "?").replace(/[<>&"]/g, "").charAt(0).toUpperCase() || "?";
        var wrap = document.createElement("span");
        wrap.className = "trial-area-art";
        wrap.setAttribute("aria-hidden", "true");
        wrap.innerHTML =
            '<svg class="art-svg art-fallback" viewBox="0 0 320 190">' +
            '<rect x="108" y="36" width="104" height="104" fill="none" stroke="currentColor" stroke-width="3"/>' +
            '<path d="M160 36 V22 M160 140 V154 M108 88 H94 M212 88 H226" fill="none" stroke="currentColor" stroke-width="3"/>' +
            '<rect x="152" y="80" width="16" height="16" fill="currentColor"/>' +
            '<text x="160" y="168" text-anchor="middle" fill="currentColor" font-size="28" font-family="JetBrains Mono, ui-monospace, monospace">' +
            letter +
            "</text></svg>";
        return wrap;
    }

    sections.forEach(function (section, index) {
        var domain = section.getAttribute("data-domain") || ("area-" + (index + 1));
        var name = sectionName(section);
        var count = section.querySelectorAll(".trial-hub-card").length;
        var accent = section.style.getPropertyValue("--area-accent").trim() || "#22d3ee";
        var art = section.querySelector(".trial-area-art");
        var order = index < split ? index : index + 1;

        if (!count) section.classList.add("is-empty");

        var tile = document.createElement("button");
        tile.type = "button";
        tile.className = "stage-tile";
        tile.setAttribute("data-domain", domain);
        tile.style.setProperty("--area-accent", accent);
        tile.style.setProperty("--i", String(index));
        tile.style.setProperty("--n", String(Math.max(n, 1)));
        tile.style.setProperty("--tile-order", String(order));
        tile.tabIndex = index === 0 ? 0 : -1;
        tile.setAttribute("aria-label", name + ", " + taskLabel(count));

        var indexEl = document.createElement("span");
        indexEl.className = "stage-tile-index";
        indexEl.setAttribute("aria-hidden", "true");
        indexEl.textContent = pad2(index + 1);

        var artNode = art ? art.cloneNode(true) : fallbackArt(name);
        artNode.classList.add("stage-tile-art");
        artNode.setAttribute("aria-hidden", "true");

        var meta = document.createElement("span");
        meta.className = "stage-tile-meta";
        var nameEl = document.createElement("span");
        nameEl.className = "stage-tile-name";
        nameEl.textContent = name;
        var countEl = document.createElement("span");
        countEl.className = "stage-tile-count";
        countEl.textContent = taskLabel(count);
        meta.appendChild(nameEl);
        meta.appendChild(countEl);

        var frame = document.createElement("span");
        frame.className = "stage-frame";
        frame.setAttribute("aria-hidden", "true");

        tile.appendChild(artNode);
        tile.appendChild(indexEl);
        tile.appendChild(meta);
        tile.appendChild(frame);

        tile.addEventListener("click", function () {
            openArea(domain, true);
        });
        tile.addEventListener("pointerenter", function (event) {
            if (event.pointerType && event.pointerType !== "mouse" && event.pointerType !== "pen") return;
            tile.classList.add("is-hot");
        });
        tile.addEventListener("pointerleave", function () {
            tile.classList.remove("is-hot");
        });
        tile.addEventListener("focus", function () {
            tiles.forEach(function (item) {
                item.tabIndex = item === tile ? 0 : -1;
            });
        });

        ring.appendChild(tile);
        tiles.push(tile);
    });

    source.hidden = true;

    function columns() {
        if (window.matchMedia("(min-width: 1080px)").matches) return 0;
        if (window.matchMedia("(max-width: 359px)").matches) return 1;
        return 2;
    }

    ring.addEventListener("keydown", function (event) {
        var key = event.key;
        var arrows = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
        if (arrows.indexOf(key) === -1) return;
        var index = tiles.indexOf(document.activeElement);
        if (index === -1) return;
        event.preventDefault();
        var next = index;
        var cols = columns();
        if (key === "Home") next = 0;
        else if (key === "End") next = tiles.length - 1;
        else if (cols === 0) {
            if (key === "ArrowRight" || key === "ArrowDown") next = (index + 1) % tiles.length;
            else next = (index - 1 + tiles.length) % tiles.length;
        } else if (key === "ArrowRight") next = Math.min(tiles.length - 1, index + 1);
        else if (key === "ArrowLeft") next = Math.max(0, index - 1);
        else if (key === "ArrowDown") next = Math.min(tiles.length - 1, index + cols);
        else if (key === "ArrowUp") next = Math.max(0, index - cols);
        tiles[next].focus();
    });

    function renderArea(domain, focusBack) {
        var section = sectionFor(domain);
        if (!section) {
            renderMap(false);
            return;
        }
        activeDomain = domain;
        slot.appendChild(section);
        map.hidden = true;
        board.hidden = false;
        var name = sectionName(section);
        var count = section.querySelectorAll(".trial-hub-card").length;
        var accent = section.style.getPropertyValue("--area-accent").trim() || "#22d3ee";
        board.style.setProperty("--area-accent", accent);
        board.setAttribute("aria-label", name);
        if (boardCount) boardCount.textContent = taskLabel(count);
        if (live) live.textContent = name + ", " + taskLabel(count) + ".";
        document.title = name + " · Project Trial";
        window.scrollTo(0, 0);
        if (focusBack && back) back.focus();
    }

    function renderMap(focusDomain) {
        var section = slot.querySelector(".trial-hub-section");
        if (section) source.appendChild(section);
        var leaving = activeDomain;
        activeDomain = null;
        board.hidden = true;
        map.hidden = false;
        document.title = "Project Trial";
        if (live) live.textContent = "";
        if (!focusDomain) return;
        var want = focusDomain === true ? leaving : focusDomain;
        var tile = null;
        tiles.forEach(function (item) {
            if (item.getAttribute("data-domain") === want) tile = item;
        });
        if (!tile) tile = tiles[0];
        if (!tile) return;
        tiles.forEach(function (item) {
            item.tabIndex = item === tile ? 0 : -1;
        });
        tile.focus();
    }

    function pageUrl(domain) {
        return location.pathname + location.search + (domain ? "#" + domain : "");
    }

    function openArea(domain, focusBack) {
        if (!sectionFor(domain)) return;
        renderArea(domain, focusBack);
        if (location.hash !== "#" + domain) {
            history.pushState({ stage: domain }, "", pageUrl(domain));
            pushed = true;
        } else if (!history.state || history.state.stage !== domain) {
            history.replaceState({ stage: domain }, "", pageUrl(domain));
        }
    }

    function closeArea() {
        var domain = activeDomain;
        restoreFocus = domain;
        if (pushed) {
            pushed = false;
            history.back();
            return;
        }
        history.pushState({ stage: null }, "", pageUrl(""));
        renderMap(domain || true);
        restoreFocus = null;
    }

    function syncFromLocation() {
        var domain = hashDomain();
        if (domain && sectionFor(domain)) renderArea(domain, false);
        else renderMap(restoreFocus);
        restoreFocus = null;
    }

    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", function () {
        var domain = hashDomain();
        if (domain === (activeDomain || "")) return;
        syncFromLocation();
    });

    if (back) {
        back.addEventListener("click", function () {
            closeArea();
        });
    }

    document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || !activeDomain) return;
        if (event.target && event.target.closest && event.target.closest("input, textarea, select")) return;
        event.preventDefault();
        closeArea();
    });

    var initial = hashDomain();
    if (initial && sectionFor(initial)) {
        history.replaceState({ stage: initial }, "", pageUrl(initial));
        renderArea(initial, false);
    } else {
        if (initial) history.replaceState({ stage: null }, "", pageUrl(""));
        else history.replaceState({ stage: null }, "", location.href);
    }
})();
