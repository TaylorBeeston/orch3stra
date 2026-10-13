> **1.9.0:** Use **Render windows…**, **Render from here…** or **Continue unfinished…**
> for the new selection/recovery workflow. See **RENDER-SELECTION.md**. The older inline
> regeneration form and advanced Send-all route remain available.

> **1.7.0 addition:** ordinary layered finishing now lives in **Post room**. Read POST.md
> for music/SFX, image overlays, fades, speed, and independent corrective cuts/mutes. The
> generation editor described below still plans H3 and exports its unmodified cut; its old
> single-track limitations no longer describe the separate Post workspace. No automatic
> regeneration or two-way synchronization is performed between these two timelines.

# Editing and finishing — Orch3stra 1.3.0

Director uses WanGP for H3 generation and late video upscaling. This is an independent
local app, not an official MiniMax or WanGP product. Editing is a single-track cut
workflow over your existing takes; it is not a full multitrack compositor.

## Two clocks: the generation plan and the edited film

The **Story timeline**, amber playhead, Program Monitor and final export now share the
**edited-film clock**. A ready clip occupies its selected take's actual retained length,
minus your In/Out trims. Missing/unrendered windows occupy their planned duration and
are visibly not ready. Subsequent clips ripple when you trim, split, insert or reorder.

The inspector's **Requested frames / Overlap** still describes a future H3 generation.
Trimming existing footage does not change those settings, stretch the video, or quietly
request more inference. Render plans and original source ranges remain immutable.
An old three-frame-short take therefore has its actual length in the edit, even when
its planned generation duration was three frames longer.

The generic project **Export** button still exports project data. **Export film MP4**
in the editing toolbar creates a playable final movie. Missing footage blocks final
export; the app never silently omits an unrendered insert.

## Scrubbing, playback and selecting takes

- Click or drag the timeline ruler, or drag the amber playhead handle. The monitor
  seeks to the matching selected source range, even across cumulative output files.
- With the playhead handle focused, Left/Right moves one frame; Shift moves 24 frames.
  Space plays/pauses outside text inputs and dialogs. The numeric Playhead field is
  an absolute frame in the edited film (24 frames = one second).
- Playback advances the playhead. Ordinary progress refreshes no longer reload the
  same source or pause video. Missing footage stops sequential review rather than
  presenting an unrelated take.
- Click a clip or its rendered thumbnail to select it. Use **Selected take** below
  the timeline to switch alternatives. Selecting a different take resets only that
  clip's old trim; it does not copy offsets onto an unrelated new source.

Browser sequential preview switches source ranges/files and may pause briefly at
boundaries. It is not a gapless master export. Native video controls also show the
underlying source movie's time; use the amber timeline and the Program Monitor's edit
clock for the assembled-film position.

## Trim or split existing footage without regenerating

Select a finished clip and choose **Trim / split footage**. In/Out values and sliders
are frame offsets within that take; Out is exclusive. You can set them from the
playhead, then **Apply trim**. Dragging a rendered clip's right edge trims its Out
point directly. An unrendered clip's right edge still changes planned generation time.
The hatched overlap handle is a separate generation control, not a video crossfade.

**Split footage at playhead** creates two adjacent non-overlapping source ranges.
It does not run H3. Both halves retain their existing file, and later clips keep their
original source offsets. The old planning Split control remains for unrendered prompts.

**Reset to full source** exposes the full original range. On a split alias this can
reintroduce material also used by its neighboring half; the app explicitly asks first.
Undo/redo covers trim, split, selected-take changes and insertion. There are no speed
ramps, freeze-frame extensions, transitions, track mixing or separate audio edits here.
To make new action last longer, change its generation plan or insert new shots instead
of dragging beyond the end of a source that does not contain more frames.

## Insert B-roll in the middle

1. Select a boundary clip and choose **+ Before** or **+ After / AI B-roll**.
2. Confirm the anchor and side. Choose 1–6 new windows and seconds per window.
   Durations are H3-grid aligned; a single window cannot exceed your selected ceiling.
3. **Insert blank windows** for manual writing, or enter a direction such as:
   “Two quiet B-roll shots of empty bowling lanes and a ball return, after Caller
   arrives but before Listener arrives. No speech and no new characters.”
4. **Draft inserts with AI** uses the current planner connection. It receives the
   neighboring scenes, story outline, subject cards and reference metadata. It does
   not upload raw recordings/images/video for this operation. Source metadata can
   include creative descriptions/transcripts, just as normal planning does.
5. Review/edit the new titles, descriptions and soundscapes; **Apply these inserts**
   inserts only the new IDs as one undoable edit. It does not generate video.

