"""H3 Director adapter for the existing WanGP WebUI queue.

Copy this folder into Wan2GP/plugins, enable it, restart WanGP, then open
H3 Director and click Start. No second runtime is constructed.
"""
from __future__ import annotations
import atexit
import copy
import hmac
import inspect
import importlib.util
import mimetypes
import re
import stat
import shutil
import json
import os
import secrets
import tempfile
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import gradio as gr
from shared.utils.plugins import WAN2GPPlugin

ADAPTER_VERSION = '1.0.5'
# Loaded by filename because WanGP and our tests may load a plugin outside a package.
_spec = importlib.util.spec_from_file_location(__name__ + '_telemetry', Path(__file__).with_name('telemetry.py'))
_telemetry_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_telemetry_module)
JobTelemetry = _telemetry_module.JobTelemetry
TERMINAL_STATES = {'completed', 'failed', 'cancelled'}
DISPATCH_WARNING_SECONDS = 15.0

MAX_JSON = 32 * 1024 * 1024
MAX_UPLOAD = 2 * 1024 ** 3
EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.avif', '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v', '.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac', '.opus'}
MEDIA_KEYS = {'image_refs', 'video_guide', 'video_guide2', 'audio_guide', 'audio_guide2'}
# Do not carry unrelated file inputs from an imported settings template.
CLEAR_MEDIA = {'image_start', 'image_end', 'video_source', 'video_mask', 'image_guide', 'image_mask', 'audio_source', 'audio_file', 'mask' }

