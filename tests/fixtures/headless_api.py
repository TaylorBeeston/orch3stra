"""TEST ONLY substitute for shared.api, copied to a temporary fake WanGP root.
Rendering is gated on a file; the fixture makes no network or GPU calls.
"""
import json, queue, threading, time
from pathlib import Path
from types import SimpleNamespace as NS
class Stream:
 def __init__(self):self.q=queue.Queue()
 def put(self,k,v=None):self.q.put(NS(kind=k,data=v,timestamp=time.time()))
 def get(self,timeout=None):
  try:return self.q.get(timeout=timeout)
  except queue.Empty:return None
class Job:
 def __init__(self,s,t):
  self.events=Stream();self.done=False;self.cancel_requested=False;self.s=s;self.t=t;self._thread=threading.Thread(target=self.run,daemon=True);self._thread.start()
 def cancel(self):self.cancel_requested=True
 def result(self):self._thread.join(15);return self._result
 def run(self):
  self.events.put('started',{'tasks':1});self.events.put('progress',NS(phase='inference',status='Window 1/1',progress=12,current_step=1,total_steps=8))
  while not (self.s.root/'release').exists() and not self.cancel_requested:time.sleep(.01)
  self._result=NS(success=not self.cancel_requested,generated_files=[] if self.cancel_requested else [str(self.s.root/'output.mp4')],errors=[NS(message='cancelled')]if self.cancel_requested else [],cancelled=self.cancel_requested)
  self.events.put('completed',self._result);self.done=True;self.s.active=False
class Session:
 def __init__(self,root):self.root=Path(root);self.active=False;self._state={'gen':{'window_no':1,'total_windows':1,'file_list':[],'file_settings_list':[]}}
 def list_model_metadata(self,**kwargs):return [self.get_model_metadata('h3_ref2va_pdd')]
 def get_model_metadata(self,id):return {'model_type':id,'name':'H3 Ref2VA pruned PDD 8'}
 def list_model_defs(self,**kwargs):return [{'model_type':kwargs['model_type'],'model':{'pdd':True}}]
 def get_exported_default_settings(self,id):return {'num_inference_steps':8,'sample_solver':'euler','guidance_phases':1}
 def get_model_schema(self,id):return {}
 def submit_task(self,t):
  assert not {'mask','audio_file'}.intersection(t), "Unknown settings: mask, audio_file (use audio_scale). Model-specific options belong in custom_settings."
  assert not self.active,'Single runtime violated';self.active=True
  with (self.root/'calls.jsonl').open('a')as f:f.write(json.dumps(t)+'\n')
  return Job(self,t)
def init(*,root,cli_args,console_output,console_isatty):
 assert cli_args==[] and console_output and not console_isatty
 (Path(root)/'init.json').write_text(json.dumps({'root':str(root),'cli_args':cli_args,'browser_state_passed':False}))
 return Session(root)
