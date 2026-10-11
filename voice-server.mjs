import {voicePython} from './python-env.mjs';
/** Optional speech work on CPU, isolated from WanGP. No npm dependencies. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,rm,stat,access,open as openFile} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const ROOT=fileURLToPath(new URL('.',import.meta.url));
const ID=/^[a-f0-9]{64}$/;
const EXT=new Set(['.mp3','.wav','.flac','.ogg','.m4a','.aac','.opus','.mp4','.webm','.mov','.mkv','.avi','.m4v']);
const MAX_BYTES=256*1024**2;
const id=()=>randomBytes(32).toString('hex');
const fail=message=>{throw Error(message);};
export class VoiceWorkshop {
  constructor({python=voicePython(),worker=join(ROOT,'scripts','voice_worker.py'),beforeInit=Promise.resolve()}={}){
    this.python=python;this.worker=worker;this.jobs=new Map();this.sources=new Map();this.uploads=new Map();this.closed=false;
    this.root=Promise.resolve(beforeInit).then(()=>mkdtemp(join(tmpdir(),'h3-director-voices-')));this.root.catch(()=>{});
    this.sweep=setInterval(()=>this.expire().catch(()=>{}),60000);this.sweep.unref();
  }
  async interpreter(){return this.python||voicePython();}
  async expire(){const before=Date.now()-24*3600*1000;for(const [key,s]of this.sources)if(s.at<before&&!this.isBusy()){this.sources.delete(key);await rm(s.dir,{recursive:true,force:true});}for(const [key,j] of this.jobs)if(j.at<before&&['completed','failed','cancelled'].includes(j.status))this.jobs.delete(key);for(const [key,u]of this.uploads)if(u.at<before){this.uploads.delete(key);await rm(u.dir,{recursive:true,force:true});}}
  isBusy(){return [...this.jobs.values()].some(j=>['queued','running','cancelling'].includes(j.status));}
  publicJob(j){if(!j)throw Error('Unknown voice job. The bridge may have restarted. Your saved browser sources are unaffected.');return{id:j.id,status:j.status,phase:j.phase,message:j.message,progress:j.progress??null,result:j.result??null,error:j.error??null,createdAt:j.createdAt};}
  async run(request,j,signal){
    const python=await this.interpreter(),secret=request.hfToken||process.env.HF_TOKEN||'';
    if(this.closed||j?.status==='cancelling')throw Error('Voice operation cancelled.');
    const env={...process.env,CUDA_VISIBLE_DEVICES:'',PYANNOTE_METRICS_ENABLED:'0',HF_HUB_DISABLE_TELEMETRY:'1',OMP_NUM_THREADS:'2',H3_NODE:process.execPath};
    for(const key of ['OPENAI_API_KEY','DEEPSEEK_API_KEY','OPENCODE_GO_API_KEY','OPENCODE_SERVER_PASSWORD','H3_WANGP_TOKEN'])delete env[key];
    const child=spawn(python,['-u',this.worker],{env,stdio:['pipe','pipe','pipe'],shell:false,windowsHide:true,detached:process.platform!=='win32'});
    if(j)j.child=child;
    const redact=s=>secret?String(s).split(secret).join('[redacted]'):String(s);
    let result,error='',stderr='',bytes=0;
    const stop=()=>{try{if(process.platform==='win32')child.kill('SIGTERM');else process.kill(-child.pid,'SIGTERM');}catch{}const hard=setTimeout(()=>{try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}},1200);hard.unref();};
    if(j)j.stop=stop;
    const timeout=setTimeout(()=>{error='Voice operation timed out. No automatic retry was made.';stop();},45*60*1000);timeout.unref();
    const onAbort=()=>{error='Voice operation cancelled.';stop();};signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
    const lines=createInterface({input:child.stdout});
    lines.on('line',line=>{bytes+=Buffer.byteLength(line);if(bytes>16*1024**2){error='Voice worker output exceeded limit.';stop();return;}try{const d=JSON.parse(line);if(d.result)result=JSON.parse(redact(JSON.stringify(d.result)));if(d.error)error=redact(d.error);if(j){if(d.phase)j.phase=d.phase;if(d.message)j.message=redact(d.message);if(typeof d.progress==='number')j.progress=d.progress;}}catch{}});
    child.stderr.on('data',b=>{stderr=(stderr+redact(b.toString())).slice(-1800);});
    child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
    try{return await new Promise((resolve,reject)=>{child.on('error',e=>reject(Error(e.code==='ENOENT'?'Voice Python was not found. Set H3_PYTHON to your WanGP environment; see ENVIRONMENT.md.':e.message)));child.on('close',code=>{if(j?.status==='cancelling')reject(Error('Voice operation cancelled.'));else if(code!==0||error||!result)reject(Error(redact(error||'Voice helper failed. '+stderr)));else resolve(result);});});}
    finally{clearTimeout(timeout);lines.close();signal?.removeEventListener('abort',onAbort);if(j){delete j.child;delete j.stop;}}
  }
  async capabilities(){return this.run({action:'capabilities'});}
  async upload(req,name){
    if(this.isBusy())throw Error('Finish or cancel the current voice operation before uploading another source.');
    if(this.uploads.size>=16)throw Error('Too many temporary uploads. Restart the bridge after saving your work.');
    const ext=extname(String(name||'')).toLowerCase();if(!EXT.has(ext))throw Error('Upload a standard audio or video file.');
    const length=Number(req.headers['content-length']);if(!Number.isSafeInteger(length)||length<1||length>MAX_BYTES)throw Error('Local voice inputs must be 1 byte–256 MiB. Trim larger files first.');
    const key=id(),dir=join(await this.root,key);await import('node:fs/promises').then(m=>m.mkdir(dir));const path=join(dir,'upload'+ext);let count=0;
    const limit=new Transform({transform(chunk,_,cb){count+=chunk.length;cb(count>MAX_BYTES?Error('Upload exceeds 256 MiB.'):null,chunk);}});
    try{await pipeline(req,limit,createWriteStream(path,{flags:'wx',mode:0o600}));if(count!==length)throw Error('Upload ended early.');this.uploads.set(key,{path,dir,name:String(name).split(/[\\/]/).at(-1),at:Date.now()});return{uploadId:key};}catch(e){await rm(dir,{recursive:true,force:true});throw e;}
  }
  start(action,b){
    if(this.closed)throw Error('Voice workshop is shutting down.');
    if(this.isBusy())throw Error('One voice operation is already running. Wait or cancel it before starting another.');
    if(action==='import'&&this.sources.size>=24)throw Error('Workshop temporary source limit reached. Save references, then restart the bridge or forget unused sources.');
    if(!['import','transcribe','diarize'].includes(action))throw Error('Unsupported voice operation.');
    const key=id(),j={id:key,status:'queued',phase:action,message:'Starting local CPU worker…',createdAt:new Date().toISOString(),at:Date.now()};
    this.jobs.set(key,j);
    j.promise=(async()=>{
      j.status='running';let dir,upload;
      try{
        let req;
        if(action==='import'){
          dir=join(await this.root,key);await import('node:fs/promises').then(m=>m.mkdir(dir));
          upload=b.uploadId?this.uploads.get(b.uploadId):null;if(b.uploadId&&!upload)fail('Upload expired. Upload the source again.');
          // Only this narrow, server-built request reaches Python. No browser file paths/options.
          req={action,input:upload?.path,name:upload?.name,output:join(dir,'source.wav'),url:b.url||null,start:b.start??0,end:b.end??120,rightsConfirmed:b.rightsConfirmed===true};
        }else{
          const s=this.sources.get(b.sourceId);if(!s)fail('Source expired. Reopen the saved browser source.');
          s.at=Date.now();req={action,input:s.path,model:b.model||'small',diarizationModel:b.diarizationModel==='nemotron3'?'nemotron3':'pyannote',language:b.language||null,diarize:b.diarize===true,hfToken:b.hfToken||'',allowModels:b.allowModels===true,numSpeakers:b.numSpeakers||null};
        }
        const result=await this.run(req,j);
        if(j.status==='cancelling')throw Error('Voice operation cancelled.');
        if(action==='import'){
          const sourceId=id();this.sources.set(sourceId,{path:req.output,dir,at:Date.now(),duration:result.duration});
          j.result={...result,sourceId,url:'/api/voice/audio/'+sourceId};
        }else j.result=result;
        j.status='completed';j.message='Ready';j.progress=1;
      }catch(e){j.status=j.status==='cancelling'?'cancelled':'failed';j.error=String(e.message).slice(0,2000);j.message=j.error;if(dir)await rm(dir,{recursive:true,force:true});}
      finally{if(upload){this.uploads.delete(b.uploadId);await rm(upload.dir,{recursive:true,force:true});}j.at=Date.now();}
    })();return this.publicJob(j);
  }
  async handle(b){
    if(b.action==='capabilities')return this.capabilities();
    if(b.action==='nemotron-capabilities')return this.run({action:'nemotron-capabilities'});
    if(b.action==='status')return this.publicJob(this.jobs.get(b.id));
    if(b.action==='cancel'){const j=this.jobs.get(b.id);if(!j)fail('Unknown voice job.');if(['running','queued'].includes(j.status)){j.status='cancelling';j.stop?.();}return this.publicJob(j);}
    if(b.action==='forget'){if(this.isBusy())fail('Finish the active voice operation before forgetting sources.');const s=this.sources.get(b.sourceId);if(s){this.sources.delete(b.sourceId);await rm(s.dir,{recursive:true,force:true});}return{ok:true};}
    return this.start(b.action,b);
  }
  async serve(req,res,key){
    if(!ID.test(key))fail('Invalid voice media ticket.');const s=this.sources.get(key);if(!s)fail('Voice source expired; use the browser-stored copy.');s.at=Date.now();const st=await stat(s.path);let start=0,end=st.size-1,status=200;
    if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||Number(m[1])>=st.size){res.writeHead(416,{'Content-Range':'bytes */'+st.size});res.end();return;}start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),end):end;if(end<start)fail('Invalid audio range.');status=206;}
    const headers={'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${st.size}`;
    res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}try{await pipeline(createReadStream(s.path,{start,end}),res);}catch{res.destroy();}
  }
  async close(){if(this.closing)return this.closing;this.closing=this._close();return this.closing;}
  async _close(){this.closed=true;clearInterval(this.sweep);for(const j of this.jobs.values())if(['queued','running','cancelling'].includes(j.status)){j.status='cancelling';j.stop?.();}await Promise.allSettled([...this.jobs.values()].map(j=>j.promise));await rm(await this.root,{recursive:true,force:true});}
}
