# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Offline real Chromium DOM/image workflow; model/renderer/storage transports are fixtures."""
import base64,io,json,os,re
from pathlib import Path
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
im=Image.new('RGB',(480,320),'#172934');d=ImageDraw.Draw(im);d.rectangle((160,80,320,290),fill='#21477c');d.ellipse((195,25,280,105),fill='#cbb397');d.text((24,297),'Synthetic wardrobe test',fill='white');b=io.BytesIO();im.save(b,'PNG');image='data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1040});page.set_default_timeout(18000);errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
 for f in re.findall(r'<link[^>]*href="([^"]+\.css)"',(ROOT/'index.html').read_text()):page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async image=>{
 const p=H3.newProject();p.id='coverage-browser';p.name='Reference workflow · test scene';p.mode='managed';p.subjects=[{id:'captain',number:1,name:'Captain',description:'Adult in a blue shirt.',kind:'person',assetIds:['anchor'],speakerId:'S1',voiceAssetId:'',referenceVariants:[]}];p.assets=[{id:'anchor',kind:'image',number:1,name:'Captain blue shirt.png',type:'image/png',size:120,referenceState:'everyday outfit',missing:false}];p.windows=[{...H3.newWindow('Bridge · waiting for news',209,0),id:'bridge-window',subjectIds:['captain'],assetIds:[],casting:{captain:{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Navy blue shirt.',retention:'Keep the same face.'}},summary:'[reference generation] The captain studies the horizon.',detail:'[Shot 1] The captain studies the distant horizon using <Picture 1>.',soundscape:'Quiet wind.',music:'N/A',referencePolicy:{pins:['anchor'],states:{captain:'navy blue shirt'},requirements:[{id:'locked-wardrobe',role:'wardrobe',subjectId:'captain',state:'navy blue shirt',assetIds:['anchor'],description:'This source is explicitly required for the navy shirt.'}]}}];p.imageSettings={modelType:'qwen_image_21_7B',modelLabel:'Qwen 2.1 fixture',resolution:'1024x1024',steps:20,guidance:4};H3Scenes.setScenes(p,H3Scenes.suggestScenes(p));
 window.fixture={blobs:new Map(),runs:new Map(),calls:[],image,mode:'old',tick:0};fixture.blobs.set('anchor',await(await fetch(image)).blob());DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);await DirectorStore.save(p);
 const q=H3.normalizeProject(p),r={id:'agent-old',projectId:q.id,name:q.name,status:'needs_review',phase:'starting',index:0,total:1,windowIds:q.windows.map(w=>w.id),project:q,sourceStamp:H3Doctor.stamp(q),policy:{...H3ReferenceAgent.defaults,enabled:true,allowImages:false,mode:'review'},imageSettings:q.imageSettings,usage:{calls:1,images:0},events:[],candidates:[],message:'A pinned or explicitly named image is missing, excluded, unapproved, or in a conflicting state.'};fixture.runs.set(r.id,r);
 const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash-fixture';P.config.images=true;P.getStudioBlob=async id=>fixture.blobs.get(id);P.studioBlob=async(id,b)=>fixture.blobs.set(id,b);
 P.wangp=async path=>path==='/image-models'?{models:[{model_type:'qwen_image_21_7B',name:'Qwen 2.1 fixture'}]}:{jobs:[]};
 P.call=async(route,b)=>{fixture.calls.push({route,b});if(route==='studio')return b.action==='list'?{projects:[]}:b.action==='blob-info'?{info:{size:120}}:{credentials:{}};if(route==='sequence')return{runs:[]};if(route==='reference-agent'){
  if(b.action==='list')return{runs:[...fixture.runs.values()]};let r=fixture.runs.get(b.id);
  if(b.action==='diagnose'){const m=H3Scenes.resolve(r.project,r.project.windows[0]);return{...r,blockers:r.status==='completed'?[]:m.issues.map(i=>({...i,sourceStamp:m.sourceStamp}))};}
  if(b.action==='get'||b.action==='result')return r;
  if(b.action==='repair-conflict'){H3Scenes.repairConflict(r.project,r.project.windows[0],b.operation);const m=H3Scenes.resolve(r.project,r.project.windows[0]);r.blockers=m.issues.map(i=>({...i,sourceStamp:m.sourceStamp}));return r;}
  if(b.action==='authorize'){r.policy=b.policy;r.application={autoApply:b.autoApply,status:'pending'};return r;}
  if(b.action==='resume'){r.status='running';r.phase='checking_coverage';r.message='Inspecting the approved existing image.';r.updatedAt='tick'+(++fixture.tick);return r;}
  if(b.action==='ack-applied'){r.application.autoApply=false;return r;}
  if(b.action==='cancel'){r.status='cancelled';return r;}
  if(b.action==='start'){const q=H3.clone(b.project),id='agent-new';r={id,projectId:q.id,name:q.name,sourceStamp:H3Doctor.stamp(q),project:q,index:0,total:b.windowIds.length,windowIds:b.windowIds,status:'running',phase:'checking_coverage',message:'Checking existing pixels first.',policy:b.policy,imageSettings:b.imageSettings,application:{autoApply:b.autoApply,status:'pending'},usage:{calls:0,images:0},events:[],candidates:[]};fixture.runs.set(id,r);return r;}
  throw Error('Unexpected reference operation '+b.action);
 }throw Error('Unexpected route '+route+' '+b.action);};
 fixture.finish=id=>{const r=fixture.runs.get(id),w=r.project.windows[0];H3Scenes.recordEvidence(r.project,w,'anchor',['state:captain','locked-wardrobe'],{reason:'The image was visually confirmed for the blue shirt requirement.',authority:'vision-agent'});H3Scenes.applyManifest(r.project,H3Scenes.resolve(r.project,w));r.status='completed';r.application.status='awaiting-browser';r.phase='finished';r.index=r.total;r.message='Existing image checked, labelled and assigned. No new image was needed.';r.labelReviews=[{assetId:'anchor',accepted:true,reason:'The supplied blue shirt is compatible with this specific window.'}];r.updatedAt='tick'+(++fixture.tick);};
 }""",image)
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.coverage');page.evaluate('fixture.original=DirectorApp.getProject()')
 page.locator('header.topbar [data-coverage="open"]').click();page.wait_for_selector('.coverage-live');assert page.locator('[data-coverage=launch]').is_visible()
 assert page.locator('#coverage-issues').is_visible()
 text=page.locator('#coverage-issues').inner_text();assert 'Captain blue shirt.png' in text and 'navy blue shirt' in text and 'everyday outfit' in text
 assert page.locator('[data-coverage="approve"]').count()==0
 page.locator('[data-coverage="confirm-coverage"]').wait_for(state='visible');page.wait_for_function('!document.querySelector("[data-coverage=confirm-coverage]").disabled')
 print('PASS existing generic run gains exact filename, field and state diagnostics without inference')
 page.screenshot(path=str(ROOT.parent/'screen-coverage-conflict-180.png'),full_page=True)
 page.locator('[data-coverage="confirm-coverage"]').click();page.wait_for_function('H3Scenes.resolve(fixture.runs.get("agent-old").project,fixture.runs.get("agent-old").project.windows[0]).ready')
 assert page.evaluate('DirectorApp.getProject().windows[0].referencePolicy.coverageEvidence') is None
 print('PASS explicit pixel-loaded confirmation updates prepared snapshot only, with no render request')
 page.locator('[data-coverage-config="license"]').check();page.locator('[data-coverage="launch"]').click();page.wait_for_function('fixture.runs.get("agent-old").status==="running"')
 assert page.evaluate('fixture.runs.get("agent-old").usage.calls')==1
 page.evaluate('fixture.finish("agent-old")');page.evaluate('DirectorApp.coverage.poll()');page.wait_for_function('DirectorApp.getProject().referencePreparationHistory?.some(x=>x.id==="agent-old")')
 assert page.evaluate('DirectorApp.getProject().assets.length')==1
 assert page.evaluate('DirectorApp.getProject().windows[0].detail')==page.evaluate('fixture.original.windows[0].detail')
 assert page.evaluate('H3Scenes.resolve(DirectorApp.getProject(),DirectorApp.getProject().windows[0]).ready')
 print('PASS save-and-continue retains spent budget and auto-applies labelled existing coverage with no manual Apply')
 page.locator('[data-action="close-dialog"]').click();page.locator('#undo').click();page.evaluate('DirectorApp.coverage.poll()')
 assert not page.evaluate('DirectorApp.getProject().referencePreparationHistory?.some(x=>x.id==="agent-old")')
 assert not page.evaluate('fixture.runs.get("agent-old").application.autoApply')
 print('PASS undo stays undone; acknowledged result is not automatically reapplied')
 # A clean new run uses one launch, explicit limited permissions and a visible progress pane.
 page.evaluate('fixture.runs.clear()');page.locator('header.topbar [data-coverage="open"]').click();page.wait_for_selector('[data-coverage="start"]');page.locator('[data-coverage="scope-window"]').click();page.locator('[data-coverage-config="license"]').check();page.locator('[data-coverage="start"]').click();page.wait_for_function('fixture.runs.has("agent-new")')
 assert page.evaluate('fixture.calls.filter(x=>x.route==="reference-agent"&&x.b.action==="start").length')==1
 assert page.evaluate('fixture.runs.get("agent-new").policy.repairLabels')
 page.evaluate('fixture.finish("agent-new")');page.evaluate('DirectorApp.coverage.poll()');page.wait_for_function('DirectorApp.getProject().referencePreparationHistory?.some(x=>x.id==="agent-new")')
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_timeout(300)
 assert 'Applied to project' in page.locator('.coverage-live').inner_text()
 print('PASS one guided start, live status and automatic result application from the main toolbar')
 page.evaluate("document.querySelector('#dialog-body').scrollTop=0");page.screenshot(path=str(ROOT.parent/'screen-coverage-desktop-180.png'))
 page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(ROOT.parent/'screen-coverage-phone-180.png'));page.set_viewport_size({'width':1440,'height':1040})
 # Pending answers survive periodic re-rendering of progress, even after leaving the field.
 page.evaluate('''()=>{const r=fixture.runs.get('agent-new');r.status='needs_review';r.application.autoApply=false;r.pending={kind:'question',question:'Which side should the reverse angle show?'};r.updatedAt='question';}''');page.evaluate('DirectorApp.coverage.poll()');page.wait_for_selector('#coverage-answer');page.locator('#coverage-answer').fill('Show the port side, keep the outfit.');page.locator('#coverage-answer').press('Tab');page.evaluate('fixture.runs.get("agent-new").updatedAt="question-refresh"');page.evaluate('DirectorApp.coverage.poll()');assert page.locator('#coverage-answer').input_value()=='Show the port side, keep the outfit.'
 print('PASS clarification input survives the live progress refresh')
 page.evaluate("document.querySelector('#dialog-body').scrollTop=0");page.screenshot(path=str(ROOT.parent/'screen-coverage-question-180.png'))
 page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(200);assert page.evaluate('document.documentElement.scrollWidth')<=392
 page.locator('[data-coverage="authorize"]').scroll_into_view_if_needed();assert page.locator('[data-coverage="authorize"]').is_visible();page.screenshot(path=str(ROOT.parent/'screen-coverage-question-phone-180.png'))
 page.set_viewport_size({'width':390,'height':460});page.locator('#coverage-answer').fill('Port side.');page.locator('[data-coverage="authorize"]').scroll_into_view_if_needed();assert page.locator('[data-coverage="authorize"]').is_visible()
 print('PASS portrait and keyboard-sized controls stay reachable without horizontal overflow')
 # 1.9.1: the user can recover a rejected plan without abandoning the run.
 page.set_viewport_size({'width':390,'height':844})
 page.evaluate('''()=>{
  const r=fixture.runs.get('agent-new');r.status='needs_review';r.pending=null;r.application.autoApply=false;r.message='Image planning response needs repair: nonexistent requirement.';r.updatedAt='plan-repair';
  r.planRecovery={kind:'repair',stamp:'fixture-recovery-stamp',requestId:'captured-plan-1',windowId:r.windowIds[0],windowTitle:'Current window',message:'Missing-reference request names a nonexistent requirement.',canRetry:true,rawPreview:'{"action":"need_reference","request":{"requirementId":"invented"}}'};
  fixture.preRepair=JSON.stringify(DirectorApp.getProject().windows);fixture.callsBeforeRepair=fixture.calls.filter(x=>x.b.action==='start').length;
  const call=DirectorProviders.call;DirectorProviders.call=async(route,b)=>{if(route==='reference-agent'&&b.action==='retry-plan'){fixture.calls.push({route,b});const r=fixture.runs.get(b.id);r.status='running';r.message='Repairing only the rejected image plan';r.planRecovery=null;r.updatedAt='plan-repaired';return r;}return call(route,b);};
 }''')
 page.evaluate('DirectorApp.coverage.open(null,"agent-new")');page.wait_for_selector('[data-coverage="retry-plan"]')
 assert page.locator('[data-coverage="launch"]').inner_text()=='Repair this step & continue'
 page.locator('[data-coverage="retry-plan"]').scroll_into_view_if_needed();assert page.locator('[data-coverage="retry-plan"]').is_visible()
 assert page.evaluate('document.documentElement.scrollWidth')<=392
 page.screenshot(path=str(ROOT.parent/'screen-plan-recovery-phone-191.png'))
 page.locator('[data-coverage="retry-plan"]').click();page.wait_for_function('fixture.calls.some(x=>x.b.action==="retry-plan")')
 call=page.evaluate('fixture.calls.find(x=>x.b.action==="retry-plan").b');assert call['confirm'] is True and call['recoveryStamp']=='fixture-recovery-stamp'
 assert page.evaluate('fixture.calls.filter(x=>x.b.action==="start").length')==page.evaluate('fixture.callsBeforeRepair')
 assert page.evaluate('JSON.stringify(DirectorApp.getProject().windows)')==page.evaluate('fixture.preRepair')
 print('PASS phone repair button sends one confirmed same-run operation with no fresh workflow or timeline edit')
 page.evaluate('''()=>{const r=fixture.runs.get('agent-new');r.status='paused';r.updatedAt='legacy-revalidate';r.message='Generated coverage must preserve the requested requirement state.';r.planRecovery={kind:'revalidate',stamp:'fixture-revalidate',requestId:'captured-plan-1',windowTitle:'Current window',message:'The saved plan can be revalidated without another planning request.',bindingChanges:[{field:'state',proposed:'blue outfit',bound:'navy blue shirt'}]};}''')
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_selector('.coverage-plan-recovery')
 assert page.locator('[data-coverage="retry-plan"]').count()==0
 page.locator('.coverage-plan-recovery [data-coverage="resume"]').scroll_into_view_if_needed()
 assert page.locator('.coverage-plan-recovery [data-coverage="resume"]').inner_text()=='Continue saved plan'
 page.locator('.coverage-plan-recovery [data-coverage="resume"]').click();page.wait_for_function('fixture.runs.get("agent-new").status==="running"')
 assert page.evaluate('fixture.calls.filter(x=>x.b.action==="retry-plan").length')==1
 print('PASS old string-mismatch recovery offers saved-plan continuation rather than a paid retry')

 # 1.9.2: native image rejection has its own explicit retry, not another AI plan.
 page.evaluate('''()=>{
  const r=fixture.runs.get('agent-new');r.status='needs_review';r.planRecovery=null;r.updatedAt='pg-retry';
  r.pending={kind:'generation',request:{title:'Blue outfit',description:'The current state',prompt:'Preserve identity.\\n\\nShow the blue outfit.'}};
  r.imageRecovery={kind:'prompt-mode',stamp:'fixture-image-stamp',jobId:'failed-image-job',windowTitle:'Current window',message:'Retry only the saved image after updating worker 1.9.2.',promptPreview:r.pending.request.prompt,canRetry:true};
  fixture.preImageRetry=JSON.stringify(DirectorApp.getProject());fixture.startsBeforeImageRetry=fixture.calls.filter(x=>x.b.action==='start').length;
  const call=DirectorProviders.call;DirectorProviders.call=async(route,b)=>{if(route==='reference-agent'&&b.action==='retry-image'){fixture.calls.push({route,b});r.status='running';r.imageRecovery=null;r.pending=null;r.updatedAt='image-retry-running';return r;}return call(route,b);};
 }''')
 page.evaluate('DirectorApp.coverage.open(null,"agent-new")');page.wait_for_selector('[data-coverage="retry-image"]')
 page.evaluate("fixture.runs.get('agent-new').imageRecovery={...fixture.runs.get('agent-new').imageRecovery,canRetry:false};fixture.runs.get('agent-new').updatedAt='image-parking'")
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_function('document.querySelector("[data-coverage=retry-image]").disabled')
 page.evaluate("fixture.runs.get('agent-new').imageRecovery={...fixture.runs.get('agent-new').imageRecovery,canRetry:true}")
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_function('!document.querySelector("[data-coverage=retry-image]").disabled')
 assert page.locator('[data-coverage="launch"]').inner_text()=='Retry image as one prompt'
 assert page.locator('[data-coverage="approve"]').count()==0
 assert page.locator('[data-coverage="retry-plan"]').count()==0
 page.locator('[data-coverage="retry-image"]').scroll_into_view_if_needed();assert page.locator('[data-coverage="retry-image"]').is_visible()
 assert page.evaluate("document.documentElement.scrollWidth")<=392
 page.screenshot(path=str(ROOT.parent/"screen-image-retry-phone-192.png"))
 page.locator('[data-coverage="retry-image"]').click();page.wait_for_function('fixture.calls.some(x=>x.b.action==="retry-image")')
 call=page.evaluate('fixture.calls.find(x=>x.b.action==="retry-image").b');assert call['confirm'] is True and call['recoveryStamp']=='fixture-image-stamp'
 assert page.evaluate('fixture.calls.filter(x=>x.b.action==="start").length')==page.evaluate('fixture.startsBeforeImageRetry')
 assert page.evaluate('JSON.stringify(DirectorApp.getProject())')==page.evaluate('fixture.preImageRetry')
 print('PASS portrait image retry uses exact confirmation/stamp, not another plan or full-project run')

 assert not errors,errors
 browser.close()
