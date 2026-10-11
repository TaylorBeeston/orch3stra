"""Synthetic privacy controls and planner defaults; no provider/worker calls."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':390,'height':844});page.route('https://privacy.fixture/**',lambda r:r.fulfill(content_type='text/html',body='<dialog id="dialog"><h2 id="title"></h2><div id="body"></div></dialog>'));page.goto('https://privacy.fixture/')
 for f in ['core.js','reference-core.js','reference-ui.js']:page.add_script_tag(content=(ROOT/f).read_text())
 page.evaluate('''()=>{const p=H3.newProject();p.assets=[{id:'private',kind:'image',number:1,name:'Retained original',generationExcluded:true},{id:'unassigned',kind:'image',number:2,name:'New unassigned upload'},{id:'approved',kind:'image',number:3,name:'Approved portrait',referenceKind:'character'}];p.subjects=[{id:'person',number:1,name:'Person',description:'Synthetic',assetIds:['approved']}];p.windows[0].subjectIds=['person'];window.fx={p,errors:[],calls:0,name:''};fx.ui=H3ReferenceUI.create({$:s=>document.querySelector(s),P:{config:{images:true,provider:'fixture',model:'fixture'},wangp:async()=>{fx.calls++;throw Error('Unexpected worker call');}},Store:{getBlob:async()=>null},esc:String,toast:t=>fx.errors.push(t),project:()=>fx.p,dialogName:()=>fx.name,openDialog:(t,html,name)=>{fx.name=name;document.querySelector('#title').textContent=t;document.querySelector('#body').innerHTML=html;if(!document.querySelector('#dialog').open)document.querySelector('#dialog').showModal();},mutate:f=>f(),hydrate:async()=>{},changed:()=>{},persist:()=>{}});}''')
 page.evaluate('fx.ui.studio()');page.wait_for_selector('#ref-model')
 assert page.locator('[data-plan-source="private"]').count()==0
 assert not page.locator('[data-plan-source="unassigned"]').is_checked()
 assert page.locator('[data-plan-source="approved"]').is_checked()
 assert page.locator('[data-card-source="private"]').count()==0
 print('PASS archived files unavailable; new unassigned uploads default unchecked; approved portrait checked')
 page.evaluate('fx.ui.home()');page.locator('[data-ref="toggle-exclusion"][data-id="private"]').click()
 page.wait_for_function('fx.p.assets[0].generationExcluded===false');page.locator('[data-ref="toggle-exclusion"][data-id="private"]').click();page.wait_for_function('fx.p.assets[0].generationExcluded===true')
 assert page.locator('[data-ref="toggle-exclusion"][data-id="private"]').inner_text()=='Reactivate for generation'
 print('PASS reversible exclusion controls retain original library entry')
 page.evaluate('fx.p.windows[0].assetIds=["private"]')
 result=page.evaluate('fx.ui.preflight().then(()=>"unexpected").catch(e=>e.message)');assert 'Excluded from generation' in result and 'Reactivate' in result
 assert page.evaluate('fx.calls')==0
 print('PASS contradictory direct selection blocks preflight with guidance and no worker/provider request')
 b.close()
