# Nemotron-3-Diarization — optional speaker grouping

Voice workshop offers **NVIDIA Nemotron-3-Diarization** or the existing **pyannote
Community-1** speaker grouping path. Faster-whisper remains responsible for transcription.
NVIDIA's new model supplies anonymous time-aligned speaker groups, not words, voice
isolation, celebrity identification or the names of game characters. Its maximum is eight
speaker channels ordered by first arrival; it supports overlapping speech and streaming.

This implementation uses the documented **native Transformers** API, not NeMo. NeMo's
separate Python/package instructions do not apply to this path. When the model was
released (September 23, 2026) native support existed only in Transformers' main branch;
it first shipped in a stable release with Transformers 5.18.0. Transformers 5.x needs
Python >=3.10 and PyTorch >=2.5. WanGP pins an older Transformers (4.x), which has no
Nemotron support, so Nemotron's Transformers lives in a separate overlay (see below).

## Installation

See ENVIRONMENT.md. The helper runs under the shared interpreter (normally WanGP's own
.venv) and puts a dependency-only overlay (`$H3_DATA_DIR/python-overlays/nemotron`, or
`H3_NEMOTRON_PACKAGES`) in front of it, so only the Nemotron subprocess sees the newer
Transformers. `node scripts/setup-tools.mjs --nemotron` installs the pinned versions in
`requirements-nemotron.txt` (transformers 5.19.0, tokenizers 0.23.3, huggingface_hub
1.33.0) into a staging folder, checks that `nemotron3_diarization` is registered, then
swaps it into place, keeping any previous overlay as `nemotron.backup-<timestamp>`.
Run it between renders. It does not download model weights or touch WanGP's packages.
Old explicit H3_DIARIZE_PYTHON paths remain compatible when H3_PYTHON is not set.

Transcription and speaker grouping both run on the **CPU**. Node starts the voice worker
with `CUDA_VISIBLE_DEVICES` empty, Whisper is created with `device='cpu'`, the Nemotron
model is moved to CPU float32, and PyTorch is limited to two threads. Model downloads
require explicit workshop consent. Local fixture tests do not run model inference.


## Use it on a new source

Open **Subjects & images → Voice workshop**, import a source, and expand **Transcribe /
group speakers**. Choose **Also group speakers**, select **Nemotron-3-Diarization**, and
allow local model use/download before **Transcribe source**.

Whisper transcribes first. It releases its model reference before the isolated diarizer
is launched. If grouping fails, the completed transcript stays editable and a warning
states the chosen model/error. There is no silent substitution of another diarizer.
The HF token field is reused from the remembered studio credentials; it is passed via
stdin, not a command-line argument. No model-specific license consent for a different
provider is implied; pyannote still requires its own HF access conditions.

**Check Nemotron environment** reports Python, installed Transformers version, PyTorch
presence and native `nemotron3_diarization` registration. It does not load weights and
cannot certify a successful future inference. If native support is false, the overlay
needs a Transformers release with Nemotron support (5.18.0 or newer); WanGP itself must not be upgraded.

A manual terminal check (no model download), using the same interpreter as the app:

```sh
printf '%s' '{"action":"capabilities"}' | \
  "$H3_PYTHON" scripts/diarization_worker.py
```

## Regroup without losing hand edits

For an existing source, choose **Nemotron: regroup existing cuts only**. Confirm the
operation. This analyzes the source again but **does not rerun Whisper**. Each existing
cut keeps its ID, in/out times, exact text and Keep checkbox. Word records also remain.
Only anonymous speaker/overlap annotations are reassigned. A cut spanning several voices
uses the greatest overlapping duration (ties remain unassigned); it is not automatically
split. Audit mixed cuts by ear.

Custom speaker names are cleared after confirmation because new anonymous numbers need
not match the old mapping. Their previous labels/names are retained in `speakerHistory`;
Undo restores the edit. Regroup refuses to apply if the project or cut rows changed while
inference was running. It does not alter previously exported/bound voice WAVs.

## Processing contract

`scripts/voice_worker.py` invokes `scripts/diarization_worker.py` in the separate interpreter.
They share a process group, so the existing Cancel action can stop both. The model receives
only the server-owned source file, never an arbitrary browser path or URL.

FFmpeg converts to 16 kHz mono float32. Sources up to 20 seconds use offline inference;
longer sources use the processor's `low_latency` chunk geometry. A single `speaker_cache`
continues across all chunks; chunks do not each restart their speaker numbering. Trailing
look-ahead and final-chunk flags follow the documented processor contract. Uppercase
`Start`/`End`/`Speaker` outputs become validated `start`/`end`/`SPEAKER_00`…`SPEAKER_07`
records; overlapping intervals remain overlapping.

The existing workshop import limit is ten minutes (helper ceiling 601s). This is an app
resource policy, not a limitation of NVIDIA's streaming model. Expected-speaker hints
are ignored with a warning for Nemotron, and still apply to pyannote. No source separation,
background-music removal or automatic recognition of who is Listener/Caller is performed.

A Voice job is a Node-owned child process, not a detached GPU job. Keep Node running during
transcription/grouping. Model download/runtime errors appear in the workshop status and
activity system. This does not imply that old voice operations survive a Node restart.

## Sources

- Model card and native offline/streaming examples:
  https://huggingface.co/nvidia/Nemotron-3-Diarization
- Native package installation requirements:
  https://github.com/huggingface/transformers/blob/main/setup.py

The 100M-parameter model is released under OpenMDW-1.1. Read its current model card/license
before use. No model weights, third-party model code or dependency wheels are bundled here.
