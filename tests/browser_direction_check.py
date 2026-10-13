"""Offline real Chromium interaction; planner/network/storage are controlled fixtures.
Exercises new cast/routing/pacing controls and a >15-second audio selection.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
 page=browser.new_page(viewport={'width':1600,'height':1000});page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 page.route('http://127.0.0.1:19872/**',lambda route:route.fulfill(status=200,body='<html></html>',content_type='text/html'));page.goto('http://127.0.0.1:19872/');page.evaluate("window.H3_NATIVE_CONFIRM=true")
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="styles.css"[^>]*>','',html)
 page.set_content(html);page.add_style_tag(content=(ROOT/'styles.css').read_text())
 page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
 for f in ['core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:
  page.add_script_tag(content=(ROOT/f).read_text())
 project=json.loads((ROOT/'tests/fixtures/phone-project.json').read_text())
 page.evaluate("""async p=>{window.testBlobs=new Map();const realPut=DirectorStore.putBlob,realGet=DirectorStore.getBlob;DirectorStore.putBlob=async(k,b)=>{testBlobs.set(k,b);await realPut(k,b)};DirectorStore.getBlob=async k=>testBlobs.get(k)||await realGet(k);for(const a of p.assets){if(a.kind==='audio'){const samples=new Float32Array(32000*a.duration);testBlobs.set(a.id,new Blob([H3Speech.pcmWav(samples,32000)],{type:'audio/wav'}));}else{const c=document.createElement('canvas');c.width=c.height=8;testBlobs.set(a.id,await new Promise(r=>c.toBlob(r)));}}DirectorStore.save(p);} """,project)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp')
 # The legacy phone fixture deliberately contains old helper values. Repair these
 # unrelated fields explicitly before asserting ready-to-submit task compilation.
 assert page.locator('#field-soundscape').input_value()==''
 for w in project['windows']:
  page.evaluate('id=>DirectorApp.select(id)',w['id'])
  page.locator('#field-summary').fill('[reference generation] '+w['title'])
  page.locator('#field-soundscape').fill('Light rain and distant road noise.')
 page.evaluate('id=>DirectorApp.select(id)',project['windows'][0]['id'])

 page.locator('[data-action="direction-cast"]').first.click();assert page.locator('[data-cast-reviewed]:checked').count()==0
 page.locator('[data-direction-action="visible-all"][data-cast-id="niko"]').click()
 roman=page.locator('[data-cast-row="roman"]');roman.locator('[data-cast-heard="2"]').check();roman.locator('[data-cast-delivery]').select_option('phone')
 niko=page.locator('[data-cast-row="niko"]');niko.locator('summary').filter(has_text='Window-local appearance & retention').click();niko.locator('[data-cast-appearance]').fill('Niko wears his flat cap, glasses, olive scarf and brown leather jacket, from <Picture 1>.');niko.locator('[data-cast-retention]').fill('Same face and street outfit.')
 page.locator('[data-direction-action="cast-preview"]').first.click();preview=page.locator('#cast-preview').inner_text()
 assert '<Subject 2> (appears' not in preview
 assert 'speaks off-screen through the telephone earpiece' in preview
 assert 'Niko) listens without speaking' in preview
 assert 'finale' not in preview
 page.screenshot(path=str(ROOT.parent/'screen-cast-1.0.6.png'))
 page.locator('[data-direction-action="cast-save"]').click()
 assert page.evaluate('DirectorApp.getProject().windows[0].casting.roman.voiceShots')==[2]
 print('PASS real cast controls independently set visibility/heard shots, phone routing and local appearance, with compiled preview')
 page.locator('[data-action="voice-routing"]').first.click()
 assert page.locator('[data-route-speaker="niko"]').input_value()=='S2'
 assert page.locator('[data-route-speaker="roman"]').input_value()=='S1'
 page.locator('[data-direction-action="audio-up"][data-audio-id="niko-voice"]').click()
 page.locator('[data-direction-action="routes-save"]').click()
 # Native linked references cannot vary safely per window. Assert the guard, then
 # explicitly compile independent tasks rather than weakening production safety.
 assert page.evaluate("()=>{try{H3.tasks(DirectorApp.getProject());return false}catch(e){return /Native linked audio references/.test(e.message)}}")
 assert page.evaluate("()=>{const p=H3.clone(DirectorApp.getProject());p.mode='independent';return H3.tasks(p)[0].audio_guide}")=='roman-voice'
 assert '<Audio 1> is the voice-timbre reference for <Subject 2> (S1)' in page.evaluate("()=>{const p=H3.clone(DirectorApp.getProject());p.mode='independent';return JSON.stringify(H3.compileSections(p,p.windows[0],0))}")
 print('PASS input slot reorder preserves subject/voice associations and remaps actual H3 text/files together')
 page.evaluate("""()=>{DirectorProviders.config.model='fixture-planner';DirectorProviders.generate=async(system,packet,images)=>{if(!system.includes('natural pacing'))throw Error('Wrong planner instructions');if(packet.constraints.maximumSeconds!==null)throw Error('Invented runtime constraint');if(images.length)throw Error('Pacing unexpectedly uploaded media');return JSON.stringify({title:'A natural call',rationale:'Time for the call, the reply, and reactions; no padding.',beats:[{title:'Call',seconds:9,reason:'Ring and invitation.',action:'Niko answers and listens.',entry:'Walking.',exit:'Listening.',visibleSubjectIds:['niko'],heardSubjectIds:['roman'],deliveryBySubject:{roman:'phone'},dialogueIds:['line-1'],hardCut:true},{title:'Reply',seconds:6,reason:'Short response.',action:'Niko replies.',entry:'Listening.',exit:'Phone lowered.',visibleSubjectIds:['niko'],heardSubjectIds:['niko'],deliveryBySubject:{niko:'scene'},dialogueIds:['line-2'],hardCut:false}]});};} """)
 old=page.evaluate('DirectorApp.getProject()')
 page.locator('[data-action="scaffold"]').first.click();page.locator('[data-action="natural-length"]').click()
 assert page.locator('#pacing-max').input_value()==''
 page.locator('[data-direction-action="pacing-generate"]').click();page.wait_for_selector('[data-pacing-seconds="0"]')
 page.locator('[data-pacing-seconds="0"]').fill('8');page.locator('[data-pacing-seconds="0"]').press('Tab')
 assert 'windows' in page.locator('#pacing-summary').inner_text()
 page.screenshot(path=str(ROOT.parent/'screen-pacing-1.0.6.png'))
 page.locator('[data-direction-action="pacing-apply"]').click();page.wait_for_function('DirectorApp.getProject().name.includes("pacing copy")')
 assert page.evaluate('DirectorApp.getProject().id')!=old['id']
 assert page.evaluate('id=>DirectorStore.load(id).windows[0].frames',old['id'])==old['windows'][0]['frames']
 assert page.evaluate('DirectorApp.getProject().jobs.length')==0
 assert "Niko! My cousin! Let's go bowling." in page.evaluate('DirectorApp.compile()')
 print('PASS one mocked AI pacing request proposes/edits duration and forks project without changing original rendered timing or dialogue')
 # A long archive is allowed; actual model conditioning limits are explicit elsewhere.
 p=page.evaluate('DirectorApp.getProject()');p['voiceWorkshops']=[{'id':'long-source','blobKey':'voice:long-source','name':'Long usable voice source','duration':30,'peaks':[.2]*300,'gap':0,'segments':[{'id':'long-cut','start':0,'end':20,'text':'A long source selection.','speaker':'VOICE_A','keep':True}]}]
 page.evaluate("""()=>testBlobs.set('voice:long-source',new Blob([H3Speech.pcmWav(new Float32Array(32000*30),32000)],{type:'audio/wav'}))""")
 portable=page.evaluate('async p=>DirectorStore.portable(p)',p)
 page.locator('#project-import').set_input_files({'name':'long-fixture.h3project','mimeType':'application/json','buffer':json.dumps(portable).encode()});page.wait_for_function('DirectorApp.getProject().voiceWorkshops.length===1')
 page.locator('[data-action="voice-workshop"]').first.click();page.locator('#voice-saved').select_option(page.evaluate('DirectorApp.getProject().voiceWorkshops[0].id'));page.wait_for_selector('#voice-export')
 assert not page.locator('#voice-export').is_disabled()
 assert '15s combined' in page.locator('#dialog-body').inner_text()
 with page.expect_download() as download:page.locator('[data-voice-action="archive"]').click()
 path=download.value.path();assert Path(path).stat().st_size>32000*19*2
 page.locator('#voice-fit-seconds').fill('10');page.locator('[data-voice-action="limit"]').click()
 assert '10.00 seconds kept' in page.locator('#voice-total').inner_text()
 assert page.evaluate('DirectorApp.getProject().voiceWorkshops[0].duration')==30
 print('PASS >15s source selection stays editable/exportable; custom fit budget changes cuts but preserves original source')
 assert not errors,errors
 print('PASS offline Chromium direction workflow with no page errors. Planner and storage were fixtures; no paid/GPU work.')
 browser.close()
