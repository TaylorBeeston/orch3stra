"""Actual editor/protocol UI, offline backend fixtures. No paid provider or GPU."""
import copy, json, os, re, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
jobs={}; starts=[]
def summary(job,detail=False):
 j=copy.deepcopy(job);j['elapsedSeconds']=round(time.time()-j.pop('_created'),2);j['secondsSinceData']=0.1;j['secondsSinceOutput']=0.1;j['partialPreview']=j.get('text','')[-3000:]
 if not detail:j.pop('request',None);j.pop('context',None);j.pop('events',None)
 return j
def backend(b):
 a=b['action']
 if a=='start':
  r=b['request'];starts.append(copy.deepcopy(r));id=r['requestId']
  j={'id':id,'projectId':r['projectId'],'provider':r['provider'],'model':r['model'],'kind':r['kind'],'context':r.get('context',{}),'request':{'system':r['system'],'prompt':r['prompt'],'images':[]},'status':'running','phase':'waiting_for_output','httpStatus':200,'createdAt':time.strftime('%Y-%m-%dT%H:%M:%S',time.gmtime())+'.000Z','_created':time.time(),'timeoutSeconds':1200,'idleSeconds':180,'text':'','outputCharacters':0,'events':[{'at':'12:00:01','phase':'accepted','message':'Accepted by Director'},{'at':'12:00:02','phase':'waiting_for_output','message':'Connected; waiting for output'}]}
  jobs[id]=j;return {'job':summary(j)}
 if a=='list':return {'jobs':[summary(j)for j in reversed(list(jobs.values())) if not b.get('projectId')or b['projectId']==j['projectId']],'logPath':'/private/studio/ai-requests.log','timeoutSeconds':1200}
 if a=='get':return {'job':summary(jobs[b['id']],b.get('detail',False))}
 if a=='cancel':
  j=jobs[b['id']];j.update(status='cancelled',phase='cancelled',error='Cancelled by user; no automatic retry.',errorCode='AI_CANCELLED');return {'job':summary(j)}
 if a=='validation':jobs[b['id']]['validation']={'status':b['status'],'message':b.get('message','')};return {'saved':True}
 raise RuntimeError(a)
def complete(id):
 j=jobs[id];p=j['context']['storyPacket'];ids=[s['id']for s in p['subjects']]
 text=json.dumps({'title':'Natural runtime recovered','rationale':'A compact, unpadded beginning and ending.','beats':[{'title':'Arrival','seconds':9,'reason':'A clear action with room to react.','action':'The explorer enters.','entry':'At the doorway.','exit':'Inside the room.','visibleSubjectIds':ids,'heardSubjectIds':[],'deliveryBySubject':{},'dialogueIds':[],'hardCut':True}]})
 j.update(status='completed',phase='completed',text=text,outputCharacters=len(text),finishReason='stop',usage={'completion_tokens':120})
 j['events'].append({'at':'12:01:10','phase':'completed','message':'Response received; review is required.'})
