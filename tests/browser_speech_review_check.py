"""Real browser UI with synthetic takes and mocked transport; no model/GPU calls."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN', '/usr/bin/chromium'),
                                headless=True, args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1100, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('dialog', lambda d: d.dismiss())
    html = (ROOT / 'index.html').read_text()
    page.set_content(re.sub(r'<script[^>]*src=[^>]*></script>|<link[^>]*href="[^"]+\.css"[^>]*>', '', html));page.evaluate("window.H3_NATIVE_CONFIRM=true")
    for f in re.findall(r'<link[^>]*href="([^"]+\.css)"', html):
        page.add_style_tag(content=(ROOT / f).read_text())
    page.evaluate("""()=>{const m=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)}})}""")
    for f in re.findall(r'<script\b[^>]*src="([^"]+)"', html):
        if f != 'app.js':
            page.add_script_tag(content=(ROOT / f).read_text())
    page.evaluate("""async()=>{
      const p=H3.newProject();p.id='speech-review-fixture';p.mode='managed';
      p.windows=[{...H3.newWindow('Conversation',209,0),id:'talk',summary:'[reference generation] A quiet room.',detail:'[Shot 1] Dialogue: <d>[English] Hello there.</d>',soundscape:'Room tone.'}];
      p.jobs=[{id:'seq_fixture',kind:'managed',status:'completed',createdAt:'2026-10-09T00:00:00Z',snapshot:H3.clone(p),plan:[{id:'talk',task_index:1,window_index:1,start_frame:0,end_frame:209,frames:209}],live:{status:'completed',outputs:[{id:'a'.repeat(32),available:true,cumulative:true,task_index:1,window_index:1,created_at:1}]}}];
      window.fixture={calls:[],original:H3.clone(p),project:p};
      await DirectorStore.save(p);
      const P=DirectorProviders;Object.defineProperty(P,'bridge',{get:()=>true});Object.defineProperty(P,'headless',{get:()=>true});Object.defineProperty(P,'renderProgressAvailable',{get:()=>false});
      P.init=async()=>true;P.mediaURL=async()=>'';P.wangp=async()=>({jobs:[]});P.studioBlob=async()=>({});P.getStudioBlob=async()=>null;
      P.call=async(route,b)=>{fixture.calls.push({route,b});if(route==='studio')return b.action==='list'?{projects:[]}:{credentials:{}};if(route==='sequence')return{runs:[],canSubmitManaged:true,explanation:'Fixture renderer idle'};throw Error('Unexpected request '+route+' '+b.action);};
    }""")
    page.add_script_tag(content=(ROOT / 'app.js').read_text())
    page.wait_for_function('!!window.DirectorApp?.speechReview')
    # Compare review mutations against the loaded, normalized project.
    page.evaluate('fixture.original=H3.clone(DirectorApp.getProject())')
    page.evaluate('DirectorApp.speechReview.open("talk")')
    page.locator('#speech-review-transcript').fill('Yellow bear')
    page.locator('[data-speech-review="compare"]').click()
    assert 'differs' in page.locator('#speech-review-comparison').inner_text()
    page.locator('[data-speech-review="suspect"]').click()
    assert page.evaluate('H3SpeechReview.suspectWindows(DirectorApp.getProject())') == ['talk']
    page.locator('[data-speech-review="select"]').click()
    assert page.evaluate('DirectorApp.renderSelection.selectedIds') == ['talk']
    assert page.evaluate("fixture.calls.filter(x=>['generate','start','resume'].includes(x.b.action)).length") == 0
    page.evaluate('DirectorApp.speechReview.open("talk")')
    page.locator('[data-speech-review="transcribe"]').click();page.locator('[data-app-confirm="cancel"]').click()  # no CPU/ASR job
    assert page.evaluate("fixture.calls.filter(x=>x.route==='voice'||x.route==='finish').length") == 0
    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.locator('[data-speech-review="suspect"]').is_visible()
    page.locator('[data-action="close-dialog"]').click()
    page.evaluate('DirectorApp.speechReview.open("talk")')
    assert page.locator('#speech-review-transcript').input_value() == 'Yellow bear'
    assert page.evaluate('JSON.stringify(DirectorApp.getProject().jobs)===JSON.stringify(fixture.original.jobs)')
    assert page.evaluate('JSON.stringify(DirectorApp.getProject().windows)===JSON.stringify(fixture.original.windows)')
    assert not errors, errors
    print('PASS speech-review DOM: flags, comparison, selected takes, declined ASR, reopen and mobile controls; no generation.')
    browser.close()
