#!/usr/bin/env python3
"""Isolated Nemotron-3-Diarization worker (CPU only, no ASR, no remote code).

Uses NVIDIA's documented native Transformers interface. Streaming calls carry
one speaker_cache through the recording so speaker IDs do not reset per chunk.
Input is a server-owned local audio path supplied by voice_worker, never a URL.
"""
from __future__ import annotations
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys

# Only this subprocess sees the newer dependency overlay. There is still one Python/venv.
_overlay = Path(os.environ.get('H3_NEMOTRON_PACKAGES') or str(Path(os.environ.get('H3_DATA_DIR', str(Path.home()/'.local/share/h3-director'))) / 'python-overlays' / 'nemotron'))
if _overlay.is_dir():
    sys.path.insert(0, str(_overlay))

MODEL_ID = 'nvidia/Nemotron-3-Diarization'
MAX_SECONDS = 601


def emit(**data):
    print(json.dumps(data, ensure_ascii=False, allow_nan=False), flush=True)


def canonical_turns(segments, duration):
    """Convert native uppercase keys, validate IDs/timestamps; retain overlaps."""
    turns = []
    for s in segments:
        start, end = float(s['Start']), float(s['End'])
        speaker = s['Speaker']
        if isinstance(speaker, bool) or int(speaker) != speaker or not 0 <= int(speaker) <= 7:
            raise ValueError('Nemotron returned an invalid speaker index.')
        if not all(math.isfinite(x) for x in (start, end)) or start < 0 or end < start:
            raise ValueError('Nemotron returned invalid segment timing.')
        start, end = min(start, duration), min(end, duration)
        if end > start:
            turns.append({'start': start, 'end': end, 'speaker': 'SPEAKER_'+str(int(speaker)).zfill(2)})
    return sorted(turns, key=lambda s: (s['start'], s['end'], s['speaker']))


def audio_chunks(processor, length):
    """NVIDIA processor owns sample geometry, including look-ahead overlap.

    Ranges are not naïve non-overlapping audio slices. Short files use offline
    inference; this generator is for longer recordings and retains a final tail.
    """
    first = int(processor.num_samples_first_audio_chunk)
    width = int(processor.num_samples_per_audio_chunk)
    step = int(processor.num_mel_frames_per_step)
    if min(first, width, step) <= 0:
        raise ValueError('Invalid processor streaming geometry.')
    if length <= first:
        yield 0, length, True, True
        return
    yield 0, first, True, False
    mel = step
    start = int(processor.audio_chunk_start(mel))
    previous = -1
    while start + width < length:
        if start <= previous or start < 0:
            raise ValueError('Processor streaming offset did not advance.')
        yield start, start+width, False, False
        previous = start
        mel += step
        start = int(processor.audio_chunk_start(mel))
    if 0 <= start < length:
        yield start, length, False, True


def diarize(request):
    if request.get('allowModels') is not True:
        raise ValueError('Consent to local model use/download is required.')
    path = Path(request['input'])
    if not path.is_absolute() or not path.is_file():
        raise ValueError('A server-owned local audio file is required.')
    try:
        import numpy as np
        import torch
        from transformers import AutoModelForAudioFrameClassification, AutoProcessor
    except ImportError as exc:
        raise ValueError('Run node scripts/setup-tools.mjs --nemotron for the same-interpreter dependency overlay. See ENVIRONMENT.md.') from exc
    torch.set_num_threads(2)
    emit(phase='diarization_model', message='Loading Nemotron-3-Diarization on CPU; first use may download weights…')
    token = request.get('hfToken') or os.environ.get('HF_TOKEN') or None
    processor = AutoProcessor.from_pretrained(MODEL_ID, token=token, trust_remote_code=False)
    model = AutoModelForAudioFrameClassification.from_pretrained(MODEL_ID, token=token, trust_remote_code=False)
    model = model.to(device='cpu', dtype=torch.float32).eval()
    sample_rate = int(processor.feature_extractor.sampling_rate)
    if sample_rate != 16000:
        raise ValueError('Unexpected model sampling rate; this integration expects 16 kHz.')
    command = [os.environ.get('H3_FFMPEG', 'ffmpeg'), '-v', 'error', '-nostdin',
               '-protocol_whitelist', 'file,pipe', '-i', str(path), '-t', str(MAX_SECONDS+1),
               '-map', '0:a:0', '-vn', '-ac', '1', '-ar', str(sample_rate), '-f', 'f32le', 'pipe:1']
    decoded = subprocess.run(command, capture_output=True, timeout=120, check=True)
    audio = np.frombuffer(decoded.stdout, dtype='<f4').copy()
    duration = len(audio)/sample_rate
    if not 0 < duration <= MAX_SECONDS:
        raise ValueError('Workshop sources must be at most 601 seconds.')
    emit(phase='diarizing', message='Grouping anonymous speakers on CPU; this does not separate or identify voices.', progress=0)
    with torch.inference_mode():
        if duration <= 20:
            inputs = processor(audio, sampling_rate=sample_rate).to(model.device, dtype=model.dtype)
            logits = model(**inputs).logits
            segments = processor.extract_speaker_dict(logits, inputs.attention_mask)[0]
        else:
            processor.set_streaming_mode('low_latency')
            chunks, cache = [], None
            for index, (start, end, first, last) in enumerate(audio_chunks(processor, len(audio))):
                inputs = processor(audio[start:end], sampling_rate=sample_rate,
                                   is_streaming=True, is_first_audio_chunk=first,
                                   is_last_audio_chunk=last).to(model.device, dtype=model.dtype)
                output = model(**inputs, speaker_cache=cache)
                cache = output.speaker_cache
                chunks.append(output.logits.cpu())
                if index % 8 == 0 or last:
                    emit(phase='diarizing', message='Nemotron speaker grouping · source '+str(round(end/sample_rate, 1))+'s / '+str(round(duration, 1))+'s', progress=min(.99, end/len(audio)))
            segments = processor.extract_speaker_dict(torch.cat(chunks, dim=1))[0]
    turns = canonical_turns(segments, duration)
    return {'turns': turns, 'duration': duration, 'diarizationModel': MODEL_ID,
            'device': 'cpu', 'maxSpeakers': 8,
            'warnings': ['Expected-speaker hint is not used by Nemotron: it detects up to eight anonymous speakers.'] if request.get('numSpeakers') else []}


def main():
    request = json.load(sys.stdin)
    if request.get('action') == 'capabilities':
        native, version, error = False, None, None
        try:
            import transformers
            from transformers.models.auto.configuration_auto import CONFIG_MAPPING_NAMES
            native = 'nemotron3_diarization' in CONFIG_MAPPING_NAMES
            version = transformers.__version__
        except ImportError as exc:
            error = str(exc)
        return {'python': sys.version.split()[0], 'torch': importlib.util.find_spec('torch') is not None,
                'transformers': importlib.util.find_spec('transformers') is not None,
                'model': MODEL_ID, 'device': 'cpu', 'native_support': native, 'transformers_version': version, 'import_error': error, 'note': 'Dependency presence only; model loading has not been tested.'}
    if request.get('action') != 'diarize':
        raise ValueError('Unknown diarization action.')
    return diarize(request)


if __name__ == '__main__':
    try:
        emit(result=main())
    except Exception as exc:
        emit(error=str(exc)[:1800]); sys.exit(1)
