## 1.9.2: one image prompt stays one task

**This release updates both Node/editor and the idle Python worker to 1.9.2.**
Qwen image requests now explicitly use FG (all paragraphs are one prompt), including
standard and Viggle settings. H3 video-window modes are unchanged.

When GPU work is idle, stop the old Node process. From this NEW release folder run
`node start-headless.mjs --stop`, then `node start-headless.mjs`, keeping H3_DATA_DIR.
No dependencies, plugin installation, token rotation, or data reset are needed.

For the already-failed reference run, use **Fill references → Retry image as one prompt**.
It retries the saved request, not the whole preparation pass, with a new native request ID.
The old error, completed windows, accepted pictures and spent allowances are preserved.
Candidate review still runs. See **IMAGE-PROMPT-FIX.md** for safe service upgrades and
budget/queue-pause details. Earlier release sections below are historical.

---

# Reference planning recovery — 1.9.1

This update is editor/Node only. No Python worker/plugin, model, environment, or token changes.
Do not stop the detached renderer merely to install it.

## The reported failure

A saved autonomous run stopped after 21 of 249 windows with:

    Generated coverage must preserve the requested requirement state.

The previous validator compared the model-written `state` to an entire stored requirement
sentence using exact equality. A different sentence could block an image request even
when it selected an existing requirement ID. Resume reused that completed response (to
prevent duplicate paid work), hitting the same guard. There was no repair action, and the
downloaded diagnostic did not include the rejected response.

The uploaded report establishes which guard fired and repeated stops at the same request.
It does NOT contain the rejected model response, so its exact returned wording was not
available for inspection here. The captured request on the user's running server can
supply it. Tests reproduce the code path with a deliberately different label, not a claim
that a fixture is the missing actual model response.

## Resume the same run

1. Export a project backup and stop only Director's Node process after active AI work is
   finished/parked. Keep the detached worker running and retain its old source folder.
2. Start this release with `node start-headless.mjs`, using the same H3_DATA_DIR and URL.
   For systemd update/restart only `h3-director.service`, not `h3-wangp.service`.
3. Open **Fill references** and the existing stopped run. Do not cancel or create a new
   project just to clear this error.
4. **Continue saved plan** or **Continue with these settings** revalidates the cached
   response. State/angle metadata is bound from its existing requirement ID. Earlier
   windows, accepted candidates and spent allowance remain.
5. A genuinely invalid plan instead offers **Repair this step & continue**. After explicit
   confirmation this makes ONE new planning call for the current step, with the error and
   previous response. Subsequent image generation/review and later windows continue under
   the existing policy. This is not a full-film restart or a free retry.

Rejected responses and request IDs remain. Concurrent repair clicks cannot admit duplicate
plans. Changed source stamps, pending cancellation, or unresolved image submissions block
plan replacement. Budgets never reset. Unknown provider delivery is not assumed safe to
repeat. Shared/local result-application rules are unchanged.

## Why this is not a visual-quality bypass

The requirement ID links to the authoritative project target. The server supplies its
state and locked angle; alternative model display labels are recorded as proposals, not
asserted to be equivalent. The model may describe a useful composition, but cannot change
the linked subject, bypass fixed-source pins, use unapproved/excluded inputs, or claim it
inspected unattached images.

The image payload carries a separate target with the actual window appearance and scene
location. Both the proposed prompt and actual sent prompt are retained. Candidate review
receives that target and actual pixels. A misleading composition can still be rejected.
Only the metadata-echo requirement changed; visual acceptance thresholds did not.

Existing-image checks now receive current appearance/location as well as broad scene
states. “Retells the dessert dispute” is not a reason to require a diner pose when the
window is in an apartment. Checks in the CURRENT unfinished window may run again because
of the added context; previously completed windows are not restarted or rewritten. This
is better input to the reviewer, not proof that its judgement is always correct.

## Diagnostics

**Open captured AI request** goes directly to the relevant request. Diagnostic downloads
include the latest captured request/response, saved plan, validation failure and repair
history when available. A completed response rejected by Director no longer appears to
still be generating. Completed text is retained with the run so pruning the separate
recent-AI-request list cannot destroy the recovery copy.

Diagnostics exclude credentials and media bytes but contain creative prompts. Review before
sharing. No user projects, media, or private diagnostics are bundled with the app.

## Verification

Run `node scripts/check-all.mjs --integration`. The additional recovery script exercises
canonical binding, rejected-pixel protection, source/pin guards, cached-plan reuse after
21 saved windows, same-run repair, concurrent clicks, stale confirmations, unknown GPU
work, budgets, cache pruning and local scene context. The coverage browser suite exercises
the real controls in a portrait viewport.

Models/rendering and browser storage are fixtures. HTTP, server persistence, FFmpeg/FFprobe
and browser interaction are actual local tests; no live model inference is implied.
