# Using Orch3stra

A practical guide to the parts of the studio that are not covered by a dedicated feature guide. For setup see [FIRST-RUN.md](../FIRST-RUN.md); for individual tools see [EDITOR.md](../EDITOR.md), [POST.md](../POST.md), [SEQUENCES.md](../SEQUENCES.md) and [REFERENCES.md](../REFERENCES.md).

## Finding your way around

The editor has five work areas:

- **Overview**: project summary and the main steps.
- **Story**: brief, story/cast development, refinement and pacing.
- **References**: characters and files, Fill missing coverage, image/voice studios, scene reference planning and Clinic.
- **Timeline**: monitor, timeline, window selection, render controls and editing. **Window settings** holds timing, overlap, entry/exit state and direct references.
- **Post**: the finishing room, export and backups.

**Activity** collects the render, sequence, queue and AI-request monitors. **All tools / settings** (Ctrl/Cmd+K) is a searchable list of every tool. Switching areas, opening a tool or going Back never starts AI or GPU work.

Tool dialogs have a **Back** control and breadcrumb. Back returns to the parent tool with its form values, scroll position and selected window intact; Escape does the same, and × closes the whole stack. This is in-app navigation, not the browser's Back button, and it is not a substitute for saving: use Save/Apply before refreshing or closing the browser.

## Watching renders

**Render overview** (toolbar, or **Full live overview** for the expanded view) shows the whole server, not just the open project: renderer activity and queue pause, the current project/window/phase, observed denoising steps, saved windows, elapsed times, errors and timing adjustments. A managed film and its current window are shown as one entry.

The page refreshes about every two seconds while rendering and every eight seconds when idle, and immediately when you return to the tab. Mobile browsers may suspend background tabs; rendering never depends on the page being open. If the connection drops, the last data stays visible marked **stale/unavailable**. Refreshing is read-only: it never resumes, cancels or submits anything.

Remaining-time estimates appear after the first window of a managed film has been timed. They are ranges based on recent measurements, not deadlines, and they are hidden while a sequence is paused or the data is stale. Resolution, references, offloading and other GPU work all change the cost. The progress bar combines saved windows and observed steps; it is not a percentage of wall-clock time.

### Small frame-count differences

A finished window can come back a few frames shorter or longer than planned (for example 760 frames instead of 763 at 24 fps). For managed sequences, a difference of up to **four frames** is accepted when there is new footage: Orch3stra measures the real frame count, uses the measured end for playback, shifts later windows' start points by the difference and checks the saved prefix exactly before the next submission. Footage and audio are never padded, cut or re-encoded. Larger differences, a wrong frame rate, a missing output or a decode failure stop the sequence before another submission and keep the output for inspection.

To recover a completed window from an attempt that stopped, open **Sequences**, find the attempt (check History if hidden) and choose **Recover saved window…**. This creates a **new parked sequence** from the verified saved video; the original stays as it was. The recovered sequence uses the prompts and references from the original submission, not newer edits. Choose **Resume sequence** on the copy only when you want to generate the remaining windows. For a merely paused attempt, **Reconcile state** collects completed windows. Recovery cannot help if the native file was deleted or belongs to a different backend.

## AI planner requests

AI requests are accepted by the server and tracked there, so closing the dialog, refreshing the page or a phone losing its connection does not lose them while the Node editor keeps running. Watch them in the inline status or **AI requests**. No fake percentage or ETA is shown.

In **AI requests**, select a request to see its events, partial output, finish reason/usage (when the provider reports it) and the exact prompt. **Download request + log** saves a diagnostic JSON; review it before sharing, because it contains your prompts and story text (API keys and media are omitted).

Logs:

- `$H3_DATA_DIR/ai-requests.log` (default `~/.local/share/h3-director/ai-requests.log`), also printed as `[AI]` lines in the editor's terminal or `journalctl --user -u h3-director -f`. These contain metadata only, never prompts or model output, and rotate at about 5 MiB.
- Full private records: `$H3_DATA_DIR/ai-requests/<id>.json` (owner-only permissions). The latest 100 finished requests are kept.
- The renderer's own log is `headless/worker.log`; AI requests are not in it.

