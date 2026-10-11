#!/usr/bin/env node
/** State-machine and race regressions. Local fixtures, HTTP and disk; never a live GPU. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,stat,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {StudioStore,atomicJSON} from '../studio-server.mjs';
import {SequenceCoordinator} from '../sequence-server.mjs';
import {createServer} from '../bridge.mjs';
const require=createRequire(import.meta.url),H3=require('../core.js'),S=require('../studio-core.js');
const root=new URL('../',import.meta.url).pathname,tmp=await mkdtemp(join(tmpdir(),'h3-sequence-manager-'));
let total=0,serial=0;const instances=[];
const check=async(name,fn)=>{await fn();console.log('PASS '+name);total++;};
const until=async(fn)=>{for(let i=0;i<250;i++){if(await fn())return;await delay(8);}throw Error('Timed out waiting for sequence condition');};
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function project(){const p=H3.demo();p.id='manager-project';p.mode='managed';p.modelType='fixture';p.presetConfirmed=true;p.windows=p.windows.slice(0,2);for(const w of p.windows){w.casting=Object.fromEntries(p.subjects.map(s=>[s.id,{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'Same character in a field jacket.',retention:''}]));}assert.deepEqual(H3.validate(p,true).filter(x=>x.level==='error'),[]);return p;}
function fixture(){
 const f={jobs:new Map(),payloads:new Map(),requests:new Map(),calls:[],paused:false,offline:false,denied:false,submitGate:null,uploadGate:null,failCancel:false,generateCount:0};
 f.job=(id,status='running')=>{const j={job_id:id,status,project_name:'Fixture render',progress:0,message:status,outputs:[],errors:[]};if(status==='completed')j.outputs=[{id:'a'.repeat(32),available:true,content_type:'video/mp4',window_index:1}];const spec=f.payloads.get(id)?.tasks?.[0]?._director_bounded;if(status==='completed'&&spec){Object.assign(j.outputs[0],{layout:'bounded-v1',source_start_frame:spec.context_frames,source_end_frame:spec.context_frames+spec.new_frames,timeline_start_frame:spec.timeline_start_frame,timeline_end_frame:spec.timeline_start_frame+spec.new_frames,probe:{fps:24,frames:spec.context_frames+spec.new_frames},continuation:{frames:spec.checkpoint_frames}});}if(status==='completed'&&f.payloads.get(id)?.tasks?.[0]?._director_appearance_capture)j.outputs[0].appearance_anchor={jobId:id,outputId:'c'.repeat(32),frame:2};f.jobs.set(id,j);return j;};
 f.fetch=async(url,opt={})=>{
  const p=new URL(url).pathname;f.calls.push({path:p,method:opt.method||'GET',body:opt.body});
  if(f.offline)throw Error('Renderer is offline');
  if(f.denied)return Response.json({error:'Unknown job. Authorization intentionally denied.'},{status:401});
  if(p==='/health')return Response.json({capabilities:{bounded_continuation:1}});
  if(p==='/queue')return Response.json({paused:f.paused,active_job_id:f.activeId??[...f.jobs.values()].find(j=>['running','cancelling'].includes(j.status))?.job_id??null,jobs:[...f.jobs.values()]});
  if(p.startsWith('/requests/')){const id=f.requests.get(p.slice(10));return Response.json({found:!!id,...(id?f.jobs.get(id):{})});}
  if(p==='/upload'){for await(const b of opt.body){}if(f.uploadGate)await f.uploadGate.promise;return Response.json({media_id:'h3media:fixture'});}
  if(p==='/generate'){
   const b=JSON.parse(opt.body),id=(++f.generateCount).toString(16).padStart(32,'0');f.payloads.set(id,b);const j=f.job(id);f.requests.set(b.request_id,id);
   if(f.submitGate)await f.submitGate.promise;
   if(f.lostReply)throw Error('Connection lost after acceptance');
   return Response.json(j);
  }
  if(p==='/import-render')return Response.json({job_id:'imported',outputs:[{id:'b'.repeat(32),available:true}]});
  if(p.includes('/outputs/'))return new Response(Buffer.from('retained-video'));
  if(p.endsWith('/cancel')){
   if(f.failCancel)return Response.json({error:'Temporary cancellation transport error'},{status:503});
   const j=f.jobs.get(p.split('/')[2]);if(!j)return Response.json({error:'Unknown job.'},{status:400});
   if(!['completed','failed','cancelled'].includes(j.status))j.status='cancelling';return Response.json(j);
  }
  if(p.startsWith('/jobs/')){const j=f.jobs.get(p.split('/')[2]);return j?Response.json(j):Response.json({error:'Unknown job.'},{status:400});}
  throw Error('Unexpected fixture route '+p);
 };
 return f;
}
async function setup(options={}){
 const st=new StudioStore(join(tmp,'case'+(++serial)));await st.ready;const f=fixture();
 const c=new SequenceCoordinator(st,{backendMode:'headless',connection:async()=>({base:'http://127.0.0.1:7867',token:'private-fixture'}),fetchImpl:f.fetch,probe:async(_path,frames)=>({fps:24,frames}),pollMs:8,maintenanceMs:15,...options});await c.ready;instances.push(c);return{st,f,c};
}
async function seed(c,overrides={}){
 const p=project(),r={id:'seq_'+H3.uid().replaceAll('-',''),backendMode:'headless',name:'Saved film',project:p,plan:S.managedPlan(p),index:0,status:'paused',phase:'between_windows',createdAt:new Date().toISOString(),pauseAfterWindow:true,cancelRequested:false,outputs:[],submissions:[],events:[],...overrides};
 c.runs.set(r.id,r);await c.save(r);return r;
}
async function stop(c){c.close();await Promise.allSettled([...c.work.values()]);}
try{
 await check('New managed sequence keeps task media local while retaining global film boundaries',async()=>{
  const {c,f}=await setup(),p=project(),run=await c.start(p);await until(()=>f.generateCount===1);
  const first=f.requests.get(run.id+'_0');f.job(first,'completed');await until(()=>f.generateCount===2);
  const second=f.requests.get(run.id+'_1'),body=f.payloads.get(second),rows=S.managedPlan(p);
  assert.equal(body.tasks[0]._director_bounded.timeline_start_frame,rows[1].start_frame);
  assert.equal(body.plan[0].start_frame,rows[1].overlap);
  assert.equal(body.tasks[0]._director_continuation.jobId,first);
  assert.equal(f.calls.filter(x=>x.path==='/import-render').length,0);
  assert(body.tasks[0].image_refs.includes('h3appearance:'+first+':'+ 'c'.repeat(32)));
  assert.equal(body.tasks[0]._director_appearance_capture,undefined);
  assert.match(body.tasks[0].prompt,/Do not reproduce its earlier pose/);
  f.job(second,'completed');await until(()=>c.runs.get(run.id).status==='completed');
  const outputs=c.runs.get(run.id).outputs;
  assert.equal(outputs[1].source_start_frame,rows[1].overlap);
  assert.equal(outputs[1].end_frame,rows[1].end_frame);
  assert.equal(outputs[1].probe.frames,rows[1].overlap+rows[1].frames);
  assert.equal(f.generateCount,2);await stop(c);
 });
 await check('Explicit new-shot override resets the fixed appearance anchor without changing overlap',async()=>{
  const {c,f}=await setup(),p=project();p.windows[1].continuity={mode:'new-shot'};
  const run=await c.start(p);await until(()=>f.generateCount===1);
  f.job(f.requests.get(run.id+'_0'),'completed');await until(()=>f.generateCount===2);
  const second=f.requests.get(run.id+'_1'),body=f.payloads.get(second);
  assert(!body.tasks[0].image_refs.some(x=>x.startsWith('h3appearance:')));
  assert(body.tasks[0]._director_appearance_capture);
  assert.equal(body.tasks[0]._director_bounded.context_frames,S.managedPlan(p)[1].overlap);
  f.job(second,'completed');await until(()=>c.runs.get(run.id).status==='completed');
  assert.equal(Object.keys(c.runs.get(run.id).appearanceAnchors).length,2);await stop(c);
 });
 await check('Managed partial branch submits only chosen windows using the verified edited prefix',async()=>{
  const {c,f}=await setup();const p=project(),source=f.job('e'.repeat(32),'completed');source.outputs=[{id:'f'.repeat(32),available:true}];
  const target=p.windows[1].id,q=H3.branch(p,target,'single',{jobId:source.job_id,outputId:source.outputs[0].id,keepFrames:120});q.mode='managed';
  const run=await c.start(q);await until(()=>f.generateCount===1);const body=JSON.parse(f.calls.find(x=>x.path==='/generate').body);
  assert.deepEqual(body.plan.map(x=>x.id),[target]);assert.equal(body.plan[0].start_frame,H3.schedule(q)[0].overlap);assert.equal(body.tasks[0]._director_bounded.timeline_start_frame,120);
  assert.equal(body.tasks[0]._director_continuation.keepFrames,120);assert.equal(body.tasks[0]._director_continuation.jobId,source.job_id);
  const job=f.jobs.get(f.requests.get(run.id+'_0'));f.job(job.job_id,'completed');await until(()=>c.runs.get(run.id).status==='completed');
  assert.equal(c.runs.get(run.id).outputs.length,1);assert.equal(f.generateCount,1);await stop(c);
 });
 await check('Missing edited prefix and renderer reservation fail before GPU dispatch',async()=>{
  const {c,f}=await setup();const p=project(),q=H3.branch(p,p.windows[1].id,'single',{jobId:'e'.repeat(32),outputId:'f'.repeat(32),keepFrames:120});q.mode='managed';
  await assert.rejects(()=>c.start(q),/Unknown job|not available/);assert.equal(f.generateCount,0);
  c.externalBusy=()=>true;const d=await c.manager();assert.equal(d.canSubmitManaged,false);assert.match(d.explanation,/Finishing/);
  await assert.rejects(()=>c.start(p),/finishing/);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Manager separates parked records, queue pause, and cancellation without mutating on refresh',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const a=await seed(c),b=await seed(c,{status:'cancelling',cancelRequested:true});f.paused=true;
  const d=await c.handle({action:'manager'});assert.equal(d.queue.idle,true);assert.equal(d.queue.paused,true);assert(d.runs.find(x=>x.id===a.id).parked);assert(d.runs.find(x=>x.id===b.id).blocking);assert.equal(b.status,'cancelling');assert(f.calls.every(x=>x.method==='GET'));await stop(c);
 });
 await check('Old paused+cancelRequested records recover after restart with no browser or Resume',async()=>{
  const {c,st,f}=await setup({maintenanceMs:0});const r=await seed(c,{status:'paused',cancelRequested:true,activeJobId:'a'.repeat(32),phase:'rendering'});f.job(r.activeJobId,'cancelled');await stop(c);
  const n=new SequenceCoordinator(st,{backendMode:'headless',connection:c.connection,fetchImpl:f.fetch,maintenanceMs:10,pollMs:8});instances.push(n);await n.ready;
  await until(()=>n.runs.get(r.id).status==='cancelled');assert(!f.calls.some(x=>x.path==='/generate'));assert.equal(JSON.parse(await readFile(n.path(r.id))).status,'cancelled');await stop(n);
 });
 await check('A safely parked sequence no longer blocks a new managed film',async()=>{
  const {c,f}=await setup();const parked=await seed(c);const r=await c.start(project());await until(()=>f.generateCount===1);assert.equal(parked.status,'paused');assert.equal(r.status,'running');await stop(c);
 });
 await check('Two simultaneous managed starts cannot acquire the renderer together',async()=>{
  const {c,f}=await setup();const responses=await Promise.allSettled([c.start(project()),c.start(project())]);assert.equal(responses.filter(r=>r.status==='fulfilled').length,1);await until(()=>f.generateCount===1);await stop(c);
 });
 await check('Resume is rejected for sticky cancellation',async()=>{
  const {c}=await setup({maintenanceMs:0});const r=await seed(c,{cancelRequested:true,status:'cancelling'});await assert.rejects(()=>c.handle({action:'resume',id:r.id}),/Cancellation cannot/);await stop(c);
 });
 await check('Renderer queue pause is explicit and is never cleared by start/resume',async()=>{
  const {c,f}=await setup();f.paused=true;const r=await seed(c);await assert.rejects(()=>c.handle({action:'resume',id:r.id}),/queue is paused/);await assert.rejects(()=>c.start(project()),/queue is paused/);assert.equal(f.paused,true);assert(!f.calls.some(x=>x.path==='/queue/resume'));await stop(c);
 });
 await check('Paused record with a running native job is not called safely parked',async()=>{
  const {c,f}=await setup();const r=await seed(c,{activeJobId:'a'.repeat(32),phase:'rendering'});f.job(r.activeJobId);const d=await c.manager();assert.equal(d.runs[0].parked,false);assert.equal(d.runs[0].actions.endIdle,false);await assert.rejects(()=>c.start(project()),/needs attention/);await stop(c);
 });
 await check('Resume tracks its own already accepted native job without generating a duplicate',async()=>{
  const {c,f}=await setup();const r=await seed(c,{activeJobId:'a'.repeat(32),phase:'rendering'});f.job(r.activeJobId);await c.handle({action:'resume',id:r.id});await until(()=>f.calls.some(x=>x.path==='/jobs/'+r.activeJobId));assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Concurrent resume requests cannot start two parked sequences',async()=>{
  const {c,f}=await setup();const a=await seed(c),b=await seed(c);const v=await Promise.allSettled([c.handle({action:'resume',id:a.id}),c.handle({action:'resume',id:b.id})]);assert.equal(v.filter(x=>x.status==='fulfilled').length,1);await until(()=>f.generateCount===1);await stop(c);
 });
 await check('Cancelling while uploading prevents any generation submission',async()=>{
  const {c,f,st}=await setup();const p=project();p.assets=[{id:'photo',kind:'image',number:1,name:'photo.png',size:3}];p.windows[0].assetIds=['photo'];await st.putBlob('photo',Readable.from('abc'),3,'image/png');f.uploadGate=gate();const r=await c.start(p);await until(()=>f.calls.some(x=>x.path==='/upload'));await c.handle({action:'cancel',id:r.id});f.uploadGate.resolve();await until(()=>c.runs.get(r.id).status==='cancelled');assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Pause during reference preparation stops before submitting a GPU task',async()=>{
  const {c,f,st}=await setup();const p=project();p.assets=[{id:'photo',kind:'image',number:1,name:'photo.png',size:3}];p.windows[0].assetIds=['photo'];await st.putBlob('photo',Readable.from('abc'),3,'image/png');f.uploadGate=gate();const r=await c.start(p);await until(()=>f.calls.some(x=>x.path==='/upload'));await c.handle({action:'pause',id:r.id});f.uploadGate.resolve();await until(()=>c.runs.get(r.id).status==='paused');assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Cancel during in-flight acceptance attaches returned job then cancels it once',async()=>{
  const {c,f}=await setup();f.submitGate=gate();const r=await c.start(project());await until(()=>f.generateCount===1);await c.handle({action:'cancel',id:r.id});f.submitGate.resolve();await until(()=>f.calls.some(x=>x.path.endsWith('/cancel')));const j=[...f.jobs.values()][0];j.status='cancelled';await until(()=>c.runs.get(r.id).status==='cancelled');assert.equal(f.generateCount,1);assert.equal(f.calls.filter(x=>x.path.endsWith('/cancel')).length,1);await stop(c);
 });
 await check('Completion racing cancellation keeps verified output and never sends the next window',async()=>{
  const {c,f}=await setup();f.submitGate=gate();const r=await c.start(project());await until(()=>f.generateCount===1);const id=[...f.jobs.keys()][0];f.job(id,'completed');await c.handle({action:'cancel',id:r.id});f.submitGate.resolve();await until(()=>c.runs.get(r.id).status==='cancelled');const saved=c.runs.get(r.id);assert.equal(saved.index,1);assert.equal(saved.outputs.length,1);assert.equal(f.generateCount,1);assert.equal((await readFile(join(c.store.root,'renders',saved.outputs[0].id+'.mp4'))).toString(),'retained-video');await stop(c);
 });
 await check('Cancellation transport failure remains cancelling and retries observation without Resume',async()=>{
  const {c,f}=await setup();const r=await seed(c,{activeJobId:'c'.repeat(32),phase:'rendering'});const j=f.job(r.activeJobId);f.failCancel=true;await c.handle({action:'cancel',id:r.id});await until(()=>!!r.error);assert.equal(r.status,'cancelling');f.failCancel=false;await until(()=>j.status==='cancelling');j.status='cancelled';await until(()=>r.status==='cancelled');assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Paused+completed job can be reconciled and archived without submitting its successor',async()=>{
  const {c,f}=await setup();const r=await seed(c,{activeJobId:'b'.repeat(32),phase:'rendering'});f.job(r.activeJobId,'completed');await c.handle({action:'reconcile',id:r.id});await until(()=>r.index===1&&!c.work.has(r.id));assert.equal(r.status,'paused');assert.equal(r.outputs.length,1);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Pause after the active window archives it, then parks with no successor',async()=>{
  const {c,f}=await setup();const r=await c.start(project());await until(()=>f.generateCount===1);await c.handle({action:'pause',id:r.id});f.job([...f.jobs.keys()][0],'completed');await until(()=>c.runs.get(r.id).status==='paused');assert.equal(c.runs.get(r.id).index,1);assert.equal(f.generateCount,1);await stop(c);
 });
 await check('Clear preview and confirmed cleanup preserve records and media, queue stays paused',async()=>{
  const {c,f,st}=await setup({maintenanceMs:0});f.paused=true;const a=await seed(c),b=await seed(c,{status:'cancelling',cancelRequested:true});await writeFile(join(st.root,'renders','untouched.mp4'),'saved');const before=await readFile(c.path(a.id));const preview=await c.handle({action:'clear-idle-preview',ids:[a.id,b.id]});assert.equal(preview.results.filter(r=>r.eligible).length,2);assert.equal(a.status,'paused');const d=await c.handle({action:'clear-idle',ids:[a.id,b.id]});assert.equal(d.results.filter(x=>x.cleared).length,2);assert.equal(a.status,'cancelled');assert.equal(b.status,'cancelled');const backups=await readdir(join(st.root,'sequence-backups'));assert.equal(backups.length,2);for(const path of backups)assert.equal((await stat(join(st.root,'sequence-backups',path))).mode&0o777,0o600);assert.equal(JSON.parse(await readFile(join(st.root,'sequence-backups',a.lastBackup))).status,'paused');assert.equal((await readFile(join(st.root,'renders','untouched.mp4'))).toString(),'saved');assert(f.paused);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Repeated idle cleanup is idempotent and does not create extra backups',async()=>{
  const {c,st}=await setup({maintenanceMs:0});const r=await seed(c);await c.handle({action:'clear-idle',ids:[r.id]});await c.handle({action:'clear-idle',ids:[r.id]});assert.equal((await readdir(join(st.root,'sequence-backups'))).length,1);await stop(c);
 });
 await check('Cleanup rechecks the renderer, refusing newly queued work after preview',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c);assert((await c.handle({action:'clear-idle-preview',ids:[r.id]})).results[0].eligible);f.job('d'.repeat(32),'queued');const d=await c.handle({action:'clear-idle',ids:[r.id]});assert.equal(d.results[0].cleared,false);assert.equal(r.status,'paused');await stop(c);
 });
 await check('Unreachable renderer blocks cleanup and new managed dispatch',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c);f.offline=true;const d=await c.manager();assert.equal(d.queue.reachable,false);assert.equal(d.runs[0].actions.endIdle,false);assert.equal((await c.handle({action:'clear-idle',ids:[r.id]})).results[0].cleared,false);assert.equal(r.status,'paused');await assert.rejects(()=>c.start(project()));await stop(c);
 });
 await check('Authentication error containing Unknown job never becomes evidence of a missing job',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c,{activeJobId:'a'.repeat(32),phase:'rendering'});f.denied=true;const o=await c.observe(r);assert.equal(o.reachable,false);assert.equal(o.idleConfirmed,false);assert.equal(c.summary(r,o).actions.endIdle,false);await stop(c);
 });
 await check('Uncertain acceptance plus empty queue is NOT safe cleanup evidence',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c,{phase:'submitting',status:'uncertain'});const d=await c.manager();assert(d.queue.idle);assert(d.runs[0].observed.unknown);assert(!d.runs[0].actions.endIdle);assert.equal((await c.handle({action:'clear-idle',ids:[r.id]})).results[0].cleared,false);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Lost accepted response is reconciled by request ID without regeneration',async()=>{
  const {c,f}=await setup();f.lostReply=true;const r=await c.start(project());await until(()=>c.runs.get(r.id).status==='uncertain');await c.handle({action:'reconcile',id:r.id});await until(()=>c.runs.get(r.id).status==='paused'&&!c.work.has(r.id));assert.equal(c.runs.get(r.id).activeJobId,[...f.jobs.keys()][0]);assert.equal(f.generateCount,1);await stop(c);
 });
 await check('Unknown cancellation can find a later accepted job and stop it without generating',async()=>{
  const {c,f}=await setup();const r=await seed(c,{status:'uncertain',phase:'submitting'});await c.handle({action:'cancel',id:r.id});await delay(30);assert.equal(r.status,'cancelling');const j=f.job('a'.repeat(32));f.requests.set(r.id+'_0',j.job_id);await until(()=>j.status==='cancelling');j.status='cancelled';await until(()=>r.status==='cancelled');assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Manual attach cannot claim another job under a managed sequence',async()=>{
  const {c,f}=await setup();const r=await seed(c,{status:'uncertain',phase:'submitting'});const j=f.job('a'.repeat(32));f.requests.set(r.id+'_0',j.job_id);await assert.rejects(()=>c.handle({action:'attach-job',id:r.id,jobId:'b'.repeat(32)}),/not the accepted/);assert(!r.activeJobId);await stop(c);
 });
 await check('Known deleted native ID can be ended after empty queue and absent request are confirmed',async()=>{
  const {c}=await setup({maintenanceMs:0});const r=await seed(c,{activeJobId:'a'.repeat(32),phase:'rendering',cancelRequested:true,status:'cancelling'});const d=await c.handle({action:'clear-idle',ids:[r.id]});assert.equal(d.results[0].cleared,true);await stop(c);
 });
 await check('Idle cleanup cannot run during in-flight preparation or submission',async()=>{
  const {c,f}=await setup();f.submitGate=gate();const r=await c.start(project());await until(()=>f.generateCount===1);const d=await c.handle({action:'clear-idle',ids:[r.id]});assert.equal(d.results[0].cleared,false);f.submitGate.resolve();await stop(c);
 });
 await check('History hide/restore is terminal-only, backed up, and does not delete output files',async()=>{
  const {c,st}=await setup();const r=await seed(c,{status:'cancelled',phase:'finished'});await writeFile(join(st.root,'renders','history.mp4'),'old');await c.handle({action:'archive',id:r.id});assert(r.archivedAt);await c.handle({action:'restore',id:r.id});assert.equal(r.archivedAt,null);assert.equal((await readFile(join(st.root,'renders','history.mp4'))).toString(),'old');const a=await seed(c);await assert.rejects(()=>c.handle({action:'archive',id:a.id}),/Only finished/);await stop(c);
 });
 await check('Reconciliation of final completed window ends the sequence with a saved take',async()=>{
  const {c,f}=await setup();const r=await seed(c,{index:1,activeJobId:'a'.repeat(32),phase:'rendering'});f.job(r.activeJobId,'completed');await c.handle({action:'reconcile',id:r.id});await until(()=>r.status==='completed');assert.equal(r.index,2);assert.equal(r.outputs.length,1);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Cancellation with an unmappable completed output preserves its native ID and ends safely',async()=>{
  const {c,f}=await setup({probe:async()=>{throw Error('Frame mismatch');}});const r=await seed(c,{activeJobId:'a'.repeat(32),phase:'rendering'});f.job(r.activeJobId,'completed');await c.handle({action:'cancel',id:r.id});await until(()=>r.status==='cancelled');assert.equal(r.unarchivedJobId,'a'.repeat(32));assert.match(r.error,/not added/);assert.equal(f.generateCount,0);await stop(c);
 });
 await check('Cross-backend screenshot case shows scope instead of mistaking a saved phase for live cancellation',async()=>{
  const {c,f}=await setup();const r=await seed(c,{id:'seq_1ab0c0f98085146b0cda55ee8ebd40b7',backendMode:undefined,status:'cancelling',phase:'cancelled',cancelRequested:true,index:1,outputs:[{id:'c'.repeat(32),available:true}]});
  const before=await readFile(c.path(r.id));const d=await c.manager(),row=d.runs[0];
  assert.deepEqual(row.backend,{recorded:'legacy',current:'headless',inferred:true,mismatch:true});
  assert.equal(row.label,'Other backend');assert.equal(row.status,'cancelling');assert.equal(row.phase,'cancelled');assert.equal(row.outputs,1);
  assert(row.blocking);assert(row.actions.retire);for(const a of ['pause','resume','cancel','reconcile','endIdle'])assert.equal(row.actions[a],false);
  await c.maintenance();await delay(50);assert.equal(c.work.size,0);assert.deepEqual(await readFile(c.path(r.id)),before);
  assert(f.calls.every(x=>x.path==='/queue'));await stop(c);
 });
 await check('Coordinator restart leaves a foreign checkpoint byte-for-byte unchanged without network polling',async()=>{
  const {c,f,st}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy',status:'cancelling',phase:'cancelled',cancelRequested:true});const before=await readFile(c.path(r.id));await stop(c);f.calls=[];
  const n=new SequenceCoordinator(st,{backendMode:'headless',connection:c.connection,fetchImpl:f.fetch,maintenanceMs:10,pollMs:8});instances.push(n);await n.ready;await delay(50);
  assert.deepEqual(await readFile(n.path(r.id)),before);assert.equal(n.work.size,0);assert.deepEqual(f.calls,[]);await stop(n);
 });
 await check('Every foreign mutating control refuses; idle cleanup cannot reinterpret an empty current queue',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy',cancelRequested:true,status:'cancelling'});
  for(const action of ['pause','resume','cancel','reconcile','attach-job','archive','restore'])await assert.rejects(()=>c.handle({action,id:r.id}),/record uses legacy/);
  assert.equal((await c.handle({action:'clear-idle',ids:[r.id]})).results[0].cleared,false);assert.equal(r.status,'cancelling');assert(f.calls.every(x=>x.path==='/queue'));await stop(c);
 });
 const retirement=async(c,r)=>{const d=await c.handle({action:'retire-preview',id:r.id});return {action:'retire',id:r.id,acknowledgeOtherRendererStopped:true,expectedBackend:d.backend.recorded,expectedCurrentBackend:d.backend.current,revision:d.revision};};
 await check('Local retirement requires checkbox acknowledgment plus exact preview revision and backend',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy'});const b=await retirement(c,r);
  for(const change of [{acknowledgeOtherRendererStopped:false},{acknowledgeOtherRendererStopped:'true'},{revision:'old'},{expectedBackend:'headless'},{expectedCurrentBackend:'legacy'}])await assert.rejects(()=>c.handle({...b,...change}),/Confirm|changed/);
  assert.equal(r.status,'paused');assert.equal(r.lastBackup,undefined);assert.deepEqual(f.calls,[]);await stop(c);
 });
 await check('Retirement is backed up, terminal, output-preserving and performs zero renderer calls even offline',async()=>{
  const {c,f,st}=await setup({maintenanceMs:0});f.offline=true;
  const output={id:'d'.repeat(32),available:true,content_type:'video/mp4',end_frame:226};const r=await seed(c,{backendMode:'legacy',cancelRequested:true,status:'cancelling',phase:'cancelled',outputs:[output],activeJobId:'a'.repeat(32)});
  await writeFile(join(st.root,'renders',output.id+'.mp4'),'original bytes');const before=H3.clone(r);const b=await retirement(c,r);const result=await c.handle(b);
  assert.equal(result.status,'retired');assert.equal(r.phase,'tracking_ended');assert.equal(r.retirement.rendererCancellationVerified,false);assert.equal(r.retirement.previousStatus,'cancelling');assert.equal(r.retirement.previousPhase,'cancelled');
  assert.equal(r.activeJobId,before.activeJobId);assert.deepEqual(r.outputs,before.outputs);assert.deepEqual(r.project,before.project);assert.deepEqual(r.submissions,before.submissions);assert.equal(r.backendMode,'legacy');assert(r.archivedAt);
  const backup=JSON.parse(await readFile(join(st.root,'sequence-backups',r.lastBackup)));assert.equal(backup.status,'cancelling');assert.deepEqual(backup.outputs,before.outputs);
  assert.equal((await stat(join(st.root,'sequence-backups',r.lastBackup))).mode&0o777,0o600);assert.equal((await readFile(join(st.root,'renders',output.id+'.mp4'))).toString(),'original bytes');assert.deepEqual(f.calls,[]);
  await c.handle(b);assert.equal((await readdir(join(st.root,'sequence-backups'))).length,1);await stop(c);
 });
 await check('Retired records persist, stay terminal after switching backends, and history restore never resumes',async()=>{
  const {c,f,st}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy',status:'cancelling',cancelRequested:true});await c.handle(await retirement(c,r));await stop(c);f.calls=[];
  const n=new SequenceCoordinator(st,{backendMode:'legacy',connection:c.connection,fetchImpl:f.fetch,maintenanceMs:10,pollMs:8});instances.push(n);await n.ready;await delay(40);
  const saved=n.runs.get(r.id);assert.equal(saved.status,'retired');await n.handle({action:'restore',id:r.id});assert.equal(saved.archivedAt,null);assert.equal(saved.status,'retired');assert.equal(n.summary(saved).blocking,false);
  await assert.rejects(()=>n.handle({action:'resume',id:r.id}),/Cancellation|finished/);await n.handle({action:'cancel',id:r.id});await n.handle({action:'reconcile',id:r.id});assert.equal(n.work.size,0);assert.deepEqual(f.calls,[]);await stop(n);
 });
 await check('Retiring foreign work removes only its blocker; current queue pause and running jobs still apply',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy'});await c.handle(await retirement(c,r));f.paused=true;
  let d=await c.manager();assert(!d.runs[0].blocking);assert(!d.canSubmitManaged);assert(f.paused);
  f.paused=false;f.job('b'.repeat(32),'running');assert.equal((await c.manager()).canSubmitManaged,false);await assert.rejects(()=>c.assertAvailable(),/active or queued/);
  f.jobs.clear();assert.equal((await c.manager()).canSubmitManaged,true);assert.equal(f.generateCount,0);assert(f.calls.every(x=>x.method==='GET'));await stop(c);
 });
 await check('Current-backend, terminal and in-flight records cannot use other-backend retirement',async()=>{
  const {c,f}=await setup({maintenanceMs:0});const current=await seed(c);await assert.rejects(()=>c.handle({action:'retire-preview',id:current.id}),/Only unfinished/);
  const other=await seed(c,{backendMode:'legacy',status:'completed'});await assert.rejects(()=>c.handle({action:'retire-preview',id:other.id}),/Only unfinished/);
  other.status='paused';const g=gate();c.work.set(other.id,g.promise);await assert.rejects(()=>c.handle({action:'retire-preview',id:other.id}),/in flight/);c.work.delete(other.id);g.resolve();assert.deepEqual(f.calls,[]);await stop(c);
 });
 await check('Failed retirement persistence leaves in-memory state unchanged and still blocking',async()=>{
  const {c}=await setup({maintenanceMs:0});const r=await seed(c,{backendMode:'legacy'});const b=await retirement(c,r),realSave=c.save;
  c.save=async()=>{throw Error('Disk unavailable');};await assert.rejects(()=>c.handle(b),/Disk unavailable/);c.save=realSave;assert.equal(r.status,'paused');assert(!r.retirement);assert(c.summary(r).blocking);await stop(c);
 });
 await check('Inverse mismatch preserves headless records when Director was launched in legacy mode',async()=>{
  const {c,f}=await setup({maintenanceMs:0,backendMode:'legacy'});const r=await seed(c,{backendMode:'headless',status:'paused'});const d=await c.manager();assert.equal(d.backend,'legacy');assert.equal(d.runs[0].backend.recorded,'headless');assert(d.runs[0].backend.mismatch);assert.equal(d.runs[0].actions.resume,false);assert.equal(r.status,'paused');assert.deepEqual(f.calls,[]);await stop(c);
 });

 // Actual bridge HTTP proves these controls retain pairing and CSRF restrictions.
 const stData=join(tmp,'http');const f=fixture();const bridge=createServer({port:0,host:'0.0.0.0',dataDir:stData,root,studioPassword:'sequence-test-private',backendOptions:{mode:'headless'},sequenceOptions:{fetchImpl:f.fetch,probe:async()=>{},maintenanceMs:0}});
 bridge.sequences.connection=async()=>({base:'http://127.0.0.1:7867',token:'private-fixture'});
 await new Promise(r=>bridge.listen(0,'127.0.0.1',r));await bridge.ready;
 const base='http://127.0.0.1:'+bridge.address().port;
 try{
  await check('Actual manager HTTP is pairing-protected and needs CSRF for actions',async()=>{
   assert.equal((await fetch(base+'/api/sequence',{method:'POST',body:'{"action":"manager"}'})).status,401);
   const pair=await fetch(base+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'sequence-test-private'})});
   f.cookie=pair.headers.get('set-cookie').split(';')[0];
   f.token=(await(await fetch(base+'/api/health',{headers:{Cookie:f.cookie}})).json()).token;
   assert.equal((await fetch(base+'/api/sequence',{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:'{"action":"manager"}'})).status,403);
  });
  const post=async b=>fetch(base+'/api/sequence',{method:'POST',headers:{Cookie:f.cookie,'X-H3-Token':f.token,'Content-Type':'application/json'},body:JSON.stringify(b)});
  await check('Actual Node routes expose manager, cleanup and private diagnostic without worker secret',async()=>{
   const r=await seed(bridge.sequences);const res=await post({action:'manager'});assert.equal(res.status,200);const d=await res.json();assert.equal(d.runs.length,1);assert(!JSON.stringify(d).includes('private-fixture'));
   const preview=await post({action:'clear-idle-preview',ids:[r.id]});assert((await preview.json()).results[0].eligible);
   assert.equal((await(await post({action:'clear-idle',ids:[r.id]})).json()).results[0].cleared,true);
   const diag=await(await post({action:'diagnostics',id:r.id})).json();assert(diag.events.some(e=>e.action==='end-idle'));assert(!JSON.stringify(diag).includes('private-fixture'));
  });
  await check('Actual HTTP retirement is consent-gated, revision-checked, and idempotent without renderer traffic',async()=>{
   const r=await seed(bridge.sequences,{backendMode:'legacy',status:'cancelling',phase:'cancelled',cancelRequested:true});
   const p=await(await post({action:'retire-preview',id:r.id})).json();
   const b={action:'retire',id:r.id,revision:p.revision,expectedBackend:p.backend.recorded,expectedCurrentBackend:p.backend.current,acknowledgeOtherRendererStopped:true};
   assert.equal((await fetch(base+'/api/sequence',{method:'POST',headers:{Cookie:f.cookie,'Content-Type':'application/json'},body:JSON.stringify(b)})).status,403);
   assert.notEqual((await post({...b,acknowledgeOtherRendererStopped:false})).status,200);assert.equal(r.status,'cancelling');
   const count=f.calls.length;assert.equal((await(await post(b)).json()).status,'retired');assert.equal((await(await post(b)).json()).status,'retired');assert.equal(f.calls.length,count);
   const diag=await(await post({action:'diagnostics',id:r.id})).json();assert.equal(diag.retirement.rendererCancellationVerified,false);assert.equal(diag.retirement.previousPhase,'cancelled');assert.equal(diag.backend.recorded,'legacy');assert(!JSON.stringify(diag).includes('private-fixture'));
  });
  await check('Retired server record remains retrievable for saved renders and has no cancel action',async()=>{
   const r=[...bridge.sequences.runs.values()].find(r=>r.status==='retired');const d=await(await post({action:'get',id:r.id})).json();assert.equal(d.status,'retired');assert.equal(d.live.status,'retired');assert.equal(d.live.sequence.phase,'tracking_ended');
   const m=await(await post({action:'manager'})).json();const row=m.runs.find(x=>x.id===r.id);assert(!row.blocking);assert(!row.actions.cancel);assert(!row.actions.resume);assert(row.actions.restore);
  });
  await check('Sequence UI is included and served with JavaScript MIME over authenticated HTTP',async()=>{
   const r=await fetch(base+'/sequence-ui.js',{headers:{Cookie:f.cookie}});assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/javascript/);assert.match(await r.text(),/End all safely idle/);
   assert.match(await(await fetch(base+'/index.html',{headers:{Cookie:f.cookie}})).text(),/sequence-ui.js/);
  });
  await check('Cleanup rejects traversal, missing IDs and malformed batch inputs',async()=>{
   for(const ids of [[],['../outside'],null,Array(201).fill('seq_a')])assert.notEqual((await post({action:'clear-idle',ids})).status,200);
  });
 }finally{bridge.closeAllConnections();await new Promise(r=>bridge.close(r));}
 console.log(`\n${total} sequence-manager checks passed. Simulated renderer; real HTTP, files and race scheduling.`);
}finally{for(const c of instances)c.close();await Promise.allSettled(instances.flatMap(c=>[...c.work.values()]));await rm(tmp,{recursive:true,force:true});}
