"""The exact set-plate (reference_edit) worker request, built by the JS client, through the real worker validation.

Modeled WanGP registry; real PNG uploads, real HeadlessEngine.resolve_task/submit. No inference.
"""
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from PIL import Image
from headless.engine import HeadlessEngine
from headless.reference_images import ARCHITECTURE, CAMERA_LORAS, VIGGLE_PROFILES

PLUS2 = 'qwen_image_edit_plus2_20B'

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('NODE_BIN') or shutil.which('node')
BUILD = r"""
import {buildSetPlateRequest} from './reference-edit.mjs';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('./reference-core.js');
const input=JSON.parse(process.argv[1]);
const project={id:'film',name:'Marble Hall',windows:[],subjects:[],assets:input.assets};
const card={...R.parsePlan(JSON.stringify({images:[{title:'Set plate',prompt:R.setPlatePrompt(input.prompt,input.assets.length,{cameraView:input.cameraView,model:input.model}),referenceIds:input.assets.map(a=>a.id)}]}),project).images[0]};
const uploaded=Object.fromEntries(input.assets.map((a,i)=>[a.id,input.media[i]]));
const {request}=buildSetPlateRequest({project,card,info:input.info,model:input.model,requestId:'set_plate_py',resolution:R.setPlateResolution(input.assets[0],input.size||{}),seed:7,accelerationProfile:input.acceleration,cameraLora:input.cameraLora,cameraLoraStrength:input.cameraLoraStrength,uploaded});
process.stdout.write(JSON.stringify(request));
"""


class Session:
    """Registry rows shaped like the installed WanGP defaults/*.json."""
    defs = {ARCHITECTURE: ARCHITECTURE, PLUS2: PLUS2, 'qwen_image_edit_20B': 'qwen_image_edit_20B'}
    def list_model_metadata(self, **kwargs): return [self.get_model_metadata(ARCHITECTURE)] if kwargs.get('query') == 'Qwen' else []
    def get_model_metadata(self, name):
        return {'model_type': name, 'name': {ARCHITECTURE: 'Qwen Image 2.1 TextImage2Image 7B', PLUS2: 'Qwen Image Edit Plus (2511) 20B'}.get(name, 'Qwen Image Edit 20B'), 'architecture': self.defs.get(name, name)}
    def list_model_defs(self, **kwargs): return [{'model_type': kwargs['model_type'], 'model': {'architecture': self.defs.get(kwargs['model_type'], kwargs['model_type'])}}]
    def get_default_settings(self, model_type):
        return {'num_inference_steps': 30 if model_type == PLUS2 else 40, 'guidance_scale': 4, 'image_mode': 1}
    def get_model_schema(self, _): return {'fields': []}
    installed = True
    def list_loras(self, model_type, name=None):
        # WanGP's setup_loras lists absolute paths under loras/qwen21 (2.1) or loras/qwen (Qwen Image Edit).
        if model_type == PLUS2:
            files = [CAMERA_LORAS['multiple-angles-2511']['lora'].rsplit('/', 1)[-1]] if self.installed else []
            return {'model_type': model_type, 'supported': True, 'loras': ['/wangp/loras/qwen/' + f for f in files if name is None or f == name]}
        files = ['Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors'] + ([CAMERA_LORAS['multiple-angles-v2']['lora'].rsplit('/', 1)[-1]] if self.installed else [])
        return {'model_type': model_type, 'supported': True, 'loras': ['/wangp/loras/qwen21/' + f for f in files if name is None or f == name]}
    VIGGLE = 'accelerator_profile:qwen21/Viggle Turbo v0.2.1 6 Steps.json'
    def get_model_settings(self, model_type, setting_id=None, include_selection=False):
        assert model_type == ARCHITECTURE, 'Viggle profiles are queried for Qwen Image 2.1 only'
        if setting_id is None:
            return {'settings': [{'id': self.VIGGLE, 'type': 'accelerator profile'}]}
        return {'content': {'model_type': model_type, 'sample_solver': 'viggle_v02', 'num_inference_steps': 6, 'guidance_scale': 1,
                            'activated_loras': [VIGGLE_PROFILES[self.VIGGLE]['lora']], 'loras_multipliers': '1'}}


