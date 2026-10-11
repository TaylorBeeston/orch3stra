# Sound library — Orch3stra 2.2.0

Open **Post → Sound library**. The same button appears inside the Post room.
This is a soundtrack-sampling workflow, not the character-voice workshop. It never
adds media to H3's reference pool or starts a model/GPU request.

## Import → find → audition → use

1. Paste public YouTube links, one per line (up to eight), acknowledge permission
   to download/use them, then **Import & find samples**. **Use my two example links**
   fills the two URLs requested in this conversation, but starts no download:
   - https://www.youtube.com/watch?v=NirnxVtIcRc
   - https://www.youtube.com/watch?v=3BLfOpHnaEA
   A local audio/video upload is also supported. Each link gets its own source card.
2. Select the source. The server prepares a stereo, 48 kHz PCM editing copy and
   proposes ranges. **Automatic** uses supplied source chapters when at least two
   are available, otherwise quiet gaps. Chapter titles are retained; gap-based
   suggestions are numbered rather than given invented sound descriptions.
3. Audition each range. Edit In/Out seconds, name, and category; split at the source
   playhead, merge with the next range, remove a suggestion, or keep the whole
   recording. In/Out here refer to the original recording, NOT the movie timeline.
4. Check the useful ranges and **Save checked samples** (up to 500 per operation).
   The server creates reusable stereo WAV cuts with source/range provenance.
5. **Add to Post at playhead** places the chosen sample in the existing Post cut.
   First initialize a Post cut from your finished footage. Use Post's cue controls
   for placement, looping, gain, ducking, and fades. WAV downloads are also available.

The current defaults are -42 dB, 0.45-second quiet gaps, minimum 0.25-second sound
regions, and 0.12-second handles. Lower the threshold for quiet material. Reduce the
minimum gap to separate closely spaced stings; increase it when internal musical
pauses are being split. Every detected range remains editable. **Find samples again**
replaces suggestions only after confirmation and does not modify already saved WAVs
or cues that use them. Saving a changed range/name creates a new media entry; earlier
versions remain.

## What detection is not

This is chapter/energy-based segmentation, not semantic music analysis, beat tracking,
source separation, a sound-name recognition model, or stem extraction. Continuous
music without gaps may become one candidate. A crossfade may not produce a usable
boundary; spoken commentary can be included in a detected segment. Audition and split
manually where needed. The app reports when it cannot find clear divisions. It does
not claim to have isolated bass, dialogue, or a particular instrument.

No audio from the example videos is bundled in this release. Neither video was fetched
or auditioned during development; their availability and detector results must be
checked on the user's installation. The full local-file path and a stubbed yt-dlp
adapter are covered by automated tests.

## Runtime, storage, and privacy

- Uses the same configured Python interpreter as the speech tools, through
  `H3_PYTHON` / the headless launcher's WanGP interpreter. No new virtual environment.
- Uses FFmpeg and the Python standard library. YouTube import additionally requires
  `yt-dlp` in that interpreter. No transcription/diarization model is loaded.
- Current yt-dlp documentation recommends its default extras (including EJS) and a
  supported JavaScript runtime for YouTube. The helper explicitly provides the same
  Node binary running Director. On an idle installation, when missing:
  ```sh
  /path/to/Wan2GP/.venv/bin/python -m pip install --upgrade 'yt-dlp[default]'
  ```
  This command does not install Torch/model dependencies. Director does not run it
  automatically or collect browser cookies. Source: https://github.com/yt-dlp/yt-dlp
- One CPU job runs at a time, with two FFmpeg threads. The browser can close while
  accepted jobs continue, provided the Node server remains running. It may compete
  for CPU/disk with rendering, but never claims the GPU queue.
- Each input is limited to one hour and 512 MiB. Up to 500 candidate ranges may be
  detected, with at most 500 checked samples saved at once and two hours of combined selected
  audio per save. Longer compilations can
  be uploaded as shorter local excerpts. Normalized PCM can be larger than the
  compressed input (about 0.69 GB for one hour); leave disk space for source and cuts.
- Imports do not bypass private/age/paywall restrictions. Unsupported links or site
  challenges produce an explicit failure; use a file you are authorized to upload.
- Sources and saved cuts are private owned blobs under H3_DATA_DIR. Project metadata
  retains the sampling decisions; portable backup / Shared Studio includes the source
  and accepted cuts after they are saved into the project. Server imports not yet
  saved remain in the server source list, not in portable backups.

## Recovery

A cancelled operation leaves previously saved sources/cuts intact. A Node restart parks
unfinished work. Reopen Sound library and explicitly **Resume this operation**. Saved
sources are reused for reanalysis rather than downloaded again. Imports interrupted
before any source was committed may need to download the source again. There is no
GPU submission to duplicate. Revision checks prevent two devices silently overwriting
one source's sample edits. A project restored elsewhere can restore its saved source
from the included blob and rebuild the waveform.

Use **Diagnostic** in the source panel to capture phase/error metadata. Source URLs,
titles, and sample names are creative metadata: inspect before sharing.
