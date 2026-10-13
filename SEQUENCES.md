# Managed sequence manager — 1.2.3

## 1.2.3: resolve old-backend records without losing videos

A checkpoint from the legacy plugin cannot be cancelled or reconciled through the
headless worker. 1.2.2 correctly refused the wrong backend, but kept the record blocking
forever and offered an ineffective Reconcile button. It also displayed `phase` as though
it were another live status, causing contradictory "Cancelling" / "cancelled" labels.

**Sequences now displays both Record backend and Director backend.** Untagged records
are identified as older pre-headless/legacy checkpoints; they are not silently adopted
by the worker. If Director says **Legacy browser plugin** when you intended headless,
stop only Node and launch `node start-headless.mjs` with the same H3_DATA_DIR first.
Do not retire a headless run just because you used the wrong launch command.

For an abandoned record from the other backend, choose **Retire old-backend record…**.
Confirm that the old renderer is stopped or has finished this job, and that it will not
run against the same GPU concurrently. This explicitly ends **local tracking**, not
renderer execution. It backs up the checkpoint, preserves its native IDs, media, plan,
and output pointers, and moves the record to History with status **Retired locally**.
No worker request, cancellation, queue resume, model submission, process kill, or video
deletion is made by this action. The current renderer queue still independently gates
new dispatch. To manage an actual running old job, return to its original backend.

Retired tracking cannot be resumed in the UI. **Restore to list** only changes visibility.
Backups live in `sequence-backups/`; archived MP4s stay in `renders/`. Opening another
backend later does not revive retired work. Do not manually relabel an old job as
headless: native job IDs and uploads belong to their original renderer.

The manager no longer polls foreign checkpoints for cancellation or rewrites their
state on startup. Same-backend cancellation and verified-idle cleanup are unchanged.

Upgrade the Node/editor only. Worker 1.2.0 and plugin 1.0.5 are unchanged; no new token.
Let AI requests finish before restarting Node, preserve H3_DATA_DIR, and keep old release
folders while a detached worker launched from them is still running. Do not run two
Director Node coordinators against one data directory. See SEQUENCES.md for details.

Open **Sequences** in the main header. The same manager opens from Shared studio →
Manage sequences and the managed render monitor. It lists server records across all
projects, not just the project loaded on this device.

This release changes only the Director editor and Node coordinator. The Python
renderer remains 1.2.0 and the optional legacy plugin remains 1.0.5. Their files are
unchanged. Neither needs restarting for this upgrade.

## Recover the current stuck records

1. Open **Sequences**, then **Refresh state**. The header separately reports the
   renderer, managed sequences, and readiness for a new submission.
2. An old `cancelling` record (including one previously saved as `paused` with
   `cancelRequested=true`) is checked by Director in the background. It settles when
   the matching native job is confirmed finished/stopped. No browser focus is required.
3. A paused film you want to keep can remain **Parked**. Once the renderer is checked
   and the film has no active/unknown job or coordinator operation, it does not reserve
   the renderer or prevent starting another managed film.
4. To abandon leftover attempts, use **End all safely idle…**. Review the names and
   IDs, then confirm. Records with uncertain acceptance, an active operation, a busy
   renderer, wrong backend, or an unreachable worker are not force-cleared.
5. If the top panel says the **WanGP queue is paused**, choose **Unpause WanGP queue**
   separately. Existing queued native jobs may start. Parked managed films do not resume.

No workflow here deletes projects, source media, or saved videos. A new private record
backup is made before safe cleanup or a history change. A cancelled sequence cannot be
resumed; render an intentional new take instead. Hiding a record in History only changes
its list visibility, not whether it is cancelled.

## Three different kinds of state