@unittest.skipUnless(NODE, 'Node is required to build the client request')
class SetPlateRequest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.e = HeadlessEngine(self.root, session=Session(), start_dispatcher=False)
    def tearDown(self): self.e.close(); self.tmp.cleanup()
    def upload(self, name, size):
        path = self.root/'uploads'/name; Image.new('RGB', size, (120, 110, 100)).save(path)
        return self.e.register_upload(path, name, 'image/png')['media_id']
    def build(self, count=1, model=ARCHITECTURE, **extra):
        media = [self.upload(f'hall{i}.png', (96, 54)) for i in range(count)]
        info = self.e.reference_model_info(model)
        assets = [{'id': f'asset-{i}', 'kind': 'image', 'name': f'Hall {i}', 'width': 1344, 'height': 768, 'missing': False} for i in range(count)]
        payload = {'assets': assets, 'media': media, 'info': {k: info[k] for k in ('metadata', 'profile', 'image_profiles')}, 'model': model,
                   'prompt': 'same marble hall, reverse angle, the entrance door now behind the camera', **extra}
        out = subprocess.run([NODE, '--input-type=module', '-e', BUILD, json.dumps(payload)], cwd=ROOT, capture_output=True, text=True, timeout=60)
        self.assertEqual(out.returncode, 0, out.stderr)
        return json.loads(out.stdout), media

    def test_single_source_resolves_as_qwen_reference_edit(self):
        request, media = self.build()
        self.assertEqual((request['path'], request['method']), ('/generate', 'POST'))
        task = request['body']['tasks'][0]
        resolved = self.e.resolve_task(task)
        self.assertEqual(resolved['model_type'], ARCHITECTURE)
        self.assertEqual(resolved['image_mode'], 1)
        self.assertEqual(resolved['video_prompt_type'], 'I', 'ordered reference images, not a control video')
        self.assertEqual(resolved['image_refs'], [self.e.media[media[0]]['path']])
        self.assertEqual(resolved['resolution'], '1024x576')
        self.assertEqual((resolved['num_inference_steps'], resolved['guidance_scale'], resolved['seed']), (40, 4.0, 7))
        self.assertIn('<image1>', resolved['prompt']); self.assertNotIn('<image2>', resolved['prompt'])
        self.assertEqual(resolved['multi_prompts_gen_type'], 'FG')
        state = self.e.submit(request['body'])
        self.assertEqual((state['operation'], state['status'], state['task_count']), ('reference_image', 'queued', 1))

    def test_multiple_sources_keep_order(self):
        request, media = self.build(count=3)
        resolved = self.e.resolve_task(request['body']['tasks'][0])
        self.assertEqual(resolved['image_refs'], [self.e.media[m]['path'] for m in media])
        self.assertIn('<image2> to <image3>', resolved['prompt'])

    def test_requested_small_size(self):
        request, _ = self.build(size={'width': 512, 'height': 288})
        self.assertEqual(self.e.resolve_task(request['body']['tasks'][0])['resolution'], '512x288')

    def test_multi_angle_lora_is_discovered_and_stacked_after_viggle(self):
        url = CAMERA_LORAS['multiple-angles-v2']['lora']
        request, _ = self.build(size={'width': 288, 'height': 512}, acceleration='viggle-turbo-v0.2.1-6step', cameraView='back view, eye-level shot', cameraLora='multiple-angles-v2', cameraLoraStrength=0.9)
        info = self.e.reference_model_info(ARCHITECTURE)
        self.assertEqual([(r['id'], r['installed'], r['trigger']) for r in info['profile']['camera_loras']], [('multiple-angles-v2', True, '<mva>')])
        task = request['body']['tasks'][0]
        self.assertNotIn('safetensors', json.dumps(task), 'client sends an allowlisted id only')
        resolved = self.e.resolve_task(task)
        self.assertTrue(resolved['prompt'].startswith('<mva> back view, eye-level shot\nSame location as <image1>.'))
        self.assertEqual(resolved['activated_loras'], [VIGGLE_PROFILES[Session.VIGGLE]['lora'], url])
        self.assertEqual(resolved['loras_multipliers'], '1 0.9')
        self.assertEqual((resolved['sample_solver'], resolved['num_inference_steps'], resolved['resolution']), ('viggle_v02', 6, '288x512'))
        self.assertEqual(self.e.submit(request['body'])['status'], 'queued')

    def test_multi_angle_lora_alone_and_refusals(self):
        url = CAMERA_LORAS['multiple-angles-v2']['lora']
        request, _ = self.build(cameraView='back view, eye-level shot', cameraLora='multiple-angles-v2', cameraLoraStrength=1)
        task = request['body']['tasks'][0]
        resolved = self.e.resolve_task(task)
        self.assertEqual((resolved['activated_loras'], resolved['loras_multipliers'], resolved['sample_solver']), ([url], '1', 'default'))
        for change, message in (({'camera_lora': 'made-up'}, 'Unknown camera LoRA'),
                                ({'camera_lora_strength': 0}, 'strength'),
                                ({'camera_lora_strength': 2.5}, 'strength'),
                                ({'prompt': task['prompt'].replace('<mva> ', '')}, 'trigger'),
                                ({'camera_lora': '', 'camera_lora_strength': 1}, 'needs camera_lora')):
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, message):
                self.e.resolve_task({**task, **change})
        plain, _ = self.build()
        self.assertNotIn('activated_loras', self.e.resolve_task(plain['body']['tasks'][0]), 'no LoRA unless requested')

    def test_multi_angle_lora_must_be_installed(self):
        Session.installed = False
        try:
            e = HeadlessEngine(self.root/'other', session=Session(), start_dispatcher=False)
            try:
                self.assertFalse(e.reference_model_info(ARCHITECTURE)['profile']['camera_loras'][0]['installed'])
                path = e.root/'uploads'/'hall.png'; Image.new('RGB', (96, 54)).save(path)
                media = e.register_upload(path, 'hall.png', 'image/png')['media_id']
                task = {'mode': 'reference_image', 'model_type': ARCHITECTURE, 'license_accepted': True, 'prompt': '<mva> back view, eye-level shot', 'image_refs': [media], 'camera_lora': 'multiple-angles-v2'}
                with self.assertRaisesRegex(ValueError, 'not installed'):
                    e.resolve_task(task)
            finally:
                e.close()
        finally:
            Session.installed = True

    def test_legacy_qwen_edit_20b_is_not_a_worker_preset(self):
        with self.assertRaisesRegex(ValueError, 'Qwen Image Edit 2511 and Krea 2 presets only'):
            self.e.reference_model_info('qwen_image_edit_20B')

    def test_qwen_edit_2511_profile(self):
        profile = self.e.reference_model_info(PLUS2)['profile']
        self.assertEqual((profile['architecture'], profile['max_references'], profile['default_steps'], profile['default_guidance']), (PLUS2, 3, 30, 4.0))
        self.assertIn('Apache-2.0', profile['license'])
        self.assertEqual([(r['id'], r['installed'], r['trigger']) for r in profile['camera_loras']], [('multiple-angles-2511', True, '<sks>')],
                         'only the LoRA trained for this base model is offered')
        self.assertNotIn('multiple-angles-2511', [r['id'] for r in self.e.reference_model_info(ARCHITECTURE)['profile']['camera_loras']])

    def test_qwen_edit_2511_plain_and_with_angle_lora(self):
        request, media = self.build(model=PLUS2, size={'width': 512, 'height': 896})
        resolved = self.e.resolve_task(request['body']['tasks'][0])
        self.assertEqual((resolved['model_type'], resolved['image_mode'], resolved['video_prompt_type']), (PLUS2, 1, 'I'))
        self.assertEqual(resolved['image_refs'], [self.e.media[media[0]]['path']])
        self.assertEqual((resolved['num_inference_steps'], resolved['guidance_scale'], resolved['resolution']), (30, 4.0, '512x896'))
        self.assertNotIn('<image', resolved['prompt'], 'Qwen Image Edit takes ordered images, not <imageN> tokens')
        self.assertNotIn('qwen21_kv_cache', json.dumps(resolved.get('custom_settings', {})))
        self.assertNotIn('activated_loras', resolved)
        url = CAMERA_LORAS['multiple-angles-2511']['lora']
        request, _ = self.build(model=PLUS2, cameraView='back view eye-level shot medium shot', cameraLora='multiple-angles-2511', cameraLoraStrength=0.9)
        task = request['body']['tasks'][0]
        resolved = self.e.resolve_task(task)
        self.assertTrue(resolved['prompt'].startswith('<sks> back view eye-level shot medium shot\nMove the camera'))
        self.assertEqual((resolved['activated_loras'], resolved['loras_multipliers'], resolved['sample_solver']), ([url], '0.9', 'default'))
        with self.assertRaisesRegex(ValueError, 'Unknown camera LoRA'):
            self.e.resolve_task({**task, 'camera_lora': 'multiple-angles-v2'})
        with self.assertRaisesRegex(ValueError, 'trigger'):
            self.e.resolve_task({**task, 'prompt': task['prompt'].replace('<sks> ', '')})
        self.assertEqual(self.e.submit(request['body'])['status'], 'queued')

    def test_qwen_edit_2511_refuses_four_sources(self):
        with self.assertRaises(AssertionError):
            self.build(count=4, model=PLUS2)


if __name__ == '__main__':
    unittest.main()
