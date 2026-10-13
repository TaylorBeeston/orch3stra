# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Offline Chromium workflow for scene coverage, doctor, and bounded agent UI.
Actual DOM/image decoding/transactions. Planner and worker HTTP are fixtures.
"""
import base64, io, json, os, re
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
b=io.BytesIO();Image.new('RGB',(144,96),(81,103,134)).save(b,'PNG');image='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1460,'height':1020});page.set_default_timeout(15000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
 for f in ['styles.css','studio.css','editor.css','film.css','scene.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async image=>{
 const p=H3.newProject();p.id='browser-reference';p.name='Ensemble · reference planning';p.request='Three adults examine a navigation console in the ship cabin.';p.mode='managed';p.assets=Array.from({length:14},(_,i)=>({id:'pic-'+i,number:i+1,kind:'image',name:i<12?'Character '+(Math.floor(i/4)+1)+' · view '+(i%4+1)+'.png':i===12?'Cabin layout.png':'Navigation console.png',type:'image/png',size:120,description:'Approved source',role:'',missing:false}));p.subjects=Array.from({length:3},(_,i)=>({id:'person-'+i,number:i+1,name:['Pilot','Engineer','Navigator'][i],kind:'person',description:'An adult in a plain flight suit.',assetIds:p.assets.slice(i*4,i*4+4).map(a=>a.id),referenceVariants:[],speakerId:'S'+(i+1),voiceAssetId:''}));p.assets[12].referenceKind='scene';p.assets[13].referenceKind='prop';p.counters.image=14;p.counters.subject=3;p.windows=[0,1].map(i=>({...H3.newWindow('Cabin · '+(i+1)+'/2',209,i?18:0),id:'window-'+i,subjectIds:p.subjects.map(s=>s.id),assetIds:['pic-12','pic-13'],casting:Object.fromEntries(p.subjects.map(s=>[s.id,{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Flight suit.',retention:''}])),detail:'[Shot 1] [Shot 1] The three crew members study the navigation console.',summary:'[reference generation] A quiet discussion of the route.',soundscape:'A low ventilation hum.',music:'N/A'}));p.jobs=[{id:'history-record',snapshot:{prompt:'Original request'}}];p.imageSettings={modelType:'qwen_image_21_7B',modelLabel:'Qwen Image 2.1 fixture',resolution:'1024x1024',steps:20,guidance:4};p.referenceAutomation={...H3ReferenceAgent.defaults};
 window.fixture={p,image,blobs:new Map(),calls:[],runs:new Map(),drafts:0};for(const a of p.assets)fixture.blobs.set(a.id,await(await fetch(image)).blob());
 DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);await DirectorStore.save(p);
 const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash-fixture';P.config.images=true;P.getStudioBlob=async id=>fixture.blobs.get(id);P.studioBlob=async(id,b)=>fixture.blobs.set(id,b);
 P.call=async(route,b)=>{fixture.calls.push({route,b});if(route==='studio'){if(b.action==='blob-info')return{info:{size:120}};if(b.action==='list')return{projects:[]};return{credentials:{}};}if(route==='sequence'&&b.action==='list')return{runs:[]};if(route==='reference-agent'){
  if(b.action==='list')return{runs:[...fixture.runs.values()]};if(b.action==='get'||b.action==='result')return fixture.runs.get(b.id);if(b.action==='prepare-sequence')return{configured:true};
  if(b.action==='start'){const id='agent-fixture-'+fixture.runs.size,q=H3.clone(b.project),asset={id:'generated-'+fixture.runs.size,number:0,name:'Reviewed profile.png',kind:'image',type:'image/png',size:120,width:144,height:96,description:'Approved profile coverage.',role:'angle',referenceKind:'character',referenceState:'',missing:false,provenance:{kind:'reference-agent',agentId:id,jobId:id+'-gpu',outputId:id+'-output'}};fixture.blobs.set(asset.id,await(await fetch(image)).blob());H3References.applyGenerated(q,asset,{subjectId:'person-0',state:'',windowIds:b.windowIds},false);H3Scenes.annotate(q,asset.id,{subjectIds:['person-0'],roles:['identity','angle'],states:[],angles:['profile'],approved:true,quality:3});for(const wid of b.windowIds){H3Scenes.addToScene(q,wid,asset.id);const w=q.windows.find(w=>w.id===wid);H3Scenes.applyManifest(q,H3Scenes.resolve(q,w));}
   const run={id,projectId:q.id,name:q.name,status:'completed',phase:'finished',index:b.windowIds.length,total:b.windowIds.length,windowIds:b.windowIds,project:q,sourceStamp:H3Doctor.stamp(b.project),policy:b.policy,usage:{calls:3,images:1},events:[{at:new Date().toISOString(),message:'Inspected actual candidate in fixture.'}],candidates:[{id:asset.id,name:asset.name,status:'accepted',review:{reason:'Candidate pixels provided by the fixture.',scores:{identity:1,state:1,clarity:1,composition:1,noExtraPeople:1}}}],message:'Reference preparation completed.'};fixture.runs.set(id,run);return run;}
  return fixture.runs.get(b.id);
 }throw Error('Unexpected '+route+' '+b.action);};
 P.wangp=async path=>path==='/image-models'?{models:[{model_type:'qwen_image_21_7B',name:'Qwen 2.1 fixture'}]}:{jobs:[]};
 P.generate=async(system,packet)=>{fixture.calls.push({system,packet});if(system===H3Doctor.SYSTEM){const ops=H3Doctor.safeFormatting(DirectorApp.getProject(),['window-0']).operations;return JSON.stringify({message:'Normalize the duplicated shot marker.',operations:ops});}fixture.drafts++;return JSON.stringify({notes:['Fixture draft'],subjects:[],windows:packet.windows.map(w=>({...w,detail:'[Shot 1] The three crew members calmly study the navigation console.',referenceRequests:[]}))});};
 }""",image)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.scene')
 page.locator('#scene-board-button').click();page.locator('[data-scene-action="group"]').click();page.locator('[data-scene-action="apply-groups"]').click()
 page.wait_for_selector('.scene-bank');assert page.locator('.scene-asset').count()==14
 assert 'Now: 14/9' in page.locator('.scene-metrics').inner_text();assert 'Proposed task: 5/9' in page.locator('.scene-metrics').inner_text()
 page.locator('#scene-asset-search').fill('Navigation');assert page.locator('.scene-asset:visible').count()==1;page.locator('#scene-asset-search').fill('');
 original=page.evaluate('DirectorApp.getProject()');sid=original['referenceBoard']['scenes'][0]['id']
 page.locator('[data-pin="pic-2"]').click();page.locator('[data-scene-action="optimize"]').click();page.wait_for_selector('[data-scene-action="apply-doctor"]')
 assert page.locator('[data-scene-action="apply-doctor"]').evaluate("el => !el.disabled");page.locator('[data-scene-action="apply-doctor"]').click()
 assert page.evaluate('H3.pool(DirectorApp.getProject(),DirectorApp.getProject().windows[0]).filter(a=>a.kind==="image").length')==5
 assert 'pic-2' in page.evaluate('DirectorApp.getProject().windows[0].casting["person-0"].sourceAssetIds')
 assert page.evaluate('DirectorApp.getProject().assets')==original['assets'];assert page.evaluate('DirectorApp.getProject().jobs')==original['jobs']
 print('PASS scene grouping, 14-image bank, coverage selection, explicit pins, one-transaction apply and preserved sources/history')
 page.locator('#dialog [data-scene-tab="board"]').click();page.locator('.scene-matrix-box summary').click();assert page.locator('.scene-matrix-scroll tr').count()==4
 page.evaluate("document.querySelector('#dialog-body').scrollTop=0");page.screenshot(path=str(ROOT.parent/'screen-scene-board-desktop-160.png'))
 page.locator('#dialog [data-scene-tab="doctor"]').click();page.locator('[data-scene-action="safe"]').click();page.locator('[data-scene-action="apply-doctor"]').click()
 assert page.evaluate('DirectorApp.getProject().windows[0].detail').count('[Shot 1]')==1
 print('PASS grouped Clinic doctor mechanical preview/application preserves the scene and dialogue')
 # Reference choices stay pinned; unpinning is explicit. Voice/cast management remains separate.
 page.locator('#dialog [data-scene-tab="board"]').click();page.locator('[data-scene-action="requirement"]').click();page.locator('#need-description').fill('A clear profile of the pilot for the console view.');page.locator('#need-subject').select_option('person-0');page.locator('#need-role').select_option('angle');page.locator('#need-angle').fill('profile');page.locator('[data-scene-action="save-requirement"]').click()
 assert 'Missing' in page.locator('.scene-requirements').inner_text()
 page.locator('#dialog [data-scene-tab="agent"]').click();page.locator('#agent-enabled').check();page.locator('#agent-mode').select_option('autonomous');page.locator('[data-agent-flag="allowImages"]').check();page.locator('[data-agent-flag="beforeRender"]').check();page.locator('[data-agent-flag="allowFrames"]').check();page.locator('#agent-license').check();page.locator('[data-scene-action="save-policy"]').click()
 assert page.evaluate('DirectorApp.getProject().referenceAutomation.allowFrames') is True
 page.locator('[data-scene-action="start-agent"]').click();page.wait_for_selector('[data-agent-apply]')
 assert page.evaluate('fixture.calls.some(x=>x.route==="reference-agent"&&x.b.action==="start"&&x.b.consent===true)')
 jobs_before_agent=page.evaluate('DirectorApp.getProject().jobs');page.locator('[data-agent-apply]').first.click();page.wait_for_function('DirectorApp.getProject().assets.length===15');assert page.evaluate('H3Scenes.resolve(DirectorApp.getProject(),DirectorApp.getProject().windows[0]).ready')
 assert page.evaluate('DirectorApp.getProject().jobs')==jobs_before_agent
 print('PASS explicit autonomous permissions, saved policy, generated-source import, exact source revision and unchanged takes')
 # Portrait workbench and viewport shrinking do not hide the action controls.
 page.set_viewport_size({'width':390,'height':844});page.locator('#dialog [data-scene-tab="agent"]').click();page.locator('[data-scene-action="save-policy"]').scroll_into_view_if_needed();assert page.locator('[data-scene-action="save-policy"]').is_visible()
 page.screenshot(path=str(ROOT.parent/'screen-reference-agent-phone-160.png'))
 page.set_viewport_size({'width':390,'height':460});page.locator('#agent-instruction').fill('Preserve the approved people. Only request useful new coverage.');page.locator('[data-scene-action="save-policy"]').click();assert page.locator('#dialog').is_visible()
 print('PASS portrait and keyboard-sized workbench controls remain reachable')
 # Draft remains staged. Actual prepared source changes arrive only when the proposal is applied.
 page.set_viewport_size({'width':1460,'height':1020});page.locator('[data-action="close-dialog"]').click();page.locator('#ai-scope').select_option('selected');page.locator('#generate-button').click();page.wait_for_function('DirectorApp.getProject().variants?.some(v=>v.status==="ready"||v.status==="needs-review")',timeout=20000)
 assert page.evaluate('DirectorApp.getProject().assets.length')==15
 jobs_before_draft=page.evaluate('DirectorApp.getProject().jobs')
 page.locator('[data-apply-variant]').first.click();page.wait_for_function('DirectorApp.getProject().assets.length===16');assert page.evaluate('DirectorApp.getProject().jobs')==jobs_before_draft;assert page.evaluate('DirectorApp.getProject().counters.image===Math.max(...DirectorApp.getProject().assets.map(a=>a.number))')
 print('PASS after-draft reference preparation stages image changes and applies them with the draft, not before approval')
 # Authored prompts cannot be cloned automatically. Empty scaffolds may split.
 before_split=page.evaluate('JSON.stringify(DirectorApp.getProject().windows)');page.locator('[data-action="split"]').first.click();assert page.evaluate('JSON.stringify(DirectorApp.getProject().windows)')==before_split
 page.locator('#field-summary').fill('');page.locator('#field-detail').fill('')
 # Splitting the deliberately emptied scaffold keeps stable scene membership.
 page.locator('[data-action="split"]').first.click();p=page.evaluate('DirectorApp.getProject()');assert len(p['referenceBoard']['scenes'][0]['windowIds'])==3;assert p['referenceBoard']['scenes'][0]['id']==sid
 page.locator('#scene-board-button').click();page.wait_for_selector('.scene-bank');page.screenshot(path=str(ROOT.parent/'screen-scene-board-final-160.png'))
 assert not errors,errors
 print('PASS stable scene membership after splitting and no browser errors')
 browser.close()
