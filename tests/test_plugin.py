"""Adapter regression tests. Uses strict Gradio/WanGP doubles, never a GPU.

Run: python3 -m unittest discover -s tests -p 'test_plugin.py' -v
Optional H3_PLUGIN_PATH tests another copy (for reproducing old failures).
"""
from __future__ import annotations
import contextlib
import copy
import importlib.util
import inspect
import json
import os
from pathlib import Path
import sys
import threading
import time
import types
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

LIVE = threading.local()
MODEL = 'test_h3_ref2va_pruned_20b_pdd8'


@contextlib.contextmanager
def live_callback():
    previous = getattr(LIVE, 'active', False)
    LIVE.active = True
    try:
        yield
    finally:
        LIVE.active = previous


class FakeComponent:
    def __init__(self, *args, **kwargs):
        self.value = kwargs.get('value')
        self.kwargs = dict(kwargs)
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False


class FakeTextbox(FakeComponent):
    def __init__(self, *args, show_copy_button=False, **kwargs):
        super().__init__(*args, show_copy_button=show_copy_button, **kwargs)


class FakeButton(FakeComponent):
    registry = {}
    def __init__(self, label, **kwargs):
        super().__init__(**kwargs)
        self.registry[label] = self
    def click(self, fn, **kwargs):
        self.inputs = kwargs.get('inputs', [])
        self.outputs = kwargs.get('outputs', [])
        # Model the relevant guard in WanGP's wrapped button callback: it
        # resolves live state *before* entering the plugin's try/except.
        proxies = [v for v in inspect.getclosurevars(fn).nonlocals.values() if isinstance(v, FakeProxy)]
        def wrapped(*args, **kw):
            for proxy in proxies:
                proxy._resolve_state()
            return fn(*args, **kw)
        self.fn = wrapped
        return self


class FakePluginBase:
    def __init__(self):
        self.component_requests = []
        self.tabs = {}
    def request_component(self, name):
        if name not in self.component_requests:
            self.component_requests.append(name)
    def add_tab(self, tab_id, label, constructor):
        self.tabs[tab_id] = constructor


class FakeTimer(FakeComponent):
    registry = []
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.registry.append(self)
    def tick(self, fn, **kwargs):
        self.fn = fn
        self.tick_kwargs = kwargs
        return self


class FakeRequest:
    def __init__(self, session_hash='fixture-browser-session'):
        self.session_hash = session_hash


class FakeJob:
    def __init__(self, session):
        self.session = session
        self.cancelled = False
        self.done = threading.Event()
    def result(self):
        if not self.done.wait(10):
            raise RuntimeError('Fixture job was never run through the browser chain')
        return types.SimpleNamespace(success=not self.cancelled,
                                     generated_files=[] if self.cancelled else ['fake-output.mp4'], errors=[])
    def cancel(self):
        self.cancelled = True
        self.session._state['gen'].pop('inline_queue', None)
        self.session._state['gen']['queue'] = []
        self.done.set()


class FakeSession:
    """Deliberately distinguishes ADMISSION from EXECUTION (old tests did not)."""
    def __init__(self, state):
        self._state = state
        self._use_webui_queue = True
        self.tasks = []
        self.submit_threads = []
        self.job = None
        self.chain = []
    def list_model_metadata(self, **kwargs):
        return [self.get_model_metadata(MODEL)]
    def get_model_metadata(self, model_type):
        return {'model_type': model_type, 'name': 'H3 Ref2VA pruned 20B PDD-8'}
    def list_model_defs(self, **kwargs):
        return [{'model_type': MODEL, 'pdd': True}]
    def get_default_settings(self, model_type):
        return {'model_type': model_type, 'num_inference_steps': 8}
    def get_exported_default_settings(self, model_type):
        return self.get_default_settings(model_type)
    def get_model_schema(self, model_type):
        return {'model_type': model_type}
    def submit_manifest(self, tasks, callbacks):
        ctx = self._gradio_webui_context
        if not ctx.get('session_hash') or ctx.get('request') is None:
            raise RuntimeError('Missing captured Gradio request')
        self.tasks.extend(tasks)
        self.submit_threads.append(threading.get_ident())
        self.callbacks = callbacks
        self.job = FakeJob(self)
        self._state['gen']['inline_queue'] = [{'params': copy.deepcopy(t)} for t in tasks]
        if not ctx.get('defer_load_queue_trigger', False):
            # This models a backend _queue.push: it loads, but no browser
            # submission owns the completion event to schedule .then().
            self.load_only()
        return self.job
    def load_only(self):
        gen = self._state['gen']
        inline = gen.pop('inline_queue', None)
        if inline is not None:
            gen['queue'].extend(inline)
            self.chain.append('load_queue_action')
            self.callbacks.on_status('Waiting in WanGP queue...')
    def browser_chain(self):
        self.load_only()
        self.chain.extend(['init_process_queue_if_any', 'activate_status', 'process_tasks'])
        gen = self._state['gen']
        gen['in_progress'] = True
        self.callbacks.on_progress(types.SimpleNamespace(progress=50, status='Fixture only'))
        gen['queue'].clear()
        gen['in_progress'] = False
        self.chain.append('finalize_generation_with_state')
        self.job.done.set()


