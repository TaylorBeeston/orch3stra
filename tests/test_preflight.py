import tempfile, unittest, subprocess
from pathlib import Path
from unittest.mock import patch
from headless.preflight import preflight
from headless.engine import HeadlessEngine

class PreflightTests(unittest.TestCase):
 def test_missing_tools_fail_without_writes_or_network(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'shared').mkdir();(root/'wgp.py').write_text('# fixture');(root/'shared/api.py').write_text('# fixture');data=root/'untouched data'
   with patch('socket.socket',side_effect=AssertionError('Network forbidden')):
    result=preflight(root,data,which=lambda _:None,env={})
   self.assertFalse(result['ok']);self.assertFalse(result['structural_ok']);self.assertEqual(result['exit_code'],1);self.assertFalse(data.exists());self.assertTrue(result['offline']);self.assertFalse(result['model_loaded']);self.assertEqual({c['name'] for c in result['checks'] if c['state']=='fail'},{'ffmpeg','ffprobe'})
 def test_selected_ffmpeg_overrides_win_over_path(self):
  with tempfile.TemporaryDirectory() as tmp:
   def state(env,available):
    r=preflight(tmp,Path(tmp)/'data',which=lambda n:available.get(n),env=env)
    return {c['name']:c['state'] for c in r['checks'] if c['name'] in ('ffmpeg','ffprobe')}
   self.assertEqual(state({'FFMPEG_BIN':'/missing','FFPROBE_BIN':'/missing-probe'},{'ffmpeg':'/good','ffprobe':'/good-probe'}),{'ffmpeg':'fail','ffprobe':'fail'})
   with patch('headless.preflight.subprocess.run', side_effect=lambda args,**kw: subprocess.CompletedProcess(args,0,(b'ffprobe version' if 'probe' in args[0] else b'ffmpeg version'),b'')):
    self.assertEqual(state({'FFMPEG_BIN':'/chosen','FFPROBE_BIN':'/chosen-probe'},{'/chosen':'/chosen','/chosen-probe':'/chosen-probe'}),{'ffmpeg':'pass','ffprobe':'pass'})
 def test_broken_executables_fail(self):
  with tempfile.TemporaryDirectory() as tmp, patch('headless.preflight.subprocess.run',return_value=subprocess.CompletedProcess([],1,b'',b'')):
   result=preflight(tmp,Path(tmp)/'data',which=lambda name:'/fake/'+name,env={})
   self.assertFalse(result['ok'])
   self.assertTrue(all(c['state']=='fail' for c in result['checks'] if c['name'] in ('ffmpeg','ffprobe')))
 def test_real_synthetic_codecs_without_data_writes(self):
  import shutil
  if not shutil.which('ffmpeg') or not shutil.which('ffprobe'): self.skipTest('Installed FFmpeg required')
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);(root/'shared').mkdir();(root/'wgp.py').write_text('# fixture');(root/'shared/api.py').write_text('# fixture')
   result=preflight(root,root/'not-created',env={})
   self.assertTrue(result['structural_ok'],result);self.assertFalse(result['ok']);self.assertFalse(result['ready']);self.assertEqual(result['exit_code'],2);self.assertEqual(result['status'],'readiness_unverified')
   self.assertFalse((root/'not-created').exists())
   self.assertEqual(next(c['state'] for c in result['checks'] if c['name']=='media_codecs'),'pass')
 def test_missing_installation_actionable(self):
  with tempfile.TemporaryDirectory() as tmp:
   result=preflight(tmp,Path(tmp)/'data',which=lambda _:None)
   self.assertTrue(any(c['name']=='shared/api.py' and c['state']=='fail' for c in result['checks']))
 def test_session_readiness_is_not_decoded_verification(self):
  with tempfile.TemporaryDirectory() as tmp:
   engine=HeadlessEngine(tmp,start_dispatcher=False)
   try:
    self.assertEqual(engine.health()['installed_api']['bounded_decoded_media'],'unknown')
    with self.assertRaisesRegex(ValueError,'lacks submit_task'):engine.set_session(object())
    class Session:
     def submit_task(self,t):raise AssertionError('No model calls')
     def list_model_metadata(self,**kwargs):return []
    engine.outputs['persisted']={'continuation_private':{'path':'old-runtime'}}
    engine.set_session(Session());self.assertEqual(engine.health()['installed_api']['bounded_decoded_media'],'unknown')
    engine.bounded_api_verified=True;self.assertEqual(engine.health()['installed_api']['bounded_decoded_media'],'verified')
    engine.set_session(Session());self.assertEqual(engine.health()['installed_api']['bounded_decoded_media'],'unknown')
   finally:engine.close()
