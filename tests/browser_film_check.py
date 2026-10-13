# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Real Chromium repair/development/refinement/voice/login flows; providers are fixtures."""
import base64, io, json, os, re
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
b=io.BytesIO();Image.new('RGB',(120,140),(85,102,125)).save(b,'PNG')
image='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1460,'height':980});page.set_default_timeout(15000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
 for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async image=>{
 const p=H3.newProject();p.name='Event Horizon · test film';p.request='A reluctant engineer and a crew encounter a black hole.';p.mode='managed';
 p.assets=Array.from({length:12},(_,i)=>({id:'pic-'+(i+1),number:i+1,kind:'image',name:'Reference '+(i+1)+'.png',type:'image/png',size:100,description:'',role:'Identity reference',referenceKind:'character'}));p.counters.image=12;
 p.subjects=[{id:'crew-a',number:1,name:'Crew member A',description:'Composed woman with brown hair.',retention:'fully_preserved',assetIds:p.assets.slice(0,3).map(a=>a.id),referenceVariants:[],speakerId:'S1',voiceAssetId:'',voiceDesign:'Original warm, low female voice, measured and calm.'},{id:'crew-c',number:2,name:'Crew member C',description:'A woman with a short black bob.',retention:'fully_preserved',assetIds:['pic-4'],referenceVariants:[],speakerId:'S2',voiceAssetId:''}];p.counters.subject=2;
 const w=p.windows[0];w.id='window-one';w.title='Engine room';w.subjectIds=['crew-a','crew-c'];w.assetIds=p.assets.slice(4).map(a=>a.id);w.detail='[Shot 1] <Subject 1> studies the panel. Her short black bob drifts as she turns. <Subject 2> remains nearby.';w.summary='[reference generation] A crew at work.';w.soundscape='Low engine hum only.';w.casting={'crew-a':{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Dark blue flight suit, short black bob.',retention:'Retain short black bob.'},'crew-c':{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Olive flight suit, short black bob.',retention:''}};
 p.referenceJobs=[{id:'image-record',jobId:'image-fixture',status:'completed',cards:[{title:'Approved brown hair',subjectId:'crew-a',state:'identity',purpose:'Updated identity',referenceIds:['pic-1'],windowIds:[],prompt:'Brown hair preserving the face.'}],live:{status:'completed',outputs:[{id:'replacement-out',task_index:1,name:'updated.png',media_kind:'image',available:true,probe:{width:120,height:140}}]}}];p.jobs=[];p.variants=[{id:'old-raw',raw:'Original short black bob.'}];p.assets[0].provenance={prompt:'Original short black bob.'};
 window.fixture={image,blobs:new Map(),requests:[],submitted:[],askCount:0,logged:false,oldCatalog:false};for(const a of p.assets)fixture.blobs.set(a.id,await(await fetch(image)).blob());
 fixture.wav=new Blob([H3Speech.pcmWav(new Float32Array(32000*3),32000)],{type:'audio/wav'});fixture.audio=URL.createObjectURL(fixture.wav);
 DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);DirectorStore.save(p);
 const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash';P.config.images=true;P.remember=async()=>{};
 P.call=async(route,b)=>{if(route==='studio')return b.action==='list'?{projects:[]}:{credentials:{}};if(route==='sequence'&&b.action==='list')return{runs:[]};if(route==='codex'){if(b.action==='status')return{account:fixture.logged?{type:'chatgpt',email:'fixture@example.invalid'}:null,cliVersion:fixture.oldCatalog?'codex-cli 0.131.0':'Fixture CLI',binary:'codex'};if(b.action==='start')return{login:{status:'pending',verificationUrl:'https://auth.openai.com/codex/device',userCode:'FIXTURE-CODE'}};if(b.action==='models')return fixture.oldCatalog?{models:[{id:'gpt-5.5',label:'GPT-5.5',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'high',description:'High'}]}]}:{models:[{id:'gpt-6-sol-fixture',label:'GPT 6 Sol fixture',inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'high',description:'High'}]},{id:'hidden-fixture',label:'Hidden fixture',hidden:true,supportedReasoningEfforts:[]}]};}throw Error('Unexpected '+route+' '+b.action);};
 P.mediaURL=async(job,id)=>id==='replacement-out'?fixture.image:fixture.audio;
 P.wangp=async(path,method,body)=>{if(path==='/health')return{app:'h3-director-wangp',backend:'headless',instance:'fixture',capabilities:{reference_voices:true,reference_images:true}};if(path==='/voice-models')return{models:[{model_type:'qwen3_tts_voicedesign',name:'Qwen3 VoiceDesign'}]};if(path==='/generate'){fixture.submitted.push(body);return{job_id:'voice-job',status:'running',outputs:[]};}if(path==='/jobs/voice-job')return{job_id:'voice-job',status:'completed',outputs:[{id:'voice-output',task_index:1,name:'voice.wav',media_kind:'audio',content_type:'audio/wav',available:true,probe:{duration:3}}]};if(path==='/queue')return{jobs:[]};throw Error(path);};
 P.generate=async(system,packet,images)=>{fixture.requests.push({system,packet,images});if(system===H3Film.BOOT_SYSTEM)return JSON.stringify({message:'A cast and outline developed together.',questions:[],characters:[{key:'pilot',name:'Reluctant pilot',description:'A tired mechanic.',kind:'person',voiceDescription:'Low and deliberate.'},{key:'recruiter',name:'Recruiter',description:'An official in a dark suit.',kind:'person',voiceDescription:'Crisp and restrained.'}],beats:[{title:'The offer',seconds:9,summary:'The recruiter offers the mission.',visibleKeys:['pilot','recruiter'],heardKeys:['recruiter'],entry:'Mechanic alone.',exit:'A folder remains.'},{title:'The decision',seconds:9,summary:'He signs.',visibleKeys:['pilot'],heardKeys:[],entry:'He faces the folder.',exit:'Contract signed.'}]});fixture.askCount++;if(fixture.askCount===1)return JSON.stringify({message:'I can change the identity and opening.',questions:['How much exposition should the new opening have?'],patches:[],inserts:[],images:[]});const fs=packet.editableFields.filter(f=>f.key.includes('/crew-a/')&&f.value.includes('black bob'));return JSON.stringify({message:'Proposed brown-hair update for A only. Existing images require approval of a replacement.',questions:[],replacements:fs.map(f=>({key:f.key,find:'short black bob',replace:'brown hair',count:1})),patches:[],inserts:[],images:[{title:'A brown hair anchor',subjectId:'crew-a',state:'blue flight suit',purpose:'Replace outdated hairstyle reference',referenceIds:['pic-1'],windowIds:[],prompt:'Preserve face from <image1> but use brown hair swept back. Blue flight suit.'}]});};
 }""",image)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.film')
 page.locator('[data-action="collapse-library"]').click();page.wait_for_timeout(100)
 main=page.locator('main.main').bounding_box();assert main['width']>500,main
 print('PASS collapsing the desktop library retains a visible main editor')
 # Cast source checkbox edits opt into custom sources automatically.
 page.locator('[data-action="direction-cast"]').first.click();row=page.locator('[data-cast-row="crew-a"]')
 assert row.locator('[data-cast-source="pic-2"]').is_visible()
 row.locator('[data-cast-source="pic-2"]').uncheck();assert row.locator('[data-cast-sources-custom]').is_checked()
 page.locator('[data-direction-action="cast-save"]').click()
 assert page.evaluate('DirectorApp.getProject().windows[0].casting["crew-a"].sourceAssetIds')==['pic-1','pic-3']
 page.locator('[data-action="direction-cast"]').first.click();assert not page.locator('[data-cast-row="crew-a"] [data-cast-source="pic-2"]').is_checked()
 page.locator('[data-direction-action="cast-save"]').click()
 print('PASS subject checkbox changes persist through save/reopen, without needing a separate custom switch')
 page.evaluate('DirectorApp.clinic.pool("window-one")');page.wait_for_selector('[data-pool-image="pic-12"]')
 page.locator('[data-pool-image="pic-12"]').uncheck();page.locator('[data-pool-image="pic-11"]').uncheck()
 assert '9 / 9' in page.locator('#clinic-pool-count').inner_text()
 page.locator('[data-clinic="save-pool"]').click();assert page.evaluate('DirectorApp.getProject().assets.length')==12
 assert page.evaluate('H3.pool(DirectorApp.getProject(),DirectorApp.getProject().windows[0]).length')==9
 print('PASS actual per-task budget reduced without deleting a single source')
 # Field jump + repair retains source originals.
 page.evaluate('DirectorApp.clinic.field("window/window-one/detail")');page.locator('#clinic-field').fill('[Shot 1] <Subject 1> studies the panel; <Picture 99> anchors the shot.')
 page.locator('[data-clinic="save-field"]').click();page.locator('#clinic-search').fill('Picture 99')
 page.locator('[data-clinic="issue"]').first.click();assert '<Picture 99>' in page.locator('#clinic-field').input_value()
 page.locator('#clinic-field').fill('[Shot 1] <Subject 1> studies the panel; <Picture 1> anchors the shot.')
 page.locator('[data-clinic="save-field"]').click();assert '<Picture 99>' not in page.evaluate('DirectorApp.compile()')
 print('PASS invalid-reference issue opens its exact editable field and can be repaired')
 old=page.evaluate('DirectorApp.getProject()');page.evaluate('DirectorApp.film.focusSubject("crew-a")');page.locator('#film-message').fill('Actually make Crew member A brown-haired, and add normal-life exposition before the mission.')
 page.locator('[data-film="ask"]').click();page.wait_for_function('DirectorApp.getProject().directorChat?.length===2')
 assert 'How much exposition' in page.locator('#dialog').inner_text();assert page.evaluate('DirectorApp.getProject().directorProposal||null') is None
 assert page.evaluate('fixture.requests.at(-1).packet.fieldCharacterBudget')==190000
 page.locator('#film-message').fill('About 20 seconds. For now just fix A and prepare a replacement image.')
 page.evaluate('DirectorProviders.config.provider="codex";DirectorProviders.config.model="gpt-6-sol-fixture"')
 page.locator('[data-film="ask"]').click();page.wait_for_function('DirectorApp.getProject().directorProposal?.status==="review"')
 assert page.evaluate('fixture.requests.at(-1).packet.conversation.length')==2
 assert page.evaluate('fixture.requests.at(-1).packet.fieldCharacterBudget')==2000000
 page.evaluate('DirectorProviders.config.provider="deepseek";DirectorProviders.config.model="deepseek-flash"')
 page.locator('#dialog [data-film="review"]').click();page.locator('[data-film="apply"]').click()
 p=page.evaluate('DirectorApp.getProject()');assert p['windows'][0]['casting']['crew-a']['appearance'].endswith('brown hair.')
 assert p['windows'][0]['casting']['crew-c']==old['windows'][0]['casting']['crew-c'];assert p['variants']==old['variants'];assert p['assets']==old['assets'];assert len(p['referencePlans'])==1;assert page.evaluate('fixture.submitted.length')==0
 print('PASS conversational clarification, scoped identity edits, staged image plan, history untouched and no GPU submission')
 # Portrait guided desk and keyboard-height viewport.
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(ROOT.parent/'screen-film-phone-150.png'))
 page.set_viewport_size({'width':390,'height':460});page.locator('#film-message').fill('Continue after I review the images.');page.locator('#dialog [data-film="ask"]').scroll_into_view_if_needed();assert page.locator('#dialog [data-film="ask"]').bounding_box()['y']<460
 page.set_viewport_size({'width':1460,'height':980});page.screenshot(path=str(ROOT.parent/'screen-film-desktop-150.png'))
 # Approve a replacement image: source bindings and tags change together, originals survive.
 page.evaluate('DirectorApp.references.studio()');page.wait_for_selector('[data-ref="replace-image"]',state='attached')
 page.locator('summary',has_text='Replace an existing identity').click();page.locator('[data-replace-source="replacement-out"]').select_option('pic-1');page.locator('[data-ref="replace-image"]').click()
 page.wait_for_function('DirectorApp.getProject().assets.length===13')
 replaced=page.evaluate('DirectorApp.getProject()');new=next(a for a in replaced['assets'] if a.get('provenance',{}).get('outputId')=='replacement-out')
 assert replaced['subjects'][0]['assetIds'][0]==new['id'];assert '<Picture '+str(new['number'])+'>' in replaced['windows'][0]['detail']
 assert next(a for a in replaced['assets'] if a['id']=='pic-1')['provenance']==old['assets'][0]['provenance']
 print('PASS reviewed generated-image replacement rebinds live tags/defaults, preserves original pixels/provenance')
 # Real audio decode/accept, with synthesized output fixture.
 page.evaluate('DirectorApp.voiceStudio.open()');page.locator('[data-voice-design="discover"]').click();page.wait_for_function('document.querySelector("#voice-design-model").value==="qwen3_tts_voicedesign"')
 page.locator('[data-voice-subject="crew-c"]').uncheck();page.locator('[data-voice-design="generate"]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.submitted.length===1');page.wait_for_selector('[data-voice-design="accept"]',timeout=15000)
 page.locator('[data-voice-design="accept"]').click();page.wait_for_function('!!DirectorApp.getProject().subjects[0].voiceAssetId')
 p=page.evaluate('DirectorApp.getProject()');voice=next(a for a in p['assets'] if a['id']==p['subjects'][0]['voiceAssetId']);assert voice['kind']=='audio' and voice['duration']==3;assert voice['provenance']['kind']=='generated-voice'
 print('PASS explicit native voice submission, actual WAV audition decoding, approval and character binding')
 page.evaluate('DirectorApp.codex.show()');page.locator('[data-codex="login"]').click();page.wait_for_selector('#codex-user-code');assert page.locator('#codex-user-code').input_value()=='FIXTURE-CODE'
 page.locator('[data-codex="models"]').click();page.wait_for_function('document.querySelector("#codex-model").options.length===1');page.locator('#codex-hidden').check();assert page.locator('#codex-model option').count()==2
 page.locator('#codex-model').select_option('gpt-6-sol-fixture');page.locator('#codex-effort').select_option('high');page.locator('[data-codex="choose"]').click();assert page.evaluate('DirectorProviders.config.reasoningEffort')=='high'
 print('PASS device-code login UI, dynamic actual-catalog fixture, hidden filter and reasoning-effort selection')
 page.evaluate('fixture.logged=true;fixture.oldCatalog=true');page.evaluate('DirectorApp.codex.show()')
 page.wait_for_function('document.querySelector("#codex-model").options.length===1&&document.querySelector("#codex-model").options[0].value==="gpt-5.5"')
 assert '0.156.1' in page.locator('#codex-cli-warning').inner_text()
 print('PASS Codex picker refreshes on open and identifies the old CLI blocking GPT-6 catalog entries')
 # Joint development produces new cast even from current old film; doesn't mutate source.
 before=page.evaluate('DirectorApp.getProject()');page.evaluate('DirectorApp.film.outline()');page.locator('[data-film="outline-send"]').click();page.wait_for_selector('[data-film="outline-apply"]')
 page.locator('[data-film="outline-apply"]').click();after=page.evaluate('DirectorApp.getProject()');assert after['id']!=before['id'];assert [s['name'] for s in after['subjects']]==['Reluctant pilot','Recruiter'];assert after['subjects'][1]['speakerId']=='S1'
 assert page.evaluate('(DirectorStore.load("'+before['id']+'")).subjects[0].name')=='Crew member A'
 assert len(after['windows'])==2 and after['windows'][0]['detail']=='' and after['windows'][0]['soundscape']==''
 print('PASS cast-and-outline generation together, actual new copy, speaker first-heard ordering, unfinished drafts blocked')
 assert not errors,errors
 browser.close();print('PASS no browser page errors; all AI and GPU responses were explicit test fixtures')
