# Installed decoded-media contract

Verified against the maintainer's read-only WanGP 17.17 snapshot, Git revision
`6479db36bdc2619a904a852bba9c2d78e1a83f82`. The three inspected files were clean.
This is source inspection, not live inference or a claim about later revisions.

## Request and return

- Submit `_api: {return_media: true}` through `Session.submit_task`.
- `GenerationResult.artifacts` contains immutable `GeneratedArtifact` records.
- Match `client_id` and the generated output `path`; never use another task's tensor.
- `video_tensor_uint8` is RGB `[C, F, H, W]`; the API returns an already-uint8
  tensor directly, or converts supported float output to this decoded representation.
- `audio_tensor` is the generated time-major float32 NumPy audio, with its own
  `audio_sampling_rate`. `fps` belongs to the returned video.
- HDR, postprocessing, missing tensors and unexpected frame geometry must fail
  checkpoint validation rather than be mislabeled lossless.

## Important audio origin

In `wgp.py` lines 8396–8438, the retained source video is prepended to video while
the generated overlap is removed. Generated audio has its overlap removed too,
but the retained source audio is muxed separately into the viewing file. The API
at lines 8680–8685 returns `output_new_audio_data`, not that final muxed soundtrack.
Therefore, with a source containing N retained frames, returned generated audio
starts at video-local frame N. It must not be treated as starting at video frame 0.

A checkpoint tail wholly inside new footage can use this explicit origin directly.
A longer tail crossing the source/new boundary requires audio from both the saved
source and returned new audio, with exact sample boundaries and rate agreement.
Never pad or silently shift audio to conceal a missing span. Source-backed audio
conditioning is separately read from the source file's overlap in lines 7800–7806.

An edited-prefix recovery has a different contract: its owned context is
explicitly `decoded-from-saved-footage`. Finishing produces 48 kHz audio, while
H3 returns 32 kHz generated PCM. A rolling tail crossing this boundary converts
only that declared saved-footage portion with FFmpeg `aresample` before exact
target-rate sample trimming. Newly returned PCM stays byte-for-byte unchanged.
The checkpoint records preceding representation, input/output sample rates,
conversion, sample range and `contains_saved_footage`; FFV1/PCM storage does not
restore the original tensors or make the preceding audio original decoded PCM.
Original decoded checkpoint rate mismatches and all channel/coverage mismatches
still fail. Missing bounded checkpoints never fall back to viewing-file decoding.

## Memory and recovery

The API may concatenate its output chunks into a contiguous tensor. Bounded input
and one-window tasks bound this upstream allocation. The checkpoint writer copies
only individual RGB frames and bounded audio chunks. No tensors enter SQLite or
JSON. Archive ownership must be committed before decoded checkpoint processing;
checkpoint failure must preserve the generated file and never retry inference.

An encoded legacy source cannot recover unavailable decoded tensors. Its extracted
tail must be labeled as decoded from saved footage, cached once for that exact
owned source/range, and kept separate from new decoded-output checkpoints.

Evidence: `shared/api.py` GeneratedArtifact and GenerationResult definitions,
get_api_output_options, build_api_output_artifact_payload; `docs/API.md` decoded
media section; `wgp.py` source/video/audio concatenation and API storage paths.
