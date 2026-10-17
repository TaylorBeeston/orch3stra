---
name: verify-orch3stra
description: Launch and drive Orch3stra's real browser filmmaking studio and Node bridge in isolation; use after changes to project editing, sharing, navigation, references, rendering review, or Post, with retained browser and storage evidence.
---

# Verify Orch3stra

Read [features/README.md](features/README.md) first. This is a real-app harness, not the fixture-backed `tests/browser_*_check.py` suite. Those tests supply useful selectors but replace transports/storage and do not prove the running application.

Primary surface: browser UI served by `bridge.mjs`. Secondary surfaces: the `orch3stra.mjs` JSON CLI/MCP server, authenticated `/api/*` bridge operations, and `start-headless.mjs` worker lifecycle CLI. The automatic baseline proves **editing and sharing only**; the separately mapped [agent filmmaking](features/agent-filmmaking.md) journey proves programmatic authoring and browser interoperability. Neither baseline proves GPU generation, planner output, media decoding, or MP4 exports.

## Launch

Run from the repository root. Node 22+ is required; the system `/usr/bin/node` on the authoring host is 20 and is not the supported runtime. The checked Node 24 executable below is installed on that host. The app has no npm install/build step. The harness uses Python 3, Linux `/proc`, `uv`, and pinned Playwright 1.58.0 in uv's separate cached environment, not the WanGP Python environment. An existing Google Chrome executable is available at the path below.

```sh
export NODE_BIN=/home/taylor/.local/share/fnm/node-versions/v24.18.0/installation/bin/node
export CHROMIUM_BIN=/opt/google/chrome/chrome
export EVIDENCE="$HOME/.local/state/orch3stra-verification/$(date -u +%Y%m%dT%H%M%SZ)-$$"
uv run --no-project --with playwright==1.58.0 --python /usr/bin/python3 python \
  .agents/skills/verify-orch3stra/scripts/verify.py run \
  --node "$NODE_BIN" --chromium "$CHROMIUM_BIN" --evidence "$EVIDENCE"
```

On another host, locate an installed Node >=22 and Chromium, then set those two variables to their actual executables. Do not silently run Node 20 or install packages into WanGP. If Chromium is not installed, explicitly provision Playwright's browser with `uv run --no-project --with playwright==1.58.0 --python /usr/bin/python3 python -m playwright install chromium`, then omit `--chromium` and unset `CHROMIUM_BIN`. That setup downloads browser binaries; it is not application behavior.

`run` performs launch → doctor → mapped projects-and-sharing journey → evidence → cleanup. A nonzero exit is a failure, not a pass with a missing precondition. The evidence directory must not already exist: a new attempt needs a new path.

The helper executes the repo's documented editing-only command, `node bridge.mjs`, with:

- `H3_HOST=127.0.0.1`, `H3_PORT=0`: the OS selects a free port; never race a port finder or attach to port 8765.
- New private `/tmp/orch3stra-verify-*` scratch state: `H3_DATA_DIR`, `H3_HEADLESS_DATA_DIR`, `HOME`, XDG directories, `CODEX_HOME`, `HF_HOME`, and `TMPDIR` all live there.
- A clean environment without inherited provider/worker credentials. `H3_WANGP_BACKEND=headless` points to the empty private worker directory; no existing renderer can be reached through default legacy settings.
- Nonexistent private `H3_PYTHON`/`CODEX_BIN` paths, empty `CUDA_VISIBLE_DEVICES`, and offline Hugging Face/Transformers flags. This intentionally disables optional processing. It is **not a network sandbox**; do not configure external providers or press generation/restart buttons in this baseline.

The bridge creates its own data directories/ledger and waits for all store/manager initialization before logging `Orch3stra <version>: http://127.0.0.1:<port>` and `Keep this server running.` The helper waits for that log, validates ownership and authenticated storage listing, and writes `run.json` and `doctor.json` inside `$EVIDENCE`. A health response alone is not readiness.

A fresh browser context loads the built-in **The last light** demo automatically. No DB seed/migration commands or internal setters are needed. The driver requires the demo title, visible workspace, and `Saved in this browser` before driving, then creates a **new blank project** for a publishable media-free seed. The demo's missing media are not silently fabricated.