with sync_playwright()as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox']);errors=[]
 def boot(project=None):
  page=browser.new_page(viewport={'width':1500,'height':1000});page.set_default_timeout(12000);page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept());page.expose_function('__aiBackend',backend)
  html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="(?:styles|studio|editor).css"[^>]*>','',html);page.set_content(html);page.evaluate("window.H3_NATIVE_CONFIRM=true")
  for f in ['styles.css', 'studio.css', 'editor.css', 'film.css']:page.add_style_tag(content=(ROOT/f).read_text())
  page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
  for f in ['core.js', 'studio-core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'studio-ui.js', 'backend-ui.js', 'ai-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:page.add_script_tag(content=(ROOT/f).read_text())
  page.evaluate("""p=>{
   const blobs=new Map();DirectorStore.getBlob=async k=>blobs.get(k);DirectorStore.putBlob=async(k,v)=>blobs.set(k,v);
   p=p||H3.demo();DirectorStore.save(p);DirectorProviders.config.provider='deepseek';DirectorProviders.config.model='fixture-streaming';DirectorProviders.secrets.deepseek='browser-only-fixture-secret';
   const originalFetch=window.fetch;window.fetch=async(url,options={})=>{
    if(url==='/api/health')return Response.json({app:'h3-director-bridge',token:'fixture-csrf',ai_requests:true,wangp_backend:{mode:'headless'}});
    if(url==='/api/studio')return Response.json({credentials:{},projects:[]});
    if(url==='/api/ai')return Response.json(await __aiBackend(JSON.parse(options.body)));
    if(String(url).startsWith('data:')||String(url).startsWith('blob:'))return originalFetch(url,options);
    throw Error('Unexpected external request in offline test: '+url);
   };
  }""",project)
  page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp && DirectorProviders.aiAvailable');return page
 def start(page):
  page.locator('[data-action="scaffold"]').first.click();page.locator('[data-action="natural-length"]').click();page.locator('[data-direction-action="pacing-generate"]').click();page.wait_for_function('DirectorProviders.lastAIRequestId!==null');page.wait_for_timeout(150);return page.evaluate('DirectorProviders.lastAIRequestId')
 page=boot();original=page.evaluate('DirectorApp.getProject()');id=start(page)
 page.wait_for_function("document.querySelector('#pacing-status').textContent.includes('Waiting for first output')")
 assert 'elapsed' in page.locator('#pacing-status').inner_text();assert page.locator('#activity-stack .running').count()>0
 print('PASS pacing starts an observable server job; inline elapsed status and activity controls are visible')
 page.locator('#dialog-body [data-ai-action="open"]').click();page.wait_for_selector('#ai-current-status');assert 'waiting' in page.locator('#ai-events').inner_text();assert page.locator('[data-ai-action="recover"]').is_hidden()
 jobs[id].update(phase='streaming',text='{"title":"partial"}</pre><img id="unexpected-image">',outputCharacters=54)
 page.wait_for_function("document.querySelector('#ai-output').textContent.includes('partial')")
 assert page.locator('#unexpected-image').count()==0
 with page.expect_download()as dl:page.locator('[data-ai-action="download"]').click()
 saved=json.loads(Path(dl.value.path()).read_text());assert saved['request']['prompt'];assert 'browser-only-fixture-secret' not in json.dumps(saved)
 print('PASS live partial output is safely rendered and downloadable with the captured request, without secrets')
 page.locator('[data-ai-action="cancel"]').click();page.wait_for_function("document.querySelector('#ai-current-status').textContent.includes('Cancelled')")
 page.wait_for_timeout(1600);assert jobs[id]['status']=='cancelled';assert len(starts)==1
 assert page.evaluate('DirectorApp.getProject().windows')==original['windows']
 print('PASS explicit cancel is observed by the waiting pacing workflow without modifying the timeline or retrying')
 page.locator('#dialog [data-action="close-dialog"]').click();id2=start(page);page.wait_for_function("document.querySelector('#pacing-status').textContent.includes('Request:')")
 source=page.evaluate('DirectorApp.getProject()');page.close();complete(id2)
 page=boot(source);page.locator('#ai-requests').click();page.wait_for_selector('[data-ai-action="recover"]');page.wait_for_function("!document.querySelector('[data-ai-action=recover]').hidden")
 assert len(starts)==2
 page.screenshot(path=str(ROOT.parent/'screen-ai-log-121.png'))
 with page.expect_download()as dl:page.locator('[data-ai-action="download"]').click()
 recovered=json.loads(Path(dl.value.path()).read_text());assert recovered['finishReason']=='stop';assert recovered['context']['storyPacket']['task']==source['request']
 page.locator('[data-ai-action="recover"]').click();page.wait_for_selector('[data-pacing-seconds="0"]');assert len(starts)==2
 assert page.evaluate('DirectorApp.getProject().windows')==source['windows']
 page.locator('[data-direction-action="pacing-apply"]').click();page.wait_for_function("DirectorApp.getProject().name==='Natural runtime recovered · pacing copy'")
 assert page.evaluate('DirectorApp.getProject().id')!=source['id'];assert page.evaluate('id=>DirectorStore.load(id).windows',source['id'])==source['windows'];assert len(starts)==2
 print('PASS completed pacing survives simulated browser refresh, recovers without an AI call, and forks only on explicit apply')
 # A changed brief cannot silently reuse an old plan.
 stale=copy.deepcopy(source);stale['request']+=' A different ending.'
 second=boot(stale);second.locator('#ai-requests').click();second.wait_for_function("document.querySelector('[data-ai-action=recover]')&&!document.querySelector('[data-ai-action=recover]').hidden")
 second.locator('[data-ai-action="recover"]').click();second.wait_for_function("document.querySelector('#ai-monitor-error').textContent.includes('changed since')")
 assert second.evaluate('DirectorApp.getProject().windows')==stale['windows'];assert len(starts)==2
 print('PASS stale pacing recovery is refused rather than rewriting changed story material')
 second.set_viewport_size({'width':412,'height':915});second.screenshot(path=str(ROOT.parent/'screen-ai-phone-121.png'))
 assert second.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1');assert not errors,errors
 print('PASS desktop/phone request monitor and no JavaScript errors; backend/model were fixtures')
 second.locator('#dialog [data-action="close-dialog"]').click();timeout_id=start(second)
 jobs[timeout_id].update(status='timed_out',phase='timed_out',error='No network data for 180 seconds. Partial output retained.',errorCode='AI_IDLE_TIMEOUT',text='{"partial":',outputCharacters=11)
 second.wait_for_function("id=>DirectorApp.getProject().variants.at(-1).aiRequestId===id && DirectorApp.getProject().variants.at(-1).status==='error'",arg=timeout_id)
 assert '180 seconds' in second.locator('#pacing-status').inner_text()
 assert second.evaluate('DirectorApp.getProject().windows')==stale['windows']
 second.locator('#dialog-body [data-ai-action="open"]').click();second.wait_for_function("document.querySelector('#ai-monitor-error')&&document.querySelector('#ai-monitor-error').textContent.includes('180 seconds')")
 assert second.locator('[data-ai-action="recover"]').is_hidden();assert len(starts)==3
 assert not errors,errors
 print('PASS timeout feedback persists in request history; partial JSON never creates a timeline')
 browser.close()
