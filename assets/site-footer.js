/*
 * Draws the Project Trial footer from assets/site-meta.js and fills
 * [data-site-field] nodes (version, updated date) from that same file.
 *
 * Document pages get one footer after the page. Task pages get the same
 * footer inside the welcome and results cards, not on the trial canvas.
 * Spatial Go/No-Go keeps it inside the 2D start and results sheets.
 */
(function () {
    var meta = window.TrialSite;
    if (!meta || window.__trialSiteFooterMounted) return;
    if (!document.body || document.body.getAttribute("data-site-footer") === "off") return;
    window.__trialSiteFooterMounted = true;

    var script = document.currentScript;
    if (script && script.src && !document.querySelector("link[data-site-footer-css]")) {
        var sheet = document.createElement("link");
        sheet.rel = "stylesheet";
        sheet.href = new URL("site-footer.css", script.src).href;
        sheet.setAttribute("data-site-footer-css", "");
        document.head.appendChild(sheet);
    }

    function el(tag, attrs) {
        var node = document.createElement(tag);
        if (!attrs) return node;
        Object.keys(attrs).forEach(function (key) {
            if (key === "text") node.textContent = attrs[key];
            else if (attrs[key] != null) node.setAttribute(key, attrs[key]);
        });
        return node;
    }

    function link(href, text, extra) {
        var attrs = { href: href, class: "trial-more", text: text };
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                attrs[key] = extra[key];
            });
        }
        return el("a", attrs);
    }

    function dot() {
        return el("span", { class: "stage-foot-dot", "aria-hidden": "true", text: "·" });
    }

    function pair(label, anchor) {
        var wrap = el("span", { class: "stage-foot-pair" });
        wrap.appendChild(el("span", { class: "stage-foot-label", text: label }));
        wrap.appendChild(anchor);
        return wrap;
    }

    function buildFooter() {
        var links = el("div", { class: "stage-foot-links" });

        function add(node) {
            if (links.childNodes.length) links.appendChild(dot());
            links.appendChild(node);
        }

        add(link(meta.about, "About these demos"));
        add(link(meta.personalSite, "About Yiu Hong", {
            rel: "author noopener noreferrer",
            target: "_blank"
        }));
        add(link(meta.personalSite, meta.author, {
            rel: "author noopener noreferrer",
            target: "_blank"
        }));
        add(link("mailto:" + meta.email, meta.email, { class: "trial-more stage-foot-mail" }));
        add(link(meta.orcid, "ORCID", {
            "aria-label": "ORCID iD " + meta.orcidId,
            rel: "noopener noreferrer",
            target: "_blank"
        }));
        add(pair("Content", link(meta.contentLicenseUrl, meta.contentLicense, {
            rel: "license noopener noreferrer",
            target: "_blank"
        })));
        add(pair("Code", link(meta.licenseCode, meta.codeLicense)));
        add(link(meta.cite, "Cite & reuse"));
        add(link(meta.licensePage, "Licenses"));
        add(link(meta.changelog, "Changelog"));
        add(link(meta.contributing, "Contribute"));
        add(link(meta.issues, "Spotted a mistake?", {
            rel: "noopener noreferrer",
            target: "_blank"
        }));
        add(link(meta.repo, "View source on GitHub", {
            rel: "noopener noreferrer",
            target: "_blank"
        }));

        var version = el("p", { class: "stage-foot-note" });
        version.appendChild(document.createTextNode("Version "));
        version.appendChild(el("span", { "data-site-field": "version", text: meta.version }));
        version.appendChild(document.createTextNode(" · Updated "));
        version.appendChild(el("time", {
            datetime: meta.updated,
            "data-site-field": "updatedDisplay",
            "data-site-datetime": "updated",
            text: meta.updatedDisplay
        }));

        var footer = el("footer", { class: "stage-foot", id: "footer" });
        footer.appendChild(links);
        footer.appendChild(el("p", {
            class: "stage-foot-note",
            text: "Runs in the browser · saved on this device · nothing uploaded"
        }));
        footer.appendChild(version);
        return footer;
    }

    function fillFields(root) {
        (root || document).querySelectorAll("[data-site-field]").forEach(function (node) {
            var key = node.getAttribute("data-site-field");
            if (!key || meta[key] == null) return;
            node.textContent = String(meta[key]);
            var datetimeKey = node.getAttribute("data-site-datetime");
            if (datetimeKey && meta[datetimeKey] != null) {
                node.setAttribute("datetime", String(meta[datetimeKey]));
            }
        });
    }

    function playHosts() {
        var startSheet = document.getElementById("startSheet");
        var resultsSheet = document.getElementById("resultsSheet");
        if (document.getElementById("chrome") && startSheet && resultsSheet) {
            return [startSheet, resultsSheet];
        }
        var controls = document.getElementById("controls");
        if (controls && document.getElementById("experimentCanvas")) {
            controls.classList.add("stage-foot-host");
            return [controls];
        }
        if (document.body.hasAttribute("data-trial-task")) {
            document.body.classList.add("stage-foot-play");
            return Array.prototype.slice.call(document.querySelectorAll(".shell-screen"));
        }
        return [];
    }

    function fitHub() {
        var hub = document.querySelector(".trial-hub");
        var foot = document.getElementById("footer");
        if (!hub || !foot || foot.parentNode !== document.body) return;
        var hubStyle = window.getComputedStyle(hub);
        var footStyle = window.getComputedStyle(foot);
        var pad = (parseFloat(hubStyle.paddingTop) || 0) + (parseFloat(hubStyle.paddingBottom) || 0);
        var margin = (parseFloat(footStyle.marginTop) || 0) + (parseFloat(footStyle.marginBottom) || 0);
        var reserve = Math.ceil(foot.offsetHeight + margin + pad);
        document.documentElement.style.setProperty("--stage-foot-reserve", reserve + "px");
    }

    var footer = buildFooter();
    var hosts = playHosts();
    if (hosts.length) {
        hosts.forEach(function (host, index) {
            var copy = index === 0 ? footer : footer.cloneNode(true);
            if (index > 0) copy.removeAttribute("id");
            host.appendChild(copy);
        });
    } else {
        document.body.appendChild(footer);
        var sheet = document.querySelector("link[data-site-footer-css]");
        if (sheet && !sheet.sheet) sheet.addEventListener("load", fitHub);
        fitHub();
        window.addEventListener("resize", fitHub);
        window.requestAnimationFrame(fitHub);
    }

    fillFields(document);
})();