For interactive feature work, use `serve` instead of `run` with a new evidence directory:

```sh
python .agents/skills/verify-orch3stra/scripts/verify.py serve \
  --node "$NODE_BIN" --evidence "$EVIDENCE"
```

Keep this foreground supervisor alive in an owned PTY/service. It prints the ready URL and writes it to `run.json`. Use a dedicated browser context/tab at that exact origin. When finished, close that context/tab, then send Ctrl-C/SIGTERM to this supervisor only; its `finally` block stops the child bridge and removes scratch data. Do not launch `start-headless.mjs` for baseline verification: that can start or reuse a real renderer.

## Doctor

One read-only command, usable while either mode is running:

```sh
python .agents/skills/verify-orch3stra/scripts/verify.py doctor --evidence "$EVIDENCE"
```

Run this first whenever a selector, request, connection, or stale build looks suspicious. It requires:

1. Active manifest and the exact live child PID birth identity, command, checkout cwd, and isolated environment.
2. The actual loopback listening socket owned by that PID, not merely a matching HTTP response.
3. Unchanged SHA-256 fingerprint of the checkout's top-level JS/MJS/HTML/CSS and the expected app version.
4. Real `/api/health` identity, loopback auth mode, headless backend configuration, and an authenticated **read-only** `POST /api/studio {"action":"list"}` using the health token. Tokens are not printed.

A stopped run correctly fails doctor. Do not revive its manifest, remove writer locks, or drive someone else's server. Fix the prerequisite and launch a new isolated run. Doctor proves the editor, not renderer/model readiness; voice “capabilities” endpoints are not a harmless substitute because they can invoke Python.

## Drive

The executable recipe for [projects-and-sharing](features/projects-and-sharing.md) is built into the helper. To run it against an owned `serve` instance:

```sh
uv run --no-project --with playwright==1.58.0 --python /usr/bin/python3 python \
  .agents/skills/verify-orch3stra/scripts/verify.py drive \
  --chromium "$CHROMIUM_BIN" --evidence "$EVIDENCE"
```

It uses a fresh Playwright context, actual page navigation/click/fill/keyboard events, and the real bridge. It does not override `DirectorProviders`, `DirectorStore`, `fetch`, routes, or application state. Journey:

- Projects header → New blank project; fill `#project-name` and Story `#request`; Ctrl+S; reload and assert both persisted values.
- Overview → Develop the story; verify brief autosave without Ctrl+S. Exercise both Story → Refine with the assistant and tool finder → Film desk → Save brief, then reload each edited value.
- All tools / settings and Ctrl+K → Projects → reopen the named local project.
- All tools button and Ctrl+K → search Studio → shared studio → publish; assert revision 1 and compare the actual server project file.
- Change the local name without publishing, then Studio → Refresh list → Open / pull → explicit app-owned confirmation; reload and assert the stored name and brief were restored.

The driver intentionally refuses to overwrite `actions.jsonl`; use a fresh launch/evidence path for retries. Do not reuse its browser context as a user session.

For the other mapped features, use Python Playwright's `page`/`expect` recipes in their feature files, with the URL from `run.json`, a fresh context, trace, and captured actions. The agent browser tool can also open that exact URL: use direct click/fill/press helpers and screenshots; `tab.run` only for read-only observations/artifact capture, never internal setters. Always close the owned tab. Hidden `.header-actions` buttons are not reachable user paths; use visible workspace cards/tool finder instead. If the map lists button and keyboard entrypoints, exercise both before claiming that subfeature complete.

## Evidence

Authoring proof: the complete `run` journey passed on the real local Linux app (Orch3stra 2.3.0, Node 24.18.0), with no transport fixtures. Retained evidence: `/home/taylor/.local/state/orch3stra-verification/20261016-skill-proof-03/`. `result.json` records all exercised entrypoints, exact persisted values, revision 1, and zero page errors. `cleanup.json` records exit code 0, no forced kill, scratch removed, and evidence preserved; screenshots and trace were confirmed present after cleanup. Other feature recipes remain source-grounded, not executed. This was the real browser/bridge target, not a container/VM stand-in; the GPU/planner environment was deliberately not provisioned or verified.

