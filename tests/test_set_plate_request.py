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
from headless.reference_images import ARCHITECTURE

ROOT = Path(__file__).resolve().parents[1]
NODE = os.environ.get('NODE_BIN') or shutil.which('node')
BUILD = r"""
import {buildSetPlateRequest} from './reference-edit.mjs';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('./reference-core.js');
const input=JSON.parse(process.argv[1]);
const project={id:'film',name:'Marble Hall',windows:[],subjects:[],assets:input.assets};
const card={...R.parsePlan(JSON.stringify({images:[{title:'Set plate',prompt:R.setPlatePrompt(input.prompt,input.assets.length),referenceIds:input.assets.map(a=>a.id)}]}),project).images[0]};
const uploaded=Object.fromEntries(input.assets.map((a,i)=>[a.id,input.media[i]]));
const {request}=buildSetPlateRequest({project,card,info:input.info,model:input.model,requestId:'set_plate_py',resolution:R.setPlateResolution(input.assets[0],input.size||{}),seed:7,accelerationProfile:input.acceleration,uploaded});
process.stdout.write(JSON.stringify(request));
"""


class Session:
    """Registry rows shaped like the installed WanGP defaults/*.json."""
    defs = {ARCHITECTURE: ARCHITECTURE, 'qwen_image_edit_plus2_20B': 'qwen_image_edit_plus2_20B'}
    def list_model_metadata(self, **kwargs): return [self.get_model_metadata(ARCHITECTURE)] if kwargs.get('query') == 'Qwen' else []
    def get_model_metadata(self, name):
        return {'model_type': name, 'name': 'Qwen Image 2.1 TextImage2Image 7B' if name == ARCHITECTURE else 'Qwen Image Edit Plus (2511) 20B', 'architecture': self.defs.get(name, name)}
    def list_model_defs(self, **kwargs): return [{'model_type': kwargs['model_type'], 'model': {'architecture': self.defs.get(kwargs['model_type'], kwargs['model_type'])}}]
    def get_default_settings(self, _): return {'num_inference_steps': 40, 'guidance_scale': 4, 'image_mode': 1}
    def get_model_schema(self, _): return {'fields': []}


@unittest.skipUnless(NODE, 'Node is required to build the client request')
class SetPlateRequest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.e = HeadlessEngine(self.root, session=Session(), start_dispatcher=False)
    def tearDown(self): self.e.close(); self.tmp.cleanup()
    def upload(self, name, size):
        path = self.root/'uploads'/name; Image.new('RGB', size, (120, 110, 100)).save(path)
        return self.e.register_upload(path, name, 'image/png')['media_id']
    def build(self, count=1, **extra):
        media = [self.upload(f'hall{i}.png', (96, 54)) for i in range(count)]
        info = self.e.reference_model_info(ARCHITECTURE)
        assets = [{'id': f'asset-{i}', 'kind': 'image', 'name': f'Hall {i}', 'width': 1344, 'height': 768, 'missing': False} for i in range(count)]
        payload = {'assets': assets, 'media': media, 'info': {k: info[k] for k in ('metadata', 'profile', 'image_profiles')}, 'model': ARCHITECTURE,
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

    def test_legacy_qwen_edit_20b_is_not_a_worker_preset(self):
        with self.assertRaisesRegex(ValueError, 'Qwen Image 2.1 and Krea 2 presets only'):
            self.e.reference_model_info('qwen_image_edit_plus2_20B')


if __name__ == '__main__':
    unittest.main()
