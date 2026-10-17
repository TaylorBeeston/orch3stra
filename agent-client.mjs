/** Agent transport for the real studio. Never retries a mutation or invents completion. */
import {createReadStream,createWriteStream} from 'node:fs';
import {stat,unlink,link} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {toolDefinition,validateArguments,requiredEffects} from './agent-catalog.mjs';

export class AgentError extends Error {
  constructor(code,message,details={}){super(message);this.name='AgentError';this.code=code;this.details=details;}
}
export function errorRecord(error){return {code:error.code||'AGENT_ERROR',message:error.message||String(error),...(error.status?{status:error.status}:{}),...(error.details?{details:error.details}:{})};}
const stopped=new Set(['failed','cancelled','interrupted','paused','needs_review','uncertain','retired','awaiting-browser','awaiting_review']);
const completed=new Set(['completed','succeeded','ready']);

export class AgentClient {
  constructor({url=process.env.ORCH3STRA_URL||'http://127.0.0.1:8765',cookie=process.env.ORCH3STRA_COOKIE||'',timeoutMs=120000}={}){
    const parsed=new URL(url);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw new AgentError('INVALID_URL','Use the studio http(s) origin without credentials, path, query, or fragment.');
    if(!Number.isFinite(timeoutMs)||timeoutMs<1)throw new AgentError('INVALID_ARGUMENTS','timeoutMs must be positive.');
    this.url=parsed.origin;this.cookie=cookie;this.timeoutMs=timeoutMs;this.token=null;
  }
  headers(extra={}){return {...(this.cookie?{Cookie:this.cookie}:{}),...extra};}
  async response(path,{method='GET',body,headers={},mutation=false,timeoutMs=this.timeoutMs}={}){
    try{return await fetch(this.url+path,{method,body,headers:this.headers(headers),...(body instanceof Readable?{duplex:'half'}:{}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});}
    catch(error){throw new AgentError(mutation?'OUTCOME_UNKNOWN':'CONNECTION_FAILED',mutation?'The request outcome is unknown. Do not repeat it. Inspect the saved project revision or exact job/request ID before deciding what to do.':'Cannot reach the studio: '+error.message,{path,cause:error.message,retrySubmittedWork:false});}
  }
  async json(path,{body,mutation=false,...options}={}){
    const response=await this.response(path,{...options,method:body===undefined?'GET':'POST',body:body===undefined?undefined:JSON.stringify(body),headers:{'Content-Type':'application/json',...(body===undefined?{}:{'X-H3-Token':this.token}),...options.headers},mutation});
    let data;
    try{data=await response.json();}catch{throw new AgentError(mutation?'OUTCOME_UNKNOWN':'INVALID_RESPONSE','The studio did not return complete JSON. Check the URL, pairing, logs and request ownership; do not repeat submitted work.',{path,status:response.status});}
    if(!response.ok&&mutation&&response.status>=500)throw new AgentError('OUTCOME_UNKNOWN','The studio reported an upstream/internal failure; submitted work may already have been accepted. Do not repeat it. Inspect the exact saved request/job and project revision.',{path,status:response.status,server:data,retrySubmittedWork:false});
    if(!response.ok){const error=new AgentError(data.code||('HTTP_'+response.status),typeof data.error==='string'?data.error:data.error?.message||response.statusText,{path,...(data.details?{server:data.details}:{}),...(response.status===401?{next:'Pair this client using pair --password-stdin --cookie-file, or supply an existing trusted studio cookie.'}:{}),...(response.status===403?{next:'Check the URL/Host and pairing; restart this client to obtain the current bridge token. No request was replayed.'}:{})});error.status=response.status;throw error;}
    return data;
  }
  async health(options={}){const {token,...health}=await this.json('/api/health',options);if(health.app!=='h3-director-bridge'||!token)throw new AgentError('WRONG_APPLICATION','URL is not an authenticated Orch3stra studio.');this.token=token;return health;}
  async authenticated(timeoutMs){if(!this.token)await this.health({timeoutMs});}
  async doctor(){
    const health=await this.health();
    const catalog=await this.json('/api/agent');
    const projects=await this.json('/api/studio',{body:{action:'list'}});
    return {url:this.url,health,agentProtocol:catalog.protocolVersion,tools:catalog.tools.map(tool=>tool.name),publishedProjects:projects.projects,ownership:'These are server-published copies, not unsynced browser projects.',next:'Use describe to inspect schemas. No model loading, provider request, queue resume, or render was requested.'};
  }
  async call(name,input={},options={}){
    const tool=toolDefinition(name);
    validateArguments(tool,input);
    const { _allow=[],...args}=input;
    const missing=requiredEffects(tool,args).filter(effect=>!_allow.includes(effect));
    if(missing.length)throw new AgentError('AUTHORIZATION_REQUIRED','This action needs explicit authorization for: '+missing.join(', ')+'. Pass _allow only when the user has authorized that scope.',{tool:name,action:args.action,required:missing});
    if(name==='doctor')return this.doctor();
    if(name==='media_upload')return this.upload(args);
    if(name==='media_download')return this.download(args);
    if(name==='job_wait')return this.wait({...args,_allow});
    await this.authenticated(options.timeoutMs);
    const readActions=new Set(tool.readActions||[]);
    const mutation=!(tool.readOnly===true||readActions.has(args.action)||name==='worker'&&(args.method||'GET')==='GET');
    return this.json(tool.endpoint,{body:tool.agent?{tool:name,arguments:input}:args,mutation,timeoutMs:options.timeoutMs});
  }
  async upload({file,type,key,destination='studio'}){
    await this.authenticated();
    const path=resolve(file),info=await stat(path);
    if(!info.isFile()||!info.size)throw new AgentError('INVALID_MEDIA','Choose a nonempty regular media file.');
    if(!/^(image|audio|video)\/[a-zA-Z0-9.+-]+$/.test(type||''))throw new AgentError('INVALID_MEDIA','Supply the real image/audio/video MIME type with --type.');
    if(info.size>2*1024**3)throw new AgentError('INVALID_MEDIA','The studio upload limit is 2 GiB per file.');
    const mediaKey=key||'agent_'+randomUUID();
    const endpoint=destination==='studio'?'/api/studio-blob?key='+encodeURIComponent(mediaKey):destination==='worker'?'/api/wangp-upload?filename='+encodeURIComponent(path.split('/').at(-1)):destination==='voice'?'/api/voice-upload?filename='+encodeURIComponent(path.split('/').at(-1)):null;
    if(!endpoint)throw new AgentError('INVALID_ARGUMENTS','destination must be studio, worker, or voice.');
    const stream=createReadStream(path);
    try{
      const response=await this.response(endpoint,{method:'POST',body:stream,headers:{'X-H3-Token':this.token,'Content-Type':type,'Content-Length':String(info.size)},mutation:true});
      let result;try{result=await response.json();}catch{throw new AgentError('OUTCOME_UNKNOWN','Upload response was incomplete. Inspect the immutable media key before retrying.',{key:mediaKey,destination});}
      if(!response.ok&&response.status>=500)throw new AgentError('OUTCOME_UNKNOWN','The upload outcome is unknown. Inspect the immutable media key or owning upload before retrying.',{status:response.status,key:mediaKey,destination,server:result,retrySubmittedWork:false});
      if(!response.ok)throw new AgentError(result.code||'UPLOAD_FAILED',result.error||response.statusText,{status:response.status,key:mediaKey});
      return {destination,...(destination==='studio'?{key:mediaKey}:{}),type,bytes:info.size,result,next:destination==='studio'?'Register this immutable blob as project media using the references tool; upload alone does not edit the project.':'Use the returned media/source ID in the matching worker or voice request.'};
    }finally{stream.destroy();}
  }
  async download({url,output}){
    const parsed=new URL(url,this.url);
    if(parsed.origin!==this.url||!/^\/api\/(?:studio-blob$|studio-media\/|finish-media\/|sounds-media\/|voice\/audio\/|media\/|agent-backup\/)/.test(parsed.pathname)||parsed.username||parsed.password||parsed.hash)throw new AgentError('INVALID_DOWNLOAD','Only media/backup URLs returned by this same studio are accepted.');
    await this.authenticated();
    const response=await this.response(parsed.pathname+parsed.search);
    if(!response.ok){
      const data=await response.json().catch(()=>null);
      throw new AgentError(data?.code||'DOWNLOAD_FAILED',typeof data?.error==='string'?data.error:'Media returned HTTP '+response.status,{status:response.status,url:parsed.href,...(data?.details?{server:data.details}:{})});
    }
    if(!response.body)throw new AgentError('DOWNLOAD_FAILED','Media response has no body.');
    const path=resolve(output),temporary=path+'.part-'+randomUUID(),hash=createHash('sha256');let bytes=0,created=false;
    const sink=createWriteStream(temporary,{flags:'wx',mode:0o600});
    sink.on('open',()=>{created=true;});
    try{
      await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,encoding,done){bytes+=chunk.length;hash.update(chunk);done(null,chunk);}}),sink);
      if(!bytes)throw new AgentError('EMPTY_MEDIA','Downloaded media was empty.');
      const length=response.headers.get('content-length');
      if(length!==null&&Number(length)!==bytes)throw new AgentError('INCOMPLETE_MEDIA','Downloaded byte count differs from Content-Length.');
      await link(temporary,path); // Atomic publication; an existing destination is never overwritten.
      return {path,bytes,sha256:hash.digest('hex'),type:response.headers.get('content-type'),url:parsed.href};
    }finally{if(created)await unlink(temporary).catch(()=>{});}
  }
  async wait({tool,id,timeoutMs=120000,intervalMs=1500,_allow=[]}){
    if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>86400000||!Number.isFinite(intervalMs)||intervalMs<100||intervalMs>60000)throw new AgentError('INVALID_ARGUMENTS','wait timeoutMs must be 1..86400000, intervalMs 100..60000.');
    const requests={planner:{action:'get',id,detail:true},sequence:{action:'get',id},reference_agent:{action:'get',id,detail:true},finish:{action:'get',id},sounds:{action:'get',id},speech_quality:{action:'get',id},voice:{action:'status',id},worker:{path:'/jobs/'+encodeURIComponent(id),method:'GET'}};
    if(!requests[tool])throw new AgentError('INVALID_ARGUMENTS','Unsupported wait tool. Choose '+Object.keys(requests).join(', '));
    const until=Date.now()+timeoutMs;let last;
    try{
      await this.authenticated(timeoutMs);
      while(Date.now()<until){
        last=await this.call(tool,{...requests[tool],_allow},{timeoutMs:Math.max(1,until-Date.now())});
        const job=last.job||last,status=job.status||job.state;
        if(completed.has(status))return {outcome:'completed',tool,id,status,result:last,next:'Inspect actual outputs and quality. Completion is not proof of artistic quality or automatic project adoption.'};
        if(stopped.has(status))return {outcome:'attention',tool,id,status,result:last,next:'Inspect the recorded reason and ownership. No automatic resume, retry, approval, or new submission was made.'};
        await delay(Math.min(intervalMs,Math.max(0,until-Date.now())));
      }
    }catch(error){if(Date.now()<until||!['CONNECTION_FAILED','INVALID_RESPONSE'].includes(error.code))throw error;}
    return {outcome:'timeout',tool,id,result:last,next:'Observation deadline elapsed; the job was not cancelled. Inspect/wait on this same ID, not a new submission.'};
  }
}
