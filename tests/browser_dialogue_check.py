"""Offline Chromium UI regression for 1.0.8. No live providers or WanGP calls.
Uses synthetic project/media and in-memory localStorage/IndexedDB substitutes.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1080});page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="styles.css"[^>]*>','',html)
 page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true");page.add_style_tag(content=(ROOT/'styles.css').read_text())
 page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
 for f in ['core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:
  page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async()=>{
   const p=H3.newProject();p.id='dialogue-browser-fixture';p.name='Phone conversation · regression fixture';p.modelType='fixture';p.presetConfirmed=true;
   p.subjects=[{id:'niko',number:1,name:'Niko',description:'Same street outfit.',assetIds:['ni'],retention:'fully_preserved',speakerId:'S2',voiceAssetId:'nv'},{id:'roman',number:2,name:'Roman',description:'Niko’s cousin.',assetIds:['ri'],retention:'partially_preserved',speakerId:'S1',voiceAssetId:'rv'}];
   p.assets=[{id:'ni',kind:'image',number:1,name:'Niko.png',size:50},{id:'ri',kind:'image',number:2,name:'Roman.png',size:50},{id:'rv',kind:'audio',number:1,name:'Roman.wav',duration:6,size:100},{id:'nv',kind:'audio',number:2,name:'Niko.wav',duration:6,size:100}];
   const w=p.windows[0];w.id='reply';w.title='Shut Up and Hang Up';w.summary='[reference generation] Niko replies and hangs up.';w.frames=140;w.soundscape=H3.LEGACY_DEFAULTS.soundscape;
   w.detail='[Shot 1] Continuation: Niko detonates into the receiver, free hand chopping the air once. He holds the phone away from his ear for the last words, then snaps the flip phone shut with a hard wrist flick and jams it into his pocket. Scowl lingers. Off-screen dialogue: <d>[English] Fuck no Roman! Stop asking and shut the fuck up already!</d>';
   w.subjectIds=['niko'];w.casting={niko:{visibleShots:[1],voiceShots:[1],delivery:'scene',appearance:'Current street outfit.',retention:''}};
   const call=H3.newWindow('Roman’s off-screen call',200,0);call.id='call';call.summary='[reference generation] Niko listens to the caller.';call.soundscape=H3.LEGACY_DEFAULTS.soundscape;
   call.detail="[Shot 1] Niko silently listens to the earpiece. Off-screen dialogue: <d>[English] Niko! My cousin! Let's go bowling.</d>";
   call.subjectIds=['niko','roman'];call.casting={niko:{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Same outfit.',retention:''},roman:{visibleShots:[],voiceShots:[1],delivery:'phone',appearance:'',retention:''}};
   p.windows.push(call);p.jobs=[{id:'historical',status:'completed',createdAt:new Date().toISOString(),plan:[],outputs:[],promptSnapshot:w.detail}];p.audioOrder=['rv','nv'];
   window.initialFixture=H3.clone(p);const blobs=new Map();DirectorStore.getBlob=async k=>blobs.get(k);DirectorStore.putBlob=async(k,v)=>blobs.set(k,v);
   for(const a of p.assets){if(a.kind==='audio')blobs.set(a.id,new Blob([H3Speech.pcmWav(new Float32Array(32000*6),32000)],{type:'audio/wav'}));else{const c=document.createElement('canvas');c.width=c.height=8;blobs.set(a.id,await new Promise(r=>c.toBlob(r)));}}
   window.providerCalls=0;DirectorProviders.init=async()=>false;DirectorProviders.generate=async()=>{providerCalls++;throw Error('No model call permitted in dialogue repair');};DirectorProviders.wangp=async()=>{providerCalls++;throw Error('No render permitted');};DirectorStore.save(p);
 }""")
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp')
 assert page.locator('#field-soundscape').input_value()==''
 assert 'dialogue' in page.locator('#prompt-readiness').inner_text()
 before=page.evaluate('DirectorApp.getProject()')
 # Existing soundscape repair still works in combination with the attribution fix.
 page.locator('[data-action="soundscapes"]').first.click()
 page.locator('summary').filter(has_text='Manual alternative').click()
 page.locator('[data-soundscape-action="scripted-missing"]').click()
 assert page.evaluate('DirectorApp.getProject().windows.every(w=>w.soundscape===H3.SCRIPTED_SOUNDS_ONLY)')
 assert page.evaluate('DirectorApp.getProject().windows[0].detail')==before['windows'][0]['detail']
 print('PASS legacy soundscape migration and explicit scripted-only repair leave speech/timing unchanged')
 sound_fixed=page.evaluate('DirectorApp.getProject()')
 page.locator('[data-action="review-dialogue"]').first.click()
 assert page.locator('[data-dialogue-subject="0"]').input_value()=='niko'
 assert page.locator('[data-dialogue-route="0"]').input_value()=='scene'
 assert page.locator('[data-dialogue-keep="0"]').is_checked()
 assert 'confirm' in page.locator('[data-dialogue-reason="0"]').inner_text().lower()
 page.locator('[data-direction-action="dialogue-preview"]').click()
 preview=page.locator('#dialogue-repair-preview').inner_text()
 assert '<Subject 1> (S2) speaks on screen and says' in preview
 assert 'Off-screen dialogue:' not in preview
 assert '<d>[English] Fuck no Roman! Stop asking and shut the fuck up already!</d>' in preview
 assert page.evaluate('DirectorApp.getProject().windows[0].detail')==sound_fixed['windows'][0]['detail']
 page.screenshot(path=str(ROOT.parent/'screen-dialogue-review-108.png'))
 page.locator('[data-direction-action="dialogue-save"]').click()
 after=page.evaluate('DirectorApp.getProject()')
 assert after['windows'][0]['detail']==sound_fixed['windows'][0]['detail'].replace('Off-screen dialogue: ','<Subject 1> (S2) speaks on screen and says, ')
 for key in ['assets','subjects','settings','jobs','audioOrder']:
  assert after[key]==sound_fixed[key],key
 for key in ['frames','overlap','summary','music','entry','exit','soundscape']:
  assert after['windows'][0][key]==sound_fixed['windows'][0][key],key
 assert after['windows'][1]==sound_fixed['windows'][1]
 print('PASS actual dropdowns/preview/apply repair the screenshot line, without editing words or the rest of the film')
 page.locator('#undo').click();assert page.evaluate('DirectorApp.getProject().windows[0].detail')==sound_fixed['windows'][0]['detail']
 page.locator('#redo').click();assert page.evaluate('DirectorApp.getProject().windows[0].detail')==after['windows'][0]['detail']
 print('PASS one undo/redo restores/reapplies the entire attribution edit')
 page.locator('[data-action="review-dialogue"]').first.click();page.locator('[data-direction-action="dialogue-all"]').click()
 assert not page.locator('[data-dialogue-keep="0"]').is_checked()
 assert page.locator('[data-dialogue-subject="1"]').input_value()=='roman'
 assert page.locator('[data-dialogue-route="1"]').input_value()=='phone'
 assert page.locator('[data-dialogue-keep="1"]').is_checked()
 page.locator('[data-direction-action="dialogue-preview"]').click()
 assert '<Subject 2> (S1) speaks off-screen through the telephone earpiece' in page.locator('#dialogue-repair-preview').inner_text()
 page.locator('[data-direction-action="dialogue-save"]').click()
 assert page.evaluate('H3.dialogueProblems(DirectorApp.getProject()).length')==0
 assert page.evaluate('DirectorApp.getProject().windows[1].casting.roman.visibleShots')==[]
 assert page.evaluate('DirectorApp.getProject().windows[0].detail')==after['windows'][0]['detail']
 print('PASS all-window review preserves the fixed visible speaker and independently assigns the remote caller')
 # Make a deliberate explicit attribution change for preview, then modify the
 # underlying project through undo while the review is open to model a stale UI.
 page.locator('[data-action="review-dialogue"]').first.click()
 page.locator('[data-dialogue-keep="0"]').check()
 page.evaluate("document.getElementById('undo').click()")
 stale=page.evaluate('DirectorApp.getProject()')
 page.locator('[data-direction-action="dialogue-save"]').click()
 assert 'changed' in page.locator('#dialogue-repair-status').inner_text().lower()
 actual_stale=page.evaluate('DirectorApp.getProject()')
 # The debounced autosave may refresh updatedAt while the dialog reports a conflict.
 actual_stale.pop('updatedAt',None);stale.pop('updatedAt',None)
 assert actual_stale==stale
 print('PASS stale review cannot edit a changed project')
 assert page.evaluate('providerCalls')==0
 assert not errors,errors
 print('PASS no model/render calls and no page errors in offline Chromium')
 browser.close()
