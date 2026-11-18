# Changelog

Version numbers for Project Trial start at 0.1.0. There is no earlier release and no prior version tag.

## Unreleased

- Added For researchers (`researchers.html`) and a device check (`diagnostics.html`). The check estimates this tab’s animation callback, `setTimeout` lateness, and the page clock from a color change to a key or a click. It does not upload anything, and it is not a light-sensor validation.
- Visual working memory and Eriksen flanker download trial-by-trial JSON and CSV from `assets/trial-export.js` on the results screen. Both shells use the same trial loop. Flanker hides the running accuracy and mean RT header in both shells. The public version stays 0.1.0 until a later release note folds this in.

## 0.1.0 — 17 November 2026

- Added a shared site footer on the hub and the other public pages. It keeps the existing About these demos, About Yiu Hong, and local-save lines, and adds the author, email, ORCID iD, content and code licenses, Cite & reuse, Licenses, changelog, contributing notes, issue tracker, source repository, and this version.
- Added Cite & reuse (`cite.html`), Licenses (`license.html`), `CITATION.cff`, `LICENSE` (CC BY 4.0 for teaching content), and `LICENSE-CODE` (MIT for source code).
- Task play pages carry that footer on the welcome and results cards. It is not drawn over the trial canvas. Spatial Go/No-Go keeps it on the 2D start and results sheets. `vr.html` only redirects and has no footer.
