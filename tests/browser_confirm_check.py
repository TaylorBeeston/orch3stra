"""Actual app-owned confirmation keyboard/interrupt/overlap tests; no submissions."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':390,'height':460});page.set_content('<button id="launch">Review generation</button>')
 page.add_style_tag(content=(ROOT/'styles.css').read_text());page.add_script_tag(content=(ROOT/'app-confirm.js').read_text())
 page.evaluate(r'''()=>{window.fx={project:'a',settings:1,dispatches:0,results:[],native:0};window.confirm=()=>{fx.native++;throw Error('Native confirmation forbidden');};document.querySelector('#launch').onclick=async()=>{const pid=fx.project,setting=fx.settings;const ok=await H3Confirm.ask({title:'Generate selected fictional voices',summary:'Two voices · installed preset · 7 seconds each\nLocal GPU queue\n<script>must remain text</script>',accept:'Generate two voices',valid:()=>fx.project===pid&&fx.settings===setting});fx.results.push(ok);if(ok)fx.dispatches++;};}''')
 page.locator('#launch').click();assert page.locator('[data-app-confirm=cancel]').evaluate('el=>el===document.activeElement');assert page.locator('#app-confirm-summary script').count()==0
 page.keyboard.press('Escape');page.wait_for_function('fx.results.length===1');assert page.evaluate('fx.dispatches')==0;assert page.locator('#launch').evaluate('el=>el===document.activeElement')
 page.locator('#launch').click();page.locator('[data-app-confirm=cancel]').click();page.wait_for_function('fx.results.length===2');assert page.evaluate('fx.dispatches')==0
 print('PASS Escape and Cancel never dispatch; focus restored; summary escaped')
 page.locator('#launch').click();page.evaluate('fx.project="b"');page.wait_for_function('!H3Confirm.pending');assert page.evaluate('fx.dispatches')==0
 page.locator('#launch').click();page.evaluate('fx.settings++');page.wait_for_function('!H3Confirm.pending');assert page.evaluate('fx.dispatches')==0
 print('PASS project/settings changes invalidate pending approval without dispatch')
 page.locator('#launch').click();page.evaluate(r'''async()=>{fx.overlap=await H3Confirm.ask({summary:'Overlapping stale intent'});}''');assert page.evaluate('fx.overlap') is False
 assert 'Two voices' in page.locator('#app-confirm-summary').inner_text();page.screenshot(path=str(ROOT.parent/'evidence'/'app-confirm-mobile.png'))
 assert page.evaluate('document.documentElement.scrollWidth<=390');box=page.locator('#app-confirm').bounding_box();assert box['width']<=390 and box['height']<=460
 page.locator('[data-app-confirm=accept]').dblclick();page.wait_for_function('fx.dispatches===1');assert page.evaluate('fx.dispatches')==1;assert page.evaluate('fx.native')==0
 print('PASS overlapping intent refused, double acceptance dispatches once, 390×460 layout, no native dialogs')
 page.locator('#launch').click();page.evaluate('document.querySelector("#app-confirm").close()');page.wait_for_function('!H3Confirm.pending');assert page.evaluate('fx.dispatches')==1
 print('PASS programmatic Close cancels the pending approval')
 # askConfirm (core.js) replaces window.confirm across the app with this dialog, never the native one.
 page.add_script_tag(content=(ROOT/'core.js').read_text())
 page.evaluate(r'''()=>{window.fx.asks=[];window.ask=async m=>fx.asks.push(await askConfirm(m));}''')
 page.evaluate('void ask("Delete <b>this</b> take?")');page.locator('#app-confirm').wait_for(state='visible')
 assert page.locator('#app-confirm-summary').inner_text()=='Delete <b>this</b> take?';assert 'unchanged' in page.locator('#app-confirm-note').inner_text()
 page.locator('[data-app-confirm=accept]').click();page.wait_for_function('fx.asks.length===1')
 page.evaluate('void ask("Second?")');page.locator('#app-confirm').wait_for(state='visible');page.keyboard.press('Escape');page.wait_for_function('fx.asks.length===2')
 assert page.evaluate('fx.asks')==[True,False];assert page.evaluate('fx.native')==0
 print('PASS askConfirm uses the app dialog (accept true, Escape false) and never window.confirm')
 browser.close()
