# Post room — ordinary editing without another generation

Version 1.7.0. This release includes all 1.6.0 scene/reference-agent features.
Only the Node server and editor change. The headless Python worker and legacy plugin
are byte-identical to 1.6.0. Do not stop or replace a renderer in the middle of a film.

## Two timelines, deliberately

The Director timeline plans H3 and chooses generated takes. **Post** takes an explicit
snapshot of those chosen, trimmed ranges. It has its own picture edit, soundtrack and
image overlays. A Post change never modifies H3 prompts, casting, generation overlap,
reference pools, existing sequence snapshots, source videos or old renders.

Click **Post** in the toolbar (also in the Film desk stages), then **Start from current
edited film**. Every included window must have accessible finished footage. To experiment
without waiting for the whole film, choose **Start from selected take only** instead.
Missing footage is an error, not a skipped clip. A newly imported old film needs to be
mapped to its matching generation timeline using the existing import-render workflow.

There is one current Post cut per project. Duplicate the project to keep multiple Post
versions. Starting again asks for confirmation and resets the cut/cues, not the imported
files. It is undoable. Later changes to the Director edit raise a source-changed notice;
they do not quietly move the Post cut under a completed export. Press **Back to director**
to return. The old **Export generation cut** action exports the H3 edit without Post effects;
use **Export Post MP4** for this workspace.

## Music, sound effects and a logo

1. Upload your own permitted audio or PNG/JPEG/WebP with **+ Music / sound / logo**.
   No theme recording or third-party logo is bundled or downloaded automatically.
2. Put the playhead at the cue's intended start, then add the imported file to the cut.
3. Drag the cue horizontally to move it; drag its right edge to set its duration. The
   inspector also provides exact film start, duration and fades in seconds (snapped to
   the 24-fps edit grid).
4. For audio, **Recording In** selects where to start in the recording. **Loop recording**
   repeats from that point to its end; a non-looped cue may not exceed available audio.
   Set level in dB and fade in/out. The default cue level is quieter than full scale.
5. **Original audio under cue** optionally lowers the original movie while that cue is
   present. -60 dB is treated as mute. This is an explicit cue-range reduction, NOT
   automatic speech detection or sidechain compression. It affects the full original
   soundtrack, not just its music. Overlapping ducked cues combine their reductions.
6. For images, drag the actual overlay in the monitor or use position/width controls.
   PNG/WebP alpha is honored. Opaque JPEG backgrounds stay opaque; no background-removal
   model runs. Adjust opacity, start/end, and image fades. Later image cues are above
   earlier cues. Aspect ratio is preserved; images fit within the canvas.

Post files are in `project.postMedia`, not `project.assets`. They never count against H3's
nine-image/two-audio reference inputs, and are not sent to the drafting or reference agent.
The audio is an ordinary editable soundtrack, not a 15-second voice-reference sample.

The UI groups sound and image cues in two timeline lanes. It allows multiple overlapping
cues, but is not an unlimited track mixer: heavily stacked cues are easier to select from
their list. The current bounds are 64 sound cues, 64 images and 2,000 picture clips per cut.
Audio files are capped at 2 GiB each and must decode in your browser for preview.

## Fix pacing or a short burst of gibberish

Click or drag the Post ruler/playhead to seek the actual source. The transport slider is
also available on a phone. Space toggles playback outside text inputs; Left/Right steps
one frame, with Shift for one second.

Select a picture clip. You can:

- Change its source In/Out, or set those limits from the playhead.
- **Split at playhead** into two linked source ranges, without duplicating the video.
- Mark In and Out, then **Remove marked portion** or **Mute marked portion**. These split
  as necessary. Removal ripples later picture and cue starts; mute keeps duration/picture.
- Mute/lower the clip's complete original soundtrack and cover it with ambience or music.
- Move the clip left/right or delete it after confirmation.
- Change speed between 0.5x and 2x. Original audio follows with pitch-preserving tempo;
  picture repeats/drops frames, with no optical-flow or generative interpolation.

None of these uses the GPU renderer or any AI API. Muting cannot separate bad speech from
simultaneous good ambience, and speeding up cannot repair the spoken words. Cut around
an utterance or replace its whole soundtrack region when appropriate.

Cue starts are **anchored to a picture clip plus a retained-frame offset**. Removing or
shortening earlier material moves them with that clip. Splitting moves an anchor to the
appropriate new half. Deleting the clip also removes cues anchored to it, with explicit
confirmation; the uploaded files remain. A cue that extends past a shortened film or whose
start no longer fits raises a warning and blocks export until edited. No silent cue drop.
Cue duration does not automatically speed up with picture or stretch after a cut. A split
at a non-unit speed can round by one output frame; the displayed retained length is used.

## Fades and levels

**Master finish** controls picture fade from/to black and separate whole-mix audio fades.
Master picture fades include the logo. Clip picture fades apply underneath image overlays;
use them for a dip to black at a scene boundary. These are fades, NOT overlapping video
cross-dissolves. A true dissolve requires extra handles and duration accounting that this
version does not implement.