You select the anchor; this is not an autonomous agent choosing an arbitrary edit
region. The AI cannot rewrite existing windows, dialogue, timings, IDs or source
inventory. It can propose references from the existing library for the new shots.
Review **Cast & speech** and the reference pool before rendering. Default inserts are
hard cuts, suitable for B-roll and changes of place/time. A stale proposal cannot be
applied after the project changes. Planner request history retains the request/response;
the inline proposal itself is not a durable conversational agent session.

To render two inserted hard-cut shots without rerendering the rest, select the first,
choose **Regenerate selected → A specific number of windows → 2**. You can also render
one at a time. Existing later takes stay selected until you deliberately replace them.

## Regenerate without nested setup dialogs

**Regenerate selected** opens one inline form using your current prompts, cast,
references, model, and planned generation durations. Options:

- Only this window;
- A specific number of windows, beginning here;
- Through this linked shot, stopping before the next zero-overlap boundary;
- Through the end.

**Fresh start** removes the first overlap and makes a new independent opening.
**Continue from the current edited prefix** first assembles the selected preceding
footage (including edits), at the project's generation resolution, then imports that
verified movie as context. This is a CPU export, not an H3 regeneration of the prefix.
The next task uses its exact frame count. At zero overlap the prefix is retained but
the new shot starts without visual overlap conditioning.

Missing preceding footage disables edited-prefix continuation. Changing the project
while the prefix is being prepared stops before GPU submission. The assembled prefix
remains in Finishing and is not silently discarded. Submission always requires explicit
confirmation. Follow the existing live Render overview after acceptance.

For a managed project, the selected range now runs as a managed branch with its own
per-window pools, rather than forcing you to restart at window 1. An old following take
can disagree with a newly rendered ending. Use a longer range when repairing that
continuity, or accept the hard cut. The original takes and original later footage are
not overwritten; choose the replacement in **Selected take** after it completes.

## What managed overlap means

Director archives each finished cumulative movie and verifies its decoded frame count.
For the next task it provides the existing prefix as a source, its retained frame count,
a new prompt and that window's selected reference pool. H3 conditions continuation on
the tail selected by the overlap setting; it is not jointly regenerating the entire
previous film from scratch and does not have unlimited story memory.

At 24 fps, 18 overlap frames are 0.75 seconds of existing audiovisual context. A valid
example is 225 new retained frames + 18 overlap frames = a 243-frame scheduled span:
9.375 seconds added, not 10.125 seconds added. The compiler shows effective snapped
counts, reserves the overlap anchor's Picture 1 and remaps the ordinary source pictures.
Native span/overlap snapping and measured output tolerances still apply.

More context can help continuation of motion, camera and physical state, but it costs
work and can also carry a voice, gesture or composition you wanted to change. New voice
reference selection does not erase audio already in that tail. Zero overlap is a hard
cut. It is often more appropriate for B-roll, location changes or a time jump. Neither
H3 overlap nor its zero-overlap setting is an editor dissolve/crossfade.

Upstream prompt/handler sources are linked from the in-app Field guide. The editor's +/-4 decoded-frame
completed-output policy remains a Director recovery policy, not an upstream guarantee.

## Export the final movie

Click **Export film MP4**, choose **Export MP4 only**, and start. The server takes one
range per edited clip, in timeline order. It does not concatenate entire cumulative
prefix movies repeatedly. You can choose a canvas or match the first source; different
aspect ratios are letterboxed, not stretched.

Exports use FFmpeg, H.264 CRF 18 and AAC 192 kb/s at 24 fps. This is an encode, not a
lossless stream-copy of all source material. Each selected video's audio is trimmed
with its picture. Clips with no audio receive silence only as needed for consistent
assembly; dialogue, music and sound effects are not regenerated. Source media is never
modified. There are no automatic audio fades or crossfades between edited clips.

**Finishing → Download MP4** serves the final file directly through your paired studio.
It also offers full-film playback and the recorded edit list. Downloads use authenticated
byte-range serving, not a huge base64 object in localStorage. Files and jobs persist at:

```
$H3_DATA_DIR/finishing/finish_<id>.json
$H3_DATA_DIR/finishing/finish_<id>/film.mp4
```

The default H3_DATA_DIR is ~/.local/share/h3-director. The folder also retains an edited
base and supporting files for recovery. Outputs can consume substantial disk space;
there is no automatic destructive cleanup. Export records contain source IDs and ranges,
not a copy of every library image or voice recording. Back up the server data as well as
project JSON when preserving edited-film sources across machines.

## Upscale a finished window or the whole edited film

For one window, select it and click **Upscale selected**. This uses the currently selected,
possibly trimmed range. For the whole film, choose an upscaler in **Export film MP4**.
FlashVSR 2×/4× and conventional Lanczos 2×/4× are exposed. Canvas selection is BEFORE the
2×/4× multiplier. Start conservatively: 1920x1080 followed by 4× means 7680x4320, not 1080p.

