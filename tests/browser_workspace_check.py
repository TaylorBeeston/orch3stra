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
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html)
 for f in re.findall(r'<link[^>]*href="([^"]+\.css)"',(ROOT/'index.html').read_text()):page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
  if f!='app.js':page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""async image=>{
 const p=H3.newProject();p.id='coverage-browser';p.name='Reference workflow · test scene';p.mode='managed';p.subjects=[{id:'captain',number:1,name:'Captain',description:'Adult in a blue shirt.',kind:'person',assetIds:['anchor'],speakerId:'S1',voiceAssetId:'',referenceVariants:[]}];p.assets=[{id:'anchor',kind:'image',number:1,name:'Captain blue shirt.png',type:'image/png',size:120,referenceState:'everyday outfit',missing:false}];p.windows=[{...H3.newWindow('Bridge · waiting for news',209,0),id:'bridge-window',subjectIds:['captain'],assetIds:[],casting:{captain:{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Navy blue shirt.',retention:'Keep the same face.'}},summary:'[reference generation] The captain studies the horizon.',detail:'[Shot 1] The captain studies the distant horizon using <Picture 1>.',soundscape:'Quiet wind.',music:'N/A',referencePolicy:{pins:['anchor'],states:{captain:'navy blue shirt'},requirements:[{id:'locked-wardrobe',role:'wardrobe',subjectId:'captain',state:'navy blue shirt',assetIds:['anchor'],description:'This source is explicitly required for the navy shirt.'}]}}];p.imageSettings={modelType:'qwen_image_21_7B',modelLabel:'Qwen 2.1 fixture',resolution:'1024x1024',steps:20,guidance:4};H3Scenes.setScenes(p,H3Scenes.suggestScenes(p));
 window.fixture={blobs:new Map(),runs:new Map(),calls:[],image,mode:'old',tick:0};fixture.blobs.set('anchor',await(await fetch(image)).blob());DirectorStore.getBlob=async id=>fixture.blobs.get(id)||null;DirectorStore.putBlob=async(id,b)=>fixture.blobs.set(id,b);await DirectorStore.save(p);
 const q=H3.normalizeProject(p),r={id:'agent-old',projectId:q.id,name:q.name,status:'needs_review',phase:'starting',index:0,total:1,windowIds:q.windows.map(w=>w.id),project:q,sourceStamp:H3Doctor.stamp(q),policy:{...H3ReferenceAgent.defaults,enabled:true,allowImages:false,mode:'review'},imageSettings:q.imageSettings,usage:{calls:1,images:0},events:[],candidates:[],message:'A pinned or explicitly named image is missing, excluded, unapproved, or in a conflicting state.'};fixture.runs.set(r.id,r);
 const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.config.provider='deepseek';P.config.model='deepseek-flash-fixture';P.config.images=true;P.getStudioBlob=async id=>fixture.blobs.get(id);P.studioBlob=async(id,b)=>fixture.blobs.set(id,b);
 P.wangp=async path=>path==='/image-models'?{models:[{model_type:'qwen_image_21_7B',name:'Qwen 2.1 fixture'}]}:{jobs:[]};
 P.call=async(route,b)=>{fixture.calls.push({route,b});if(route==='studio')return b.action==='list'?{projects:[]}:b.action==='blob-info'?{info:{size:120}}:{credentials:{}};if(route==='sequence')return{runs:[],backend:'headless',canSubmitManaged:true,explanation:'No queued work.',checkedAt:new Date().toISOString(),queue:{reachable:true,idle:true,paused:false,jobs:[],active_job_id:null}};if(route==='reference-agent'){
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
 page.evaluate('''()=>{new MutationObserver(()=>{for(const im of document.querySelectorAll('.coverage-candidates img'))if(im.getAttribute('src')?.startsWith('/api/studio-blob'))im.src=fixture.image;}).observe(document.body,{childList:true,subtree:true});}''')
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.coverage');page.evaluate('fixture.original=DirectorApp.getProject()')
 assert page.locator('#workspace-home').is_visible()
 assert page.locator('.workspace-navigation [data-workspace-area]').count()==5
 assert not page.locator('header.topbar > .header-actions').is_visible()
 assert page.evaluate('document.documentElement.scrollWidth')<=1440
 page.screenshot(path=str(ROOT.parent/'h3-director-2.0.1-overview.png'))
 print('PASS default shell has five work areas and a readable overview instead of the full button wall')
 page.locator('.workspace-navigation [data-workspace-area="references"]').click()
 assert page.locator('#workspace-home [data-coverage="open"]').is_visible()
 page.locator('#workspace-home [data-coverage="open"]').click();page.wait_for_selector('.coverage-live')
 assert page.locator('#workspace-back').is_visible()
 page.evaluate('''()=>{const r=fixture.runs.get('agent-old');r.pending=null;r.status='needs_review';r.updatedAt='inspection-problem';r.message='Existing-image inspection needs repair.';r.inspectionRecovery={kind:'repair',stamp:'inspection-stamp',requestId:'inspection-1',windowId:r.windowIds[0],windowTitle:'Bridge window',canRetry:true,budgetRemaining:10,message:'The reply repeated one image and omitted another. Your library is intact.',issues:[{code:'missing-image',message:'No valid reply for the approved image.'}],images:[{assetId:'anchor',name:'Captain blue shirt.png',imageKey:'I1',requirementIds:['locked-wardrobe']}],unresolvedIds:['anchor'],rawPreview:'{"inspections":[]}'};
 const call=DirectorProviders.call;DirectorProviders.call=async(route,b)=>{if(route==='reference-agent'&&b.action==='retry-inspection'){fixture.calls.push({route,b});const r=fixture.runs.get(b.id);r.status='running';r.inspectionRecovery=null;r.message='Rechecking unresolved images';r.updatedAt='fixed-inspection';return r;}if(route==='reference-agent'&&b.action==='reject-candidate'){fixture.calls.push({route,b});const r=fixture.runs.get(b.id);r.status='needs_review';r.message='Candidate rejected. No work started.';r.candidates[0].status='rejected-by-user';r.candidateReview.stamp='candidate-rejected';r.updatedAt='rejected';return r;}if(route==='reference-agent'&&b.action==='retry-candidate'){fixture.calls.push({route,b});const r=fixture.runs.get(b.id);r.status='running';r.pending=null;r.candidateReview=null;r.message='One corrected replacement is queued.';r.updatedAt='retry';return r;}return call(route,b);};}''')
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_selector('[data-coverage="retry-inspection"]')
 assert page.locator('[data-coverage="launch"]').inner_text()=='Recheck unresolved images'
 page.locator('[data-coverage="retry-inspection"]').click();page.wait_for_function('fixture.calls.some(x=>x.b.action==="retry-inspection")')
 b=page.evaluate('fixture.calls.find(x=>x.b.action==="retry-inspection").b');assert b['confirm'] is True and b['recoveryStamp']=='inspection-stamp'
 assert page.evaluate('fixture.calls.filter(x=>x.b.action==="start").length')==0
 print('PASS inspection recovery issues one explicit same-run repair without starting a new project pass')
 page.evaluate('''()=>{const r=fixture.runs.get('agent-old');r.status='needs_review';r.message='Candidate needs review: extra foreground figure.';r.updatedAt='candidate';r.candidates=[{id:'candidate-test',name:'Captain profile',status:'rejected',review:{reason:'An unintended extra figure appears behind the subject.'}}];r.pending={kind:'candidate',candidateId:'candidate-test'};r.candidateReview={candidateId:'candidate-test',stamp:'candidate-stamp',windowId:r.windowIds[0],name:'Captain profile',reason:r.candidates[0].review.reason,prompt:'Use <image1> for one person in profile.',attempts:2,limit:2,requiresExtraAttempt:true,canAct:true,canRetry:true,message:'Authorize one extra attempt for this window.'};}''')
 page.evaluate('DirectorApp.coverage.poll()');page.wait_for_selector('.coverage-candidate-decision')
 page.locator('[data-candidate-edit="reason"]').fill('Remove the duplicate figure, keep the blue shirt.')
 page.locator('[data-candidate-edit="reason"]').press('Tab')
 page.evaluate('fixture.runs.get("agent-old").updatedAt="poll-after-typing"');page.evaluate('DirectorApp.coverage.poll()')
 assert page.locator('[data-candidate-edit="reason"]').input_value()=='Remove the duplicate figure, keep the blue shirt.'
 print('PASS corrective text survives periodic candidate-status refreshes')
 page.locator('[data-coverage="connections"]').scroll_into_view_if_needed();page.evaluate('window.savedParentScroll=document.querySelector("#dialog-body").scrollTop')
 page.locator('[data-coverage="connections"]').click();page.wait_for_function('document.querySelector("#dialog").dataset.panel==="connections"')
 assert page.evaluate('DirectorApp.workspace.depth')>=1
 page.locator('#workspace-back').click();page.wait_for_selector('[data-candidate-edit="reason"]')
 assert page.locator('[data-candidate-edit="reason"]').input_value()=='Remove the duplicate figure, keep the blue shirt.'
 assert abs(page.evaluate('document.querySelector("#dialog-body").scrollTop-savedParentScroll'))<10
 print('PASS Back restores the parent DOM, correction text, and scroll after opening settings')
 page.set_viewport_size({'width':390,'height':844});page.locator('.coverage-candidate-decision').scroll_into_view_if_needed()
 assert page.evaluate('document.documentElement.scrollWidth')<=392
 page.screenshot(path=str(ROOT.parent/'h3-director-2.0.1-review-phone.png'))
 page.locator('[data-coverage="retry-candidate"]').scroll_into_view_if_needed()
 assert page.locator('[data-coverage="retry-candidate"]').inner_text()=='Allow 1 more attempt & retry'
 page.locator('[data-coverage="retry-candidate"]').click();page.wait_for_function('fixture.calls.some(x=>x.b.action==="retry-candidate")')
 c=page.evaluate('fixture.calls.find(x=>x.b.action==="retry-candidate").b');assert c['extraAttempt'] is True and c['candidateId']=='candidate-test';assert 'Remove the duplicate figure' in c['prompt']
 assert page.evaluate('fixture.calls.filter(x=>x.b.action==="start").length')==0
 print('PASS portrait candidate retry explicitly authorizes one extra attempt and retains the source run')
 page.locator('#dialog [data-action="close-dialog"]').click();assert not page.locator('#dialog').is_visible()
 page.locator('.workspace-navigation [data-workspace-area="timeline"]').click();assert page.locator('.timeline-panel').is_visible();assert not page.locator('.brief').is_visible()
 page.screenshot(path=str(ROOT.parent/'h3-director-2.0.1-timeline-phone.png'))
 page.set_viewport_size({'width':1440,'height':1000})
 page.screenshot(path=str(ROOT.parent/'h3-director-2.0.1-timeline.png'))
 page.locator('.timeline-toolbar [data-workspace-tool="window-details"]').click()
 page.wait_for_selector('.workspace-window-settings')
 assert page.locator('#dialog [data-timing="frames"]').is_visible()
 oldframes=page.evaluate('DirectorApp.getProject().windows[0].frames')
 page.locator('#dialog [data-timing="frames"]').fill(str(oldframes+17))
 page.locator('#dialog [data-timing="frames"]').press('Tab')
 assert page.evaluate('DirectorApp.getProject().windows[0].frames')==oldframes+17
 page.locator('#workspace-back').click()
 print('PASS hidden inspector controls remain accessible through Window settings and save real edits')
 page.locator('.workspace-navigation [data-workspace-tool="tools"]').click();page.wait_for_selector('#workspace-tool-search')
 page.locator('#workspace-tool-search').fill('sequence');assert page.locator('[data-workspace-tool-row]:visible').count()>=1
 assert all('sequence' in x.lower() for x in page.locator('[data-workspace-tool-row]:visible').all_inner_texts())
 page.keyboard.press('Escape');page.wait_for_function('!document.querySelector("#dialog").open');assert not page.locator('#dialog').is_visible()
 print('PASS Timeline and searchable tool finder remain reachable, with Escape returning to the workspace')
 page.locator('.workspace-navigation [data-workspace-tool="activity"]').click()
 page.locator('#dialog [data-workspace-original="managed-sequences"]').click()
 page.wait_for_selector('#sequence-manager')
 assert page.evaluate('fixture.calls.some(x=>x.route==="sequence"&&x.b.action==="manager")')
 page.locator('#workspace-back').click()
 assert page.locator('#dialog [data-workspace-original="managed-sequences"]').is_visible()
 page.locator('#dialog [data-action="close-dialog"]').click()
 print('PASS Activity tool buttons retain their original handlers instead of inert HTML clones')
 page.locator('.workspace-navigation [data-workspace-tool="tools"]').click()
 page.locator('#workspace-tool-search').fill('post')
 page.locator('#dialog [data-post="open"]').click()
 page.wait_for_function('!document.querySelector("#dialog").open')
 assert page.locator('#post-workspace').is_visible()
 assert not page.locator('.workspace-navigation').is_visible()
 page.locator('[data-post="close"]').click()
 assert not page.locator('#post-workspace').is_visible()
 assert page.locator('.workspace-navigation').is_visible()
 print('PASS opening Post from tool finder leaves no old modal above the separate finishing room')


 page.evaluate('document.querySelector(".header-actions [data-action=export]").click()')
 assert page.locator('#dialog-title').inner_text()=='Export movie or project backup'
 assert page.locator('#dialog [data-action="export-timeline-movie"]').is_visible()
 assert 'Worker-owned rendered videos are not embedded' in page.locator('#dialog-body').inner_text()
 before=page.evaluate('fixture.calls.filter(x=>x.route==="finish"&&x.b.action==="start").length')
 page.locator('#dialog [data-post="open"]').click()
 assert not page.locator('#dialog').is_visible()
 assert page.locator('#post-workspace').is_visible()
 assert page.evaluate('fixture.calls.filter(x=>x.route==="finish"&&x.b.action==="start").length')==before
 page.locator('[data-post="close"]').click()
 print('PASS movie/backup choice clarifies contents and opening Post starts no export')

 page.set_viewport_size({'width':390,'height':460});page.locator('.workspace-navigation [data-workspace-area="overview"]').click()
 assert page.evaluate('document.documentElement.scrollWidth')<=392
 page.screenshot(path=str(ROOT.parent/'h3-director-2.0.1-overview-phone.png'))
 assert not errors,errors
 print('PASS no page errors; phone and keyboard-sized layouts have no horizontal overflow')
 browser.close()
