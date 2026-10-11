"""Synthetic native-music UI interactions; no worker, provider or GPU calls."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':460});page.set_content('<dialog id="dialog"><div id="dialog-body"></div></dialog>')
 for css in ['styles.css','film.css','post.css','workspace.css']:page.add_style_tag(content=(ROOT/css).read_text())
 for name in ['core.js','edit-core.js','post-core.js','app-confirm.js','music-ui.js']:page.add_script_tag(content=(ROOT/name).read_text())
 page.evaluate('''()=>{window.fx={p:H3.newProject(),calls:[],events:[],imports:0,errors:[],status:'queued',wait:null};fx.p.postEdit={clips:[{inFrame:0,outFrame:1200,rate:1}]};const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');const P={wangp:async(path,method,payload)=>{fx.calls.push({path,method,payload});if(method==='POST')fx.events.push('post');if(fx.wait&&method==='POST')await fx.wait;if(path==='/health')return{instance:'synthetic',capabilities:{music:true}};if(path==='/music-models')return{models:[{model_type:'yue2',name:'Synthetic YuE2'}]};if(path==='/generate'&&method==='POST')return{job_id:'synthetic-job',status:'queued'};if(path.endsWith('/cancel'))return{status:'cancelled'};return{status:fx.status,outputs:[]};}};fx.P=P;fx.ui=H3MusicUI.create({$:s=>document.querySelector(s),esc,P,Store:{save:async()=>{fx.events.push('save');if(fx.failSave)throw Error('Synthetic save failure');}},project:()=>fx.p,mutate:f=>f(),toast:s=>fx.errors.push(s),openDialog:(title,html,name)=>{fx.dialog=name;document.querySelector('#dialog-body').innerHTML=html;if(!document.querySelector('#dialog').open)document.querySelector('#dialog').showModal();},dialogName:()=>document.querySelector('#dialog').open?fx.dialog:'',post:()=>({importMusic:async(file,pid,provenance,options,stamp)=>{fx.importArgs={pid,provenance,options,stamp};if(fx.failImport){fx.failImport=false;throw Error('Synthetic import failure');}fx.imports++;}})});fx.ui.open();}''')
 page.locator('#music-seconds').fill('57');page.locator('#music-style').fill('Original test style');page.locator('[data-music=discover]').click();page.wait_for_selector('#music-model option[value=yue2]',state='attached')
 assert page.locator('#music-seconds').input_value()=='57';assert page.locator('#music-style').input_value()=='Original test style'
 page.locator('[data-music=fit]').click();assert page.locator('#music-seconds').input_value()=='50'
 assert page.evaluate('fx.calls.filter(c=>c.method===\"POST\").length')==0
 page.locator('#music-seed').fill('42');page.locator('[data-music=generate]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_selector('[data-music=cancel]')
 page.locator('[data-music=generate]').click();assert page.evaluate('fx.calls.filter(c=>c.path===\"/generate\"&&c.method===\"POST\").length')==1
 assert page.evaluate('fx.events.join(" , " )')=='save , post'
 assert page.evaluate('fx.p.musicJobs[0].requestId.startsWith(\"music-\")&&fx.p.musicJobs[0].workerInstance===\"synthetic\"')
 page.locator('[data-music=cancel]').click();page.wait_for_function('fx.p.musicJobs[0].status===\"cancelled\"')
 page.evaluate('document.querySelector(\"#dialog\").close()');assert page.evaluate('fx.imports')==0
 page.evaluate('fx.ui.open()');assert 'cancelled' in page.locator('#music-jobs').inner_text()
 print('PASS discovery, fit, explicit single submission, durable ownership, repeated click guard, cancellation and Close without import')
 page.evaluate('fx.p=H3.newProject();fx.ui.open()');assert page.locator('#music-jobs').inner_text()=='';assert page.evaluate('fx.imports')==0
 page.screenshot(path=str(ROOT.parent/'evidence'/'music-studio-mobile.png'))
 assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth')
 print('PASS project switch does not transfer music jobs or imports; 390×460 keyboard-sized layout')
 page.evaluate('fx.failSave=true');page.locator('[data-music=generate]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fx.errors.includes("Synthetic save failure")');assert page.evaluate('fx.calls.filter(c=>c.method==="POST").length')==2
 assert page.evaluate('fx.p.musicJobs[0].status')=='rejected'
 print('PASS discovery preserves edited draft; durable save precedes dispatch and failed save prevents generation')

 # Completed outputs are fixture recordings: acceptance must review exact coverage, never dispatch.
 page.evaluate('''()=>{fx.failSave=false;fx.p=H3.newProject();fx.p.postEdit={id:'post',clips:[{id:'clip',inFrame:0,outFrame:1200,rate:1}],audio:[],images:[]};fx.P.mediaURL=async()=> 'data:audio/wav;base64,UklGRg==';fx.p.musicJobs=[{id:'recording',jobId:'owned-song',status:'completed',settings:{seed:42},live:{outputs:[{id:'c'.repeat(32),media_kind:'audio',available:true,probe:{duration:37}}]}}];fx.ui.open();}''')
 page.locator('[data-music=accept]').click();assert '37.000' in page.locator('#dialog-body').inner_text();assert 'gap 13 s at 37–50 s' in page.locator('#music-place-summary').inner_text()
 posts=page.evaluate('fx.calls.filter(c=>c.method==="POST").length')
 page.evaluate('fx.failImport=true');page.locator('[data-music=place]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fx.errors.includes("Synthetic import failure")');assert page.evaluate('fx.imports')==0
 page.locator('[data-music=place]').click();page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fx.imports===1');assert page.evaluate('fx.importArgs.options.mode')=='shorter';assert page.evaluate('fx.importArgs.options.startFrame')==0;assert page.evaluate('fx.calls.filter(c=>c.method==="POST").length')==posts
 assert page.locator('[data-music=accept]').is_disabled()
 page.evaluate('fx.p.musicJobs[0].imported=[];fx.p.musicJobs[0].live.outputs[0].probe.duration=60;fx.ui.open()');page.locator('[data-music=accept]').click();assert 'Cue 0–50 s; gap 0 s' in page.locator('#music-place-summary').inner_text()
 page.evaluate('fx.p.postEdit.clips[0].outFrame=1100');page.locator('[data-music=place]').click();assert page.evaluate('fx.imports')==1
 assert page.evaluate('fx.errors.some(e=>e.includes("cut changed"))')
 page.screenshot(path=str(ROOT.parent/'evidence'/'soundtrack-placement-mobile.png'))
 assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth')
 print('PASS audition review, 37/50 exact gap, 60/50 trim, failed import retry, no generation, stale-cut refusal and placement mobile width')
 browser.close()
