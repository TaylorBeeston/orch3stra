# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Real browser controls + automatic refresh; synthetic worker/HTTP responses, no live GPU."""
import os,re,json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1550,'height':1150});page.set_default_timeout(15000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="(?:styles|studio|editor).css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
 for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
 scripts=re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text())
 for f in scripts:
  if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{
 const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>true});P.init=async()=>true;P.remember=async()=>{};P.persist=()=>{};
 DirectorStore.getBlob=async()=>null;DirectorStore.putBlob=async()=>{};
 const p=H3.demo();p.id='overview-project';p.mode='managed';
 const plan=H3Studio.managedPlan(p),sid='seq_live',native='a'.repeat(32);
 window.f={calls:[],steps:3,offline:false,paused:false,done:false,polls:0,hidden:false,recovered:false};
 const r={id:sid,name:'Cousin, Let’s Bowl',backendMode:'headless',project:p,plan,index:1,status:'running',phase:'rendering',activeJobId:native,createdAt:new Date(Date.now()-780000).toISOString(),updatedAt:new Date().toISOString(),outputs:[],events:[],submissions:[],timingSamples:[{index:0,span:plan[0].span,seconds:360,nativeElapsed:330}]};
 function snap(){
  r.status=f.done?'completed':f.paused?'paused':'running';r.index=f.done?4:1;r.phase=f.done?'finished':'rendering';r.activeJobId=f.done?null:native;
  const current={...plan[1],window_index:1,status:f.done?'completed':'running',phase:'inference',completed_steps:f.steps,total_steps:8,elapsed_seconds:110,denoising_seconds:94,last_step_seconds:30,last_event_age_seconds:2,step_elapsed_seconds:14,seconds_per_step:{seconds:30,low:23,high:39,samples:3},denoising_eta:{seconds:136,low:110,high:190}};
  r.native={job_id:native,status:f.done?'completed':'running',project_name:r.name,message:'Denoising H3 window 2',telemetry:{current,elapsed_seconds:135,generation_elapsed_seconds:120,queue_wait_seconds:15,complete_windows:0,windows:[current]},outputs:[]};
  const telemetry=H3Progress.managedTelemetry(r),live={job_id:sid,status:r.status,telemetry,message:r.native.message,outputs:[],sequence:{phase:r.phase,window:r.index+1,total:4}};
  const row={...r,projectId:p.id,backend:{recorded:'headless',current:'headless',mismatch:false},live,liveVerified:true,message:live.message,total:4,windowTitle:plan[1].title,outputRecords:[],outputs:r.index,actions:{reconcile:!f.done,resume:f.paused,cancel:!f.done,pause:!f.paused&&!f.done},blocking:!f.done&&!f.paused,parked:f.paused,observed:{reachable:true,job:r.native},label:r.status,reason:'Verified renderer state'};
  delete row.project;delete row.native;
  const recovery={id:'seq_mismatch',name:'Previous take · saved frame mismatch',projectId:p.id,backend:{recorded:'headless',current:'headless',mismatch:false},status:'cancelled',phase:'finished',index:2,total:4,plan,createdAt:r.createdAt,updatedAt:r.updatedAt,outputRecords:[],live:{status:'cancelled',outputs:[],message:'Sequence cancelled. Native file kept.'},liveVerified:true,actions:{recoverOutput:true,archive:true},observed:{reachable:true},error:'Saved prefix is 760 frames at 24 fps; expected exactly 763.',archivedAt:null,blocking:false};
  return {version:1,checkedAt:new Date().toISOString(),backend:'headless',health:{runtime_state:'ready'},queue:{reachable:true,paused:false,idle:f.done,active_job_id:f.done?null:native,jobs:[r.native]},sequences:[row,recovery],nativeJobs:[r.native],canSubmitManaged:f.done,nextPollMs:150,explanation:'Test snapshot'};
 }
 window.makeProgress=snap;
 p.jobs=[{id:sid,kind:'managed',backend:{recorded:'headless',current:'headless'},name:r.name,status:'running',url:'http://obsolete-host:9876',createdAt:r.createdAt,plan,snapshot:JSON.parse(JSON.stringify({...p,jobs:[]})),live:{status:'running',outputs:[]}}];
 DirectorStore.save(p);
 P.call=async(route,b)=>{f.calls.push({route,...b});if(route==='studio')return{projects:[],credentials:{}};
  if(route==='render-progress'){f.polls++;if(f.offline)throw Error('Renderer connection lost (fixture)');return snap();}
  if(route==='sequence'){
   if(b.action==='recover-preview')return{id:'seq_mismatch',name:'Previous take',revision:'rev1',outputId:'b'.repeat(32),expected:763,probe:{fps:24,frames:760},index:2,total:4};
   if(b.action==='recover-output'){if(!b.confirm)throw Error('Confirmation required');f.recovered=true;return{id:'seq_recovered',kind:'managed',status:'paused',name:'Previous take · recovered',plan,snapshot:{...p,jobs:[]},live:{status:'paused',message:'Recovered and parked',outputs:[]}};}
   if(b.action==='manager')return{...snap(),runs:snap().sequences};
   if(b.action==='get')return{id:sid,plan,live:snap().sequences[0].live};
   if(b.action==='diagnostics')return{...r,observation:{job:r.native},plan,events:[]};
   throw Error('Unexpected sequence action '+b.action);
  }
  throw Error('Unexpected route '+route);
 };
 P.wangp=async(path,method='GET')=>{f.calls.push({route:'wangp',path,method});if(path.startsWith('/jobs/'))return snap().nativeJobs[0];if(path==='/queue')return snap().queue;if(path==='/health')return snap().health;throw Error('Unexpected renderer route');};
 }""")
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('DirectorApp?.progress?.enabled');page.wait_for_selector('#render-overview [data-progress-card="seq_live"]')
 before=page.evaluate('JSON.stringify(DirectorApp.getProject().windows)')
 assert 'Cousin, Let’s Bowl' in page.locator('#render-overview').inner_text()
 page.wait_for_function('f.polls>=2')
 page.evaluate('f.steps=4')
 page.wait_for_function("document.querySelector('#render-overview').textContent.includes('4 / 8 H3 steps')")
 assert page.evaluate('DirectorApp.getProject().jobs[0].live.telemetry.current.completed_steps')==4
 assert page.evaluate('DirectorApp.getProject().jobs[0].live.telemetry.current.window_index')==2
 print('PASS automatic progress refresh updates main monitor and object-backend/stale-URL managed job without manual refresh')
 page.locator('#render-overview-button').click();page.wait_for_selector('#render-overview-full')
 assert page.locator('#render-overview-full [data-progress-card="seq_live"]').count()==1
 assert page.locator('#render-overview-full [data-progress-card="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]').count()==0
 assert 'Whole film remaining' in page.locator('#render-overview-full').inner_text()
 assert 'Typical H3 step' in page.locator('#render-overview-full').inner_text()
 assert 'Last renderer event' in page.locator('#render-overview-full').inner_text()
 page.evaluate('f.steps=5');page.wait_for_function("document.querySelector('#render-overview-full').textContent.includes('5 / 8 H3 steps')")
 page.screenshot(path=str(ROOT.parent/'render-overview-desktop-124.png'))
 print('PASS full live overview deduplicates native managed subtasks, shows step/window/film timings, and auto updates while open')
 page.evaluate('f.offline=true');page.wait_for_function("document.querySelector('#render-overview').textContent.includes('Connection lost')")
 assert 'Unavailable / stale' in page.locator('#render-overview-full').inner_text()
 assert page.evaluate('DirectorApp.getProject().jobs[0].live.telemetry.current.completed_steps')==5
 page.evaluate('f.offline=false');page.evaluate("window.dispatchEvent(new Event('online'))")
 page.wait_for_function("document.querySelector('#render-overview [data-rc-fresh]').textContent.includes('Live')")
 print('PASS connection failure marks snapshots stale and stops ETA claims, then reconnects automatically without starting or cancelling work')
 calls=page.evaluate('f.polls');page.evaluate("window.dispatchEvent(new Event('focus'))")
 page.wait_for_function(f'f.polls>{calls}')
 calls=page.evaluate('f.polls');page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
 page.wait_for_function(f'f.polls>{calls}')
 print('PASS returning to a phone tab/window triggers immediate read-only refresh')
 page.evaluate('f.paused=true');page.evaluate('DirectorApp.progress.refresh()')
 page.wait_for_function("document.querySelector('#render-overview-full').textContent.includes('Paused / stopping')")
 assert not page.evaluate("f.calls.some(c=>['start','resume','cancel','generate'].includes(c.action))")
 page.evaluate('f.paused=false')
 page.set_viewport_size({'width':412,'height':915});page.evaluate('DirectorApp.progress.refresh()')
 page.screenshot(path=str(ROOT.parent/'render-overview-phone-124.png'))
 assert page.evaluate('document.querySelector("#dialog-body").scrollWidth<=document.querySelector("#dialog-body").clientWidth+2')
 print('PASS parked versus active state and phone layout are readable without horizontal overflow')
 page.locator('#render-overview-full [data-seq-action="recover-preview"]').click();page.wait_for_selector('#seq-confirm-recovery')
 assert '760 frames' in page.locator('#seq-recovery').inner_text()
 assert not page.evaluate('f.recovered')
 page.locator('#seq-confirm-recovery').click();page.wait_for_function('f.recovered')
 assert page.evaluate("DirectorApp.getProject().jobs.some(j=>j.id==='seq_recovered'&&j.status==='paused')")
 assert not page.evaluate("f.calls.some(c=>c.route==='wangp'&&c.method==='POST')")
 assert page.evaluate('JSON.stringify(DirectorApp.getProject().windows)')==before
 print('PASS saved-window recovery is previewed and confirmation-gated, returns a parked copy, and preserves creative fields')
 page.locator('#dialog [data-action="close-dialog"]').click();page.locator('#render-overview-button').click();page.wait_for_selector('#render-overview-full')
 page.evaluate('f.done=true;f.steps=8');page.evaluate('DirectorApp.progress.refresh()')
 page.wait_for_function("DirectorApp.getProject().jobs[0].status==='completed'")
 assert 'Finished' in page.locator('#render-overview-full [data-progress-card="seq_live"]').inner_text()
 assert not errors,errors
 print('PASS completion refreshes automatically and clears ETA; no browser JavaScript errors')
 page.evaluate('''()=>{const P=DirectorProviders,old=P.call;P.call=async(route,b)=>{const result=await old(route,b);if(route==='render-progress'){const r=result.sequences.find(x=>x.id==='seq_live');r.status='failed';r.phase='finished';r.index=0;r.activeJobId=null;r.live.status='failed';r.live.message='Headless job failed.';r.error='Unknown settings: mask, audio_file (use audio_scale). Model-specific options belong in custom_settings.';}return result;};DirectorApp.progress.refresh();}''')
 page.wait_for_function("document.querySelector('#render-overview-full [data-progress-card=\"seq_live\"]').textContent.includes('Failed — not completed')")
 failed=page.locator('#render-overview-full [data-progress-card="seq_live"]')
 assert failed.locator('.rc-phase').inner_text()=='failed'
 assert '0 / 4 windows saved' in failed.inner_text()
 assert 'Unknown settings: mask, audio_file' in failed.inner_text()
 assert 'Finished' not in failed.inner_text()
 assert not errors,errors
 print('PASS failed zero-output render is labelled Failed / not completed, not Finished')
 browser.close()
