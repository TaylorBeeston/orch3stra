"""Real browser UI with synthetic takes and mocked transport; no model/GPU calls."""
import os
import re
import tempfile, subprocess, base64
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
    with tempfile.TemporaryDirectory(prefix='speech-ui-media-') as media_dir:
        sample=Path(media_dir)/'fixture.mp4'
        subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-f','lavfi','-i','color=c=blue:s=64x64:r=24:d=9','-c:v','libx264',str(sample)],check=True)
        movie_url='data:video/mp4;base64,'+base64.b64encode(sample.read_bytes()).decode()
    page.evaluate('url=>{DirectorProviders.mediaURL=async()=>url}',movie_url)
    page.add_script_tag(content=(ROOT / 'app.js').read_text())
    page.wait_for_function('!!window.DirectorApp?.speechReview')
    page.evaluate("""()=>{
      const prior=DirectorProviders.call;fixture.speech=null;
      const ws='Every little light deserves a chance to shine'.split(' ').map((w,i)=>({word:' '+w,start:.1+i*.2,end:.25+i*.2,probability:.99}));
      DirectorProviders.call=async(route,b)=>{if(route!=='speech-quality')return prior(route,b);fixture.calls.push({route,b});
        if(b.action==='capabilities')return {models:{'small.en':true,small:true}};
        if(b.action==='list')return {jobs:fixture.speech?[fixture.speech]:[]};
        if(b.action==='start'){const row={windowId:'talk',revision:'owned-hash',intended:b.intended[0].text,primary:ws,secondary:ws,speechEvidence:true,boundaryClipped:false,musicVocals:false};row.gate=H3SpeechQuality.classify(row);fixture.speech={id:b.id,edit:b.edit,status:'completed',createdAt:'2026-10-10',reviews:[row],result:{analyses:[{label:'retained-film',model:'small.en',words:ws}],warnings:[]},attempts:[],policy:null};return fixture.speech;}
        if(b.action==='get'||b.action==='reconcile')return fixture.speech;
        if(b.action==='confirm'){const row=fixture.speech.reviews[0];if(typeof b.confirmed==='boolean')row.listeningConfirmed=b.confirmed;if(typeof b.ambiguous==='boolean')row.speakerConcern=b.ambiguous;row.gate=H3SpeechQuality.classify(row);return fixture.speech;}
        if(b.action==='authorize-repair'){if(fixture.speech.policy)throw Error('Budget cannot reset');fixture.speech.policy=b.policy;return fixture.speech;}
        if(b.action==='repair-next'){fixture.speech.attempts.push({windowId:'talk',revision:'owned-hash',requestId:'owned-fixture-request',frames:209,status:'uncertain'});return fixture.speech;}
        if(b.action==='cancel'){fixture.speech.cancelRequested=true;return fixture.speech;}throw Error(b.action);
      };
    }""")
    page.locator('nav.workspace-navigation [data-workspace-area="post"]').click()
    page.locator('[data-speech-quality="open"]:visible').click()
    page.locator('[data-speech-quality="analyze"]').click();page.locator('[data-app-confirm="cancel"]').click()
    assert page.evaluate("fixture.calls.filter(x=>x.route==='speech-quality'&&x.b.action==='start').length") == 0
    page.locator('[data-speech-quality="analyze"]').click();page.locator('[data-app-confirm="accept"]').click()
    page.wait_for_function("fixture.speech?.status==='completed'")
    assert 'REVIEW' in page.locator('#speech-quality-results').inner_text()
    assert 'Intended: Hello there.' in page.locator('#speech-quality-results').inner_text()
    assert 'Observed small.en: Every little light' in page.locator('#speech-quality-results').inner_text()
    assert page.evaluate("fixture.calls.filter(x=>x.b.action==='repair-next').length") == 0
    page.locator('[data-speech-quality-confirm="talk"]').check()
    assert 'CLEAR_FAILURE' in page.locator('#speech-quality-results').inner_text()
    page.locator('[data-speech-quality-ambiguous="talk"]').check()
    assert 'REVIEW' in page.locator('#speech-quality-results').inner_text()
    page.locator('[data-speech-quality-ambiguous="talk"]').uncheck()
    assert page.evaluate("fixture.calls.filter(x=>x.b.action==='repair-next').length") == 0
    page.locator('#speech-quality-opt-in').check();page.locator('#speech-quality-dependencies').check()
    page.locator('[data-speech-quality="authorize"]').click();page.locator('[data-app-confirm="cancel"]').click()
    assert page.evaluate("fixture.calls.filter(x=>x.b.action==='authorize-repair').length") == 0
    page.locator('[data-speech-quality="authorize"]').click();page.locator('[data-app-confirm="accept"]').click()
    page.wait_for_function("fixture.speech?.attempts.length===1")
    assert page.evaluate("fixture.calls.filter(x=>x.b.action==='repair-next').length") == 1
    page.locator('[data-speech-quality="refresh"]').click()
    assert page.evaluate("fixture.calls.filter(x=>x.b.action==='repair-next').length") == 1
    page.set_viewport_size({'width':390,'height':460})
    page.locator('[data-speech-quality="cancel"]').click();assert page.evaluate('fixture.speech.cancelRequested')
    page.locator('#speech-quality-status').scroll_into_view_if_needed()
    page.screenshot(path=str(Path(os.environ.get('EVIDENCE_DIR',str(ROOT/'tests')))/'speech-quality-mobile-fixture.png'))
    assert page.evaluate('document.documentElement.scrollWidth<=document.documentElement.clientWidth+2')
    assert not errors, errors
    print('PASS speech quality browser: actual/script separation, CPU consent cancellation, corroboration without implicit GPU, explicit caps/cancel, one uncertain owned attempt, refresh and mobile keyboard-sized layout. Fixture ASR/GPU only.')
    browser.close()
