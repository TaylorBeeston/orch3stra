# Nemotron-3-Diarization — optional subprocess integration (1.5.0)

## What changed

Voice workshop now offers **NVIDIA Nemotron-3-Diarization** or the existing **pyannote
Community-1** speaker grouping path. Faster-whisper remains responsible for transcription.
NVIDIA's new model supplies anonymous time-aligned speaker groups, not words, voice
isolation, celebrity identification or the names of game characters. Its maximum is eight
speaker channels ordered by first arrival; it supports overlapping speech and streaming.

This implementation uses the documented **native Transformers** API, not NeMo. NeMo's
separate Python/package instructions do not apply to this path. On the release date,
NVIDIA instructs installing Transformers from source for native support. Its current
source declares Python >=3.10 and PyTorch >=2.5. Actual installation/model inference was
not possible in the build environment; requirements are not a tested lockfile.

## Current install: one shared interpreter (1.5.0)

See ENVIRONMENT.md. The default helper now runs under WanGP's own .venv interpreter.
`node scripts/setup-tools.mjs --nemotron` is currently blocked pending a verified pinned Transformers revision; it makes no package changes. The existing subprocess overlay architecture is described in ENVIRONMENT.md.
Do not follow the former separate .diarization-venv instructions for a new setup. Old
explicit H3_DIARIZE_PYTHON paths remain compatible when H3_PYTHON is not set.
Native grouping and transcription still run on CPU. Model downloads require explicit
workshop consent. No live-model inference or installation is claimed by local fixture tests.


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
cannot certify a successful future inference. If native support is false, update only
this isolated environment using the source requirement and retry the check.

A manual terminal check (no model download):

```sh
printf '%s' '{"action":"capabilities"}' | \
  .diarization-venv/bin/python scripts/diarization_worker.py
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

## Sources checked September 23, 2026

- Model card and native offline/streaming examples:
  https://huggingface.co/nvidia/Nemotron-3-Diarization
- Native package installation requirements:
  https://github.com/huggingface/transformers/blob/main/setup.py

The 100M-parameter model is released under OpenMDW-1.1. Read its current model card/license
before use. No model weights, third-party model code or dependency wheels are bundled here.
