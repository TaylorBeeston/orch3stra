import threading
import unittest
from headless.music import MusicSupport

class Session:
    def get_model_metadata(self, model_type):
        return {'model_type':model_type,'architecture':model_type}
    def list_model_defs(self, **kw):return []
    def get_default_settings(self, model_type):return {}
    def list_model_metadata(self, **kw):return [{'model_type':'yue2'},{'model_type':'yue2_hum'},{'model_type':'video'}]

class Worker(MusicSupport):
    def __init__(self):self.lock=threading.RLock();self.session=Session();self.runtime_state='ready';self.active_id=None

class MusicTests(unittest.TestCase):
    def setUp(self):self.worker=Worker();self.task={'mode':'music','model_type':'yue2','prompt':'[Verse]\nMend the moon','alt_prompt':'Clockwork celesta, 96 BPM','duration_seconds':50,'seed':42}
    def test_closed_native_song_settings(self):
        result=self.worker.resolve_music({**self.task,'audio_guide':'secret','image_refs':['unexpected'],'prompt_enhancer':'anything'})
        self.assertIsNone(result['audio_guide']);self.assertEqual(result['image_refs'],[]);self.assertEqual(result['prompt_enhancer'],'');self.assertEqual(result['model_mode'],0);self.assertEqual(result['audio_prompt_type'],'0');self.assertNotIn('mode',result)
    def test_discovery_excludes_hum_and_unrelated(self):
        self.assertEqual([r['model_type'] for r in self.worker.music_models()],['yue2'])
        self.worker.active_id='other';self.assertRaises(ValueError,self.worker.music_models)
    def test_invalid_does_not_submit(self):
        for key,value in [('duration_seconds',True),('duration_seconds',float('nan')),('duration_seconds',181),('seed',1.2),('prompt',''),('model_type','yue2_hum'),('num_inference_steps',0)]:
            with self.subTest(key=key,value=value):self.assertRaises(ValueError,self.worker.resolve_music,{**self.task,key:value})
