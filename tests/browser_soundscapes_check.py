"""Real Chromium UI, synthetic provider and storage; no network or GPU generation.
Reproduces 1.0.6's exact helper in a saved project, then repairs soundscape only.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1600,'height':1050});page.set_default_timeout(8000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',(ROOT/'index.html').read_text());html=re.sub(r'<link[^>]*href="styles.css"[^>]*>','',html)
 page.set_content(html);page.add_style_tag(content=(ROOT/'styles.css').read_text())
 page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
 for f in ['core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js']:
  page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate("""()=>{
  const p=H3.demo();p.name='Soundscape repair regression';p.modelType='fixture_ref2va_pruned_pdd8';p.presetConfirmed=true;
  p.windows.push({...H3.clone(p.windows[3]),id:H3.uid(),title:'Existing custom ambience'});
  p.windows.slice(0,4).forEach(w=>w.soundscape=H3.LEGACY_DEFAULTS.soundscape);
  p.subjects[0].speakerId='S1'; // Valid attribution keeps this suite scoped to soundscape repair.
  p.windows[0].title='Shut Up and Hang Up';p.windows[0].detail='[Shot 1] Niko speaks, then snaps his flip phone shut and pockets it. <Subject 1> (S1) says, <d>[English] Enough, Roman.</d>';
  p.jobs=[{id:'historical',status:'completed',createdAt:new Date().toISOString(),snapshot:{prompt:'Describe ambience and sounds caused by visible actions.'}}];
  DirectorStore.getBlob=async()=>null;DirectorStore.save(p);window.original=H3.clone(p);
  window.requests=[];DirectorProviders.init=async()=>false;DirectorProviders.config.provider='deepseek';DirectorProviders.config.model='fixture-deepseek';
  DirectorProviders.generate=async(system,packet,images)=>{
   requests.push({system,packet,images});
   if(!system.includes('only overall_soundscape'))throw Error('Unexpected full-film rewrite');
   if(images.length)throw Error('Unexpected media upload');
   return JSON.stringify({windows:packet.windows.map((w,i)=>({id:w.id,soundscape:'Rain hiss and low distant traffic for '+w.title+'. Between scripted speech, only this street ambience remains.'}))});
  };
  DirectorProviders.wangp=async()=>{throw Error('Regression test must not contact WanGP');};
 }""")
 page.add_script_tag(content=(ROOT/'image-crop-ui.js').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text());page.add_script_tag(content="try{sessionStorage.getItem('fixture-test')}catch{const values=new Map();Object.defineProperty(window,'sessionStorage',{value:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))}})}");page.add_script_tag(content=(ROOT/'tests/browser-intent-fixture.js').read_text());page.add_script_tag(content=(ROOT/'pending-intent.js').read_text());page.add_script_tag(content=(ROOT/'app.js').read_text());page.wait_for_function('!!window.DirectorApp')
 baseline=page.evaluate('DirectorApp.getProject()')
 assert page.locator('#field-soundscape').input_value()==''
 assert 'Write the actual ambience' in page.locator('#field-soundscape').get_attribute('placeholder')
 assert page.locator('#prompt-readiness').is_visible()
 assert page.evaluate('requests.length')==0
 assert page.evaluate('DirectorApp.getProject().jobs[0].snapshot.prompt')=='Describe ambience and sounds caused by visible actions.'
 print('PASS helper is removed only from editable data; real textarea placeholder and readiness warning are separate, history preserved')
 page.locator('[data-view="compiled"]').click();assert 'Describe ambience and sounds caused by visible actions.' not in page.locator('#editor-content').inner_text()
 page.locator('[data-action="copy-window"]').click();assert 'unfinished' in page.locator('#toast').inner_text()
 page.locator('[data-action="send"]').first.click();assert page.locator('[data-action="submit-wangp"]').count()==0;assert 'Overall soundscape is unfinished' in page.locator('#dialog-body').inner_text()
 page.locator('[data-action="close-dialog"]').first.click()
 page.locator('[data-action="export"]').first.click()
 with page.expect_download() as dl:page.locator('[data-action="export-project"]').click()
 exported=json.loads(Path(dl.value.path()).read_text());assert exported['windows'][0]['soundscape']==''
 page.locator('[data-action="export-tasks"]').click();assert 'unfinished' in page.locator('#toast').inner_text()
 page.locator('[data-action="close-dialog"]').first.click();page.locator('[data-view="compose"]').click()
 print('PASS copy, manifest export and Send reject unfinished fields while editable project backup remains available')
 page.locator('[data-action="soundscapes"]').first.click();assert page.locator('#soundscape-scope').input_value()=='missing'
 page.locator('[data-soundscape-action="generate"]').click();page.wait_for_selector('[data-soundscape-draft]')
 assert page.evaluate('requests.length')==2
 assert page.evaluate('requests.every(r=>r.images.length===0)')
 assert not page.evaluate('JSON.stringify(requests).includes("Enough, Roman.")')
 assert page.evaluate('DirectorApp.getProject().windows[0].soundscape')==''
 first=baseline['windows'][0]['id']
 page.locator(f'[data-soundscape-draft="{first}"]').fill('Steady rain and low distant traffic. Between the scripted words, only environmental sound remains.')
 page.screenshot(path=str(ROOT.parent/'screen-soundscape-review-107.png'))
 page.locator('[data-soundscape-action="apply"]').click()
 repaired=page.evaluate('DirectorApp.getProject()')
 for before,after in zip(baseline['windows'],repaired['windows']):
  for key in before:
   if key!='soundscape':assert after[key]==before[key],key
 assert repaired['windows'][4]['soundscape']==baseline['windows'][4]['soundscape']
 assert repaired['jobs']==baseline['jobs']
 assert all(w['soundscape'] for w in repaired['windows'])
 assert not page.locator('#prompt-readiness').is_visible()
 assert 'Describe ambience and sounds caused by visible actions.' not in page.evaluate('H3.tasks(DirectorApp.getProject())[0].prompt')
 print('PASS two mocked DeepSeek batches repair only four missing soundscapes, with editable review and no timing/dialogue/cast/music/history changes')
 page.locator('#undo').click();assert page.evaluate('DirectorApp.getProject().windows[0].soundscape')==''
 page.locator('#redo').click();assert page.evaluate('DirectorApp.getProject().windows[0].soundscape')==repaired['windows'][0]['soundscape']
 page.wait_for_timeout(300)
 assert page.evaluate('DirectorStore.load().windows[0].soundscape')==repaired['windows'][0]['soundscape']
 print('PASS repair is one undo/redo operation and persists through the normal project store')
 # Create a selected-window proposal, then edit the scene before applying it.
 page.locator('[data-action="soundscapes"]').first.click();page.locator('#soundscape-scope').select_option('selected')
 page.locator('[data-soundscape-action="generate"]').click();page.wait_for_selector('[data-soundscape-draft]')
 variant_id=page.evaluate('DirectorApp.getProject().variants.at(-1).id')
 page.locator('[data-action="close-dialog"]').first.click()
 old_detail=page.locator('#field-detail').input_value();page.locator('#field-detail').fill(old_detail+' The rain stops.')
 page.locator('[data-view="variants"]').click();page.locator(f'[data-review-variant="{variant_id}"]').click()
 page.locator('[data-soundscape-action="apply"]').click();assert 'changed since' in page.locator('#toast').inner_text()
 assert page.evaluate('DirectorApp.getProject().windows[0].soundscape')==repaired['windows'][0]['soundscape']
 page.locator('[data-action="close-dialog"]').first.click();page.locator('[data-view="compose"]').click()
 print('PASS stale context rejects the entire selected repair rather than overwriting later edits')
 # Provider echo is rejected and kept only in raw proposal history.
 page.evaluate("""()=>DirectorProviders.generate=async(system,packet)=>JSON.stringify({windows:packet.windows.map(w=>({id:w.id,soundscape:H3.LEGACY_DEFAULTS.soundscape}))})""")
 page.locator('[data-action="soundscapes"]').first.click();page.locator('#soundscape-scope').select_option('selected')
 page.locator('[data-soundscape-action="generate"]').click();page.wait_for_function('DirectorApp.getProject().variants.at(-1).status==="error"')
 assert page.evaluate('DirectorApp.getProject().windows[0].soundscape')==repaired['windows'][0]['soundscape']
 assert 'editor instructions' in page.locator('#soundscape-status').inner_text()
 page.locator('[data-action="close-dialog"]').first.click()
 print('PASS bad provider output is rejected, preserved for inspection, and never applied')
 # Manual repair remains available without model/provider usage.
 page.locator('#field-soundscape').fill('');assert page.locator('#prompt-readiness').is_visible()
 page.locator('[data-action="scripted-sounds"]').click()
 assert page.evaluate('DirectorApp.getProject().windows[0].soundscape===H3.SCRIPTED_SOUNDS_ONLY')
 assert not page.locator('#prompt-readiness').is_visible()
 assert 'The rain stops.' in page.locator('#field-detail').input_value()
 page.screenshot(path=str(ROOT.parent/'screen-soundscape-repaired-107.png'))
 assert not errors,errors
 print('PASS manual scripted-sounds choice, visible readiness updates, and no page errors')
 browser.close()