| State | Meaning | Appropriate control |
|---|---|---|
| Sequence running | Director may prepare/submit its next window | Pause after window, or Cancel sequence |
| Pause requested | Save the already accepted window, then park; if still preparing references, stop before GPU submission | Wait for Parked |
| Sequence parked | Saved for later; may still be tracking a previously accepted native job | Inspect WanGP state; Resume explicitly when ready |
| Sequence cancelling | Cancellation intent is sticky and monitored by Node | Reconcile state / inspect log; never Resume |
| Acceptance unknown | A submit response was lost; absence from a queue is not proof of non-acceptance | Reconcile by request ID; do not blindly rerender |
| Finished / cancelled / failed | No future windows will submit from this record | Reconnect renders, Details, or Move to history |
| WanGP queue paused | Global native dispatch is paused, independently of each managed sequence | Unpause WanGP queue after checking queued jobs |
| Renderer unavailable | State cannot be verified | Fix connectivity/start the worker; no forced idle assumption |

The manager displays the persisted Director phase AND a fresh native job observation.
It also reports why a record blocks dispatch. An idle queue is not the same thing as a
running queue, and a parked film is not the same thing as a renderer currently processing
that film's last accepted task.

## Controls

**Refresh state** reads records, queue, and matching native jobs. It does not dispatch,
retry or cancel work. An already requested cancellation can independently progress in
Director's background loop, so its displayed state may change during a refresh.

**Reconcile state** explicitly checks an existing job. It may find a lost accepted
request, collect/verify a completed output, or finalize a stopped job. It NEVER submits
a successor. A normal paused sequence remains parked after reconciliation. An active
coordinator already tracking the sequence is left alone rather than creating a second
loop. An uncertain submit can only attach the corresponding request's actual native ID.

**Resume sequence** can submit remaining windows and therefore asks for confirmation.
It checks other managed records and the native queue first. A parked sequence cannot
silently acquire the renderer while another is running/cancelling/uncertain. Only one
coordinator can own a sequence at a time. Cancellation is not reversible by Resume.

**Cancel sequence** saves cancellation intent first, requests cooperative native
cancellation, and keeps checking until that task ends. It also works from the original
Render monitor: managed `seq_` IDs are no longer sent to native `/jobs/<id>/cancel`.
Native render jobs still use the native cancel endpoint.

**End idle sequence… / End all safely idle…** is the safe recovery/abandon workflow.
Preview is read-only. Confirmation rechecks state, backs up each eligible record, then
ends it. It never kills a process, forces a GPU job terminal, resumes a queue, or removes
video files. The selected IDs are rechecked individually; partial results are shown when
another device or the renderer changes state between preview and confirmation.

**Move to history / Restore to list** is terminal-record visibility only. No delete API
is provided. History keeps plans, output pointers, and diagnostics.

**Reconnect renders** attaches the server record to the current project when its ID
matches, without replacing editable prompts/casting/timing. Open the matching project
first for another film. **Details / log** shows state, native ID, recent control/recovery
events and the latest observation. **Download diagnostic** includes creative material;
review it before sharing. Credentials are omitted.

## What is fixed internally

- Old cancellation code could turn a pending cancellation into `paused` and stop polling.
  Sticky cancellation now has its own durable lifecycle and server-side checker.
- Startup preserves cancellation intent rather than treating every nonterminal record
  as an ordinary pause. Normal generation is never auto-resumed on restart.
- Cancellation during reference preparation prevents a later submit. Cancellation while
  an HTTP submit is already in flight attaches its accepted ID and cancels that actual
  task; it does not forget the acceptance or send the next window.
- State writes are serialized per record so a late progress save cannot overwrite a
  newly persisted cancellation. Dispatch/resume/cleanup decisions share a separate lock.
- Concurrent start/resume commands from two devices do not create two managed dispatchers.
- If a completed result races cancellation, Director attempts to keep a verified copy.
  If mapping/archiving fails, it preserves the native job ID and tells you the native
  result remains in WanGP instead of trapping cancellation forever or deleting a video.
- Managed render polling no longer depends on an obsolete browser-side adapter URL in
  headless mode. The server's fixed local worker connection remains authoritative.

## Files and persistence

Under the SAME `H3_DATA_DIR` used before (default `~/.local/share/h3-director`):

```
runs/                 existing managed checkpoints, with bounded control events
sequence-backups/     private JSON copies before explicit cleanup/history changes
renders/              existing managed verified MP4s (not deleted by this manager)
headless/             existing Python SQLite queue, output archive, and static secret
```

