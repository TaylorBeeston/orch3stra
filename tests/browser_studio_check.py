"""Offline Chromium integration: real DOM/video decode, synthetic backend only.
Navigation may be blocked in hosted environments; this deliberately uses set_content.
"""
import base64, copy, json, os, re, subprocess, tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
cloud={'projects':{},'blobs':{},'credentials':{}}
def backend(kind,b):
 if kind=='blobput':cloud['blobs'][b['key']]=b['data'];return {'ok':True}
 if kind=='blobget':return cloud['blobs'].get(b['key'])
 if kind!='studio':raise RuntimeError('No provider or GPU calls are permitted: '+kind)
 a=b['action']
 if a=='list':return {'projects':[{'id':p['project']['id'],'name':p['project']['name'],'windows':len(p['project']['windows']),'serverRevision':p['serverRevision'],'updatedAt':'2026-09-12T00:00:00Z'}for p in cloud['projects'].values()]}
 if a=='blob-info':return {'info':{'key':b['key']}if b['key'] in cloud['blobs'] else None}
 if a=='credentials':return {'credentials':cloud['credentials']}
 if a=='save-credentials':cloud['credentials'].update(b['credentials']);return {'saved':True}
 if a=='get':return copy.deepcopy(cloud['projects'][b['id']])
 if a=='put':
  old=cloud['projects'].get(b['project']['id']);rev=old['serverRevision']if old else None
  if rev!=b.get('expectedRevision'):return {'conflict':True}
  r={'project':copy.deepcopy(b['project']),'id':b['project']['id'],'name':b['project']['name'],'serverRevision':(rev or 0)+1};cloud['projects'][r['id']]=r;return copy.deepcopy(r)
 raise RuntimeError(a)
