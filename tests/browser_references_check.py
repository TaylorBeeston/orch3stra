# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Actual portrait Chromium UI, real PNG decode/blob import; AI/worker are fixtures."""
import base64
import io
import json
import os
import re
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
b=io.BytesIO();Image.new('RGB',(180,240),(62,100,128)).save(b,'PNG')
image='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1,is_mobile=True,has_touch=True)
 page.route("**/*",lambda route:route.abort()) # No HTTP access; fixtures and data: blobs only.
 page.set_default_timeout(15000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));dialogs={'accept':True};page.on('dialog',lambda d:d.accept() if dialogs['accept'] else d.dismiss())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html)
 for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async(image)=>{
  const p=H3.newProject();p.name='Reference workshop fixture';p.request='An invented character visits a bowling alley in a different outfit.';
  p.imageSettings={modelType:'qwen_image_21_7B',modelLabel:'Qwen Image 2.1'};
  p.assets=[{id:'portrait-file',number:1,kind:'image',name:'unassigned-portrait.png',type:'image/png',size:200,duration:null,description:'Reference portrait',role:'',transcript:''}];p.counters.image=1;p.windows[0].assetIds=['portrait-file'];p.voiceWorkshops=[{id:'group-test',blobKey:'voice:group-test',name:'Editable dialogue',duration:4,peaks:Array(200).fill(.2),segments:[{id:'cut-one',start:0,end:1,text:'Exact first line.',speaker:'OLD_0',keep:false},{id:'cut-two',start:1.2,end:3.4,text:'Exact second line.',speaker:'OLD_1',keep:true}],speakerNames:{OLD_0:'Previous label'},gap:.05}];
  window.fixture={image,blobs:new Map(),requests:[],submitted:[],jobs:[],polls:0,failImage:false};fixture.blobs.set('portrait-file',await(await fetch(image)).blob());fixture.blobs.set('voice:group-test',new Blob([H3Speech.pcmWav(new Float32Array(32000*4),32000)],{type:'audio/wav'}));fixture.voiceActions=[];
  DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);DirectorStore.save(p);
  const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash';P.config.images=true;
  P.uploadVoice=async()=>({uploadId:'voice-upload'});P.remember=async()=>{};P.call=async(route,b)=>{if(route==='voice'){fixture.voiceActions.push(b.action);if(b.action==='import')return{id:'voice-import',status:'completed',result:{sourceId:'owned-voice'}};if(b.action==='diarize')return{id:'diarize-test',status:'completed',result:{turns:[{start:0,end:1,speaker:'SPEAKER_00'},{start:1.2,end:3.4,speaker:'SPEAKER_01'}],diarized:true,diarizationModel:'nvidia/Nemotron-3-Diarization'}};throw Error('Unexpected voice action '+b.action);}if(route==='studio')return b.action==='list'?{projects:[]}:{credentials:{}};if(route==='sequence'&&b.action==='list')return{runs:[]};throw Error('Unexpected call '+route+' '+b.action);};
  P.generate=async(system,packet,images)=>{fixture.requests.push({system,packet,images});if(system===H3References.SELECTION_SYSTEM)return JSON.stringify({message:'Inspect the first visual batch.',inspectIds:packet.references.slice(0,12).map(a=>a.id)});if(system.includes(H3References.INSPECTION_SYSTEM)){const ids=packet.visualInspection.batchIds,already=packet.visualInspection.alreadyInspectedIds,more=packet.references.map(a=>a.id).filter(id=>!already.includes(id)&&!ids.includes(id)).slice(0,4);return JSON.stringify({message:'Inspected '+ids.length+' references.',notes:[],images:[{title:'Visual batch '+packet.visualInspection.batchIndex,subjectId:packet.subjects[0].id,state:'bowling outfit',purpose:'Reference coverage from this batch',appearance:'',retention:'',referenceIds:[ids[0]],windowIds:[],prompt:'Preserve the identity in <image1> and create a full-body bowling outfit.'}],inspectMoreIds:more});}return JSON.stringify({notes:['First approve one identity anchor. Then make wardrobe variants.'],images:[{title:'Bowling reference portrait',subjectId:packet.subjects[0].id,state:'bowling outfit',purpose:'Missing wardrobe reference',referenceIds:['portrait-file'],windowIds:[],prompt:'Preserve the face and hairstyle from <image1>. Dress this person in a cream bowling shirt in an empty neon bowling alley. One full-length image.'}]});};
  P.upload=async(a,b)=>({media_id:'h3media:'+a.id});P.mediaURL=async()=>image;
  P.wangp=async(path,method,body)=>{if(path==='/health')return{app:'h3-director-wangp',backend:'headless',capabilities:{reference_images:true,reference_image_prompt_mode:'FG'}};if(path==='/image-models')return{models:[{model_type:'qwen_image_21_7B',name:'Qwen Image 2.1'},{model_type:'krea2_turbo',name:'Synthetic Krea preset fixture'}]};if(path.startsWith('/image-model?'))return{profile:{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1',license:'Synthetic fixture terms only',max_references:10},image_profiles:[{id:'viggle-turbo-v0.2.1-6step',name:'Viggle Turbo v0.2.1 · 6 steps',steps:6,guidance:1}]};if(path==='/generate'){fixture.submitted.push(body);const j={job_id:'a'.repeat(32),status:'running',message:'Image fixture',operation:'reference_image',project_id:p.id,request_id:body.request_id,outputs:[]};fixture.jobs.push(j);return j;}if(path==='/queue')return{jobs:fixture.jobs};if(path.startsWith('/jobs/')){fixture.polls++;return fixture.failImage?{...fixture.jobs.at(-1),status:'failed',message:'Headless job failed.',errors:['Synthetic Qwen task failure detail'],outputs:[]}:{...fixture.jobs[0],status:'completed',outputs:[{id:'b'.repeat(32),task_index:1,media_kind:'image',content_type:'image/png',available:true,probe:{width:180,height:240}}]};}throw Error(path);};
 }""",image)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.references')
 # Declining registration is a true cancel: no mutation or planner request.
 dialogs['accept']=False
 before_cancel=page.evaluate('DirectorApp.getProject()')
 assert page.evaluate('DirectorApp.references.preflight()') is False
 after_cancel=page.evaluate('DirectorApp.getProject()')
 assert before_cancel['assets']==after_cancel['assets'] and before_cancel['subjects']==after_cancel['subjects']
 assert page.evaluate('fixture.requests.length')==0
 dialogs['accept']=True
 print('PASS draft preflight cancellation creates no subjects, changes no picture purpose and sends no AI request')
 # No rotation: entry visible even though sidebar is hidden.
 assert not page.locator('.library').is_visible()
 page.locator('#subjects-button').click();page.wait_for_selector('[data-ref="classify"]')
 assert page.locator('#dialog').bounding_box()['width']<=391
 page.locator('[data-ref="classify"]').click();page.locator('[data-ref="new-from"]').click()
 assert page.evaluate('DirectorApp.getProject().subjects.length')==0
 page.locator('#subject-name').fill('Alex');page.locator('#subject-description').fill('An adult with short black hair, round glasses and a small scar on the left eyebrow.')
 # Simulate keyboard reducing viewport; save remains reachable without rotating.
 page.set_viewport_size({'width':390,'height':460});page.locator('[data-ref="save-subject"]').scroll_into_view_if_needed()
 box=page.locator('[data-ref="save-subject"]').bounding_box();assert box['y']>=0 and box['y']+box['height']<=461,box
 page.locator('[data-ref="save-subject"]').click();page.set_viewport_size({'width':390,'height':844})
 p=page.evaluate('DirectorApp.getProject()');assert p['subjects'][0]['assetIds']==['portrait-file'];assert p['windows'][0]['subjectIds']==[]
 print('PASS portrait subject creation, keyboard-height Save, image linking; no automatic scene presence')
 page.locator('[data-ref="edit"]').click();page.locator('#subject-description').fill('Updated description kept across upload: short hair and round glasses.')
 page.locator('#ref-subject-upload').set_input_files({'name':'second.png','mimeType':'image/png','buffer':b.getvalue()})
 page.wait_for_function("document.querySelectorAll('[data-ref-source]').length===2")
 assert page.locator('#subject-description').input_value().startswith('Updated description')
 page.locator('[data-ref="save-subject"]').click()
 page.screenshot(path=str(ROOT.parent/'screen-subjects-phone-140.png'))
 print('PASS uploading sources preserves unsaved subject text')
 # End-to-end local UI: proposal only, source bytes shown to planner, explicit generation.
 page.locator('[data-ref="variants"]').click();page.locator('[data-ref="plan"]').click();page.wait_for_selector('[data-card]')
 assert page.evaluate('fixture.requests[0].images.length')==2
 assert page.evaluate('fixture.requests[0].images[0].url.startsWith("data:image/")')
 assert page.evaluate('fixture.submitted.length')==0
 page.wait_for_function("Array.from(document.querySelectorAll('#ref-acceleration-profile option')).some(o=>o.value==='viggle-turbo-v0.2.1-6step')")
 page.locator('[data-ref="discover"]').click();page.wait_for_function("document.querySelector('#ref-model').value==='qwen_image_21_7B'")
 page.wait_for_function("Array.from(document.querySelectorAll('#ref-acceleration-profile option')).some(o=>o.value==='viggle-turbo-v0.2.1-6step')");assert not page.locator('#ref-license').is_checked();page.locator('#ref-license').check();page.wait_for_function("localStorage.getItem(H3References.imageLicenseContext('qwen_image_21_7B',{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1'}).key)===H3References.imageLicenseContext('qwen_image_21_7B',{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1'}).stamp");page.locator('[data-ref="generate"]').click();page.locator('[data-app-confirm="cancel"]').click();assert page.evaluate('fixture.submitted.length')==0;page.locator('[data-ref="generate"]').click();page.locator('[data-app-confirm="accept"]').click();page.wait_for_function('fixture.submitted.length===1');page.wait_for_selector('[data-ref="import-image"]')
 assert page.evaluate('fixture.submitted[0].tasks[0].image_refs')==['h3media:portrait-file']
 assert page.evaluate('fixture.submitted[0].tasks[0].license_accepted') is True
 assert page.evaluate('fixture.submitted[0].tasks[0].num_inference_steps')==40
 assert page.evaluate('fixture.submitted[0].tasks[0].acceleration_profile')=='';assert page.evaluate('!Object.hasOwn(fixture.submitted[0].tasks[0],"activated_loras")')
 assert page.evaluate('DirectorApp.getProject().assets.length')==2
 page.locator('[data-ref="import-image"]').click();page.wait_for_function('DirectorApp.getProject().assets.length===3')
 assert not page.evaluate('Object.hasOwn(DirectorApp.getProject().imageSettings,"licenseAccepted")');assert page.evaluate("localStorage.getItem(H3References.imageLicenseContext('qwen_image_21_7B',{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1'}).key)===H3References.imageLicenseContext('qwen_image_21_7B',{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1'}).stamp")
 page.evaluate('DirectorApp.references.studio()');assert page.locator('#ref-license').is_checked()
 p=page.evaluate('DirectorApp.getProject()');assert len(p['subjects'][0]['assetIds'])==2;assert len(p['subjects'][0]['referenceVariants'])==1;assert p['windows'][0]['subjectIds']==[]
 assert p['referenceJobs'][0]['requestId'].startswith('image_')
 page.locator('#ref-acceleration-profile').select_option('viggle-turbo-v0.2.1-6step');assert page.locator('#ref-steps').input_value()=='6' and page.locator('#ref-guidance').input_value()=='1'
 page.evaluate('fixture.failImage=true');page.locator('[data-ref="generate"]').click();page.locator('[data-app-confirm="accept"]').click();page.wait_for_function('fixture.submitted.length===2');
 assert page.evaluate('fixture.submitted[1].tasks[0].acceleration_profile')=='viggle-turbo-v0.2.1-6step';assert page.evaluate('fixture.submitted[1].tasks[0].num_inference_steps')==6;assert page.evaluate('fixture.submitted[1].tasks[0].guidance_scale')==1
 page.evaluate('DirectorApp.references.poll()');page.wait_for_function('DirectorApp.getProject().referenceJobs.some(r=>r.status==="failed")');
 assert 'Synthetic Qwen task failure detail' in page.locator('#ref-results').inner_text()
 page.locator('#ref-license').uncheck();assert page.evaluate("localStorage.getItem(H3References.imageLicenseContext('qwen_image_21_7B').key)===null")
 page.evaluate('DirectorApp.references.studio()');assert not page.locator('#ref-license').is_checked()
 # A changed reported revision invalidates the acknowledgement in the real UI.
 page.locator('#ref-license').check();old_stamp=page.locator('#ref-license').get_attribute('data-license-stamp')
 page.evaluate("""()=>{const prior=DirectorProviders.wangp;DirectorProviders.wangp=async(path,...args)=>{const reply=await prior(path,...args);if(path.startsWith('/image-model?'))reply.profile={...reply.profile,revision:'synthetic-revision-2'};return reply;};DirectorApp.references.studio();}""")
 page.wait_for_function("document.querySelector('#ref-license')?.dataset.licenseStamp.includes('synthetic-revision-2')");assert not page.locator('#ref-license').is_checked();assert page.locator('#ref-license').get_attribute('data-license-stamp')!=old_stamp;assert page.evaluate('fixture.submitted.length')==2
 page.locator('#ref-license').check();page.locator('[data-ref=discover]').click();page.locator('#ref-model').select_option('krea2_turbo');page.wait_for_function("document.querySelector('#ref-license')?.dataset.licenseStamp.includes('krea2_turbo')&&!document.querySelector('#ref-license').disabled");assert not page.locator('#ref-license').is_checked();assert page.evaluate('fixture.submitted.length')==2
 page.evaluate("""()=>{const prior=DirectorProviders.wangp;DirectorProviders.wangp=async(path,...args)=>{const reply=await prior(path,...args);if(path.startsWith('/image-model?')){reply.profile={...reply.profile};delete reply.profile.revision;delete reply.profile.model_revision;delete reply.profile.license_revision;}return reply;};DirectorApp.references.studio();}""")
 page.wait_for_function("document.querySelector('#ref-license')?.dataset.licenseStamp.includes('unspecified')&&!document.querySelector('#ref-license').disabled");assert not page.locator('#ref-license').is_checked()
 page.locator('#ref-license').check();assert page.locator('#ref-license').is_checked();assert page.evaluate("localStorage.getItem(H3References.imageLicenseContext('krea2_turbo').key)===null")
 page.evaluate('DirectorApp.references.studio()');page.wait_for_function("document.querySelector('#ref-license')&&!document.querySelector('#ref-license').disabled");assert not page.locator('#ref-license').is_checked();assert page.evaluate('fixture.submitted.length')==2
 print('PASS unknown real-adapter revision shape permits current review but never reuses stored acknowledgement on reopen')
 print('PASS actual image studio clears consent after selected model or reported revision changes; no new job submitted')
 print('PASS selected Viggle profile sends its profile ID and matched 6-step/guidance-1 settings; worker errors remain visible')
 print('PASS actual image samples to planner, editable proposal, explicit native queue task, original PNG import as isolated variant')
 page.screenshot(path=str(ROOT.parent/'screen-reference-images-phone-140.png'))
 page.set_viewport_size({'width':1460,'height':1000});page.screenshot(path=str(ROOT.parent/'screen-reference-images-desktop-140.png'))
 # Metadata-only selection and explicit visual batches scale beyond the per-call image cap.
 page.evaluate('DirectorApp.references.home()')
 page.locator('#ref-upload').set_input_files([{'name':f'angle-{i:02}.png','mimeType':'image/png','buffer':b.getvalue()} for i in range(13)])
 page.wait_for_function('DirectorApp.getProject().assets.filter(a=>a.kind==="image").length===16')
 page.evaluate('DirectorApp.references.studio()');page.locator('[data-reference-workflow="select"]').click()
 page.wait_for_function('DirectorApp.getProject().referencePlans.at(-1).status==="awaiting-inspection"')
 assert page.evaluate('fixture.requests.at(-1).images.length')==0
 assert page.evaluate('fixture.requests.at(-1).packet.references.length')==16
 assert page.evaluate('fixture.requests.at(-1).system===H3References.SELECTION_SYSTEM')
 before_jobs=page.evaluate('fixture.submitted.length')
 page.locator('[data-reference-workflow="inspect"]').click()
 page.wait_for_function('DirectorApp.getProject().referencePlans.at(-1).inspectedIds.length===12')
 page.locator('[data-reference-workflow="inspect"]').click()
 page.wait_for_function('DirectorApp.getProject().referencePlans.at(-1).status==="ready"&&DirectorApp.getProject().referencePlans.at(-1).inspectedIds.length===16')
 assert page.evaluate('fixture.requests.filter(r=>r.system.includes(H3References.INSPECTION_SYSTEM)).map(r=>r.images.length)')==[12,4]
 assert page.evaluate('DirectorApp.getProject().referencePlans.at(-1).images.length')==2
 assert page.evaluate('fixture.submitted.length')==before_jobs
 print('PASS metadata-only selection and two explicitly confirmed visual batches inspect 16 images with no GPU dispatch')
 # Open Voice workshop and check optional new controls are present without loading models.
 page.locator('[data-ref="voice"]').click();page.wait_for_selector('[data-voice-action="dependencies"]')
 page.locator('#voice-saved').select_option('group-test');page.wait_for_selector('#voice-model-consent',state='attached')
 page.locator('summary',has_text='Transcribe / group speakers').click();page.locator('#voice-model-consent').check()
 before=page.evaluate('DirectorApp.getProject().voiceWorkshops[0].segments')
 page.locator('[data-voice-action="regroup"]').click();page.wait_for_function("DirectorApp.getProject().voiceWorkshops[0].diarized===true")
 after=page.evaluate('DirectorApp.getProject().voiceWorkshops[0]')
 assert [(x['id'],x['text'],x['start'],x['end'],x['keep']) for x in after['segments']]==[(x['id'],x['text'],x['start'],x['end'],x['keep']) for x in before]
 assert after['speakerNames']=={} and after['speakerHistory'][0]['names']['OLD_0']=='Previous label'
 assert after['segments'][0]['speaker']=='SPEAKER_00'
 assert page.evaluate('fixture.voiceActions')==['import','diarize']
 print('PASS regroup-only preserves actual cut text/timing/Keep, resets stale names with history, never calls ASR')
 assert not errors,errors
 print('PASS no page errors; no live AI, Qwen or diarization inference was run')
 browser.close()
