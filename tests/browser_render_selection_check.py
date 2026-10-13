# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Actual Chromium dialogs/popovers, MP4 playback and selection UI.
Server, model responses and browser storage persistence use fixtures; no live GPU.
"""
import os,re,json,base64,subprocess,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 film=Path(td)/'fixture.mp4'
 subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=24:d=10','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',str(film)],check=True)
 data='data:video/mp4;base64,'+base64.b64encode(film.read_bytes()).decode()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1480,'height':1050});page.set_default_timeout(18000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
  for f in re.findall(r'<link[^>]*href="([^"]+\.css)"',(ROOT/'index.html').read_text()):page.add_style_tag(content=(ROOT/f).read_text())
  page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
  for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
   if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
  page.evaluate("""media=>{
   window.fixture={media,calls:[],finished:[],submitted:[],native:[],prefixDelay:false,queueBlocked:false,blobs:new Map(),clicks:0};
   const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.remember=async()=>{};P.mediaURL=async()=>media;P.saveTrace=async()=>{};
   DirectorStore.getBlob=async k=>fixture.blobs.get(k)||null;DirectorStore.putBlob=async(k,b)=>fixture.blobs.set(k,b);
   const p=H3.newProject();p.id='selection-test';p.name='Finished opening and interrupted scene';p.mode='managed';p.modelType='h3_ref2va_pruned_pdd8';p.modelLabel='H3 fixture';p.presetConfirmed=true;
   p.windows=Array.from({length:5},(_,i)=>({...H3.newWindow(['Opening wide','A quiet look','The phone rings','A pause','The reply'][i],107,i?18:0),id:'w'+i,subjectIds:[],assetIds:[],casting:{},summary:'[reference generation] A quiet interior.',detail:'[Shot 1] The camera holds on an empty room.',soundscape:'Quiet room tone.',music:'N/A'}));
   const plan=H3Studio.managedPlan(p);fixture.saved={id:'seq_original',kind:'managed',status:'failed',name:'Original interrupted film',createdAt:new Date().toISOString(),snapshot:H3.clone(p),plan,live:{status:'failed',outputs:plan.slice(0,2).map((r,i)=>({id:'out'+i,available:true,cumulative:true,task_index:i+1,window_index:1,created_at:i,start_frame:0,end_frame:r.end}))}};
   // Initially only the first output is known to this browser; reconnect finds the second.
   p.jobs=[{...H3.clone(fixture.saved),live:{...fixture.saved.live,outputs:fixture.saved.live.outputs.slice(0,1)}}];DirectorStore.save(p);fixture.original=H3.clone(p);
   P.call=async(route,b)=>{fixture.calls.push({route,...b});
    if(route==='studio')return b.action==='list'?{projects:[]}:b.action==='blob-info'?{info:true}:{credentials:{}};
    if(route==='sequence'){
     if(b.action==='list')return {runs:[{id:fixture.saved.id,projectId:p.id,status:'failed'}]};
     if(b.action==='get')return H3.clone(fixture.saved);
     if(b.action==='manager')return {runs:[],queue:{reachable:true,idle:true,paused:false,jobs:[]},canSubmitManaged:!fixture.queueBlocked,explanation:fixture.queueBlocked?'An unresolved native job blocks dispatch.':'Ready for new work.'};
     if(b.action==='start'){fixture.submitted.push(H3.clone(b.project));return{id:'seq_new'+fixture.submitted.length,kind:'managed',status:'running',createdAt:new Date().toISOString(),snapshot:b.project,plan:H3Studio.managedPlan(b.project),live:{status:'running',outputs:[]}};}
    }
    if(route==='finish'){
     if(b.action==='list')return{jobs:fixture.finished};if(b.action==='get')return fixture.finished.find(x=>x.id===b.id);
     if(b.action==='start'){const j={id:b.id,name:b.edit.name,edit:b.edit,status:fixture.prefixDelay?'assembling':'completed',message:'Preparing saved film',progress:50,result:{frames:b.edit.totalFrames,width:832,height:480}};fixture.finished.push(j);return j;}
     if(b.action==='context'){const j=fixture.finished.find(x=>x.id===b.id);return{jobId:'prefix-import',outputId:'prefix-output',keepFrames:j.edit.totalFrames};}
     if(b.action==='cancel'){const j=fixture.finished.find(x=>x.id===b.id);j.status='cancelled';return j;}
    }
    throw Error('Unexpected route '+route+' '+b.action);
   };
   P.wangp=async(path,method,payload)=>{if(path==='/health')return{app:'h3-director-wangp',backend:'headless'};if(path==='/generate'){fixture.native.push(payload);return{job_id:'native-new',status:'submitted',outputs:[]};}if(path.startsWith('/jobs/'))return{status:'running',outputs:[]};throw Error('Unexpected worker path '+path);};
  }""",data)
  page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!DirectorApp?.renderSelection')
  # A notification displayed before a modal is moved above its real backdrop.
  page.evaluate("fixture.activity=H3Activity.start('Preparing reference image', {details:()=>fixture.clicks++});DirectorApp.renderSelection.open('choose')")
  page.wait_for_function("document.querySelector('#notification-layer').matches(':popover-open')&&document.querySelector('#notification-layer').parentElement.id==='dialog'")
  assert page.evaluate("(()=>{const b=[...document.querySelectorAll('#activity-stack button')].find(b=>b.textContent==='Details'),r=b.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b;})()")
  page.locator('#activity-stack button',has_text='Details').click();assert page.evaluate('fixture.clicks')==1
  print('PASS native modal top-layer notifications remain sharp and clickable, not inert beneath the backdrop')
  page.evaluate("H3Activity.notify('A visible error inside the modal',true)")
  page.screenshot(path=str(ROOT.parent/'screen-selection-notification-190.png'))
  # Nested native dialog + keyboard closure: notification host follows actual modal order.
  page.evaluate("(()=>{const d=document.createElement('dialog');d.id='nested-test';d.innerHTML='<input id=nested-focus aria-label=Focus>';document.body.append(d);d.showModal();document.querySelector('#nested-focus').focus();})()")
  page.wait_for_function("document.querySelector('#notification-layer').parentElement.id==='nested-test'")
  assert page.evaluate('document.activeElement.id')=='nested-focus'
  page.keyboard.press('Escape');page.wait_for_function("!document.querySelector('#nested-test').open&&document.querySelector('#notification-layer').parentElement.id==='dialog'")
  page.locator('.dialog-head [data-action="close-dialog"]').click();page.wait_for_function("document.querySelector('#notification-layer').parentElement===document.body")
  page.evaluate("document.querySelector('#activity-stack').replaceChildren()")
  print('PASS nested dialog close restores the toast layer; notifications do not steal typing focus')
  # Continue from first missing automatically reconnects the server-side saved second window.
  page.locator('.render-selection-toolbar [data-render-select="unfinished"]').click();page.wait_for_function('DirectorApp.renderSelection.selectedIds.join()===\"w2,w3,w4\"')
  assert page.locator('#render-context').input_value()=='prefix'
  assert page.locator('#render-window-list input:checked').count()==3
  page.screenshot(path=str(ROOT.parent/'screen-render-selection-desktop-190.png'))
  page.locator('[data-render-select="submit"]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.submitted.length===1')
  assert page.evaluate('fixture.submitted[0].windows.map(w=>w.id)')==['w2','w3','w4']
  assert page.evaluate('fixture.finished[0].edit.cuts.map(c=>c.windowId)')==['w1']
  assert page.evaluate('fixture.finished[0].edit.totalFrames')==18
  assert page.evaluate('fixture.submitted[0].continuation.keepFrames')==18
  assert page.evaluate('fixture.submitted[0].continuation.timelineFrames')==page.evaluate('fixture.saved.plan[1].end_frame')
  assert page.evaluate('DirectorApp.getProject().windows.length')==5
  assert page.evaluate('DirectorApp.getProject().jobs.some(j=>j.id===\"seq_original\")')
  print('PASS Continue unfinished reconnects saved footage and submits only the remaining suffix with bounded overlap and the original timeline offset')
  # Arbitrary checkboxes: missing spans are not secretly regenerated for continuity.
  page.locator('.dialog-head [data-action="close-dialog"]').click();page.evaluate('DirectorApp.renderSelection.open("current")');page.locator('[data-render-select="none"]').click()
  page.locator('input[data-render-pick="w0"]').check();page.locator('input[data-render-pick="w4"]').check()
  assert page.locator('[data-render-select="submit"]').is_disabled()
  assert 'gaps' in page.locator('#render-selection-summary').inner_text()
  page.locator('#render-strategy').select_option('independent');assert not page.locator('[data-render-select="submit"]').is_disabled()
  page.locator('[data-render-select="submit"]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.native.length===1')
  assert page.evaluate('fixture.native[0].snapshot.windows.map(w=>w.id)')==['w0','w4']
  assert page.evaluate('fixture.native[0].tasks.length')==2
  print('PASS noncontiguous selection explicitly requires independent shots; exact checked tasks are sent')
  # Queue unknown/busy blocks before CPU prefix assembly or submission.
  page.locator('.dialog-head [data-action="close-dialog"]').click();page.evaluate('fixture.queueBlocked=true;DirectorApp.select("w2");DirectorApp.renderSelection.open("from")')
  page.locator('[data-render-select="submit"]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function("document.querySelector('#render-selection-state').textContent.includes('blocks dispatch')")
  assert page.evaluate('fixture.submitted.length')==1;assert page.evaluate('fixture.finished.length')==1
  page.evaluate('fixture.queueBlocked=false;fixture.prefixDelay=true')
  page.locator('[data-render-select="submit"]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.finished.length===2')
  page.locator('#render-cancel-prepare').click();page.wait_for_function('!DirectorApp.renderSelection.busy')
  assert page.evaluate('fixture.finished[1].status')=='cancelled';assert page.evaluate('fixture.submitted.length')==1
  print('PASS busy/unknown renderer stops dispatch; cancelling prefix preparation does not cancel or submit GPU work')
  # Selection stays usable in portrait; timeline toggles do not alter the window edit.
  page.evaluate('fixture.prefixDelay=false;document.querySelector("#activity-stack").replaceChildren()');page.locator('.dialog-head [data-action="close-dialog"]').click();page.set_viewport_size({'width':390,'height':844})
  page.locator('.render-selection-toolbar [data-render-select="pick"]').click();page.locator('button[data-render-pick="w2"]').click();assert page.locator('button[data-render-pick="w2"]').get_attribute('aria-pressed')=='false'  # was already selected
  page.locator('.render-selection-toolbar [data-render-select="choose"]').click();assert page.locator('#render-window-list').is_visible()
  page.locator('#render-search').fill('reply');assert page.locator('.render-window-row:not([hidden])').count()==1
  page.locator('#render-search').fill('');page.locator('[data-render-select="submit"]').scroll_into_view_if_needed()
  assert page.evaluate('document.documentElement.scrollWidth')<=392
  page.screenshot(path=str(ROOT.parent/'screen-render-selection-phone-190.png'))
  print('PASS portrait window checklist, visible submission controls, filtering and timeline multi-selection')
  page.locator('.dialog-head [data-action="close-dialog"]').click()
  page.evaluate('DirectorApp.renderSelection.openIds(["w4"])')
  assert page.locator('#render-context').input_value()==''
  assert page.locator('[data-render-select="submit"]').is_disabled()
  page.locator('#render-context').select_option('fresh')
  assert not page.locator('[data-render-select="submit"]').is_disabled()
  assert 'makes a cut' in page.locator('#render-selection-summary').inner_text()
  page.locator('input[data-render-pick="w3"]').check()
  assert page.locator('#render-context').input_value()==''
  assert page.locator('[data-render-select="submit"]').is_disabled()
  assert page.evaluate('fixture.submitted.length')==1
  assert page.evaluate('fixture.native.length')==1
  print('PASS missing context and changed scope require explicit choice without GPU work')
  assert not errors,errors
  browser.close()
print('Render selection / notification browser workflow passed. Browser and MP4 real; server, GPU and persistence fixtures.')
