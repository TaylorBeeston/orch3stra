# Render part of the film — Orch3stra 1.9.0

## After a renderer crash

1. Start the headless worker normally if it is down. Opening the editor cannot recover
   half-finished diffusion. Check **WanGP server** and **Sequences** for worker health.
2. Open the original project. Click **Continue unfinished…** above the timeline. This
   first reads this project's server-side sequence records, reattaches their saved outputs
   without changing the script/selected-take choices, and selects the first missing window
   through the end. Nothing is rendered just by opening this view.
3. Inspect the checked windows. **Starting context → Keep and continue the existing edited
   prefix** uses selected footage/trims before the range. Earlier windows are not H3 jobs.
   **Fresh start** deliberately omits preceding video/audio context and sets the first
   boundary to a cut. It does not delete earlier footage from the editor.
4. Click **Render selected windows** and confirm the scope. A linked managed range retains
   per-window reference pools and its reference-agent permission checkpoint.

If an old cancellation or uncertain submission is still holding the renderer, the panel
shows that. **Check completed job without rendering** reconciles its existing native ID.
**End this safely stopped attempt…** is available only when the sequence manager verifies
it is idle; preview and confirmation preserve the outputs. Unpause a paused native queue
separately in Sequences. No force-clear or blind duplicate submission is performed.

## Selecting a range or a few windows

- Select a timeline window and use **Render from here…** for that window through the end.
- Use **Render windows…** (top bar) or **Choose windows…** for a searchable checkbox list.
- Use From / Through then **Select this range** for a consecutive range.
- Use **Select on timeline** to show selection buttons on clips. Shift-click a selection
  button extends the marked range on desktop. A normal window click still selects it for
  editing/scrubbing; it does not submit work.
- **Only missing windows** checks windows without usable selected footage. When gaps are
  present, choose **Independent shots** or explicitly include the gaps for linked output.

**Linked continuation** requires a contiguous selection. There is one preceding context
and each successor continues the newly generated result. **Independent shots** can select
arbitrary windows; each starts without overlap. They do not pretend that skipped windows
are in a new continuous generation or invoke before-managed-render reference checkpoints.
The submission says exactly which windows will be generated; unchecked windows stay out.

## Source context and timing

Prefix preparation uses Finishing's existing, verified edit-list export: only the selected
source ranges, without duplicate cumulative prefixes or Post effects. It can consume CPU,
disk and time, but submits no H3 task. The source is registered with the worker and its
actual frame count supplies the continuation boundary. The original videos stay intact.
Cancel preparation to stop its own finishing operation. Once accepted by WanGP, manage
cancellation from Sequences/WanGP server, not by closing the dialog.

A missing source range does not trigger regenerating earlier material behind your back.
Choose another saved take, import the matching finished film, render the missing range,
or deliberately use Fresh start. A changed project while context is prepared aborts the
new submission; the prepared prefix is retained in Finishing for inspection.

Alternate takes are not automatic creative replacements. Existing selected footage stays
selected; choose the new take in the editor when replacing an already finished window.
Originally missing windows gain playable ranges as their new output arrives. Export the
final current edit as usual. Post decisions and historical prompts are not rewritten.

This release does not recover an in-progress diffusion state and cannot force a crashed
worker to run. It makes the known-good footage and remaining task scope accessible without
restarting the entire film.
