# Render overview and measured boundaries — 1.2.4

## One place to watch the studio

**Render overview** is embedded in the main editor, beside the program-monitor workflow.
Use the toolbar's **Render overview** button (or **Full live overview**) for the expanded
view. It shows the whole server, not only whichever project is currently open:

- Actual renderer activity and native queue pause, separate from parked/cancelling films.
- Current project, window, native phase, observed H3 steps and saved-window count.
- Elapsed wall time since acceptance (including waiting and pauses), current-window
  elapsed time, H3 denoising time, typical measured step, and current-step elapsed time.
- Denoising, current-window, and whole-film remaining-time ranges when enough observations
  exist; an estimated finish-clock range, not a guaranteed deadline.
- Time since the last renderer callback, saved-window strip, errors and audited timing
  adjustments. Management/recovery actions are reachable without finding another status box.

A managed film and its current native subtask are one entry, not two renders. Unrelated
native jobs remain visible. The ordinary render monitor and an open sequence manager
receive the same snapshots. Loading/reference preparation and output archival are not
misrepresented as extra H3 denoising steps.

### Automatic refresh and disconnects

The browser requests a read-only, authenticated `/api/render-progress` snapshot about
**every two seconds during active rendering**, or every eight seconds when idle. Paired
devices share a short server cache and overlapping reads are coalesced. This avoids a
phone and desktop independently hammering each worker endpoint.

On focus, network reconnection, pageshow, or return from a hidden tab, it refreshes
immediately. Mobile browsers may suspend background tabs entirely; no web application
can guarantee live DOM updates in a suspended page. Neither the worker nor managed
sequence dispatch depends on the progress page being open, visible or polling.

Connection errors keep the last observations visible with a **stale/unavailable** label.
They do not announce an idle GPU or advance a step counter. Expired pairing is identified;
a Node-restart CSRF token can be refreshed automatically. If pairing expires, reopen
the studio home page to pair that device again. Refresh is read-only: it never resumes,
cancels, generates, clears a queue, or rewrites creative fields.

The previous monitor compared an object-valued backend descriptor to the string
`headless`, and also required the old adapter URL to match. Either condition could skip
polling a valid managed job. Both checks now use the correct ownership information;
headless connections are server-owned, not selected by an obsolete browser URL.

## What the ETA does and does not mean

Native telemetry remains authoritative for phases and completed steps. Managed tasks
only contain one new window, so copying that task's total ETA to the whole film was
incorrect; throwing it away forever was not useful either.

The coordinator now saves observed timing samples when each managed window completes.
It combines the current step/window observations with previous full-window costs for
remaining windows of roughly comparable generation span. Initial model-loading overhead
is not multiplied across every future window. Actual preparation and archival time are
part of the sampled window cost. Step-based remaining denoising provides a lower bound
for a current-window estimate that would otherwise be too optimistic.

A first timed window must be saved before the managed whole-film estimate can normally
appear. Existing attempts with no persisted samples need to learn from subsequent
windows; historical timing is not fabricated. Estimates use recent medians and broad
variation ranges, not calibrated confidence intervals. Reference changes, resolution,
offloading, competing GPU work, restarting loading, cumulative-prefix I/O and postprocessing
can change the cost. Windows outside the comparison range stay unestimated.

Paused/stopping sequences, stale connections, and overdue estimates suppress a finish
time instead of sitting at "0 seconds remaining" forever. Native queue pause is separate
from sequence pause; no new completion time is promised while dispatch is intentionally
paused. Wall time includes pauses; it is not GPU profiler time. The progress bar combines
saved-window count and observed current steps, **not a percent of wall-clock time**.

## The 760 / 763 frame error

A completed output with 760 frames at 24 fps is three frames (0.125 seconds) shorter
than a 763-frame plan. The previous coordinator required exact agreement and stopped.
The screenshot and code establish that strict check; they do not establish which
upstream processing stage produced the three-frame difference.

