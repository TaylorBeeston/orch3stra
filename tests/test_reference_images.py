"""Real local PNG validation/persistence; modeled WanGP registry/inference."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace as NS
import io, threading, urllib.request, urllib.error
from PIL import Image
from headless.engine import HeadlessEngine
from headless.reference_images import ARCHITECTURE, VIGGLE_PROFILES, image_probe

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('nemotron_helper', ROOT/'scripts/diarization_worker.py')
nem = importlib.util.module_from_spec(spec); spec.loader.exec_module(nem)
voice_spec = importlib.util.spec_from_file_location('voice_worker_140', ROOT/'scripts/voice_worker.py')
voice = importlib.util.module_from_spec(voice_spec); voice_spec.loader.exec_module(voice)


class Session:
    def __init__(self, viggle=True): self.viggle=viggle;super().__init__()
    def list_model_metadata(self, **kwargs):
        return [self.get_model_metadata(ARCHITECTURE)] if kwargs.get('query') == 'Qwen' else []
    def get_model_metadata(self, name):
        return {'model_type': name, 'name': 'Qwen Image 2.1', 'base_model_type': ARCHITECTURE} if name == ARCHITECTURE else {'model_type':name,'name':'Other'}
    def list_model_defs(self, **kwargs):
        return [{'model_type':kwargs['model_type'], 'model':{'architecture':kwargs['model_type']}}]
    def get_default_settings(self, _): return {'num_inference_steps':40,'guidance_scale':4}
    def get_model_schema(self, _): return {'fields':[]}
    def get_model_settings(self, model_type, setting_id=None, *, include_selection=False):
        settings=[{'id':key,'type':'accelerator profile'} for key in VIGGLE_PROFILES] if self.viggle else []
        if setting_id is None: return {'model_type':model_type,'settings':settings}
        profile=VIGGLE_PROFILES[setting_id]
        return {'model_type':model_type,'id':setting_id,'type':'accelerator profile','content':{'model_type':model_type,'sample_solver':'viggle_v02','num_inference_steps':profile['steps'],'guidance_scale':1,'activated_loras':[profile['lora']],'loras_multipliers':'1'}}

class ReferenceImages(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.root = Path(self.tmp.name)
        self.e = HeadlessEngine(self.root, session=Session(), start_dispatcher=False)
    def tearDown(self):self.e.close();self.tmp.cleanup()
    def image(self, name='face.png'):
        path=self.root/'uploads'/name;Image.new('RGB',(32,32)).save(path)
        return self.e.register_upload(path,name,'image/png')['media_id']
    def task(self, **changes):
        task=dict(mode='reference_image',model_type=ARCHITECTURE,license_accepted=True,prompt='A studio portrait.',image_refs=[],resolution='1024x1024',num_inference_steps=40,guidance_scale=4);task.update(changes);return task
    def test_single_prompt_is_forced_and_multiline_content_is_preserved(self):
        prompt = "Use <image1> as the identity.\n\nShow the current wardrobe.\r\nKeep the expression calm."
        for setting in (None, 'PG', 'G', 'PW', 'FG'):
            for acceleration in ('', next(p['id'] for p in VIGGLE_PROFILES.values() if p['steps'] == 6)):
                task = self.task(prompt=prompt, image_refs=[self.image('test.png')], acceleration_profile=acceleration)
                if setting is not None:
                    task['multi_prompts_gen_type'] = setting
                resolved = self.e.resolve_task(task)
                self.assertEqual(resolved['multi_prompts_gen_type'], 'FG')
                self.assertEqual(resolved['prompt'], prompt)
                self.assertEqual(resolved['batch_size'], 1)
                self.assertEqual(resolved['repeat_generation'], 1)
                self.assertEqual(task['prompt'], prompt)

    def test_legacy_queued_image_dispatch_uses_fg_without_editing_original_payload(self):
        from test_headless import Session as RenderSession, wait
        class ImageSession(Session, RenderSession):
            pass
        session = ImageSession()
        self.e.session = session
        task = self.task(prompt="Identity instructions.\n\nComposition instructions.")
        task['multi_prompts_gen_type'] = 'PG'
        jid = self.e.submit({'tasks': [task], 'request_id': 'legacy-queued-image'})['job_id']
        # Simulate a persisted pre-fix resolved task, as restored from SQLite.
        self.e.jobs[jid]['resolved'][0].pop('multi_prompts_gen_type')
        before = copy.deepcopy(self.e.jobs[jid]['payload'])
        thread = threading.Thread(target=self.e._run, args=(jid,))
        thread.start()
        wait(lambda: len(session.jobs) == 1)
        session.jobs[0].gate.set()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(session.calls[0]['multi_prompts_gen_type'], 'FG')
        self.assertEqual(session.calls[0]['prompt'], task['prompt'])
        self.assertEqual(self.e.jobs[jid]['payload'], before)

    def test_text_only_images_are_full_prompts_too(self):
        prompt = "A quiet room.\n\nWarm light on the table."
        self.assertEqual(self.e.resolve_task(self.task(prompt=prompt))['multi_prompts_gen_type'], 'FG')
        self.assertEqual(self.e.health()['capabilities']['reference_image_prompt_mode'], 'FG')

    def test_image_batch_keeps_separate_tasks_not_paragraph_splits(self):
        tasks = [self.task(prompt='Portrait.\n\nPlain background.'), self.task(prompt='Room.\n\nWarm light.')]
        state = self.e.submit({'tasks': tasks, 'request_id': 'two-image-cards'})
        resolved = self.e.jobs[state['job_id']]['resolved']
        self.assertEqual(len(resolved), 2)
        self.assertEqual([t['prompt'] for t in resolved], [t['prompt'] for t in tasks])
        self.assertTrue(all(t['multi_prompts_gen_type'] == 'FG' for t in resolved))

    def test_discovery_separate_from_h3(self):
        self.assertEqual(len(self.e.reference_models()),1);self.assertEqual(self.e.metadata_cache,[])
        self.assertFalse(self.e.health()['capabilities']['reference_images']) # Discovery-only fixture has no task submission API.
        with self.assertRaisesRegex(ValueError,'H3'):self.e.model_info(ARCHITECTURE)
    def test_actual_architecture_required(self):
        with self.assertRaisesRegex(ValueError,'only'):self.e.reference_model_info('qwen_image_old')
    def test_owned_input_and_fresh_native_settings(self):
        task=self.task();task.update(image_refs=[self.image()],prompt='Face from <image1>',video_source='/etc/passwd',audio_guide='secret',loras=['unapproved'],output_dir='/tmp/nope')
        resolved=self.e.resolve_task(task);self.assertEqual(resolved['video_prompt_type'],'I');self.assertEqual(resolved['sample_solver'],'default');self.assertEqual(resolved['image_mode'],1)
        for k in ['audio_guide','video_source','loras','output_dir','mode','license_accepted']:self.assertNotIn(k,resolved)
        self.assertNotIn('activated_loras',resolved);self.assertNotIn('loras_multipliers',resolved)
    def test_viggle_profiles_are_discovered_and_resolved_server_side(self):
        info=self.e.reference_model_info(ARCHITECTURE)
        available={profile['id'] for profile in info['image_profiles']}
        self.assertEqual(available,{profile['id'] for profile in VIGGLE_PROFILES.values()})
        profile=next(profile for profile in VIGGLE_PROFILES.values() if profile['steps']==6)
        task=self.task(acceleration_profile=profile['id'],num_inference_steps=40,guidance_scale=4,activated_loras=['/not/owned.safetensors'],viggle_turbo_lora_filename='/bad/path')
        resolved=self.e.resolve_reference_image(task)
        self.assertEqual(resolved['num_inference_steps'],6)
        self.assertEqual(resolved['guidance_scale'],1.0)
        self.assertEqual(resolved['sample_solver'],'viggle_v02')
        self.assertEqual(resolved['activated_loras'],[profile['lora']])
        self.assertEqual(resolved['loras_multipliers'],'1')
        self.assertNotIn('viggle_turbo_lora_filename',resolved)
        self.assertNotIn('/not/owned.safetensors',str(resolved))

    def test_viggle_profile_requires_the_exported_wangp_profile(self):
        self.e.session=Session(viggle=False)
        profile=next(profile for profile in VIGGLE_PROFILES.values() if profile['steps']==6)
        with self.assertRaisesRegex(ValueError,'not exposed'):
            self.e.resolve_reference_image(self.task(acceleration_profile=profile['id']))
        with self.assertRaisesRegex(ValueError,'Unsupported'):
            self.e.resolve_reference_image(self.task(acceleration_profile='arbitrary'))
    def test_rejects_unowned_and_changed_reference(self):
        t=self.task();t['image_refs']=['/etc/passwd']
        with self.assertRaises(ValueError):self.e.resolve_task(t)
        id=self.image();t['image_refs']=[id];Path(self.e.media[id]['path']).write_bytes(b'changed')
        with self.assertRaises(ValueError):self.e.resolve_task(t)
    def test_explicit_license_and_ten_reference_limit(self):
        t=self.task();t['license_accepted']=False
        with self.assertRaisesRegex(ValueError,'license'):self.e.resolve_task(t)
        t=self.task();t['image_refs']=['x']*11
        with self.assertRaisesRegex(ValueError,'ten'):self.e.resolve_task(t)
    def test_resolution_steps_seed_validated(self):
        for key,value in [('resolution','99999x99999'),('resolution','1000x1024'),('num_inference_steps',101),('seed',True),('guidance_scale',float('nan'))]:
            t=self.task();t[key]=value
            with self.assertRaises(ValueError):self.e.resolve_task(t)
    def test_input_slot_validation(self):
        t=self.task();t['prompt']='Use <image2>'
        with self.assertRaisesRegex(ValueError,'missing input'):self.e.resolve_task(t)
    def test_image_request_is_idempotent(self):
        p={'tasks':[self.task()],'request_id':'image-request','snapshot':{'kind':'reference-images'}}
        a=self.e.submit(p);b=self.e.submit(p);self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(a['operation'],'reference_image');self.assertNotIn('telemetry',a)
        p['tasks'][0]['prompt']='different'
        with self.assertRaisesRegex(ValueError,'different payload'):self.e.submit(p)
    def test_real_png_archive_and_restart(self):
        j=self.e.submit({'tasks':[self.task()],'request_id':'image'});native=self.root/'native.png';Image.new('RGB',(96,64)).save(native)
        r=self.e.archive_output(j['job_id'],1,native,wi=1);self.assertEqual(r['media_kind'],'image');self.assertIsNone(r['window_index']);self.assertEqual(r['probe']['width'],96);self.assertEqual(r['timeline_mapping'],'not_applicable');native.unlink()
        self.assertTrue(self.e.output_available(r));self.e.close();self.e=HeadlessEngine(self.root,session=Session(),start_dispatcher=False)
        out=self.e.job_state(j['job_id'])['outputs'][0];self.assertTrue(out['available']);self.assertEqual(out['content_type'],'image/png')
    def test_corrupt_png_not_advertised(self):
        j=self.e.submit({'tasks':[self.task()]});p=self.root/'bad.png';p.write_bytes(b'not an image')
        with self.assertRaises(Exception):self.e.archive_output(j['job_id'],1,p)
        self.assertEqual(self.e.job_state(j['job_id'])['outputs'],[])
    def test_mixed_jobs_rejected(self):
        with self.assertRaisesRegex(ValueError,'only images'):self.e.submit({'tasks':[self.task(),{'mode':'generate'}]})

class NemotronContracts(unittest.TestCase):
    def test_native_uppercase_keys_overlaps_and_clamp(self):
        turns=nem.canonical_turns([{'Start':0,'End':3,'Speaker':0},{'Start':1,'End':4,'Speaker':1}],3.5)
        self.assertEqual(turns[1],{'start':1.,'end':3.5,'speaker':'SPEAKER_01'})
    def test_speaker_bound_and_nonfinite(self):
        for item in [{'Start':0,'End':1,'Speaker':8},{'Start':float('nan'),'End':1,'Speaker':0}]:
            with self.assertRaises(ValueError):nem.canonical_turns([item],2)
    def test_streaming_keeps_processor_overlap_geometry(self):
        class Processor:
            num_samples_first_audio_chunk=120
            num_samples_per_audio_chunk=140
            num_mel_frames_per_step=10
            def audio_chunk_start(self,n):return n*10-20
        chunks=list(nem.audio_chunks(Processor(),550))
        self.assertEqual(chunks[0],(0,120,True,False));self.assertEqual(chunks[1][0],80);self.assertTrue(chunks[-1][3]);self.assertEqual(chunks[-1][1],550)
        self.assertEqual(sum(c[2] for c in chunks),1)
    def test_short_chunk_no_empty_tail(self):
        class P:
            num_samples_first_audio_chunk=120
            num_samples_per_audio_chunk=140
            num_mel_frames_per_step=10
        self.assertEqual(list(nem.audio_chunks(P(),30)),[(0,30,True,True)])
    def test_no_download_without_consent(self):
        with self.assertRaisesRegex(ValueError,'Consent'):nem.diarize({'input':'/does-not-exist'})

class VoiceFailureTests(unittest.TestCase):
    def test_transcription_survives_nemotron_failure_and_redacts_token(self):
        class Whisper:
            def __init__(self, *args, **kwargs): pass
            def transcribe(self, *args, **kwargs):
                word=NS(start=0.,end=1.,word=' Hello!',probability=.99)
                return [NS(words=[word],end=1.)], NS(duration=2.,language='en')
        with patch.dict('sys.modules', {'faster_whisper':NS(WhisperModel=Whisper)}), patch.object(voice,'nemotron',side_effect=ValueError('Failed token hf_secret')), patch.object(voice,'emit'):
            result=voice.transcribe({'input':'fixture.wav','allowModels':True,'diarize':True,'diarizationModel':'nemotron3','hfToken':'hf_secret'})
        self.assertEqual(result['segments'][0]['text'].strip(),'Hello!')
        self.assertFalse(result['diarized']);self.assertIn('transcription was kept',result['warnings'][0]);self.assertNotIn('hf_secret',str(result));self.assertEqual(result['diarizationModel'],'nemotron3')
    def test_nemotron_group_only_does_not_load_asr(self):
        with patch.object(voice,'nemotron',return_value={'turns':[{'start':0.,'end':1.,'speaker':'SPEAKER_00'}]}), patch.object(voice,'transcribe',side_effect=AssertionError('ASR must not run')):
            result=voice.group_only({'allowModels':True,'input':'fixture.wav'})
        self.assertTrue(result['diarized'])

class RealImageHTTP(unittest.TestCase):
    def test_real_upload_dispatch_archive_authenticated_download(self):
        from test_headless import Session as RenderSession, wait
        from headless.server import build_http, persistent_token
        class ImageSession(Session, RenderSession):
            def submit_task(self, settings):
                # Model the relevant upstream defaults/guard at the real engine boundary.
                # This does not run WanGP or a GPU model.
                mode = settings.get('multi_prompts_gen_type', 'PG')
                paragraphs = [p for p in settings['prompt'].replace('\r', '').split('\n\n') if p.strip()]
                if mode == 'PG' and len(paragraphs) != 1:
                    raise AssertionError('The real worker submitted a multiline image as PG')
                assert mode == 'FG'
                return super().submit_task(settings)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); session=ImageSession(); engine=HeadlessEngine(root/'worker',session=session,start_dispatcher=True)
            token=persistent_token(engine.root); server=build_http(engine,token,0)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base='http://127.0.0.1:'+str(server.server_address[1])
            opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
            def request(path, data=None, headers=None):
                all_headers={'Authorization':'Bearer '+token,**(headers or {})}
                req=urllib.request.Request(base+path,data=data,headers=all_headers)
                return opener.open(req,timeout=5)
            try:
                buf=io.BytesIO();Image.new('RGB',(48,32)).save(buf,'PNG');png=buf.getvalue()
                with request('/upload?filename=ref.png',png,{'Content-Type':'image/png'}) as response:
                    mid=json.load(response)['media_id']
                task={'mode':'reference_image','license_accepted':True,'model_type':ARCHITECTURE,'prompt':'Use <image1> as the identity.\n\nShow a cream jacket.','image_refs':[mid],'resolution':'1024x1024','num_inference_steps':40,'guidance_scale':4}
                payload={'tasks':[task],'request_id':'real-image-request','project_id':'p1','snapshot':{'kind':'reference-images','cards':[{'title':'Cream jacket'}]}}
                with request('/generate',json.dumps(payload).encode(),{'Content-Type':'application/json'}) as response: jid=json.load(response)['job_id']
                wait(lambda:len(session.jobs)==1)
                output=root/'output.png';output.write_bytes(png);session.jobs[0].generated=[str(output)];session.jobs[0].gate.set()
                wait(lambda:engine.job_state(jid)['status']=='completed')
                with request('/jobs/'+jid) as response:state=json.load(response)
                self.assertEqual(state['operation'],'reference_image');self.assertNotIn('telemetry',state)
                record=state['outputs'][0];self.assertEqual(record['media_kind'],'image');self.assertEqual(record['probe']['width'],48)
                output.unlink()
                path='/jobs/'+jid+'/outputs/'+record['id']
                with request(path) as response:self.assertEqual(response.read(),png);self.assertEqual(response.headers['Content-Type'],'image/png')
                with request(path,headers={'Range':'bytes=0-7'}) as response:self.assertEqual(response.status,206);self.assertEqual(response.read(),png[:8])
                with self.assertRaises(urllib.error.HTTPError):opener.open(base+path,timeout=5)
                with request('/requests/real-image-request') as response:self.assertEqual(json.load(response)['job_id'],jid)
                with request('/jobs/'+jid+'/metadata') as response:self.assertEqual(json.load(response)['snapshot']['kind'],'reference-images')
                self.assertEqual(len(session.calls),1)
            finally:
                server.shutdown();server.server_close();engine.close()

if __name__=='__main__':unittest.main()
