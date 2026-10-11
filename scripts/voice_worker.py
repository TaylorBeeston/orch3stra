#!/usr/bin/env python3
"""Optional CPU-only voice importer / ASR worker. One JSON request on stdin.
Paths are assigned by the loopback bridge, never accepted from a browser.
Model inference is local. Model downloads require explicit consent in the UI.
"""
from __future__ import annotations
import array
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import wave
from urllib.parse import urlsplit, parse_qs

MAX_SECONDS = 600
MODELS = {'tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v3', 'turbo'}

def emit(**value):
    print(json.dumps(value, ensure_ascii=False), flush=True)

def youtube_url(raw):
    u = urlsplit(str(raw).strip())
    if u.scheme not in ('http', 'https') or u.username or u.password or u.port:
        raise ValueError('Use a public YouTube video URL without credentials or a custom port.')
    vid = None
    if u.hostname == 'youtu.be':
        vid = u.path.lstrip('/')
    elif u.hostname in ('youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'):
        vid = parse_qs(u.query).get('v', [''])[0] if u.path == '/watch' else None
        m = re.fullmatch(r'/(?:shorts|embed|live)/([A-Za-z0-9_-]+)/?', u.path)
        if m:
            vid = m[1]
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', vid or ''):
        raise ValueError('Only single YouTube video links are supported.')
    return 'https://www.youtube.com/watch?v='+vid

def clip_range(req):
    start, end = float(req.get('start', 0)), float(req.get('end', 120))
    if not all(math.isfinite(x) for x in (start, end)) or start < 0 or start > 86400 or not .1 <= end-start <= MAX_SECONDS:
        raise ValueError('Select an excerpt of 0.1–600 seconds; start must be within the first 24 hours.')
    return start, end

