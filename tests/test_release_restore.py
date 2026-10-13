"""Disposable full-file snapshot and safe restore/reimport. No model/ASR/provider calls."""
import hashlib,json,shutil,subprocess,tempfile,unittest
from pathlib import Path
from headless.engine import HeadlessEngine
from test_headless import Session,plan,payload

def hashes(root):return {p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in root.rglob('*') if p.is_file()}
@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'Installed CPU codecs required')
class FullRestoreTests(unittest.TestCase):
 def test_snapshot_restore_keeps_queue_paused_and_reimports_owned_bytes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);data=root/'private-data';data.mkdir();session=Session();engine=HeadlessEngine(data/'headless',session=session,start_dispatcher=False)
   try:
    source=engine.root/'uploads'/'synthetic.mp4'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=size=32x32:rate=24','-frames:v','107','-c:v','libx264','-pix_fmt','yuv420p',str(source)],check=True,capture_output=True)
    media=engine.register_upload(source,'synthetic.mp4','video/mp4')['media_id'];imported=engine.import_render({'media_id':media,'plan':plan()});output=engine.output_record(imported['job_id'],imported['outputs'][0]['id']);self.assertTrue(engine.output_available(output));engine.set_paused(True);queued=engine.submit(payload('restore-fixture'))['job_id']
    for directory in ['projects','checkpoints','service-settings']:(data/directory).mkdir()
    (data/'projects/legacy.json').write_text(json.dumps({'version':1,'id':'legacy','windows':[]}));(data/'projects/bounded.json').write_text(json.dumps({'version':1,'id':'bounded','windows':[],'jobs':[imported]}));(data/'checkpoints/synthetic.json').write_text(json.dumps({'state':'paused','jobId':queued,'note':'Byte-preservation fixture; not a claimed reusable model checkpoint'}));(data/'service-settings/source-path.txt').write_text('/old/source/path');(data/'token').write_text('synthetic-private-fixture')
   finally:engine.close()
   original=hashes(data);snapshot=root/'snapshot';shutil.copytree(data,snapshot,copy_function=shutil.copy2);self.assertEqual(hashes(snapshot),original)
   # Removing the original location must not permit stale absolute ownership paths.
   data.rename(root/'preserved-original');restored=HeadlessEngine(snapshot/'headless',session=session,start_dispatcher=False)
   try:
    self.assertTrue(restored.paused);self.assertEqual(restored.job_state(queued)['status'],'queued');self.assertEqual(session.calls,[]);self.assertFalse(restored.output_available(restored.output_record(imported['job_id'],output['id'])))
    copied=snapshot/'headless'/'outputs'/Path(output['path']).name
    self.assertTrue(copied.exists());new_source=restored.root/'uploads'/'reviewed-reimport.mp4';shutil.copy2(copied,new_source);new_media=restored.register_upload(new_source,'reviewed-reimport.mp4','video/mp4')['media_id'];new=restored.import_render({'media_id':new_media,'plan':plan()});fresh=restored.output_record(new['job_id'],new['outputs'][0]['id']);self.assertTrue(restored.output_available(fresh));self.assertNotEqual(new['job_id'],imported['job_id']);self.assertEqual(Path(fresh['path']).read_bytes(),copied.read_bytes());self.assertEqual(session.calls,[])
   finally:restored.close()
   # Rollback returns the preserved source data byte-for-byte; no stat-lock rewrite.
   self.assertEqual(hashes(root/'preserved-original'),original)