def plain(value):
    """Metadata/settings must be JSON serializable; never stringify huge tensors."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): plain(v) for k, v in value.items() if not str(k).startswith('_')}
    if isinstance(value, (list, tuple)):
        return [plain(v) for v in value]
    if isinstance(value, Path):
        return str(value)
    return None

def copyable_textbox(**kwargs):
    """Readable output with the native copy control on Gradio 5 and 6."""
    parameters = inspect.signature(gr.Textbox).parameters
    options = dict(kwargs, type='text', interactive=False, show_label=True)
    if 'show_copy_button' in parameters:
        options['show_copy_button'] = True
    elif 'buttons' in parameters:
        options['buttons'] = ['copy']
    # Unknown wrappers still get visible text rather than a masked secret.
    return gr.Textbox(**options)


def bind_webui_session(api_session):
    """Pin the injected session while Start is still inside a Gradio callback.

    WanGP injects a callback-scoped proxy, not a context-free HTTP client.
    Its two private binding hooks are intentionally isolated here: resolve the
    real WebUI session and capture its queue context now, before HTTP workers
    run without Gradio's thread-local state. Never create a headless runtime.
    """
    ensure = getattr(api_session, '_ensure_session', None)
    bind = getattr(api_session, '_bind_gradio_context', None)
    if not callable(ensure) or not callable(bind):
        raise RuntimeError(
            'Unsupported WanGP plugin API: live WebUI binding hooks are missing. '
            'This adapter needs the Gradio-backed session injected by WanGP.'
        )
    session = ensure()
    if not getattr(session, '_use_webui_queue', False) or not isinstance(getattr(session, '_state', None), dict):
        raise RuntimeError('Refusing to start without the existing live WebUI queue.')
    bind(session)
    context = getattr(session, '_gradio_webui_context', None)
    if not isinstance(context, dict):
        raise RuntimeError('Start the adapter from the WanGP H3 Director tab; no live Gradio context was captured.')
    fn_index = context.get('load_queue_fn_index')
    if (context.get('blocks') is None or context.get('request') is None
            or not context.get('session_hash') or type(fn_index) is not int or fn_index < 0):
        raise RuntimeError('The live WanGP queue trigger is unavailable. Reload the WanGP page and start the adapter again.')
    # IMPORTANT: a raw blocks._queue.push executes load_queue_action only.
    # Gradio's browser schedules its .then() chain (including process_tasks).
    # Keep admission deferred; our browser timer publishes a value to WanGP's
    # actual load_queue_trigger so the browser owns the complete event chain.
    # Do not start process_tasks directly or create another generation runtime.
    session._gradio_webui_context = {
        key: context.get(key)
        for key in ('blocks', 'request', 'session_hash', 'load_queue_fn_index', 'abort_fn_index')
    }
    session._gradio_webui_context['defer_load_queue_trigger'] = True
    return session


class DirectorAdapter:
    def __init__(self, session, port=7867, token=None):
        self.session = session
        self.port = int(port)
        self.token = token or secrets.token_urlsafe(32)
        self.media = {}
        self.jobs = {}
        self.outputs = {}
        self.lock = threading.RLock()
        self.temp = tempfile.TemporaryDirectory(prefix='h3-director-media-')
        self.httpd = None
        self.thread = None
        self._browser_seen_at = None
        self._dispatched_client_ids = set()
        self.origins = {'http://127.0.0.1:8765', 'http://localhost:8765'}
        self.origins.update(x.strip() for x in os.environ.get('H3_EDITOR_ORIGIN', '').split(',') if x.strip())

    def model(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('A model_type from this WanGP installation is required.')
        meta = self.session.get_model_metadata(model_type)
        if not meta:
            raise ValueError('Unknown model_type. Rediscover the installed presets.')
        return meta

    def verify_preset(self, model_type):
        meta = self.model(model_type)
        definitions = self.session.list_model_defs(model_type=model_type)
        definition = next((d for d in definitions if d.get('model_type') == model_type), definitions[0] if definitions else {})
        nested = definition.get('model', {})
        combined = json.dumps([meta, definition], default=str).lower()
        identity = (model_type+' '+str(meta.get('name', ''))).lower()
        if not ('h3' in combined and 'ref2va' in combined) or any(x in identity for x in ('tts', 'fl2va', 'viggle')):
            raise ValueError('Select an H3 Ref2VA video preset (PDD-8 or standard), not FL2VA/TTS/Viggle.')
        pdd = bool(definition.get('pdd') or (nested.get('pdd') if isinstance(nested, dict) else False))
        pdd = pdd or 'pdd' in identity
        return {'inference_mode': 'pdd8' if pdd else 'standard', 'steps_locked': bool(pdd),
                'samplers': ['euler'] if pdd else ['euler', 'res_multistep', 'ralston_2s'],
                'max_phases': 1 if pdd else 2, 'continuation': True}

    def resolve_task(self, task):
        if not isinstance(task, dict):
            raise ValueError('Each task must be a settings object.')
        profile = self.verify_preset(task.get('model_type'))
        steps = task.get('num_inference_steps', 0)
        if type(steps) is not int or not 1 <= steps <= 200:
            raise ValueError('Inference steps must be an integer from 1–200.')
        if profile['steps_locked'] and (steps != 8 or task.get('sample_solver') != 'euler'):
            raise ValueError('The PDD-8 workflow requires the exported eight-step Euler settings.')
        if task.get('sample_solver') not in profile['samplers']:
            raise ValueError('Sampler is not supported by the selected H3 profile.')
        phases = task.get('guidance_phases', 1)
        if type(phases) is not int or not 1 <= phases <= profile['max_phases']:
            raise ValueError('The phase count is not supported by this H3 profile.')
        if not isinstance(task.get('prompt'), str) or not task['prompt'].strip():
            raise ValueError('A nonempty prompt is required.')
        result = {k: copy.deepcopy(v) for k, v in task.items() if not k.startswith('_') and k not in {'model_def', 'frame_scheduler'}}
        for key in CLEAR_MEDIA:
            result[key] = None
        def resolve(media_id):
            if media_id is None or media_id == '':
                return None
            if not isinstance(media_id, str) or media_id not in self.media:
                raise ValueError('Unknown media ID. Upload references to this adapter; arbitrary filesystem paths are not accepted.')
            return self.media[media_id]['path']
        for key in MEDIA_KEYS:
            value = result.get(key)
            if key == 'image_refs':
                if value is None:
                    value = []
                if not isinstance(value, list):
                    raise ValueError('image_refs must be an array of upload IDs.')
                result[key] = [resolve(x) for x in value]
            else:
                result[key] = resolve(value)
        # Keep output timing identical to the editor's 24-fps timeline.
        result.update(force_fps='24', sliding_window_trim_first_frames=0, sliding_window_discard_last_frames=0,
                      guidance_phases=phases, repeat_generation=1, prompt_enhancer='')
        continuation = task.get('_director_continuation')
        if continuation:
            self.resolve_continuation(result, continuation)
        return result

    def resolve_continuation(self, task, source):
        if not isinstance(source, dict):
            raise ValueError('Invalid continuation source.')
        record = self.output_record(source.get('jobId'), source.get('outputId'))
        if not self.output_available(record):
            raise ValueError('Continuation video was removed/replaced. Import the retained render first.')
        frames = source.get('keepFrames')
        if type(frames) is not int or frames < 1:
            raise ValueError('Continuation boundary must be a positive integer frame count.')
        # Inspect actual video, not just a client-provided plan. Never accept an arbitrary path.
        from shared.utils.utils import get_video_info
        fps, _, _, count = get_video_info(str(record['_path']))
        if not fps or frames > int(count / fps * 24):
            raise ValueError('Continuation boundary is beyond the available source video.')
        # Freeze a copy: native gallery cleanup can remove a previous output while the new job starts.
        frozen = Path(self.temp.name) / ('continuation-'+uuid.uuid4().hex+Path(record['_path']).suffix)
        shutil.copyfile(record['_path'], frozen)
        if not self.output_available(record):
            frozen.unlink(missing_ok=True)
            raise ValueError('Source changed during continuation preparation. Refresh and retry deliberately.')
        task.update(video_source=str(frozen), image_prompt_type='V', keep_frames_video_source=str(frames))

    def import_render(self, payload):
        """Attach a user-uploaded finished video after a restart; no GPU work."""
        media = self.media.get(payload.get('media_id'))
        plan = payload.get('plan')
        if not media or Path(media['path']).suffix.lower() not in {'.mp4', '.mov', '.webm', '.mkv', '.m4v'}:
            raise ValueError('Upload a video to this adapter first.')
        if not isinstance(plan, list) or not plan or len(plan) > 10000:
            raise ValueError('A submitted timeline plan is required.')
        cursor, ids = 0, set()
        for wi, row in enumerate(plan, 1):
            if not isinstance(row, dict) or type(row.get('end_frame')) is not int or type(row.get('start_frame')) is not int or row['start_frame'] < 0 or row['end_frame'] <= row['start_frame']:
                raise ValueError('Invalid timeline ranges.')
            if row.get('task_index') != 1 or row.get('window_index') != wi or row['start_frame'] != cursor or row.get('frames') != row['end_frame']-cursor or not isinstance(row.get('id'), str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,128}', row['id']) or row['id'] in ids:
                raise ValueError('Import needs one consecutive linked 24-fps timeline with unique window IDs.')
            ids.add(row['id']); cursor = row['end_frame']
        from shared.utils.utils import get_video_info
        fps, _, _, count = get_video_info(media['path'])
        if not fps or abs(fps-24) > .01:
            raise ValueError('Import a 24-fps render matching this timeline; other frame rates are not auto-mapped.')
        if abs(count-max(r['end_frame'] for r in plan)) > 2:
            raise ValueError('Video length does not match the submitted timeline within two frames. Use the original plan, not an edited timeline.')
        path = Path(media['path']); st = path.stat(); job_id, output_id = uuid.uuid4().hex, uuid.uuid4().hex
        record = {'id': output_id, 'job_id': job_id, 'name': media['name'], 'task_index': 1,
                  'window_index': len(plan), 'cumulative': True, 'bytes': st.st_size, 'created_at': time.time(),
                  'content_type': mimetypes.guess_type(media['name'])[0] or 'video/mp4', 'timeline_mapping': 'imported_24fps',
                  '_path': path, '_stat': (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)}
        state = {'job_id': job_id, 'status': 'completed', 'progress': 100, 'message': 'Imported finished video; original generation timings are unavailable.',
                 'created_at': time.time(), 'task_count': 1, 'client_ids': [], 'generated_files': [], 'errors': [], 'imported': True}
        with self.lock:
            self.outputs[output_id] = record
            self.jobs[job_id] = {'state': state, 'job': None, 'tracker': None, 'outputs': [output_id], 'seen_paths': set()}
        return self.job_state(job_id)

    def submit(self, payload):
        tasks = payload.get('tasks')
        if not isinstance(tasks, list) or not tasks:
            raise ValueError('tasks must be a nonempty settings array.')
        with self.lock:
            if any(item['state']['status'] not in TERMINAL_STATES for item in self.jobs.values()):
                raise ValueError('A Director job is already active. Inspect or cancel it before submitting again; do not duplicate a waiting job.')
            resolved = [self.resolve_task(t) for t in tasks]
            job_id = uuid.uuid4().hex
            client_ids = ['h3director_'+job_id+'_'+str(i) for i in range(1, len(resolved)+1)]
            for task, client_id in zip(resolved, client_ids):
                task['client_id'] = client_id
            state = {'job_id': job_id, 'status': 'submitted', 'progress': 0, 'message': 'Waiting for the WanGP browser to dispatch this job. Keep the original WanGP page open and visible.', 'created_at': time.time(), 'task_count': len(tasks), 'client_ids': client_ids, 'generated_files': [], 'errors': []}
            tracker = JobTelemetry(resolved, payload.get('plan'))
            self.jobs[job_id] = {'state': state, 'job': None, 'tracker': tracker, 'outputs': [], 'seen_paths': set()}
        adapter = self
        class Callbacks:
            def on_status(self, message):
                with adapter.lock:
                    if state['status'] not in TERMINAL_STATES:
                        state['message'] = str(message or '')
                        if tracker.current is not None and re.search(r'\bpaus(?:e|ed)\b', str(message), re.I):
                            try:
                                tracker.observe({'phase':'paused','status':str(message)}, tracker.current['task_index'], tracker.current['window_index'])
                            except Exception:
                                pass  # Monitoring must never interrupt the live renderer.
            def on_progress(self, update):
                with adapter.lock:
                    if state['status'] not in TERMINAL_STATES and state['status'] != 'cancelling':
                        state.update(status='running', progress=max(0, min(100, float(getattr(update, 'progress', 0) or 0))), message=str(getattr(update, 'status', '') or 'Generating'))
                        try:
                            gen = adapter.session._state.get('gen', {})
                            active = adapter.manifest_client_ids((gen.get('queue') or [])[:1])
                            # Progress callbacks are already correlated by WanGP's API probe.
                            # Multiple-task fallback is unknown rather than the wrong task.
                            ti = client_ids.index(active[0])+1 if active and active[0] in client_ids else 1 if len(client_ids) == 1 else None
                            if ti:
                                tracker.observe(update, ti, gen.get('window_no'), gen.get('total_windows'))
                            else:
                                state['telemetry_warning'] = 'Progress had no matching task ID; window statistics were not guessed.'
                        except Exception as exc:
                            state['telemetry_warning'] = 'Progress observation unavailable: '+str(exc)[:250]
            def on_output(self, output):
                # Native on_output is generally task-final, not a per-window event.
                # Intermediate files are observed from the same session's gallery.
                with adapter.lock:
                    try:
                        adapter.collect_outputs(job_id)
                    except Exception as exc:
                        state['telemetry_warning'] = 'Output observation unavailable: '+str(exc)[:250]
        # WanGP prepares inline_queue and observes it; the browser dispatches it.
        # Returning HTTP 200 means accepted, NOT proof that generation has started.
        try:
            job = self.session.submit_manifest(resolved, callbacks=Callbacks())
            with self.lock:
                self.jobs[job_id]['job'] = job
        except Exception as exc:
            with self.lock:
                state.update(status='failed', errors=[str(exc)])
                tracker.finish('failed')
            raise
        def monitor():
            try:
                result = job.result()
                errors = [str(getattr(e, 'message', e)) for e in (getattr(result, 'errors', []) or [])]
                with self.lock:
                    was_cancelled = state['status'] == 'cancelling'
                    state.update(status='completed' if result.success else 'cancelled' if was_cancelled else 'failed', progress=100 if result.success else state['progress'], generated_files=[str(p) for p in (result.generated_files or [])], errors=errors, finished_at=time.time())
                    adapter.collect_outputs(job_id)
                    tracker.finish(state['status'])
            except Exception as exc:
                with self.lock:
                    state.update(status='failed', errors=[str(exc)], finished_at=time.time())
                tracker.finish('failed')
        threading.Thread(target=monitor, name='h3-director-job-'+job_id[:8], daemon=True).start()
        # Observation only. This never dispatches work or mutates WanGP's queue.
        def observe_gallery():
            while True:
                with adapter.lock:
                    try:
                        adapter.collect_outputs(job_id)
                    except Exception as exc:
                        state['telemetry_warning'] = 'Output observation unavailable: '+str(exc)[:250]
                    if state['status'] in TERMINAL_STATES:
                        break
                time.sleep(1)
        threading.Thread(target=observe_gallery, name='h3-director-observe-'+job_id[:8], daemon=True).start()
        return self.job_state(job_id)

    def collect_outputs(self, job_id):
        """Observe only files correlated to this job; never scan the output folder.

        WanGP saves cumulative prefixes. window_no identifies the last included
        window, not a standalone clip. Metadata without window_no is unmapped.
        """
        item = self.jobs[job_id]
        if item['state'].get('imported'): return
        gen = self.session._state.get('gen', {})
        paths = list(gen.get('file_list', []) or [])
        settings = list(gen.get('file_settings_list', []) or [])
        # Native lists are updated together under WanGP's lock. Do not borrow
        # that private lock; defer this read if either list changed mid-snapshot.
        if (len(paths) != len(settings) or paths != list(gen.get('file_list', []) or [])
                or [id(x) for x in settings] != [id(x) for x in (gen.get('file_settings_list', []) or [])]):
            return
        for raw_path, meta in zip(paths, settings):
            if not isinstance(raw_path, (str, Path)) or not isinstance(meta, dict):
                continue
            cid = str(meta.get('client_id', ''))
            if cid not in item['state']['client_ids']:
                continue
            task_index = item['state']['client_ids'].index(cid)+1
            candidates = [w for w in item['tracker'].windows if w['task_index'] == task_index]
            window_index = _telemetry_module.positive(meta.get('window_no'), 1 if len(candidates) == 1 else None)
            path = Path(raw_path)
            if not path.is_absolute():
                path = Path(getattr(self.session, '_root', Path.cwd())) / path
            try:
                # A completed, native video only. Refuse symlinks and special files.
                if path.is_symlink() or path.suffix.lower() not in {'.mp4', '.webm', '.mov', '.mkv', '.m4v'}:
                    continue
                path = path.resolve(strict=True)
                st = path.stat()
                if not stat.S_ISREG(st.st_mode) or st.st_size <= 0:
                    continue
            except OSError:
                continue
            signature = (str(path), st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns)
            if signature in item['seen_paths']:
                continue
            item['seen_paths'].add(signature)
            output_id = uuid.uuid4().hex
            record = {'id': output_id, 'job_id': job_id, 'name': path.name,
                      'task_index': task_index, 'window_index': window_index,
                      'cumulative': bool(candidates and candidates[0]['linked']),
                      'bytes': st.st_size, 'created_at': time.time(),
                      'content_type': mimetypes.guess_type(path.name)[0] or 'video/mp4',
                      'timeline_mapping': 'planned_24fps' if window_index is not None else 'unmapped',
                      '_path': path, '_stat': signature[1:]}
            self.outputs[output_id] = record
            item['outputs'].append(output_id)
            if window_index is not None:
                item['tracker'].mark_output(task_index, window_index)

    def output_record(self, job_id, output_id):
        with self.lock:
            record = self.outputs.get(output_id)
            if record is None or record['job_id'] != job_id:
                raise ValueError('Unknown output for this job.')
            return record.copy()

    @staticmethod
    def output_available(record):
        try:
            path = record['_path']
            st = path.stat()
            return not path.is_symlink() and (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns) == record['_stat']
        except OSError:
            return False

    @staticmethod
    def manifest_client_ids(manifest):
        """Read correlation IDs only; never expose prompts, media paths, or secrets."""
        items = manifest if isinstance(manifest, list) else [manifest] if isinstance(manifest, dict) else []
        ids = []
        for item in items:
            if not isinstance(item, dict):
                continue
            params = item.get('params', item)
            if isinstance(params, dict) and params.get('client_id'):
                ids.append(str(params['client_id']))
        return ids

    def browser_tick(self, browser_state, session_hash):
        """Return a fresh trigger only for our pending manifest, at most once.

        Must be called by a real frontend Timer/Button callback. The token is a
        trigger value, NOT an auth token. No queue mutation or GPU call occurs.
        A different page/session must never dispatch into the captured state.
        """
        with self.lock:
            context = self.session._gradio_webui_context
            gen = self.session._state.get('gen', {})
            if not session_hash or session_hash != context.get('session_hash'):
                return None, 'This is not the WanGP page that started the adapter. Return to that page; after reload, stop/start the adapter when idle.'
            if not isinstance(browser_state, dict) or browser_state.get('gen') is not gen:
                return None, 'WanGP browser state changed. Cancel pending work and stop/start the adapter to reconnect; no job was dispatched.'
            self._browser_seen_at = time.time()
            if self.httpd is None:
                return None, 'Adapter stopped.'
            inline_ids = self.manifest_client_ids(gen.get('inline_queue'))
            active_jobs = [item['state'] for item in self.jobs.values()
                           if item['state']['status'] not in TERMINAL_STATES and item['state']['status'] != 'cancelling']
            ours = {cid for state in active_jobs for cid in state.get('client_ids', [])}
            # Do not trigger work submitted by unrelated plugins or other pages.
            if inline_ids and all(cid in ours for cid in inline_ids):
                if not any(cid in self._dispatched_client_ids for cid in inline_ids):
                    self._dispatched_client_ids.update(inline_ids)
                    now = time.time()
                    for state in active_jobs:
                        if set(inline_ids).intersection(state.get('client_ids', [])):
                            state['dispatch_requested_at'] = now
                    print('[H3 Director] Browser dispatch requested for '+', '.join(inline_ids))
                    return 'h3director-dispatch-'+uuid.uuid4().hex, 'Dispatch requested through WanGP’s browser. The normal queue and generation events will follow.'
                return None, 'Dispatch was requested; waiting for WanGP to consume the pending manifest. No duplicate was sent.'
            if gen.get('in_progress'):
                return None, 'Browser connected; WanGP reports generation in progress.'
            return None, 'Browser connected; no undispatched Director manifest.'

    def diagnostics(self):
        with self.lock:
            gen = self.session._state.get('gen', {})
            queue = gen.get('queue', []) or []
            queue_ids = self.manifest_client_ids(queue)
            return {
                'dispatch_mode': 'browser_event_chain',
                'browser_required': True,
                'browser_last_seen_seconds': None if self._browser_seen_at is None else round(max(0, time.time()-self._browser_seen_at), 1),
                'inline_client_ids': self.manifest_client_ids(gen.get('inline_queue')),
                'queue_client_ids': queue_ids,
                'queue_length': len(queue),
                'active_client_id': self.manifest_client_ids(queue[:1])[0] if self.manifest_client_ids(queue[:1]) else None,
                'generation_in_progress': bool(gen.get('in_progress', False)),
                'queue_paused_for_edit': bool(gen.get('queue_paused_for_edit', False)),
            }

    def job_state(self, job_id):
        with self.lock:
            if job_id not in self.jobs:
                raise ValueError('Unknown job. Adapter job history is in memory and resets when WanGP restarts.')
            item = self.jobs[job_id]
            stored = item['state']
            try:
                self.collect_outputs(job_id)
            except Exception as exc:
                stored['telemetry_warning'] = 'Output observation unavailable: '+str(exc)[:250]
            data = copy.deepcopy(stored)
            data['telemetry'] = item['tracker'].snapshot() if item['tracker'] else None
            data['outputs'] = [{**plain(self.outputs[oid]), 'available': self.output_available(self.outputs[oid])} for oid in item['outputs']]
            data['adapter_version'] = ADAPTER_VERSION
            d = self.diagnostics()
            data['diagnostics'] = d
            own = set(data.get('client_ids', []))
            data['phase'] = data['status']
            if data['status'] in TERMINAL_STATES or data['status'] == 'cancelling':
                return data
            if d['generation_in_progress'] and d['active_client_id'] in own:
                data['status'] = 'running'
                data['phase'] = 'generating'
                item['tracker'].mark_running()
                data['telemetry'] = item['tracker'].snapshot() if item['tracker'] else None
                if 'generation_seen_at' not in stored:
                    stored['generation_seen_at'] = time.time()
                    print('[H3 Director] WanGP generation observed for '+job_id)
                if stored['status'] != 'running':
                    data['message'] = 'WanGP reports this job is starting/running; waiting for detailed progress.'
            elif own.intersection(d['inline_client_ids']):
                data['phase'] = 'dispatch_requested' if data.get('dispatch_requested_at') else 'waiting_for_browser'
                data['message'] = ('Browser dispatch requested; waiting for WanGP queue admission.' if data.get('dispatch_requested_at') else
                                   'Waiting for browser dispatch. Keep the original WanGP page open and visible; no generation has started.')
            elif own.intersection(d['queue_client_ids']):
                data['phase'] = 'queued' if d['generation_in_progress'] else 'admitted_not_started'
                data['message'] = ('Queued behind other WanGP work.' if d['generation_in_progress'] else
                                   'Admitted to WanGP, but generation has not started. Keep the original WanGP page open and visible.')
            elif not data.get('dispatch_requested_at'):
                data['phase'] = 'preparing_submission'
            if d['queue_paused_for_edit']:
                data['message'] = 'WanGP queue is paused for task editing. Finish or cancel the edit in WanGP.'
            idle_wait = (not d['generation_in_progress'] and time.time()-data['created_at'] >= DISPATCH_WARNING_SECONDS
                         and 'generation_seen_at' not in stored)
            if idle_wait and not d['queue_paused_for_edit']:
                data['warning'] = ('Generation has not started. Check browser dispatch in the H3 Director WanGP tab. '
                                   'Keep that original page visible; do not resubmit this job. Cancel it before restarting or reconnecting.')
            return data

    def start(self):
        if self.httpd:
            return
        adapter = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def log_message(self, *_args):
                pass
            def reply(self, status, data):
                encoded = json.dumps(plain(data), ensure_ascii=False, allow_nan=False).encode()
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(encoded)))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Connection', 'close')
                origin = self.headers.get('Origin')
                if origin in adapter.origins:
                    self.send_header('Access-Control-Allow-Origin', origin)
                    self.send_header('Vary', 'Origin')
                    self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.end_headers()
                self.wfile.write(encoded)
                self.close_connection = True
            def auth(self, preflight=False):
                allowed = {'127.0.0.1:'+str(adapter.port), 'localhost:'+str(adapter.port)}
                if self.headers.get('Host') not in allowed:
                    self.reply(403, {'error': 'Unexpected Host header. Use the loopback URL or an SSH tunnel.'})
                    return False
                origin = self.headers.get('Origin')
                if origin and origin not in adapter.origins:
                    self.reply(403, {'error': 'Origin is not allowed. Use the local bridge or set H3_EDITOR_ORIGIN.'})
                    return False
                if not preflight and not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+adapter.token):
                    self.reply(401, {'error': 'Missing or incorrect adapter token. Copy the token from the H3 Director plugin tab.'})
                    return False
                return True
            def read_json(self):
                n = int(self.headers.get('Content-Length', '0'))
                if n < 1 or n > MAX_JSON:
                    raise ValueError('JSON payload is empty or exceeds 32 MiB.')
                return json.loads(self.rfile.read(n))
            def do_OPTIONS(self):
                if self.auth(preflight=True):
                    self.reply(200, {})
            def send_output(self, job_id, output_id, head=False):
                record = adapter.output_record(job_id, output_id)
                if not adapter.output_available(record):
                    self.reply(410, {'error': 'This output was removed or changed. WanGP may retain only the latest cumulative video.'})
                    return
                fd = os.open(record['_path'], os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                with os.fdopen(fd, 'rb') as source:
                    st = os.fstat(source.fileno())
                    if not stat.S_ISREG(st.st_mode) or (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns) != record['_stat']:
                        self.reply(410, {'error': 'Output changed; refresh available renders.'})
                        return
                    size = st.st_size
                    start, end, code = 0, size-1, 200
                    requested = self.headers.get('Range')
                    if requested:
                        match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested.strip())
                        if not match or not any(match.groups()):
                            self.reply(416, {'error': 'Only one byte range is supported.'})
                            return
                        a, b = match.groups()
                        if a:
                            start = int(a)
                            end = min(size-1, int(b)) if b else size-1
                        else:
                            start = max(0, size-int(b))
                        if start < 0 or start >= size or end < start:
                            self.send_response(416)
                            self.send_header('Content-Range', 'bytes */'+str(size))
                            self.send_header('Content-Length', '0')
                            self.end_headers()
                            return
                        code = 206
                    self.send_response(code)
                    self.send_header('Content-Type', record['content_type'])
                    self.send_header('Content-Length', str(end-start+1))
                    self.send_header('Accept-Ranges', 'bytes')
                    if code == 206:
                        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                    self.send_header('Cache-Control', 'no-store')
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.send_header('Connection', 'close')
                    self.end_headers()
                    if not head:
                        source.seek(start)
                        left = end-start+1
                        try:
                            while left:
                                data = source.read(min(65536, left))
                                if not data:
                                    break
                                self.wfile.write(data)
                                left -= len(data)
                        except (BrokenPipeError, ConnectionResetError):
                            pass  # Browser seeking closes the preceding byte-range request.
                    self.close_connection = True
            def do_HEAD(self):
                if not self.auth():
                    return
                match = re.fullmatch(r'/jobs/([a-zA-Z0-9_-]+)/outputs/([a-f0-9]{32})', urlsplit(self.path).path)
                try:
                    if match:
                        self.send_output(*match.groups(), head=True)
                    else:
                        self.reply(404, {'error': 'Unknown endpoint.'})
                except (ValueError, OSError):
                    self.reply(404, {'error': 'Output unavailable.'})
            def do_GET(self):
                if not self.auth():
                    return
                try:
                    path = urlsplit(self.path)
                    output_match = re.fullmatch(r'/jobs/([a-zA-Z0-9_-]+)/outputs/([a-f0-9]{32})', path.path)
                    if output_match:
                        self.send_output(*output_match.groups())
                        return
                    if path.path == '/health':
                        data = {'app': 'h3-director-wangp', 'version': ADAPTER_VERSION, 'note': 'Uses the existing WebUI queue through a browser event chain. Keep the original WanGP page open and visible. Outputs remain in its gallery.', 'diagnostics': adapter.diagnostics()}
                    elif path.path == '/models':
                        data = {'models': adapter.session.list_model_metadata(query='H3', limit=500, offset=0)}
                    elif path.path == '/model':
                        model_type = parse_qs(path.query).get('model_type', [''])[0]
                        metadata = adapter.model(model_type)
                        getter = getattr(adapter.session, 'get_exported_default_settings', adapter.session.get_default_settings)
                        data = {'metadata': metadata, 'defaults': getter(model_type), 'schema': adapter.session.get_model_schema(model_type), 'director_profile': adapter.verify_preset(model_type)}
                    elif path.path.startswith('/jobs/') and len(path.path.split('/')) == 3:
                        data = adapter.job_state(path.path.split('/')[2])
                    else:
                        self.reply(404, {'error': 'Unknown endpoint.'})
                        return
                    self.reply(200, data)
                except Exception as exc:
                    self.reply(400, {'error': str(exc)})
            def do_POST(self):
                if not self.auth():
                    return
                try:
                    path = urlsplit(self.path)
                    if path.path == '/upload':
                        filename = Path(parse_qs(path.query).get('filename', ['reference'])[0].replace('\\', '/')).name
                        suffix = Path(filename).suffix.lower()
                        if suffix not in EXTENSIONS:
                            raise ValueError('Unsupported media extension. Upload a standard image, video, or audio file.')
                        n = int(self.headers.get('Content-Length', '0'))
                        if not 0 < n <= MAX_UPLOAD:
                            raise ValueError('Upload size must be between 1 byte and 2 GiB.')
                        media_id = 'h3media:'+uuid.uuid4().hex
                        destination = Path(adapter.temp.name) / (media_id.split(':')[1]+suffix)
                        remaining = n
                        try:
                            with destination.open('xb') as output:
                                while remaining:
                                    chunk = self.rfile.read(min(1024*1024, remaining))
                                    if not chunk:
                                        raise ValueError('Upload ended early.')
                                    output.write(chunk)
                                    remaining -= len(chunk)
                        except Exception:
                            destination.unlink(missing_ok=True)
                            raise
                        with adapter.lock:
                            adapter.media[media_id] = {'path': str(destination), 'name': filename, 'size': n}
                        data = {'media_id': media_id, 'name': filename, 'size': n}
                    elif path.path == '/import-render':
                        data = adapter.import_render(self.read_json())
                    elif path.path == '/generate':
                        data = adapter.submit(self.read_json())
                    elif path.path.startswith('/jobs/') and path.path.endswith('/cancel') and len(path.path.split('/')) == 4:
                        job_id = path.path.split('/')[2]
                        adapter.job_state(job_id)
                        with adapter.lock:
                            item = adapter.jobs[job_id]
                            if item['state']['status'] not in {'completed', 'failed', 'cancelled'}:
                                item['state']['status'] = 'cancelling'
                                if item['job'] is not None:
                                    item['job'].cancel()
                        data = adapter.job_state(job_id)
                    else:
                        self.reply(404, {'error': 'Unknown endpoint.'})
                        return
                    self.reply(200, data)
                except Exception as exc:
                    self.reply(400, {'error': str(exc)})
        self.httpd = ThreadingHTTPServer(('127.0.0.1', self.port), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, name='h3-director-http', daemon=True)
        self.thread.start()

    def stop(self, force=False):
        with self.lock:
            active = any(v['state']['status'] not in {'completed', 'failed', 'cancelled'} for v in self.jobs.values())
        if active and not force:
            raise ValueError('Jobs are still active. Cancel or finish them before stopping the adapter.')
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
        if not active:
            self.temp.cleanup()

class H3DirectorPlugin(WAN2GPPlugin):
    def __init__(self):
        super().__init__()
        self.name = 'H3 Director'
        self.version = ADAPTER_VERSION
        self.description = 'Authenticated local adapter for the H3 Director timeline editor. Reuses the live WebUI queue.'
        # Request this before WanGP injects components. Requesting it only when
        # the tab's API proxy is constructed can be too late on some revisions.
        self.request_component('state')
        self.request_component('load_queue_trigger')
        self.adapter = None
        self._adapter_lock = threading.RLock()
        atexit.register(self._shutdown)
    def _shutdown(self):
        if self.adapter:
            self.adapter.stop(force=True)
    def setup_ui(self):
        self.add_tab('h3_director', 'H3 Director', self.create_config_ui)
    def create_config_ui(self, api_session):
        # Resolve the main trigger, not a similarly named component in an edit form.
        resolver = getattr(api_session, '_resolve_main_bridge_component', None)
        load_trigger = resolver('wangp_main_load_queue_trigger') if callable(resolver) else getattr(self, 'load_queue_trigger', None)
        if load_trigger is None or getattr(self, 'state', None) is None:
            raise RuntimeError('H3 Director needs WanGP’s main load_queue_trigger and state components. Restart WanGP after installing the plugin.')
        with gr.Blocks() as tab:
            gr.Markdown('## H3 Director connection\nConnect the separate timeline editor to this **existing WebUI queue**. The adapter binds only to loopback. Use an SSH tunnel for a remote machine; do not expose it to the public Internet.')
            status = gr.Textbox(label='Adapter status', value='Stopped', interactive=False)
            url = copyable_textbox(label='Adapter URL')
            # A disabled password input cannot reveal the generated token. Use
            # visible text plus Gradio's native copy control (label must be shown).
            # These remain outputs only; editing the page cannot rotate the token.
            token = copyable_textbox(
                label='Adapter token — copy into the editor; keep private',
                info='Visible in plain text so you can copy it. Keep it out of screenshots and screen shares. '
                     'If the copy icon does not work, select the visible token text and copy it manually.',
            )
            gr.Markdown('**Keep this original WanGP browser page open and visible while dispatching/generating.** You may select Media Generator within this page. A separate visible window beside Director works well. Hidden/discarded browser tabs can pause dispatch; this is not a headless API. After reloading WanGP, stop/start the adapter when idle to bind the new page.')
            dispatch_status = gr.Textbox(label='Browser dispatch', value='Adapter stopped.', interactive=False)
            with gr.Row():
                start = gr.Button('Start adapter', variant='primary')
                stop = gr.Button('Stop adapter')
                check = gr.Button('Check browser dispatch')
            timer = gr.Timer(value=1.0, active=True)
            def start_adapter():
                try:
                    with self._adapter_lock:
                        if self.adapter is None:
                            # Do not store api_session itself: HTTP workers have
                            # no active Gradio callback in which to resolve it.
                            session = bind_webui_session(api_session)
                            adapter = DirectorAdapter(session, int(os.environ.get('H3_WANGP_PORT', '7867')), os.environ.get('H3_WANGP_TOKEN') or None)
                            try:
                                adapter.start()
                            except Exception:
                                adapter.stop(force=True)
                                raise
                            self.adapter = adapter
                        return 'Running (adapter '+ADAPTER_VERSION+') — existing WebUI queue', 'http://127.0.0.1:'+str(self.adapter.port), self.adapter.token
                except Exception as exc:
                    return 'Could not start: '+str(exc), '', ''
            def stop_adapter():
                with self._adapter_lock:
                    try:
                        if self.adapter:
                            self.adapter.stop()
                            self.adapter = None
                        return 'Stopped', '', ''
                    except Exception as exc:
                        return str(exc), 'http://127.0.0.1:'+str(self.adapter.port), self.adapter.token
            def dispatch_tick(state, request: gr.Request):
                # No API proxy here: Timer callbacks are not wrapped by WanGP.
                with self._adapter_lock:
                    adapter = self.adapter
                if adapter is None:
                    return gr.skip(), 'Adapter stopped.'
                value, message = adapter.browser_tick(state, getattr(request, 'session_hash', None))
                return (value if value is not None else gr.skip()), message
            timer.tick(dispatch_tick, inputs=[self.state], outputs=[load_trigger, dispatch_status], queue=False, show_progress='hidden')
            check.click(dispatch_tick, inputs=[self.state], outputs=[load_trigger, dispatch_status], queue=False, show_progress='hidden')
            start.click(start_adapter, inputs=[], outputs=[status, url, token])
            stop.click(stop_adapter, inputs=[], outputs=[status, url, token])
        return tab
