/** Persistent CPU-only audio import/detection. Does not own or touch the GPU queue. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,readdir,readFile,stat,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {join,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {atomicJSON,loadJSON,safeID} from './studio-server.mjs';
import {voicePython} from './python-env.mjs';
const require=createRequire(import.meta.url),S=require('./sound-core.js');
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const BUSY=new Set(['queued','running','cancelling']);
const EXTS=new Set(['.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus','.mp4','.webm','.mov','.mkv','.avi','.m4v']);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),now=()=>new Date().toISOString();
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
export class SoundLibrary {
 constructor(store,{python=voicePython(),worker=join(ROOT,'scripts','sound_worker.py')}={}){
  this.store=store;this.python=python;this.worker=worker;this.root=join(store.root,'sounds');this.jobs=new Map();this.queue=[];this.running=null;this.child=null;this.closed=false;this.ready=this.init();
 }
 async init(){await this.store.ready;await mkdir(this.root,{recursive:true,mode:0o700});for(const name of await readdir(this.root)){
  if(!name.endsWith('.json'))continue;const j=await loadJSON(join(this.root,name));if(!j||!safeID(j.id))continue;
  if(BUSY.has(j.status)){j.status='paused';j.message='Director restarted. Resume this sound operation explicitly; saved sources and samples remain.';j.revision++;await this.save(j);}this.jobs.set(j.id,j);
 }}
 async save(j){j.updatedAt=now();await this.store.serialize('sound-write:'+j.id,()=>atomicJSON(join(this.root,j.id+'.json'),j));}
 get(id){const j=this.jobs.get(id);check(j,'Sound source not found. Restore the source from its project backup or import it.');return j;}
 view(j){const {input,history,startStamp,saveRows,...v}=j;return {...v,busy:BUSY.has(j.status)};}
 async handle(b){await this.ready;
  if(b.action==='list'){check(safeID(b.projectId),'Invalid project ID.');return {jobs:[...this.jobs.values()].filter(j=>j.projectId===b.projectId).map(j=>this.view(j)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))};}
  if(b.action==='start')return this.start(b);
  if(b.action==='restore')return this.restore(b);
  return this.store.serialize('sound-control:'+b.id,async()=>{
   const j=this.get(b.id);if(b.action==='get')return this.view(j);
   if(b.action==='report')return { ...j,input:{...j.input,uploadKey:j.input?.uploadKey},localPaths:undefined };
   if(b.action==='cancel'){
    if(BUSY.has(j.status)){j.cancelRequested=true;j.status=this.running===j.id?'cancelling':'cancelled';j.message='Cancelling sound processing; existing samples remain.';if(this.running===j.id)this.kill();else this.queue=this.queue.filter(id=>id!==j.id);j.revision++;await this.save(j);}return this.view(j);
   }
   check(!BUSY.has(j.status),'This source is still processing. Wait or cancel before editing it.');
   if(b.action==='resume'){check(b.confirm===true,'Confirm resuming this sound operation.');check(['failed','paused','cancelled'].includes(j.status),'This source does not need recovery.');j.cancelRequested=false;await this.enqueue(j);return this.view(j);}
   check(j.source,'Import or restore the source audio first.');check(b.revision===j.revision,'This sound source changed on another device. Reopen it before saving.');
   if(b.action==='scan'){
    check(b.confirm===true,'Review the detection settings before scanning again.');j.history=[...(j.history||[]),{at:now(),samples:j.samples,options:j.options}].slice(-10);j.options=this.options(b.options);j.operation='analyze';await this.enqueue(j);return this.view(j);
   }
   if(b.action==='save-samples'){
    const rows=S.samples(b.samples,j.duration);check(b.confirm===true&&rows.some(r=>r.keep),'Select at least one sample and confirm saving.');check(rows.filter(r=>r.keep).length<=500,'Save up to 500 checked samples at a time.');check(rows.filter(r=>r.keep).reduce((n,r)=>n+r.end-r.start,0)<=7200,'Selected sample ranges total more than two hours. Save a smaller batch.');
    j.samples=rows;j.saveRows=rows.filter(r=>r.keep);j.operation='extract';await this.enqueue(j);return this.view(j);
   }
   if(b.action==='edit') {j.samples=S.samples(b.samples,j.duration);j.revision++;await this.save(j);return this.view(j);}
   throw Error('Unknown sound-library action.');
  });
 }
 options(raw={}){const r={thresholdDb:raw.thresholdDb??-42,minGap:raw.minGap??.45,minLength:raw.minLength??.25,padding:raw.padding??.12,method:raw.method||'auto'};
  for(const [k,min,max] of [['thresholdDb',-80,-10],['minGap',.1,5],['minLength',.08,10],['padding',0,1]])check(Number.isFinite(r[k])&&r[k]>=min&&r[k]<=max,'Invalid '+k+'.');check(['auto','silence','chapters','whole'].includes(r.method),'Unknown sample-detection mode.');return r;
 }
 async start(b){return this.store.serialize('sound-start',async()=>{
  check(safeID(b.id)&&safeID(b.projectId),'Invalid sound request or project ID.');check(b.consent===true,'Confirm permission to import and use the source.');
  const input=b.url?{url:S.youtube(b.url)}:{uploadKey:b.uploadKey,name:String(b.name||'Local audio').slice(0,220)};
  check(!!b.url!==!!b.uploadKey,'Choose one YouTube link or one uploaded source.');
  if(input.uploadKey){check(safeID(input.uploadKey)&&EXTS.has(extname(input.name).toLowerCase()),'Choose a supported audio/video file.');const m=await loadJSON(this.store.blobPath(input.uploadKey)+'.json');check(m&&m.size<=512*1024**2,'Upload source first (maximum 512 MiB).');input.sha=m.sha;}
  const options=this.options(b.options),stamp=hash({input,projectId:b.projectId,options});const old=this.jobs.get(b.id);if(old){check(old.startStamp===stamp,'This request ID was used for a different source.');return this.view(old);}
  check([...this.jobs.values()].filter(j=>BUSY.has(j.status)).length<12,'Sound queue is full. Wait for imports to finish.');
  const j={id:b.id,projectId:b.projectId,name:input.name||'YouTube audio',input,options,startStamp:stamp,createdAt:now(),revision:0,status:'queued',phase:'queued',operation:'import',message:'Queued for local sound processing.',progress:0,media:[],samples:[],history:[],source:null,cancelRequested:false};
  this.jobs.set(j.id,j);await this.enqueue(j);return this.view(j);
 });}
 async restore(b){check(b.confirm===true&&safeID(b.projectId),'Confirm restoring this sound source.');const x=b.library;check(x&&safeID(x.id)&&safeID(x.source?.id),'Invalid sound-source record.');return this.store.serialize('sound-start',async()=>{
  if(this.jobs.has(x.id))return this.view(this.get(x.id));const meta=await loadJSON(this.store.blobPath(x.source.id)+'.json');check(meta&&meta.sha===x.source.sha256,'Restore the original source bytes before reanalyzing.');
  const j={id:x.id,projectId:b.projectId,name:String(x.name||'Restored audio').slice(0,220),input:{},source:x.source,provenance:x.provenance,options:this.options(x.options),duration:x.duration,samples:[],media:[],history:[],createdAt:now(),revision:0,status:'paused',operation:'analyze',message:'Restored sound source; analyze to rebuild the waveform.',progress:0};this.jobs.set(j.id,j);await this.enqueue(j);return this.view(j);
 });}
 async enqueue(j){check(!this.closed,'Sound server is stopping.');j.status='queued';j.progress=0;j.error=null;j.revision++;j.message='Queued for '+j.operation+' (CPU only).';await this.save(j);if(!this.queue.includes(j.id))this.queue.push(j.id);void this.pump();}
 kill(){if(this.child?.pid){try{process.kill(-this.child.pid,'SIGTERM');}catch{}const pid=this.child.pid;const timer=setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch{}},1500);timer.unref();}}
 async pump(){if(this.running||this.closed)return;const id=this.queue.shift();if(!id)return;const j=this.jobs.get(id);if(!j||j.cancelRequested){void this.pump();return;}this.running=id;this.runningDone=new Promise(resolve=>this.finishRunning=resolve);
  try{j.status='running';await this.save(j);await this.process(j);if(j.cancelRequested||this.closed)throw Error('Sound operation interrupted.');j.status='ready';j.phase='ready';j.progress=1;j.message=j.operation==='extract'?'Samples saved. Add them to Post when ready.':'Candidate samples ready to audition and edit.';j.error=null;
  }catch(e){j.status=this.closed?'paused':j.cancelRequested?'cancelled':'failed';j.message=e.message;j.error=e.message;}
  finally{j.revision++;await this.save(j);this.running=null;this.child=null;this.finishRunning?.();this.finishRunning=null;if(!this.closed)void this.pump();}
 }
 async call(j,request){check(!j.cancelRequested&&!this.closed,'Sound operation cancelled.');return new Promise((resolve,reject)=>{
  const ch=spawn(this.python,[this.worker],{stdio:['pipe','pipe','pipe'],detached:true,env:{...process.env,CUDA_VISIBLE_DEVICES:'',OMP_NUM_THREADS:'2',MKL_NUM_THREADS:'2',H3_NODE:process.execPath}});this.child=ch;
  const lines=createInterface({input:ch.stdout});let result,err='',last=0,error;const timer=setTimeout(()=>{error='Sound operation exceeded 20 minutes. Resume explicitly or use a local file.';this.kill();},1200000);timer.unref();
  ch.stderr.on('data',c=>{err=(err+c).slice(-4000);});lines.on('line',line=>{if(line.length>1024*1024){error='Unexpected sound-helper output.';this.kill();return;}try{const x=JSON.parse(line);if(x.error)error=x.error;if(x.result)result=x.result;if(x.phase){j.phase=x.phase;j.progress=x.progress??null;j.message=x.message||x.phase;if(Date.now()-last>500){last=Date.now();void this.save(j).catch(()=>{});}}}catch{}});
  ch.on('error',e=>{clearTimeout(timer);reject(Error('Cannot start sound helper with '+this.python+': '+e.message));});
  ch.on('close',code=>{clearTimeout(timer);lines.close();if(this.child===ch)this.child=null;if(j.cancelRequested||this.closed)return reject(Error('Sound operation interrupted; saved files remain.'));if(code!==0||!result)return reject(Error(error||'Sound helper failed. '+err.slice(-1800)));resolve(result);});
  ch.stdin.on('error',()=>{});ch.stdin.end(JSON.stringify(request));
 });}
 async process(j){const dir=join(this.root,'work-'+j.id);await mkdir(dir,{recursive:true,mode:0o700});const out=join(dir,'source.wav');
  try{
   if(j.operation==='import'&&!j.source){const info=await this.call(j,{action:'import',...j.input,input:j.input.uploadKey?this.store.blobPath(j.input.uploadKey):undefined,output:out,options:j.options,rightsConfirmed:true});const s=await stat(out),id='sound_source_'+j.id,meta=await this.store.putBlob(id,createReadStream(out),s.size,'audio/wav');
    j.source={id,name:info.provenance.name+' · source.wav',kind:'audio',type:'audio/wav',size:s.size,duration:info.duration,sha256:meta.sha};j.name=info.provenance.name;j.provenance={...info.provenance,uploadedSha256:j.input.sha||null};Object.assign(j,{duration:info.duration,peaks:info.peaks,samples:info.samples,warnings:info.warnings,method:info.method});await this.save(j);
   }else if(j.operation==='analyze'||j.operation==='import'){
    const info=await this.call(j,{action:'analyze',input:this.store.blobPath(j.source.id),output:out,options:j.options,chapters:j.provenance?.chapters});Object.assign(j,{duration:info.duration,peaks:info.peaks,samples:info.samples,warnings:info.warnings,method:info.method});
   }else if(j.operation==='extract'){
    let i=0;for(const row of j.saveRows||[]){check(!j.cancelRequested&&!this.closed,'Sound sample saving interrupted.');const stamp=hash({source:j.source.sha256,start:row.start,end:row.end,name:row.name,category:row.category}),id='sound_'+stamp.slice(0,48);if(j.media.some(a=>a.id===id)){i++;continue;}
     j.phase='saving';j.message='Saving sample '+(++i)+' / '+j.saveRows.length;await this.save(j);
     const target=join(dir,'sample.wav'),info=await this.call(j,{action:'extract',input:this.store.blobPath(j.source.id),output:target,start:row.start,end:row.end});const s=await stat(target),meta=await this.store.putBlob(id,createReadStream(target),s.size,'audio/wav');
     j.media.push({id,kind:'audio',name:row.name+'.wav',type:'audio/wav',size:s.size,duration:info.duration,sha256:meta.sha,category:row.category,provenance:{kind:'sound-sample',sourceId:j.source.id,sourceSha256:j.source.sha256,sourceName:j.name,url:j.provenance?.url||null,rangeSeconds:[row.start,row.end],sampleId:row.id,libraryId:j.id,createdAt:now()}});await this.save(j);
    }
   }else throw Error('Unknown sound processing operation.');
  }finally{await rm(dir,{recursive:true,force:true});}
 }
 async close(){this.closed=true;this.kill();await this.runningDone;}
}