Clip, cue and master levels are independent. Export uses a final peak limiter to reduce
clipping; this is not measured broadcast loudness normalization. Live preview has no
identical final limiter, so excessive positive gains can differ audibly from the export.
Choose restrained levels and audition the final MP4.

## Preview vs final export

The browser actually decodes the source video, cue recordings and images. Web Audio is
unlocked by the first Play gesture (important on mobile), schedules cue gain and keeps the
sound layer close to the source clock. On cuts/source changes or slow network seeks there
may be gaps or small timing differences. Hiding the browser pauses preview. It does not
stop a server export. **The rendered MP4 is authoritative** for exact joins, picture/audio
fades, limiting and final timing. This is not a realtime FFmpeg render in the browser.

**Export Post MP4** freezes decisions and media hashes, saves the project, verifies uploaded
Post bytes and renders on the Node machine using installed FFmpeg/FFprobe. No H3/Qwen call,
no renderer cancellation, and no reference mutation occurs. The final file is 24-fps
H.264/AAC with faststart. It is re-encoded, not a lossless remux. Choose **Match first source**
or a named canvas; differently sized clips are aspect-fit with black padding.

Server processing is one picture range at a time, with two encoding threads and one filter
thread. Intermediate picture uses CRF 18 H.264 and float PCM audio in MOV. Final assembly
copies those picture streams and encodes audio once to AAC. Native 24-fps sources are
required. Export verifies the decoded frame count for each encoded part and final movie.
A hash mismatch, missing source/cue, invalid range or failed decoder stops the export with
an error, leaving the originals intact. Ordinary local uploaded media is accepted; SVG,
playlists, arbitrary paths, and external media URLs are not.

Watch **Post exports** and bottom-right activity notifications. Download/play the MP4 or
its saved decisions report there. Filenames/source paths stay server-managed and downloads
use the existing studio authentication. The original reference/voice limits do not apply
to this mix. Temporary parts are removed on successful assembly; a failed job keeps its
workspace for diagnosis. Long/high-resolution films can need substantial CPU time and
temporary disk. There is no promise of realtime export or a calibrated Post ETA.

Only one finishing job (ordinary edit/upscale/Post) runs at once. An accepted Post job
continues if the browser closes. Node must remain running. After Node restarts, choose
**Resume** explicitly; unfinished CPU encoding may restart from its frozen decisions, not
from the last encoded frame. Cancel terminates this export's FFmpeg process, not WanGP.
A lost submission response is looked up by its original request ID, not automatically
replayed as new work. Existing completed downloads remain in the finishing store.

## Upscale the master, explicitly

On a completed Post export, **Upscale this master...** submits the existing completed
movie to the established chunked FlashVSR finishing path, after confirmation. This uses
the GPU worker and its queue (unlike the base Post export). Select 2x or 4x, consider target
pixel count/VRAM, and wait for other GPU work. The master already contains the logo: it
will be upscaled along with the picture, and the base Post audio is retained.

Post masters are not automatically added as H3 takes or continuation context. Doing so
would accidentally feed theme music/logos back into future generation. The separate
explicit finishing operation above is intentional, not an automatic render-chain change.

## Storage, sync, installation

`postEdit` and `postMedia` persist with the project in IndexedDB. Source blobs use the
existing blob store. Portable export/import includes the Post files. Shared Studio publish
and pull include those keys, so paired devices can open the same cut. Existing completed
video archives must still be available on the server; a project-only backup is not a
backup of every generated movie. Export/download important finished media separately.

Wait for the current long generation to finish before swapping Director. Export a portable
backup. Stop ONLY the old Node process, extract 1.7.0 into a new folder, and run:

```sh
node start-headless.mjs
```

Preserve H3_DATA_DIR, environment overrides, exact URL/profile and service configuration.
Do NOT run `--stop`: no Python worker update is needed. Keep the old folder while a worker
launched from it is alive. For systemd update/restart h3-director.service only. A Node
restart can park managed dispatch until explicit reconciliation/resume; it cannot recover
an interrupted interactive AI draft. No tokens, dependencies or models need reinstalling.

## Scope and verification

Basic music/SFX layering, image overlays, cuts, mutes, speed and fades are implemented.
No automatic silence detector, speech separation, text/subtitle generator, true overlapping
video dissolves, optical flow, keyframe curves, unlimited multi-track editor, or bundled
third-party music/logo is included. Cross-source browser playback is approximate.

`node scripts/check-post.mjs` exercises real FFmpeg, pixel/audio measurements, packet bounds,
media signatures/hashes, request IDs, authenticated HTTP, streaming and cancellation.
`python3 tests/browser_post_check.py` tests actual browser media decoding and controls with
mocked backend/IndexedDB. `node scripts/check-all.mjs --integration` runs the older suites
as well. No actual H3/FlashVSR/model call is needed for a base Post edit.

Implementation reference: FFmpeg's official filters documentation, including trim/atrim,
setpts/asetpts, atempo, fade/afade, overlay, amix, volume and alimiter:
https://ffmpeg.org/ffmpeg-filters.html
