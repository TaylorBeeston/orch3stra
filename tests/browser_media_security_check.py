"""Real HTTP/Chromium direct finished-video playback; active uploads remain attachments."""
import json,os,subprocess,tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp);clip=root/'clip.mp4';subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-frames:v','48','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac',str(clip)],check=True,capture_output=True)
 child=subprocess.Popen(['node',str(ROOT/'tests/media_security_fixture.mjs'),str(root/'data'),str(clip)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 try:
  line=child.stdout.readline();assert line,(line,child.stderr.read());info=json.loads(line)
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_BIN','/usr/bin/chromium'),headless=True,args=['--no-sandbox']);context=browser.new_context(accept_downloads=True);page=context.new_page();page.set_default_timeout(15000)
   page.on('console',lambda m:print('BROWSER',m.type,m.text,flush=True));url=info['base']+info['media'];response=page.goto(url);assert response.status==200;page.wait_for_function('()=>document.querySelector("video")?.readyState>=2');page.locator('video').evaluate('(v)=>v.play()');page.wait_for_timeout(1000);print('VIDEO',page.locator('video').evaluate('(v)=>({paused:v.paused,time:v.currentTime,ready:v.readyState,duration:v.duration,error:v.error?.message})'),flush=True);page.screenshot(path=str(Path(os.environ.get('EVIDENCE_DIR',tmp))/'media-before-playback-check.png'));page.wait_for_function('()=>document.querySelector("video").currentTime>.15')
   csp=response.headers['content-security-policy'];assert csp=="default-src 'none'; media-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";assert "script-src 'none'" in csp;page.evaluate("()=>{const s=document.createElement('script');s.textContent='window.__mediaInlineScriptExecuted=true';document.body.append(s)}");assert not page.evaluate('()=>window.__mediaInlineScriptExecuted===true');assert response.headers['x-content-type-options']=='nosniff'
   ranged=context.request.get(url,headers={'Range':'bytes=0-99'});assert ranged.status==206 and len(ranged.body())==100 and ranged.headers['content-security-policy']==csp
   attachment=context.request.get(url+'?download=1');assert attachment.status==200 and attachment.headers['content-disposition'].startswith('attachment');assert len(attachment.body())>100
   for key in ['html','svg']:
    r=context.request.get(info['base']+'/api/studio-blob?key='+key);assert r.status==200;assert r.headers['content-type']=='application/octet-stream';assert r.headers['content-disposition'].startswith('attachment');assert r.headers['content-security-policy']=="sandbox; default-src 'none'; frame-ancestors 'none'";assert r.headers['x-content-type-options']=='nosniff'
   evidence=Path(os.environ.get('EVIDENCE_DIR',tmp));evidence.mkdir(parents=True,exist_ok=True);page.screenshot(path=str(evidence/'trusted-mp4-direct-playback.png'));browser.close()
  print('PASS completed MP4 direct decode/playback, range/download, scripts blocked by CSP, HTML/SVG attachment policy unchanged; real CPU media, no inference')
 finally:
  child.terminate()
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:child.kill();child.wait()
  if child.returncode!=0:raise AssertionError(child.stderr.read())
