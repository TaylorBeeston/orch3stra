# CPU source checks

The `CPU source checks` GitHub Actions workflow runs on pushes to `main` and `ci/**` branches and on pull requests targeting `main`. It uses Ubuntu 24.04, Node 22 and Python 3.12, with a six-minute job limit and per-command timeouts. No npm/pip packages or backend are installed. The official checkout/runtime actions are pinned to full commit hashes, checkout does not persist credentials, and the workflow has `contents: read` permission only. It uses no secrets and has no deployment or publishing step.

`scripts/check-ci.py` checks:

- JavaScript/Python syntax of every file tracked by Git;
- that `LICENSE` and `THIRD_PARTY_NOTICES.md` are present, and that the upstream-derived WanGP mux research material excluded pending licensing review is not tracked;
- offline staged-import and promotion/rollback fixtures using synthetic Python modules; no installer or packages are run/downloaded;
- synthetic fixtures for bridge-startup preview ordering, storage data-URL decoding, timing, planner timing, editing/take dependencies, speech-review metadata and speech-quality classification.

Each run clears inherited environment variables and provides fresh `HOME`, `CODEX_HOME` and H3 data paths, an absent backend path and offline model flags. GitHub-hosted runners provide the clean machine; this is not a network-disabled sandbox. The checks have no provider, model or network dependency, and the speech fixtures do not run ASR.

CI does not cover Chromium/UI interaction, Gradio/WanGP compatibility, FFmpeg media rendering, real model judgment, ASR, GPU inference, hardware fit or production data. A green run does not establish those.

Run the same checks locally from a checkout with Node 22 and Python 3.12+: `python3 -B scripts/check-ci.py`. The broader local suite is `node scripts/check-all.mjs` (add `--integration` for the browser suites, which need Playwright/Chromium).

The Nemotron installer now performs bounded offline imports of the two auto factories and native processor from the newly staged overlay before replacing an existing overlay. CI exercises missing-import rejection, installed-module fallback rejection, staging cleanup and rollback behavior with synthetic modules. This does not prove a fresh pinned Transformers 5.19 installation works on every user environment; that environment must pass the actual installer smoke check.
