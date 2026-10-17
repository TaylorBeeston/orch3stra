# Connection, authorization and recovery

## Launch without disturbing existing work

Run from the Orch3stra checkout. Inspect `node orch3stra.mjs doctor` first; reuse the existing studio if reachable. `node start-headless.mjs --status` is read-only. When no server is running:

- Editing only: `node bridge.mjs` in a separate terminal. No worker/models required for project authoring.
- Real generation: `node start-headless.mjs --check`, then `node start-headless.mjs` with an already configured, independently installed WanGP environment. Structural check exit 2 is expected and does not certify model loading; exit 1 needs remediation. `--setup` is an explicit interactive path configuration, not an installer or license grant.
- Default studio: `http://127.0.0.1:8765`; keep worker access private. Do not open a second Gradio/worker over the same checkout/GPU. Never remove writer locks or modify SQLite to resolve ownership.

`ORCH3STRA_URL` or `--url` selects the studio origin. For a paired nonloopback deployment, obtain the pairing password through the user's approved secret channel and feed it on stdin:

```sh
umask 077
read -r -s -p 'Studio pairing password: ' ORCH_PAIR_PASSWORD; printf '\n'
printf '%s' "$ORCH_PAIR_PASSWORD" | node orch3stra.mjs pair --password-stdin --cookie-file .orch3stra-cookie
unset ORCH_PAIR_PASSWORD
node orch3stra.mjs doctor --cookie-file .orch3stra-cookie
```

Pairing creates a new private file and refuses overwrite; use an existing valid cookie rather than repairing by deleting sessions. Do not commit/share cookies, provider tokens, logs containing private prompts, or downloaded private media. HTTP on a LAN is not encryption. Unsynced browser projects must be published intentionally before agent work; the agent cannot infer that an older server copy is current.

Headless mode uses the server-owned local connection/token; agent requests cannot override it. In legacy-adapter mode, agent calls use `wangpUrl` and `wangp` already saved in Studio credentials. If absent, configure the actual approved adapter through `studio.save-credentials` (inspect its schema first), not a guessed localhost port or a destination override on each worker call. Never place a bearer token in a URL or a committed request file.

## MCP configuration without placeholder paths

The stdio server is a client of the same running studio. It does not start it. From the repository root, this prints an immediately usable host configuration with this checkout's actual absolute path:

```sh
node --input-type=module -e 'import {resolve} from "node:path"; console.log(JSON.stringify({mcpServers:{orch3stra:{command:process.execPath,args:[resolve("orch3stra.mjs"),"mcp"],env:{ORCH3STRA_URL:process.env.ORCH3STRA_URL||"http://127.0.0.1:8765"}}}},null,2))'
```

Copy the printed object into the MCP host's configuration. For remote pairing, add the actual private cookie file via CLI arguments `--cookie-file` and its absolute path; do not embed passwords. Hosts using a different configuration shape still need the same command/arguments. Protocol: newline-delimited JSON-RPC stdio, `initialize` then `tools/list`; `resources/list` exposes the entire skill; `prompts/get` accepts `make_film` with `brief` and optional `constraints`.