class FakeProxy:
    def __init__(self, plugin):
        self.plugin = plugin
        self.session = None
        self.bind_calls = 0
        self.context = {'blocks': object(), 'request': object(), 'session_hash': 'fixture-browser-session',
                        'load_queue_fn_index': 42, 'abort_fn_index': 43,
                        'defer_load_queue_trigger': True, 'event_id': 'finished-start-click'}
    def _resolve_main_bridge_component(self, elem_id):
        assert elem_id == 'wangp_main_load_queue_trigger'
        return self.plugin.load_queue_trigger
    def _resolve_state(self):
        component = getattr(self.plugin, 'state', None)
        if component is None or not isinstance(component.value, dict):
            raise RuntimeError('WanGP WebUI session requires access to the live Gradio state component.')
        if not getattr(LIVE, 'active', False):
            raise RuntimeError('No live Gradio callback on this thread')
        return component.value
    def _ensure_session(self):
        state = self._resolve_state()
        if self.session is None:
            self.session = FakeSession(state)
        return self.session
    def _bind_gradio_context(self, session):
        self._resolve_state()
        self.bind_calls += 1
        session._gradio_webui_context = self.context
    def __getattr__(self, name):
        if name.startswith('_'):
            raise AttributeError(name)
        return getattr(self._ensure_session(), name)


def load_plugin():
    gradio = types.ModuleType('gradio')
    for name in ['Blocks', 'Row', 'Markdown']:
        setattr(gradio, name, FakeComponent)
    gradio.Button = FakeButton
    gradio.Textbox = FakeTextbox
    gradio.Timer = FakeTimer
    gradio.Request = FakeRequest
    gradio.skip = lambda: {'__type__': 'update'}
    plugins = types.ModuleType('shared.utils.plugins')
    plugins.WAN2GPPlugin = FakePluginBase
    modules = {'gradio': gradio, 'shared': types.ModuleType('shared'),
               'shared.utils': types.ModuleType('shared.utils'), 'shared.utils.plugins': plugins}
    path = Path(os.environ.get('H3_PLUGIN_PATH', str(Path(__file__).resolve().parents[1] / 'wan2gp-h3-director/plugin.py')))
    spec = importlib.util.spec_from_file_location('h3_director_plugin_under_test', path)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


PLUGIN = load_plugin()