**New policy for newly completed managed outputs:** accept a difference of at most
**four decoded frames in either direction** at the existing 24-fps timing check, provided
there is positive new footage. Four frames is Director's conservative tolerance policy,
not an upstream promise that every mismatch must be that small.

Director counts decoded video frames with FFprobe, rejects probe/decoding errors, and
archives the actual source bytes. It does not pad, duplicate, cut, stretch or re-encode
the film, and does not insert silence or change its audio. It then:

1. Records expected/observed frame counts and the difference in the sequence log.
2. Uses the measured endpoint for this take's playback range.
3. Shifts subsequent source boundaries by that difference, keeping each future window's
   requested new-frame count and overlap unchanged.
4. Checks the archived prefix **exactly against that measured boundary** before the
   next submission. It does not keep tolerating a known-wrong prefix.

The creative project's requested timeline is unchanged. The submitted render plan and
its actual take ranges retain the adjustment, visible in **Render overview** and
**Sequences → Details / log**. A slight whole-film duration difference is expected and
shown; silently keeping incorrect playback boundaries is not acceptable.

More than four frames, wrong frame rate, missing output, a failed decode, or no new
frames still stops before another submission. Native output is preserved for inspection.
This guards against accepting a partial/wrong file as an entire completed window.
Each accepted adjustment is bounded per completed window; accumulated drift remains
visible, and this is not a guarantee of perfect cross-window audio/visual continuity.

## Recover a completed window from an older stopped attempt

Installing 1.2.4 does not automatically restart a cancelled film. For a matching headless
record that stopped on this small frame difference:

1. Open **Sequences** and find the attempt (use History if it was hidden).
2. Choose **Recover saved window…**. The native job must still be completed and its
   output available to the current backend. Expected/measured length appears in preview.
3. Confirm recovery into a **new parked sequence**. Director backs up the original
   checkpoint, reads and verifies the saved video, and maps its measured boundaries.
4. Inspect the recovered take. Choose **Resume sequence** on the new copy only when
   you actually want to generate remaining windows.

The original remains cancelled/finished; its outputs, IDs and submitted creative snapshot
are not overwritten. Recovery does not submit a GPU job, retry the saved window, cancel
anything or unpause the worker. A repeated identical confirmation finds the same recovered
copy instead of creating duplicates. If the recovered window is the last one, the copy
is completed, not parked.

**The recovered sequence uses the original submission's prompts and references**, not
newer edits made in the editor. This is deliberate: recovery must not silently mix two
versions of a film. For newly edited prompts, prepare a deliberate new take/submission.
If a noncancelled attempt is merely paused, **Reconcile state** can collect the completed
window under the new bounded policy; resuming remains explicit.

An unavailable/deleted native file, different backend, or larger mismatch cannot be fixed
by this action. It never relabels legacy plugin jobs as headless jobs.

## Install without restarting the renderer

Export a project backup and let any AI-planning request finish. Stop only the old
**Director Node server**, extract this release into a fresh folder, then run:

```sh
node start-headless.mjs
```

Preserve `H3_DATA_DIR`, `H3_VOICE_PYTHON`, other custom settings, browser profile and exact
studio URL. The bridge reports **1.2.4**. Headless worker **1.2.0** and optional plugin
**1.0.5** are unchanged. Keep the old folder while a detached worker launched from it
is still running. No new token or speech dependencies are required.

An accepted native render can finish through the Node restart. A managed sequence may
need **Reconcile state**, then **Resume sequence**, after reconnecting; no cancelled
sequence resumes automatically. For services, update/restart `h3-director.service`
only, not `h3-wangp.service`. Never run two Node coordinators on the same data directory.

## Local verification

See `VALIDATION-1.2.4.md`. The progress tests use live local HTTP, actual temporary files,
a real 760-frame MP4/FFprobe check, and Chromium UI interactions. WanGP/provider events
are modeled; no live H3 inference, hardware-calibrated ETA or Tailscale connection was
verified. The app has no telemetry service and does not send these diagnostics elsewhere.
