"""Owned bounded continuation support. No renderer calls or queue mutation.

Installed API evidence is documented in docs/WANGP-DECODED-API.md. A checkpoint
failure never forfeits the viewing output or authorizes another generation.
"""
from pathlib import Path
import json
import math
import os
import subprocess
import tempfile

from .continuation_media import write_decoded_tail, sample_boundary, _sha


def bounded_spec(task):
    value = task.get('_director_bounded')
    if value is None:
        return None
    keys = {'timeline_start_frame', 'context_frames', 'new_frames', 'checkpoint_frames'}
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError('Invalid bounded continuation specification.')
    if any(type(value[k]) is not int or value[k] < 0 for k in keys):
        raise ValueError('Bounded frame boundaries must be nonnegative integers.')
    if (not 1 <= value['new_frames'] <= 3000 or
            value['context_frames'] > min(120, value['timeline_start_frame']) or
            value['checkpoint_frames'] > min(120, value['timeline_start_frame'] + value['new_frames'])):
        raise ValueError('Bounded continuation exceeds its frame limits.')
    if task.get('video_length') != value['new_frames']:
        raise ValueError('Bounded new-frame count must match the submitted video duration.')
    if task.get('multi_prompts_gen_type') != 'PW' or task.get('mode') not in (None, '', 'generate'):
        raise ValueError('Bounded continuation requires one managed video task.')
    for key in ('spatial_upsampling', 'temporal_upsampling', 'postprocess_audio', 'audio_source'):
        if task.get(key):
            raise ValueError('Bounded checkpoints require unprocessed generated video/audio: ' + key)
    if bool(task.get('_director_continuation')) != bool(value['context_frames']):
        raise ValueError('Bounded context source and overlap must agree.')
    return dict(value)


def audio_info(path):
    result = subprocess.run([os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error',
        '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate,channels',
        '-of', 'json', str(path)], capture_output=True, check=True, timeout=30)
    streams = json.loads(result.stdout).get('streams', [])
    if not streams:
        return None
    rate, channels = int(streams[0]['sample_rate']), int(streams[0]['channels'])
    if not 8000 <= rate <= 384000 or not 1 <= channels <= 8:
        raise ValueError('Unsupported continuation audio format.')
    return {'sample_rate': rate, 'channels': channels}


