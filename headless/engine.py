"""Persistent local render queue over WanGP's public, in-process Python API.

No Gradio import, browser callback, polling-triggered submission, or second WebUI
runtime. Only the observation adapter reads optional session._state metadata.
SQLite records intent before calling the renderer; interrupted work is never
replayed on restart. Jobs accepted while the service is live run FIFO.
"""
from __future__ import annotations
import copy
import hashlib
import json
import math
import mimetypes
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import stat
import subprocess
import threading
import time
import uuid

from .telemetry import JobTelemetry, positive
from .bounded_media import bounded_spec, extract_owned_tail, select_artifact, persist_artifact_tail, audio_info
from .continuation_media import choose_appearance_frame, write_appearance_frame
from .reference_images import ReferenceImageSupport, IMAGE_EXTENSIONS, image_probe
from .music import MusicSupport
from .reference_voices import ReferenceVoiceSupport, AUDIO_EXTENSIONS, audio_probe

VERSION = '2.3.0'
TERMINAL = {'completed', 'failed', 'cancelled'}
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.avif', '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac', '.opus'}
VIDEO_EXTENSIONS = {'.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v'}
MEDIA_KEYS = {'image_refs', 'video_guide', 'video_guide2', 'audio_guide', 'audio_guide2', 'audio_guide3'}
CLEAR_MEDIA = {'image_start', 'image_end', 'video_source', 'video_mask', 'image_guide', 'image_mask', 'audio_source', 'spatial_upsampler_reference_images', 'replace_voice_sample', 'replace_voice_sample2'}


# These names are not Director H3 conditioning inputs. Older workers injected both
# as None while clearing unused attachments. WanGP's strict settings validator
# rejects even unset, unknown keys. Never rename audio_file to audio_scale: the
# latter is numeric strength; voices belong in audio_guide/audio_guide2/audio_guide3.
LEGACY_EMPTY_MEDIA = ('mask', 'audio_file')


def normalize_generation_settings(settings):
    """Return a dispatch copy without obsolete empty Director placeholders.

    Limit compatibility handling to these exact keys and empty values. Do not
    guess aliases, move unknown keys to custom_settings, alter real media, or
    rewrite the saved payload/resolved task. Nonempty legacy inputs need a human
    decision instead of silent data loss.
    """
    result = copy.deepcopy(settings)
    for key in LEGACY_EMPTY_MEDIA:
        if key not in result:
            continue
        value = result[key]
        if value is not None and not (isinstance(value, str) and value == ''):
            destination = 'audio_guide/audio_guide2' if key == 'audio_file' else 'image_mask/video_mask'
            raise ValueError(
                "Unsupported nonempty setting '" + key + "'. Director cannot safely map this media. "
                "Use the supported " + destination + " controls; no input has been silently discarded."
            )
        del result[key]
    return result


def json_text(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))


