# Agent filmmaking

## Sub-features

- CLI discovery, doctor and structured project/story/cast/timeline/reference authoring.
- MCP initialization, tool calls, filmmaking resources and the `make_film` prompt.
- Published-project compare-and-swap, immutable real-media import and explicit adoption boundaries.
- Portable backup creation, same-studio download, byte count and SHA-256 verification.
- Browser interoperability: explicitly pull the agent's published project and inspect its actual timeline.
- Separately authorized production continuation: look anchors, calibration, real footage, take selection, Post and final delivery. Planning is not completion of these sub-features.

## How to get to it (user POV)

Start an isolated `serve` run using the parent verification skill. Point `ORCH3STRA_URL` at its actual `run.json` URL; set `ORCH3STRA_EVIDENCE` to this run's retained evidence directory, not its disposable data directory. Use Node 22+.

Read [make-film](../../make-film/SKILL.md). CLI entrypoints are `node orch3stra.mjs doctor`, `tools`, `describe`, and `call`; MCP entrypoint is `node orch3stra.mjs mcp`. A browser draft must be intentionally published before an agent can edit it. The baseline creates a new project rather than borrowing any user draft.

## Driving it with CLI, MCP and browser

1. Save `doctor` and `tools` JSON. Doctor must identify the real studio, its agent protocol and published projects, without returning the bridge token.
2. Run sections **1 and 2** of the [executable recipe](../../make-film/references/recipe.md), in the same Node session. It saves every actual request/response and creates **A Little Shelter**, two prop subjects, three 141-frame windows, one scene and an image plan. Assert the returned project has those exact authored values and 423 total frames; do not claim generated media.
3. Run that recipe's final **portable-backup block** with approved local CPU and same-studio file transfer. Read the downloaded `.h3project`: its project ID and three window IDs must match the current server record. Compare the actual downloaded SHA-256 and byte count with the completed backup record. Keep both records.
4. For CAS proof, save a revision, perform one intentional title edit on this disposable project, then submit another edit with the old revision. Require `REVISION_CONFLICT`, and reread the real project to prove the stale title never replaced the accepted one. Do not retry the stale edit with a new revision.
5. Start an owned MCP subprocess. Send `initialize`, then `tools/list`, `resources/read` for `orch3stra://filmmaking/SKILL.md`, and `tools/call` with `name:"project"`, arguments `{action:"get",projectId:theActualId}`. Save stdin/stdout JSON-RPC. Verify the same record, not a mocked result. End stdin and reap that subprocess. The permanent `scripts/check-agent-http.mjs` additionally checks authenticated CLI/MCP mutation, concurrent CAS protection and corrupted-backup rejection with private temporary state; its legacy renderer boundary is explicitly a local fixture.
6. Open the isolated URL in a fresh browser context. Click **All tools / settings**, then `#dialog-body [data-studio-action="shared"]`. Wait for the actual film title; capture the listed revision. Click its **Open / pull**, inspect the app-owned confirmation, then accept only this requested pull. Verify `#project-name` equals the authored title.
7. Open **Timeline** with `nav.workspace-navigation [data-workspace-area="timeline"]`. Scroll the first generation-duration slider into view. Verify **Exposed**, **A precarious turn**, **Sheltered**, three 141-frame windows, **Rainy soil · 3 windows**, and **00:17.625**. Capture the timeline and ARIA state. “Not rendered” is expected in this planning journey, not footage evidence.
8. Close the owned browser and MCP client. Stop only the owned `serve` supervisor; require `cleanup.json` records clean bridge exit, scratch removal and retained evidence. Confirm the backup, requests/responses, screenshots and transcript still exist.

Observed final proof: `/home/taylor/.local/state/orch3stra-verification/20261016-agent-filmmaking-02/`. The real CLI recipe created revision 8, its 7,085-byte backup matched its recorded SHA-256, and the browser pulled and displayed the three-shot plan with no page errors. The same run discovered all 27 MCP tool schemas and exercised skill/prompt discovery, MCP project creation, actual PNG upload/probing/Post transfer and byte-identical download, and a stale-write rejection with persisted accepted state. `result.json` and the saved request/response files are authoritative; `cleanup.json` confirms clean bridge exit and evidence retention. This is the real local app, not a container/VM stand-in; no worker/provider was provisioned and the synthetic PNG is not generated-film quality evidence.

## Gotchas

- The isolated baseline has no worker, model weights, planner account, source references or generated footage. Full generation/finishing journeys **FAIL — precondition** until those are independently provisioned and authorized; never relabel the planning journey as a finished film.
- `tools`/`describe` are local schema discovery. `doctor` checks the studio, not GPU/model readiness. `generation.discover` contacts the configured worker and needs the appropriate scope.
- CLI `--allow cpu,network` / MCP `_allow` are deliberate admission scopes, not a budget, sandbox, or model-license grant. Do not add GPU/provider scopes during this baseline.
- Media probing requires FFprobe. An uploaded filename/MIME is not proof of media type; registration measures actual bytes. Never fabricate metadata to get past missing prerequisites.
- Hidden duplicate Studio buttons exist outside the visible finder. Scope its selector to `#dialog-body`; generic text matching may select a hidden control.
- Pull is explicit and may replace an unsynced browser copy. Use the fresh verification browser only, inspect its confirmation and preserve the user's real browser session.
- Portable backups contain registered references/Post media, not all worker-owned rendered videos. Retain original takes and final exports separately when those stages are actually exercised.
