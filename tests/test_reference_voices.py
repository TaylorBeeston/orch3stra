"""Native VoiceDesign task construction plus real local WAV archival; no TTS inference."""
import json
import math
import tempfile
import threading
import unittest
import urllib.request as u
import wave
from pathlib import Path
from headless.engine import HeadlessEngine
from headless.reference_voices import ARCHITECTURE, audio_probe
from headless.server import build_http, persistent_token

class Session:
    def list_model_metadata(self, **kw):
        if kw.get('query') != 'Qwen':return []
        assert kw.get('main_output') == 'audio'
        return [self.get_model_metadata(ARCHITECTURE), self.get_model_metadata('qwen3_tts_base')]
    def get_model_metadata(self, m):
        return {'model_type': m, 'name': 'Qwen3 TTS VoiceDesign', 'base_model_type': m}
    def list_model_defs(self, **kw):
        return [{'model_type': kw['model_type'], 'model': {'architecture': kw['model_type']}}]
    def get_default_settings(self, _):
        return {'prompt': '', 'duration_seconds': 20}
    def get_model_schema(self, _):
        return {'fields': []}

def task(**kw):
    return {'mode':'reference_voice', 'model_type':ARCHITECTURE, 'prompt':'I will read these exact words.', 'alt_prompt':'Warm, low, measured fictional voice.', 'model_mode':'english', 'duration_seconds':15, **kw}

def wav(path, duration=3):
    with wave.open(str(path),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(16000)
        f.writeframes(b'\0\0'*int(16000*duration))

class ReferenceVoices(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
        self.e=HeadlessEngine(self.root/'worker',session=Session(),start_dispatcher=False)
    def tearDown(self):
        self.e.close();self.tmp.cleanup()
    def test_discovery_only_native_voicedesign(self):
        models=self.e.voice_models();self.assertEqual([x['model_type'] for x in models],[ARCHITECTURE]);self.assertFalse(self.e.health()['capabilities']['reference_voices']) # Discovery-only fixture has no task submission API.
    def test_wrong_architecture_rejected_not_guessed(self):
        with self.assertRaisesRegex(ValueError,'VoiceDesign'): self.e.resolve_task(task(model_type='qwen3_tts_base'))
    def test_literal_speech_and_voice_instruction_not_swapped(self):
        t=task();r=self.e.resolve_task(t)
        self.assertEqual(r['prompt'],t['prompt']);self.assertEqual(r['alt_prompt'],t['alt_prompt']);self.assertEqual(r['duration_seconds'],15)
        self.assertEqual(r['num_inference_steps'],0);self.assertEqual(r['multi_prompts_gen_type'],'FG')
    def test_unrelated_files_loras_paths_dropped(self):
        r=self.e.resolve_task(task(audio_guide='/etc/passwd',video_source='secret',image_refs=['private'],output_dir='/somewhere',loras=['lora']))
        self.assertIsNone(r['audio_guide']);self.assertIsNone(r['video_source']);self.assertEqual(r['image_refs'],[])
        for key in ['mode','output_dir','loras']:self.assertNotIn(key,r)
    def test_parameter_bounds(self):
        for k,v in [('duration_seconds',float('nan')),('duration_seconds',True),('duration_seconds',31),('model_mode','made-up'),('seed',True),('seed',2**50),('prompt','file:///etc/passwd'),('alt_prompt',''),('prompt','x'*4001)]:
            with self.subTest(key=k,value=str(v)[:30]),self.assertRaises(ValueError):self.e.resolve_task(task(**{k:v}))
    def test_idempotency_no_duplicate_voice_task(self):
        p={'tasks':[task()], 'request_id':'voice-1'};a=self.e.submit(p);self.assertEqual(a['job_id'],self.e.submit(p)['job_id']);self.assertEqual(a['operation'],'reference_voice');self.assertNotIn('telemetry',a)
        p['tasks'][0]['prompt']='Another line.'
        with self.assertRaisesRegex(ValueError,'different payload'):self.e.submit(p)
    def test_eight_candidate_limit_and_mixed_task_rejected(self):
        for tasks in [[task()]*9,[task(),{'mode':'generate'}]]:
            with self.assertRaises(ValueError):self.e.submit({'tasks':tasks})
    def test_actual_wav_decoding_without_video_frame_mapping(self):
        j=self.e.submit({'tasks':[task()]});native=self.root/'voice.wav';wav(native)
        o=self.e.archive_output(j['job_id'],1,native);self.assertEqual(o['media_kind'],'audio');self.assertEqual(o['probe']['duration'],3);self.assertIsNone(o['window_index']);self.assertEqual(o['timeline_mapping'],'not_applicable');self.assertEqual(o['probe']['sample_rate'],16000)
    def test_voice_archive_survives_restart_and_original_deletion(self):
        j=self.e.submit({'tasks':[task()]});native=self.root/'voice.wav';wav(native);o=self.e.archive_output(j['job_id'],1,native);native.unlink();self.e.close();self.e=HeadlessEngine(self.root/'worker',session=Session(),start_dispatcher=False)
        a=self.e.job_state(j['job_id'])['outputs'][0];self.assertTrue(a['available']);self.assertEqual(a['id'],o['id']);self.assertTrue(a['content_type'].startswith('audio/'))
    def test_corrupt_audio_never_advertised(self):
        j=self.e.submit({'tasks':[task()]});native=self.root/'corrupt.wav';native.write_bytes(b'not audio')
        with self.assertRaises(Exception):self.e.archive_output(j['job_id'],1,native)
        self.assertEqual(self.e.job_state(j['job_id'])['outputs'],[])
    def test_owned_wav_http_auth_and_range(self):
        j=self.e.submit({'tasks':[task()]});native=self.root/'voice.wav';wav(native);o=self.e.archive_output(j['job_id'],1,native)
        token=persistent_token(self.e.root);server=build_http(self.e,token,0);threading.Thread(target=server.serve_forever,daemon=True).start()
        base='http://127.0.0.1:'+str(server.server_address[1]);op=u.build_opener(u.ProxyHandler({}));headers={'Authorization':'Bearer '+token}
        try:
            with op.open(u.Request(base+'/voice-models',headers=headers)) as r:self.assertEqual(json.load(r)['models'][0]['model_type'],ARCHITECTURE)
            with op.open(u.Request(base+'/jobs/'+j['job_id']+'/outputs/'+o['id'],headers={**headers,'Range':'bytes=0-3'})) as r:self.assertEqual(r.status,206);self.assertEqual(r.read(),b'RIFF')
            with self.assertRaises(Exception):op.open(base+'/voice-models')
        finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main()
