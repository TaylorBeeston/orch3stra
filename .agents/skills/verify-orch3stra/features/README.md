# Orch3stra verification map

Read [the skill](../SKILL.md) before using these recipes. This map covers real user actions against the real browser application and Node bridge; source inspection and fixture tests are not execution proof.

## Baseline preconditions

Run the exact Launch commands in [SKILL.md](../SKILL.md) from the repository root; they select Node 22+ and provision pinned Playwright separately from WanGP. The [lifecycle helper](../scripts/verify.py) provides `run`, `serve`, `doctor`, and `drive`. `run` automates projects-and-sharing with an OS-assigned loopback port, isolated `H3_DATA_DIR` and `HOME`, and a fresh browser context. Read the actual URL from `$EVIDENCE/run.json`, not an assumed port. `doctor` is read-only.

The built-in demo is automatically seeded. It is a plan, not downloaded reference media or finished footage. No renderer/planner credentials, authenticated worker, GPU permission, or paid-provider authorization is included. Work only on this run's disposable server and browser state. Do not borrow the user's running bridge, HOME, browser profile, tokens, or projects.

## Driving conventions

- Recipes use synchronous Python Playwright: `from playwright.sync_api import expect`. Use the `page` supplied by the helper's driver, or your own fresh context connected to this run's recorded URL. Preserve the same context and origin for reload/local persistence assertions.
- Start with no modal open. Workspace navigation uses `nav.workspace-navigation [data-workspace-area="story"]` (or `overview`, `references`, `timeline`, `post`). Overview cards are alternate entrypoints. Dialog Back is `#workspace-back`; close is `#dialog [data-action="close-dialog"]`.
- Open the tool finder with `page.locator('nav.workspace-navigation [data-workspace-tool="tools"]').click()` or `page.keyboard.press('Control+k')`. Fill `#workspace-tool-search`, then click the matching control **inside `#dialog`**. Record which entrypoint you exercised. Escape from the search goes Back. The original `.header-actions`, library sidebar, inspector sidebar, and `.film-quicksteps` are hidden by the workspace shell, not usable user entrypoints.
- Fill and click actual controls; file uploads use `set_input_files` on the input belonging to a visible upload label. Never call internal setters, inject project state, monkeypatch transport, or manufacture successful worker replies.
- App confirmations are DOM dialogs: inspect `#app-confirm-summary`, then use `#app-confirm [data-app-confirm="accept"]` or `cancel`. Do not install a native-dialog auto-accept handler or blanket approval helper.

## Proof and reporting

- Recipes are **source-grounded, not automatically passed checks**. Authoring proof passed at `/home/taylor/.local/state/orch3stra-verification/20261016-skill-proof-03/`: project creation, direct and both Film desk brief editors, autosave/Ctrl+S and reload, Overview/Story routes, Projects through header and button/keyboard tool finder, Studio through button/keyboard finder, revision-1 publication with actual disk comparison, refresh list and confirmed pull restoring an unsynced local edit. Zero page errors; server exited cleanly and scratch was removed while proof survived. An independent second-browser pull and the other four feature recipes remain **unexecuted**. The retained `result.json` is authoritative about exact exercised entrypoints.
- Capture the action, assertions, screenshot, and ARIA snapshot with feature ID, entrypoint, run URL, and project identity. Keep console/network failures and downloaded artifacts. Persisted mutations need reload/reopen or an independent read-only server view, not only a toast.
- Report a missing provider, worker, media file, valid model, or authorization as **FAIL — precondition** for the full dependent journey. Record what is absent. A successfully opened panel can separately PASS navigation, but must never replace rendering, image generation, playback, speech recognition, or final-export proof.
- External-dependent instructions describe the complete path for a separately authorized run; they do **not** authorize dispatch in this baseline. Never click a generate/submit action merely to see what happens. Observe queue/job identity, terminal result, actual media availability and playback, and persisted selection when those journeys are authorized.
- Exports of metadata or source-media backups are not finished movies. Empty-state screenshots are not footage. CPU finishing still needs real media and permission to run that workload.

## Features

- [Projects and sharing](projects-and-sharing.md): create, edit, local save/reload/reopen, publish and pull.
- [Story and timeline](story-and-timeline.md): manual timing/window edits and reviewed planner proposals.
- [References](references.md): text-only subjects, source-file classification, and approved generated images.
- [Render review](render-review.md): selection review, render prerequisites, saved takes and playback.
- [Post and backups](post-and-backups.md): empty Post state, real finishing cut/export, project downloads and studio backups.
- [Agent filmmaking](agent-filmmaking.md): CLI/MCP discovery and authoring, revision conflicts, portable backups and browser pull of an agent-created film.

This deliberately bounded map does not claim complete coverage of every tool. Voice generation, automated coverage, speech recognition, music generation, sound-library extraction, project deletion/fork/autosync, credentials, and worker administration require their own dedicated journeys; finding their panel through All tools is not verification of those operations.