class AdapterTests(unittest.TestCase):
    def setUp(self):
        FakeButton.registry.clear()
        FakeTimer.registry.clear()
        self.plugin = PLUGIN.H3DirectorPlugin()
        self.plugin.setup_ui()
        # Mimic the early component-injection pass before tab construction.
        if 'state' in self.plugin.component_requests:
            self.plugin.state = FakeComponent(value={'gen': {'queue': []}})
        if 'load_queue_trigger' in self.plugin.component_requests:
            self.plugin.load_queue_trigger = FakeComponent(value='')
        self.proxy = FakeProxy(self.plugin)
        self.plugin.create_config_ui(self.proxy)
        self.start_button = FakeButton.registry['Start adapter']
        self.stop_button = FakeButton.registry['Stop adapter']
        self.port_env = patch.dict(os.environ, {'H3_WANGP_PORT': '0', 'H3_WANGP_TOKEN': 'fixture-only-token'})
        self.port_env.start()
        self.addCleanup(self.port_env.stop)
        self.addCleanup(self.plugin._shutdown)
        self.addCleanup(self.cancel_fixture_job)
    def cancel_fixture_job(self):
        if self.proxy.session is not None and self.proxy.session.job is not None:
            self.proxy.session.job.cancel()
    def tick(self, request=None, state=None):
        return FakeTimer.registry[-1].fn(self.plugin.state.value if state is None else state, request or FakeRequest())
    def start(self):
        with live_callback():
            result = self.start_button.fn()
        self.assertTrue(result[0].startswith('Running'), result)
        return result
    def request(self, path, body=None, authorized=True, raw=None):
        adapter = self.plugin.adapter
        headers = {'Authorization': 'Bearer '+adapter.token} if authorized else {}
        if body is not None:
            headers['Content-Type'] = 'application/json'
            raw = json.dumps(body).encode()
        req = Request('http://127.0.0.1:'+str(adapter.port)+path, data=raw, headers=headers)
        try:
            with urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as exc:
            return exc.code, json.load(exc)
    def task(self, **extra):
        return {'model_type': MODEL, 'prompt': 'Fixture only', 'num_inference_steps': 8,
                'sample_solver': 'euler', **extra}
    def test_component_requested_before_tab_construction(self):
        self.assertIn('state', self.plugin.component_requests)
    def test_start_callback_does_not_raise_missing_live_state(self):
        result = self.start()
        self.assertIn('1.0.5', result[0])
    def test_token_field_is_readable_and_has_native_copy_button(self):
        token = self.start_button.outputs[2]
        self.assertEqual(token.kwargs['type'], 'text')
        self.assertTrue(token.kwargs['show_label'])
        self.assertTrue(token.kwargs['show_copy_button'])
        self.assertFalse(token.kwargs['interactive'])
        self.assertIn('screenshots', token.kwargs['info'])
        self.assertIn('manually', token.kwargs['info'])
        self.assertIs(self.stop_button.outputs[2], token)
        self.assertNotIn(token, self.start_button.inputs)
        self.assertNotIn(token, self.stop_button.inputs)
    def test_gradio6_copy_parameter_is_supported(self):
        class ModernTextbox(FakeComponent):
            def __init__(self, *, buttons=None, **kwargs):
                if 'show_copy_button' in kwargs:
                    raise TypeError('Gradio 6 removed show_copy_button')
                super().__init__(buttons=buttons, **kwargs)
        with patch.object(PLUGIN.gr, 'Textbox', ModernTextbox):
            field = PLUGIN.copyable_textbox(label='Fixture')
        self.assertEqual(field.kwargs['buttons'], ['copy'])
        self.assertEqual(field.kwargs['type'], 'text')
        self.assertTrue(field.kwargs['show_label'])
    def test_unknown_copy_api_falls_back_to_readable_text(self):
        with patch.object(PLUGIN.gr, 'Textbox', FakeComponent):
            field = PLUGIN.copyable_textbox(label='Fixture')
        self.assertEqual(field.kwargs['type'], 'text')
        self.assertNotIn('show_copy_button', field.kwargs)
        self.assertNotIn('buttons', field.kwargs)
    def test_url_field_has_native_copy_button(self):
        url = self.start_button.outputs[1]
        self.assertTrue(url.kwargs['show_copy_button'])
        self.assertTrue(url.kwargs['show_label'])
        self.assertFalse(url.kwargs['interactive'])
    def test_start_returns_actual_token_and_stop_clears_display(self):
        result = self.start()
        self.assertEqual(result[2], self.plugin.adapter.token)
        self.assertEqual(result[2], 'fixture-only-token')
        with live_callback():
            stopped = self.stop_button.fn()
        self.assertEqual(stopped, ('Stopped', '', ''))
    def test_adapter_keeps_backend_not_callback_proxy(self):
        self.start()
        self.assertIs(self.plugin.adapter.session, self.proxy.session)
        self.assertIsNot(self.plugin.adapter.session, self.proxy)
        self.assertIs(self.proxy.session._state, self.plugin.state.value)
    def test_raw_proxy_fails_outside_callback_but_bound_session_works(self):
        self.start()
        with self.assertRaisesRegex(RuntimeError, 'No live Gradio callback'):
            self.proxy.list_model_metadata()
        code, data = self.request('/models')
        self.assertEqual(code, 200)
        self.assertEqual(data['models'][0]['model_type'], MODEL)
    def test_context_is_copied_without_copying_live_objects(self):
        self.start()
        ctx = self.proxy.session._gradio_webui_context
        self.assertIsNot(ctx, self.proxy.context)
        self.assertIs(ctx['blocks'], self.proxy.context['blocks'])
        self.assertIs(ctx['request'], self.proxy.context['request'])
        self.assertTrue(ctx['defer_load_queue_trigger'])
        self.assertTrue(self.proxy.context['defer_load_queue_trigger'])
        self.assertNotIn('event_id', ctx)
    def test_missing_context_rejected_before_listener_starts(self):
        self.proxy.context = None
        with live_callback():
            result = self.start_button.fn()
        self.assertIn('Could not start', result[0])
        self.assertIsNone(self.plugin.adapter)
    def test_missing_queue_trigger_rejected(self):
        self.proxy.context['load_queue_fn_index'] = None
        with live_callback():
            result = self.start_button.fn()
        self.assertIn('queue trigger', result[0])
        self.assertIsNone(self.plugin.adapter)
    def test_headless_session_is_rejected(self):
        with live_callback():
            self.proxy._ensure_session()._use_webui_queue = False
            result = self.start_button.fn()
        self.assertIn('Refusing to start', result[0])
        self.assertIsNone(self.plugin.adapter)
    def test_unsupported_binding_api_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'Unsupported WanGP'):
            PLUGIN.bind_webui_session(object())
    def test_repeated_start_does_not_rebind_or_replace_listener(self):
        first = self.start()
        adapter = self.plugin.adapter
        second = self.start()
        self.assertEqual(first, second)
        self.assertIs(self.plugin.adapter, adapter)
        self.assertEqual(self.proxy.bind_calls, 1)
    def test_stop_and_restart_gets_new_adapter(self):
        self.start()
        old = self.plugin.adapter
        with live_callback():
            result = self.stop_button.fn()
        self.assertEqual(result[0], 'Stopped')
        self.assertIsNone(self.plugin.adapter)
        self.assertIsNone(old.httpd)
        self.start()
        self.assertIsNot(self.plugin.adapter, old)
    def test_health_reports_patch_version(self):
        self.start()
        code, data = self.request('/health')
        self.assertEqual(code, 200)
        self.assertEqual(data['version'], '1.0.5')
    def test_http_auth_still_required(self):
        self.start()
        code, _ = self.request('/models', authorized=False)
        self.assertEqual(code, 401)
    def test_defaults_discovery_runs_outside_callback(self):
        self.start()
        code, data = self.request('/model?model_type='+MODEL)
        self.assertEqual(code, 200)
        self.assertEqual(data['defaults']['model_type'], MODEL)
    def test_http_submit_uses_saved_context_on_another_thread(self):
        self.start()
        caller_thread = threading.get_ident()
        code, data = self.request('/generate', {'tasks': [self.task()]})
        self.assertEqual(code, 200, data)
        self.assertEqual(data['status'], 'submitted')
        self.assertFalse(self.proxy.session.job.done.is_set())
        trigger, _ = self.tick()
        self.assertIsInstance(trigger, str)
        self.proxy.session.browser_chain()
        for _ in range(50):
            _, status = self.request('/jobs/'+data['job_id'])
            if status['status'] == 'completed':
                break
            time.sleep(.01)
        self.assertEqual(status['status'], 'completed')
        self.assertEqual(status['generated_files'], ['fake-output.mp4'])
        self.assertNotEqual(self.proxy.session.submit_threads[0], caller_thread)
        self.assertEqual(len(self.proxy.session.tasks), 1)
    def test_upload_and_task_mapping_still_work(self):
        self.start()
        code, media = self.request('/upload?filename=fixture.png', raw=b'fixture-not-real-media')
        self.assertEqual(code, 200, media)
        code, data = self.request('/generate', {'tasks': [self.task(image_refs=[media['media_id']])]})
        self.assertEqual(code, 200, data)
        path = Path(self.proxy.session.tasks[0]['image_refs'][0])
        self.assertEqual(path.read_bytes(), b'fixture-not-real-media')
    def test_arbitrary_filesystem_reference_still_rejected(self):
        self.start()
        code, data = self.request('/generate', {'tasks': [self.task(image_refs=['/tmp/not-uploaded.png'])]})
        self.assertEqual(code, 400)
        self.assertIn('Unknown media ID', data['error'])
    def test_failed_listener_start_can_be_retried(self):
        with patch.object(PLUGIN.DirectorAdapter, 'start', side_effect=OSError('fixture port busy')):
            with live_callback():
                result = self.start_button.fn()
        self.assertIn('fixture port busy', result[0])
        self.assertIsNone(self.plugin.adapter)
        self.start()

    def submit_fixture(self):
        self.start()
        code, data = self.request('/generate', {'tasks': [self.task()]})
        self.assertEqual(code, 200, data)
        return data['job_id']
    def test_load_trigger_requested_early(self):
        self.assertIn('load_queue_trigger', self.plugin.component_requests)
    def test_timer_targets_native_main_trigger_without_queue(self):
        timer = FakeTimer.registry[-1]
        self.assertEqual(timer.kwargs['value'], 1.0)
        self.assertTrue(timer.kwargs['active'])
        self.assertFalse(timer.tick_kwargs['queue'])
        self.assertIs(timer.tick_kwargs['outputs'][0], self.plugin.load_queue_trigger)
        self.assertEqual(timer.tick_kwargs['inputs'], [self.plugin.state])
    def test_stopped_timer_does_not_dispatch(self):
        token, message = self.tick()
        self.assertEqual(token, {'__type__': 'update'})
        self.assertIn('stopped', message)
    def test_native_browser_dispatch_runs_once_per_manifest(self):
        job_id = self.submit_fixture()
        self.assertEqual(self.proxy.session.chain, [])
        self.assertEqual(self.plugin.adapter.job_state(job_id)['phase'], 'waiting_for_browser')
        first, _ = self.tick()
        second, _ = self.tick()
        self.assertTrue(first.startswith('h3director-dispatch-'))
        self.assertEqual(second, {'__type__': 'update'})
        self.assertEqual(self.proxy.session.chain, [])  # Tick must NOT run GPU code.
        self.assertEqual(self.plugin.adapter.job_state(job_id)['phase'], 'dispatch_requested')
        self.proxy.session.browser_chain()
        self.assertIn('process_tasks', self.proxy.session.chain)
        self.assertTrue(self.proxy.session.job.done.is_set())
    def test_wrong_browser_session_cannot_dispatch_or_set_heartbeat(self):
        self.submit_fixture()
        value, message = self.tick(FakeRequest('another-page'))
        self.assertEqual(value, {'__type__': 'update'})
        self.assertIn('not the WanGP page', message)
        self.assertIsNone(self.plugin.adapter._browser_seen_at)
        self.assertTrue(self.plugin.state.value['gen'].get('inline_queue'))
    def test_reloaded_browser_state_does_not_dispatch_to_stale_queue(self):
        self.submit_fixture()
        value, message = self.tick(state={'gen': {'queue': []}})
        self.assertEqual(value, {'__type__': 'update'})
        self.assertIn('state changed', message)
    def test_unrelated_inline_manifest_is_not_dispatched(self):
        self.submit_fixture()
        self.plugin.state.value['gen']['inline_queue'] = [{'params': {'client_id': 'other-plugin'}}]
        value, _ = self.tick()
        self.assertEqual(value, {'__type__': 'update'})
    def test_direct_push_admission_is_not_mistaken_for_generation(self):
        job_id = self.submit_fixture()
        self.proxy.session.load_only()  # Reproduce the original failure stage.
        status = self.plugin.adapter.job_state(job_id)
        self.assertEqual(status['phase'], 'admitted_not_started')
        self.assertEqual(status['status'], 'submitted')
        self.assertFalse(status['diagnostics']['generation_in_progress'])
        self.assertEqual(status['diagnostics']['queue_length'], 1)
        self.assertFalse(self.proxy.session.job.done.is_set())
        self.assertNotIn('process_tasks', self.proxy.session.chain)
    def test_idle_stall_produces_actionable_warning_not_fake_failure(self):
        job_id = self.submit_fixture()
        self.proxy.session.load_only()
        self.plugin.adapter.jobs[job_id]['state']['created_at'] -= 60
        status = self.plugin.adapter.job_state(job_id)
        self.assertIn('do not resubmit', status['warning'])
        self.assertEqual(status['status'], 'submitted')
        self.assertEqual(status['errors'], [])
    def test_running_is_observed_only_for_owned_active_client(self):
        job_id = self.submit_fixture()
        self.proxy.session.load_only()
        self.plugin.state.value['gen']['in_progress'] = True
        status = self.plugin.adapter.job_state(job_id)
        self.assertEqual(status['phase'], 'generating')
        self.assertEqual(status['status'], 'running')
        self.assertIn('generation_seen_at', self.plugin.adapter.jobs[job_id]['state'])
    def test_other_active_job_is_reported_as_queue_wait(self):
        job_id = self.submit_fixture()
        self.proxy.session.load_only()
        gen = self.plugin.state.value['gen']
        gen['queue'].insert(0, {'params': {'client_id': 'someone-else'}})
        gen['in_progress'] = True
        self.plugin.adapter.jobs[job_id]['state']['created_at'] -= 60
        status = self.plugin.adapter.job_state(job_id)
        self.assertEqual(status['phase'], 'queued')
        self.assertEqual(status['status'], 'submitted')
        self.assertNotIn('warning', status)
    def test_duplicate_submit_is_rejected_without_new_job_or_task(self):
        self.submit_fixture()
        code, data = self.request('/generate', {'tasks': [self.task()]})
        self.assertEqual(code, 400)
        self.assertIn('already active', data['error'])
        self.assertEqual(len(self.proxy.session.tasks), 1)
        self.assertEqual(len(self.plugin.adapter.jobs), 1)
    def test_cancel_waiting_job_does_not_dispatch(self):
        job_id = self.submit_fixture()
        code, data = self.request('/jobs/'+job_id+'/cancel', body={})
        self.assertEqual(code, 200)
        self.assertTrue(self.proxy.session.job.cancelled)
        value, _ = self.tick()
        self.assertEqual(value, {'__type__': 'update'})
    def test_health_diagnostics_do_not_include_token_prompt_or_media(self):
        self.submit_fixture()
        code, data = self.request('/health')
        self.assertEqual(code, 200)
        encoded = json.dumps(data)
        self.assertNotIn(self.plugin.adapter.token, encoded)
        self.assertNotIn('Fixture only', encoded)
        self.assertNotIn(self.plugin.adapter.temp.name, encoded)
        self.assertTrue(data['diagnostics']['browser_required'])
    def test_completed_job_is_not_relabelled_while_next_queue_runs(self):
        job_id = self.submit_fixture()
        self.plugin.adapter.jobs[job_id]['state'].update(status='completed', progress=100)
        self.plugin.state.value['gen']['in_progress'] = True
        status = self.plugin.adapter.job_state(job_id)
        self.assertEqual(status['status'], 'completed')
        self.assertEqual(status['phase'], 'completed')
    def test_pause_for_edit_is_explained(self):
        job_id = self.submit_fixture()
        self.plugin.state.value['gen']['queue_paused_for_edit'] = True
        status = self.plugin.adapter.job_state(job_id)
        self.assertIn('paused for task editing', status['message'])

    def fixture_output(self, job_id, window_no=1):
        adapter = self.plugin.adapter
        path = Path(adapter.temp.name) / 'synthetic-output.mp4'
        path.write_bytes(b'0123456789abcdef')
        gen = self.plugin.state.value['gen']
        gen['file_list'] = [str(path)]
        gen['file_settings_list'] = [{'client_id':adapter.jobs[job_id]['state']['client_ids'][0], 'window_no':window_no}]
        adapter.collect_outputs(job_id)
        return path, adapter.job_state(job_id)['outputs'][0]
    def test_native_progress_fields_are_observed_without_dispatching_again(self):
        job_id = self.submit_fixture()
        self.proxy.session.load_only()
        self.plugin.state.value['gen'].update(in_progress=True, window_no=1,total_windows=1)
        self.proxy.session.callbacks.on_progress(types.SimpleNamespace(phase='inference',raw_phase='Denoising',progress=25,current_step=2,total_steps=8,status='Fixture'))
        data = self.plugin.adapter.job_state(job_id)
        self.assertEqual(data['telemetry']['current']['completed_steps'],2)
        self.assertEqual(data['telemetry']['current']['total_steps'],8)
        self.assertEqual(len(self.proxy.session.tasks),1)
        self.assertNotIn('process_tasks',self.proxy.session.chain)
    def test_gallery_outputs_require_owned_client_id(self):
        job_id=self.submit_fixture()
        _, output=self.fixture_output(job_id)
        self.plugin.state.value['gen']['file_settings_list'][0]['client_id']='unrelated'
        self.plugin.adapter.jobs[job_id]['seen_paths'].clear()
        self.plugin.adapter.collect_outputs(job_id)
        self.assertEqual(len(self.plugin.adapter.jobs[job_id]['outputs']),1)
        self.assertNotIn('_path',output)
        self.assertNotIn('_stat',output)
    def test_prefix_metadata_not_mislabeled_as_standalone(self):
        self.start()
        task=self.task(multi_prompts_gen_type='PW',prompt='[/duration=226]\nFirst\n\n[/duration=208,/overlap=18]\nSecond',video_length=434)
        _, data=self.request('/generate',{'tasks':[task],'plan':[{'id':'w2','title':'Second','task_index':1,'window_index':2}]})
        _,output=self.fixture_output(data['job_id'],2)
        self.assertTrue(output['cumulative'])
        self.assertEqual(output['window_index'],2)
        status=self.plugin.adapter.job_state(data['job_id'])
        self.assertEqual(status['telemetry']['windows'][1]['id'],'w2')
    def test_output_get_requires_bearer_token(self):
        job_id=self.submit_fixture();_, output=self.fixture_output(job_id)
        code,_=self.request('/jobs/'+job_id+'/outputs/'+output['id'],authorized=False)
        self.assertEqual(code,401)
    def test_output_range_and_head(self):
        job_id=self.submit_fixture();_,output=self.fixture_output(job_id)
        adapter=self.plugin.adapter
        url='http://127.0.0.1:'+str(adapter.port)+'/jobs/'+job_id+'/outputs/'+output['id']
        with urlopen(Request(url,headers={'Authorization':'Bearer '+adapter.token,'Range':'bytes=3-7'}),timeout=5) as r:
            self.assertEqual(r.status,206);self.assertEqual(r.read(),b'34567');self.assertEqual(r.headers['Content-Range'],'bytes 3-7/16')
        with urlopen(Request(url,method='HEAD',headers={'Authorization':'Bearer '+adapter.token}),timeout=5) as r:
            self.assertEqual(r.status,200);self.assertEqual(r.read(),b'');self.assertEqual(r.headers['Content-Length'],'16')
    def test_output_suffix_range(self):
        job_id=self.submit_fixture();_,output=self.fixture_output(job_id);adapter=self.plugin.adapter
        url='http://127.0.0.1:'+str(adapter.port)+'/jobs/'+job_id+'/outputs/'+output['id']
        with urlopen(Request(url,headers={'Authorization':'Bearer '+adapter.token,'Range':'bytes=-4'}),timeout=5) as r:
            self.assertEqual(r.read(),b'cdef')
    def test_output_id_cannot_cross_jobs(self):
        job_id=self.submit_fixture();_,output=self.fixture_output(job_id)
        code,_=self.request('/jobs/another-job/outputs/'+output['id'])
        self.assertEqual(code,400)
    def test_removed_output_returns_gone(self):
        job_id=self.submit_fixture();path,output=self.fixture_output(job_id);path.unlink()
        self.assertFalse(self.plugin.adapter.job_state(job_id)['outputs'][0]['available'])
        code,_=self.request('/jobs/'+job_id+'/outputs/'+output['id'])
        self.assertEqual(code,410)
    def test_replaced_output_is_not_served_under_old_id(self):
        job_id=self.submit_fixture();path,output=self.fixture_output(job_id);path.write_bytes(b'changed length')
        code,_=self.request('/jobs/'+job_id+'/outputs/'+output['id'])
        self.assertEqual(code,410)
    def test_symlinks_are_not_registered_as_video_outputs(self):
        job_id=self.submit_fixture();adapter=self.plugin.adapter
        path=Path(adapter.temp.name)/'actual.mp4';path.write_bytes(b'fake');link=path.with_name('link.mp4');link.symlink_to(path)
        gen=self.plugin.state.value['gen'];gen['file_list']=[str(link)];gen['file_settings_list']=[{'client_id':adapter.jobs[job_id]['state']['client_ids'][0]}]
        adapter.collect_outputs(job_id)
        self.assertEqual(adapter.job_state(job_id)['outputs'],[])


if __name__ == '__main__':
    unittest.main()
