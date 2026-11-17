/*
 * Fills the citation blocks on cite.html from assets/site-meta.js
 * and copies a block when its button is pressed.
 */
(function () {
    var meta = window.TrialSite;
    if (!meta) return;

    document.querySelectorAll("[data-site-apa]").forEach(function (node) {
        node.textContent = "";
        node.appendChild(document.createTextNode(meta.authorApa + " (" + meta.year + "). "));
        var title = document.createElement("em");
        title.textContent = meta.titleApa;
        node.appendChild(title);
        node.appendChild(document.createTextNode(" (Version " + meta.version + "). " + meta.url));
    });

    var bibtex = document.getElementById("cite-bibtex");
    if (bibtex) bibtex.textContent = meta.bibtex;

    var credit = document.getElementById("cite-credit");
    if (credit) credit.textContent = meta.credit;

    var task = document.getElementById("cite-task");
    if (task && typeof meta.taskCitation === "function") {
        task.textContent = meta.taskCitation(meta.taskExampleTitle, meta.taskExamplePath);
    }

    var frame = document.getElementById("cite-iframe");
    if (frame && typeof meta.iframeSnippet === "function") {
        frame.textContent = meta.iframeSnippet(meta.taskExampleTitle, meta.taskExamplePath);
    }

    function textFor(id, mode) {
        var node = document.getElementById(id);
        if (!node) return "";
        if (mode === "pre") return node.textContent.replace(/\s+$/, "");
        return node.textContent.replace(/\s+/g, " ").trim();
    }

    function selectNode(node) {
        var range = document.createRange();
        range.selectNodeContents(node);
        var selection = window.getSelection();
        if (!selection) return;
        selection.removeAllRanges();
        selection.addRange(range);
    }

    document.querySelectorAll(".trial-copy").forEach(function (button) {
        var label = button.textContent;
        button.addEventListener("click", function () {
            var id = button.getAttribute("data-copy");
            var mode = button.getAttribute("data-copy-mode") || "inline";
            var text = textFor(id, mode);
            var node = document.getElementById(id);
            function fallback() {
                if (node) selectNode(node);
            }
            if (!text || !navigator.clipboard || !navigator.clipboard.writeText) {
                fallback();
                return;
            }
            navigator.clipboard.writeText(text).then(function () {
                button.textContent = "Copied";
                window.setTimeout(function () {
                    button.textContent = label;
                }, 1600);
            }).catch(function () {
                fallback();
            });
        });
    });
})();
