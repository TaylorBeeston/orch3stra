# Set-plate UI journey on the same fixture harness as browser_references_check.py.
"""Actual Chromium UI, real PNG decode/blob import; AI/worker are fixtures."""
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
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
 for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async(image)=>{
  const p=H3.newProject();p.name='Reference workshop fixture';p.request='An invented character visits a bowling alley in a different outfit.';
  p.imageSettings={modelType:'qwen_image_21_7B',modelLabel:'Qwen Image 2.1'};
  p.assets=[{id:'portrait-file',number:1,kind:'image',name:'unassigned-portrait.png',type:'image/png',size:200,width:768,height:1344,duration:null,description:'Reference portrait',role:'',transcript:''}];p.counters.image=1;p.windows[0].assetIds=['portrait-file'];p.voiceWorkshops=[{id:'group-test',blobKey:'voice:group-test',name:'Editable dialogue',duration:4,peaks:Array(200).fill(.2),segments:[{id:'cut-one',start:0,end:1,text:'Exact first line.',speaker:'OLD_0',keep:false},{id:'cut-two',start:1.2,end:3.4,text:'Exact second line.',speaker:'OLD_1',keep:true}],speakerNames:{OLD_0:'Previous label'},gap:.05}];
  window.fixture={image,blobs:new Map(),requests:[],submitted:[],jobs:[],polls:0,failImage:false};fixture.blobs.set('portrait-file',await(await fetch(image)).blob());fixture.blobs.set('voice:group-test',new Blob([H3Speech.pcmWav(new Float32Array(32000*4),32000)],{type:'audio/wav'}));fixture.voiceActions=[];
  DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);DirectorStore.save(p);
  const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash';P.config.images=true;
  P.uploadVoice=async()=>({uploadId:'voice-upload'});P.remember=async()=>{};P.call=async(route,b)=>{if(route==='voice'){fixture.voiceActions.push(b.action);if(b.action==='import')return{id:'voice-import',status:'completed',result:{sourceId:'owned-voice'}};if(b.action==='diarize')return{id:'diarize-test',status:'completed',result:{turns:[{start:0,end:1,speaker:'SPEAKER_00'},{start:1.2,end:3.4,speaker:'SPEAKER_01'}],diarized:true,diarizationModel:'nvidia/Nemotron-3-Diarization'}};throw Error('Unexpected voice action '+b.action);}if(route==='studio')return b.action==='list'?{projects:[]}:{credentials:{}};if(route==='sequence'&&b.action==='list')return{runs:[]};throw Error('Unexpected call '+route+' '+b.action);};
  P.generate=async(system,packet,images)=>{fixture.requests.push({system,packet,images});if(system===H3References.SELECTION_SYSTEM)return JSON.stringify({message:'Inspect the first visual batch.',inspectIds:packet.references.slice(0,12).map(a=>a.id)});if(system.includes(H3References.INSPECTION_SYSTEM)){const ids=packet.visualInspection.batchIds,already=packet.visualInspection.alreadyInspectedIds,more=packet.references.map(a=>a.id).filter(id=>!already.includes(id)&&!ids.includes(id)).slice(0,4);return JSON.stringify({message:'Inspected '+ids.length+' references.',notes:[],images:[{title:'Visual batch '+packet.visualInspection.batchIndex,subjectId:packet.subjects[0].id,state:'bowling outfit',purpose:'Reference coverage from this batch',appearance:'',retention:'',referenceIds:[ids[0]],windowIds:[],prompt:'Preserve the identity in <image1> and create a full-body bowling outfit.'}],inspectMoreIds:more});}return JSON.stringify({notes:['First approve one identity anchor. Then make wardrobe variants.'],images:[{title:'Bowling reference portrait',subjectId:packet.subjects[0].id,state:'bowling outfit',purpose:'Missing wardrobe reference',referenceIds:['portrait-file'],windowIds:[],prompt:'Preserve the face and hairstyle from <image1>. Dress this person in a cream bowling shirt in an empty neon bowling alley. One full-length image.'}]});};
  P.upload=async(a,b)=>({media_id:'h3media:'+a.id});P.mediaURL=async()=>image;
  P.wangp=async(path,method,body)=>{if(path==='/health')return{app:'h3-director-wangp',backend:'headless',capabilities:{reference_images:true,reference_image_prompt_mode:'FG'}};if(path==='/image-models')return{models:[{model_type:'qwen_image_21_7B',name:'Qwen Image 2.1'},...(fixture.no2511?[]:[{model_type:'qwen_image_edit_plus2_20B',name:'Qwen Image Edit Plus (2511) 20B'}]),{model_type:'krea2_turbo',name:'Synthetic Krea preset fixture'}]};if(path==='/image-model?model_type=qwen_image_edit_plus2_20B')return{profile:{revision:'synthetic-revision-2511',license_revision:'synthetic-terms-2511',license:'Synthetic fixture terms only',max_references:3,default_steps:30,default_guidance:4,camera_loras:[{id:'multiple-angles-2511',trigger:'<sks>',default_strength:0.9,installed:fixture.loraInstalled!==false}]},image_profiles:[]};if(path.startsWith('/image-model?'))return{profile:{revision:'synthetic-revision-1',license_revision:'synthetic-terms-1',license:'Synthetic fixture terms only',max_references:10},image_profiles:[{id:'viggle-turbo-v0.2.1-6step',name:'Viggle Turbo v0.2.1 · 6 steps',steps:6,guidance:1}]};if(path==='/generate'){fixture.submitted.push(body);const j={job_id:'a'.repeat(32),status:'running',message:'Image fixture',operation:'reference_image',project_id:p.id,request_id:body.request_id,outputs:[]};fixture.jobs.push(j);return j;}if(path==='/queue')return{jobs:fixture.jobs};if(path.startsWith('/jobs/')){fixture.polls++;return fixture.failImage?{...fixture.jobs.at(-1),status:'failed',message:'Headless job failed.',errors:['Synthetic Qwen task failure detail'],outputs:[]}:{...fixture.jobs[0],status:'completed',outputs:[{id:'b'.repeat(32),task_index:1,media_kind:'image',content_type:'image/png',available:true,probe:{width:180,height:240}}]};}throw Error(path);};
 }""",image)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.references')
 # Set plate: button on an image file → editable Image studio card with that file as the source,
# defaulting to Qwen Image Edit 2511 + its Multiple-Angles LoRA (driven by the <sks> line).
 page.locator('#subjects-button').click();page.wait_for_selector('[data-ref="set-plate"]')
 page.locator('[data-ref="set-plate"]').first.click();page.wait_for_selector('#ref-plan [data-card-field="prompt"]')
 card=page.evaluate('DirectorApp.getProject().referencePlans.at(-1).images[0]')
 assert card['referenceIds']==['portrait-file'],card;assert card['prompt'].startswith('<sks> right side view eye-level shot medium shot\nMove the camera'),card['prompt']
 assert page.locator('#ref-size').input_value()=='576x1024'
 assert page.evaluate('fixture.submitted.length')==0,'adding a set-plate card never dispatches'
 print('PASS set-plate button adds one editable 2511 card (<sks> pose line, source first, plate canvas 576x1024) without generating')
 prompt=page.evaluate("H3References.setPlatePrompt('same room seen from its right side',1,{cameraView:'right side view eye-level shot medium shot'})")
 page.locator('#ref-plan [data-card-field="prompt"]').fill(prompt);page.keyboard.press('Tab')
 page.locator('[data-ref="discover"]').click();page.wait_for_function("document.querySelector('#ref-model').value==='qwen_image_edit_plus2_20B'")
 page.wait_for_function("document.querySelector('#ref-steps').value==='30'")
 assert page.locator('#ref-size').input_value()=='576x1024',page.locator('#ref-size').input_value()
 # Qwen 2.1 is still selectable, but a <sks> card on it fails loudly before any upload.
 page.select_option('#ref-model','qwen_image_21_7B');page.wait_for_function("Array.from(document.querySelectorAll('#ref-acceleration-profile option')).some(o=>o.value==='viggle-turbo-v0.2.1-6step')")
 page.locator('#ref-license').check();page.locator('[data-ref="generate"]').click();page.wait_for_function("document.body.textContent.includes('Select that preset')")
 assert page.evaluate('fixture.submitted.length')==0
 # Missing LoRA on the 2511 worker: clear error, nothing submitted.
 page.evaluate('fixture.loraInstalled=false');page.select_option('#ref-model','qwen_image_edit_plus2_20B');page.wait_for_function("document.querySelector('#ref-steps').value==='30'")
 page.locator('#ref-license').check();page.locator('[data-ref="generate"]').click();page.wait_for_function("document.body.textContent.includes('multiple-angles-2511) is not installed')")
 assert page.evaluate('fixture.submitted.length')==0
 print('PASS a <sks> card refuses Qwen 2.1 and a worker without the LoRA, before any upload')
 page.evaluate('fixture.loraInstalled=true');page.select_option('#ref-model','qwen_image_21_7B');page.select_option('#ref-model','qwen_image_edit_plus2_20B');page.wait_for_function("document.querySelector('#ref-steps').value==='30'")
 page.locator('#ref-license').check();page.locator('[data-ref="generate"]').click();page.locator('[data-app-confirm="accept"]').click();page.wait_for_function('fixture.submitted.length===1');page.wait_for_selector('[data-ref="import-image"]')
 task=page.evaluate('fixture.submitted[0].tasks[0]')
 assert task['image_refs']==['h3media:portrait-file'] and task['model_type']=='qwen_image_edit_plus2_20B' and task['resolution']=='576x1024' and task['prompt']==prompt,task
 assert task['camera_lora']=='multiple-angles-2511' and task['camera_lora_strength']==0.9 and task['num_inference_steps']==30 and task['guidance_scale']==4,task
 before=page.evaluate('DirectorApp.getProject().assets.length')
 page.locator('[data-ref="import-image"]').first.click();page.wait_for_function('DirectorApp.getProject().assets.length===%d'%(before+1))
 print('PASS set-plate card dispatches one Qwen Image Edit 2511 task with the Multiple-Angles LoRA (0.9, 30 steps) and the source as image_refs[0], and imports the result')
 assert not errors,errors
 print('PASS no page errors; fixtures only, no live Qwen inference')
 browser.close()
