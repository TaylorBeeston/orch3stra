"""Optional real-Gradio dispatch contract check; no GPU or browser required.

Run: python tests/gradio_dispatch_check.py
Uses the installed Gradio for component creation, request injection, session
state, event dependency metadata, and process_api. Models only WanGP's backend
and a client's event scheduling. This is NOT a browser end-to-end test.
"""
from __future__ import annotations
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
from unittest.mock import patch
from urllib.request import Request, urlopen

import faulthandler
faulthandler.dump_traceback_later(20, repeat=True)
import gradio as gr
from test_plugin import FakePluginBase, FakeSession, MODEL


def load_real_plugin():
    path = Path(__file__).resolve().parents[1] / 'wan2gp-h3-director/plugin.py'
    module_name = 'h3_real_gradio_contract'
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    plugins = types.ModuleType('shared.utils.plugins')
    plugins.WAN2GPPlugin = FakePluginBase
    modules = {'shared': types.ModuleType('shared'), 'shared.utils': types.ModuleType('shared.utils'),
               'shared.utils.plugins': plugins, module_name: module}
    # Keep the module registered so Gradio can resolve callback annotations.
    sys.modules[module_name] = module
    with patch.dict(sys.modules, modules):
        spec.loader.exec_module(module)
    return module


async def main():
    plugin_module = load_real_plugin()
    plugin = plugin_module.H3DirectorPlugin()
    session_hash = 'h3-real-gradio-fixture'
    holder = {}
    stages = []

    class Proxy:
        def _resolve_main_bridge_component(self, name):
            assert name == 'wangp_main_load_queue_trigger'
            return plugin.load_queue_trigger
        def _ensure_session(self):
            from gradio.context import LocalContext
            blocks = LocalContext.blocks.get()
            req = LocalContext.request.get()
            state = blocks.state_holder[req.session_hash][plugin.state._id]
            if 'session' not in holder:
                holder['session'] = FakeSession(state)
            return holder['session']
        def _bind_gradio_context(self, session):
            from gradio.context import LocalContext
            blocks = LocalContext.blocks.get()
            req = LocalContext.request.get()
            session._gradio_webui_context = {
                'blocks': blocks, 'request': req, 'session_hash': req.session_hash,
                'load_queue_fn_index': load_dependency['id'], 'abort_fn_index': 123,
                'defer_load_queue_trigger': False,
            }

    with gr.Blocks(analytics_enabled=False) as app:
        plugin.state = gr.State({'gen': {'queue': []}})
        with gr.Tabs():
            with gr.Tab('Media Generator'):
                plugin.load_queue_trigger = gr.Textbox(visible=False, elem_id='wangp_main_load_queue_trigger')
                queue_display = gr.Textbox()
                def load_queue_action(state):
                    assert state is holder['session']._state
                    stages.append('load')
                    holder['session'].load_only()
                    return 'Queue loaded'
                def prepare_queue(state):
                    stages.append('prepare')
                def process_tasks(state):
                    stages.append('process_tasks')
                    state['gen']['in_progress'] = True
                    holder['session'].callbacks.on_progress(types.SimpleNamespace(progress=50, status='Fixture generation'))
                    # Exercise the real generator event / iteration handling.
                    yield 'Preview fixture'
                    state['gen']['queue'].clear()
                    state['gen']['in_progress'] = False
                def finalize(state):
                    stages.append('finalize')
                    holder['session'].job.done.set()
                load_dependency = plugin.load_queue_trigger.change(load_queue_action, inputs=[plugin.state], outputs=[queue_display])
                load_dependency.then(prepare_queue, inputs=[plugin.state]).then(process_tasks, inputs=[plugin.state], outputs=[queue_display]).then(finalize, inputs=[plugin.state])
            with gr.Tab('Director'):
                plugin.create_config_ui(Proxy())
    config = app.get_config_file()
    dependencies = config['dependencies']
    request = gr.Request(session_hash=session_hash)
    state = app.state_holder[session_hash]
    checks = 0

    async def call(fn_id):
        nonlocal checks
        fn = app.fns[fn_id]
        output = await app.process_api(fn_id, [None for _ in fn.inputs], state=state, request=request,
                                       session_hash=session_hash, event_id='fixture-'+str(fn_id))
        while output.get('is_generating'):
            output = await app.process_api(fn_id, [], state=state, request=request,
                                           session_hash=session_hash, event_id='fixture-'+str(fn_id), iterator=output['iterator'])
        return output

    try:
        timer = next(dep for dep in dependencies if any(t[1] == 'tick' for t in dep['targets']))
        assert timer['queue'] is False
        assert timer['outputs'][0] == plugin.load_queue_trigger._id
        checks += 1
        start = next(fn_id for fn_id, fn in app.fns.items() if fn.fn.__name__ == 'start_adapter')
        with patch.dict(os.environ, {'H3_WANGP_PORT': '0', 'H3_WANGP_TOKEN': 'fixture-only-token'}):
            output = await call(start)
        assert output['data'][0].startswith('Running (adapter 1.0.5)'), output
        checks += 1
        assert plugin.adapter.session._state is state[plugin.state._id]
        assert plugin.adapter.session._gradio_webui_context['defer_load_queue_trigger'] is True
        checks += 1
        payload = {'tasks': [{'model_type': MODEL, 'prompt': 'Fixture only', 'num_inference_steps': 8, 'sample_solver': 'euler'}]}
        def submit_http():
            req = Request(f'http://127.0.0.1:{plugin.adapter.port}/generate',
                          data=json.dumps(payload).encode(), headers={'Content-Type':'application/json', 'Authorization':'Bearer fixture-only-token'})
            with urlopen(req, timeout=5) as response:
                return json.load(response)
        data = await asyncio.to_thread(submit_http)
        assert data['phase'] == 'waiting_for_browser'
        assert stages == []
        checks += 1
        output = await call(timer['id'])
        assert isinstance(output['data'][0], str) and output['data'][0].startswith('h3director-dispatch-'), output
        assert stages == []  # process_api doesn't magically execute .then().
        checks += 1
        # Model the browser's dispatch of the changed native component followed
        # by dependencies, using REAL Gradio config IDs, request/state, handlers.
        current = next(dep for dep in dependencies if [plugin.load_queue_trigger._id, 'change'] in [list(t) for t in dep['targets']])
        while current:
            await call(current['id'])
            children = [dep for dep in dependencies if dep.get('trigger_after') == current['id']]
            assert len(children) <= 1, children
            current = children[0] if children else None
        assert stages == ['load', 'prepare', 'process_tasks', 'finalize'], stages
        checks += 1
        for _ in range(100):
            result = plugin.adapter.job_state(data['job_id'])
            if result['status'] == 'completed':
                break
            await asyncio.sleep(.01)
        assert result['status'] == 'completed', result
        assert result['generated_files'] == ['fake-output.mp4']
        checks += 1
        output = await call(timer['id'])
        assert output['data'][0] == {'__type__': 'update'}, output
        checks += 1
        print(f'PASS {checks} real-Gradio contract checks (Gradio {gr.__version__}).')
        print('WanGP backend and browser scheduling modeled; no GPU render or browser interaction tested.')
    finally:
        if holder.get('session') and holder['session'].job:
            holder['session'].job.cancel()
        plugin._shutdown()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    finally:
        faulthandler.cancel_dump_traceback_later()
