/*
 * Site-wide facts for Project Trial.
 *
 * Version and the updated date live in this file. The footer, cite.html,
 * and license.html read it. Those pages repeat the same values in the HTML
 * so a browser without JavaScript still shows them. When the version
 * changes, update this file, the HTML fallbacks, CITATION.cff, and
 * CHANGELOG.md together.
 */
(function (global) {
    var meta = {
        title: "Project Trial: A library of gamified psychological tasks",
        titleApa: "Project Trial: A library of gamified psychological tasks",
        author: "Yiu Hong Ko",
        authorApa: "Ko, Y. H.",
        authorBibtex: "Ko, Yiu Hong",
        email: "yiuhong.ko@gmail.com",
        orcid: "https://orcid.org/0000-0003-4436-0166",
        orcidId: "0000-0003-4436-0166",
        personalSite: "https://yiuhong.github.io/",
        url: "https://yiuhong.github.io/task-library/",
        repo: "https://github.com/yiuhong/task-library",
        issues: "https://github.com/yiuhong/task-library/issues",
        changelog: "CHANGELOG.md",
        contributing: "CONTRIBUTING.md",
        cite: "cite.html",
        licensePage: "license.html",
        licenseCode: "LICENSE-CODE",
        about: "about.html",
        researchers: "researchers.html",
        version: "0.1.0",
        updated: "2026-11-17",
        updatedDisplay: "17 November 2026",
        year: "2026",
        contentLicense: "CC BY 4.0",
        contentLicenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        codeLicense: "MIT",
        bibtexKey: "ko2026projecttrial",
        taskExampleTitle: "Stroop Dash",
        taskExamplePath: "stroop_game.html"
    };

    meta.apaPlain = meta.authorApa + " (" + meta.year + "). " + meta.titleApa
        + " (Version " + meta.version + "). " + meta.url;

    meta.bibtex = [
        "@misc{" + meta.bibtexKey + ",",
        "  author  = {" + meta.authorBibtex + "},",
        "  title   = {{" + meta.title + "}},",
        "  year    = {" + meta.year + "},",
        "  version = {" + meta.version + "},",
        "  url     = {" + meta.url + "},",
        "  note    = {Version " + meta.version + ", last updated " + meta.updatedDisplay + "}",
        "}"
    ].join("\n");

    meta.credit = "From " + meta.title + " by " + meta.author + " (" + meta.url
        + "). Content licensed under " + meta.contentLicense + ".";

    meta.taskCitation = function (title, path) {
        var page = String(path || "").replace(/^\/+/, "");
        return title + ". " + meta.title + " (Version " + meta.version + "). " + meta.url + page;
    };

    meta.iframeSnippet = function (title, path) {
        var page = meta.url + String(path || "").replace(/^\/+/, "");
        var safeTitle = String(title || "").replace(/"/g, "");
        return '<iframe src="' + page + '" title="' + safeTitle
            + '" width="100%" height="720" style="border:0"></iframe>';
    };

    global.TrialSite = meta;
})(typeof window !== "undefined" ? window : globalThis);
