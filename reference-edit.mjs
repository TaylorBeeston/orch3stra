/** Set plates: edit existing reference stills into a NEW camera angle of the SAME place.
 * Client-side composition of existing studio services only: references.register / planImages /
 * adoptImage, generation.discover / prepareImages, worker /generate and job_wait. It adds no bridge
 * route, so a running studio and worker need no restart. Submitted work is never retried.
 */
import {open,stat} from 'node:fs/promises';
import {resolve,basename,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AgentError} from './agent-client.mjs';
import {toolDefinition,validateArguments} from './agent-catalog.mjs';
const require=createRequire(import.meta.url),H=require('./core.js'),R=require('./reference-core.js');

export const DEFAULT_EDIT_MODEL=R.SET_PLATE_MODEL;
const MIME={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'};
const fail=(code,message,details)=>{throw new AgentError(code,message,details);};
const noConsent=value=>Array.isArray(value)?value.map(noConsent):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([k])=>!['licenseAccepted','license_accepted'].includes(k)).map(([k,v])=>[k,noConsent(v)])):value;

/** Width/height from PNG, JPEG or WebP headers (first 512 KiB); null when unknown. */
export async function imageSize(path){
 const handle=await open(path,'r');
 try{
  const buffer=Buffer.alloc(512*1024),{bytesRead}=await handle.read(buffer,0,buffer.length,0),b=buffer.subarray(0,bytesRead);
  if(b.length>=24&&b.readUInt32BE(0)===0x89504e47&&b.toString('latin1',12,16)==='IHDR')return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
  if(b.length>=30&&b.toString('latin1',0,4)==='RIFF'&&b.toString('latin1',8,12)==='WEBP'){
   const chunk=b.toString('latin1',12,16);
   if(chunk==='VP8X')return{width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};
   if(chunk==='VP8L'){const bits=b.readUInt32LE(21);return{width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};}
   if(chunk==='VP8 ')return{width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};
  }
  if(b.length>=4&&b[0]===0xff&&b[1]===0xd8){
   for(let i=2;i+9<b.length;){
    if(b[i]!==0xff){i++;continue;}
    const marker=b[i+1];
    if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7)){i+=2;continue;}
    const length=b.readUInt16BE(i+2);
    if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return{width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};
    i+=2+length;
   }
  }
  return null;
 }finally{await handle.close();}
}

function placeholder(assetId){return 'h3media:'+createHash('sha256').update('set-plate-dry-run:'+assetId).digest('hex').slice(0,32);}

/** Pure request construction shared by dry runs and tests. Mirrors agent-media.mjs prepareImages. */
export function buildSetPlateRequest({project,card,info,model,requestId,resolution,seed=-1,steps,guidance,accelerationProfile,cameraLora,cameraLoraStrength,uploaded}){
 const profile=info.profile,acceleration=accelerationProfile?info.image_profiles?.find(row=>row.id===accelerationProfile):null;
 if(accelerationProfile&&!acceleration)fail('INVALID_ARGUMENTS','accelerationProfile is not in the discovered profile list for '+model+'.',{available:(info.image_profiles||[]).map(p=>p.id)});
 const settings={modelType:model,resolution,seed,...(accelerationProfile?{accelerationProfile}:{}),...(cameraLora?{cameraLora,cameraLoraStrength}:{}),steps:acceleration?.steps??steps??profile.default_steps,guidance:acceleration?.guidance??guidance??profile.default_guidance,imageProfile:profile,licenseAccepted:true};
 const task=R.task(card,settings,uploaded);
 const body={request_id:requestId,project_id:project.id,project:project.name,tasks:[task],snapshot:{kind:'reference-images',cards:[H.clone(card)],settings:noConsent(settings)}};
 const request={path:'/generate',method:'POST',body};
 validateArguments(toolDefinition('worker'),request);
 return{request,task,settings};
}

function cardFor(args,referenceIds,prompt){
 const card={title:String(args.title||'Set plate').slice(0,200),prompt,referenceIds,purpose:'Set plate: a new camera angle of an existing location, for use as a window reference.'};
 if(args.windowIds?.length)card.windowIds=[...args.windowIds];
 if(args.subjectId)card.subjectId=args.subjectId;
 return card;
}

