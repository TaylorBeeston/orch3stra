"""Late-upscale contract tests; public WanGP session double, no actual model."""
import tempfile, unittest, copy, time
from pathlib import Path
from headless.engine import HeadlessEngine
from test_headless import Session, wait, TERMINAL
class PostprocessTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.session=Session();self.session.submit_media_postprocessing=lambda *a,**k:None
  self.e=HeadlessEngine(self.root/'e',session=self.session,probe=lambda p:dict(fps=24,frames=500,width=160,height=96))
  self.path=self.e.root/'uploads'/'film.mp4';self.path.write_bytes(b'fixture not real media');self.mid=self.e.register_upload(self.path,'film.mp4','video/mp4')['media_id']
 def tearDown(self):self.e.close();self.tmp.cleanup()
 def task(self):return dict(mode='edit_postprocessing',video_source=self.mid,start_frame=24,end_frame=264,spatial_upsampling='flashvsr*2')
 def test_resolves_owned_virtual_frame_range_only(self):
  r=self.e.resolve_task(self.task());self.assertEqual(r['mode'],'edit_postprocessing');self.assertTrue(r['video_source'].endswith('|start_frame=24,end_frame=263'));self.assertNotIn('model_type',r);self.assertNotIn('prompt',r)
 def test_upscale_method_allowlist(self):
  t=self.task();t['spatial_upsampling']='arbitrary';self.assertRaisesRegex(ValueError,'Unsupported',self.e.resolve_task,t)
 def test_unknown_non_generation_mode_rejected(self):
  self.assertRaises(ValueError,self.e.resolve_task,dict(mode='audio_remux',video_source='/tmp/other'))
 def test_upload_identity_not_arbitrary_filesystem_path(self):
  t=self.task();t['video_source']=str(self.path);self.assertRaises(ValueError,self.e.resolve_task,t)
 def test_bounds_are_integer_exclusive_and_fps_verified(self):
  for a,b in [(-1,12),(12,12),(0,501),(0,1.5),(True,30)]:
   t=self.task();t.update(start_frame=a,end_frame=b);self.assertRaises(ValueError,self.e.resolve_task,t)
  self.e.probe=lambda p:dict(fps=30,frames=500);self.assertRaises(ValueError,self.e.resolve_task,self.task())
 def test_whole_clip_and_three_thousand_frame_guard(self):
  t=self.task();t.pop('start_frame');t.pop('end_frame');self.assertEqual(self.e.resolve_task(t)['video_source'],str(self.path));self.e.probe=lambda p:dict(fps=24,frames=4000);self.assertRaises(ValueError,self.e.resolve_task,t)
 def test_capability_detection_not_assumed_from_version(self):
  self.assertTrue(self.e.health()['capabilities']['late_postprocess']);del self.session.submit_media_postprocessing;self.assertFalse(self.e.health()['capabilities']['late_postprocess']);self.assertRaises(ValueError,self.e.resolve_task,self.task())
 def test_unrelated_audio_or_model_fields_stripped(self):
  t=self.task();t.update(prompt='do not rerender',model_type='fake',audio_source='/tmp/no',postprocess_audio='seedvc',_api={'return_video':True});r=self.e.resolve_task(t);self.assertNotIn('postprocess_audio',r);self.assertNotIn('_api',r);self.assertEqual(r['temporal_upsampling'],'')
 def test_fifo_acceptance_no_h3_steps_in_public_telemetry(self):
  self.e.set_paused(True);p=dict(tasks=[self.task()],request_id='late-one',plan=[dict(id='late',task_index=1,window_index=1,start_frame=0,end_frame=240,frames=240)])
  j=self.e.submit(p);self.assertEqual(j['operation'],'postprocess');self.assertNotIn('telemetry',j);self.e.set_paused(False);wait(lambda:len(self.session.calls)==1);self.assertEqual(self.session.calls[0]['mode'],'edit_postprocessing');self.assertNotIn('model_type',self.session.calls[0]);self.session.jobs[0].gate.set();wait(lambda:self.e.job_state(j['job_id'])['status'] in TERMINAL);self.assertEqual(self.e.submit(p)['job_id'],j['job_id']);self.assertEqual(len(self.session.calls),1)
