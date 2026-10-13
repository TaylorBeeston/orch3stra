# Component-only harness; the new default navigation shell is covered by browser_workspace_check.py.
"""Real Chromium controls/media. Native jobs/HTTP and IndexedDB are fixtures; no model inference."""
import os,re,json,base64,subprocess,tempfile,hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as td:
 td=Path(td);video=td/'fixture.mp4';audio=td/'theme.wav';image=td/'logo.png'
 def ff(args):subprocess.run(['ffmpeg','-v','error','-y',*args],check=True)
 ff(['-f','lavfi','-i','testsrc2=s=640x360:r=24:d=12','-f','lavfi','-i','sine=frequency=220:duration=12','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(video)])
 ff(['-f','lavfi','-i','sine=frequency=880:sample_rate=48000:duration=3','-c:a','pcm_s16le',str(audio)])
 ff(['-f','lavfi','-i','color=c=red@0.8:s=160x80,format=rgba','-frames:v','1','-threads','1',str(image)])
 data='data:video/mp4;base64,'+base64.b64encode(video.read_bytes()).decode()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1500,'height':1120});page.set_default_timeout(25000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="[^"]+.css"[^>]*>','',html);page.route('http://post-fixture.test/**',lambda route:route.fulfill(status=200,content_type='text/html',body=html));page.goto('http://post-fixture.test/');page.evaluate("window.H3_NATIVE_CONFIRM=true")
  for f in re.findall(r'<link[^>]*href="([^"]+.css)"',(ROOT/'index.html').read_text()):page.add_style_tag(content=(ROOT/f).read_text())
  page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
  for f in re.findall(r'<script\b[^>]*src="([^"]+)"',(ROOT/'index.html').read_text()):
   if f not in ('app.js','workspace-ui.js'):page.add_script_tag(content=(ROOT/f).read_text())
  page.evaluate("""({media,hashes})=>{
   window.fixture={media,hashes,calls:[],blobs:new Map(),finished:[]};const P=DirectorProviders;
   Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});P.init=async()=>true;P.remember=async()=>{};P.mediaURL=async()=>media;P.saveTrace=async()=>{};
   fixture.realGetBlob=DirectorStore.getBlob;DirectorStore.getBlob=async k=>fixture.blobs.get(k)||null;DirectorStore.putBlob=async(k,b)=>fixture.blobs.set(k,b);P.studioBlob=async(k,b)=>{fixture.blobs.set(k,b);return{key:k,size:b.size,sha:hashes[b.size]};};P.getStudioBlob=async k=>fixture.blobs.get(k);
   const p=H3.demo();p.id='post-browser';p.name='Episode · Post test';p.mode='managed';p.windows=p.windows.slice(0,3);p.windows.forEach((w,i)=>w.title=['Opening scene','The argument','After the joke'][i]);const plan=p.windows.map((w,i)=>({id:w.id,title:w.title,task_index:1,window_index:i+1,start_frame:i*96,end_frame:(i+1)*96,frames:96,overlap:0}));
   p.jobs=[{id:'a'.repeat(32),name:'Generated film',backend:'headless',status:'completed',createdAt:new Date().toISOString(),plan,live:{status:'completed',outputs:[{id:'b'.repeat(32),available:true,cumulative:true,task_index:1,window_index:3,created_at:1}]}}];DirectorStore.save(p);fixture.original=JSON.parse(JSON.stringify(p));
   P.call=async(route,b)=>{fixture.calls.push({route,...b});if(route==='studio')return b.action==='list'?{projects:[]}:b.action==='blob-info'?{info:fixture.blobs.has(b.key)?{sha:hashes[fixture.blobs.get(b.key).size]}:null}:{credentials:{}};
    if(route==='finish'){if(b.action==='list')return{jobs:fixture.finished};if(b.action==='get')return fixture.finished.find(x=>x.id===b.id);if(b.action==='save-to-videos'){const j=fixture.finished.find(x=>x.id===b.id);j.savedExport={stem:'Fixture-final',existing:false,files:[]};return j;}if(b.action==='start'){const j={id:b.id,name:b.post?.post.name||b.edit.name,post:b.post,edit:b.post?H3Post.planEdit(b.post):b.edit,status:'completed',message:'Post MP4 ready (fixture)',isPost:!!b.post,sidecars:b.post?['srt','vtt','json']:[],progress:100,downloadURL:media,outputId:'c'.repeat(32),result:{frames:b.post?H3Post.total(b.post.post):b.edit.totalFrames,width:640,height:360}};fixture.finished.push(j);return j;}}
    if(route==='sequence'){if(b.action==='list')return{runs:[]};if(b.action==='manager')return{runs:[],queue:{reachable:true,idle:true,paused:false,jobs:[]}};}
    throw Error('Unexpected fixture route '+route+' '+b.action);
   };P.wangp=async()=>{throw Error('No GPU requests allowed in Post fixture');};
  }""",{'media':data,'hashes':{str(f.stat().st_size):hashlib.sha256(f.read_bytes()).hexdigest() for f in [audio,image]}})
  page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!DirectorApp?.post');page.evaluate('fixture.original=DirectorApp.getProject()')
  page.locator('header.topbar [data-post="open"]').click();page.locator('[data-post="start-all"]').click();page.wait_for_function("document.querySelector('#post-video').readyState>=2")
  assert page.evaluate('DirectorApp.getProject().postEdit.clips.length')==3
  assert page.evaluate('H3Post.total(DirectorApp.getProject().postEdit)')==288
  print('PASS Post starts from immutable selected footage without changing H3')
  page.locator('#post-upload').set_input_files([str(audio),str(image)]);page.wait_for_function('DirectorApp.getProject().postMedia?.length===2')
  assert page.evaluate('DirectorApp.getProject().assets')==page.evaluate('fixture.original.assets')
  page.locator('[data-post-add]').first.click();page.locator('[data-post-cue="loop"]').check();page.locator('[data-post-cue="durationFrames"]').fill('6');page.locator('[data-post-cue="durationFrames"]').press('Tab');page.locator('summary').filter(has_text='Advanced · reduce original film audio').click();page.locator('[data-post-cue="duckDb"]').fill('-15');page.locator('[data-post-cue="duckDb"]').press('Tab')
  assert page.evaluate('DirectorApp.getProject().postEdit.audio[0].durationFrames')==144
  page.evaluate('DirectorApp.post.seek(24)');page.locator('[data-post-add]').nth(1).click();page.locator('[data-post-cue="width"]').fill('40');page.locator('[data-post-cue="width"]').dispatch_event('change');page.evaluate('DirectorApp.post.seek(48)');page.wait_for_function("document.querySelector('#post-overlays img')?.clientWidth>0")
  print('PASS real WAV/transparent PNG imports, cue creation and timing/duck controls')
  # A reviewed range must affect music, never logo opacity or original gain.
  page.evaluate('fixture.savedCut=H3.clone(DirectorApp.getProject().postEdit)')
  page.locator('.post-bar.clip').first.click(position={'x':6,'y':6});page.evaluate('DirectorApp.post.seek(36)');page.locator('[data-post="mark-in"]').click();page.evaluate('DirectorApp.post.seek(71)');page.locator('[data-post="mark-out"]').click()
  original=page.evaluate('JSON.stringify(DirectorApp.getProject().postEdit.clips)')
  calls=page.evaluate('fixture.calls.length');page.locator('[data-post="dialogue-range"]').click();page.evaluate('DirectorApp.post.seek(48)')
  assert page.evaluate('JSON.stringify(DirectorApp.getProject().postEdit.clips)')==original
  assert abs(float(page.locator('#post-overlays img').evaluate('(e)=>e.style.opacity'))-page.evaluate('DirectorApp.getProject().postEdit.images[0].opacity'))<.001
  assert abs(page.evaluate('H3Post.musicGain(DirectorApp.getProject().postEdit,48)')-10**(-12/20))<1e-8
  assert not page.evaluate('fixture.calls.slice('+str(calls)+').some(c=>c.action==="start")')
  page.locator('[data-post="dialogue-captions"]').click();assert not page.evaluate('fixture.calls.slice('+str(calls)+').some(c=>c.action==="start")')
  page.locator('[data-post="dialogue-clear"]').click()
  print('PASS explicit dialogue range lowers music only; overlay/original gain preserved; missing unreviewed captions submit no work')

  page.locator('#post-overlays img').scroll_into_view_if_needed();before=page.evaluate('DirectorApp.getProject().postEdit.images[0].x');box=page.locator('#post-overlays img').bounding_box();page.mouse.move(box['x']+box['width']/2,box['y']+box['height']/2);page.mouse.down();page.mouse.move(box['x']+box['width']/2+45,box['y']+box['height']/2+25,steps=5);page.mouse.up()
  assert page.evaluate('DirectorApp.getProject().postEdit.images[0].x')>before
  # Fades and live playback drive the Post ruler independently.
  page.locator('[data-post-master="fadeInFrames"]').fill('.5');page.locator('[data-post-master="fadeInFrames"]').press('Tab');page.evaluate('DirectorApp.post.seek(0)');page.wait_for_function("Number(document.querySelector('#post-black').style.opacity)===1")
  page.locator('[data-post="play"]').click();page.wait_for_function("!document.querySelector('#post-video').paused");page.wait_for_timeout(500);assert page.evaluate('DirectorApp.post.getFrame()')>0;page.locator('[data-post="play"]').click()
  print('PASS draggable logo, black fade and real video/audio playback clock')
  # Cue movement is an undoable anchored edit.
  bar=page.locator('.post-bar.audio').bounding_box();before=page.evaluate('DirectorApp.getProject().postEdit.audio[0].anchor.offsetFrames');page.mouse.move(bar['x']+10,bar['y']+8);page.mouse.down();page.mouse.move(bar['x']+34,bar['y']+8,steps=4);page.mouse.up()
  assert page.evaluate('DirectorApp.getProject().postEdit.audio[0].anchor.offsetFrames')>before;page.locator('[data-post="undo"]').click();assert page.evaluate('DirectorApp.getProject().postEdit.audio[0].anchor.offsetFrames')==before
  print('PASS cue timeline drag with undo')
  page.locator('.post-bar.clip').first.click(position={'x':6,'y':6});page.evaluate('DirectorApp.post.seek(24)');page.locator('.post-transport [data-post="split"]').click();assert page.evaluate('DirectorApp.getProject().postEdit.clips.length')==4;assert page.evaluate('H3Post.total(DirectorApp.getProject().postEdit)')==288
  page.locator('[data-post="undo"]').click();assert page.evaluate('DirectorApp.getProject().postEdit.clips.length')==3
  page.locator('.post-bar.clip').nth(1).click(position={'x':15,'y':15});page.locator('[data-post-clip="muted"]').check();assert page.evaluate('DirectorApp.getProject().postEdit.clips[1].muted')
  assert page.evaluate('DirectorApp.getProject().windows')==page.evaluate('fixture.original.windows');assert page.evaluate('DirectorApp.getProject().jobs')==page.evaluate('fixture.original.jobs')
  print('PASS split/mute changes only the Post cut and preserves generation sources')
  backup=page.evaluate('async()=>{const b=await DirectorStore.portable(DirectorApp.getProject());return{keys:Object.keys(b.files),post:b.project.postEdit,media:b.project.postMedia}}')
  assert len(backup['keys'])==2 and len(backup['media'])==2
  assert page.evaluate('H3Studio.mediaKeys(DirectorApp.getProject()).filter(k=>DirectorApp.getProject().postMedia.some(a=>a.id===k)).length')==2
  # check actual import path retains bytes for these separate assets
  page.evaluate('async()=>{const b=await DirectorStore.portable(DirectorApp.getProject());const restored=await DirectorStore.importPortable(b);fixture.restored=restored;fixture.restoredBlobSizes=await Promise.all(restored.postMedia.map(async m=>(await fixture.realGetBlob(m.id)).size));}');assert len(page.evaluate('fixture.restoredBlobSizes'))==2;assert page.evaluate('fixture.restored.id!==DirectorApp.getProject().id')
  print('PASS portable round trip and shared media key inclusion')
  page.locator('[data-post="export"]').click();page.wait_for_function('fixture.finished.length===1');assert page.evaluate('fixture.calls.filter(c=>c.route==="finish"&&c.action==="start")[0].post.format')=='h3-post';assert page.locator('#post-jobs a',has_text='Download Post MP4').count()==1
  assert page.locator('#post-jobs a',has_text='SRT · observed ASR draft').count()==1
  assert page.locator('#post-jobs a',has_text='VTT · observed ASR draft').count()==1
  page.locator('[data-post-job="save-to-videos"]').click();page.wait_for_function('fixture.calls.some(c=>c.action==="save-to-videos")')
  assert not page.locator('#post-caption-burn').is_checked()
  print('PASS clean default, observed subtitle links and unattended save action')
  page.locator('[data-post-job="upscale"]').click();page.wait_for_function('fixture.finished.length===2');assert page.evaluate('fixture.calls.filter(c=>c.route==="finish"&&c.action==="start")[1].edit.cuts[0].source.kind')=='finish'
  print('PASS immutable export packet, direct download and explicit existing-master upscale request')
  page.evaluate('DirectorApp.post.seek(48)');page.wait_for_timeout(500);page.screenshot(path=str(ROOT.parent/'screen-post-desktop-170.png'),full_page=True)
  page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(400);assert page.evaluate('document.documentElement.scrollWidth')<=392
  page.screenshot(path=str(ROOT.parent/'screen-post-phone-170.png'),full_page=True)
  page.locator('[data-post-cue="title"]') if False else None
  page.set_viewport_size({'width':390,'height':490});page.wait_for_timeout(150);page.locator('[data-post="close"]').scroll_into_view_if_needed();page.locator('[data-post="close"]').click();assert page.locator('.workspace').is_visible()
  print('PASS portrait/keyboard-sized layout and return to director')
  assert not errors,errors
  browser.close()
