"""Real Chromium DOM/audio editing; backend and IndexedDB fixture are mocked.
No network download, inference, GPU submission, or native WanGP is contacted.
"""
import base64, json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 page=browser.new_page(viewport={'width':1600,'height':1000});page.set_default_timeout(6000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('http://127.0.0.1:19873/**',lambda route:route.fulfill(status=200,body='<html></html>',content_type='text/html'));page.goto('http://127.0.0.1:19873/')
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="styles.css"[^>]*>','',html)
 page.set_content(html);page.add_style_tag(content=(ROOT/'styles.css').read_text())
 page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
 for f in ['core.js', 'speech-core.js', 'storage.js', 'providers.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:
  page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{window.testBlobs=new Map();const realPut=DirectorStore.putBlob,realGet=DirectorStore.getBlob;DirectorStore.putBlob=async(k,b)=>{testBlobs.set(k,b);await realPut(k,b)};DirectorStore.getBlob=async k=>testBlobs.get(k)||await realGet(k);const samples=new Float32Array(32000*8);for(let i=0;i<samples.length;i++)samples[i]=.1*Math.sin(i/32000*Math.PI*440);testBlobs.set('voice:test-source',new Blob([H3Speech.pcmWav(samples,32000)],{type:'audio/wav'}));const p=H3.demo();p.modelType='fixture_h3_ref2va_pruned_pdd8';p.presetConfirmed=true;p.voiceWorkshops=[{id:'test-source',blobKey:'voice:test-source',name:'Mixed voices fixture',duration:8,peaks:Array(600).fill(.4),gap:.05,segments:[{id:'a',start:0,end:2,text:'Hello cousin.',speaker:'SPEAKER_00',keep:true},{id:'b',start:2.3,end:4,text:'Another speaker.',speaker:'SPEAKER_01',keep:true},{id:'c',start:4.3,end:7,text:'A second useful line.',speaker:'SPEAKER_00',keep:true}]}];DirectorStore.save(p);} """)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp')
 page.locator('button[data-action="voice-workshop"]').click();assert 'Import audio excerpt' in page.locator('#dialog-body').inner_text()
 page.locator('#voice-saved').select_option('test-source');page.wait_for_selector('#voice-lines .voice-line');assert page.locator('.voice-line').count()==3
 page.locator('#voice-speaker-select').select_option('SPEAKER_00');page.locator('[data-voice-action="keep-speaker"]').click()
 assert page.evaluate('DirectorApp.getProject().voiceWorkshops[0].segments[1].keep') is False
 assert '4.75 seconds kept' in page.locator('#voice-total').inner_text()
 page.locator('#voice-out').fill('1.80');page.locator('#voice-out').press('Tab');assert page.evaluate('DirectorApp.getProject().voiceWorkshops[0].segments[0].end')==1.8
 # Drag selected right handle; actual pointer handlers must update metadata.
 handle=page.locator('[data-voice-edge="end"]');box=handle.bounding_box();page.mouse.move(box['x']+8,box['y']+30);page.mouse.down();page.mouse.move(box['x']+35,box['y']+30);page.mouse.up()
 assert page.evaluate('DirectorApp.getProject().voiceWorkshops[0].segments[0].end')>1.8
 page.locator('[data-voice-action="audition"]').click();page.wait_for_function("document.querySelector('#voice-preview').src.startsWith('blob:')")
 subject=page.evaluate('DirectorApp.getProject().subjects[0].id');page.locator('#voice-subject').select_option(subject);page.locator('#voice-ref-name').fill('Niko test');page.locator('#voice-bind-speaker').select_option('S1')
 with page.expect_download() as d:page.locator('#voice-export').click()
 assert d.value.suggested_filename=='Niko test.wav'
 page.wait_for_function('DirectorApp.getProject().assets.some(a=>a.kind==="audio")')
 assert page.evaluate('DirectorApp.getProject().subjects[0].voiceAssetId')
 assert page.evaluate('DirectorApp.getProject().assets.find(a=>a.kind==="audio").provenance.ranges.length')==2
 page.screenshot(path=str(ROOT.parent/'screen-voice-workshop.png'))
 print('PASS source selection, speaker filtering, cut times, pointer handles, actual WAV audition/export and subject binding')
 # Portable backup includes source media, not only the rendered short reference.
 keys=page.evaluate('async()=>Object.keys((await DirectorStore.portable(DirectorApp.getProject())).files)');assert 'voice:test-source' in keys
 print('PASS portable backup preserves original voice source and edited reference')
 large_bytes=bytes(4_500_000);encoded=base64.b64encode(large_bytes).decode()
 imported=page.evaluate("""async encoded=>{
  const p=H3.newProject(),id='large-portable-media';p.assets.push({id,kind:'video',number:1,name:'feature.mp4',type:'video/mp4',size:4500000,duration:100,width:640,height:360,description:'',role:'',transcript:''});p.counters.video=1;
  const fetchBefore=window.fetch;let fetchedData=false;window.fetch=async(input,...args)=>{if(String(input).startsWith('data:')){fetchedData=true;throw new TypeError('Failed to fetch');}return fetchBefore(input,...args);};
  try{const imported=await DirectorStore.importPortable({project:p,files:{[id]:{type:'video/mp4',data:'data:video/mp4;base64,'+encoded}}});const blob=await DirectorStore.getBlob(imported.assets[0].id);return{size:blob.size,type:blob.type,fetchedData};}finally{window.fetch=fetchBefore;}
 }""",encoded)
 assert imported=={'size':len(large_bytes),'type':'video/mp4','fetchedData':False},imported
 print('PASS large embedded media imports via direct data-URL decoding without fetch')
 page.locator('[data-action="close-dialog"]').first.click()
 # Model discovery uses a fake official-shaped response; no model inference.
 page.evaluate("""()=>{const orig=DirectorProviders.wangp;DirectorProviders.wangp=async(path,...a)=>path==='/models'?{models:[{model_type:'h3_ref2va_pruned',name:'Standard H3 pruned'}]}:path.startsWith('/model?')?{defaults:{num_inference_steps:20,sample_solver:'euler',guidance_phases:1,flow_shift:12,guidance_scale:1},director_profile:{inference_mode:'standard'},metadata:{name:'Standard H3 pruned'}}:path==='/health'?{app:'h3-director-wangp'}:orig(path,...a);} """)
 page.locator('[data-action="connections"]').first.click();page.locator('[data-action="test-wangp"]').click();page.locator('#wangp-model').select_option('h3_ref2va_pruned')
 page.wait_for_selector('#h3-steps');assert page.locator('#h3-steps').input_value()=='20'
 page.locator('#h3-steps').fill('28');page.locator('#h3-sampler').select_option('res_multistep');page.locator('#preset-confirmed').check();page.locator('[data-action="save-connections"]').click()
 assert page.evaluate('H3.tasks(DirectorApp.getProject())[0].num_inference_steps')==28
 print('PASS actual connections UI selects standard defaults and preserves step/sampler edits')
 # Fake a full native render and retain the voice asset; supply enough image refs for H3 validation.
 project=page.evaluate('DirectorApp.getProject()');plan=page.evaluate('H3.renderPlan(DirectorApp.getProject())')
 image={'id':'test-picture','kind':'image','number':1,'name':'identity.png','type':'image/png','size':1,'missing':False}
 project['assets'].append(image)
 for w in project['windows']:w['assetIds'].append(image['id'])
 output={'id':'a'*32,'name':'full.mp4','task_index':1,'window_index':4,'cumulative':True,'available':True,'bytes':1000,'created_at':1}
 job={'id':'original-job','status':'completed','url':'http://127.0.0.1:7867','name':'Original film','createdAt':'2026-09-11T01:00:00Z','plan':plan,'live':{'outputs':[output],'status':'completed'}}
 project['jobs']=[job]
 page.evaluate("async()=>{const c=document.createElement('canvas');c.width=c.height=8;const b=await new Promise(r=>c.toBlob(r));testBlobs.set('test-picture',b);}")
 page.locator('#project-import').set_input_files({'name':'fixture.json','mimeType':'application/json','buffer':json.dumps(project).encode()});page.wait_for_function('DirectorApp.getProject().jobs.length===1')
 page.evaluate('id=>DirectorApp.select(id)',plan[1]['id']);page.locator('[data-action="takes"]').first.click()
 assert page.locator('[data-take-play]').count()==1
 page.locator('#take-scope').select_option('shot');assert page.locator('#take-source').input_value()=='0';page.locator('[data-take-action="prepare"]').click()
 assert 'NEW TAKE' in page.locator('#dialog-body').inner_text();assert 'source file is missing' in page.locator('#dialog-body').inner_text()
 assert page.evaluate('DirectorApp.getProject().windows.length')==4
 assert page.locator('[data-action="submit-wangp"]').count()==0
 page.screenshot(path=str(ROOT.parent/'screen-take.png'))
 print('PASS prior output becomes selectable continuation context; retake review blocks JSON-only missing media without mutating original timeline')
 assert not errors,errors
 print('PASS real Chromium workshop/take/profile DOM checks. Backend/ASR/render sources are fixtures, not live inference.')
 browser.close()