def fingerprint(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError('Symlink media is not accepted.')
    s = path.stat()
    if not stat.S_ISREG(s.st_mode) or s.st_size <= 0:
        raise ValueError('Media must be a nonempty regular file.')
    return (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)


def probe_video(path):
    """Read container frame count first; decode/count only when it is unavailable."""
    def run(count=False):
        args = [os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error', '-select_streams', 'v:0']
        if count:
            args += ['-count_frames']
        args += ['-show_entries', 'stream=avg_frame_rate,r_frame_rate,nb_frames,nb_read_frames,width,height', '-of', 'json', str(path)]
        completed = subprocess.run(args, check=True, capture_output=True, timeout=180)
        return json.loads(completed.stdout).get('streams', [{}])[0]
    try:
        v = run()
        if not str(v.get('nb_frames', '')).isdigit():
            v = run(True)
        fps_text = str(v.get('avg_frame_rate') or v.get('r_frame_rate') or '0/1')
        n, _, d = fps_text.partition('/')
        fps = float(n) / float(d or 1)
        frames = int(v.get('nb_read_frames') or v.get('nb_frames') or 0)
        if not math.isfinite(fps) or fps <= 0 or frames <= 0:
            raise ValueError('No usable video stream/frame count.')
        return {'fps': fps, 'frames': frames, 'width': v.get('width'), 'height': v.get('height')}
    except (ValueError, OSError, subprocess.SubprocessError, ZeroDivisionError, IndexError) as exc:
        raise ValueError('Cannot inspect video with ffprobe: ' + str(exc)[:300]) from exc


class HeadlessEngine(ReferenceImageSupport, ReferenceVoiceSupport, MusicSupport):
    def __init__(self, data_dir, *, session=None, probe=probe_video, start_dispatcher=True):
        self.root = Path(data_dir).expanduser().resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root.chmod(0o700)
        for name in ('uploads', 'outputs', 'previews', 'continuations'):
            (self.root/name).mkdir(exist_ok=True, mode=0o700)
        self.lock = threading.RLock()
        self.wake = threading.Condition(self.lock)
        self.output_lock = threading.Lock()
        self.db = sqlite3.connect(str(self.root/'queue.sqlite3'), check_same_thread=False)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE,
            digest TEXT NOT NULL, created REAL NOT NULL, document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS outputs (id TEXT PRIMARY KEY, document TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        ''')
        self.db.commit()
        self.jobs, self.media, self.outputs = {}, {}, {}
        self.session = session
        self.bounded_api_verified = False
        self.probe = probe
        self.runtime_state = 'ready' if session is not None else 'initializing'
        self.runtime_error = None
        self.runtime_info = {}
        self.model_cache = {}
        self.metadata_cache = []
        self.closed = False
        self.active_id = None
        self.dispatcher = None
        # WanGP keeps the last model pinned in RAM (about 20 GB for H3) while idle.
        # Release it after this many idle seconds; 0 disables. The next job reloads it.
        try:
            self.idle_release_seconds = max(0.0, float(os.environ.get('H3_IDLE_RELEASE_SECONDS', '900')))
        except ValueError:
            self.idle_release_seconds = 900.0
        self.model_resident = False
        self.release_requested = False
        self.idle_since = time.monotonic()
        self.last_release = None
        with self.lock:
            row = self.db.execute("SELECT value FROM meta WHERE key='paused'").fetchone()
            self.paused = bool(json.loads(row[0])) if row else False
            for key, doc in self.db.execute('SELECT id,document FROM media'):
                self.media[key] = json.loads(doc)
            for key, doc in self.db.execute('SELECT id,document FROM outputs'):
                self.outputs[key] = json.loads(doc)
            recovered = False
            for key, doc in self.db.execute('SELECT id,document FROM jobs ORDER BY created'):
                item = json.loads(doc)
                item.update(job=None, tracker=None)
                self.jobs[key] = item
                state = item['state']
                if state['status'] not in TERMINAL:
                    recovered = True
                    if state['status'] == 'queued':
                        state['message'] = 'Queued work recovered; resume the server queue explicitly.'
                    else:
                        state.update(status='failed', interrupted=True, finished_at=time.time(),
                                     message='Renderer service stopped during this job. No GPU work was automatically replayed.',
                                     errors=['Interrupted render: inspect existing outputs before deliberately creating a new take.'])
                    if state.get('telemetry'):
                        state['telemetry']['status'] = state['status']
                    self._save_job(key)
            if recovered:
                self.paused = True
            self._save_pause()
        if session is not None:
            self._cache_metadata()
        if start_dispatcher:
            self.dispatcher = threading.Thread(target=self._dispatch, name='h3-headless-dispatch', daemon=True)
            self.dispatcher.start()

    def _release_model(self):
        """Free WanGP's pinned model RAM/VRAM between jobs. Called by the dispatcher (no job running)."""
        with self.lock:
            reason = 'requested' if self.release_requested else 'idle'
            self.release_requested = False
            self.model_resident = False
        try:
            close = getattr(self.session, 'close', None)
            if callable(close):
                close()
            self.last_release = {'at': time.time(), 'reason': reason}
        except Exception as exc:
            self.last_release = {'at': time.time(), 'reason': reason, 'error': str(exc)[:300]}

    def request_release(self):
        with self.wake:
            if self.active_id:
                raise ValueError('A job is running. Model memory is released after it finishes and the queue is idle.')
            resident = self.model_resident
            self.release_requested = resident
            self.wake.notify_all()
        return {'requested': resident, 'model_resident': resident,
                'message': 'Releasing the loaded model; the next job reloads it.' if resident else 'No model is loaded.'}

    def _save_pause(self, value=None):
        self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)', ('paused', json_text(self.paused if value is None else bool(value))))
        self.db.commit()

    def _save_job(self, job_id):
        item = self.jobs[job_id]
        if item.get('tracker'):
            item['state']['telemetry'] = item['tracker'].snapshot()
        value = {k: v for k, v in item.items() if k not in {'job', 'tracker'}}
        self.db.execute('INSERT OR REPLACE INTO jobs VALUES (?,?,?,?,?)',
                        (job_id, item.get('request_id'), item.get('digest', ''), item['state']['created_at'], json_text(value)))
        self.db.commit()

    def set_session(self, session, info=None):
        if getattr(session, '_use_webui_queue', False):
            raise ValueError('Headless service refuses a browser-bound WanGP session.')
        if not callable(getattr(session, 'submit_task', None)):
            raise ValueError('Installed WanGP Session lacks submit_task; select a compatible installation. No generation was started.')
        self.session = session
        self.bounded_api_verified = False
        self.runtime_info = dict(info or {})
        self._cache_metadata()
        with self.wake:
            self.runtime_state = 'ready'
            self.runtime_error = None
            self.wake.notify_all()

    def initialization_failed(self, message):
        with self.wake:
            self.runtime_state = 'error'
            self.runtime_error = str(message)
            self.wake.notify_all()

    def _cache_metadata(self):
        values = self.session.list_model_metadata(query='H3', limit=500, offset=0)
        self.metadata_cache = [m for m in values if isinstance(m, dict)]

    def model_info(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('Choose an actual model_type discovered from WanGP.')
        with self.lock:
            if model_type in self.model_cache:
                return copy.deepcopy(self.model_cache[model_type])
            if self.runtime_state not in {'ready', 'initializing'} or self.session is None:
                raise ValueError('WanGP is not ready: ' + str(self.runtime_error or self.runtime_state))
            if self.active_id:
                raise ValueError('This preset is not cached. Discover it after the active render finishes.')
            meta = self.session.get_model_metadata(model_type)
            if not meta:
                raise ValueError('Unknown WanGP preset. Rediscover installed models.')
            definitions = self.session.list_model_defs(model_type=model_type)
            definition = next((d for d in definitions if d.get('model_type') == model_type), definitions[0] if definitions else {})
            identity = (model_type+' '+str(meta.get('name', ''))).lower()
            combined = json_text([meta, definition]).lower()
            if not ('h3' in combined and 'ref2va' in combined) or any(x in identity for x in ('tts', 'fl2va', 'viggle')):
                raise ValueError('This editor submits H3 Ref2VA video presets, not FL2VA/TTS/Viggle.')
            nested = definition.get('model') or {}
            pdd = bool(definition.get('pdd') or (nested.get('pdd') if isinstance(nested, dict) else False) or 'pdd' in identity)
            getter = getattr(self.session, 'get_exported_default_settings', None) or self.session.get_default_settings
            info = {'metadata': meta, 'defaults': getter(model_type), 'schema': self.session.get_model_schema(model_type),
                    'profile': {'inference_mode': 'pdd8' if pdd else 'standard', 'steps_locked': pdd,
                                'samplers': ['euler'] if pdd else ['euler', 'res_multistep', 'ralston_2s'],
                                'max_phases': 1 if pdd else 2, 'continuation': True}}
            info['director_profile'] = copy.deepcopy(info['profile'])
            self.model_cache[model_type] = info
            return copy.deepcopy(info)

    def uploaded_path(self, media_id):
        media = self.media.get(media_id) if isinstance(media_id, str) else None
        if not media or tuple(media.get('stat', [])) != fingerprint(media['path']):
            raise ValueError('Missing or changed upload. Upload the reference again; server file paths are not accepted.')
        return media['path']

    def resolve_task(self, task):
        if not isinstance(task, dict):
            raise ValueError('Each task must be a settings object.')
        if task.get('mode') == 'music':
            return self.resolve_music(task)
        if task.get('mode') == 'reference_voice':
            return self.resolve_reference_voice(task)
        if task.get('mode') == 'reference_image':
            return self.resolve_reference_image(task)
        if task.get('mode') == 'edit_postprocessing':
            return self.resolve_postprocess(task)
        if task.get('mode') not in (None, '', 'generate'):
            raise ValueError('Unsupported task mode.')
        profile = self.model_info(task.get('model_type'))['profile']
        steps, phases = task.get('num_inference_steps'), task.get('guidance_phases', 1)
        if type(steps) is not int or not 1 <= steps <= 200:
            raise ValueError('Steps must be an integer from 1 to 200.')
        if profile['steps_locked'] and (steps != 8 or task.get('sample_solver') != 'euler'):
            raise ValueError('PDD-8 requires eight-step Euler settings.')
        if task.get('sample_solver') not in profile['samplers'] or type(phases) is not int or not 1 <= phases <= profile['max_phases']:
            raise ValueError('Unsupported H3 sampler/phase configuration.')
        if not isinstance(task.get('prompt'), str) or not task['prompt'].strip():
            raise ValueError('A nonempty compiled prompt is required.')
        task = normalize_generation_settings(task)
        result = {k: copy.deepcopy(v) for k, v in task.items() if not k.startswith('_') and k not in {'model_def', 'frame_scheduler', 'client_id', 'output_dir'}}
        for key in CLEAR_MEDIA:
            result[key] = None
        def resolve(media_id, allow_appearance=False):
            if media_id is None or media_id == '':
                return None
            if isinstance(media_id, str) and re.fullmatch(r'h3appearance:[a-f0-9]{32}:[a-f0-9]{32}', media_id):
                if not allow_appearance:
                    raise ValueError('Appearance anchors are image references only.')
                _, owner, output = media_id.split(':')
                record = self.output_record(owner, output)
                if record.get('media_kind') != 'image' or record.get('context_only') != 'appearance' or not self.output_available(record):
                    raise ValueError('Appearance anchor is unavailable or changed.')
                return record['path']
            return self.uploaded_path(media_id)
        for key in MEDIA_KEYS:
            val = result.get(key)
            if key == 'image_refs':
                if val is not None and not isinstance(val, list):
                    raise ValueError('image_refs must contain upload IDs.')
                if len(val or []) > 9:
                    raise ValueError('H3 permits at most nine image references; pinned sources are never displaced.')
                result[key] = [resolve(x, allow_appearance=True) for x in (val or [])]
            else:
                result[key] = resolve(val)
        result.update(force_fps='24', sliding_window_trim_first_frames=0,
                      sliding_window_discard_last_frames=0, repeat_generation=1, prompt_enhancer='')
        bounded = bounded_spec(task)
        if bounded:
            capture = task.get('_director_appearance_capture')
            if capture is not None and (not isinstance(capture, dict) or set(capture) != {'start_frame'} or type(capture.get('start_frame')) is not int or not 0 <= capture['start_frame'] < bounded['context_frames']+bounded['new_frames']):
                raise ValueError('Invalid appearance-anchor capture range.')
            result['_api'] = {'return_media': True}
        source = task.get('_director_continuation')
        if source:
            if not isinstance(source, dict) or type(source.get('keepFrames')) is not int or source['keepFrames'] < 1:
                raise ValueError('Invalid continuation boundary.')
            record = self.output_record(source.get('jobId'), source.get('outputId'))
            if not self.output_available(record):
                raise ValueError('Continuation archive is unavailable or changed.')
            probe = record.get('probe') or self.probe(record['path'])
            if abs(probe['fps']-24) > .01 or source['keepFrames'] > probe['frames']:
                raise ValueError('Continuation boundary exceeds this 24-fps source.')
            # Immutable owned archive survives gallery cleanup and service restarts.
            context_path = self.bounded_source(record, source['keepFrames'], bounded['context_frames']) if bounded else record['path']
            result.update(video_source=context_path, image_prompt_type='V', keep_frames_video_source=str(bounded['context_frames'] if bounded else source['keepFrames']))
        soundtrack = task.get('_director_soundtrack')
        if soundtrack is not None or result.get('audio_prompt_type') == 'AS':
            if not isinstance(soundtrack, dict) or set(soundtrack) != {'start_seconds', 'duration_seconds'} or result.get('audio_prompt_type') != 'AS':
                raise ValueError("A kept soundtrack needs audio_prompt_type 'AS' and a _director_soundtrack slice.")
            if not result.get('audio_guide') or result.get('audio_guide2') or result.get('audio_guide3'):
                raise ValueError('A kept soundtrack uses audio_guide only, with no other audio references.')
            prefix = int(result.get('keep_frames_video_source') or 0)
            result['audio_guide'] = self.soundtrack_slice(result['audio_guide'], soundtrack['start_seconds'], soundtrack['duration_seconds'], prefix)
        return result

    def soundtrack_slice(self, path, start, duration, prefix_frames=0):
        """Cut an owned upload into the kept 'AS' track. WanGP aligns it with source-video frame 0,
        so the cut begins prefix_frames earlier (leading silence when that is before the asset start)."""
        if any(type(x) not in (int, float) or not math.isfinite(x) for x in (start, duration)) or start < 0 or not 0 < duration <= 3600:
            raise ValueError('Invalid soundtrack slice.')
        if Path(path).suffix.lower() not in AUDIO_EXTENSIONS:
            raise ValueError('A kept soundtrack must be an uploaded audio file.')
        meta = audio_probe(path, max_duration=86400)
        if start + duration > meta['duration'] + 1e-3:
            raise ValueError('Soundtrack slice %.3f-%.3fs exceeds the %.3fs asset.' % (start, start + duration, meta['duration']))
        lead = start - prefix_frames / 24
        pad, offset, total = max(0.0, -lead), max(0.0, lead), prefix_frames / 24 + duration
        key = hashlib.sha256(json_text([fingerprint(path), round(offset, 6), round(pad, 6), round(total, 6)]).encode()).hexdigest()
        dest = self.root/'soundtracks'/(key+'.wav')
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.stem+'.'+uuid.uuid4().hex+'.tmp.wav')
            filters = ('adelay=%d:all=1,' % round(pad*1000) if pad else '') + 'apad'
            subprocess.run([os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-nostdin', '-ss', '%.6f' % offset, '-i', str(path),
                            '-map', '0:a:0', '-af', filters, '-t', '%.6f' % total, '-c:a', 'pcm_s16le', str(tmp)],
                           check=True, capture_output=True, timeout=120)
            os.replace(tmp, dest)
        if abs(audio_probe(dest, max_duration=total + 1)['duration'] - total) > .05:
            raise ValueError('Soundtrack slice has the wrong length.')
        return str(dest)

    def resolve_postprocess(self, task):
        """Narrow late-upscale task over an immutable owned upload. No arbitrary paths."""
        if task.get('spatial_upsampling') not in {'flashvsr*2', 'flashvsr*4', 'lanczos*2', 'lanczos*4'}:
            raise ValueError('Unsupported late upscaler.')
        if not callable(getattr(self.session, 'submit_media_postprocessing', None)):
            raise ValueError('This WanGP installation does not expose late postprocessing. Update WanGP first.')
        media = self.media.get(task.get('video_source')) if isinstance(task.get('video_source'), str) else None
        if not media or Path(media['path']).suffix.lower() not in VIDEO_EXTENSIONS or tuple(media['stat']) != fingerprint(media['path']):
            raise ValueError('Upload an unchanged video before postprocessing; server paths are not accepted.')
        meta = self.probe(media['path'])
        start, end = task.get('start_frame', 0), task.get('end_frame', meta['frames'])
        if type(start) is not int or type(end) is not int or start < 0 or end <= start or end > meta['frames'] or end-start > 3000 or abs(meta['fps']-24) > .01:
            raise ValueError('Late upscale needs a valid 24-fps range of at most 3000 frames. Use chunked finishing for a long film.')
        source = media['path']
        if start or end != meta['frames']:
            source += '|start_frame='+str(start)+',end_frame='+str(end-1)
        return {'mode': 'edit_postprocessing', 'video_source': source,
                'spatial_upsampling': task['spatial_upsampling'], 'temporal_upsampling': '',
                'film_grain_intensity': 0, 'force_fps': '24', 'repeat_generation': 1}

    def register_upload(self, path, name, content_type):
        path = Path(path).resolve()
        if path.parent != self.root/'uploads' or path.suffix.lower() not in EXTENSIONS:
            raise ValueError('Upload path is not owned by this service.')
        media_id = 'h3media:'+uuid.uuid4().hex
        value = {'path': str(path), 'name': str(name)[:255], 'type': content_type,
                 'size': path.stat().st_size, 'stat': fingerprint(path)}
        with self.lock:
            self.media[media_id] = value
            self.db.execute('INSERT INTO media VALUES (?,?)', (media_id, json_text(value)))
            self.db.commit()
        return {'media_id': media_id, 'name': value['name'], 'size': value['size']}

    def submit(self, payload):
        if not isinstance(payload, dict):
            raise ValueError('Submission must be an object.')
        request_id = payload.get('request_id')
        if request_id is not None and (not isinstance(request_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', request_id)):
            raise ValueError('Invalid idempotency request ID.')
        digest = hashlib.sha256(json_text(payload).encode()).hexdigest()
        with self.wake:
            if request_id:
                previous = next((k for k, j in self.jobs.items() if j.get('request_id') == request_id), None)
                if previous:
                    if self.jobs[previous]['digest'] != digest:
                        raise ValueError('This request ID belongs to a different payload. No new work submitted.')
                    return self.job_state(previous)
            if self.closed or self.runtime_state != 'ready':
                raise ValueError('WanGP is not ready: '+str(self.runtime_error or self.runtime_state))
            tasks = payload.get('tasks')
            if not isinstance(tasks, list) or not 1 <= len(tasks) <= 10000:
                raise ValueError('tasks must be a nonempty settings array (maximum 10000).')
            if sum(j['state']['status'] not in TERMINAL for j in self.jobs.values()) >= 100:
                raise ValueError('Server queue is full (100 jobs).')
            music_tasks = [t for t in tasks if t.get('mode') == 'music']
            if music_tasks and (len(tasks) != 1 or len(music_tasks) != 1):
                raise ValueError('Music jobs contain exactly one original song.')
            voice_tasks = [t for t in tasks if t.get('mode') == 'reference_voice']
            if voice_tasks and (len(voice_tasks) != len(tasks) or len(tasks) > 8):
                raise ValueError('Voice jobs must contain only voice samples (maximum eight).')
            image_tasks = [t for t in tasks if t.get('mode') == 'reference_image']
            if image_tasks and (len(image_tasks) != len(tasks) or len(tasks) > 8):
                raise ValueError('Reference-image jobs must contain only images (maximum eight).')
            resolved = [self.resolve_task(t) for t in tasks]
            job_id = uuid.uuid4().hex
            client_ids = ['h3headless_'+job_id+'_'+str(i) for i in range(1, len(tasks)+1)]
            for task, cid in zip(resolved, client_ids):
                task['client_id'] = cid
            tracker = JobTelemetry(resolved, payload.get('plan'))
            state = {'job_id': job_id, 'status': 'queued', 'progress': 0, 'message': 'Queued on the headless server; no browser required.',
                     'created_at': time.time(), 'task_count': len(tasks), 'client_ids': client_ids, 'generated_files': [], 'errors': [],
                     'operation': 'music' if music_tasks else 'reference_voice' if voice_tasks else 'reference_image' if image_tasks else 'postprocess' if all(t.get('mode') == 'edit_postprocessing' for t in resolved) else 'generation',
                     'backend': 'headless', 'project_id': payload.get('project_id'), 'project_name': str(payload.get('project') or '')[:300],
                     'request_id': request_id, 'logs': []}
            self.jobs[job_id] = {'state': state, 'payload': copy.deepcopy(payload), 'resolved': resolved,
                                 'plan': payload.get('plan') or [], 'job': None, 'tracker': tracker,
                                 'outputs': [], 'seen': [], 'request_id': request_id, 'digest': digest}
            # Commit intent BEFORE renderer admission. On crash, never replay a running row.
            self._save_job(job_id)
            self.wake.notify_all()
            return self.job_state(job_id)

    def _dispatch(self):
        while True:
            with self.wake:
                while not self.closed:
                    candidates = [k for k, j in self.jobs.items() if j['state']['status'] == 'queued']
                    runnable = self.session is not None and self.runtime_state == 'ready' and not self.paused and candidates
                    if not runnable and self.model_resident and self.session is not None and (self.release_requested or (
                            self.idle_release_seconds and time.monotonic()-self.idle_since >= self.idle_release_seconds)):
                        job_id = None
                        break
                    if runnable:
                        job_id = candidates[0]
                        self.active_id = job_id
                        item = self.jobs[job_id]
                        item['tracker'] = item.get('tracker') or JobTelemetry(item['resolved'], item['plan'])
                        item['state'].update(status='submitted', message='Starting the headless WanGP API.', started_at=time.time())
                        self._save_job(job_id)
                        break
                    self.wake.wait(.5)
                if self.closed:
                    return
            if job_id is None:
                # Outside the engine lock: health/queue requests stay responsive while WanGP frees memory.
                self._release_model()
                continue
            try:
                self._run(job_id)
            except Exception as exc:
                with self.lock:
                    item = self.jobs[job_id]
                    item['state'].update(status='failed', message='Headless render failed: '+str(exc), errors=[str(exc)], finished_at=time.time())
                    item['tracker'].finish('failed')
                    self._save_job(job_id)
            finally:
                with self.wake:
                    self.jobs[job_id]['job'] = None
                    self.active_id = None
                    self.model_resident = True
                    self.idle_since = time.monotonic()
                    self.wake.notify_all()

    def _run(self, job_id):
        item = self.jobs[job_id]
        for ti, task in enumerate(item['resolved'], 1):
            with self.lock:
                if item['state']['status'] == 'cancelling' or self.closed:
                    break
                item['state']['task_index'] = ti
                item['state']['message'] = 'Submitting task '+str(ti)+' to WanGP.'
                self._save_job(job_id)
            # Old queued image jobs may contain a persisted resolved task from a
            # pre-1.9.2 worker. Normalize ONLY image dispatch copies; don't change
            # accepted/finished jobs, original payloads, or video window modes.
            if item['state'].get('operation') == 'reference_image':
                task = {**task, 'multi_prompts_gen_type': 'FG'}
            # Queued tasks restored from older workers have already-resolved
            # settings, including the obsolete null placeholders. Normalize the
            # dispatch copy too; keep SQLite payloads/history and request IDs intact.
            if item['state'].get('operation') not in {'reference_image', 'reference_voice', 'music', 'postprocess'}:
                task = normalize_generation_settings(task)
            # Official public API. No webui_state argument, no private dispatch hooks.
            job = self.session.submit_task(task)
            with self.lock:
                item['job'] = job
                if item['state']['status'] == 'cancelling' or self.closed:
                    job.cancel()
            last_collect = 0.0
            while True:
                event = job.events.get(timeout=.25)
                if event is not None:
                    self._event(job_id, ti, event)
                now = time.monotonic()
                if now-last_collect >= 1.0:
                    self.collect_outputs(job_id, ti)
                    last_collect = now
                if event is None and job.done:
                    break
            result = job.result()
            # Ensure API finalization finished before sending another task. Public
            # SessionJob.done can precede its cleanup by a few instructions.
            thread = getattr(job, '_thread', None)
            if thread is not None and thread is not threading.current_thread():
                thread.join(timeout=5)
            self.collect_outputs(job_id, ti)
            missing = []
            for path in result.generated_files or []:
                try:
                    self.archive_output(job_id, ti, path)
                except Exception as exc:
                    if Path(str(path)).suffix.lower() in VIDEO_EXTENSIONS | IMAGE_EXTENSIONS | AUDIO_EXTENSIONS:
                        missing.append(str(exc))
            spec = bounded_spec(item['payload']['tasks'][ti-1])
            if spec and result.success:
                try:
                    self.capture_bounded_artifact(job_id, ti, result, spec)
                except Exception as exc:
                    # Inference is already finished and viewing files retain owned
                    # output IDs. Report a recoverable checkpoint failure, never
                    # fail into a blind re-generation path.
                    missing.append('Decoded continuation checkpoint unavailable: ' + str(exc))
                    with self.lock:
                        item['state']['continuation_error'] = str(exc)
            with self.lock:
                state = item['state']
                state['generated_files'].extend(str(p) for p in (result.generated_files or []) if str(p) not in state['generated_files'])
                if missing:
                    state['archive_warnings'] = missing
                if not result.success:
                    cancelled = bool(getattr(result, 'cancelled', False)) or state['status'] == 'cancelling'
                    state.update(status='cancelled' if cancelled else 'failed', errors=[str(getattr(e, 'message', e)) for e in result.errors or []])
                    break
                item['job'] = None
                self._save_job(job_id)
        with self.lock:
            state = item['state']
            if state['status'] not in TERMINAL:
                state['status'] = 'cancelled' if state['status'] == 'cancelling' or self.closed else 'completed'
            state['finished_at'] = time.time()
            if state['status'] == 'completed':
                state['progress'] = 100
            state['message'] = 'Headless job '+state['status']+'.'
            item['tracker'].finish(state['status'])
            self._save_job(job_id)

    def _event(self, job_id, ti, event):
        """Consume, rather than leave unbounded SessionJob event queues in RAM."""
        item = self.jobs[job_id]
        kind, data = event.kind, event.data
        with self.lock:
            state = item['state']
            state['last_event_at'] = getattr(event, 'timestamp', time.time())
            if kind == 'started':
                if state['status'] != 'cancelling':
                    state['status'] = 'running'
                item['tracker'].mark_running()
            elif kind == 'progress':
                if state['status'] != 'cancelling':
                    state['status'] = 'running'
                state['progress'] = max(0, min(100, float(getattr(data, 'progress', 0) or 0)))
                state['message'] = str(getattr(data, 'status', '') or getattr(data, 'phase', '') or 'Generating')
                gen = self._gen()
                # Optional observation only. Missing metadata produces unknown
                # window timing, never a browser-trigger dependency.
                try:
                    item['tracker'].observe(data, ti, gen.get('window_no'), gen.get('total_windows'))
                except Exception as exc:
                    state['telemetry_warning'] = str(exc)[:250]
            elif kind in {'status', 'info'}:
                state['message'] = str(data)[:4000]
            elif kind == 'error':
                message = str(getattr(data, 'message', data))
                state['errors'].append(message)
                state['errors'] = state['errors'][-100:]
            elif kind == 'stream':
                text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', str(getattr(data, 'text', '')))[:4000]
                if text:
                    state['logs'].append({'at': time.time(), 'stream': getattr(data, 'stream', 'stdout'), 'text': text})
                    state['logs'] = state['logs'][-120:]
            # Throttle disk writes for chatty terminal progress; final state always commits.
            last = item.get('saved_at', 0)
            if kind in {'started', 'error', 'progress'} or time.monotonic()-last > 1:
                item['saved_at'] = time.monotonic()
                self._save_job(job_id)
        if kind == 'output':
            self.collect_outputs(job_id, ti)
            raw = data.get('path') if isinstance(data, dict) else getattr(data, 'path', None)
            cid = data.get('client_id') if isinstance(data, dict) else getattr(data, 'client_id', None)
            if raw and cid == item['state']['client_ids'][ti-1]:
                try:
                    self.archive_output(job_id, ti, raw)
                except (ValueError, OSError):
                    pass

    def _gen(self):
        return getattr(self.session, '_state', {}).get('gen', {}) if self.session is not None else {}

    def collect_outputs(self, job_id, ti):
        gen = self._gen()
        paths = list(gen.get('file_list') or [])
        settings = list(gen.get('file_settings_list') or [])
        if len(paths) != len(settings):
            return
        cid = self.jobs[job_id]['state']['client_ids'][ti-1]
        for path, meta in zip(paths, settings):
            if not isinstance(meta, dict) or meta.get('client_id') != cid:
                continue
            try:
                self.archive_output(job_id, ti, path, positive(meta.get('window_no')))
            except (ValueError, OSError):
                # A native file still being encoded, or removed by native cleanup,
                # is not ready. Final result collection tries again.
                pass

    def archive_output(self, job_id, ti, raw_path, wi=None):
        image_job = self.jobs[job_id]['state'].get('operation') == 'reference_image'
        music_job = self.jobs[job_id]['state'].get('operation') == 'music'
        voice_job = self.jobs[job_id]['state'].get('operation') in {'reference_voice', 'music'}
        non_video = image_job or voice_job
        allowed = AUDIO_EXTENSIONS if voice_job else IMAGE_EXTENSIONS if image_job else VIDEO_EXTENSIONS
        if not isinstance(raw_path, (str, Path)) or Path(raw_path).suffix.lower() not in allowed:
            return None
        path = Path(raw_path)
        if not path.is_absolute():
            path = Path(getattr(self.session, '_root', Path.cwd()))/path
        original_stat = fingerprint(path)
        source_signature = [str(path.resolve()), *original_stat]
        item = self.jobs[job_id]
        with self.output_lock:
            if source_signature in item['seen']:
                return None
            probe = audio_probe(path, max_duration=210 if music_job else 310) if voice_job else image_probe(path) if image_job else self.probe(path)
            if non_video:
                wi = None
            rows = [r for r in item['plan'] if r.get('task_index') == ti]
            # Frame-count matching is authoritative for saved cumulative outputs.
            # Do not map the end of a partially failed render to the planned last window.
            matched = [r for r in rows if not non_video and isinstance(r.get('end_frame'), int) and abs(r['end_frame']-probe['frames']) <= 2]
            if len(matched) == 1 and abs(probe['fps']-24) < .01:
                wi = matched[0].get('window_index')
            elif wi is not None:
                selected = next((r for r in rows if r.get('window_index') == wi), None)
                if not selected or abs(selected.get('end_frame', -10000)-probe['frames']) > 2 or abs(probe['fps']-24) >= .01:
                    wi = None
            output_id = uuid.uuid4().hex
            destination = self.root/'outputs'/(output_id+path.suffix.lower())
            temp = destination.with_suffix(destination.suffix+'.part')
            try:
                shutil.copyfile(path, temp)
                if fingerprint(path) != original_stat:
                    raise ValueError('Native output changed while archiving.')
                temp.chmod(0o600)
                os.replace(temp, destination)
            finally:
                temp.unlink(missing_ok=True)
            record = {'id': output_id, 'job_id': job_id, 'name': path.name, 'path': str(destination),
                      'task_index': ti, 'window_index': wi, 'source_signature': source_signature,
                      'cumulative': item['resolved'][ti-1].get('multi_prompts_gen_type') == 'PW',
                      'bytes': destination.stat().st_size, 'created_at': time.time(),
                      'content_type': mimetypes.guess_type(path.name)[0] or 'video/mp4',
                      'media_kind': 'audio' if voice_job else 'image' if image_job else 'video',
                      'timeline_mapping': 'not_applicable' if non_video else 'verified_24fps' if wi else 'unmapped', 'probe': probe, 'stat': fingerprint(destination)}
            original_tasks = item.get('payload', {}).get('tasks', [])
            spec = bounded_spec(original_tasks[ti-1]) if len(original_tasks) >= ti else None
            if spec and abs(probe['fps']-24) < .01 and probe['frames'] > spec['context_frames'] and abs(probe['frames']-spec['context_frames']-spec['new_frames']) <= 4:
                record.update(layout='bounded-v1', cumulative=False, window_index=1,
                    source_start_frame=spec['context_frames'], source_end_frame=probe['frames'],
                    timeline_start_frame=spec['timeline_start_frame'],
                    timeline_end_frame=spec['timeline_start_frame']+probe['frames']-spec['context_frames'])
            with self.lock:
                self.outputs[output_id] = record
                self.db.execute('INSERT INTO outputs VALUES (?,?)', (output_id, json_text(record)))
                item['outputs'].append(output_id)
                item['seen'].append(source_signature)
                if wi and item.get('tracker'):
                    item['tracker'].mark_output(ti, wi)
                self._save_job(job_id)
            return record

    def bounded_source(self, record, end, count):
        """Resolve an immutable worker-owned tail, with no external path input."""
        saved = record.get('continuation_private')
        source_path, source_end = record['path'], end
        representation = 'decoded-from-saved-footage'
        if saved and end == record['probe']['frames'] and saved['frames'] >= count:
            if tuple(saved['stat']) != fingerprint(saved['path']):
                raise ValueError('Decoded continuation checkpoint changed; original render is retained.')
            if saved['frames'] == count:
                return saved['path']
            source_path, source_end = saved['path'], saved['frames']
            representation = 'decoded-rgb8'
        elif record.get('layout') == 'bounded-v1':
            raise ValueError('Decoded checkpoint unavailable for this bounded output. Inspect recovery; no regeneration submitted.')
        key = hashlib.sha256(json_text([record['id'], fingerprint(source_path), source_end, count]).encode()).hexdigest()
        dest = self.root/'continuations'/(key+'.mkv')
        receipt = dest.with_suffix('.json')
        if receipt.exists():
            cached = json.loads(receipt.read_text())
            path = Path(cached.get('path', str(dest)))
            if path.parent != self.root/'continuations' or tuple(cached['stat']) != fingerprint(path):
                raise ValueError('Saved continuation cache changed.')
            return str(path)
        if dest.exists():
            # Preserve an orphan after a publication/receipt crash, and register
            # the replacement under the SAME cache key to avoid repeated work.
            dest = self.root/'continuations'/(key+'-'+uuid.uuid4().hex+'.mkv')
        cached = extract_owned_tail(source_path, dest, end=source_end, count=count, probe=self.probe)
        cached.update(stat=fingerprint(dest), path=str(dest), representation=representation)
        temp = receipt.with_suffix('.json.tmp')
        temp.write_text(json_text(cached)); temp.chmod(0o600); os.replace(temp, receipt)
        return str(dest)

    def capture_bounded_artifact(self, job_id, ti, result, spec):
        item = self.jobs[job_id]
        records = [self.outputs[oid] for oid in item['outputs']
                   if self.outputs[oid]['task_index'] == ti and self.outputs[oid].get('window_index') == 1]
        if len(records) != 1:
            raise ValueError('No unique verified bounded viewing output; native files retained.')
        record = records[0]
        artifact = select_artifact(result, item['state']['client_ids'][ti-1], record['source_signature'][0])
        context = spec['context_frames']; actual = record['probe']['frames']
        # Persist lightweight return geometry before any checkpoint validation.
        # Decoded tensors are transient; retain enough evidence to distinguish
        # an encoder/mux loss from model timing without guessing after restart.
        audio = getattr(artifact, 'audio_tensor', None)
        with self.lock:
            item['state']['decoded_media_geometry'] = {
                'task_index': ti, 'output_id': record['id'],
                'decoded_video_frames': int(artifact.video_tensor_uint8.shape[1]),
                'viewing_video_frames': actual,
                'expected_video_frames': context + spec['new_frames'],
                'audio_origin_frame': context,
                'decoded_audio_samples': None if audio is None else int(audio.shape[0]),
                'audio_sampling_rate': getattr(artifact, 'audio_sampling_rate', None),
                'fps': artifact.fps,
            }
            self._save_job(job_id)
        if abs(actual-context-spec['new_frames']) > 4 or actual <= context:
            raise ValueError('Bounded output frame count differs from requested window.')
        # Commit ownership and local/global geometry even when decoded checkpoint
        # creation subsequently fails. Playback and recovery must remain possible.
        geometry = {'layout': 'bounded-v1', 'cumulative': False,
            'source_start_frame': context, 'source_end_frame': actual,
            'timeline_start_frame': spec['timeline_start_frame'],
            'timeline_end_frame': spec['timeline_start_frame']+actual-context}
        with self.lock:
            record.update(geometry)
            self.db.execute('UPDATE outputs SET document=? WHERE id=?', (json_text(record), record['id']))
            self.db.commit()
        capture = item['payload']['tasks'][ti-1].get('_director_appearance_capture')
        if capture and capture['start_frame'] < actual:
            selected = choose_appearance_frame(artifact.video_tensor_uint8, start_frame=capture['start_frame'])
            if selected:
                anchor_id = uuid.uuid4().hex
                path = self.root/'outputs'/(anchor_id+'.png')
                meta = write_appearance_frame(artifact.video_tensor_uint8, path, selected['frame'])
                anchor = {'id': anchor_id, 'job_id': job_id, 'name': 'Continuous-shot appearance.png',
                    'path': str(path), 'stat': fingerprint(path), 'task_index': ti, 'window_index': None,
                    'cumulative': False, 'media_kind': 'image', 'content_type': 'image/png',
                    'context_only': 'appearance', 'created_at': time.time(), 'bytes': path.stat().st_size,
                    'timeline_mapping': 'not_applicable', 'appearance': {**meta, **selected}}
                with self.lock:
                    self.outputs[anchor_id] = anchor
                    self.db.execute('INSERT INTO outputs VALUES (?,?)', (anchor_id, json_text(anchor)))
                    item['outputs'].append(anchor_id)
                    record['appearance_anchor'] = {'jobId': job_id, 'outputId': anchor_id, **meta, **selected}
                    self.db.execute('UPDATE outputs SET document=? WHERE id=?', (json_text(record), record['id']))
                    self._save_job(job_id)
            else:
                with self.lock:
                    record['appearance_notice'] = 'Appearance protection skipped: no usable early decoded frame.'
                    self.db.execute('UPDATE outputs SET document=? WHERE id=?', (json_text(record), record['id']))
                    self.db.commit()
        if spec['checkpoint_frames']:
            spec = {**spec, 'checkpoint_frames': min(spec['checkpoint_frames'], actual if not context else spec['timeline_start_frame']+actual-context)}
            if audio_info(record['path']) and getattr(artifact, 'audio_tensor', None) is None:
                raise ValueError('Viewing output has audio but API returned no decoded audio.')
            destination = self.root/'continuations'/(record['id']+'-'+uuid.uuid4().hex+'.mkv')
            source = item['resolved'][ti-1].get('video_source')
            source_representation = 'decoded-rgb8'
            preceding = item['payload']['tasks'][ti-1].get('_director_continuation')
            new_frames = actual-context
            if spec['checkpoint_frames'] > new_frames and preceding:
                prior = self.output_record(preceding['jobId'], preceding['outputId'])
                needed = spec['checkpoint_frames']-new_frames
                source = self.bounded_source(prior, preceding['keepFrames'], max(needed, context))
                if not prior.get('continuation_private'):
                    source_representation = 'decoded-from-saved-footage'
            metadata = persist_artifact_tail(artifact, destination, spec=spec, actual_frames=actual,
                source=source, source_representation=source_representation)
            private = {**metadata, 'path': str(destination), 'stat': fingerprint(destination)}
            with self.lock:
                record['continuation'] = metadata
                record['continuation_private'] = private
                self.bounded_api_verified = True
                self.db.execute('UPDATE outputs SET document=? WHERE id=?', (json_text(record), record['id']))
                self.db.commit()

    def import_render(self, payload):
        with self.lock:
            media = self.media.get(payload.get('media_id'))
        plan = payload.get('plan')
        if not media or Path(media['path']).suffix.lower() not in VIDEO_EXTENSIONS:
            raise ValueError('Upload a finished video first.')
        if tuple(media.get('stat', [])) != fingerprint(media['path']):
            raise ValueError('Uploaded video changed.')
        if not isinstance(plan, list) or not 1 <= len(plan) <= 10000:
            raise ValueError('A 24-fps timeline plan is required.')
        cursor, ids = 0, set()
        for wi, row in enumerate(plan, 1):
            if not isinstance(row, dict) or row.get('task_index') != 1 or row.get('window_index') != wi or row.get('start_frame') != cursor or type(row.get('end_frame')) is not int or row['end_frame'] <= cursor or row.get('frames') != row['end_frame']-cursor or not isinstance(row.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', row['id']) or row['id'] in ids:
                raise ValueError('Import requires consecutive unique window ranges at 24 fps.')
            cursor = row['end_frame']; ids.add(row['id'])
        probe = self.probe(media['path'])
        if abs(probe['fps']-24) > .01 or abs(probe['frames']-cursor) > 2:
            raise ValueError('Finished video does not match this 24-fps plan.')
        job_id = uuid.uuid4().hex
        with self.lock:
            self.jobs[job_id] = {'state': {'job_id': job_id, 'status': 'completed', 'progress': 100,
                'message': 'Imported video; original render timings are unavailable.', 'created_at': time.time(),
                'task_count': 1, 'client_ids': [], 'generated_files': [], 'errors': [], 'imported': True, 'backend': 'headless'},
                'plan': copy.deepcopy(plan), 'payload': {}, 'resolved': [{'multi_prompts_gen_type': 'PW'}],
                'job': None, 'tracker': None, 'outputs': [], 'seen': [], 'request_id': None, 'digest': ''}
            self._save_job(job_id)
        self.archive_output(job_id, 1, media['path'], len(plan))
        return self.job_state(job_id)

    def output_record(self, job_id, output_id):
        with self.lock:
            record = self.outputs.get(output_id)
            if not record or record['job_id'] != job_id:
                raise ValueError('Unknown output for this job.')
            return copy.deepcopy(record)

    @staticmethod
    def output_available(record):
        try:
            return tuple(record['stat']) == fingerprint(record['path'])
        except (ValueError, OSError):
            return False

    def job_state(self, job_id):
        with self.lock:
            item = self.jobs.get(job_id)
            if not item:
                raise ValueError('Unknown job. Old plugin-only jobs must be imported as finished films.')
            state = copy.deepcopy(item['state'])
            if item.get('tracker'):
                state['telemetry'] = item['tracker'].snapshot()
            if state.get('operation') in {'postprocess', 'reference_image', 'reference_voice', 'music'}:
                state.pop('telemetry', None)  # postprocess units are not H3 denoising steps
            state['outputs'] = []
            for output_id in item['outputs']:
                record = self.outputs.get(output_id)
                if record:
                    public = {k: copy.deepcopy(v) for k, v in record.items() if k not in {'path', 'stat', 'source_signature', 'continuation_private'}}
                    public['available'] = self.output_available(record)
                    state['outputs'].append(public)
            queued = [k for k, j in self.jobs.items() if j['state']['status'] == 'queued']
            state['queue_position'] = queued.index(job_id)+1 if job_id in queued else None
            state['diagnostics'] = {'dispatch_mode': 'headless_python_api', 'browser_required': False,
                                    'queue_length': len(queued), 'queue_paused': self.paused, 'active_job_id': self.active_id}
            state['dispatch_phase'] = 'generating' if state['status'] == 'running' else state['status']
            return state

    def job_metadata(self, job_id):
        with self.lock:
            item = self.jobs[job_id]
            return {'plan': copy.deepcopy(item['plan']), 'snapshot': copy.deepcopy(item['payload'].get('snapshot')),
                    'project_id': item['state'].get('project_id'), 'job': self.job_state(job_id)}

    def queue_state(self):
        with self.lock:
            active = [k for k,j in self.jobs.items() if j['state']['status'] not in TERMINAL]
            recent = [k for k,j in self.jobs.items() if j['state']['status'] in TERMINAL and not j['state'].get('imported')][-100:]
            return {'paused': self.paused, 'active_job_id': self.active_id, 'browser_required': False,
                    'scope': 'This headless service only; not a separately running Gradio/MCP process.',
                    'jobs': [{k:v for k,v in self.job_state(key).items() if k not in {'logs', 'telemetry'}} for key in active+list(reversed(recent))]}

    def set_paused(self, paused):
        with self.wake:
            self.paused = bool(paused)
            self._save_pause()
            self.wake.notify_all()
            return self.queue_state()

    def cancel(self, job_id):
        with self.wake:
            item = self.jobs.get(job_id)
            if not item:
                raise ValueError('Unknown job.')
            state = item['state']
            if state['status'] not in TERMINAL:
                if state['status'] == 'queued':
                    state.update(status='cancelled', finished_at=time.time(), message='Cancelled before renderer submission.')
                    if item.get('tracker'):
                        item['tracker'].finish('cancelled')
                else:
                    state.update(status='cancelling', message='Cooperative cancellation requested; waiting for WanGP to stop.')
                    if item.get('job') is not None:
                        item['job'].cancel()
                self._save_job(job_id)
            self.wake.notify_all()
            return self.job_state(job_id)

    def health(self):
        with self.lock:
            return {'app': 'h3-director-wangp', 'version': VERSION, 'backend': 'headless',
                    'capabilities': {'bounded_continuation': 1, 'bounded_continuation_contract': 'verified-return-media-required', 'upstream_patch_required': False, 'bounded_viewing_mismatch': 'preserve-and-explicit-saved-footage-suffix', 'h3_settings_compatibility': 1, 'soundtrack_slices': 1, 'audio_references': 3, 'music': callable(getattr(self.session, 'submit_task', None)), 'music_architecture': 'yue2', 'reference_voices': callable(getattr(self.session, 'submit_task', None)), 'reference_voice_architecture': 'qwen3_tts_voicedesign', 'reference_voice_architectures': ['qwen3_tts_voicedesign', 'fish_drama3'], 'voice_dialogue': 1, 'reference_images': callable(getattr(self.session, 'submit_task', None)), 'reference_image_prompt_mode': 'FG', 'reference_image_architecture': 'qwen_image_21_7B', 'late_postprocess': callable(getattr(self.session, 'submit_media_postprocessing', None)), 'postprocess_max_frames': 3000},
                    'installed_api': {'task_submission': 'available' if callable(getattr(self.session, 'submit_task', None)) else 'unsupported' if self.session is not None else 'unknown', 'bounded_decoded_media': 'verified' if callable(getattr(self.session, 'submit_task', None)) and getattr(self, 'bounded_api_verified', False) else 'unknown' if callable(getattr(self.session, 'submit_task', None)) or self.session is None else 'unsupported', 'reference_models': 'discover-required', 'bounded_note': 'The legacy bounded_continuation flag describes bridge support. Session readiness alone does not verify decoded audio/video artifacts; strict per-output checkpoint checks remain required.'},
                    'instance': str(self.root), 'runtime_state': self.runtime_state, 'runtime_error': self.runtime_error,
                    'runtime': self.runtime_info, 'browser_required': False, 'plugin_required': False,
                    'persistent_queue': True, 'idempotency': True, 'active_job_id': self.active_id,
                    'queue_paused': self.paused, 'model_resident': self.model_resident, 'idle_release_seconds': self.idle_release_seconds, 'last_model_release': self.last_release, 'note': 'Official WanGP Python API; standalone runtime. No Gradio page is needed.'}

    def close(self, timeout=30):
        with self.wake:
            self.closed = True
            # Dispatch stops now. Persist the pause only when it protects queued work
            # (or the user had paused deliberately); an empty idle queue restarts unpaused.
            queued = any(j['state']['status'] == 'queued' for j in self.jobs.values())
            keep_paused = self.paused or queued
            self.paused = True
            self._save_pause(keep_paused)
            if self.active_id:
                self.cancel(self.active_id)
            self.wake.notify_all()
        if self.dispatcher:
            self.dispatcher.join(timeout=timeout)
            if self.dispatcher.is_alive():
                return False
        with self.lock:
            self.db.close()
        return True
