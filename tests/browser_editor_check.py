# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Real browser playback/edit controls with an actual MP4; AI/WanGP/finishing HTTP are fixtures."""
import os,re,json,base64,subprocess,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 film=Path(td)/'fixture.mp4'
 subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=640x360:r=24:d=12','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart',str(film)],check=True)
 data='data:video/mp4;base64,'+base64.b64encode(film.read_bytes()).decode()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1580,'height':1100});page.set_default_timeout(20000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="(?:styles|studio|editor).css"[^>]*>','',html);page.set_content(html)
  for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
  page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
  for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
   if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
  page.evaluate("""(media)=>{
    window.fixture={calls:[],blobs:new Map(),media,finished:[],submitted:[],rawInserts:[]};const P=DirectorProviders;
    Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.remember=async()=>{};P.mediaURL=async()=>media;P.saveTrace=async()=>{};P.config.provider='deepseek';P.config.model='deepseek-flash';
    DirectorStore.getBlob=async k=>fixture.blobs.get(k)||null;DirectorStore.putBlob=async(k,b)=>fixture.blobs.set(k,b);
    const p=H3.demo();p.id='editor-project';p.name='Cousin, Let’s Bowl';p.mode='managed';p.modelType='h3_ref2va_pruned_pdd8';p.presetConfirmed=true;p.windows=p.windows.slice(0,3);p.windows.forEach((w,i)=>w.title=['Roman arrives','Roman bowls alone','Niko arrives'][i]);
    const plan=p.windows.map((w,i)=>({id:w.id,title:w.title,task_index:1,window_index:i+1,start_frame:i*96,end_frame:(i+1)*96,frames:96,overlap:0}));
    p.jobs=[{id:'a'.repeat(32),name:'Original finished film',backend:'headless',status:'completed',createdAt:new Date().toISOString(),plan,live:{status:'completed',outputs:[{id:'b'.repeat(32),available:true,cumulative:true,task_index:1,window_index:3,created_at:1}]}}];DirectorStore.save(p);fixture.original=JSON.parse(JSON.stringify(p));
    P.generate=async(system,packet)=>{fixture.rawInserts.push(packet);return JSON.stringify({notes:['Only new B-roll.'],subjects:[],windows:packet.windows.map((w,i)=>({...w,title:i?'Pins reset':'Neon lane detail',summary:'[reference generation] Empty bowling lanes',detail:'[Shot 1] A slow close-up of polished bowling lane wood beneath pink and green neon. No characters appear.',soundscape:'Distant bowling balls roll and pins clatter. No speech.',music:'N/A',entry:'An empty lane.',exit:'Hold on the empty lane.',subjectIds:[],assetIds:[],casting:{}}))});};
    P.call=async(route,b)=>{fixture.calls.push({route,...b});if(route==='studio')return b.action==='list'?{projects:[]}:b.action==='blob-info'?{info:true}:{credentials:{}};
      if(route==='finish'){
        if(b.action==='list')return{jobs:fixture.finished};if(b.action==='get')return fixture.finished.find(x=>x.id===b.id);if(b.action==='context'){const j=fixture.finished.find(x=>x.id===b.id);return{jobId:'prefix-import',outputId:'c'.repeat(32),keepFrames:j.edit.totalFrames};}
        if(b.action==='start'){const j={id:b.id,name:b.edit.name,edit:b.edit,status:fixture.delayPrefix?'running':'completed',message:'MP4 ready (fixture)',upscale:b.upscale||'',progress:100,downloadURL:media,result:{frames:b.edit.totalFrames,width:640,height:360}};fixture.finished.push(j);return j;}
      }
      if(route==='sequence'){if(b.action==='start'){fixture.submitted.push(b.project);return{id:'seq_new',kind:'managed',status:'running',snapshot:b.project,plan:H3Studio.managedPlan(b.project),createdAt:new Date().toISOString(),live:{status:'running',outputs:[]}};}if(b.action==='list')return{runs:[]};if(b.action==='get')return{id:'seq_new',live:{status:'running',outputs:[]}};if(b.action==='manager')return{runs:[],queue:{reachable:true,idle:true,paused:false,jobs:[]}};}
      throw Error('Unexpected fixture route '+route+' '+b.action);
    };
    P.wangp=async(path,method,b)=>{fixture.calls.push({route:'wangp',path,method});if(path==='/health')return{app:'h3-director-wangp',backend:'headless',capabilities:{late_postprocess:true}};if(path.startsWith('/jobs/'))return{status:'running',outputs:[]};throw Error('Unexpected worker path '+path);};
  }""",data)
  page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!DirectorApp?.editor');page.wait_for_function("document.querySelector('#program-video').readyState>=2")
  ids=page.evaluate('DirectorApp.getProject().windows.map(w=>w.id)')
  # Scrub to frame 120 across the first boundary (source 5 s).
  page.evaluate('DirectorApp.editor.seek(120)');page.wait_for_function("Math.abs(document.querySelector('#program-video').currentTime-5)<.08")
  assert page.evaluate('DirectorApp.getSelected()')==ids[1]
  assert abs(page.evaluate('DirectorApp.editor.getTime()')-120)<=1
  # The added render toolbar moves the ruler below the fixed footer at this viewport.
  # Scroll the real control into view before sending raw pointer coordinates.
  page.locator('.timeline-ruler').scroll_into_view_if_needed()
  ruler=page.locator('.timeline-ruler').bounding_box();zoom=page.locator('#zoom').input_value();x=ruler['x']+1.5*float(zoom)
  page.mouse.move(x,ruler['y']+8);page.mouse.down();page.mouse.move(x+.5*float(zoom),ruler['y']+8,steps=5);page.mouse.up();page.wait_for_function("Math.abs(document.querySelector('#program-video').currentTime-2)<.1")
  assert page.evaluate('DirectorApp.getSelected()')==ids[0]
  print('PASS actual video seeks by edit frame; ruler drag crosses clips and updates selection/playhead')
  page.locator('[data-edit="play"]').click();page.wait_for_function("!document.querySelector('#program-video').paused");start=page.evaluate('DirectorApp.editor.getTime()');page.wait_for_timeout(400);assert page.evaluate('DirectorApp.editor.getTime()')>start
  page.evaluate("window.dispatchEvent(new Event('h3-render-change'))");page.wait_for_timeout(250);assert not page.evaluate("document.querySelector('#program-video').paused")
  page.locator('[data-edit="play"]').click();print('PASS playback drives moving playhead and live render refresh does not restart/pause video')
  page.locator('[data-edit="trim"]').click();page.locator('#trim-in').fill('12');page.locator('#trim-out').fill('84');page.locator('[data-edit="trim-apply"]').click();assert page.evaluate('H3Edit.layout(DirectorApp.getProject())[0].kept')==72;assert page.evaluate('H3Edit.layout(DirectorApp.getProject())[1].start')==72
  assert page.evaluate('DirectorApp.getProject().jobs')==page.evaluate('fixture.original.jobs');page.evaluate('DirectorApp.editor.seek(35)');page.wait_for_function("Math.abs(document.querySelector('#program-video').currentTime-47/24)<.1")
  page.locator('[data-edit="split-footage"]').click();assert page.evaluate('DirectorApp.getProject().windows.length')==4;assert page.evaluate('H3Edit.layout(DirectorApp.getProject()).at(-1).end')==264
  page.locator('#undo').click();assert page.evaluate('DirectorApp.getProject().windows.length')==3;page.locator('#undo').click();assert page.evaluate('H3Edit.layout(DirectorApp.getProject()).at(-1).end')==288
  print('PASS real trim controls, ripple timing, footage split, source preservation and undo')
  # New blank windows do not remap the original following video.
  page.evaluate('(id)=>DirectorApp.select(id)',ids[0]);page.locator('[data-edit="insert-after"]').click();page.locator('#insert-count').fill('1');page.locator('[data-edit="insert-manual"]').click();assert page.evaluate('DirectorApp.getProject().windows.length')==4
  assert page.evaluate('(id)=>H3Edit.segment(DirectorApp.getProject(),id).inFrame',ids[1])==96
  page.locator('[data-edit="export"]').click()
  assert page.evaluate('fixture.finished.length')==0
  page.locator('#undo').click();page.evaluate('(id)=>DirectorApp.select(id)',ids[0]);page.locator('[data-edit="insert-after"]').click();page.locator('#insert-request').fill('Add B roll of empty bowling lanes before Niko arrives.');page.locator('[data-edit="insert-ai"]').click();page.wait_for_selector('[data-edit="insert-apply"]');page.locator('[data-insert-field="title"]').first.fill('My lane insert');page.locator('[data-edit="insert-apply"]').click();assert page.evaluate('DirectorApp.getProject().windows.length')==5
  assert page.evaluate('DirectorApp.getProject().windows[1].title')=='My lane insert';assert page.evaluate('fixture.submitted.length')==0
  assert page.evaluate('fixture.rawInserts[0].before.title')=='Roman arrives'
  assert page.evaluate('DirectorApp.getProject().jobs')==page.evaluate('fixture.original.jobs')
  page.locator('#undo').click();assert page.evaluate('DirectorApp.getProject().windows.length')==3
  print('PASS scoped AI inserts preserve original clips; missing footage blocks export; preview/apply is undoable and never auto-renders')
  page.locator('[data-edit="export"]').click();page.locator('[data-edit="finish-submit"]').click();page.wait_for_selector('#finishing-list a[download], #finishing-list a.button.primary');assert page.evaluate('fixture.finished[0].edit.totalFrames')==288;assert page.evaluate('fixture.finished[0].edit.cuts.map(c=>c.inFrame)')==[0,96,192]
  page.locator('[data-action="close-dialog"]').first.click()
  page.evaluate('(id)=>DirectorApp.select(id)',ids[1]);page.locator('[data-edit="upscale"]').click();page.locator('[data-edit="finish-submit"]').click();page.wait_for_selector('#finishing-list');assert page.evaluate('fixture.finished.at(-1).edit.cuts.length')==1;assert page.evaluate('fixture.finished.at(-1).upscale')=='flashvsr*2';page.locator('[data-action="close-dialog"]').first.click()
  print('PASS whole-film and selected-clip finishing submit exact EDL ranges and expose direct download')
  # Single inline regen form builds an edited prefix before managed partial submission.
  page.evaluate('(id)=>DirectorApp.select(id)',ids[1]);page.locator('[data-edit="regenerate"]').click();page.locator('#regen-context').select_option('prefix');page.locator('[data-edit="regen-submit"]').click();page.wait_for_selector('#app-confirm[open]');assert 'Context: prefix' in page.locator('#app-confirm-summary').inner_text();page.locator('[data-app-confirm=cancel]').click();assert page.evaluate('fixture.submitted.length')==0
  page.evaluate('fixture.delayPrefix=true');page.locator('[data-edit="regen-submit"]').click();page.wait_for_selector('#app-confirm[open]');page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.finished.at(-1).status==="running"');page.locator('[data-edit="close-dock"]').click();page.evaluate('()=>{fixture.delayPrefix=false;fixture.finished.at(-1).status="completed";}');page.wait_for_function('!DirectorApp.editor.busy');assert page.evaluate('fixture.submitted.length')==0;assert page.evaluate('intentFixture.records.some(r=>r.state==="cancelled")');print('PASS inline Regenerate close during delayed CPU prefix prevents later dispatch')
  page.locator('[data-edit="regenerate"]').click();page.locator('#regen-context').select_option('prefix');page.locator('[data-edit="regen-submit"]').click();page.wait_for_selector('#app-confirm[open]');page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fixture.submitted.length===1');q=page.evaluate('fixture.submitted[0]');assert q['mode']=='managed';assert q['continuation']['keepFrames']==35;assert q['continuation']['timelineFrames']==96;assert [w['id'] for w in q['windows']]==[ids[1]]
  page.locator('[data-action="close-dialog"]').first.click();print('PASS regeneration uses one inline workflow and the bounded edited tail and separate timeline offset; original later takes untouched')
  # Pagehide cancels even an intent waiting for confirmation/prefix preparation.
  page.locator('[data-edit="regenerate"]').click();page.locator('[data-edit="regen-submit"]').click();page.wait_for_selector('#app-confirm[open]');page.evaluate("window.dispatchEvent(new Event('pagehide'))");page.wait_for_function('!H3Confirm.pending');assert page.evaluate('fixture.submitted.length')==1
  print('PASS pagehide before approval cancels intent without another dispatch')
  # A delayed approval from the previous UI session cannot dispatch after restart.
  page.locator('[data-edit="regenerate"]').click();page.locator('[data-edit="regen-submit"]').click();page.wait_for_selector('#app-confirm[open]')
  page.evaluate("async()=>{window.restartedIntentLedger=H3PendingIntent.create({call:b=>DirectorProviders.call('render-intent',b),owner:sessionStorage.getItem('h3-director:intent-owner'),uid:H3.uid});await restartedIntentLedger.initialize();}")
  page.locator('[data-app-confirm=accept]').click();page.wait_for_timeout(400);assert page.evaluate('fixture.submitted.length')==1
  assert page.evaluate("intentFixture.records.some(r=>r.state==='cancelled')")
  print('PASS delayed approval superseded by UI restart cancels durably and dispatches no second job')
  if page.locator('#dialog').is_visible():page.locator('#dialog [data-action="close-dialog"]').first.click()
  # Main studio screenshot and phone layout.
  page.evaluate('(id)=>DirectorApp.select(id)',ids[0]);page.evaluate('DirectorApp.editor.seek(30)');page.wait_for_timeout(300)
  assert page.evaluate("()=>{const v=document.querySelector('#program-video'),c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').drawImage(v,0,0);return v.readyState>=2 && c.getContext('2d').getImageData(320,180,1,1).data[2]>200}")
  page.locator('.program-panel').scroll_into_view_if_needed();page.wait_for_timeout(350);out=Path(os.environ.get('H3_TEST_SCREENSHOTS',str(ROOT.parent/'browser-screenshots')));out.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(out/'screen-editor-desktop-130.png'))
  page.set_viewport_size({'width':412,'height':915});page.locator('.cut-toolbar').scroll_into_view_if_needed();page.screenshot(path=str(out/'screen-editor-phone-130.png'))
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+2')
  assert not errors,errors;print('PASS desktop/phone editing controls and no JavaScript page errors')
  browser.close()