export async function referenceEdit(client,args){
 const allow=args._allow||[],dryRun=args.dryRun===true,model=args.model||DEFAULT_EDIT_MODEL;
 const sources=args.sourceImages??[args.sourceImage];
 if(new Set(sources).size!==sources.length)fail('INVALID_ARGUMENTS','Source images must be distinct.');
 if(!dryRun&&args.licenseAccepted!==true)fail('LICENSE_REQUIRED','Review the selected image model licence (Qwen Image 2.1: Qwen Research License; Qwen Image Edit 2511: Apache-2.0) and pass licenseAccepted:true for this request. Use dryRun:true to inspect the request first.');
 const requestId=args.requestId||('set_plate_'+randomUUID().replaceAll('-',''));
 const progress={requestId,stage:'project'};
 const call=(tool,input)=>client.call(tool,{...input,_allow:allow});
 try{
  let record=await call('project',{action:'get',projectId:args.projectId});
  const p=record.project;
  progress.stage='sources';
  const resolved=[];
  for(const source of sources){
   const asset=p.assets.find(a=>a.id===source);
   if(asset){if(asset.kind!=='image')fail('INVALID_SOURCE','Asset '+source+' is '+asset.kind+', not an image.');if(asset.generationExcluded)fail('INVALID_SOURCE','Asset '+asset.name+' is excluded from generation. Reactivate it first.');resolved.push({kind:'asset',assetId:asset.id,name:asset.name,width:asset.width,height:asset.height});continue;}
   const path=resolve(source);let info=null;try{info=await stat(path);}catch{}
   if(!info?.isFile()||!info.size)fail('SOURCE_NOT_FOUND','Source '+JSON.stringify(source)+' is neither an image asset ID of this project nor a nonempty local file.');
   const type=MIME[extname(path).toLowerCase()];
   if(!type)fail('INVALID_SOURCE','Local sources must be .png, .jpg/.jpeg or .webp files.');
   resolved.push({kind:'file',path,type,name:basename(path),bytes:info.size,...(await imageSize(path)||{})});
  }
  progress.stage='discover';
  const info=await call('generation',{action:'discover',family:'image',modelType:model});
  if(info.metadata?.model_type!==model||info.profile?.kind!=='reference_image')fail('MODEL_UNSUPPORTED','The worker does not expose '+model+' as a reference-image preset.');
  if(!(info.profile.max_references>=sources.length))fail('MODEL_UNSUPPORTED',model+' accepts '+(info.profile.max_references||0)+' input image(s); this edit has '+sources.length+'. Choose an editing preset such as '+DEFAULT_EDIT_MODEL+' (10 inputs) or a Krea 2 *_edit preset (2 inputs).');
  const lora=args.multiAngleLora===true,grammar=R.cameraLoraFor(model);
  if(lora&&!grammar)fail('INVALID_ARGUMENTS','multiAngleLora is available for '+Object.keys(R.CAMERA_LORA_GRAMMARS).join(' and ')+' only.');
  if(args.multiAngleLoraStrength!==undefined&&!lora)fail('INVALID_ARGUMENTS','multiAngleLoraStrength needs multiAngleLora:true.');
  if(lora&&!args.cameraView&&!String(args.prompt).includes(grammar.trigger))fail('INVALID_ARGUMENTS','multiAngleLora needs cameraView (e.g. '+(model===R.EDIT_2511_MODEL?'"back view eye-level shot medium shot"':'"back view, eye-level shot"')+') or a prompt containing '+grammar.trigger+'.');
  const prompt=R.setPlatePrompt(args.prompt,sources.length,{literal:args.literalPrompt===true,cameraView:args.cameraView,model});
  const cameraEntry=lora?(info.profile.camera_loras||[]).find(row=>row.id===grammar.id):null;
  const loraStatus=lora?{id:grammar.id,strength:args.multiAngleLoraStrength??cameraEntry?.default_strength??1,installed:cameraEntry?.installed===true,reportedByWorker:!!cameraEntry}:null;
  if(lora&&!dryRun&&!loraStatus.installed)fail('LORA_UNAVAILABLE',cameraEntry?'The worker reports the Multiple-Angles LoRA as not installed in WanGP '+(model===R.EDIT_2511_MODEL?'loras/qwen':'loras/qwen21')+'.':'The running worker predates camera-LoRA support (no profile.camera_loras). Restart the idle bridge and worker on code with this change, then retry.',{multiAngleLora:loraStatus});
  const resolution=R.setPlateResolution(resolved[0],{width:args.width,height:args.height});
  const options={model,requestId,resolution,seed:args.seed??-1,steps:args.steps,guidance:args.guidance,accelerationProfile:args.accelerationProfile,...(lora?{cameraLora:grammar.id,cameraLoraStrength:loraStatus.strength}:{})};
  if(dryRun){
   const preview=H.clone(p),uploaded={};
   resolved.forEach((s,i)=>{if(s.kind==='file'){s.assetId='dry-run-source-'+(i+1);preview.assets.push({id:s.assetId,kind:'image',name:s.name,width:s.width,height:s.height,missing:false});}uploaded[s.assetId]=placeholder(s.assetId);});
   const card={...R.parsePlan(JSON.stringify({images:[cardFor(args,resolved.map(s=>s.assetId),prompt)]}),preview).images[0],id:'dry-run-card'};
   const built=buildSetPlateRequest({project:preview,card,info,...options,uploaded});
   return{dryRun:true,submitted:false,projectId:p.id,serverRevision:record.serverRevision,model:{modelType:model,name:info.metadata.name,profile:info.profile},resolution,...(lora?{multiAngleLora:{...loraStatus,...(loraStatus.installed?{}:{warning:loraStatus.reportedByWorker?'Not installed on the worker; a real run would fail before upload.':'This worker does not report camera LoRAs yet; a real run fails with LORA_UNAVAILABLE until the bridge and worker run this code.'})}}:{}),sources:resolved.map(({path,...s})=>({...s,...(path?{path,willUpload:true}:{})})),workerRequest:built.request,requiredEffects:['network','cpu','gpu'],uploadPlaceholders:Object.fromEntries(Object.entries(uploaded)),
    steps:['upload + references.register each local file (cpu, network)','references.planImages with this one card','generation.prepareImages (uploads sources to the worker; persists the request ID)','worker POST /generate once (gpu)','job_wait worker','references.adoptImage'+(args.windowIds?.length?' with attachWindows':'')],
    note:'Dry run: nothing was uploaded, saved or submitted. image_refs hold placeholders; preparation replaces them with worker-owned h3media upload IDs. Run again without dryRun, with licenseAccepted:true and _allow network,cpu,gpu, after explicit GPU approval.'};
  }
  progress.stage='register';
  const referenceIds=[];
  for(const s of resolved){
   if(s.kind==='asset'){referenceIds.push(s.assetId);continue;}
   const upload=await call('media_upload',{file:s.path,type:s.type,destination:'studio'});
   const reply=await call('references',{action:'register',projectId:p.id,expectedRevision:record.serverRevision,key:upload.key,name:s.name,kind:'image',destination:'references',description:'Set-plate source image.'});
   record=reply.record;referenceIds.push(reply.asset.id);progress.registeredAssetIds=[...(progress.registeredAssetIds||[]),reply.asset.id];
  }
  progress.stage='plan';
  const planned=await call('references',{action:'planImages',projectId:p.id,expectedRevision:record.serverRevision,proposal:{images:[cardFor(args,referenceIds,prompt)],notes:['Set plate created by reference editImage.']}});
  record=planned.record;const planId=planned.plan.id,cardId=planned.plan.images[0].id;Object.assign(progress,{planId,cardId});
  progress.stage='prepare';
  const settings={modelType:model,resolution,seed:options.seed,...(args.steps!==undefined?{steps:args.steps}:{}),...(args.guidance!==undefined?{guidance:args.guidance}:{}),...(args.accelerationProfile?{accelerationProfile:args.accelerationProfile}:{}),...(lora?{cameraLora:grammar.id,cameraLoraStrength:loraStatus.strength}:{})};
  const prepared=await call('generation',{action:'prepareImages',projectId:p.id,expectedRevision:record.serverRevision,requestId,planId,cardIds:[cardId],settings,licenseAccepted:true});
  if(!prepared.ready||prepared.operation?.tool!=='worker')fail('PREPARATION_INCOMPLETE','The studio did not return a worker dispatch operation.',{prepared});
  record=prepared.record;progress.reconciliation=prepared.reconciliation;
  if(lora&&prepared.operation.arguments?.body?.tasks?.[0]?.camera_lora!==grammar.id)fail('LORA_UNAVAILABLE','The studio prepared the request without the camera LoRA (bridge predates it). Nothing was submitted; restart the idle bridge on this code.',{multiAngleLora:loraStatus});
  progress.stage='dispatch';
  const job=await call('worker',prepared.operation.arguments);
  const jobId=job.job_id;progress.jobId=jobId;
  const adopt=outputId=>({tool:'references',arguments:{action:'adoptImage',projectId:p.id,expectedRevision:'<current serverRevision from project get>',jobId,outputId:outputId||'<image output id from the completed job>',attachWindows:!!args.windowIds?.length}});
  if(args.wait===false)return{outcome:'submitted',submitted:true,projectId:p.id,requestId,planId,cardId,jobId,status:job.status,next:{wait:'node orch3stra.mjs wait worker '+jobId+' --allow network',adopt:adopt()}};
  progress.stage='wait';
  const waited=await call('job_wait',{tool:'worker',id:jobId,timeoutMs:args.timeoutMs??1800000,intervalMs:3000});
  if(waited.outcome!=='completed')return{outcome:waited.outcome,submitted:true,projectId:p.id,requestId,planId,cardId,jobId,status:waited.status,result:waited.result,next:{wait:'node orch3stra.mjs wait worker '+jobId+' --allow network',adopt:adopt()},warning:'Do not resubmit. Wait on this job ID, then adopt its output.'};
  const output=(waited.result.outputs||[]).find(o=>o.media_kind==='image'&&o.available!==false);
  if(!output)return{outcome:'attention',submitted:true,projectId:p.id,requestId,jobId,status:waited.status,result:waited.result,message:'The job completed without an available image output. Inspect the job; nothing was adopted.'};
  progress.stage='adopt';progress.outputId=output.id;
  record=await call('project',{action:'get',projectId:p.id});
  const adopted=await call('references',{...adopt(output.id).arguments,expectedRevision:record.serverRevision});
  const asset=adopted.asset;
  return{outcome:'completed',projectId:p.id,serverRevision:adopted.record.serverRevision,assetId:asset.id,asset:{id:asset.id,name:asset.name,number:asset.number,type:asset.type,width:asset.width,height:asset.height,sha256:asset.sha256},pictureToken:'<Picture '+asset.number+'>',mediaUrl:'/api/studio-blob?key='+asset.id,attachedWindowIds:args.windowIds?.length?args.windowIds:[],jobId,outputId:output.id,requestId,planId,cardId,...(lora?{multiAngleLora:loraStatus}:{}),
   next:'Inspect the picture before relying on it. To attach it to more windows use references assign with the window\u2019s COMPLETE image selection (assign replaces the direct image list), e.g. {"action":"assign","projectId":"'+p.id+'","expectedRevision":'+adopted.record.serverRevision+',"windowId":"<window>","assetIds":["<existing ids…>","'+asset.id+'"]}.'};
 }catch(caught){
  const error=caught?.code?caught:new AgentError('INVALID_ARGUMENTS',caught?.message||String(caught));
  {error.details={...(error.details||{}),setPlate:{...progress}};if(['dispatch','wait','adopt'].includes(progress.stage)||error.code==='OUTCOME_UNKNOWN')error.details.setPlate.warning='Work may already be submitted. Do not rerun this request; reconcile with '+JSON.stringify(progress.reconciliation||{tool:'worker',arguments:{path:'/requests/'+requestId,method:'GET'}})+'.';}
  throw error;
 }
}