Events are kept to the latest 150 per sequence; the UI displays the latest 30 on cards
and the record's full retained events in Details. Older records cannot supply events
that were never recorded. Backups/history have no automatic garbage collection.

## Installation

Export a project backup. Stop/restart only the Director Node server with the new release
while keeping `H3_DATA_DIR`, your exact browser origin, and environment settings intact.
Do not delete old release folders while a detached worker launched from one is running.
Let AI drafts finish before the Node restart; unfinished AI calls are interrupted.

```
node start-headless.mjs
```

This reconnects to the unchanged worker. No new WanGP token is needed. Normal sequences
are parked on Node restart; existing cancellation intent is reconciled automatically.
If the earlier recovery command launched Director in the background, stop that Node
instance first rather than launching a duplicate on port 8765. It logged to
`$H3_DATA_DIR/director-recovery.log`. Do not stop the detached Python renderer merely to
upgrade the editor.

For systemd, update only the Director user service to the new release path and restart
`h3-director.service`; leave `h3-wangp.service` running. Do not run two Node coordinators
against the same data directory. The same-origin pairing and static worker-token setup
from 1.2.0 are unchanged.

## Limits

There is deliberately no unconditional “force cancelled” that hides a task the renderer
may still be running. Unknown acceptance or a nonresponsive worker requires diagnosis.
The manager verifies what the worker reports, not physical GPU activity independently.
Lost unacknowledged submissions remain uncertain even if an instantaneous queue lookup
is empty: remote request validation may not have committed acceptance yet.

Node must run to coordinate the next managed window and to reconcile cancellation.
The detached renderer itself still owns accepted work when Node is stopped. A Python
crash does not have a diffusion-checkpoint resume here. These changes do not add full
collaborative editing, automatic retransmission, or automatic media cleanup.

The full local suite uses simulated SDK/model responses. No live
H3/GPU render was performed for this patch.

## Retired checkpoint schema (1.2.3)

`status: "retired"` is terminal for Director tracking, **not a native job status**.
The coordinator stores `retirement.previousStatus`, `previousPhase`, `previousError`,
`previousMessage`, recorded/current backends, native job ID, user acknowledgment,
and `rendererCancellationVerified: false`. It does not erase `activeJobId`, outputs,
submissions, project metadata or the original backend marker. Untagged old records remain
untagged; the UI explicitly labels the legacy inference. No automatic adoption is done.

`retire-preview` is read-only. `retire` requires explicit acknowledgment and the preview's
record revision and both backend identities, under the sequence-start lock. It refuses
same-backend records, in-flight local operations and stale confirmations. Duplicate
retirement is idempotent. Save failure leaves the live record unchanged. Normal pairing
and CSRF requirements apply. A hidden-history record can still serve archived outputs.

Older Director releases do not recognize the new retired status. Keep the new Node
release when using this recovery; do not roll back Node against modified checkpoint
records without deliberately restoring the backed-up records and understanding their
backend. The Python worker is unaffected and remains compatible at 1.2.0.


## Saved-output recovery and live overview (1.2.4)

Render overview now automatically observes all current sequences and native work. Its
expanded view links back to the controls here. Polling never resumes generation.

For a stopped attempt with a completed but uncollected video, **Recover saved window…**
can verify a small (+/-4 frames at 24 fps) output mismatch and create a NEW parked copy.
The original remains cancelled/finished; saved outputs and source metadata are preserved.
Preview/confirmation is required. No GPU job is submitted until explicit Resume on that
copy. The recovered copy uses the original submitted prompts, not later editor edits.

For ordinary newly completed windows, the same bounded policy automatically records
actual playback boundaries and shifts later prefix starts before proceeding. It does
not modify footage or silence and does not ignore large/corrupt/wrong-rate outputs.
Exact verification still applies to a known archived prefix before it is reused.

See docs/USAGE.md (Small frame-count differences) for the full workflow, including recovery
from the 760/763-frame case and limits when the native file was deleted or belongs to another backend.
