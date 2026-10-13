"""Real offline Chromium audio/UI; transport, model rendering and IndexedDB are fixtures."""
import os,re,json,base64,subprocess,tempfile,io,wave,math,struct
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 td=Path(td);v=td/'v.mp4';a=td/'source.wav'
 subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','testsrc2=s=480x270:r=24:d=8','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',str(v)],check=True)
 with wave.open(str(a),'wb') as f:
  f.setparams((2,2,48000,0,'NONE','not compressed'))
  for k in range(6*48000):
   t=k/48000;x=int(12000*math.sin(2*math.pi*440*t)) if 1<t<2 or 3<t<5 else 0
   f.writeframesraw(struct.pack('<hh',x,-x))
 video='data:video/mp4;base64,'+base64.b64encode(v.read_bytes()).decode();audio='data:audio/wav;base64,'+base64.b64encode(a.read_bytes()).decode()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(15000);errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+\.css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
  for f in re.findall(r'<link[^>]*href="([^"]+\.css)"',(ROOT/'index.html').read_text()):page.add_style_tag(content=(ROOT/f).read_text())
  page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
  for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
   if f!='app.js':page.add_script_tag(content=(ROOT/f).read_text())
  page.evaluate("""async({audio,video})=>{
   window.fixture={audio,video,blobs:new Map(),jobs:new Map(),calls:[]};fixture.blobs.set('sound-source',await(await fetch(audio)).blob());
   const p=H3.demo();p.id='sound-project';p.name='An evening · soundtrack test';p.mode='managed';p.windows=p.windows.slice(0,2);p.windows.forEach((w,i)=>{w.id='w'+i;w.frames=96;w.overlap=0;});
   p.jobs=[{id:'a'.repeat(32),name:'Finished take',backend:'headless',status:'completed',createdAt:'2026-01-01',plan:p.windows.map((w,i)=>({id:w.id,task_index:1,window_index:i+1,start_frame:i*96,end_frame:(i+1)*96,frames:96,overlap:0})),live:{status:'completed',outputs:[{id:'b'.repeat(32),available:true,cumulative:true,task_index:1,window_index:2,created_at:1}]}}];
   p.subjects=[{id:'speaker',number:1,name:'Alex',speakerId:'S1',assetIds:[]}];p.windows[0].subjectIds=['speaker'];p.windows[0].detail='[Shot 1] Alex looks up. <Subject 1> (S1) says, <d>[English] Here we go.</d> Hold the room.';H3Scenes.setScenes(p,[{id:'opening',name:'Opening scene',windowIds:['w0'],bankIds:[]},{id:'later',name:'Next scene',windowIds:['w1'],bankIds:[]}]);
   DirectorStore.getBlob=async k=>fixture.blobs.get(k)||null;DirectorStore.putBlob=async(k,b)=>fixture.blobs.set(k,b);await DirectorStore.save(p);fixture.original=H3.clone(p);
   const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.mediaURL=async()=>video;P.studioBlob=async(k,b)=>{fixture.blobs.set(k,b);return{key:k,size:b.size}};P.getStudioBlob=async k=>fixture.blobs.get(k);
   P.call=async(route,b)=>{fixture.calls.push({route,...b});if(route==='studio')return b.action==='list'?{projects:[]}:{credentials:{}};if(route==='finish')return{jobs:[]};if(route==='reference-agent')return{runs:[]};if(route==='sequence')return{runs:[],canSubmitManaged:true,queue:{idle:true,reachable:true,paused:false,jobs:[]}};
    if(route==='sounds'){
     if(b.action==='list')return{jobs:[...fixture.jobs.values()]};if(b.action==='start'){const j={id:b.id,projectId:p.id,name:b.name||'Imported soundtrack compilation',revision:1,status:'ready',message:'Candidate samples ready.',duration:6,progress:1,source:{id:'sound-source',name:'Compilation source.wav',type:'audio/wav',kind:'audio',sha256:'e'.repeat(64),duration:6},options:{method:'silence',thresholdDb:-42,minGap:.45,minLength:.25,padding:.12},peaks:Array.from({length:300},(_,i)=>i>50&&i<100||i>150&&i<250?.35:0),samples:[{id:'sample-one',name:'Sample 1',start:.88,end:2.12,category:'unclassified',keep:true},{id:'sample-two',name:'Sample 2',start:2.88,end:5.12,category:'unclassified',keep:true}],media:[],warnings:[]};fixture.jobs.set(j.id,j);return j;}
     const j=fixture.jobs.get(b.id);if(b.action==='get'||b.action==='report')return j;if(b.action==='save-samples'){j.samples=H3Sound.samples(b.samples,6);j.media=j.samples.filter(x=>x.keep).map((r,i)=>({id:'saved-'+i,kind:'audio',name:r.name+'.wav',category:r.category,type:'audio/wav',duration:r.end-r.start,size:fixture.blobs.get('sound-source').size,sha256:'f'.repeat(64),provenance:{libraryId:j.id,sourceId:'sound-source',rangeSeconds:[r.start,r.end]}}));for(const x of j.media)fixture.blobs.set(x.id,fixture.blobs.get('sound-source'));j.revision++;j.status='ready';j.message='Saved samples.';return j;}
    }throw Error('Unexpected '+route+' '+b.action);
   };P.wangp=async()=>({jobs:[]});
   new MutationObserver(()=>{for(const m of document.querySelectorAll('audio[src]')){const src=m.getAttribute('src');if(src?.startsWith('/api/studio-blob'))m.src=audio;}}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
  }""",{'audio':audio,'video':video})
  page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp?.sounds')
  page.locator('.workspace-navigation [data-workspace-area="post"]').click();page.locator('#workspace-home [data-post="open"]').click();page.locator('[data-post="start-all"]').click();page.wait_for_function('DirectorApp.getProject().postEdit?.clips.length===2');page.evaluate('DirectorApp.post.seek(24)')
  page.locator('[data-sound="open"]').last.click();page.locator('[data-sound="examples"]').click();assert 'NirnxVtIcRc' in page.locator('#sound-links').input_value();assert not page.evaluate('fixture.calls.some(x=>x.route==="sounds"&&x.action==="start")')
  page.locator('#sound-upload').set_input_files(str(a));page.wait_for_selector('[data-sound-row]');page.wait_for_function('document.querySelector("#sound-player").readyState>=1')
  assert page.locator('[data-sound-row]').count()==2
  page.locator('[data-sound="preview"]').first.click();page.wait_for_function('!document.querySelector("#sound-player").paused');page.wait_for_timeout(250);page.evaluate('document.querySelector("#sound-player").pause()')
  page.evaluate('document.querySelector("#sound-player").currentTime=1.4');page.locator('[data-sound="set-in"]').first.click();page.wait_for_function('Math.abs(document.querySelector("#sound-player").currentTime-1.4)<.1')
  assert page.locator('[data-sound-field="start"]').first.input_value()=='1.4'
  page.locator('[data-sound-field="name"]').first.fill('Opening bass sting');page.locator('[data-sound-field="category"]').first.select_option('sting');page.locator('[data-sound-field="keep"]').nth(1).uncheck()
  page.locator('[data-sound="save"]').click();page.evaluate('DirectorApp.sounds.poll()');page.wait_for_function('DirectorApp.getProject().postMedia?.length===1')
  assert page.evaluate('DirectorApp.getProject().soundLibraries.length')==1
  assert page.evaluate('DirectorApp.getProject().assets')==page.evaluate('fixture.original.assets')
  for dismiss in page.locator('[aria-label="Dismiss activity"]').all():
   if dismiss.is_visible(): dismiss.click()
  page.evaluate('document.querySelector("#dialog-body").scrollTop=0')
  page.screenshot(path=str(ROOT.parent/'sound-library-desktop.png'),full_page=False)
  page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(100);assert page.evaluate('document.documentElement.scrollWidth')<=392
  page.locator('[data-sound="save"]').scroll_into_view_if_needed();page.screenshot(path=str(ROOT.parent/'sound-library-phone.png'),full_page=False)
  page.locator('[data-sound="add-post"]').click();page.wait_for_function('DirectorApp.getProject().postEdit.audio.length===1')
  assert page.evaluate('DirectorApp.getProject().postEdit.audio[0].anchor.offsetFrames')==24
  portable=page.evaluate('async()=>{const x=await DirectorStore.portable(DirectorApp.getProject());return Object.keys(x.files)}');assert 'sound-source' in portable and 'saved-0' in portable
  print('PASS Sound room links are opt-in; actual WAV audition, mark/trim, labels, sample save, source backup and Post cue placement')
  # Scene/timeline usability checks share the real app fixture.
  page.evaluate('DirectorApp.post.close?.()');page.locator('.workspace-navigation [data-workspace-area="timeline"]').click();page.wait_for_selector('#scene-edit-toolbar')
  assert page.locator('#timeline .ref-track').count()==0
  assert page.locator('.editor-tools').is_visible()
  page.set_viewport_size({'width':1440,'height':1000});before=page.evaluate('Number(document.querySelector("#zoom").value)');page.locator('#timeline-scroll').scroll_into_view_if_needed();box=page.locator('#timeline-scroll').bounding_box();page.mouse.move(box['x']+250,box['y']+90);page.keyboard.down('Control');page.mouse.wheel(0,-100);page.keyboard.up('Control');page.wait_for_timeout(150);assert page.evaluate('Number(document.querySelector("#zoom").value)')>before
  page.locator('[data-scene-edit="dialogue"]').click();page.wait_for_selector('[data-line-field="text"]');page.locator('[data-line-field="text"]').first.fill('We are ready.');page.locator('[data-scene-edit="preview"]').click();page.locator('[data-scene-edit="apply"]').click();assert 'We are ready.' in page.evaluate('DirectorApp.getProject().windows[0].detail')
  assert page.evaluate('DirectorApp.getProject().jobs')==page.evaluate('fixture.original.jobs')
  print('PASS Compact timeline, mobile window controls, Ctrl-wheel zoom and scene dialogue preview/apply preserve finished takes')
  assert not errors,errors
  browser.close()
