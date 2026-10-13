# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Offline real Chromium DOM/image workflow; model/renderer/storage transports are fixtures."""
import base64,io,json,os,re,tempfile,zipfile
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

 page.evaluate("""async()=>{
   const base=DirectorApp.getProject(),q=H3.clone(base),r=fixture.runs.get('agent-old');
   fixture.source=H3.clone(base);fixture.snapshot=null;
   r.project=q;r.sourceStamp=H3Doctor.stamp(base);r.normalizedSourceStamp=H3Doctor.stamp(base);r.windowId=q.windows[0].id;
   r.policy={...H3ReferenceAgent.defaults,enabled:true,mode:'autonomous',allowImages:true,maxAttempts:4,maxImages:100,maxCalls:1024};
   r.status='needs_review';r.pending={kind:'generation',generationApproved:true,request:{title:'One more approved angle',prompt:'Preserve <image1> identity.'}};
   r.message='Image allowance used for this window (4/4). Raise its allowance or save progress.';r.index=0;r.windows={[r.windowId]:{round:4,attempts:4,inspectedIds:['anchor']}};r.candidates=[];r.usage={images:4,calls:12};
   r.budgetState={windowId:r.windowId,windowTitle:q.windows[0].title,attempts:4,limit:4,configured:4,maxConfigurable:20,exhausted:true,canExtend:true,otherBudget:null,images:4,imageLimit:100,calls:12,callLimit:1024,stamp:'budget-4'};
   r.savedProgress={canSave:true,completed:0,total:1,acceptedImages:4,verifiedChecks:0};
   for(let i=0;i<4;i++){
    const id='ref-good-'+i,blob=fixture.blobs.get('anchor');fixture.blobs.set(id,blob);
    const a={id,number:i+2,kind:'image',name:'Approved variant '+i+'.png',type:'image/png',size:blob.size,description:'Approved synthetic image',missing:false,provenance:{agentId:r.id,kind:'reference-agent'}};
    q.assets.push(a);H3Scenes.annotate(q,id,{approved:true,subjectIds:['captain'],roles:['angle'],angles:['angle-'+i]});
    r.candidates.push({...H3.clone(a),windowId:r.windowId,status:'accepted',review:{accepted:true,reason:'Synthetic review of attached pixels.'}});
   }
   r.candidates.push({id:'ref-bad',name:'Unapproved image',status:'rejected'});
   fixture.serverBlobs=new Map(fixture.blobs);DirectorProviders.getStudioBlob=async id=>fixture.serverBlobs.get(id);
   const old=DirectorProviders.call;
   DirectorProviders.call=async(route,b)=>{
    if(route==='reference-agent'&&b.action==='save-progress'){
      fixture.calls.push({route,b});const r=fixture.runs.get(b.id),snap=H3ReferenceAgent.progressSnapshot(r);
      fixture.snapshot={...snap,id:'checkpoint_'+'a'.repeat(32),createdAt:'2026-09-28T00:00:00Z'};return H3.clone(fixture.snapshot);
    }
    if(route==='reference-agent'&&b.action==='extend-window'){
      fixture.calls.push({route,b});const r=fixture.runs.get(b.id);r.budgetState={...r.budgetState,limit:20,exhausted:false,canExtend:false};r.status='running';r.savedProgress.canSave=false;r.updatedAt='extended';return H3.clone(r);
    }
    return old(route,b);
   };
 }""")
 page.evaluate('DirectorApp.coverage.open(null,"agent-old")');page.wait_for_selector('.coverage-budget-status')
 assert page.locator('[data-coverage-config=maxAttempts]').get_attribute('max')=='20'
 assert page.locator('[data-coverage-config=maxAttempts]').count()==1
 assert '4 / 4' in page.locator('.coverage-budget-status').inner_text()
 assert 'Allow 20 here' in page.locator('[data-coverage=extend-window]').inner_text()
 # Save using actual client merge/storage and real synthetic image Blobs.
 page.locator('[data-coverage=save-progress]').click();page.wait_for_selector('.coverage-save-success')
 assert page.evaluate('JSON.stringify(DirectorApp.getProject())===JSON.stringify(fixture.source)')
 saved=page.evaluate('DirectorStore.index().find(x=>x.id.startsWith("progress_"))')
 assert saved and saved['name'].endswith('reference progress')
 copy=page.evaluate('DirectorStore.load('+json.dumps(saved['id'])+')')
 assert len(copy['assets'])==5
 assert copy['windows']==page.evaluate('fixture.source.windows')
 assert copy['referenceProgressHistory'][-1]['partial'] is True
 assert page.evaluate('fixture.runs.get("agent-old").status')=='needs_review'
 assert not page.evaluate('fixture.calls.some(x=>["start","resume","cancel","extend-window"].includes(x.b.action))')
 print('PASS saved progress uses a separate local project; original run/edit and incomplete-window selections stay unchanged')
 # Full portable download from the copy really includes original and approved pixels.
 with page.expect_download() as event:
  page.locator('[data-coverage=download-progress-project]').click()
 d=event.value
 with tempfile.TemporaryDirectory() as td:
  path=Path(td)/d.suggested_filename;d.save_as(path);portable=json.loads(path.read_text());assert portable['format']=='h3-director-portable';assert len(portable['files'])==5;assert 'ref-bad' not in portable['files']
  for i in range(4):assert portable['files']['ref-good-'+str(i)]['data']==portable['files']['anchor']['data']
 print('PASS actual portable .h3project download contains all five unchanged source/approved images and no rejected candidate')
 # Re-saving the same checkpoint does not overwrite edits made to its saved copy.
 page.evaluate('''()=>{const p=DirectorStore.load('''+json.dumps(saved['id'])+''');p.name='My separately edited checkpoint';return DirectorStore.save(p,false);}''')
 page.locator('[data-coverage=save-progress]').click();page.wait_for_function('document.querySelector(".coverage-save-success").textContent.includes("My separately edited")')
 assert page.evaluate('DirectorStore.index().filter(x=>x.id.startsWith("progress_")).length')==1
 print('PASS repeated progress-save does not overwrite an independently edited copy')
 # Download is read-only even when an existing local media ID was edited.
 page.evaluate("fixture.blobs.set('ref-good-0', new Blob(['locally edited pixels'],{type:'image/png'}))")
 with page.expect_download() as event:
  page.locator('[data-coverage=progress-pack]').click()
 d=event.value
 with tempfile.TemporaryDirectory() as td:
  path=Path(td)/d.suggested_filename;d.save_as(path)
  with zipfile.ZipFile(path) as z:
   assert z.testzip() is None
   assert len([x for x in z.namelist() if x.startswith('approved/')])==4
   assert not any('bad' in x for x in z.namelist());data=json.loads(z.read('checkpoint.json'));assert data['result']['status']=='checkpoint'
 assert page.evaluate("fixture.blobs.get('ref-good-0').text()")=='locally edited pixels'
 print('PASS actual progress ZIP keeps approved bytes without overwriting edited local media or claiming a complete backup')
 # Phone controls remain visible and keyboard-sized form is usable.
 page.set_viewport_size({'width':390,'height':844});page.locator('.coverage-budget-status').scroll_into_view_if_needed()
 assert page.evaluate('document.documentElement.scrollWidth')<=392
 page.screenshot(path=str(ROOT.parent/'reference-budget-phone.png'))
 page.set_viewport_size({'width':390,'height':460});page.locator('[data-coverage-config=maxAttempts]').fill('20');page.locator('[data-coverage-config=maxAttempts]').press('Tab')
 page.locator('[data-coverage=extend-window]').scroll_into_view_if_needed();assert page.locator('[data-coverage=extend-window]').is_visible()
 page.locator('[data-coverage=extend-window]').click();page.wait_for_function('fixture.calls.some(x=>x.b.action==="extend-window")')
 call=page.evaluate('fixture.calls.find(x=>x.b.action==="extend-window").b');assert call['limit']==20 and call['confirm'] and call['resume'] and call['budgetStamp']=='budget-4'
 assert page.evaluate('fixture.runs.get("agent-old").usage.images')==4
 assert page.evaluate('fixture.runs.get("agent-old").status')=='running'
 assert page.locator('[data-coverage=save-progress]').is_disabled()
 print('PASS portrait/keyboard-sized allowance control sends an exact same-run grant without resetting spent attempts')
 # Cancellation is not deletion; progress saving remains offered.
 page.evaluate('''()=>{const r=fixture.runs.get('agent-old');r.status='cancelled';r.savedProgress.canSave=true;r.updatedAt='cancelled';}''');page.evaluate('DirectorApp.coverage.poll()');page.wait_for_function('!document.querySelector("[data-coverage=save-progress]").disabled')
 assert page.locator('[data-coverage=progress-pack]').evaluate("el => !el.disabled")
 page.set_viewport_size({'width':1440,'height':1040});page.locator('.coverage-progress-save').scroll_into_view_if_needed();page.screenshot(path=str(ROOT.parent/'reference-progress-desktop.png'))
 print('PASS cancelled runs retain the save-progress and approved-image download actions')
 assert not errors,errors
 browser.close()
