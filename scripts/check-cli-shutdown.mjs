/** Actual CLI signal lifecycle; synthetic health/sequence tail, private temp data, no backend. */
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const source=fileURLToPath(new URL('..',import.meta.url));const root=await mkdtemp(join(tmpdir(),'orch3stra-cli-signal-'));let active;
async function run(entry,signal,hang=false){
 const dir=join(root,entry.replace('.mjs','')+'-'+signal+'-'+hang);await mkdir(dir);for(const name of ['home','codex','data','cache','tmp'])await mkdir(join(dir,name));
 const env={PATH:'/usr/bin:/bin',HOME:join(dir,'home'),CODEX_HOME:join(dir,'codex'),TMPDIR:join(dir,'tmp'),XDG_CACHE_HOME:join(dir,'cache'),HF_HOME:join(dir,'cache','hf'),HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',H3_DATA_DIR:join(dir,'data'),H3_WANGP_ROOT:join(dir,'absent-backend'),H3_WANGP_PYTHON:join(dir,'absent-python'),H3_VOICE_PYTHON:join(dir,'absent-python'),H3_WANGP_BACKEND:'legacy',H3_HOST:'127.0.0.1',H3_PORT:'0'};
 const preloader=join(dir,'fixture-preload.mjs');await writeFile(preloader,`import {SequenceCoordinator} from ${JSON.stringify(pathToFileURL(join(source,'sequence-server.mjs')).href)};
import {WanGPBackend} from ${JSON.stringify(pathToFileURL(join(source,'wangp-backend.mjs')).href)};
import {writeFile} from 'node:fs/promises';import {join} from 'node:path';
const original=SequenceCoordinator.prototype.close;SequenceCoordinator.prototype.close=async function(){await original.call(this);await writeFile(${JSON.stringify(join(dir,'tail-started'))},'synthetic');${hang?'await new Promise(()=>{});':"await new Promise(resolve=>setTimeout(resolve,600));"}await writeFile(${JSON.stringify(join(dir,'tail-completed'))},'synthetic');};
WanGPBackend.prototype.target=async()=>({base:'http://synthetic.invalid',token:'fixture-only'});
globalThis.fetch=async url=>{if(String(url)!=='http://synthetic.invalid/health')throw Error('Unexpected fetch in CLI fixture');return Response.json({backend:'headless',app:'h3-director-wangp',version:'2.3.0',runtime:{root:process.env.H3_WANGP_ROOT},runtime_state:'synthetic',capabilities:{bounded_continuation:true,h3_settings_compatibility:true,reference_image_prompt_mode:'FG'}});};`);
 const child=spawn(process.execPath,['--import',preloader,entry],{cwd:source,env,stdio:['ignore','pipe','pipe']});active=child;let output='';let readyResolve;const ready=new Promise(resolve=>readyResolve=resolve);child.stdout.on('data',b=>{output+=b;if(output.includes('Orch3stra 2.3.0:'))readyResolve();});child.stderr.on('data',b=>output+=b);const exited=new Promise(resolve=>child.once('exit',(code,sig)=>resolve({code,signal:sig})));const deadline=setTimeout(()=>child.kill('SIGKILL'),9000);
 try{
  await Promise.race([ready,exited.then(result=>{throw Error('CLI exited before ready: '+JSON.stringify(result)+' '+output);})]);child.kill(signal);const result=await exited;const lock=join(dir,'data','render-intents.json.writer-lock');assert.equal(await readFile(join(dir,'tail-started'),'utf8'),'synthetic');
  if(hang){assert.equal(result.signal,'SIGKILL',output);assert.match(output,/shutdown timed out/);await assert.rejects(readFile(join(dir,'tail-completed')),e=>e.code==='ENOENT');assert(JSON.parse(await readFile(lock,'utf8')).pid>0);console.log('PASS '+entry+' '+signal+' timeout forcibly terminates and preserves crash lock; tail remains incomplete');}
  else{assert.equal(result.code,0,output);assert.equal(await readFile(join(dir,'tail-completed'),'utf8'),'synthetic');await assert.rejects(readFile(lock),e=>e.code==='ENOENT');console.log('PASS '+entry+' '+signal+' awaits actual delayed sequence close before exit/ownership release');}
 }finally{clearTimeout(deadline);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');active=null;}
}
try{for(const entry of ['bridge.mjs','start-headless.mjs']){await run(entry,'SIGTERM');await run(entry,'SIGINT');await run(entry,'SIGTERM',true);}}finally{active?.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
console.log('Six actual-entrypoint signal checks passed. Synthetic health only; no provider, worker, model or installed Python invoked.');