`$EVIDENCE` is outside scratch state and survives teardown. Default named location: `~/.local/state/orch3stra-verification/<UTC timestamp>-<shell PID>/`. Contents of a successful automated run:

- `run.json`, `doctor.json`, `server.log`: runtime identity, source fingerprint, readiness and app logs.
- `actions.jsonl`: ordered user actions and assertions, including selectors and typed values.
- `01-ready` through `06-restored` PNGs and ARIA YAML snapshots; intermediate approval and published-state proof, not only the final screen.
- `trace.zip`: real Playwright trace with actions, snapshots, network, and screenshots.
- `published-project.json`: copied real server record, including exact name/brief and server revision.
- `requests.json`, `page-errors.json`, `result.json`: observed browser destinations/API actions, page errors and explicit exercised entrypoints.
- `cleanup.json`: owned server exit, return code, whether forced termination was needed, scratch removal and evidence retention.

Review screenshots, not just exit status. View a trace locally with:

```sh
uv run --no-project --with playwright==1.58.0 --python /usr/bin/python3 python -m playwright show-trace "$EVIDENCE/trace.zip"
```

Proof standards:

- Drive a real user path; internal state mutation or test-only transport responses invalidate the proof. Read-only file/DOM inspection supplements, never replaces, UI interaction.
- Capture actions and outcomes, then prove persistence through reload/reopen and side effects through actual files/rows. A toast or final screenshot alone is insufficient.
- No mocks in this baseline. Any later external-system fixture must sit at an existing production boundary and must be labeled; it cannot establish real provider/GPU correctness.
- This is an **editing-only real backend**, not a dry-run implementation. The driver observes browser requests stay on its own origin, no generation/start/restart/resume action, no worker connection file, and no managed run record. It does not claim to trace every OS network syscall. Never infer “no side effects” from a mode name; logs and project file writes are expected here.
- Fresh data lacks a working planner, renderer, reference blobs and finished footage. Full dependent journeys must report **FAIL: unmet precondition**, with reason/artifacts, not be weakened into a navigation pass. Report only the entrypoints actually exercised; source-grounded map recipes are not executed proof.
- Artifacts are private (directory mode 0700). Browser traces can include ephemeral bridge tokens, prompts, filenames and project data; do not upload them publicly without redaction.

## Cleanup

`run` owns and closes its Playwright context/browser and terminates/reaps only its `Popen` child in `finally`, on success, failure or interrupt. It first sends SIGTERM for normal app shutdown, with a bounded forced kill only of that same unreaped child if necessary. It removes its unique scratch directory, never `$EVIDENCE`. A `serve` run is stopped with Ctrl-C/SIGTERM to its owned supervisor; `drive` only owns its browser, not the supervisor.

After **every** attempt, including failure, inspect `cleanup.json`: require `server_exited`, `scratch_removed`, and `evidence_preserved` true. Successful baseline runs should have `server_returncode: 0` and `forced_kill: false`. Confirm the named proof artifacts still exist after cleanup, e.g. with the read tool on `$EVIDENCE/result.json`, `06-restored.png`, and `trace.zip` metadata. Do not treat an absent cleanup receipt as success. SIGKILL/power loss bypasses Python cleanup; inspect the recorded PID birth/command before recovery, never kill by process name or delete a live writer lock. Never delete unrelated user state or evidence.

Concurrent baseline runs are supported: each gets a new OS-assigned port, private server/home/tmp state and fresh browser context. Concurrent GPU runs are **not** covered by this isolation contract. Refuse to double-drive the user's existing studio/browser/worker.

## Helpers

`scripts/verify.py` is executable. Its four commands and invocations are shown above; `--help` describes flags. `run` is the default end-to-end proof, `serve` is an owned foreground server for further mapped work, `doctor` is read-only, and `drive` exercises the project journey against a running owned server. `serve`/`doctor` use only the Python standard library; `run`/`drive` require Playwright. Dependencies and browser caches are tooling, not app scratch, and are not deleted during app teardown.

Maintain the map and its evidence boundaries as the app changes with `/maintain-verification-skill`.