| Code / state | Meaning |
| --- | --- |
| `AI_CONNECT_TIMEOUT` | No connection to the provider within 90 seconds. |
| `AI_IDLE_TIMEOUT` | No data received for the idle interval. |
| `AI_TOTAL_TIMEOUT` | The overall request deadline passed. |
| `AI_HTTP_401` / `402` / `429` / `5xx` | The provider returned that HTTP status. |
| `AI_STREAM_CLOSED` / `AI_STREAM_INCOMPLETE` | The connection ended before the response finished. |
| `AI_OUTPUT_LIMIT` | The provider stopped at its output limit; partial JSON is not applied. |
| `AI_EMPTY_OUTPUT` | The response contained no usable text. |
| completed + invalid validation | The request worked, but the result still needs review. |
| interrupted | The editor stopped or restarted; the request is not replayed automatically. |

Partial output is never applied automatically, and there is no automatic paid retry or model fallback. Cancelling cannot guarantee the provider won't charge for work already done.

After a refresh, a completed pacing request offers **Review pacing response**, which reuses the saved answer without a new AI call (it is refused if the project changed since). Apply it with **Create editable project copy**. Other request kinds keep their output for download but can't yet be re-imported automatically.

Default deadlines are 20 minutes total, 180 seconds without data and 90 seconds to connect. Change them with `H3_AI_TIMEOUT_SECONDS` (30–3600) and `H3_AI_IDLE_SECONDS` (15–1800), for example `env H3_AI_TIMEOUT_SECONDS=1800 node start-headless.mjs`. Longer timeouts don't fix authentication, rate limits or provider overload, and provider-specific limits (such as DeepSeek's own wait limit or the Codex ceiling) still apply.

Restarting the editor interrupts in-flight AI requests but not the GPU worker. A managed sequence may pause after its current window until you reconcile and resume it.

## Codex subscription sign-in

Open **Connections → Codex subscription sign-in** and choose **Sign in with ChatGPT**. This uses the official Codex device-code login: open the displayed URL and enter the temporary code. Codex stores the login itself; Orch3stra never reads its token files, asks for your password or falls back to `OPENAI_API_KEY`. Signing in changes the Codex account for the whole server, not for one device.

The Codex model picker loads the live model catalog from your signed-in account whenever it opens (or with **Refresh live model catalog**); model IDs are never added by hand. If newer models are missing, update the Codex CLI that the editor uses (`codex update` or your package manager), restart the editor and reopen the picker; it warns when the CLI is older than 0.156.1. `CODEX_BIN` selects a different executable. Whether a model appears still depends on your account. Planner threads are read-only and tool requests are rejected.

## Reference images: one prompt per image

Each reference-image card is sent to WanGP as a single prompt (`multi_prompts_gen_type: "FG"`), so multi-paragraph prompts are not split into separate generations. If an image run stopped with WanGP's paragraph-splitting error, open **Fill references**, choose the stopped run and click **Retry image as one prompt**. It retries only that image with a new request ID, keeps completed windows, accepted pictures and spent allowances, and does not repeat the AI planning call. The new image counts against the image budget.

## Upgrading safely

Update the checkout while nothing is rendering: let renders and AI requests finish (or park them), pause managed dispatch, export project backups, then stop the editor. Changes to the Node editor only need the editor restarted (`node start-headless.mjs`). Changes to the Python worker need `node start-headless.mjs --stop` (it refuses while rendering) and then `node start-headless.mjs`; the footer and `--status` show the running worker version. With systemd user services, restart `h3-director.service` for editor changes and `h3-wangp.service` for worker changes, and regenerate the units with `node scripts/install-services.mjs --install` if paths changed. Never run two editors on the same data directory. See [UPGRADING.md](UPGRADING.md) for backups, rollback and footage recovery.

## Legacy WanGP plugin

The headless worker is the default and needs no plugin. The optional legacy browser-driven adapter lives in `wan2gp-h3-director/`. To install or update it, wait until WanGP is idle, back up the existing plugin, copy `plugin.py` and `telemetry.py` (and `__init__.py` for a fresh install) into `Wan2GP/plugins/wan2gp-h3-director/`, enable it in WanGP, restart WanGP, start the adapter and enter its displayed token in the editor. Keep the initiating WanGP page open and visible while it dispatches. Voice tools do not belong in WanGP's environment for this plugin.