A real read-only MCP request after initialization:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"doctor","arguments":{}}}
```

CLI outputs the real service result directly. MCP exposes it in `structuredContent` and JSON text content; check `isError`. `job_wait` adds an envelope: `outcome`, `tool`, `id`, `status` when known, and `result`. Do not confuse `result.job` (planner) with a native worker's `result.job_id`, or a project record's `project.id` with a service job ID.

## Permission is not a budget or a license

Discover each action's effects with `describe`. Explicit scopes are `cpu`, `gpu`, `provider`, `network`, `delete`; CLI `--allow cpu,network` corresponds to MCP `"_allow":["cpu","network"]`. Scopes admit a call; they are not an OS sandbox, price ceiling, installed-model check, or provider/model terms acceptance. Never grant all scopes merely to suppress an authorization error.

Before inference, record an actual approval: authorized provider/model and data recipients; maximum paid calls/cost and GPU attempts/frames; permitted image/voice sources; commercial or research distribution; whether exact model/profile weights are already present; license terms the authorized user accepted. Discovery may contact the configured worker but is not authorization to dispatch, download, install, or accept licenses. Unknown costs/uncached weights are a stop condition, not consent inferred from a broad filmmaking request.

Image `licenseAccepted:true` is supplied only after real acknowledgement for that dispatch. It must not be recovered from creative project JSON or an old backup. Voice source import requires actual rights confirmation; a celebrity-like voice or anonymous diarization label does not establish consent. Budget rejected and uncertain attempts conservatively; do not reset counters by starting a fresh run. Automatic planning/coverage and speech-repair loops need their own finite caps and explicit approval.

## State integrity

- Save each returned full record. On project writes use `expectedRevision: record.serverRevision`, not `project.revision`.
- On `REVISION_CONFLICT`, get the current project, compare the changed fields and historical jobs, then make a deliberate new edit. Never retry the same write against a new revision blindly.
- Upload real bytes using `upload`; retain the returned key/hash/size. `references.register` probes the uploaded content and attaches it. Reusing an immutable key with changed content fails by design.
- Prepare a generation request once, save its returned operation/intent/request identity, then dispatch that exact packet once. Build is inspection; prepare may upload/persist; neither is footage.
- A definite render-intent admission rejection saves no prepared request marker: after resolving that exact blocker and rereading the project, the never-admitted request can be prepared with the same ID. Once an intent was admitted, its request ID is consumed even if a later CAS/save fails. Inspect `error.details.intent` and any `cleanupError`; only that newly owned intent is cancelled by failed preparation. `PREPARATION_INVALIDATED` is not permission to replay. Reconcile ownership and preserve the durable marker before deciding on a separately identified attempt.
- Never construct fake render history, source URLs, output IDs, model IDs, reference inspection scores or completion records. Adoption fetches authoritative server-owned jobs and verifies provenance.

## Recovery decision table

| Observation | Safe next operation | Do not do |
| --- | --- | --- |
| CLI timeout/lost mutation response | Read saved revision, intent and original request/job IDs; reconcile the exact operation where supported | New request ID, blind replay, reset budget |
| Worker queued/running | `worker` job read / `wait worker` with `--allow network`; inspect `render_progress` with CPU/network approval | Treat 100%/a preview as a finished output |
| Managed sequence paused/uncertain | `sequence get`, `diagnostics`, `reconcile`; review returned ownership before explicit `resume` | Auto-unpause queue or start a parallel sequence |
| Reference `needs_review` | Read pending candidate/question, actual pixels, budgets and stamps; explicitly approve/reject/repair that step | Approve from caption, restart entire run to bypass budget |
| Planner interrupted/invalid | Read retained raw response; validate/adopt only complete accepted proposal | Treat partial JSON as a completed draft |
| Speech repair uncertain | `speech_quality get` and `reconcile`; inspect attempt request identity | Spend another alternate or silently select it |
| Finish paused after Node restart | `finish get`, then explicitly `resume` frozen export with its declared effects | Assume frame-exact encoder continuation or rerender H3 |
| Wait timeout | Continue observing the same ID if desired | Cancel/resubmit implicitly |
| Worker process actually exited | Inspect status/logs; explicitly approved `renderer` restart only after diagnosis | Restart a merely slow worker or stop active unrelated work |
| Missing media/weights/license/packages | Preserve plan/evidence, name exact prerequisite and required approval | Fabricated media, downloads or installation without permission |

`wait` only observes; attention/timeout return nonzero CLI exits (3/2). Preserve output and inspect it. Closing a tab/CLI does not cancel accepted native tasks. Stopping Node can halt managed coordination while an accepted worker task continues. Never upgrade or move owned source files mid-job. See repository `HEADLESS.md`, `PENDING-INTENT.md`, `docs/INTENT-LOCK-RECOVERY.md`, `REFERENCE-RECOVERY.md`, and `REFERENCE-PROGRESS.md` for specific recovery cases.
