"""Actual editor, browser controls and phone layout. Offline renderer responses."""
import json,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1440,'height':1050});page.set_default_timeout(15000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text())
 html=re.sub(r'<link[^>]*href="(?:styles|studio|editor).css"[^>]*>','',html);page.set_content(html)
 for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 for f in ['core.js', 'studio-core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'backend-ui.js', 'sequence-ui.js', 'ai-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:
  page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{
  const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});P.init=async()=>true;P.remember=async()=>{};P.persist=()=>{};
  DirectorStore.getBlob=async()=>null;DirectorStore.putBlob=async()=>{};
  const p=H3.demo();p.id='sequence-ui-project';p.mode='managed';p.jobs=[];
  const terminal=s=>['completed','failed','cancelled','retired'].includes(s);
  window.fixture={backend:'headless',requests:[],queuePaused:true,offline:false,runs:[],project:p};
  const f=fixture;
  window.makeRun=(id,name,status='paused')=>({id,name,backendMode:'headless',projectId:p.id,status,phase:status==='cancelling'?'rendering':'between_windows',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),index:2,total:12,outputs:2,activeJobId:null,cancelRequested:status==='cancelling',pauseAfterWindow:true,message:status==='cancelling'?'Waiting for renderer cancellation acknowledgement.':'Paused by user.',archivedAt:null,events:[],busy:false});
  f.runs=[makeRun('seq_old_cancel','Cousin, Let’s Bowl · older attempt','cancelling'),makeRun('seq_park','Cousin, Let’s Bowl · current film','paused')];
  const row=r=>{
   const foreign=(r.backendMode||'legacy')!==f.backend,done=terminal(r.status);
   return {...r,backend:{recorded:r.backendMode||'legacy',current:f.backend,inferred:!r.backendMode,mismatch:foreign},
    label:r.status==='retired'?'Retired locally':foreign?'Other backend':r.status==='paused'?'Parked':r.status==='cancelling'?'Cancelling':r.status,
    parked:!foreign&&r.status==='paused'&&!f.offline,blocking:!done&&(foreign||r.status!=='paused'||f.offline),
    reason:r.status==='retired'?'Tracking retired locally; no renderer cancellation was performed.':foreign?'This checkpoint uses another backend. Restore the matching backend, or retire old tracking after stopping that renderer.':done?'Finished; does not block new work.':r.status==='paused'?'Parked safely. Does not reserve the renderer.':'Cancellation remains active until WanGP confirms it stopped.',
    observed:{checkedAt:new Date().toISOString(),reachable:!foreign&&!f.offline,idleConfirmed:!foreign&&!f.offline,job:null,unknown:false,error:foreign?'Backend mismatch':f.offline?'Renderer offline':null},
    actions:{retire:foreign&&!done,pause:!foreign&&r.status==='running',resume:!foreign&&r.status==='paused'&&!f.offline,cancel:!foreign&&!done&&!r.cancelRequested,reconcile:!foreign&&!done,endIdle:!foreign&&!done&&!f.offline,archive:done&&!r.archivedAt,restore:done&&!!r.archivedAt}};
  };
  const publicRun=r=>({id:r.id,kind:'managed',name:r.name,status:r.status,url:P.config.wangpUrl,createdAt:r.createdAt,plan:H3.renderPlan(p),snapshot:{...p,jobs:[]},live:{job_id:r.id,status:r.status,message:r.message,outputs:[],sequence:{phase:r.phase,window:r.index+1,total:r.total}}});
  P.call=async(route,b)=>{
   f.requests.push({route,...b});
   if(route==='studio')return{projects:[],credentials:{}};
   if(route!=='sequence')throw Error('No external request allowed: '+route);
   if(b.action==='manager')return{backend:f.backend,queue:{reachable:!f.offline,paused:f.queuePaused,idle:true,active_job_id:null,jobs:[],error:f.offline?'Renderer offline':null},runs:f.runs.map(row),checkedAt:new Date().toISOString(),canSubmitManaged:!f.queuePaused&&!f.offline&&!f.runs.some(r=>row(r).blocking),explanation:f.runs.some(r=>row(r).blocking)?'Resolve or retire the blocking records shown below.':f.queuePaused?'WanGP is idle but its queue is paused. Unpause it separately.':'Ready for a new managed sequence.'};
   if(b.action==='list')return{runs:f.runs};
   if(b.action==='clear-idle-preview'||b.action==='clear-idle'){
    return{queuePaused:f.queuePaused,results:b.ids.map(id=>{const r=f.runs.find(r=>r.id===id);if(f.offline||terminal(r.status)||row(r).backend.mismatch)return{id,name:r.name,eligible:false,cleared:false,reason:'Unavailable or already finished.'};
     if(b.action==='clear-idle-preview')return{id,name:r.name,eligible:true,status:r.status,outputs:r.outputs};
     r.status='cancelled';r.phase='finished';r.cancelRequested=true;r.message='Sequence cancelled. Saved media remains.';r.events.push({at:new Date().toISOString(),action:'end-idle',message:'Verified renderer idle, record backed up.'});return{id,name:r.name,cleared:true,reason:r.message};})};
   }
   const r=f.runs.find(r=>r.id===b.id);if(!r)throw Error('Unknown sequence');
   if(b.action==='diagnostics')return{...r,backend:row(r).backend,project:p,plan:H3.renderPlan(p),observation:row(r).observed,lastBackup:'fixture-backup.json'};
   if(b.action==='retire-preview')return{...r,backend:row(r).backend,revision:r.updatedAt};
   if(b.action==='retire'){
    if(!b.acknowledgeOtherRendererStopped||b.expectedBackend!==row(r).backend.recorded||b.expectedCurrentBackend!==f.backend||b.revision!==r.updatedAt)throw Error('Invalid retirement');
    r.retirement={at:new Date().toISOString(),previousStatus:r.status,previousPhase:r.phase,rendererCancellationVerified:false};
    r.status='retired';r.phase='tracking_ended';r.archivedAt=new Date().toISOString();r.message='Tracking retired locally; outputs retained.';r.events.push({at:r.archivedAt,action:'retire-other-backend',message:r.message});
   }
   if(b.action==='pause'){r.pauseAfterWindow=true;r.status='paused';}
   if(b.action==='resume'){r.status='running';r.pauseAfterWindow=false;}
   if(b.action==='cancel'){r.cancelRequested=true;r.status='cancelling';}
   if(b.action==='reconcile'&&r.cancelRequested){r.status='cancelled';r.phase='finished';}
   if(b.action==='archive')r.archivedAt=new Date().toISOString();
   if(b.action==='restore')r.archivedAt=null;
   return publicRun(r);
  };
  P.wangp=async(path,method='GET')=>{
   f.requests.push({route:'wangp',path,method});
   if(path.includes('/jobs/seq_'))throw Error('BUG: sequence ID sent to native renderer');
   if(path==='/queue/resume'){f.queuePaused=false;return{};}
   if(path==='/queue/pause'){f.queuePaused=true;return{};}
   if(path==='/queue')return{paused:f.queuePaused,jobs:[]};
   if(path==='/health')return{runtime_state:'ready',version:'1.2.0',runtime:{root:'/fixture/WanGP'}};
   throw Error('Unexpected worker route '+path);
  };
  p.jobs=[publicRun(f.runs[0])];DirectorStore.save(p);
 }""")
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.sequences')
 original=page.evaluate('DirectorApp.getProject().windows')
 page.locator('#managed-sequences').click();page.wait_for_selector('[data-seq-card="seq_park"]')
 assert 'WanGP queue is paused' in page.locator('#sequence-manager').inner_text()
 assert 'does not reserve' in page.locator('[data-seq-card="seq_park"]').inner_text()
 assert not page.locator('[data-seq-card="seq_old_cancel"] [data-seq-action="resume"]').count()
 assert page.evaluate('fixture.requests.filter(r=>r.route==="sequence").every(r=>["manager","get"].includes(r.action))')
 print('PASS main Sequences button shows all projects, parked vs cancelling, renderer idle vs queue pause; refresh is read-only')
 page.screenshot(path=str(ROOT.parent/'screen-sequence-manager-122.png'))
 page.locator('[data-seq-action="clear-preview"]').click();page.wait_for_selector('#seq-confirm-clear')
 assert 'older attempt' in page.locator('#seq-cleanup').inner_text();assert 'current film' in page.locator('#seq-cleanup').inner_text()
 page.locator('#seq-confirm-clear').click();page.wait_for_selector('#sequence-manager');page.wait_for_function('fixture.runs.every(r=>r.status==="cancelled")')
 assert page.evaluate('fixture.queuePaused')
 assert page.evaluate('DirectorApp.getProject().windows')==original
 print('PASS bulk idle cleanup has explicit preview/confirmation, keeps queue paused, and preserves creative state')
 page.locator('[data-seq-action="queue-resume"]').click();page.wait_for_selector('[data-seq-action="queue-pause"]')
 assert page.evaluate('fixture.requests.filter(r=>r.route==="sequence"&&r.action==="resume").length')==0
 print('PASS unpausing native dispatch does not resume a managed sequence')
 page.locator('[data-seq-card="seq_old_cancel"] [data-seq-action="archive"]').click();page.wait_for_function('!!fixture.runs[0].archivedAt')
 page.locator('#sequence-filter').select_option('history');page.locator('[data-seq-card="seq_old_cancel"] [data-seq-action="restore"]').click();page.wait_for_function('fixture.runs[0].archivedAt===null')
 page.locator('[data-seq-card="seq_old_cancel"] [data-seq-action="inspect"]').click();page.wait_for_selector('#sequence-detail .seq-log')
 assert 'record backed up' in page.locator('#sequence-detail').inner_text()
 with page.expect_download() as dl:page.locator('[data-seq-action="download"]').click()
 d=json.loads(Path(dl.value.path()).read_text());assert d['id']=='seq_old_cancel';assert d['events'][0]['action']=='end-idle'
 print('PASS history/restore and diagnostic event log preserve records without deletion')
 page.locator('[data-seq-action="open"]').click();page.wait_for_selector('#sequence-filter');page.locator('#sequence-filter').select_option('all')
 # Import a fixture active run into the actual project, then cancel from the old monitor.
 page.evaluate("fixture.runs.push(makeRun('seq_new_render','Another take','running'))")
 page.locator('[data-seq-action="refresh"]').click();page.wait_for_selector('[data-seq-card="seq_new_render"]')
 page.locator('[data-seq-card="seq_new_render"] [data-seq-action="attach"]').click();page.wait_for_function("DirectorApp.getProject().jobs.some(j=>j.id==='seq_new_render')")
 page.locator('#dialog [data-action="close-dialog"]').click();page.locator('header [data-action="renders"]').click()
 page.locator('#dialog [data-job="seq_new_render"]').click();page.wait_for_selector('[data-cancel-job="seq_new_render"]')
 page.locator('[data-cancel-job="seq_new_render"]').click();page.wait_for_selector('#sequence-manager');page.wait_for_function("fixture.runs.at(-1).status==='cancelling'")
 assert page.evaluate("fixture.requests.some(r=>r.route==='sequence'&&r.action==='cancel'&&r.id==='seq_new_render')")
 assert not page.evaluate("fixture.requests.some(r=>r.route==='wangp'&&r.path?.includes('/jobs/seq_'))")
 print('PASS existing Render monitor cancels through the sequence API, never native /jobs/seq_')
 page.locator('[data-seq-card="seq_new_render"] [data-seq-action="reconcile"]').click();page.wait_for_function("fixture.runs.at(-1).status==='cancelled'")
 page.evaluate("fixture.offline=true;fixture.runs.push(makeRun('seq_offline','<img src=x onerror=alert(1)> · unsafe label'))")
 page.locator('[data-seq-action="refresh"]').click();page.wait_for_selector('[data-seq-card="seq_offline"]')
 assert page.locator('[data-seq-card="seq_offline"] img').count()==0
 assert page.locator('[data-seq-card="seq_offline"] [data-seq-action="end-idle"]').count()==0
 page.locator('[data-seq-action="clear-preview"]').click();page.wait_for_selector('#seq-confirm-clear');assert page.locator('#seq-confirm-clear').is_disabled()
 print('PASS unreachable worker disables cleanup and untrusted project text is escaped')
 page.locator('[data-seq-action="open"]').click();page.wait_for_selector('#sequence-filter')
 page.evaluate("fixture.offline=false;fixture.queuePaused=true;fixture.runs=fixture.runs.filter(r=>r.id==='seq_offline');fixture.runs[0].name='Cousin, Let’s Bowl · parked for later';fixture.runs.push(makeRun('seq_phone','Earlier attempt','cancelling'))")
 page.locator('[data-seq-action="refresh"]').click();page.wait_for_selector('[data-seq-card="seq_phone"]')
 page.set_viewport_size({'width':412,'height':915});page.wait_for_timeout(150)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 assert page.evaluate('document.querySelector("#dialog").scrollWidth<=document.querySelector("#dialog").clientWidth+1')
 for b in page.locator('#sequence-manager .seq-actions button').all():assert b.bounding_box()['height']>=40
 page.screenshot(path=str(ROOT.parent/'screen-sequence-phone-122.png'))
 # User screenshot: six saved windows, legacy/untagged record, cancelling state with old cancelled phase.
 page.evaluate("fixture.requests=[];fixture.queuePaused=false;fixture.runs=[{...makeRun('seq_1ab0c0f98085146b0cda55ee8ebd40b7','Bowling Alone · pacing copy','cancelling'),backendMode:null,phase:'cancelled',index:6,total:14,outputs:6}]")
 page.locator('[data-seq-action="refresh"]').click();page.wait_for_selector('[data-seq-action="retire-preview"]')
 card=page.locator('[data-seq-card="seq_1ab0c0f98085146b0cda55ee8ebd40b7"]')
 assert 'other backend' in card.locator('.seq-badge').inner_text().lower()
 assert 'Record: Legacy browser plugin' in card.inner_text()
 assert 'Director now: Headless worker' in card.inner_text()
 assert 'Saved phase: cancelled' in card.inner_text()
 assert card.locator('[data-seq-action="reconcile"]').count()==0
 assert 'Director keeps checking cancellation' not in card.inner_text()
 page.screenshot(path=str(ROOT.parent/'screen-backend-mismatch-123.png'))
 print('PASS screenshot regression: explicit recorded/current backend and saved phase; no useless reconcile/poll claim')
 page.locator('[data-seq-action="retire-preview"]').click();page.wait_for_selector('#seq-confirm-retire')
 assert page.locator('#seq-confirm-retire').is_disabled()
 assert '6 saved output(s) are kept' in page.locator('#seq-retirement').inner_text()
 assert 'does not cancel' in re.sub(r'\s+',' ',page.locator('#seq-retirement').inner_text())
 page.locator('#seq-retire-ack').check();assert page.locator('#seq-confirm-retire').evaluate("el => !el.disabled")
 page.screenshot(path=str(ROOT.parent/'screen-retirement-confirm-123.png'))
 page.locator('#seq-confirm-retire').click();page.wait_for_selector('#sequence-manager');page.wait_for_function("fixture.runs[0].status==='retired'")
 page.locator('#sequence-filter').select_option('history');page.wait_for_selector('[data-seq-card="seq_1ab0c0f98085146b0cda55ee8ebd40b7"]')
 assert 'retired locally' in page.locator('#sequence-cards').inner_text().lower()
 assert page.evaluate('fixture.runs[0].outputs')==6
 assert page.evaluate("fixture.requests.filter(r=>r.route==='wangp').length")==0
 assert page.evaluate("fixture.requests.filter(r=>r.route==='sequence').every(r=>['manager','get','retire-preview','retire'].includes(r.action))")
 assert not page.locator('#sequence-cards [data-seq-action="resume"]').count()
 page.screenshot(path=str(ROOT.parent/'screen-retired-history-123.png'))
 print('PASS mobile retirement requires consent, preserves saved outputs, moves to history, and sends no renderer/queue actions')
 page.locator('[data-seq-action="inspect"]').click();page.wait_for_selector('#sequence-detail')
 assert 'Previous state: cancelling' in page.locator('#sequence-detail').inner_text()
 assert 'previous phase: cancelled' in page.locator('#sequence-detail').inner_text()
 page.locator('[data-seq-action="open"]').click();page.wait_for_selector('#sequence-filter');page.locator('#sequence-filter').select_option('all')
 page.locator('[data-seq-action="restore"]').click();page.wait_for_function('fixture.runs[0].archivedAt===null')
 assert page.evaluate('fixture.runs[0].status')=='retired'
 assert 'No dispatch reservation' in page.locator('#sequence-cards').inner_text()
 print('PASS retirement history restore is visibility only, not a resume')
 page.evaluate("fixture.backend='legacy';fixture.runs=[makeRun('seq_wrong_launch','Keep my headless attempt','paused')]")
 page.locator('[data-seq-action="refresh"]').click();page.wait_for_selector('[data-seq-card="seq_wrong_launch"]')
 assert 'node start-headless.mjs' in page.locator('#sequence-manager').inner_text()
 page.locator('[data-seq-action="retire-preview"]').click();page.wait_for_selector('#seq-retirement')
 assert 'Do not retire one you intend to resume' in page.locator('#seq-retirement').inner_text()
 assert page.locator('#seq-confirm-retire').is_disabled()
 assert page.evaluate('fixture.runs[0].status')=='paused'
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
 assert page.evaluate('document.querySelector("#dialog").scrollWidth<=document.querySelector("#dialog").clientWidth+1')
 print('PASS inverse mismatch explains wrong launch command before destructive-to-tracking retirement')
 assert page.evaluate('DirectorApp.getProject().windows')==original
 assert not errors,errors
 print('PASS responsive phone manager, touch-sized controls, no horizontal overflow or JavaScript errors')
 browser.close()
