/** Sequential, per-window H3 submission. Restart/uncertain response never blindly retries. */
import {readFile,readdir,stat,rm,mkdir} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {atomicJSON,loadJSON,safeID,serveFile} from './studio-server.mjs';
const require=createRequire(import.meta.url),H3=require('./core.js'),S=require('./studio-core.js'),Continuity=require('./continuity-core.js'),Progress=require('./progress-core.js'),exec=promisify(execFile);
const nativeTerminal=new Set(['completed','cancelled','failed']);
const terminal=new Set([...nativeTerminal,'retired']),sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Read actual decoded frames. Strict prefixes still require exact agreement; new
// completed output can use the small, audited tolerance below (never a wildcard).
export const MAX_FRAME_DRIFT=4;
export function checkFrameCount(meta,expected,start=0,tolerance=0){
  const {fps,frames}=meta||{};
  if(!Number.isFinite(fps)||Math.abs(fps-24)>.01||!Number.isSafeInteger(frames)||frames<=start||Math.abs(frames-expected)>tolerance){
    const e=Error(`Saved prefix is ${frames} frames at ${fps} fps; ${tolerance?'target':'expected exactly'} ${expected} at 24 fps (allowed boundary difference: ${tolerance} frames). Native file is kept. Review before continuing.`);
    e.code='OUTPUT_TIMING_MISMATCH';e.measured=meta;e.expected=expected;throw e;
  }
  return {...meta,expected,delta:frames-expected};
}
export async function inspectVideo(path,expected,options={}){
  const {stdout,stderr}=await exec(process.env.FFPROBE_BIN||'ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=avg_frame_rate,nb_read_frames','-of','json',path],{timeout:120000,maxBuffer:1024*1024});
  if(stderr?.trim())throw Error('Video decoding reported errors during frame verification. Native file is kept; review before continuing.');
  const v=JSON.parse(stdout).streams?.[0],[n,d=1]=String(v?.avg_frame_rate||'0').split('/').map(Number);
  return checkFrameCount({fps:n/d,frames:Number(v?.nb_read_frames)},expected,options.start||0,options.tolerance||0);
}
export function rebasePlan(plan,index,actualEnd){
  const row=plan[index],delta=actualEnd-row.end_frame;
  if(!Number.isSafeInteger(actualEnd)||actualEnd<=row.start_frame||Math.abs(delta)>MAX_FRAME_DRIFT)throw Error('Unsafe frame-boundary adjustment.');
  return plan.map((w,i)=>i<index?{...w}:i===index?{...w,requested_frames:w.requested_frames??w.frames,planned_end_frame:w.planned_end_frame??w.end_frame,end_frame:actualEnd,frames:actualEnd-w.start_frame,span:actualEnd-w.start_frame+w.overlap}:{...w,start_frame:w.start_frame+delta,end_frame:w.end_frame+delta});
}
export class SequenceCoordinator {
  constructor(store, {fetchImpl=fetch, probe=inspectVideo, pollMs=2000,
    connection=null, backendMode='legacy', maintenanceMs=2500}={}) {
    this.store=store; this.connection=connection; this.backendMode=backendMode;
    this.fetch=fetchImpl; this.probe=probe; this.pollMs=pollMs;
    this.runs=new Map(); this.work=new Map(); this.observations=new Map();
    this.closed=false; this.timer=null; this.maintenanceMs=maintenanceMs;
    this.ready=this.init();
  }
  async init() {
    await this.store.ready;
    for (const f of await readdir(join(this.store.root,'runs'))) {
      if (!f.endsWith('.json')) continue;
      const r=await loadJSON(join(this.store.root,'runs',f));
      if (!r || !safeID(r.id) || !Array.isArray(r.plan)) continue;
      r.events=Array.isArray(r.events)?r.events:[];
      if (!terminal.has(r.status) && !this.backendMismatch(r)) {
        if (r.cancelRequested || r.status==='cancelling') {
          r.cancelRequested=true; r.pauseAfterWindow=true; r.status='cancelling';
          r.message='Restored cancellation intent. Checking the renderer; no next window will be submitted.';
        } else {
          r.status=r.phase==='submitting'&&!r.activeJobId?'uncertain':'paused';
          r.pauseAfterWindow=true;
          r.message=r.status==='uncertain'
            ?'Submission outcome unknown. Find the accepted job; no automatic retry.'
            :'Director restarted. Parked until explicitly resumed; an accepted render may still be running.';
        }
        await this.save(r);
      }
      this.runs.set(r.id,r);
    }
    // Cancelling is a sticky user intent, not a resumeable pause. It must progress
    // even when every browser is closed. Never auto-resume normal generation.
    if (this.maintenanceMs>0) {
      this.timer=setInterval(()=>{this.maintenanceWork=this.maintenance().catch(()=>{});},this.maintenanceMs);
      this.timer.unref();
    }
  }
  recordBackend(r) {return r.backendMode||'legacy';}
  backendMismatch(r) {return this.recordBackend(r)!==this.backendMode;}
  backendInfo(r) {return {recorded:this.recordBackend(r),current:this.backendMode,inferred:!r.backendMode,mismatch:this.backendMismatch(r)};}
  path(id) {if(!safeID(id))throw Error('Invalid sequence ID.');return join(this.store.root,'runs',id+'.json');}
  async save(r) {return this.store.serialize('sequence-record:'+r.id,async()=>{r.updatedAt=new Date().toISOString();if(terminal.has(r.status)&&!r.finishedAt)r.finishedAt=r.updatedAt;await atomicJSON(this.path(r.id),S.redact(r));});}
  event(r,action,message) {
    r.events=[...(r.events||[]),{at:new Date().toISOString(),action,message}].slice(-150);
    if(action.startsWith('appearance'))r.appearanceStatus={action,message,windowId:r.plan?.[r.index]?.id||null};
  }
  async backup(r,reason) {
    const dir=join(this.store.root,'sequence-backups');await mkdir(dir,{recursive:true,mode:0o700});
    const name=r.id+'-'+Date.now()+'-'+randomBytes(4).toString('hex')+'.json';
    await atomicJSON(join(dir,name),S.redact({...r,backupReason:reason}));
    r.lastBackup=name;return name;
  }
  async credentials(r) {
    if(this.backendMismatch(r))throw Error('This sequence belongs to a different backend. Finish it there or begin a deliberate new run.');
    if(this.connection)return this.connection(r);
    const token=this.store.credentials.wangp;if(!token)throw Error('Remember the current WanGP adapter token in Shared studio / Connections.');
    const u=new URL(r.url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid adapter base URL.');
    return{base:u.href.replace(/\/+$/,''),token};
  }
  async api(r,path,body) {
    const {base,token}=await this.credentials(r);
    const res=await this.fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(path==='/generate'||path==='/import-render'?120000:15000)});
    const text=await res.text();let value;
    try{value=JSON.parse(text);}catch{throw Error('WanGP returned non-JSON: '+text.slice(0,200));}
    if(!res.ok){const e=Error(value.error||`WanGP HTTP ${res.status}`);e.status=res.status;throw e;}
    return value;
  }
  async upload(r,path,name,type='application/octet-stream') {
    // A friendly display name is not necessarily a valid media filename. Preserve
    // existing extensions; add only a known MIME extension for generated context frames.
    const mediaExt={'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','audio/wav':'.wav','audio/x-wav':'.wav','video/mp4':'.mp4'};
    name=String(name||'reference').replace(/[\\/]/g,'_');
    if(!/\.[A-Za-z0-9]{1,8}$/.test(name)&&mediaExt[type])name+=mediaExt[type];
    const s=await stat(path);if(s.size>2*1024**3)throw Error('This cumulative prefix exceeds the adapter’s 2 GiB upload limit. Export and split the film before continuing.');
    const {base,token}=await this.credentials(r);
    const res=await this.fetch(base+'/upload?filename='+encodeURIComponent(name),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':type,'Content-Length':String(s.size)},body:createReadStream(path),duplex:'half',redirect:'error',signal:AbortSignal.timeout(12*60*1000)});
    const v=await res.json();if(!res.ok||!v.media_id)throw Error(v.error||'WanGP media upload failed.');return v.media_id;
  }
  async workerQueue() {
    if(this.backendMode!=='headless')return{supported:false,reachable:false,error:'Global queue inspection requires the headless backend.'};
    try {
      const q=await this.api({backendMode:this.backendMode},'/queue');
      if(!Array.isArray(q.jobs)||typeof q.paused!=='boolean')throw Error('Malformed renderer queue; refusing to infer idle.');
      return{supported:true,reachable:true,checkedAt:new Date().toISOString(),paused:q.paused,active_job_id:q.active_job_id||null,
        jobs:q.jobs.map(j=>({job_id:j.job_id,status:j.status,project_name:j.project_name,progress:j.progress,message:j.message})),
        idle:!q.active_job_id&&!q.jobs.some(j=>!nativeTerminal.has(j.status))};
    }catch(e){return{supported:true,reachable:false,checkedAt:new Date().toISOString(),error:e.message,idle:false};}
  }
  unknownJob(e) {return(e.status===400||e.status===404)&&/^Unknown job\b/i.test(e.message);}
  async observe(r,queue=null) {
    const observation={checkedAt:new Date().toISOString(),reachable:false,job:null,missing:false,unknown:false,backend:this.backendInfo(r)};
    try {
      if(this.backendMismatch(r))throw Error('Backend mismatch: record uses '+this.recordBackend(r)+'; Director uses '+this.backendMode+'. Restore the matching backend, or explicitly retire old tracking after stopping its renderer.');
      if(this.backendMode==='headless') {
        queue=queue||await this.workerQueue();
        if(!queue.reachable)throw Error(queue.error||'Renderer unavailable.');
      }
      if(r.activeJobId) {
        try{observation.job=await this.api(r,'/jobs/'+encodeURIComponent(r.activeJobId));}
        catch(e){if(!this.unknownJob(e))throw e;observation.missing=true;}
      }
      if(!observation.job && this.backendMode==='headless') {
        const found=await this.api(r,'/requests/'+r.id+'_'+r.index);
        if(found.job_id){observation.job=found;observation.missing=false;}
        else if(found.found!==false)throw Error('Request lookup did not confirm acceptance or absence.');
        else observation.requestAbsent=true;
      }
      if(observation.job && (!observation.job.status || !observation.job.job_id))throw Error('Malformed renderer job response.');
      // Empty queue alone cannot disprove a lost submission which may still be
      // validating remotely. Do not clear/retry those requests based on an empty list.
      observation.unknown=!observation.job&&((r.phase==='submitting'||r.status==='uncertain')&&!r.activeJobId);
      if(this.backendMode==='legacy'&&!observation.job&&r.activeJobId)observation.unknown=true;
      observation.reachable=true;
      observation.queue=queue?{paused:queue.paused,idle:queue.idle,active_job_id:queue.active_job_id}:null;
      observation.auxiliary=this.referenceAgent?.auxiliary(r.id)||null;
      observation.unknown=observation.unknown||!!observation.auxiliary?.unknown;
      observation.nativeBusy=!!observation.job&&!nativeTerminal.has(observation.job.status)||!!observation.auxiliary?.busy;
      observation.idleConfirmed=this.backendMode==='headless'&&queue.idle&&!observation.nativeBusy&&!observation.unknown;
    }catch(e){observation.error=e.message;observation.idleConfirmed=false;observation.nativeBusy=false;}
    this.observations.set(r.id,observation);return observation;
  }
  public(r) {
    const live={...(r.native||{}),job_id:r.id,status:r.status,outputs:r.outputs||[],errors:r.error?[r.error]:[],message:r.message,
      sequence:{phase:r.phase,window:Math.min(r.index+1,r.plan.length),total:r.plan.length,completed:r.index,paused:r.pauseAfterWindow,
        cancel_requested:!!r.cancelRequested,elapsed_seconds:(Date.now()-Date.parse(r.createdAt))/1000}};
    live.telemetry=Progress.managedTelemetry(r);live.timing_adjustments=r.timingAdjustments||[];
    return{id:r.id,kind:'managed',backend:this.backendInfo(r),retirement:r.retirement||null,name:r.name,status:r.status,url:r.url,createdAt:r.createdAt,updatedAt:r.updatedAt,plan:r.plan,live,snapshot:r.project,referenceDecisions:r.referenceDecisions||[],referenceAgentId:r.referenceAgentId||null,sequence:true};
  }
  summary(r,observation=this.observations.get(r.id)) {
    const busy=this.work.has(r.id),done=terminal.has(r.status),o=observation,backend=this.backendInfo(r),foreign=backend.mismatch;
    const parked=!foreign&&r.status==='paused'&&!r.cancelRequested&&!busy&&o?.reachable&&!o.nativeBusy&&!o.unknown;
    const blocking=!done&&!parked;
    let label=r.status==='retired'?'Retired locally':!done&&foreign?'Other backend':r.status==='paused'?'Parked':r.status==='running'?(r.pauseAfterWindow?'Pausing after window':'Running'):r.status==='cancelling'?'Cancelling':r.status==='uncertain'?'Acceptance unknown':r.status;
    let reason=r.status==='retired'?'Tracking retired locally by user confirmation; no renderer cancellation was performed. Outputs and checkpoint history are kept.':!done&&foreign?'This checkpoint uses '+backend.recorded+' but Director uses '+backend.current+'. No renderer calls will be sent for it. Restore the matching backend, or retire old tracking after stopping that renderer.':done?'Finished; does not block new submissions.':parked?'Parked safely. Does not reserve the renderer. Resume only when you want to continue.':
      !o?.reachable?'Renderer state unavailable. No assumption that the GPU is idle.':
      o.unknown?'No accepted job found yet, but the submission outcome is uncertain. Do not retry or clear blindly.':
      r.cancelRequested?'Cancellation remains active until WanGP confirms the job has stopped.':
      o.nativeBusy?'WanGP still owns this sequence’s queued/running job.':busy?'Director is preparing, reconciling, or saving this window.':
      'Needs reconciliation before new managed work can start.';
    return{id:r.id,name:r.name,layout:r.layout||'legacy-cumulative',appearance:r.appearanceStatus||null,backend,retirement:r.retirement||null,projectId:r.project.id,status:r.status,label,phase:r.phase,referenceAgentId:r.referenceAgentId||null,referenceAgent:this.referenceAgent?.activeForSequence(r.id).map(x=>this.referenceAgent.view(x))||[],createdAt:r.createdAt,updatedAt:r.updatedAt,
      index:r.index,total:r.plan.length,windowTitle:r.plan[Math.min(r.index,r.plan.length-1)]?.title||'',outputs:r.outputs?.length||0,outputRecords:r.outputs||[],
      activeJobId:r.activeJobId||null,requestId:r.id+'_'+r.index,cancelRequested:!!r.cancelRequested,pauseAfterWindow:!!r.pauseAfterWindow,
      message:r.message,error:r.error||null,archivedAt:r.archivedAt||null,blocking,parked,reason,busy,
      observed:o?{...o,job:o.job?{job_id:o.job.job_id,status:o.job.status,progress:o.job.progress,message:o.job.message,outputs:o.job.outputs?.length||0}:null}:null,
      actions:{recoverOutput:!foreign&&!busy&&r.status!=='retired'&&!!(r.unarchivedJobId||r.activeJobId)&&(/Saved prefix|frame|Native output|timing/i.test(r.error||'')),retire:!done&&foreign&&!busy,pause:!foreign&&!done&&!r.cancelRequested&&r.status==='running'&&!r.pauseAfterWindow,
        resume:!foreign&&!done&&r.status==='paused'&&!r.cancelRequested&&!busy&&!o?.unknown,
        cancel:!foreign&&!done&&!r.cancelRequested,reconcile:!foreign&&!done,
        endIdle:!foreign&&!done&&!busy&&!!o?.idleConfirmed,
        archive:done&&!r.archivedAt,restore:done&&!!r.archivedAt},events:(r.events||[]).slice(-30)};
  }
  async manager() {
    await this.ready;const queue=await this.workerQueue();
    const rows=await Promise.all([...this.runs.values()].map(async r=>{
      const o=terminal.has(r.status)?this.observations.get(r.id):await this.observe(r,queue);
      return this.summary(r,o);
    }));
    rows.sort((a,b)=>Number(a.archivedAt!=null)-Number(b.archivedAt!=null)||Number(terminal.has(a.status))-Number(terminal.has(b.status))||b.createdAt.localeCompare(a.createdAt));
    const blockers=rows.filter(r=>r.blocking),nativeBusy=queue.reachable&&!queue.idle,finishingBusy=!!this.externalBusy?.();
    return{version:1,checkedAt:new Date().toISOString(),backend:this.backendMode,queue,runs:rows,
      canSubmitManaged:!finishingBusy&&!blockers.length&&(this.backendMode==='legacy'||(queue.reachable&&queue.idle&&!queue.paused)),
      explanation:finishingBusy?'An active finishing or reference preparation task reserves the renderer. Inspect Finishing / Reference agent before submitting.':blockers.length?'Resolve or park the blocking sequences shown below.':!queue.reachable&&this.backendMode==='headless'?'Renderer unreachable; cannot verify availability.':nativeBusy?'WanGP has queued/running work.':queue.paused?'WanGP is idle but its queue is paused. Unpause it separately.':'Ready for a new managed sequence. Parked sequences remain saved.'};
  }
  async assertAvailable(except=null) {
    if(this.externalBusy?.())throw Error("An active finishing or reference preparation task reserves the renderer. Open Finishing / Reference agent first.");
    const queue=await this.workerQueue();
    for(const r of this.runs.values()) {
      if(r.id===except||terminal.has(r.status))continue;
      const row=this.summary(r,await this.observe(r,queue));
      if(row.blocking)throw Error('Managed sequence “'+r.name+'” ('+r.id+') needs attention. Open Sequences. '+row.reason);
    }
    if(this.backendMode==='headless') {
      if(!queue.reachable)throw Error('Cannot verify WanGP queue: '+queue.error);
      if(!queue.idle)throw Error('WanGP has active or queued jobs. Open Sequences to inspect the renderer.');
      if(queue.paused)throw Error('WanGP queue is paused. Unpause it in Sequences before continuing.');
    }
  }
  async start(raw,url,ownedId=null) {return this.store.serialize('sequence-start',()=>this.startUnlocked(raw,url,ownedId));}
  async startUnlocked(raw,url,ownedId=null) {
    await this.ready;await this.assertAvailable();
    const p=H3.normalizeProject(raw);if(p.mode!=='managed')throw Error('Choose Director-managed mode.');
    if(this.backendMode!=='headless')throw Error('New managed runs require the bounded-capable headless worker. Existing saved sequences remain compatible.');
    const health=await this.api({backendMode:'headless'},'/health');
    if(health.capabilities?.bounded_continuation!==1)throw Error('An idle worker upgrade is required for bounded managed continuation. No generation submitted.');
    if(p.continuation){
      if(this.backendMode!=='headless')throw Error('Edited-prefix branches require the headless backend.');
      const c=p.continuation;if(!c.jobId||!c.outputId||!Number.isSafeInteger(c.keepFrames)||c.keepFrames<1)throw Error('Invalid continuation prefix.');
      const j=await this.api({backendMode:'headless'},'/jobs/'+encodeURIComponent(c.jobId)),o=j.outputs?.find(x=>x.id===c.outputId&&x.available);
      if(!o)throw Error('Continuation source is not available in this worker.');
      // Worker validates decoded rate, range and file identity at submission too.
    }
    if(p.settings.spatial_upsampling)throw Error('Managed mode requires generation-time upscaling off. Upscale the completed film separately.');
    const referenceConsent=await this.referenceAgent?.preflightProject(p);
    const errors=H3.validate(p,true).filter(x=>x.level==='error');if(errors.length)throw Error(errors[0].message);
    for(const id of new Set(p.windows.flatMap(w=>[...H3.usedIds(p,w)])))await stat(this.store.blobPath(id));
    if(this.probe===inspectVideo)await exec(process.env.FFPROBE_BIN||'ffprobe',['-version'],{timeout:10000});
    if(ownedId&&!/^seq_[a-f0-9]{32}$/.test(ownedId))throw Error('Invalid managed ownership ID.');const id=ownedId||'seq_'+randomBytes(16).toString('hex');if(this.runs.has(id))throw Error('Owned sequence already exists; reconcile instead of replaying.');const r={id,name:p.name,url,backendMode:this.backendMode,layout:'bounded-v1',project:{...p,jobs:[],variants:[],voiceWorkshops:[]},plan:S.managedPlan(p),status:'running',phase:'preparing',index:0,createdAt:new Date().toISOString(),outputs:[],submissions:[],pauseAfterWindow:false,cancelRequested:false,events:[]};
    r.shotPlan=Continuity.shotPlan(p);r.appearanceAnchors={};
    r.referenceConsent=referenceConsent||null;await this.credentials(r);this.event(r,'start','Sequence accepted.');this.runs.set(id,r);await this.save(r);this.launch(r);return this.public(r);
  }
  launch(r,mode='run') {
    if(this.work.has(r.id)||this.closed||terminal.has(r.status)||this.backendMismatch(r))return;
    const task=(async()=>{
      try {
        if(mode==='reconcile'){await this.reconcileOnce(r);return;}
        await this.loop(r);
      }catch(e){
        if(!this.closed&&!terminal.has(r.status)) {
          r.error=e.message;
          r.status=r.cancelRequested?'cancelling':r.phase==='submitting'&&!r.activeJobId?'uncertain':'paused';
          r.message=r.cancelRequested?'Cancellation pending; could not verify the renderer: '+e.message:
            r.status==='uncertain'?'Submission outcome unknown. Do not resubmit blindly.':'Stopped safely: '+e.message;
          this.event(r,'error',r.message);await this.save(r);
        }
      }
    })().finally(()=>this.work.delete(r.id));
    this.work.set(r.id,task);return task;
  }
  async maintenance() {
    await this.ready;if(this.closed)return;
    return this.store.serialize('sequence-start',async()=>{
      for(const r of this.runs.values())if(r.cancelRequested&&!terminal.has(r.status)&&!this.backendMismatch(r)&&!this.work.has(r.id))this.launch(r);
    });
  }
  async prepareCheckpoint(r) {
    if(this.closed)return false;
    if(r.cancelRequested){r.status='cancelling';await this.save(r);return false;}
    if(r.pauseAfterWindow||r.status!=='running') {
      r.status='paused';r.phase='between_windows';r.message='Parked before the next GPU submission.';await this.save(r);return false;
    }
    return true;
  }
  async loop(r) {
    while(!this.closed&&!terminal.has(r.status)) {
      if(r.cancelRequested){if(await this.settleCancellation(r))return;await sleep(this.pollMs);continue;}
      if(r.status!=='running')return;
      if(r.index>=r.plan.length){r.status='completed';r.phase='finished';r.message='All windows archived and verified.';await this.save(r);return;}
      const row=r.plan[r.index];
      if(!r.activeJobId) {
        if(!await this.prepareCheckpoint(r))continue;
        if(this.referenceAgent&&!await this.referenceAgent.prepareWindow(r)){if(r.cancelRequested)continue;return;}
        if(!await this.prepareCheckpoint(r))continue;
        r.prepareStartedAt=Date.now();r.phase='preparing';r.message='Preparing reference pool for '+row.title;await this.save(r);
        let source=r.index===0?(r.project.continuation||null):null;
        if(r.layout==='bounded-v1'&&r.index){
          const prev=r.outputs.at(-1);if(!prev||prev.end_frame!==row.start_frame||!prev.nativeJobId||!prev.nativeOutputId)throw Error('No owned preceding native output for bounded continuation.');
          if(row.overlap&&!(prev.continuation?.frames>=row.overlap))throw Error('Decoded continuation checkpoint is unavailable. Viewing output is retained; inspect recovery before continuing.');
          source=row.overlap?{jobId:prev.nativeJobId,outputId:prev.nativeOutputId,keepFrames:prev.probe.frames}:null;
        }else if(r.index) {
          const prev=r.outputs.at(-1);if(!prev||prev.end_frame!==row.start_frame)throw Error('No verified preceding output for this boundary.');
          const path=join(this.store.root,'renders',prev.id+'.mp4');await this.probe(path,row.start_frame);
          if(!await this.prepareCheckpoint(r))continue;
          const media_id=await this.upload(r,path,'prefix.mp4','video/mp4');if(!await this.prepareCheckpoint(r))continue;
          const imported=await this.api(r,'/import-render',{media_id,plan:[{id:'prefix',title:'Verified prefix',task_index:1,window_index:1,start_frame:0,end_frame:row.start_frame,frames:row.start_frame,overlap:0}]});
          const output=imported.outputs?.find(o=>o.available);if(!output)throw Error('Imported prefix has no playable output.');
          source={jobId:imported.job_id,outputId:output.id,keepFrames:row.start_frame};
        }
        const bounded=r.layout==='bounded-v1';
        if(bounded&&!row.overlap)source=null;
        const q=(bounded?S.boundedManagedWindow:S.managedWindow)(r.project,r.index,source,row),mapping=new Map();
        let appearance=null,shot=bounded?r.shotPlan?.[r.index]:null;
        if(shot?.protection==='eligible'&&!shot.internalCuts.length){
          const anchor=r.appearanceAnchors?.[shot.incomingGroup];
          if(anchor){
            const id='appearance_'+anchor.outputId,admission=Continuity.anchorAdmission(H3.pool(q,q.windows[0]),id,{excluded:q.windows[0].excludedAssetIds||[]});
            if(admission.use){
              const guarded=q.windows[0].referenceManifest?.usageGuard===H3.referenceUsageStamp(q,q.windows[0]);
              const asset={id,kind:'image',number:Math.max(0,...q.assets.filter(a=>a.kind==='image').map(a=>a.number))+1,name:'Fixed shot appearance.png',type:'image/png',contextOnly:true};
              q.assets.push(asset);q.windows[0].assetIds.push(id);
              q.windows[0].definitions+=(q.windows[0].definitions?'\n':'')+`<Picture ${asset.number}> is the fixed early appearance reference for this continuous shot. Preserve appearance and character identity only. Do not reproduce its earlier pose, composition or action. Recent video/audio overlap controls movement and timing; canonical character references remain authoritative.`;
              if(guarded)q.windows[0].referenceManifest.usageGuard=H3.referenceUsageStamp(q,q.windows[0]);
              appearance={...anchor,id};
              this.event(r,'appearance','Using fixed early appearance reference for this continuous shot.');
            }else this.event(r,'appearance-skipped',admission.reason);
          }
        }else if(shot)this.event(r,'appearance-skipped',shot.internalCuts.length?'This window contains a camera cut; appearance protection resets for the outgoing shot.':shot.reason);
        for(const a of H3.pool(q,q.windows[0])){if(!await this.prepareCheckpoint(r))break;mapping.set(a.id,a.id===appearance?.id?'h3appearance:'+appearance.jobId+':'+appearance.outputId:await this.upload(r,this.store.blobPath(a.id),a.name,a.type));}
        if(!await this.prepareCheckpoint(r))continue;
        const tasks=H3.tasks(q,id=>mapping.get(id)),plan=H3.renderPlan(q),payload={tasks,plan,project:r.name+' · '+row.title,project_id:r.project.id,request_id:r.id+'_'+r.index};
        if(bounded){
          const nextOverlap=Math.min(120,row.overlap?row.end_frame:row.frames);
          tasks[0]._director_bounded={timeline_start_frame:row.start_frame,context_frames:row.overlap,new_frames:row.frames,checkpoint_frames:nextOverlap};
          if(source)tasks[0]._director_continuation={...source};
          if(shot?.protection==='eligible'&&!r.appearanceAnchors?.[shot.outgoingGroup]){const start=row.overlap+shot.anchorStartFrame;if(start<row.overlap+row.frames)tasks[0]._director_appearance_capture={start_frame:start};else this.event(r,'appearance-skipped','Shot-cut timestamp is outside this window.');}
        }
        r.submissions.push({windowId:row.id,referenceManifest:r.windowManifests?.[row.id]||null,createdAt:new Date().toISOString(),payload:S.redact(payload)});
        r.prepareSeconds=Math.max(0,(Date.now()-(r.prepareStartedAt||Date.now()))/1000);r.phase='submitting';await this.save(r);
        // Cancellation may arrive while save or /generate is awaiting a response.
        if(this.closed||r.cancelRequested||r.pauseAfterWindow||r.status!=='running') {
          r.phase='preparing';continue;
        }
        const result=await this.api(r,'/generate',payload);if(!result.job_id)throw Error('WanGP returned no job ID.');
        r.activeJobId=result.job_id;r.native=result;r.phase='rendering';r.message='Waiting for native progress: '+row.title;await this.save(r);
        if(r.cancelRequested)continue;
      }
      const result=await this.api(r,'/jobs/'+encodeURIComponent(r.activeJobId));
      if(this.closed)return;
      r.native=result;r.message=result.message||'Rendering '+row.title;
      if(result.status==='failed'||result.status==='cancelled') {
        r.status=r.cancelRequested?'cancelled':result.status;r.phase='finished';r.error=(result.errors||[]).join('\n');
        this.event(r,'finished','Native job ended: '+result.status);await this.save(r);return;
      }
      if(result.status==='completed') {await this.collect(r,result);continue;}
      await this.save(r);await sleep(this.pollMs);
    }
  }
  async collect(r,result,persist=true) {
    const row=r.plan[r.index];if(!row)return;
    const archivingStarted=Date.now();r.phase='archiving';if(persist)await this.save(r);
    const outputs=(result.outputs||[]).filter(o=>o.available&&/^video\//.test(o.content_type||'video/mp4')).sort((a,b)=>(b.window_index||0)-(a.window_index||0));
    const o=outputs[0];if(!o)throw Error('Native job completed without an available video output.');
    const archived=await this.archive(r,o,row);
    const delta=archived.end_frame-row.end_frame;
    if(delta){
      r.originalPlan=r.originalPlan||H3.clone(r.plan);
      r.plan=rebasePlan(r.plan,r.index,archived.end_frame);
      r.timingAdjustments=[...(r.timingAdjustments||[]),{windowId:row.id,index:r.index,expected:row.end_frame,actual:archived.end_frame,delta,seconds:delta/24,at:new Date().toISOString()}];
      this.event(r,'timing-adjusted',`Window ${r.index+1}: observed ${archived.end_frame} frames instead of ${row.end_frame} (${delta>0?'+':''}${delta}). Playback and subsequent source boundaries use the actual file. No frames or audio were added or removed.`);
    }
    const t=result.telemetry,c=t?.current;
    if(t?.generation_elapsed_seconds>0&&c?.denoising_seconds>0){
      const nativeElapsed=t.generation_elapsed_seconds,loading=c.phase_seconds?.loading_model||0;
      r.timingSamples=[...(r.timingSamples||[]).filter(s=>s.index!==r.index),{index:r.index,span:row.span,nativeElapsed,seconds:Math.max(1,(r.prepareSeconds||0)+nativeElapsed-loading+(Date.now()-archivingStarted)/1000),denoisingSeconds:c.denoising_seconds,recordedAt:new Date().toISOString()}];
    }
    const shot=r.layout==='bounded-v1'?r.shotPlan?.[r.index]:null;
    if(shot&&o.appearance_anchor){r.appearanceAnchors||={};r.appearanceAnchors[shot.outgoingGroup]||=o.appearance_anchor;this.event(r,'appearance-captured','Saved an early decoded appearance reference for this continuous shot.');}
    if(o.appearance_notice)this.event(r,'appearance-skipped',o.appearance_notice);
    r.error=null;r.outputs.push(archived);r.index++;r.lastNativeJobId=r.activeJobId;delete r.activeJobId;r.native=null;
    r.phase='between_windows';this.event(r,'archived','Saved and verified window '+r.index+' of '+r.plan.length+'.');if(persist)await this.save(r);
  }
  async settleCancellation(r) {
    if(this.backendMismatch(r))throw Error('Cannot cancel a job belonging to the other backend. Use explicit local retirement for an abandoned record.');
    r.status='cancelling';r.pauseAfterWindow=true;
    if(this.referenceAgent&&!await this.referenceAgent.cancelForSequence(r.id)){r.message='Reference image cancellation is still pending.';await this.save(r);return false;}
    const o=await this.observe(r);r.lastCheckAt=o.checkedAt;
    if(!o.reachable||o.unknown) {
      r.message=!o.reachable?'Cancellation pending: '+o.error:'Cancellation pending: submission outcome is unknown. Find the accepted job; no new work will submit.';
      r.error=o.error||null;await this.save(r);return false;
    }
    const job=o.job;
    if(job) {
      r.activeJobId=job.job_id;r.native=job;
      if(!nativeTerminal.has(job.status)) {
        if(job.status!=='cancelling')await this.api(r,'/jobs/'+encodeURIComponent(job.job_id)+'/cancel',{});
        r.message='Waiting for WanGP to finish cooperative cancellation. No later window will submit.';
        await this.save(r);return false;
      }
      if(job.status==='completed') {
        try{await this.collect(r,job);}catch(e){
          // The headless worker retains the native output; never erase it merely
          // because a cancelled sequence cannot map/archive its last window.
          r.unarchivedJobId=job.job_id;r.error='Native output remains in WanGP but was not added to the timeline: '+e.message;
        }
      }
    }else if(this.backendMode==='headless'&&!o.idleConfirmed) {
      r.message='No matching job, but renderer is not fully idle. Waiting before clearing the stale record.';await this.save(r);return false;
    }
    r.status=r.index>=r.plan.length?'completed':'cancelled';r.phase='finished';
    r.message=r.status==='completed'?'All windows finished before cancellation. Outputs preserved.':'Sequence cancelled. Saved outputs and source media remain.';
    this.event(r,'cancelled',r.message);await this.save(r);return true;
  }
  async reconcileOnce(r) {
    if(terminal.has(r.status))return;
    if(r.cancelRequested){await this.settleCancellation(r);return;}
    const o=await this.observe(r);if(!o.reachable)throw Error(o.error);if(o.unknown)throw Error('No accepted job found. Submission remains uncertain; nothing resubmitted.');
    if(o.job) {
      r.activeJobId=o.job.job_id;r.native=o.job;
      if(o.job.status==='completed')await this.collect(r,o.job);
      else if(o.job.status==='failed'||o.job.status==='cancelled'){r.status=o.job.status;r.phase='finished';r.error=(o.job.errors||[]).join('\n');}
      else{r.phase='rendering';r.message='Accepted job found. Tracking it does not submit the next window.';}
    }else if(r.activeJobId){r.lastMissingJobId=r.activeJobId;delete r.activeJobId;r.phase='between_windows';}
    if(!terminal.has(r.status)) {
      r.status=r.index>=r.plan.length?'completed':'paused';r.pauseAfterWindow=true;
      r.message=r.status==='completed'?'All windows verified.':'State reconciled. Parked; Resume is a separate deliberate action.';
    }
    this.event(r,'reconcile',r.message);await this.save(r);
  }
  async clearIdle(ids,preview=false) {
    const results=[],queue=await this.workerQueue();
    for(const id of ids) {
      const r=this.runs.get(id);
      if(!r){results.push({id,cleared:false,reason:'Unknown sequence.'});continue;}
      if(terminal.has(r.status)){results.push({id,name:r.name,cleared:false,reason:'Already finished.'});continue;}
      const o=await this.observe(r,queue),row=this.summary(r,o);
      if(!row.actions.endIdle){results.push({id,name:r.name,cleared:false,reason:row.busy?'A coordinator operation is still in flight. Reconcile, then check again.':row.reason});continue;}
      if(preview){results.push({id,name:r.name,eligible:true,status:r.status,outputs:r.outputs.length,reason:'Renderer confirmed idle; no pending or unknown submission.'});continue;}
      await this.backup(r,'End idle sequence');r.cancelRequested=true;r.pauseAfterWindow=true;r.status='cancelling';
      this.event(r,'end-idle','User ended an idle record after checking the renderer.');await this.save(r);
      // No automatic resume and no new GPU request. Recheck even after the preview.
      await this.settleCancellation(r);
      results.push({id,name:r.name,cleared:terminal.has(r.status),reason:r.message});
    }
    return{results,queuePaused:queue.paused,notice:'No renderer queue resume, process restart, or file deletion was performed.'};
  }
  async retireOtherBackend(r,b,preview=false) {
    if(r.status==='retired'&&!preview)return this.public(r);
    if(!this.backendMismatch(r)||terminal.has(r.status))throw Error('Only unfinished records belonging to the other backend can be retired here. Use End idle for current-backend records.');
    if(this.work.has(r.id))throw Error('A local operation is still in flight; tracking cannot be retired.');
    const backend=this.backendInfo(r),revision=r.updatedAt||r.createdAt;
    if(preview)return {id:r.id,name:r.name,backend,revision,status:r.status,phase:r.phase,index:r.index,total:r.plan.length,outputs:r.outputs?.length||0,activeJobId:r.activeJobId||null};
    if(b.acknowledgeOtherRendererStopped!==true)throw Error('Confirm that the other renderer is stopped or has finished this job. Retirement does not cancel it.');
    if(b.expectedBackend!==backend.recorded||b.expectedCurrentBackend!==backend.current||b.revision!==revision)throw Error('The record or backend changed. Open a fresh retirement preview. Nothing was changed.');
    const next=H3.clone(r),at=new Date().toISOString();
    await this.backup(next,'Explicit local retirement of other-backend tracking; not renderer cancellation');
    next.retirement={at,recordedBackend:backend.recorded,currentBackend:backend.current,inferredBackend:backend.inferred,
      previousStatus:r.status,previousPhase:r.phase,previousError:r.error||null,previousMessage:r.message||null,
      previousCancelRequested:!!r.cancelRequested,activeJobId:r.activeJobId||null,
      acknowledgment:'User confirmed that the other renderer was stopped or had finished this job.',rendererCancellationVerified:false};
    next.status='retired';next.phase='tracking_ended';next.pauseAfterWindow=true;next.archivedAt=at;next.error=null;
    next.message='Tracking retired locally. No GPU cancellation, job retry, queue resume, or output deletion was performed. View History for saved outputs and the original checkpoint.';
    this.event(next,'retire-other-backend',next.message);
    await this.save(next);Object.assign(r,next);this.observations.delete(r.id);
    return this.public(r);
  }
  async recoveryPreview(r){
    if(this.backendMismatch(r)||this.work.has(r.id)||r.status==='retired'||!r.plan[r.index])throw Error('Only a stopped, current-backend attempt with a pending output can be recovered.');
    const id=r.unarchivedJobId||r.activeJobId;if(!id)throw Error('No uncollected native job is recorded.');
    const job=await this.api(r,'/jobs/'+encodeURIComponent(id));
    if(job.status!=='completed')throw Error('The native job must be completed. Recovery never cancels or rerenders it.');
    const outputs=(job.outputs||[]).filter(o=>o.available&&/^video\//.test(o.content_type||'video/mp4')).sort((a,b)=>(b.window_index||0)-(a.window_index||0));
    if(!outputs.length)throw Error('No saved video available.');
    const probe=outputs[0].probe||null,row=r.plan[r.index];
    const expected=r.layout==='bounded-v1'?row.overlap+row.frames:row.end_frame,start=r.layout==='bounded-v1'?row.overlap:row.start_frame;
    if(probe)checkFrameCount(probe,expected,start,MAX_FRAME_DRIFT);
    return{id:r.id,revision:r.updatedAt,name:r.name,nativeJobId:id,outputId:outputs[0].id,index:r.index,total:r.plan.length,expected,timelineExpected:row.end_frame,probe,notice:'Recover into a NEW parked sequence. The original stays unchanged. No generation is submitted; Resume is a separate action.'};
  }
  async recoverOutput(r,b){
    const preview=await this.recoveryPreview(r);
    if(b.revision!==preview.revision||b.outputId!==preview.outputId||b.confirm!==true)throw Error('Open a fresh recovery preview and confirm it.');
    const prior=[...this.runs.values()].find(x=>x.recoveredFrom===r.id&&x.recoverySourceJobId===preview.nativeJobId&&x.recoverySourceRevision===preview.revision);if(prior)return this.public(prior);
    const next=H3.clone(r);next.recoverySourceRevision=preview.revision;next.id='seq_'+randomBytes(16).toString('hex');next.name=r.name+' · recovered';next.recoveredFrom=r.id;next.recoverySourceJobId=preview.nativeJobId;
    next.createdAt=new Date().toISOString();next.status='paused';next.phase='archiving';next.pauseAfterWindow=true;next.cancelRequested=false;next.activeJobId=preview.nativeJobId;next.events=[];next.error=null;
    delete next.archivedAt;delete next.retirement;delete next.unarchivedJobId;delete next.finishedAt;delete next.lastBackup;
    const job=await this.api(r,'/jobs/'+preview.nativeJobId);
    if(job.status!=='completed'||!job.outputs?.some(o=>o.id===preview.outputId&&o.available))throw Error('Output changed; nothing recovered.');
    await this.backup(r,'Before explicit saved-output recovery into a separate parked sequence');
    await this.collect(next,job,false);next.status=next.index>=next.plan.length?'completed':'paused';next.phase=next.status==='completed'?'finished':'between_windows';next.pauseAfterWindow=true;
    next.message='Saved native output recovered and mapped to its actual frame boundary. No GPU work submitted. Resume explicitly to continue remaining windows.';
    this.event(next,'recovered-output',next.message);await this.save(next);this.runs.set(next.id,next);return this.public(next);
  }
  async handle(b) {
    await this.ready;
    if(b.action==='start')return this.start(b.project,b.url);
    if(b.action==='manager')return this.manager();
    if(b.action==='list')return{runs:[...this.runs.values()].map(r=>({id:r.id,name:r.name,projectId:r.project.id,status:r.status,createdAt:r.createdAt}))};
    if(b.action==='clear-idle-preview'||b.action==='clear-idle') {
      if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>200||b.ids.some(id=>!safeID(id)))throw Error('Choose one or more valid sequence IDs (maximum 200).');
      return this.store.serialize('sequence-start',()=>this.clearIdle([...new Set(b.ids)],b.action==='clear-idle-preview'));
    }
    const r=this.runs.get(b.id);if(!r)throw Error('Unknown managed sequence.');
    if(b.action==='get')return this.public(r);
    if(b.action==='diagnostics')return S.redact({...r,backend:this.backendInfo(r),observation:this.observations.get(r.id)});
    return this.store.serialize('sequence-start',async()=>{
      if(b.action==='recover-preview')return this.recoveryPreview(r);
      if(b.action==='recover-output')return this.recoverOutput(r,b);
      if(b.action==='retire-preview'||b.action==='retire')return this.retireOtherBackend(r,b,b.action==='retire-preview');
      if(this.backendMismatch(r)&&!terminal.has(r.status))throw Error('This record uses '+this.recordBackend(r)+'; Director uses '+this.backendMode+'. Restore the matching backend or use Retire old-backend record.');
      switch(b.action) {
        case 'pause':
          if(terminal.has(r.status)||r.cancelRequested)throw Error('A finished/cancelling sequence cannot be paused.');
          r.pauseAfterWindow=true;r.message='Pause requested. Finish and save the active window, then park.';
          this.event(r,'pause',r.message);await this.save(r);break;
        case 'resume': {
          if(r.cancelRequested||r.status==='cancelling')throw Error('Cancellation cannot be resumed. Reconcile it or end the verified idle record in Sequences.');
          if(r.status==='uncertain')throw Error('Resolve the uncertain submission first; no automatic retry.');
          if(terminal.has(r.status))throw Error('This sequence is finished.');
          if(this.work.has(r.id))throw Error('A coordinator operation is still in progress. Wait for it to park before resuming.');
          const o=await this.observe(r);if(!o.reachable)throw Error(o.error);if(o.unknown)throw Error('The submission outcome is uncertain.');
          // Resuming an already accepted native job may track it while it runs;
          // other managed runs must still be parked. Never start a competing one.
          for(const other of this.runs.values())if(other.id!==r.id&&!terminal.has(other.status)) {
            if(this.summary(other,await this.observe(other)).blocking)throw Error('Another managed sequence needs attention: '+other.name+'. Open Sequences.');
          }
          if(this.backendMode==='headless') {
            const q=await this.workerQueue();if(!q.reachable)throw Error(q.error);
            if(q.paused)throw Error('WanGP queue is paused. Unpause it separately in Sequences.');
            const auxiliary=new Set(this.referenceAgent?.auxiliary(r.id).jobIds||[]);
            if(q.jobs.some(j=>!nativeTerminal.has(j.status)&&j.job_id!==o.job?.job_id&&!auxiliary.has(j.job_id))||q.active_job_id&&q.active_job_id!==o.job?.job_id&&!auxiliary.has(q.active_job_id))throw Error('Another native job is active/queued. Wait or manage it in WanGP server.');
          }
          if(o.job){r.activeJobId=o.job.job_id;r.native=o.job;}
          else if(r.activeJobId)throw Error('The saved job is missing. End the idle sequence rather than silently regenerating it.');
          r.status='running';r.error=null;r.pauseAfterWindow=false;r.message='Resumed explicitly.';
          this.event(r,'resume',r.message);await this.save(r);this.launch(r);break;
        }
        case 'reconcile':
          if(!this.work.has(r.id))this.launch(r,'reconcile');
          break;
        case 'attach-job': {
          if(r.status!=='uncertain'||!safeID(b.jobId))throw Error('Provide the native job ID after checking WanGP.');
          if(this.backendMode==='headless') {
            const found=await this.api(r,'/requests/'+r.id+'_'+r.index);
            if(found.job_id!==b.jobId)throw Error('That job is not the accepted request for this sequence/window.');
          }
          r.activeJobId=b.jobId;r.status=r.cancelRequested?'cancelling':'paused';r.phase='rendering';r.error=null;
          this.event(r,'attach-job','Linked verified native job '+b.jobId);await this.save(r);if(r.cancelRequested)this.launch(r);break;
        }
        case 'cancel':
          if(terminal.has(r.status))break;
          if(this.backendMode==='legacy'&&(r.status==='uncertain'||r.phase==='submitting'&&!r.activeJobId))throw Error('Attach the native job ID first; the legacy adapter cannot look up an uncertain request.');
          r.pauseAfterWindow=true;r.cancelRequested=true;r.status='cancelling';
          r.message='Cancellation requested. Checking WanGP; no following window will submit.';
          this.event(r,'cancel',r.message);await this.save(r);this.launch(r);break;
        case 'archive': case 'restore':
          if(!terminal.has(r.status)||this.work.has(r.id))throw Error('Only finished sequences can be hidden from the active list.');
          await this.backup(r,b.action);r.archivedAt=b.action==='archive'?new Date().toISOString():null;
          this.event(r,b.action,b.action==='archive'?'Hidden from active list; videos and metadata kept.':'Returned to the visible list.');await this.save(r);break;
        default:throw Error('Unknown sequence action.');
      }
      return this.public(r);
    });
  }
  async archiveBounded(r,o,row){
    if(!/^[a-f0-9]{32}$/.test(o.id||'')||o.layout!=='bounded-v1'||o.source_start_frame!==row.overlap||o.timeline_start_frame!==row.start_frame)throw Error('Native bounded mapping is missing or inconsistent; output ownership retained for recovery.');
    const {base,token}=await this.credentials(r),id=randomBytes(16).toString('hex'),path=join(this.store.root,'renders',id+'.mp4');
    const response=await this.fetch(base+'/jobs/'+r.activeJobId+'/outputs/'+o.id,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30*60*1000)});
    if(!response.ok||!response.body)throw Error('Could not archive bounded output; native output retained.');
    let count=0;
    try{
      await pipeline(Readable.fromWeb(response.body),new Transform({transform(c,e,cb){count+=c.length;if(count>16*1024**3)return cb(Error('Render archive exceeds 16 GiB.'));cb(null,c);}}),createWriteStream(path,{flags:'wx',mode:0o600}));
      const expected=row.overlap+row.frames,measured=await this.probe(path,expected,{tolerance:MAX_FRAME_DRIFT,start:row.overlap});
      checkFrameCount(measured,expected,row.overlap,MAX_FRAME_DRIFT);
      if(measured.frames!==o.source_end_frame||o.timeline_end_frame!==row.start_frame+measured.frames-row.overlap)throw Error('Native local/global frame metadata does not match archived media.');
      const record={id,name:r.name+' · '+row.title+'.mp4',task_index:row.task_index,window_index:1,layout:'bounded-v1',cumulative:false,available:true,bytes:count,created_at:Date.now()/1000,content_type:'video/mp4',start_frame:row.start_frame,end_frame:o.timeline_end_frame,timeline_start_frame:row.start_frame,timeline_end_frame:o.timeline_end_frame,source_start_frame:row.overlap,source_end_frame:measured.frames,expected_end_frame:row.end_frame,timing_delta:measured.frames-expected,probe:measured,archived:true,nativeJobId:r.activeJobId,nativeOutputId:o.id,continuation:o.continuation||null};
      await atomicJSON(path+'.json',record);return record;
    }catch(e){await rm(path,{force:true});throw e;}
  }
  async archive(r,o,row){if(r.layout==='bounded-v1')return this.archiveBounded(r,o,row);if(!/^[a-f0-9]{32}$/.test(o.id||''))throw Error('Invalid native output ID.');const {base,token}=await this.credentials(r),id=randomBytes(16).toString('hex'),path=join(this.store.root,'renders',id+'.mp4');const response=await this.fetch(base+'/jobs/'+r.activeJobId+'/outputs/'+o.id,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30*60*1000)});if(!response.ok||!response.body)throw Error('Could not archive native output; leaving sequence stopped.');let count=0;try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(c,e,cb){count+=c.length;if(count>16*1024**3)return cb(Error('Render archive exceeds 16 GiB.'));cb(null,c);}}),createWriteStream(path,{flags:'wx',mode:0o600}));const measured=await this.probe(path,row.end_frame,{tolerance:MAX_FRAME_DRIFT,start:row.start_frame});checkFrameCount(measured,row.end_frame,row.start_frame,MAX_FRAME_DRIFT);const record={id,name:r.name+' · '+row.title+'.mp4',task_index:row.task_index,window_index:1,cumulative:true,available:true,bytes:count,created_at:Date.now()/1000,content_type:'video/mp4',start_frame:row.start_frame,end_frame:measured.frames,expected_end_frame:row.end_frame,timing_delta:measured.frames-row.end_frame,probe:measured,archived:true,nativeJobId:r.activeJobId};await atomicJSON(path+'.json',record);return record;}catch(e){await rm(path,{force:true});throw e;}}
  async serve(req,res,id){await this.ready;if(!/^[a-f0-9]{32}$/.test(id))throw Error('Invalid output ID.');if(![...this.runs.values()].some(r=>r.outputs.some(o=>o.id===id)))throw Error('Output does not belong to this studio.');await serveFile(req,res,join(this.store.root,'renders',id+'.mp4'));}
  async close(){this.closed=true;clearInterval(this.timer);await this.maintenanceWork;}
}
