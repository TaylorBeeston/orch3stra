# Exact video mux timing and saved-footage recovery

WanGP 17.17 revision 6479db36 joins source and generated PCM, then copies H.264
packets with FFmpeg `-shortest`. The synthetic regression fixture uses 226 frames
at 24 fps and 301333 samples at 32000 Hz. Rounded PCM is one-third sample shorter
than video; FFmpeg 9 can emit only 225 video frames.

`patches/wangp-17.17-exact-video-mux.patch` uses the video's duration_ts/time_base
and a decimal bound rounded upward. It preserves video packets and strict decoded
geometry agreement, without fabricating frames. This reviewable patch is included
as source; packaging neither modifies installed WanGP nor restarts a worker.

The worker persists decoded/viewing/expected geometry and generated PCM count,
rate and origin before checkpoint validation. No tensors or user media are logged.

A missing decoded checkpoint still blocks original-run resume. A deliberately
selected saved-footage suffix is a new bounded run with derived provenance, never
an assertion of original pre-encode fidelity. Preserve original takes and records.
When its preceding PCM has a different rate, resample that owned derived PCM
before exact sample trimming; newly generated PCM remains unchanged. Original
API-decoded rate mismatches remain errors. No recovery or inference occurs here.

Four real FFmpeg mux tests cover rates 32000/44100/48000 Hz, exact PCM joins,
zero context and stream timebase. Three saved-context tests cover provenance,
resampling, generated-byte preservation and refusal of original rate mismatches.