def extract_owned_tail(source, destination, *, end, count, probe):
    """Decode only a saved source range; cache owner calls this once per range.

    This cannot restore pre-encode tensors. FFmpeg streams decoding instead of
    retaining an episode in RAM. Frame-domain trim avoids inaccurate keyframe cuts.
    """
    if type(end) is not int or type(count) is not int or not 1 <= count <= 120 or end < count:
        raise ValueError('Invalid saved-footage tail range.')
    meta = probe(source)
    if abs(meta['fps'] - 24) > .01 or end > meta['frames']:
        raise ValueError('Tail is outside its owned 24-fps source.')
    destination = Path(destination)
    destination.parent.mkdir(exist_ok=True, parents=True)
    info = audio_info(source)
    # Seek to an exact whole-second boundary with ten seconds of preroll, then
    # trim on the 24-fps grid. Avoid decoding an episode merely to obtain its tail.
    seek_seconds = max(0, (end-count)//24 - 10)
    shift_frames = seek_seconds*24
    with tempfile.TemporaryDirectory(prefix='.saved-tail-', dir=destination.parent) as tmp:
        out = Path(tmp) / 'tail.mkv'
        args = [os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-nostdin',
            '-ss', str(seek_seconds), '-i', str(source),
            *(['-i', str(source)] if info else []), '-map', '0:v:0', '-vf',
            f'trim=start_frame={end-count-shift_frames}:end_frame={end-shift_frames},setpts=PTS-STARTPTS',
            '-c:v', 'ffv1', '-pix_fmt', 'bgr0', '-threads', '1']
        if info:
            rate = info['sample_rate']
            # Audio uses an unseeked demux input and exact sample-domain trim.
            # Seeking compressed audio can shift its first decoded packet/sample.
            args += ['-map', '1:a:0', '-af',
                f'atrim=start_sample={sample_boundary(end-count, rate)}:end_sample={sample_boundary(end, rate)},asetpts=PTS-STARTPTS',
                '-c:a', 'pcm_f32le']
        args += [str(out)]
        result = subprocess.run(args, capture_output=True, timeout=600)
        if result.returncode:
            raise ValueError('Saved-footage tail extraction failed; original retained.')
        check = probe(out)
        if check['frames'] != count or abs(check['fps'] - 24) > .01:
            raise ValueError('Saved-footage tail frame verification failed.')
        if info:
            checked_audio = audio_info(out)
            counts = subprocess.run([os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error',
                '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=nb_samples',
                '-of', 'json', str(out)], capture_output=True, check=True, timeout=30)
            samples = sum(int(f.get('nb_samples', 0)) for f in json.loads(counts.stdout).get('frames', []))
            expected = sample_boundary(end, info['sample_rate'])-sample_boundary(end-count, info['sample_rate'])
            if checked_audio != info or samples != expected:
                raise ValueError('Saved-footage tail has incomplete or changed audio coverage.')
            info = {**info, 'samples': samples,
                    'source_start_sample': sample_boundary(end-count, info['sample_rate']),
                    'source_end_sample': sample_boundary(end, info['sample_rate'])}
        out.chmod(0o600)
        os.link(out, destination)
    return {'representation': 'decoded-from-saved-footage', 'frames': count,
            'source_start_frame': end-count, 'source_end_frame': end,
            'sha256': _sha(destination), 'audio': info}


def select_artifact(result, client_id, path):
    matches = [a for a in (getattr(result, 'artifacts', ()) or ())
        if getattr(a, 'client_id', None) == client_id and getattr(a, 'path', None)
        and Path(a.path).resolve() == Path(path).resolve()]
    if len(matches) != 1:
        raise ValueError('No unique decoded artifact for this exact task and output. Stock WanGP must expose return_media RGB8/PCM for exact bounded continuation. Preserve the viewing take; explicitly start a new suffix from saved footage or use an independently verified compatible API. No upstream patch is applied automatically.')
    a = matches[0]
    fps = getattr(a, 'fps', None)
    if (getattr(a, 'media_type', None) != 'video' or getattr(a, 'hdr', False)
            or not isinstance(fps, (int, float)) or not math.isfinite(fps) or abs(fps-24) > .01
            or getattr(a, 'video_tensor_uint8', None) is None):
        raise ValueError('Decoded artifact is not supported 24-fps RGB8 video.')
    return a


def persist_artifact_tail(artifact, destination, *, spec, actual_frames, source=None,
                          source_representation='decoded-rgb8'):
    """Persist exact RGB/new PCM with declared preceding-context provenance."""
    import numpy as np
    if source_representation not in ('decoded-rgb8', 'decoded-from-saved-footage'):
        raise ValueError('Unknown preceding checkpoint representation.')
    video = artifact.video_tensor_uint8
    if len(video.shape) != 4 or video.shape[1] != actual_frames:
        raise ValueError('Decoded video and archived viewing file frame counts disagree. Viewing take preserved; explicitly start a saved-footage suffix or separately review the optional mux enhancement. No automatic retry or upstream patch.')
    context = spec['context_frames']
    if actual_frames <= context or abs(actual_frames - context - spec['new_frames']) > 4:
        raise ValueError('Decoded output differs from its bounded task geometry.')
    count = spec['checkpoint_frames']
    if not count:
        return None
    new_frames = actual_frames - context
    audio, rate = getattr(artifact, 'audio_tensor', None), getattr(artifact, 'audio_sampling_rate', None)
    tail_start = actual_frames - count
    origin = context
    preceding_provenance = None
    if count > new_frames:
        if source is None:
            raise ValueError('Checkpoint needs preceding decoded context, which is unavailable.')
        probe_result = subprocess.run([os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error',
            '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames,width,height',
            '-of', 'json', str(source)], capture_output=True, check=True, timeout=60)
        source_video = json.loads(probe_result.stdout)['streams'][0]
        source_frames = int(source_video['nb_read_frames'])
        old_frames = count - new_frames
        preceding_provenance = {'representation': source_representation, 'frames': old_frames}
        if source_frames < old_frames:
            raise ValueError('Saved decoded context is too short for the next overlap.')
        info = audio_info(source)
        if bool(info) != (audio is not None):
            raise ValueError('Cross-boundary checkpoint audio coverage changes; inspect before continuing.')
        if audio is not None:
            channels = 1 if len(audio.shape) == 1 else int(audio.shape[1])
            if info['channels'] != channels:
                raise ValueError('Cross-boundary checkpoint audio rates/channels disagree.')
            source_rate = info['sample_rate']
            resample = source_rate != rate
            # Only a declared saved-footage derivative may be converted. Never
            # resample original decoded-output PCM to hide an incompatible API
            # rate, and never change the newly returned generated samples.
            if resample and source_representation != 'decoded-from-saved-footage':
                raise ValueError('Cross-boundary checkpoint audio rates/channels disagree.')
            new_count = sample_boundary(new_frames, rate)
            old_count = sample_boundary(count, rate) - new_count
            end_sample = sample_boundary(source_frames, rate)
            start_sample = end_sample - old_count
            result = subprocess.run([os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error',
                '-nostdin', '-i', str(source), '-map', '0:a:0', '-af',
                (f'aresample={rate},' if resample else '') +
                f'atrim=start_sample={start_sample}:end_sample={end_sample}',
                '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], capture_output=True, check=True, timeout=60)
            old = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, channels)
            if len(old) != old_count or len(audio) < new_count:
                raise ValueError('Cross-boundary checkpoint has incomplete PCM coverage.')
            audio = np.concatenate([old, np.asarray(audio[:new_count], dtype=np.float32).reshape(-1, channels)], axis=0)
            preceding_provenance = {
                'representation': source_representation, 'frames': old_frames,
                'audio': {'input_sample_rate': source_rate, 'output_sample_rate': rate,
                          'transform': 'ffmpeg-aresample' if resample else 'identity',
                          'output_start_sample': start_sample,
                          'output_end_sample': end_sample, 'samples': old_count}}
        if count > actual_frames:
            # Decode only the extra retained RGB frames. Access the generated
            # tensor one frame at a time through a view; never concatenate it.
            extra = count - actual_frames
            if (int(source_video['height']), int(source_video['width'])) != tuple(video.shape[2:]):
                raise ValueError('Cross-boundary checkpoint dimensions changed.')
            first, last = source_frames-old_frames, source_frames-context
            result = subprocess.run([os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error',
                '-nostdin', '-i', str(source), '-map', '0:v:0', '-vf',
                f'trim=start_frame={first}:end_frame={last},setpts=PTS-STARTPTS', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                'pipe:1'], capture_output=True, check=True, timeout=60)
            old_video = np.frombuffer(result.stdout, dtype=np.uint8).reshape(extra, video.shape[2], video.shape[3], 3)
            original = video
            class JoinedFrames:
                shape = (3, count, original.shape[2], original.shape[3])
                dtype = 'uint8'
                def __getitem__(self, key):
                    c, frame, *spatial = key
                    value = old_video[frame].transpose(2, 0, 1) if frame < extra else original[:, frame-extra]
                    return value[(c, *spatial)]
            video = JoinedFrames()
            actual_frames = count
            tail_start = 0
        origin = tail_start
    metadata = write_decoded_tail(video, destination, count=count, audio=audio,
        sample_rate=rate, audio_start_frame=origin,
        timeline_end_frame=spec['timeline_start_frame'] + new_frames)
    if preceding_provenance:
        metadata['provenance'] = {'generated_audio': 'api-decoded-pcm-unchanged' if
                                  getattr(artifact, 'audio_tensor', None) is not None else None,
                                  'preceding': preceding_provenance}
        metadata['contains_saved_footage'] = source_representation == 'decoded-from-saved-footage'
    return metadata
