"""Bounded, lossless *decoded representation* checkpoints, never latent caches.

The caller supplies verified audio alignment explicitly. An artifact's audio must
not be assumed to include a source-video prefix just because its video does.
This module performs no inference, queue dispatch, or deletion of source media.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

FPS = 24
MAX_CONTEXT_FRAMES = 120


def sample_boundary(frame, rate):
    """Nearest sample, ties up; absolute boundaries avoid accumulated rounding."""
    if type(frame) is not int or frame < 0 or type(rate) is not int or rate <= 0:
        raise ValueError('Invalid audio/frame boundary.')
    return (frame * rate * 2 + FPS) // (2 * FPS)


def _numpy(value):
    if hasattr(value, 'detach'):
        value = value.detach().cpu().numpy()
    import numpy as np
    return np.asarray(value)


def _run(args):
    r = subprocess.run(args, capture_output=True, timeout=120)
    if r.returncode:
        raise ValueError('Checkpoint media operation failed: ' + r.stderr.decode(errors='replace')[-2000:])
    return r.stdout


def _sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def choose_appearance_frame(video, *, start_frame=0, end_frame=None, max_candidates=12):
    """Bounded contrast/edge heuristic; not a judgement of identity or anatomy."""
    import numpy as np
    shape = tuple(video.shape)
    if len(shape) != 4 or shape[0] != 3 or str(video.dtype) not in ('uint8', 'torch.uint8'):
        raise ValueError('Appearance frame selection requires decoded RGB8 video.')
    end_frame = shape[1] if end_frame is None else end_frame
    if type(start_frame) is not int or type(end_frame) is not int or not 0 <= start_frame < end_frame <= shape[1]:
        raise ValueError('Invalid continuous-shot frame interval.')
    if type(max_candidates) is not int or not 1 <= max_candidates <= 24:
        raise ValueError('Appearance search must remain bounded.')
    best = None
    # Avoid the first transient when there is sufficient footage; stay early in
    # the chosen shot instead of selecting a later pose as a new identity.
    first = start_frame + min(2, end_frame - start_frame - 1)
    stride = max(1, min(shape[2:]) // 128)
    for index in range(first, min(end_frame, first + max_candidates)):
        sample = _numpy(video[:, index, ::stride, ::stride]).astype(np.float32)
        gray = sample.mean(axis=0)
        if min(gray.shape) < 2 or gray.size < 4 or float(gray.std()) < 4 or float((gray < 5).mean()) > .98 or float((gray > 250).mean()) > .98:
            continue
        score = float(np.abs(np.diff(gray, axis=0)).mean() + np.abs(np.diff(gray, axis=1)).mean())
        if best is None or score > best['score']:
            best = {'frame': index, 'score': score, 'heuristic': True,
                    'notice': 'Early-frame contrast/edge heuristic only; inspect appearance and identity.'}
    return best


def write_appearance_frame(video, destination, frame):
    """Lossless PNG from one chosen decoded RGB8 frame; source remains untouched."""
    import numpy as np
    shape = tuple(video.shape)
    if len(shape) != 4 or shape[0] != 3 or str(video.dtype) not in ('uint8', 'torch.uint8'):
        raise ValueError('Appearance image requires decoded RGB8 video.')
    if type(frame) is not int or not 0 <= frame < shape[1]:
        raise ValueError('Appearance frame is outside the saved output.')
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Appearance anchor already exists; do not overwrite it.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    pixels = np.moveaxis(_numpy(video[:, frame]), 0, -1).tobytes(order='C')
    with tempfile.TemporaryDirectory(prefix='.appearance-', dir=destination.parent) as tmp:
        out = Path(tmp) / 'anchor.png'
        result = subprocess.run([os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-nostdin',
            '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', f'{shape[3]}x{shape[2]}',
            '-i', 'pipe:0', '-frames:v', '1', '-threads', '1', str(out)],
            input=pixels, capture_output=True, timeout=30)
        if result.returncode:
            raise ValueError('Appearance PNG encoding failed.')
        out.chmod(0o600)
        os.link(out, destination)
    return {'frame': frame, 'representation': 'decoded-rgb8', 'sha256': _sha(destination),
            'width': shape[3], 'height': shape[2], 'context_only': True}


def write_decoded_tail(video, destination, *, count, audio=None, sample_rate=None,
                       audio_start_frame=0, timeline_end_frame=None):
    """Store last count RGB8 CFHW frames and aligned float32 PCM samples.

    Accepts NumPy or Torch uint8 video. Copies at most one frame at a time to
    packed RGB. Audio is time-major [samples, channels] or mono [samples].
    audio_start_frame declares where sample zero lies in this video's clock.
    Refuse missing audio coverage; never pad, resample, or silently shift it.
    """
    import numpy as np
    shape = tuple(video.shape)
    if len(shape) != 4 or shape[0] != 3 or min(shape[1:]) < 1:
        raise ValueError('Decoded video must be RGB [3, frames, height, width].')
    if str(video.dtype) not in ('uint8', 'torch.uint8'):
        raise ValueError('Only the decoded uint8 RGB representation is supported.')
    if type(count) is not int or not 1 <= count <= min(shape[1], MAX_CONTEXT_FRAMES):
        raise ValueError('Checkpoint must contain 1–120 available frames.')
    if type(audio_start_frame) is not int or not 0 <= audio_start_frame < shape[1]:
        raise ValueError('Invalid explicit decoded-audio origin.')
    if timeline_end_frame is None:
        timeline_end_frame = shape[1]
    if type(timeline_end_frame) is not int or timeline_end_frame < count:
        raise ValueError('Invalid global timeline boundary.')
    destination = Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError('Checkpoint destination already exists; preserve immutable media.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    start = shape[1] - count
    audio_range = None
    if audio is not None:
        if type(sample_rate) is not int or not 8000 <= sample_rate <= 384000:
            raise ValueError('Decoded audio requires its exact sample rate.')
        if start < audio_start_frame:
            raise ValueError('Decoded audio does not cover the complete context tail.')
        # Only a bounded view is copied. Do not materialize the full audio tensor.
        a0 = sample_boundary(start - audio_start_frame, sample_rate)
        a1 = sample_boundary(shape[1] - audio_start_frame, sample_rate)
        if len(audio.shape) not in (1, 2) or len(audio) < a1:
            raise ValueError('Decoded audio is not aligned time-major coverage for this tail.')
        channels = 1 if len(audio.shape) == 1 else int(audio.shape[1])
        if not 1 <= channels <= 8:
            raise ValueError('Unsupported decoded audio channel layout.')
        audio_range = (a0, a1, channels)
    ffmpeg = os.environ.get('FFMPEG_BIN', 'ffmpeg')
    with tempfile.TemporaryDirectory(prefix='.continuation-', dir=destination.parent) as work:
        work = Path(work)
        raw_video = work / 'video.mkv'
        # stderr is a file to avoid pipe-buffer deadlock while streaming RGB.
        with open(work / 'ffmpeg.log', 'wb+') as log:
            process = subprocess.Popen([ffmpeg, '-v', 'error', '-nostdin', '-f', 'rawvideo',
                '-pixel_format', 'rgb24', '-video_size', f'{shape[3]}x{shape[2]}',
                '-framerate', str(FPS), '-i', 'pipe:0', '-an', '-c:v', 'ffv1',
                '-level', '3', '-pix_fmt', 'bgr0', '-threads', '1', str(raw_video)],
                stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=log)
            try:
                for frame in range(start, shape[1]):
                    pixels = _numpy(video[:, frame, :, :])
                    process.stdin.write(np.moveaxis(pixels, 0, -1).tobytes(order='C'))
                process.stdin.close()
                if process.wait(timeout=120):
                    log.seek(0)
                    raise ValueError('Lossless RGB encoding failed: ' + log.read().decode(errors='replace')[-2000:])
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
        final = raw_video
        if audio_range:
            a0, a1, channels = audio_range
            raw_audio = work / 'audio.f32'
            with open(raw_audio, 'wb') as f:
                for i in range(a0, a1, 8192):
                    samples = _numpy(audio[i:min(i + 8192, a1)])
                    if not np.isfinite(samples).all():
                        raise ValueError('Decoded audio contains nonfinite samples.')
                    f.write(samples.astype('<f4', copy=False).tobytes(order='C'))
            final = work / 'checkpoint.mkv'
            _run([ffmpeg, '-v', 'error', '-nostdin', '-i', str(raw_video), '-f', 'f32le',
                '-ar', str(sample_rate), '-ac', str(channels), '-i', str(raw_audio),
                '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'pcm_f32le',
                str(final)])
        probe = json.loads(_run([os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error',
            '-count_frames', '-show_streams', '-of', 'json', str(final)]))
        stream = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        if int(stream['nb_read_frames']) != count or stream['codec_name'] != 'ffv1':
            raise ValueError('Checkpoint frame verification failed.')
        final.chmod(0o600)
        # Hard-link publication refuses overwrite even if another writer raced.
        os.link(final, destination)
    return {'version': 1, 'representation': 'decoded-rgb8', 'codec': 'ffv1', 'fps': FPS,
        'frames': count, 'width': shape[3], 'height': shape[2], 'sha256': _sha(destination),
        'source_start_frame': start, 'source_end_frame': shape[1],
        'timeline_start_frame': timeline_end_frame - count, 'timeline_end_frame': timeline_end_frame,
        'audio': None if not audio_range else {'codec': 'pcm_f32le', 'sample_rate': sample_rate,
            'channels': audio_range[2], 'samples': audio_range[1] - audio_range[0],
            'source_start_sample': audio_range[0], 'source_end_sample': audio_range[1],
            'source_origin_frame': audio_start_frame}}