with tempfile.TemporaryDirectory() as temp:
 clip=Path(temp)/'fixture.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24','-frames:v','240','-c:v','libx264','-pix_fmt','yuv420p',str(clip)],check=True)
 encoded=base64.b64encode(clip.read_bytes()).decode()
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox']);errors=[]
  def boot(viewport={'width':1440,'height':1080},initial=True):
   page=browser.new_page(viewport=viewport);page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.expose_function('__studioBackend',backend)
   html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="(?:styles|studio|editor).css"[^>]*>','',html);page.set_content(html)
   for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
   page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
   for f in ['core.js', 'studio-core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:page.add_script_tag(content=(ROOT/f).read_text())
   page.evaluate("""async({encoded,initial})=>{
    const blobs=new Map();DirectorStore.getBlob=async k=>blobs.get(k);DirectorStore.putBlob=async(k,v)=>blobs.set(k,v);
    const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'video/mp4'}));window.testVideoURL=url;
    DirectorProviders.mediaURL=async()=>url;DirectorProviders.init=async()=>true;Object.defineProperty(DirectorProviders,'bridge',{get:()=>true});
    DirectorProviders.call=async(kind,b)=>{const r=await __studioBackend(kind,b);if(r?.conflict){const e=Error('Shared project changed on another device. Pull or fork.');e.status=409;throw e;}return r;};
    DirectorProviders.remember=async()=>{localStorage.setItem('h3-director:remembered:v1',JSON.stringify({wangp:DirectorProviders.secrets.wangp,huggingface:DirectorProviders.secrets.huggingface}));return DirectorProviders.call('studio',{action:'save-credentials',credentials:{wangp:DirectorProviders.secrets.wangp,huggingface:DirectorProviders.secrets.huggingface}});};
    DirectorProviders.studioBlob=async(key,blob)=>__studioBackend('blobput',{key,data:await DirectorStore.dataURL(blob)});
    DirectorProviders.getStudioBlob=async key=>{const d=await __studioBackend('blobget',{key});if(!d)throw Error('missing');return(await fetch(d)).blob();};
    const p=H3.demo();p.id=initial?'studio-browser-fixture':'phone-empty';p.windows=p.windows.slice(0,2);p.windows[0].frames=107;p.windows[1].frames=107;p.windows[1].overlap=18;
    p.jobs=[{id:'fixture-native',name:'Synthetic render (test bars)',url:DirectorProviders.config.wangpUrl,status:'completed',createdAt:new Date().toISOString(),plan:H3.renderPlan(p),live:{status:'completed',outputs:[{id:'a'.repeat(32),available:true,task_index:1,window_index:2,cumulative:true,created_at:1,bytes:bytes.length,name:'fixture.mp4'}]}}];DirectorStore.save(p);
   }""",{'encoded':encoded,'initial':initial})
   page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp');return page
  page=boot();page.wait_for_function("document.querySelector('#program-video').readyState>=2");assert page.locator('.program-panel').is_visible()
  page.wait_for_function("document.querySelectorAll('.has-render-thumb img').length>=2")
  print('PASS program monitor loads real MP4 and extracts both timeline thumbnails')
  wid=page.evaluate('DirectorApp.getProject().windows[1].id');page.evaluate('(id)=>DirectorApp.select(id)',wid);page.wait_for_function("document.querySelector('#program-video').currentTime>4")
  assert not page.locator('#dialog').is_visible();page.locator('[data-studio-action="play"]').click();page.wait_for_function("!document.querySelector('#program-video').paused");page.evaluate("document.querySelector('#program-video').pause()")
  page.screenshot(path=str(ROOT.parent/'screen-studio-110.png'));print('PASS window selection seeks its saved cumulative range without opening a modal')
  page.locator('[data-studio-action="shared"]').first.click();page.locator('#studio-wangp').fill('remembered-fixture');page.locator('#studio-hf').fill('hf-fixture');page.locator('[data-studio-action="credentials"]').click();page.wait_for_function("JSON.parse(localStorage.getItem('h3-director:remembered:v1')).wangp==='remembered-fixture'")
  page.locator('[data-studio-action="publish"]').click();page.wait_for_selector('[data-studio-pull="studio-browser-fixture"]');assert len(cloud['projects'])==1;assert cloud['credentials']['wangp']=='remembered-fixture';print('PASS explicit publish syncs project and rendered thumbnails; requested tokens remembered separately')
  phone=boot({'width':412,'height':915},False);phone.locator('[data-studio-action="shared"]').first.click();phone.locator('[data-studio-pull="studio-browser-fixture"]').click();phone.wait_for_function("DirectorApp.getProject().id==='studio-browser-fixture'")
  assert phone.evaluate('DirectorApp.getProject().name')==page.evaluate('DirectorApp.getProject().name');phone.screenshot(path=str(ROOT.parent/'screen-phone-110.png'));assert phone.evaluate('document.documentElement.scrollWidth<=innerWidth+2');print('PASS a separate phone page pulls project/media with no horizontal overflow')
  phone.locator('#project-name').fill('Edited on phone');phone.locator('#project-name').dispatch_event('change');phone.locator('[data-studio-action="shared"]').first.click();phone.locator('[data-studio-action="publish"]').click();phone.wait_for_function("document.querySelector('#dialog-body').textContent.includes('revision 2')")
  page.locator('[data-studio-action="publish"]').click();page.wait_for_function("[...document.querySelectorAll('.activity.error')].some(e=>e.textContent.includes('changed on another device'))")
  assert cloud['projects']['studio-browser-fixture']['project']['name']=='Edited on phone';print('PASS stale desktop save is rejected without overwriting phone edits')
  page.locator('[data-action="close-dialog"]').first.click();page.locator('[data-studio-action="continuity"]').click();assert 'no automatic rewrites' in page.locator('#dialog-title').inner_text();page.locator('[data-action="close-dialog"]').first.click()
  # Diagnostics can be inspected without triggering a real download.
  report=page.evaluate('H3Studio.diagnostic(DirectorApp.getProject(),[])');assert report['format']=='h3-director-diagnostic';assert len(report['compiled'])==2;assert 'remembered-fixture' not in json.dumps(report)
  assert not errors,errors;print('PASS continuity review, diagnostic redaction and both pages have no JS errors')
  browser.close()
