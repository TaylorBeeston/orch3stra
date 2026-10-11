"""CPU-only helpers + modeled WanGP tests. No yt-dlp network or ML inference."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import test_plugin as f
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('voice_worker_test',ROOT/'scripts/voice_worker.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class VoiceTests(unittest.TestCase):
 def test_single_youtube_url(self):
  self.assertEqual(v.youtube_url('https://youtu.be/abcdefghijk?t=20'),'https://www.youtube.com/watch?v=abcdefghijk')
 def test_bad_urls(self):
  for x in ['file:///etc/passwd','https://youtube.com.evil/watch?v=abcdefghijk','https://localhost/watch?v=abcdefghijk','https://youtube.com/playlist?list=123','https://a:b@youtube.com/watch?v=abcdefghijk']:
   with self.assertRaises(ValueError):v.youtube_url(x)
 def test_range_limits(self):
  self.assertEqual(v.clip_range({'start':20,'end':40}),(20,40))
  for req in [{'start':-1},{'end':float('nan')},{'end':601},{'start':5,'end':4}]:
   with self.assertRaises(ValueError):v.clip_range(req)
 def test_consent_before_download_import(self):
  with self.assertRaisesRegex(ValueError,'permission'):v.import_audio({'url':'https://youtu.be/abcdefghijk','output':'unused','rightsConfirmed':False})
 def test_consent_before_model_import(self):
  with self.assertRaisesRegex(ValueError,'Consent'):v.transcribe({'allowModels':False})
 def test_speakers_follow_overlap_duration(self):
  result=v.label_words([{'start':0,'end':1,'word':'hey'},{'start':2,'end':3,'word':'you'}],[{'start':0,'end':1.5,'speaker':'A'},{'start':1.5,'end':3,'speaker':'B'}])
  self.assertEqual([x['speaker'] for x in result],['A','B']);self.assertFalse(result[0]['overlapping'])
 def test_overlap_voice_is_flagged_not_isolated(self):
  result=v.label_words([{'start':0,'end':1,'word':'hey'}],[{'start':0,'end':1,'speaker':'A'},{'start':.5,'end':1,'speaker':'B'}])
  self.assertTrue(result[0]['overlapping'])
 def test_group_by_speaker_and_pause(self):
  words=[{'start':0,'end':1,'word':'Hello','speaker':'A'},{'start':1.1,'end':2,'word':' there','speaker':'A'},{'start':2,'end':3,'word':' Hey','speaker':'B'}]
  rows=v.group_words(words);self.assertEqual(len(rows),2);self.assertEqual(rows[0]['text'],'Hello there')
 def test_unknown_speaker_is_not_a_character_identity(self):
  self.assertEqual(v.label_words([{'start':0,'end':1}],[])[0]['speaker'],'UNASSIGNED')

class WorkflowAdapterTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.session=types.SimpleNamespace(_state={'gen':{'queue':[]}})
  self.session.get_model_metadata=lambda model:{'model_type':model,'name':model}
  self.session.list_model_defs=lambda **kw:[{'model_type':kw['model_type'],'model':{'architecture':'minimax_h3','mode':'ref2va','pdd':'pdd' in kw['model_type']}}]
  self.adapter=f.PLUGIN.DirectorAdapter(self.session,port=0,token='test')
  self.addCleanup(self.adapter.stop,True)
 def task(self,**k):return {'model_type':'h3_ref2va_pruned_pdd8','num_inference_steps':8,'sample_solver':'euler','guidance_phases':1,'prompt':'[/duration=209]\nReference test',**k}
 def info(self,fps=24,count=418):return patch.dict(sys.modules,{'shared.utils.utils':types.SimpleNamespace(get_video_info=lambda p:(fps,832,480,count))})
 def make_import(self):
  path=Path(self.adapter.temp.name)/'finished.mp4';path.write_bytes(b'FAKE VIDEO BYTES FOR OWNERSHIP TEST')
  self.adapter.media['uploaded']={'path':str(path),'name':'finished.mp4'}
  plan=[{'id':'w1','title':'First','start_frame':0,'end_frame':209,'frames':209,'task_index':1,'window_index':1},{'id':'w2','title':'Second','start_frame':209,'end_frame':418,'frames':209,'task_index':1,'window_index':2}]
  with self.info():data=self.adapter.import_render({'media_id':'uploaded','plan':plan})
  return data,path,plan
 def test_standard_profile_sampler_and_phases(self):
  t=self.adapter.resolve_task(self.task(model_type='h3_ref2va_pruned',num_inference_steps=32,sample_solver='ralston_2s',guidance_phases=2))
  self.assertEqual(t['num_inference_steps'],32);self.assertEqual(t['guidance_phases'],2)
 def test_full_standard_allowed(self):
  self.assertEqual(self.adapter.verify_preset('minimax_h3_ref2va')['inference_mode'],'standard')
 def test_pdd_sampler_step_phase_still_locked(self):
  for kw in [{'num_inference_steps':9},{'sample_solver':'res_multistep'},{'guidance_phases':2}]:
   with self.assertRaises(ValueError):self.adapter.resolve_task(self.task(**kw))
 def test_wrong_model_rejected(self):
  self.session.list_model_defs=lambda **kw:[{'model_type':kw['model_type']}]
  with self.assertRaises(ValueError):self.adapter.verify_preset('other_model')
 def test_imported_render_has_available_output_without_telemetry(self):
  d,path,plan=self.make_import();self.assertEqual(d['status'],'completed');self.assertTrue(d['outputs'][0]['available']);self.assertIsNone(d['telemetry'])
 def test_import_bad_fps_rejected(self):
  d,path,plan=self.make_import()
  with self.info(fps=30),self.assertRaisesRegex(ValueError,'24-fps'):self.adapter.import_render({'media_id':'uploaded','plan':plan})
 def test_import_nonconsecutive_timeline_rejected(self):
  d,path,plan=self.make_import();plan[1]['start_frame']=240
  with self.info(),self.assertRaises(ValueError):self.adapter.import_render({'media_id':'uploaded','plan':plan})
 def test_continuation_is_owned_prefix_and_freezes_copy(self):
  d,path,plan=self.make_import();source={'jobId':d['job_id'],'outputId':d['outputs'][0]['id'],'keepFrames':209}
  with self.info():t=self.adapter.resolve_task(self.task(_director_continuation=source))
  frozen=Path(t['video_source']);self.assertNotEqual(frozen,path);self.assertEqual(frozen.read_bytes(),path.read_bytes());self.assertEqual(t['keep_frames_video_source'],'209');self.assertEqual(t['image_prompt_type'],'V');self.assertNotIn('_director_continuation',t)
  path.unlink();self.assertTrue(frozen.exists())
 def test_continuation_rejects_unowned_id_and_bounds(self):
  d,path,plan=self.make_import()
  for src in [{'jobId':'no','outputId':'no','keepFrames':10},{'jobId':d['job_id'],'outputId':d['outputs'][0]['id'],'keepFrames':800}]:
   with self.info(),self.assertRaises(ValueError):self.adapter.resolve_task(self.task(_director_continuation=src))
 def test_plain_task_does_not_accept_arbitrary_source_path(self):
  t=self.adapter.resolve_task(self.task(video_source='/etc/passwd'))
  self.assertIsNone(t['video_source'])
 def test_telemetry_prefix_coordinates_and_standard_steps(self):
  t=self.task(model_type='h3_ref2va_pruned',num_inference_steps=24,video_source='owned',keep_frames_video_source='209',multi_prompts_gen_type='PW',prompt='[/duration=208,/overlap=18]\nNext')
  obj=f.PLUGIN.JobTelemetry([t]);self.assertEqual(obj.windows[0]['start_frame'],209);self.assertEqual(obj.windows[0]['total_steps'],24)

if __name__=='__main__':unittest.main()
