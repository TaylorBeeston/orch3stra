"""Offline real-Chromium DOM check. Network/navigation/storage are NOT end-to-end.

Local HTTP navigation is administrator-blocked in the authoring environment.
This renders the actual packaged scripts/CSS with an in-memory localStorage
stand-in. No provider, WanGP, external URL or paid render is contacted.
Requires optional Playwright + a Chromium binary; not an app dependency.
"""
import json, os, re
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1920,'height':1080})
 page.set_default_timeout(5000)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('http://127.0.0.1:19874/**',lambda route:route.fulfill(status=200,body='<html></html>',content_type='text/html'));page.goto('http://127.0.0.1:19874/')
 html=(ROOT/'index.html').read_text()
 html=re.sub(r'<script[^>]*src=[^>]*></script>','',html)
 html=re.sub(r'<link[^>]*href="styles.css"[^>]*>','',html)
 page.set_content(html)
 page.add_style_tag(content=(ROOT/'styles.css').read_text())
 page.evaluate("""()=>{const data=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)}})}""")
 for file in ['core.js', 'storage.js', 'providers.js', 'speech-core.js', 'speech-ui.js', 'takes-ui.js', 'direction-ui.js', 'soundscape-ui.js', 'reference-core.js', 'clinic-core.js', 'film-core.js', 'clinic-ui.js', 'film-ui.js', 'voice-studio.js', 'codex-ui.js', 'scene-core.js', 'doctor-core.js', 'reference-agent-core.js', 'scene-ui.js', 'image-crop-ui.js', 'app-confirm.js', 'app.js']:page.add_script_tag(content=(ROOT/file).read_text())
 print('Boot errors',errors,flush=True)
 page.wait_for_function('!!window.DirectorApp')
 print('Booted',flush=True)
 assert page.locator('.brand').inner_text()=='Orch3stra'
 assert page.locator('.brandmark').count()==0
 page.screenshot(path=str(ROOT.parent/'evidence'/'simplified-header.png'))
 assert page.title().startswith('Orch3stra')
 assert page.locator('[data-window]').count()==4
 page.locator('[data-subject]').first.click()
 page.locator('#subject-speaker').select_option('S1')
 page.locator('[data-save-subject]').click()
 assert page.evaluate('DirectorApp.getProject().subjects[0].speakerId')=='S1'
 print('Voice saved',flush=True)
 page.locator('button[data-action="send"]').first.click()
 assert page.locator('#render-upscale').count()==0
 assert page.evaluate('DirectorApp.getProject().jobs.length')==0
 print('PASS incomplete demo is blocked before render submission',flush=True)
 page.locator('button[data-action="renders"]').first.click()
 assert page.locator('#dialog-body').inner_text().find('No Director submissions yet.')>=0
 page.locator('button[data-action="close-dialog"]').first.click()
 # Seed an existing job through the real import UI. The media source is mocked;
 # this checks rendering/range selection, not codec streaming or browser auth.
 project=page.evaluate('DirectorApp.getProject()')
 plan=page.evaluate('H3.renderPlan(DirectorApp.getProject())')
 current={'id':plan[1]['id'],'task_index':1,'window_index':2,'title':'Fixture continuation','status':'running','phase':'inference','elapsed_seconds':125,'denoising_seconds':100,'total_steps':8,'completed_steps':3,'last_step_seconds':25,'seconds_per_step':{'seconds':25,'samples':3},'step_elapsed_seconds':12,'next_step_eta':{'low':8,'high':28},'denoising_eta':{'low':90,'high':180},'window_eta':None,'phase_seconds':{'inference':100}}
 done={**current,'id':plan[0]['id'],'window_index':1,'status':'completed','phase':'decoding','title':'Fixture saved','completed_steps':8,'elapsed_seconds':250,'denoising_seconds':210}
 output={'id':'a'*32,'job_id':'fixture-job','name':'cumulative.mp4','task_index':1,'window_index':1,'cumulative':True,'bytes':500000,'available':True,'created_at':100}
 live={'job_id':'fixture-job','status':'running','message':'Fixture only: Sliding Window 2/4','outputs':[output],'telemetry':{'elapsed_seconds':400,'generation_elapsed_seconds':390,'queue_wait_seconds':10,'current':current,'windows':[done,current],'complete_windows':1,'total_eta':None,'eta_note':'Fixture ETA only'}}
 project['jobs']=[{'id':'fixture-job','status':'running','createdAt':'2026-09-11T12:00:00Z','url':'http://127.0.0.1:7867','plan':plan,'live':live}]
 page.locator('#project-import').set_input_files({'name':'fixture.json','mimeType':'application/json','buffer':json.dumps(project).encode()})
 page.wait_for_function('DirectorApp.getProject().jobs.length===1')
 print('Fixture imported',flush=True)
 page.locator('button[data-action="renders"]').first.click();page.locator('#dialog-body [data-job]').first.click()
 assert 'H3 completed steps' in page.locator('#render-stats').inner_text()
 assert '3 / 8' in page.locator('#render-stats').inner_text()
 assert 'Calibrating' in page.locator('#render-stats').inner_text()
 page.screenshot(path=str(ROOT.parent/'screen-monitor.png'))
 page.locator('button[data-action="close-dialog"]').first.click()
 assert page.locator('#render-track-bed [data-render-window]').count()==1
 page.screenshot(path=str(ROOT.parent/'screen-home.png'))
 assert not errors,errors
 print('PASS offline real-Chromium DOM: boot, voice save, incomplete-render guard, render monitor, import, timeline association; no page errors')
 browser.close()
