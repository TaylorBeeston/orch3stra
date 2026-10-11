#!/usr/bin/env node
/** Real detached Python worker + Node HTTP/disk/FFmpeg. Fake shared.api, no GPU. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,copyFile,chmod,rm,lstat,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import net from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {startWorker,probe,configuration,controlConfiguration,stopWorker} from '../start-headless.mjs';
import {createServer,checkWanGPPath} from '../bridge.mjs';
import {WanGPBackend} from '../wangp-backend.mjs';
import {units} from './install-services.mjs';
import {StudioStore} from '../studio-server.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),H3=require('../core.js'),S=require('../studio-core.js');
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');let count=0,bridge=null,worker=null,c=null;
const tmp=await mkdtemp(join(tmpdir(),'h3-headless-check-'));
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function until(fn){for(let i=0;i<300;i++){if(await fn())return;await delay(25);}throw Error('Timed out');}
let base,token;async function newBridge(){bridge=createServer({port:0,host:'127.0.0.1',root:ROOT,dataDir:c.data,backendOptions:{mode:'headless',headlessDir:c.directory}});await new Promise(r=>bridge.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+bridge.address().port;const h=await(await fetch(base+'/api/health')).json();token=h.token;return h;}
async function closeBridge(){if(bridge){const b=bridge;bridge=null;b.closeAllConnections();await new Promise(r=>b.close(r));await b.shutdown;}}
async function call(path,body={}){const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-H3-Token':token},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
const nativeIntents=new Map();const wangp=async(path,method='GET',body)=>{let intent;if(path==='/generate'){intent=nativeIntents.get(body.request_id);if(!intent){const session=await call('render-intent',{action:'begin-session',owner:'fixture-cli',runId:'fixture-cli-run'});intent=await call('render-intent',{action:'prepare',owner:'fixture-cli',lease:session.lease,projectId:body.project_id,mode:body.snapshot?.mode||'independent',requestId:body.request_id});nativeIntents.set(body.request_id,intent);}}return call('wangp',{path,method,body,intent,renderMode:body?.snapshot?.mode||'independent',url:'http://must-not-be-used.invalid:99',token:'wrong-browser-token'});};
try{
 await check('Headless route/method allowlist includes queue and recovery, not arbitrary paths',()=>{for(const p of ['/health','/queue','/requests/a','/jobs/a/metadata','/music-models','/music-model?model_type=yue2'])checkWanGPPath(p,'GET');for(const p of ['/queue/pause','/queue/resume','/generate'])checkWanGPPath(p,'POST');assert.throws(()=>checkWanGPPath('/queue/resume','GET'));assert.throws(()=>checkWanGPPath('/shutdown','POST'));assert.throws(()=>checkWanGPPath('/music-models','POST'));assert.throws(()=>checkWanGPPath('/music-models/../../secret','GET'));});
 const root=join(tmp,'WanGP with spaces'),data=join(tmp,'data');await mkdir(join(root,'shared'),{recursive:true});await writeFile(join(root,'wgp.py'),'# fake SDK root\n');await writeFile(join(root,'shared/__init__.py'),'');await copyFile(join(ROOT,'tests/fixtures/headless_api.py'),join(root,'shared/api.py'));
 c=configuration({H3_DATA_DIR:data,H3_WANGP_ROOT:root,H3_WANGP_PYTHON:process.env.PYTHON_BIN||'python3',H3_WANGP_PORT:String(await port())});
 // Launcher wants an executable path, like the real .venv/bin/python.
 c.python=spawnSync('which',[c.python],{encoding:'utf8'}).stdout.trim();
 let r=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','color=size=32x32:rate=24','-frames:v','107','-c:v','libx264',join(root,'output.mp4')]);assert.equal(r.status,0,r.stderr?.toString());
 await check('Path doctor uses actual interpreter without importing the SDK',()=>{const r=spawnSync(c.python,[join(ROOT,'headless/server.py'),'--root',root,'--data-dir',c.directory,'--check'],{encoding:'utf8'});assert.equal(r.status,2,r.stderr);const result=JSON.parse(r.stdout);assert.equal(result.root,root);assert.equal(result.preflight.structural_ok,true);assert.equal(result.preflight.ready,false);assert.equal(result.preflight.status,'readiness_unverified');});
 await check('Detached worker initializes the public API with no webui_state',async()=>{worker=await startWorker(c);await until(async()=>{worker=await probe(c);return worker.runtime_state==='ready';});assert.equal(JSON.parse(await readFile(join(root,'init.json'))).browser_state_passed,false);assert.equal(worker.plugin_required,false);});
 const originalToken=await readFile(join(c.directory,'token'),'utf8');
 await check('Launcher reuses an existing worker and its static private token',async()=>{const again=await startWorker(c);assert.equal(again.instance,worker.instance);assert.equal(await readFile(join(c.directory,'token'),'utf8'),originalToken);assert.equal((await lstat(join(c.directory,'token'))).mode&0o777,0o600);});
 await check('Node ignores untrusted browser URLs/tokens in headless mode',async()=>{const h=await newBridge();assert.equal(h.wangp_backend.mode,'headless');assert(!JSON.stringify(h).includes(originalToken.trim()));const d=await wangp('/health');assert.equal(d.backend,'headless');assert.equal(d.runtime_state,'ready');});
 await check('Backend UI JavaScript served by the real static allowlist',async()=>{const r=await fetch(base+'/backend-ui.js');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.match(await r.text(),/persistent queue/);});
 await check('Discovered defaults preserve frontend director_profile contract',async()=>{const r=await wangp('/model?model_type=h3_ref2va_pdd');assert.equal(r.director_profile.inference_mode,'pdd8');});
 await check('Headless queue pause is a real server operation',async()=>{await wangp('/queue/pause','POST',{});assert.equal((await wangp('/queue')).paused,true);});
 const payload={request_id:'real-request',project:'Queue fixture',project_id:'p1',snapshot:{id:'p1',windows:[]},plan:[{id:'w1',title:'Window',task_index:1,window_index:1,start_frame:0,end_frame:107,frames:107}],tasks:[{model_type:'h3_ref2va_pdd',num_inference_steps:8,sample_solver:'euler',guidance_phases:1,prompt:'Test',video_length:107,multi_prompts_gen_type:'PW'}]};let jid;
 await check('Accepted request has durable ID and read-only recovery',async()=>{const a=await wangp('/generate','POST',payload);jid=a.job_id;assert.equal(a.status,'queued');assert.equal((await wangp('/requests/real-request')).job_id,jid);await assert.rejects(wangp('/generate','POST',payload),/cancelled|superseded/);});
 await check('Render starts without any Gradio page then survives complete Node shutdown',async()=>{await wangp('/queue/resume','POST',{});await until(async()=>(await wangp('/jobs/'+jid)).status==='running');await closeBridge();await writeFile(join(root,'release'),'finish');await until(async()=>{const h=await probe(c);const s=await fetch(h.target.base+'/jobs/'+jid,{headers:{Authorization:'Bearer '+h.target.token}});return(await s.json()).status==='completed';});});
 let out;
 await check('New Node instance reads completed job, metadata and archived output',async()=>{await newBridge();const j=await wangp('/jobs/'+jid);assert.equal(j.status,'completed');out=j.outputs[0];assert.equal(out.timeline_mapping,'verified_24fps');assert.equal(out.window_index,1);assert.equal((await wangp('/jobs/'+jid+'/metadata')).snapshot.id,'p1');assert.equal((await readFile(join(root,'calls.jsonl'),'utf8')).trim().split('\n').length,1);});
 await check('Authenticated media capability streams a byte range without worker token in URL',async()=>{const m=await call('media-ticket',{url:'bad://browser',token:'bad',jobId:jid,outputId:out.id});assert(!m.url.includes(originalToken.trim()));const r=await fetch(base+m.url,{headers:{Range:'bytes=0-15'}});assert.equal(r.status,206);assert.equal((await r.arrayBuffer()).byteLength,16);});
 await check('Renderer restart retains jobs, output archives and the same credential',async()=>{await closeBridge();await writeFile(join(c.data,'runtime-settings.json'),'{broken');const control=controlConfiguration({H3_DATA_DIR:c.data});assert.equal((await probe(control)).backend,'headless');await stopWorker(control);await rm(join(c.data,'runtime-settings.json'));worker=await startWorker(c);await until(async()=>{worker=await probe(c);return worker.runtime_state==='ready';});await newBridge();assert.equal((await wangp('/jobs/'+jid)).outputs[0].available,true);assert.equal(await readFile(join(c.directory,'token'),'utf8'),originalToken);assert.equal((await wangp('/requests/real-request')).job_id,jid);});
 // Sequence recovery against the actual detached HTTP/SQLite worker (SDK still simulated).
 const sequenceRecord=async(id,extra={})=>{const p=H3.demo();p.id='real-sequence-project';p.mode='managed';p.windows=p.windows.slice(0,2);const r={id,backendMode:'headless',name:'Real service sequence fixture',project:p,plan:S.managedPlan(p),status:'paused',phase:'between_windows',index:0,createdAt:new Date().toISOString(),pauseAfterWindow:true,cancelRequested:false,outputs:[],submissions:[],events:[],...extra};bridge.sequences.runs.set(id,r);await bridge.sequences.save(r);return r;};
 await check('Sequence cancellation removes its queued native job through real worker HTTP without browser focus',async()=>{
   await wangp('/queue/pause','POST',{});
   const id='seq_real_queued',accepted=await wangp('/generate','POST',{...payload,request_id:id+'_0'});
   const r=await sequenceRecord(id,{activeJobId:accepted.job_id,phase:'rendering'});
   await call('sequence',{action:'cancel',id});
   await until(()=>r.status==='cancelled');
   assert.equal((await wangp('/jobs/'+accepted.job_id)).status,'cancelled');
   assert.equal((await wangp('/queue')).paused,true);
 });
 await check('Actual running native job cooperatively cancels and automatically releases its managed record',async()=>{
   await rm(join(root,'release'),{force:true});await wangp('/queue/resume','POST',{});
   const id='seq_real_running',accepted=await wangp('/generate','POST',{...payload,request_id:id+'_0'});
   await until(async()=>(await wangp('/jobs/'+accepted.job_id)).status==='running');
   const r=await sequenceRecord(id,{activeJobId:accepted.job_id,phase:'rendering'});
   await call('sequence',{action:'cancel',id});await until(()=>r.status==='cancelled');
   assert.equal((await wangp('/jobs/'+accepted.job_id)).status,'cancelled');
   await until(async()=>(await wangp('/queue')).active_job_id===null);
   assert((await call('sequence',{action:'manager'})).canSubmitManaged);
 });
 await check('Two idle records are safely ended by the manager with worker token/version unchanged',async()=>{
   await wangp('/queue/pause','POST',{});
   const a=await sequenceRecord('seq_real_parked'),b=await sequenceRecord('seq_real_stale',{cancelRequested:true,status:'cancelling'});
   const d=await call('sequence',{action:'clear-idle',ids:[a.id,b.id]});
   assert(d.results.every(x=>x.cleared||x.reason==='Already finished.'));assert.equal(a.status,'cancelled');assert.equal(b.status,'cancelled');
   assert.equal((await wangp('/queue')).paused,true);assert.equal(await readFile(join(c.directory,'token'),'utf8'),originalToken);
   assert.equal((await wangp('/health')).version,'2.3.0');
 });
 await check('Legacy stuck cancellation reconciles automatically after real Node restart; renderer stays independent',async()=>{
   const id='seq_real_restart';await sequenceRecord(id,{status:'paused',cancelRequested:true,activeJobId:jid,phase:'rendering'});
   await closeBridge();await newBridge();await bridge.ready;await until(()=>['cancelled','completed'].includes(bridge.sequences.runs.get(id)?.status));
   assert.equal((await wangp('/jobs/'+jid)).status,'completed');
   assert.equal((await wangp('/health')).version,'2.3.0');
 });
 await check('Service units keep worker independent; paths with spaces pass systemd validation when available',async()=>{const u=units(c,ROOT);assert.match(u['h3-wangp.service'],/Restart=no/);assert.match(u['h3-director.service'],/H3_WANGP_BACKEND=headless/);assert(!u['h3-wangp.service'].includes('PartOf='));assert(!u['h3-director.service'].includes('Requires='));assert(!u['h3-wangp.service'].includes('WorkingDirectory=\"'));const dir=join(tmp,'units');await mkdir(dir);for(const [n,t]of Object.entries(u))await writeFile(join(dir,n),t);const r=spawnSync('systemd-analyze',['verify',...Object.keys(u).map(n=>join(dir,n))],{encoding:'utf8',timeout:15000});if(r.error?.code==='ENOENT')console.log('  systemd-analyze unavailable; content assertions only');else assert.equal(r.status,0,r.stderr||r.error?.message);});
 await check('Device pairing survives Node/store restart without storing raw cookies',async()=>{const d=join(tmp,'pairing-persist');const s=new StudioStore(d,{network:true,password:'private-fixture-password'});await s.ready;const cookie=await s.pair({socket:{remoteAddress:'127.0.0.1'}},'private-fixture-password');const s2=new StudioStore(d,{network:true});await s2.ready;assert(s2.authenticated({headers:{cookie:'h3studio='+cookie}}));const disk=await readFile(join(d,'paired-devices.json'),'utf8');assert(!disk.includes(cookie));assert(!disk.includes('private-fixture-password'));});
 await check('Changing studio password revokes previous paired-device tokens',async()=>{const d=join(tmp,'pairing-reset');const s=new StudioStore(d,{network:true,password:'old-fixture'});await s.ready;const token=await s.pair({socket:{}},'old-fixture');const same=new StudioStore(d,{network:true,password:'old-fixture'});await same.ready;assert(same.authenticated({headers:{cookie:'h3studio='+token}}));const reset=new StudioStore(d,{network:true,password:'new-fixture'});await reset.ready;assert(!reset.authenticated({headers:{cookie:'h3studio='+token}}));});
 console.log(`\n${count} headless checks passed. Real processes/HTTP/SQLite/FFmpeg; fake WanGP SDK, no GPU.`);
}finally{await closeBridge();try{const h=await probe(c);await fetch(h.target.base+'/shutdown',{method:'POST',headers:{Authorization:'Bearer '+h.target.token,'Content-Type':'application/json'},body:'{}'});await delay(800);}catch{}await rm(tmp,{recursive:true,force:true});}