def run_ffmpeg(args):
    exe = os.environ.get('H3_FFMPEG', 'ffmpeg')
    r = subprocess.run([exe, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-threads', '2']+args,
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=900)
    if r.returncode:
        raise ValueError('FFmpeg could not decode this audio/video. '+r.stderr.decode(errors='replace')[-1200:])

def read_wave(path):
    with wave.open(str(path), 'rb') as f:
        if f.getnchannels() != 1 or f.getsampwidth() != 2:
            raise ValueError('Expected mono 16-bit PCM WAV.')
        rate, frames = f.getframerate(), f.getnframes()
        if frames < 1 or rate < 8000:
            raise ValueError('No usable audio was decoded in that excerpt.')
        if frames > rate*(MAX_SECONDS+1):
            raise ValueError('Source exceeds the workshop duration limit.')
        pcm = array.array('h', f.readframes(frames))
        if sys.byteorder != 'little': pcm.byteswap()
    return pcm, rate

def source_info(path):
    pcm, rate = read_wave(path)
    stride = max(1, len(pcm)//1800)
    peaks = [round(max(abs(x) for x in pcm[i:i+stride])/32768, 4) for i in range(0, len(pcm), stride)]
    return {'duration': len(pcm)/rate, 'sampleRate': rate, 'peaks': peaks}

def import_audio(req):
    start, end = clip_range(req)
    dest = Path(req['output'])
    source = req.get('input')
    provenance = {'kind': 'upload', 'name': str(req.get('name', 'Local media'))[:240], 'offset': start}
    if req.get('url'):
        if req.get('rightsConfirmed') is not True:
            raise ValueError('Confirm permission to use and download the source before importing.')
        url = youtube_url(req['url'])
        try:
            import yt_dlp
            from yt_dlp.utils import download_range_func
        except ImportError as exc:
            raise ValueError('Install the optional voice requirements in .voice-venv (yt-dlp is missing).') from exc
        emit(phase='downloading', message='Fetching the selected public YouTube excerpt…')
        class Quiet:
            def debug(self, *_): pass
            def warning(self, *_): pass
            def error(self, *_): pass
        def progress(d):
            if d.get('status') == 'downloading':
                n, total = d.get('downloaded_bytes', 0), d.get('total_bytes') or d.get('total_bytes_estimate')
                if n > 256*1024**2:
                    raise ValueError('Download exceeded the 256 MiB workshop limit.')
                emit(phase='downloading', message='Downloading audio excerpt', bytes=n, progress=round(n/total, 3) if total else None)
        def match_filter(info, *, incomplete=False):
            if info.get('is_live') or info.get('live_status') in ('is_live', 'is_upcoming'):
                return 'Live and upcoming streams are not supported.'
            if (info.get('age_limit') or 0) > 0:
                return 'Age-restricted sources are not supported by this importer.'
            if info.get('availability') in ('private', 'subscriber_only', 'premium_only', 'needs_auth'):
                return 'Authenticated or restricted sources are not supported.'
        opts = {'format': 'bestaudio/best', 'outtmpl': str(dest.parent/'download.%(ext)s'),
                'noplaylist': True, 'quiet': True, 'no_warnings': True, 'logger': Quiet(),
                'socket_timeout': 20, 'retries': 1, 'fragment_retries': 1, 'max_filesize': 256*1024**2,
                'match_filter': match_filter, 'progress_hooks': [progress], 'overwrites': False,
                'download_ranges': download_range_func(None, [(start, end)]),
                'js_runtimes': {'node': {'path': os.environ.get('H3_NODE', 'node')}},
                'cachedir': False, 'allow_unplayable_formats': False, 'extractor_retries': 1}
        if os.environ.get('H3_FFMPEG'): opts['ffmpeg_location'] = os.environ['H3_FFMPEG']
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        downloads = info.get('requested_downloads') or []
        source = downloads[0].get('filepath') if downloads else None
        if not source:
            candidates = [p for p in dest.parent.glob('download.*') if p.suffix not in ('.part', '.ytdl', '.json')]
            source = str(candidates[0]) if len(candidates) == 1 else None
        if not source or not Path(source).is_file():
            raise ValueError('YouTube did not return a downloadable audio excerpt. Use a local file; no access restrictions were bypassed.')
        provenance = {'kind': 'youtube', 'url': url, 'name': info.get('title', 'YouTube excerpt'), 'offset': start,
                      'uploader': info.get('uploader'), 'license': info.get('license')}
        start = 0  # yt-dlp/FFmpeg already selected the requested excerpt.
    if not source:
        raise ValueError('No source audio supplied.')
    emit(phase='decoding', message='Preparing a mono 32 kHz editing source…')
    run_ffmpeg(['-protocol_whitelist', 'file,pipe', '-ss', str(start), '-i', str(source), '-t', str(end-float(req.get('start', 0))),
                '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '32000', '-c:a', 'pcm_s16le', str(dest)])
    # Raw download is no longer needed. The normalized source is the only retained media.
    if req.get('url'): Path(source).unlink(missing_ok=True)
    return {**source_info(dest), 'provenance': provenance}

def diarization_turns(output):
    ann = getattr(output, 'speaker_diarization', output)
    if hasattr(ann, 'itertracks'):
        return [{'start': float(t.start), 'end': float(t.end), 'speaker': str(s)} for t, _, s in ann.itertracks(yield_label=True)]
    return [{'start': float(t.start), 'end': float(t.end), 'speaker': str(s)} for t, s in ann]

def label_words(words, turns):
    result = []
    for w in words:
        scores = {}
        for t in turns:
            overlap = max(0., min(w['end'], t['end'])-max(w['start'], t['start']))
            if overlap: scores[t['speaker']] = scores.get(t['speaker'], 0.)+overlap
        top = max(scores, key=scores.get) if scores else 'UNASSIGNED'
        # Flag simultaneous speakers, not just successive speakers within one word.
        active = [t for t in turns if min(w['end'], t['end']) > max(w['start'], t['start'])]
        crossed = any(a['speaker'] != b['speaker'] and min(a['end'], b['end'], w['end'])-max(a['start'], b['start'], w['start']) > .03
                      for i, a in enumerate(active) for b in active[i+1:])
        result.append({**w, 'speaker': top, 'overlapping': crossed})
    return result

def group_words(words):
    rows = []
    for w in words:
        last = rows[-1] if rows else None
        if last is None or last['speaker'] != w['speaker'] or w['start']-last['end'] > .6 or w['end']-last['start'] > 6:
            last = {'id': 'line-'+str(len(rows)+1), 'start': w['start'], 'end': w['end'], 'speaker': w['speaker'], 'text': '', 'words': [], 'keep': True, 'overlapping': False}
            rows.append(last)
        last['end'] = max(last['end'], w['end']); last['text'] += w['word']; last['words'].append(w)
        last['overlapping'] |= w.get('overlapping', False)
    return rows


def nemotron(req, capabilities=False):
    """Run the native Nemotron helper with the SAME interpreter by default.

    The child shares the parent's process group so Node cancellation stops both.
    Progress is forwarded; tokens stay in stdin and errors are redacted upstream.
    """
    import tempfile
    helper = Path(__file__).with_name('diarization_worker.py')
    python = os.environ.get('H3_PYTHON') or os.environ.get('H3_DIARIZE_PYTHON') or sys.executable
    payload = {**req, 'action': 'capabilities' if capabilities else 'diarize'}
    with tempfile.TemporaryFile(mode='w+b') as errors:
        try:
            child = subprocess.Popen([python, '-u', str(helper)], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=errors, text=True)
        except FileNotFoundError as exc:
            raise ValueError('Shared Python not found. Set H3_PYTHON; see ENVIRONMENT.md.') from exc
        child.stdin.write(json.dumps(payload)); child.stdin.close()
        result, error = None, None
        for line in child.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if 'result' in event:
                result = event['result']
            elif 'error' in event:
                error = event['error']
            else:
                emit(**event)
        code = child.wait()
        if code or error or result is None:
            errors.seek(0, 2); errors.seek(max(0, errors.tell()-1800)); tail = errors.read(1800).decode(errors='replace')
            raise ValueError(error or 'Nemotron helper failed: '+tail)
        return result


def group_only(req):
    if req.get('allowModels') is not True:
        raise ValueError('Consent to local model use/download is required.')
    result = nemotron(req)
    return {**result, 'diarized': bool(result['turns'])}

def transcribe(req):
    if req.get('allowModels') is not True:
        raise ValueError('Consent to local model use/download is required.')
    model_name = req.get('model', 'small')
    if model_name not in MODELS: raise ValueError('Choose a supported Whisper model.')
    language = req.get('language') or None
    if language and not re.fullmatch('[a-z]{2,3}', language): raise ValueError('Language must be an ISO language code or blank for detection.')
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise ValueError('Install faster-whisper in the optional .voice-venv before transcription.') from exc
    emit(phase='model', message='Loading Whisper on CPU (first use downloads model weights)…')
    model = WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=2, num_workers=1)
    segments, info = model.transcribe(req['input'], word_timestamps=True, vad_filter=True,
                                      language=language, beam_size=3, condition_on_previous_text=False)
    words = []
    for seg in segments:
        for word in seg.words or []:
            start, end = max(0., float(word.start)), min(float(info.duration), float(word.end))
            if end > start:
                words.append({'start': start, 'end': end, 'word': str(word.word), 'probability': float(word.probability)})
        emit(phase='transcribing', message='Transcribing speech on CPU', progress=min(1, seg.end/max(info.duration, .01)))
    del model
    turns, warnings = [], []
    if req.get('diarize'):
        emit(phase='diarizing', message='Grouping speakers locally on CPU. These are anonymous voice groups, not character identification…')
        try:
            if req.get('diarizationModel') == 'nemotron3':
                result = nemotron(req)
                turns = result['turns']
                warnings.extend(result.get('warnings', []))
            else:
                turns = pyannote_turns(req)
        except Exception as exc:
            message = str(exc).replace(req.get('hfToken') or os.environ.get('HF_TOKEN') or '\x00', '[redacted]')
            label = 'Nemotron (see DIARIZATION.md)' if req.get('diarizationModel') == 'nemotron3' else 'pyannote Community-1'
            warnings.append(label+' grouping failed; transcription was kept. '+message[:1200])
    return {'segments': group_words(label_words(words, turns)), 'language': info.language,
            'turns': turns, 'warnings': warnings, 'diarized': bool(turns),
            'diarizationModel': req.get('diarizationModel', 'pyannote') if req.get('diarize') else None}

def pyannote_turns(req):
            import numpy as np
            import torch
            from pyannote.audio import Pipeline
            torch.set_num_threads(2)
            pipe = Pipeline.from_pretrained('pyannote/speaker-diarization-community-1', token=req.get('hfToken') or os.environ.get('HF_TOKEN') or None)
            pcm, sr = read_wave(req['input'])
            waveform = torch.from_numpy(np.asarray(pcm, dtype=np.float32)/32768.).unsqueeze(0)
            args = {}
            count = req.get('numSpeakers')
            if count:
                if type(count) is not int or not 1 <= count <= 20: raise ValueError('Speaker count must be 1–20 or blank.')
                args['num_speakers'] = count
            result = pipe({'waveform': waveform, 'sample_rate': sr}, **args)
            return diarization_turns(result)

def main():
    req = json.load(sys.stdin)
    if req.get('action') == 'capabilities':
        return {'python': sys.version.split()[0], 'ffmpeg': bool(shutil.which(os.environ.get('H3_FFMPEG', 'ffmpeg'))),
                'yt_dlp': importlib.util.find_spec('yt_dlp') is not None, 'faster_whisper': importlib.util.find_spec('faster_whisper') is not None,
                'pyannote': importlib.util.find_spec('pyannote') is not None, 'device': 'cpu', 'maxSeconds': MAX_SECONDS}
    if req.get('action') == 'diarize': return group_only(req)
    if req.get('action') == 'nemotron-capabilities': return nemotron(req, capabilities=True)
    if req.get('action') == 'import': return import_audio(req)
    if req.get('action') == 'transcribe': return transcribe(req)
    raise ValueError('Unknown voice worker operation.')

if __name__ == '__main__':
    try: emit(result=main())
    except Exception as exc:
        emit(error=str(exc)[:1600]); sys.exit(1)
