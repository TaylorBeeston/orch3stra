"""Offline ASR contract fixtures; no weights, downloads, GPU or recognizer quality claim."""
import importlib.util
from pathlib import Path
import sys,types,unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('speech_quality_worker',Path(__file__).parents[1]/'scripts/speech_quality_worker.py');worker=importlib.util.module_from_spec(spec);spec.loader.exec_module(worker)
class SpeechQualityWorkerTests(unittest.TestCase):
 def test_only_cached_models_no_script_or_previous_text(self):
  calls=[]
  class Model:
   def __init__(self,path,**kwargs):calls.append(('load',path,kwargs))
   def transcribe(self,path,**kwargs):
    calls.append(('asr',path,kwargs));w=types.SimpleNamespace(start=.2,end=.8,word=' Actual',probability=.8);s=types.SimpleNamespace(start=.2,end=.8,avg_logprob=-.1,no_speech_prob=.1,compression_ratio=1,words=[w]);return iter([s]),types.SimpleNamespace(language='en')
  with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=Model)}),patch.object(worker,'cached',return_value='/cached/model'):
   result=worker.analyze({'inputs':[{'label':'retained-film','path':'owned.wav','duration':1}],'models':['small.en'],'language':'en','intended':'Never inject me'})
  self.assertEqual(result['analyses'][0]['words'][0]['word'],' Actual');self.assertTrue(calls[0][2]['local_files_only']);self.assertEqual(calls[0][2]['device'],'cpu');self.assertFalse(calls[1][2]['condition_on_previous_text']);self.assertIsNone(calls[1][2]['initial_prompt']);self.assertNotIn('intended',calls[1][2]);self.assertTrue(calls[1][2]['word_timestamps'])
 def test_missing_model_is_unavailable_before_constructor(self):
  with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=lambda *a,**k:self.fail('Must not load missing model'))}),patch.object(worker,'cached',return_value=None):
   with self.assertRaisesRegex(ValueError,'UNAVAILABLE'):worker.analyze({'inputs':[{'label':'retained-film','path':'owned.wav','duration':1}]})
 def test_cached_capabilities_are_not_live_quality(self):
  with patch.object(worker,'cached',return_value=None):
   r=worker.capabilities();self.assertEqual(r['device'],'cpu');self.assertTrue(r['offlineOnly']);self.assertFalse(any(r['models'].values()))
 def test_input_duration_caps(self):
  with patch.dict(sys.modules,{'faster_whisper':types.SimpleNamespace(WhisperModel=None)}):
   with self.assertRaisesRegex(ValueError,'ten minutes'):worker.analyze({'inputs':[{'duration':601}]})
