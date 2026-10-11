"""Real queue/SQLite/HTTP tests, using a strict no-GPU public-API double.
The fake renderer does NOT complete synchronously on submit; it requires a gate.
No browser, Gradio, callback proxy or plugin import participates in dispatch.
"""
from __future__ import annotations
import copy, json, os, queue, subprocess, sys, tempfile, threading, time, unittest
from pathlib import Path
from types import SimpleNamespace as NS
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from headless.engine import HeadlessEngine, probe_video, TERMINAL
from headless.server import build_http, persistent_token, acquire_lock
MODEL='test_h3_ref2va_pruned_pdd8'
def task(): return dict(model_type=MODEL,prompt='[/duration=107]\nsummary: test',video_length=107,num_inference_steps=8,sample_solver='euler',guidance_phases=1,multi_prompts_gen_type='PW',image_refs=[])
def plan():return [dict(id='w1',title='A',task_index=1,window_index=1,start_frame=0,end_frame=107,frames=107,overlap=0)]
def payload(request='request-1'): return dict(request_id=request,project='Fixture',project_id='p1',tasks=[task()],plan=plan(),snapshot={'id':'p1','windows':[]})
def wait(fn,timeout=5):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  if fn():return
  time.sleep(.01)
 raise AssertionError('Condition did not become true')
class Stream:
 def __init__(self):self.q=queue.Queue()
 def put(self,kind,data=None):self.q.put(NS(kind=kind,data=data,timestamp=time.time()))
 def get(self,timeout=None):
  try:return self.q.get(timeout=timeout)
  except queue.Empty:return None
class Job:
 def __init__(self,session,settings):
  self.session,self.settings=session,settings;self.events=Stream();self.gate=threading.Event();self.done=False;self.cancel_requested=False;self.generated=[]
  self._thread=threading.Thread(target=self.run,daemon=True);self._thread.start()
 def run(self):
  self.events.put('started',{'tasks':1});self.events.put('progress',NS(phase='inference',status='Window 1/1',progress=12,current_step=1,total_steps=8));self.gate.wait(5)
  self._result=NS(success=not self.cancel_requested,generated_files=self.generated,errors=[NS(message='Generation was cancelled')]if self.cancel_requested else [],cancelled=self.cancel_requested)
  self.events.put('completed',self._result);self.done=True;self.session.active=False
 def cancel(self):self.cancel_requested=True;self.gate.set()
 def result(self):self._thread.join(5);return self._result
class Session:
 def __init__(self):self.calls=[];self.jobs=[];self.active=False;self._state={'gen':{'window_no':1,'total_windows':1,'file_list':[],'file_settings_list':[]}}
 def list_model_metadata(self,**kwargs):return [self.get_model_metadata(MODEL)]
 def get_model_metadata(self,m):return {'model_type':m,'name':'H3 Ref2VA pruned PDD8' if 'pdd' in m else 'H3 Ref2VA standard'} if 'ref2va' in m else None
 def list_model_defs(self,**kwargs):return [{'model_type':kwargs['model_type'],'model':{'pdd':'pdd' in kwargs['model_type']}}]
 def get_default_settings(self,m):return task()
 def get_model_schema(self,m):return {'fields':[]}
 def submit_task(self,t):
  assert not {'mask','audio_file'}.intersection(t), "Unknown settings: mask, audio_file (use audio_scale). Model-specific options belong in custom_settings."
  assert not self.active,'Only one public SessionJob may be active'
  self.active=True;self.calls.append(copy.deepcopy(t));j=Job(self,t);self.jobs.append(j);return j
class HeadlessTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.session=Session();self.e=HeadlessEngine(self.root/'engine',session=self.session,probe=lambda p:{'fps':24,'frames':107},start_dispatcher=True);self.http=None
 def tearDown(self):
  if self.http:self.http.shutdown();self.http.server_close()
  self.e.close();self.tmp.cleanup()
 def submit(self,r='request-1'):return self.e.submit(payload(r))['job_id']
 def upload(self,name='clip.mp4',data=b'0123456789'):
  path=self.e.root/'uploads'/name;path.write_bytes(data);return self.e.register_upload(path,name,'video/mp4')['media_id']
 def finish(self,jid):wait(lambda:len(self.session.jobs)>0);self.session.jobs[-1].gate.set();wait(lambda:self.e.job_state(jid)['status'] in TERMINAL)
 def http_setup(self):
  token=persistent_token(self.e.root);self.http=build_http(self.e,token,0);threading.Thread(target=self.http.serve_forever,daemon=True).start();return 'http://127.0.0.1:'+str(self.http.server_address[1]),token
 def test_runs_without_browser_or_http_polling(self):
  jid=self.submit();wait(lambda:len(self.session.jobs)==1);self.assertTrue(self.session.active);self.finish(jid);self.assertEqual(self.e.job_state(jid)['status'],'completed')
 def test_fifo_one_active_task(self):
  a=self.submit('a');b=self.submit('b');wait(lambda:len(self.session.jobs)==1);self.assertEqual(self.e.job_state(b)['queue_position'],1);self.session.jobs[0].gate.set();wait(lambda:len(self.session.jobs)==2);self.session.jobs[1].gate.set();wait(lambda:self.e.job_state(b)['status']=='completed');self.assertEqual(self.e.job_state(a)['status'],'completed')
 def test_two_tasks_run_serially_with_distinct_client_ids(self):
  p=payload();p['tasks']*=2;j=self.e.submit(p)['job_id'];wait(lambda:len(self.session.jobs)==1);self.session.jobs[0].gate.set();wait(lambda:len(self.session.jobs)==2);self.session.jobs[1].gate.set();wait(lambda:self.e.job_state(j)['status']=='completed');self.assertNotEqual(self.session.calls[0]['client_id'],self.session.calls[1]['client_id'])
 def test_idempotency_same_body_no_second_submit(self):
  a=self.submit();self.assertEqual(self.submit(),a);wait(lambda:len(self.session.calls)==1);p=payload();p['tasks'][0]['prompt']='different';self.assertRaisesRegex(ValueError,'different payload',self.e.submit,p);self.assertEqual(len(self.session.calls),1)
 def test_cancel_queued_never_dispatches(self):
  self.e.set_paused(True);a=self.submit();self.e.cancel(a);self.e.set_paused(False);time.sleep(.05);self.assertEqual(len(self.session.calls),0);self.assertEqual(self.e.job_state(a)['status'],'cancelled')
 def test_cancel_active_cooperative(self):
  a=self.submit();wait(lambda:len(self.session.jobs)==1);self.e.cancel(a);wait(lambda:self.e.job_state(a)['status']=='cancelled')
 def test_pause_does_not_cancel_current(self):
  a=self.submit();wait(lambda:len(self.session.jobs)==1);self.e.set_paused(True);b=self.submit('b');self.finish(a);time.sleep(.04);self.assertEqual(len(self.session.jobs),1);self.assertEqual(self.e.job_state(b)['status'],'queued')
 def test_queued_restart_requires_resume(self):
  self.e.set_paused(True);a=self.submit();self.e.close();self.e=HeadlessEngine(self.root/'engine',session=self.session);time.sleep(.03);self.assertEqual(len(self.session.jobs),0);self.assertTrue(self.e.paused);self.e.set_paused(False);self.finish(a)
 def test_crash_record_not_replayed(self):
  self.e.set_paused(True);a=self.submit();self.e.jobs[a]['state']['status']='running';self.e._save_job(a);self.e.close();self.e=HeadlessEngine(self.root/'engine',session=self.session);self.assertTrue(self.e.job_state(a)['interrupted']);self.assertEqual(self.e.job_state(a)['status'],'failed');self.e.set_paused(False);time.sleep(.03);self.assertEqual(len(self.session.jobs),0)
 def test_credential_is_static_private_and_not_health(self):
  t=persistent_token(self.e.root);self.assertEqual(t,persistent_token(self.e.root));self.assertEqual((self.e.root/'token').stat().st_mode&0o777,0o600);self.assertNotIn(t,json.dumps(self.e.health()))
 def test_bad_credential_does_not_silently_rotate(self):
  (self.e.root/'token').write_text('broken');self.assertRaises(ValueError,persistent_token,self.e.root);self.assertEqual((self.e.root/'token').read_text(),'broken')
 def test_symlink_credential_rejected(self):
  p=self.root/'other';p.write_text('a'*64);(self.e.root/'token').symlink_to(p);self.assertRaises(ValueError,persistent_token,self.e.root)
 def test_same_install_lock_excludes_second_worker(self):
  fd=acquire_lock(self.root/'lock');
  try:self.assertRaises(RuntimeError,acquire_lock,self.root/'lock')
  finally:os.close(fd)
 def test_uploads_survive_restart(self):
  mid=self.upload();self.e.close();self.e=HeadlessEngine(self.root/'engine',session=self.session);t=task();t['audio_guide']=mid;r=self.e.resolve_task(t);self.assertTrue(Path(r['audio_guide']).exists())
 def test_arbitrary_input_paths_rejected(self):
  t=task();t['image_refs']=['/etc/passwd'];self.assertRaises(ValueError,self.e.resolve_task,t)
 def test_changed_upload_rejected(self):
  mid=self.upload();Path(self.e.media[mid]['path']).write_bytes(b'changed');t=task();t['audio_guide']=mid;self.assertRaises(ValueError,self.e.resolve_task,t)
 def test_pdd_fixed_and_standard_editable(self):
  t=task();t['num_inference_steps']=20;self.assertRaises(ValueError,self.e.resolve_task,t);t.update(model_type='test_h3_ref2va_standard',sample_solver='ralston_2s',guidance_phases=2);r=self.e.resolve_task(t);self.assertEqual(r['num_inference_steps'],20);self.assertEqual(r['guidance_phases'],2);self.assertEqual(self.e.model_info(t['model_type'])['director_profile']['inference_mode'],'standard')
 def test_rejects_browser_bound_session(self):
  self.session._use_webui_queue=True;self.assertRaises(ValueError,self.e.set_session,self.session)
 def test_result_archived_and_persistent(self):
  a=self.submit();wait(lambda:len(self.session.jobs)==1);path=self.root/'native.mp4';path.write_bytes(b'video');self.session.jobs[0].generated=[str(path)];self.finish(a);o=self.e.job_state(a)['outputs'][0];self.assertEqual(o['window_index'],1);path.unlink();self.e.close();self.e=HeadlessEngine(self.root/'engine',session=self.session);self.assertTrue(self.e.job_state(a)['outputs'][0]['available'])
 def test_wrong_frame_count_never_maps_as_completed_window(self):
  self.e.probe=lambda p:{'fps':24,'frames':30};a=self.submit();wait(lambda:len(self.session.jobs)==1);p=self.root/'short.mp4';p.write_bytes(b'short');self.session.jobs[0].generated=[str(p)];self.finish(a);o=self.e.job_state(a)['outputs'][0];self.assertIsNone(o['window_index']);self.assertEqual(o['timeline_mapping'],'unmapped')
 def test_import_and_continue_uses_owned_immutable_archive(self):
  mid=self.upload();j=self.e.import_render({'media_id':mid,'plan':plan()});o=j['outputs'][0];t=task();t['_director_continuation']={'jobId':j['job_id'],'outputId':o['id'],'keepFrames':107};r=self.e.resolve_task(t);self.assertIn('/outputs/',r['video_source']);self.assertEqual(r['keep_frames_video_source'],'107');t['_director_continuation']['keepFrames']=108;self.assertRaises(ValueError,self.e.resolve_task,t)
 def test_foreign_output_id_rejected(self):
  mid=self.upload();j=self.e.import_render({'media_id':mid,'plan':plan()});self.assertRaises(ValueError,self.e.output_record,'wrong',j['outputs'][0]['id'])
 def test_http_auth_origin_and_range(self):
  base,token=self.http_setup();self.assertRaises(HTTPError,urlopen,base+'/health');headers={'Authorization':'Bearer '+token};self.assertEqual(json.load(urlopen(Request(base+'/health',headers=headers)))['backend'],'headless');self.assertRaises(HTTPError,urlopen,Request(base+'/health',headers={**headers,'Origin':'http://evil.invalid'}));mid=self.upload();j=self.e.import_render({'media_id':mid,'plan':plan()});url=base+'/jobs/'+j['job_id']+'/outputs/'+j['outputs'][0]['id'];r=urlopen(Request(url,headers={**headers,'Range':'bytes=2-4'}));self.assertEqual(r.status,206);self.assertEqual(r.read(),b'234')
 def test_http_metadata_and_request_recovery_no_submission(self):
  self.e.set_paused(True);a=self.submit();base,token=self.http_setup();get=lambda p:json.load(urlopen(Request(base+p,headers={'Authorization':'Bearer '+token})));self.assertEqual(get('/requests/request-1')['job_id'],a);self.assertEqual(get('/jobs/'+a+'/metadata')['snapshot']['id'],'p1');self.assertEqual(get('/queue')['jobs'][0]['status'],'queued');self.assertEqual(len(self.session.calls),0)
 def test_shutdown_rejects_active_render(self):
  a=self.submit();wait(lambda:len(self.session.jobs)==1);base,token=self.http_setup();self.assertRaises(HTTPError,urlopen,Request(base+'/shutdown',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=b'{}'))
 def test_progress_steps_recorded_without_browser(self):
  a=self.submit();wait(lambda:self.e.job_state(a)['status']=='running');t=self.e.job_state(a)['telemetry'];self.assertIsNotNone(t['current']);self.assertEqual(t['current']['total_steps'],8)
 def test_real_ffprobe_video_metadata(self):
  p=self.root/'actual.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=size=32x32:rate=24','-frames:v','107','-c:v','libx264',str(p)],check=True);v=probe_video(p);self.assertEqual(v['frames'],107);self.assertEqual(v['fps'],24)
if __name__=='__main__':unittest.main()
