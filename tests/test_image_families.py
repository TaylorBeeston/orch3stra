"""Native registry contracts only; no model inference or downloads."""
import tempfile
import unittest
import copy
from pathlib import Path
from PIL import Image
from headless.engine import HeadlessEngine
from headless.reference_images import ARCHITECTURE, KREA_PROFILES
from test_reference_images import Session as QwenSession

class Registry(QwenSession):
    def list_model_metadata(self, **kwargs):
        return ([self.get_model_metadata(k) for k in KREA_PROFILES] if kwargs.get('query')=='Krea'
                else super().list_model_metadata(**kwargs))
    def get_model_metadata(self, k):
        if k in KREA_PROFILES:return {'model_type': k, 'name': 'Krea 2 '+k, 'base_model_type': k}
        return super().get_model_metadata(k)

class ImageFamilies(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.engine=HeadlessEngine(self.root, session=Registry(), start_dispatcher=False)
    def tearDown(self):self.engine.close();self.tmp.cleanup()
    def task(self,k,**kw):return {'mode':'reference_image','model_type':k,'license_accepted':True,'prompt':'A room.\n\nWarm light.',**kw}
    def image(self,name):
        p=self.root/'uploads'/name;Image.new('RGB',(64,64)).save(p)
        return self.engine.register_upload(p,name,'image/png')['media_id']
    def test_registry_caps_and_defaults(self):
        rows=self.engine.reference_models();self.assertEqual(len(rows),5)
        for arch,(refs,steps,guidance) in KREA_PROFILES.items():
            info=self.engine.reference_model_info(arch);self.assertEqual(info['profile']['max_references'],refs)
            resolved=self.engine.resolve_reference_image(self.task(arch))
            self.assertEqual(resolved['num_inference_steps'],steps);self.assertEqual(resolved['guidance_scale'],guidance)
            self.assertEqual(resolved['multi_prompts_gen_type'],'FG');self.assertEqual(resolved['custom_settings'],{})
    def test_edit_order_and_scene_mode(self):
        refs=[self.image('scene.png'),self.image('identity.png')]
        task=self.task('krea2_turbo_edit',image_refs=refs,prompt='Use <image1> scene and <image2> subject.',preserve_first_scene=True)
        original=copy.deepcopy(task);resolved=self.engine.resolve_reference_image(task)
        self.assertEqual(resolved['image_refs'],[self.engine.media[k]['path'] for k in refs]);self.assertEqual(resolved['video_prompt_type'],'KI')
        self.assertEqual(resolved['image_mode'],0);self.assertEqual(task,original)
        task['preserve_first_scene']=False;self.assertEqual(self.engine.resolve_reference_image(task)['video_prompt_type'],'I')
    def test_no_dropped_refs_or_cross_family_profiles(self):
        ref=self.image('face.png')
        for arch in ('krea2_raw','krea2_turbo'):
            with self.assertRaisesRegex(ValueError,'at most 0'):self.engine.resolve_reference_image(self.task(arch,image_refs=[ref]))
        with self.assertRaisesRegex(ValueError,'at most 2'):self.engine.resolve_reference_image(self.task('krea2_raw_edit',image_refs=['x','y','z']))
        with self.assertRaisesRegex(ValueError,'Unsupported'):self.engine.resolve_reference_image(self.task('krea2_turbo_edit',acceleration_profile='viggle-turbo-v0.2.1-6step'))
        with self.assertRaisesRegex(ValueError,'missing input'):self.engine.resolve_reference_image(self.task('krea2_raw_edit',prompt='Use <image3>.',image_refs=[ref]))
