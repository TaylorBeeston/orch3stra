#!/usr/bin/env node
/** One command: reuse/start the detached renderer, then serve the Director UI.
 * Ctrl-C stops ONLY Node. Stop the renderer explicitly with --stop when idle.
 * No shell invocation, pip install, git pull, or change to WanGP settings.
 */
import {spawn} from 'node:child_process';
import {access,mkdir,open,readFile,stat} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {runtimeConfig,saveRuntimeConfig} from './runtime-config.mjs';
import {createInterface} from 'node:readline/promises';
import {WanGPBackend} from './wangp-backend.mjs';
import {shutdownBridge} from './bridge-shutdown.mjs';
import {RenderIntentWriter} from './render-intent-server.mjs';
const ROOT=dirname(fileURLToPath(import.meta.url));
export function configuration(env=process.env){const c=runtimeConfig(env);return{...c,directory:resolve(env.H3_HEADLESS_DATA_DIR||join(c.data,'headless')),port:Number(env.H3_WANGP_PORT||7867)};}
export function controlConfiguration(env=process.env){const data=resolve(env.H3_DATA_DIR||join(homedir(),'.local/share/h3-director'));return{data,directory:resolve(env.H3_HEADLESS_DATA_DIR||join(data,'headless'))};}
export async function probe(config){const b=new WanGPBackend(config.data,{mode:'headless',headlessDir:config.directory});const target=await b.target();const r=await fetch(target.base+'/health',{headers:{Authorization:'Bearer '+target.token},signal:AbortSignal.timeout(2500)});if(!r.ok)throw Error('Existing worker rejected health check (HTTP '+r.status+').');const d=await r.json();if(d.backend!=='headless'||d.app!=='h3-director-wangp')throw Error('Port is not the Director headless renderer.');return{...d,target};}
export async function startWorker(c){
  let existing;try{existing=await probe(c);}catch(e){if(e.message.includes('rejected')||e.message.includes('Port is'))throw e;}
  if(existing){if(existing.runtime?.root&&resolve(existing.runtime.root)!==c.root)throw Error('Existing renderer belongs to a different WanGP root. Stop it explicitly first.');if(!['1.2.0','1.3.0','1.4.0','1.5.0','1.9.2','2.2.0','2.2.2','2.3.0-dev.1','2.3.0'].includes(existing.version))throw Error('A different renderer version is running. Finish its work, then use --stop before upgrading.');if(!existing.capabilities?.bounded_continuation)console.log('Existing worker reused for editing and saved work. New managed runs require bounded continuation: finish GPU work, park dispatch, preserve H3_DATA_DIR and token, then explicitly restart the idle worker from this release. Nothing was restarted automatically.');if(!existing.capabilities?.h3_settings_compatibility)console.log('Existing worker reused; it does not include the strict-settings fix. Before H3 video rendering on recent WanGP, finish/park work, stop Director, run node start-headless.mjs --stop from this release, then launch again. No renderer was stopped automatically.');if(existing.version==='1.2.0')console.log('Worker 1.2.0 reused safely. Editor/export work now; late upscaling needs an idle worker restart from this release.');if(existing.capabilities?.reference_image_prompt_mode!=='FG')console.log('Existing renderer reused; editing/video rendering can continue. Qwen image tasks need the single-prompt fix: when idle, stop Director, run --stop from this release, then launch again. Do not stop a running render.');return existing;}
  if(!Number.isInteger(c.port)||c.port<1||c.port>65535)throw Error('Invalid H3_WANGP_PORT.');
  await access(c.python);await access(join(c.root,'shared/api.py'));await access(join(c.root,'wgp.py'));
  await mkdir(c.directory,{recursive:true,mode:0o700});
  const logPath=join(c.directory,'worker.log');const log=await open(logPath,'a',0o600);await log.chmod(0o600);
  const child=spawn(c.python,['-u',join(ROOT,'headless/server.py'),'--root',c.root,'--data-dir',c.directory,'--port',String(c.port)],{cwd:c.root,detached:true,stdio:['ignore',log.fd,log.fd],shell:false,env:{...process.env,H3_DATA_DIR:c.data,PYTHONUNBUFFERED:'1',GRADIO_ANALYTICS_ENABLED:process.env.GRADIO_ANALYTICS_ENABLED||'False'}});
  let failure=null;child.on('error',e=>{failure=e;});child.unref();await log.close();
  for(let i=0;i<80;i++){await delay(250);if(failure)throw failure;try{const result=await probe(c);console.log('Headless renderer started. Initialization may take a while.\nRenderer log: '+logPath);return result;}catch{}
    if(child.exitCode!==null){const text=await readFile(logPath,'utf8');throw Error('Renderer exited during startup. Inspect the private worker log at '+logPath+'. Check selected paths, dependencies, port ownership and runtime errors before another launch. No process was stopped.');}}
  throw Error('Renderer did not open its control port within 20 seconds. Inspect '+logPath+'. Do not launch a second worker blindly.');
}
export async function stopWorker(c){
  const h=await probe(c),connection=JSON.parse(await readFile(join(c.directory,'connection.json'),'utf8'));
  const r=await fetch(h.target.base+'/shutdown',{method:'POST',headers:{Authorization:'Bearer '+h.target.token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)}),b=await r.json();if(!r.ok)throw Error(b.error);
  const pid=connection.pid;console.log('Idle renderer shutdown requested; waiting for the process to exit.');
  for(let i=0;i<300;i++){await delay(200);if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);if(process.platform==='linux'){const text=await readFile('/proc/'+pid+'/stat','utf8');if(text.slice(text.lastIndexOf(')')+2).startsWith('Z'))return;}}catch(e){if(['ESRCH','ENOENT'].includes(e.code))return;throw e;}}else{try{await probe(c);}catch(e){if(e.cause?.code==='ECONNREFUSED')return;}}}
  throw Error('Shutdown was requested, but process exit was not confirmed within 60 seconds. Inspect worker.log; do not start a second worker blindly.');
}
async function main(){const arg=process.argv[2];if(arg&&!['--status','--stop','--check','--help','--setup'].includes(arg))throw Error('Unknown option. Use --help.');
  if(arg==='--help'){console.log('node start-headless.mjs [--status | --stop | --check]\n--check: structural paths/codecs only; exit 1 required failure, exit 2 runtime readiness unverified.\nDefault: start/reuse detached WanGP, then serve Director on 127.0.0.1:8765.\n--setup reviews and saves existing nonsecret runtime paths. Explicit H3_HOST=0.0.0.0 enables LAN access with pairing; HTTP is not encrypted.\n--stop refuses an active render; queued jobs remain paused on restart.\nH3_WANGP_ROOT, H3_WANGP_PYTHON, H3_DATA_DIR, H3_HOST, H3_PORT are supported.');return;}
  const c=['--status','--stop'].includes(arg)?controlConfiguration():configuration();
  if(arg==='--setup'){const rl=createInterface({input:process.stdin,output:process.stdout});try{const root=await rl.question('Existing WanGP folder (no installation): '),python=await rl.question('Existing WanGP Python executable: ');const next={root,python};console.log('Save these nonsecret paths in '+c.settingsPath+'?');const accepted=await rl.question('Type SAVE to confirm (existing data/token stay intact): ');if(accepted.trim()!=='SAVE'){console.log('Setup cancelled.');return;}let replace=false;if(c.configured){replace=(await rl.question('Type REPLACE to update existing saved paths: ')).trim()==='REPLACE';if(!replace){console.log('Existing paths preserved.');return;}}await saveRuntimeConfig(process.env,{...next,replace});console.log('Paths saved. Run --check before starting.');}finally{rl.close();}return;}
  if(arg==='--check'){const p=spawn(c.python,[join(ROOT,'headless/server.py'),'--root',c.root,'--data-dir',c.directory,'--check'],{stdio:'inherit',shell:false});p.on('error',e=>{console.error(e.message);process.exitCode=1;});p.on('exit',code=>process.exitCode=code||0);return;}
  if(arg==='--status'||arg==='--stop'){const h=await probe(c);if(arg==='--status'){const{target,...publicInfo}=h;console.log(JSON.stringify(publicInfo,null,2));return;}await stopWorker(c);console.log('Renderer stopped. Queued work is not deleted.');return;}
  const intentWriter=new RenderIntentWriter(c.data);await intentWriter.ready;
  const h=await startWorker(c);process.env.H3_PYTHON=c.python;process.env.H3_WANGP_BACKEND='headless';process.env.H3_DATA_DIR=c.data;process.env.H3_HEADLESS_DATA_DIR=c.directory;
  const{createServer}=await import('./bridge.mjs');const host=process.env.H3_HOST||'127.0.0.1',port=Number(process.env.H3_PORT||8765);const server=createServer({host,port,dataDir:c.data,intentWriter,backendOptions:{mode:'headless',headlessDir:c.directory}});
  server.on('error',e=>{console.error('Director UI could not start: '+e.message+'\nThe renderer remains running.');process.exitCode=1;});
  server.listen(port,host,async()=>{await server.ready;console.log(`Orch3stra 2.3.0: http://${host==='0.0.0.0'?'YOUR_HOST':host}:${server.address().port}\nLocal: http://127.0.0.1:${server.address().port}\nWanGP: ${h.runtime_state} · headless · no plugin, token copying, or browser tab.\nAI request log: ${server.ai.logPath}\nCtrl-C stops only Director. Use --stop to stop an idle renderer.`);if(server.studio.newPassword)console.log('Pair this device using the studio password: '+server.studio.newPassword);});
  let stopping=false;for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{if(stopping)return;stopping=true;console.log('\nStopping Director; the WanGP renderer keeps running. Managed sequences pause after their current active window until Director returns and you resume.');void shutdownBridge(server);});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
