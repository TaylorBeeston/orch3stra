# Reference allowances and progress checkpoints — 2.2.1

## Continue without cancelling

Open **References → Fill missing coverage** and choose the existing stopped run.
The allowance card shows attempts in the current window and image/AI totals across
its run (or shared sequence/draft group). All attempted images in the window count:
Jerry's variants, George's variants, and rejected retries. Acceptance is not a refund.

At the window limit, **Allow 20 here & continue** explicitly raises the current
window's total allowance to 20 and continues its saved step. It retains IDs, spent
usage, previous manifests, accepted pictures and pending generation requests. No
completed window or saved planner response is restarted. When a candidate is waiting
for a decision, the same grant stays parked in candidate review: choose Accept,
Reject and pause, or Reject & retry. Raising a budget is never an image approval.

The ordinary **Image attempts per window (1–20)** control is now alongside the overall
image/AI budget controls, not hidden in Advanced. Use **Save permissions & continue**
to update a parked standalone run's normal per-window allowance. The default remains
2; previous permissions (including 4) stay unchanged until you authorize an increase.
Existing separately authorized extra attempts remain cumulative. The current-window
shortcut covers the total, not an additional 20. Manual one-off extra grants still
work beyond a configured allowance, within their separate safety cap.

The overall image, AI-request and time allowances remain independent. A run-wide
limit is identified on the card. Increase it explicitly through run settings; Resume
alone cannot override it. Grouped/managed runs share their parent budgets; the shortcut
can increase a safely parked current window but cannot expand the parent totals or
revive a cancelled parent. Queue pause/unreachable/unknown submission checks remain.

Node restart preserves these allowances and counted attempts. Offline time no longer
accumulates as active reference-preparation time. An unknown request is reconciled,
not submitted twice. The upload-filename repair and image family support from 2.2.0
are unchanged.

## Save before finishing — or after cancellation

The **Keep what is ready** card is available on a safely parked or terminal run.
While an action is still running, pause at a boundary first. Cancelling is NOT needed.
Saving does not issue AI/GPU calls, cancel the run, release its renderer lease, declare
its incomplete windows ready, or change automatic final-application status.

### Save progress as a project copy…

This creates a separate local project named `… · reference progress`, leaving the
original project open and the original reference run where it was. It retains:

- the full original project and its history, takes, dialogue and Post edits;
- all newly approved images (including images approved in the unfinished window);
- approved reference-bank annotations/variants;
- prepared input selections for completed windows only.

Incomplete windows keep their original input selections. They are listed separately
in `referenceProgressHistory`, not marked complete in `referencePreparationHistory`.
The run's complete intermediate state and accepted checks stay in its server record
and checkpoint, including data not yet applied to incomplete windows.

The save checks that the current project's source revision still matches the run.
It does not overwrite newer edits. If it does not match, download the progress pack
instead, or open the unchanged original source project. Repeat saves of the same
checkpoint do not overwrite an independently edited progress copy. The copy appears
in **Projects**; publish it through Shared Studio to sync to another browser/device.

**Download this project (portable)** embeds original project media plus approved new
reference images using the ordinary portable `.h3project` format. It requires those
original blobs to still be available in the browser. It stores recorded render metadata,
not the full generated movies; preserve your finished movie files separately.

### Download progress + approved images

Works even when the live project has changed. Downloading the pack is read-only and
does not replace any reattached/edited local image with the same ID. The ZIP contains `checkpoint.json`,
all *new approved* candidate images from this run under `approved/`, and a README.
The JSON retains original names, source IDs, provenance, prepared-project metadata,
completed/remaining window IDs and allowances. Rejected and unreviewed candidates
are not included as approved images. Their history remains in the original run.

This is an emergency reference pack, **not a complete portable movie/project backup**:
original library pictures, audio and movie files are not in it. Keep the original
project/media. A new run is not automatically started by downloading or importing files.

## Persistence / cancellation distinction

Accepted images are archived to the private immutable blob store; the reference run
is checkpointed under `$H3_DATA_DIR/reference-agent/<run-id>.json`. Cancellation stops
future work/cooperatively cancels accepted auxiliary work; it does not delete those
archives. Previously, final application was only available after the entire pass
completed, making retained work hard to use. The new partial-copy/download controls
also remain available on cancelled or failed runs.

Explicit progress checkpoints live in
`$H3_DATA_DIR/reference-agent/checkpoints/checkpoint_<hash>.json`.
Each verifies that its accepted media bytes still exist in the owned blob store.
The check does not pretend a missing/deleted image has been backed up. Checkpoint
creation does not need a working GPU connection, but the Director server/data store
must be accessible. Copy/ZIP downloads retrieve the actual archived image bytes.

## Installing this update

Stop only the Director Node process (after active AI work finishes/parks), extract
2.2.1 into a fresh folder and run `node start-headless.mjs`. Preserve H3_DATA_DIR and
the exact browser origin/profile. **Do not use --stop for this update.** Keep the
existing 2.2.0 GPU worker running and keep its release folder while it uses that code.
For services restart `h3-director.service` only. No dependencies, plugin updates,
tokens or project migration are required. Bridge 2.2.1 / worker 2.2.0 is expected.

## Tests

`node scripts/check-reference-progress.mjs` covers policy bounds, distinct-reference
exhaustion, same-run continuation, rejected candidates, aggregate limits, stale/racing
requests, saved progress, cancelled-run salvage and restart persistence with real
local HTTP/files/media and fixture AI/GPU responses.

`python3 tests/browser_reference_progress_check.py` exercises the actual client merge,
project-copy/portable/ZIP downloads, source-byte preservation, repeat-save safety,
20-attempt controls and phone layouts. Browser storage/transports are fixtures; this
is not a live provider/GPU or physical-phone test.