The server first makes the edited base, then submits narrow `edit_postprocessing` tasks
to the same headless worker/queue. No H3 prompt or model inference settings are sent in
those tasks. A ready current WanGP API and installed/configured upscaler are required.
The worker does not create a second GPU runtime. These tasks still consume compute and
may load/download model components through WanGP's normal behavior.

Default long-film mode uses 240 retained frames (10 seconds) per upscale piece with up
to 12 extra source frames at each side. After processing, those handles are discarded
and the retained ranges are assembled exactly once. These are separate finishing handles,
NOT the H3 overlap slider. Separate tasks do not transfer FlashVSR's internal recurrent
cache, so seams/temporal variation remain possible. There is no promise of perfect seam
consistency or bounded VRAM at every resolution. Chunking reduces each submitted temporal
range; the full uploaded base, spatial tensors and saved files still need RAM/disk/VRAM.

Whole-file mode is capped at 3,000 frames. The base-video upload is capped at 2 GiB;
source downloads are capped at 8 GiB each. Frame rate and decoded count must remain
exact during finishing. An upscaler changing frame count or dimensions stops with an
error and keeps the original base, rather than silently changing timing.

The final upscale uses the **edited base's audio packets**, not audio emitted by the
upscale pieces. The upscale itself therefore does not regenerate/re-time your voices.
The resulting picture is encoded during piece assembly, so this is not lossless video
processing. **Use finished take(s) in timeline** explicitly selects the finished ranges
for existing window IDs; it does not rewrite prompts. Old takes stay available.

## Finishing jobs, interruption and queue sharing

Finishing polls every two seconds while active/open and reports status through the
activity stack. Reopen **Finishing** after a browser refresh to see server history.
A hidden browser has no role in dispatch. Node must remain running for CPU assembly and
for submitting subsequent upscale pieces. An already accepted GPU piece can finish
independently if Node stops.

After Node restarts, jobs are **Paused** until explicit Resume; accepted native jobs are
looked up, never automatically duplicated. **Check acceptance** resolves a lost submission
response by its original request ID. Unknown acceptance is not an empty queue. Cancel
keeps checking the owned native job before releasing the reservation. Cancelling a CPU
operation terminates that FFmpeg child, not WanGP or the whole machine's FFmpeg processes.

A managed sequence and a finishing upscale cannot hold the Director renderer reservation
at once. Park a managed sequence after its active window, or finish it, before starting
late upscaling. Ordinary CPU MP4 export does not need the GPU, but it still consumes CPU,
RAM and disk bandwidth. Queued native jobs submitted by another app remain authoritative.
The headless worker remains the single serialized model executor.

## Upgrade from 1.2.4

### Editor/export now, leave an active worker alone

Keep H3_DATA_DIR, your exact browser URL/profile, and H3_VOICE_PYTHON settings. Export a
portable project backup and preserve finished movies. Stop only the old Director Node
process, then run from the new release folder:

```sh
node start-headless.mjs
```

The launcher can reuse worker **1.2.0** for ordinary generation, editing, prefix imports,
and MP4 export. It prints a compatibility note. Keep its old release folder while that
worker is running. A managed sequence may need reconciliation/resume after Node returns.

### Enable late upscaling (idle worker upgrade)

Let all native work finish/cancel, park managed dispatch, and let AI requests finish.
Stop the old Node coordinator so it cannot enqueue another window during the switch.
From the NEW 1.3.0 folder, preserving the same environment:

```sh
node start-headless.mjs --stop
node start-headless.mjs
```

`--stop` refuses an active render and waits for process exit; it does not force-kill a
busy renderer. Queued work is retained and comes back paused. Check **WanGP server**
for **worker 1.3.0**, ready state, and the correct checkout. Tokens, job history and
archived outputs remain in the same data directory. No plugin replacement is needed;
the legacy 1.0.5 plugin stays unused in headless mode. No package install or Git update
is performed automatically.

For systemd: after everything is idle, stop h3-director.service, then h3-wangp.service.
From the new stable directory regenerate user units with
`node scripts/install-services.mjs --install`, run `systemctl --user daemon-reload`,
then start h3-wangp.service and h3-director.service. Preserve custom service.env settings
and avoid a manually launched duplicate worker. See HEADLESS.md for service details.

## Testing and limits

Run `node scripts/check-all.mjs --integration` for the complete local suite; Chromium,
Playwright and Gradio are optional test dependencies, not new production dependencies.
Finishing uses real FFmpeg/FFprobe in tests. Native upscale inference is simulated.
The browser tests use a real synthetic MP4 with stubbed provider/renderer endpoints.
No live H3/FlashVSR render or DeepSeek call on the target machine is implied by those tests.
