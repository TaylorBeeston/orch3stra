/** Server-owned media authoring and packet preparation. Never dispatches a model. */
import {createRequire} from 'node:module';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadJSON,safeID} from './studio-server.mjs';
import {loadProject,saveProject,createProject,agentError,workerJSON,copyWorkerOutput} from './agent-project-state.mjs';
const require=createRequire(import.meta.url),H=require('./core.js'),R=require('./reference-core.js'),Scenes=require('./scene-core.js'),A=require('./reference-agent-core.js'),Post=require('./post-core.js'),Selection=require('./render-selection-core.js');
const exec=promisify(execFile),clone=H.clone,hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,code='INVALID_MEDIA')=>{throw agentError(code,message);};
const readActions=new Set(['list','inspect','imagePlanPacket']);
const FAMILY={Video:'video',Images:'image',Voices:'voice',Music:'music'};
const routes={video:'',image:'image-',voice:'voice-',music:'music-'};
const audioTypes={wav:'audio/wav',mp3:'audio/mpeg',flac:'audio/flac',ogg:'audio/ogg',aac:'audio/aac'};
const imageTypes={png:'image/png',mjpeg:'image/jpeg',webp:'image/webp'};
function assetOf(p,id){const a=p.assets.find(a=>a.id===id);if(!a)fail('Reference asset does not belong to this project.');return a;}
function windowOf(p,id){const w=p.windows.find(w=>w.id===id);if(!w)fail('Window does not belong to this project.');return w;}
function addAsset(p,a){a.number=Math.max(0,p.counters[a.kind]||0,...p.assets.filter(x=>x.kind===a.kind).map(x=>x.number||0))+1;p.counters[a.kind]=a.number;p.assets.push(a);}
function assertLiteral(value,label){if(typeof value!=='string'||!value.trim()||value.length>4000||/^(?:\/|~[/\\]|[A-Za-z]:[/\\]|https?:|file:)/.test(value.trim()))fail(label+' must be literal text, not a path or URL.');return value.trim();}
function noConsent(value){if(Array.isArray(value))return value.map(noConsent);if(!value||typeof value!=='object')return value;return Object.fromEntries(Object.entries(value).filter(([k])=>!['licenseAccepted','license_accepted'].includes(k)).map(([k,v])=>[k,noConsent(v)]));}

export class MediaTools{
 constructor(services){Object.assign(this,services);this.uploads=new Map();}
 async verifiedBlob(key,expected=null){
  const path=this.studio.blobPath(key),meta=await loadJSON(path+'.json');
  if(!meta)fail('Upload this media to Studio before registration.','BLOB_NOT_FOUND');
  const info=await stat(path);if(!info.isFile()||info.size!==meta.size)fail('Stored media size changed.');
  const digest=createHash('sha256');for await(const chunk of createReadStream(path))digest.update(chunk);
  const sha=digest.digest('hex');if(sha!==meta.sha||expected?.sha256&&sha!==expected.sha256)fail('Stored media digest changed.');
  return{...meta,path};
 }
 async probe(key,kind,expected=null){
  const meta=await this.verifiedBlob(key,expected);
  let raw;try{raw=await exec(process.env.FFPROBE_BIN||'ffprobe',['-v','error','-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,wav,mp3,flac,ogg,aac,image2,png_pipe,jpeg_pipe,webp_pipe','-show_entries','format=format_name,duration:stream=codec_type,codec_name,width,height,duration,sample_rate,channels','-of','json',meta.path],{timeout:30000,maxBuffer:1024*1024});}catch{fail('FFprobe could not inspect these immutable bytes. Install FFprobe or import a supported PNG/JPEG/WebP, audio, or video file.');}
  const info=JSON.parse(raw.stdout),streams=info.streams||[],video=streams.find(s=>s.codec_type==='video'),audio=streams.find(s=>s.codec_type==='audio'),formats=String(info.format?.format_name||'').split(',');
  let type;
  if(kind==='image'){
   type=imageTypes[video?.codec_name];
   if(!type||audio||!formats.some(f=>['image2','png_pipe','jpeg_pipe','webp_pipe'].includes(f)))fail('The bytes are not a supported still PNG, JPEG or WebP image.');
  }else if(kind==='audio'){
   if(!audio||video)fail('Expected audio-only media, not video or an unmeasured file.');
   type=audioTypes[formats[0]]||(formats.includes('mov')?'audio/mp4':formats.includes('matroska')||formats.includes('webm')?'audio/webm':null);
  }else if(kind==='video'){
   if(!video||imageTypes[video.codec_name]&&formats.some(f=>f.endsWith('_pipe')))fail('Expected actual video bytes.');
   type=formats.includes('mov')?'video/mp4':formats.includes('matroska')||formats.includes('webm')?'video/webm':null;
  }
  if(!type)fail('Unsupported measured media container.');
  const duration=Number(info.format?.duration||audio?.duration||video?.duration);
  if(kind!=='image'&&(!Number.isFinite(duration)||duration<=0||duration>86400))fail('Media has no usable measured duration (maximum one day).');
  if(video&&(!Number.isInteger(video.width)||!Number.isInteger(video.height)||video.width<1||video.height<1||video.width>16384||video.height>16384))fail('Invalid measured image/video dimensions.');
  return{type,size:meta.size,sha256:meta.sha,...(video?{width:video.width,height:video.height}:{}),...(kind!=='image'?{duration}:{}),probe:{method:'ffprobe',streams,format:info.format,measuredAt:new Date().toISOString()}};
 }
 async handle(tool,args){
  if(tool==='references')return this.references(args);
  if(tool==='generation')return this.generation(args);
  throw agentError('UNKNOWN_TOOL','Media tools only own references and generation.');
 }
 async references(args){
  const record=await loadProject(this.studio,args,{write:!readActions.has(args.action)}),p=record.project;
  let result={};
  switch(args.action){
   case'list':return{projectId:p.id,serverRevision:record.serverRevision,assets:p.assets,postMedia:p.postMedia||[],plans:p.referencePlans||[],board:Scenes.board(p)};
   case'inspect':return{projectId:p.id,serverRevision:record.serverRevision,evidenceKind:'metadata-only',pixelsInspected:false,manifests:Scenes.inspect(p,args.windowIds)};
   case'imagePlanPacket':return{system:R.SYSTEM,packet:R.packet(p,args.request),pixelsInspected:false};
   case'register':{
    if(args.destination==='post'&&args.kind==='video')fail('Post videos must be adopted as owned render takes; Post media accepts images and audio.');
    const measured=await this.probe(args.key,args.kind),id=randomUUID();
    const source=await loadJSON(this.studio.blobPath(args.key)+'.json');
    await this.studio.putBlob(id,createReadStream(this.studio.blobPath(args.key)),measured.size,measured.type);
    let asset={id,kind:args.kind,name:args.name,...measured,description:args.description||'',role:args.role||'',transcript:'',missing:false,provenance:{kind:'uploaded-source',uploadKey:args.key,sha256:source.sha,registeredAt:new Date().toISOString()}};
    if(args.destination==='post'){const {provenance,...media}=asset;asset=Post.mediaRecord(media);p.postMedia||=[];p.postMedia.push(asset);}else addAsset(p,asset);
    result={asset};break;
   }
   case'annotate':Scenes.annotate(p,args.assetId,args.value);break;
   case'classify':{const a=assetOf(p,args.assetId);if(a.kind!=='image')fail('Only images have visual reference classifications.');a.referenceKind=args.kind;for(const k of ['description','role'])if(args[k]!==undefined)a[k]=args[k];break;}
   case'assign':Scenes.applySelection(p,args.windowId,args.assetIds);break;
   case'scenes':{const scenes=Scenes.parseScenes(JSON.stringify({scenes:args.scenes}),p);Scenes.setScenes(p,scenes);result={scenes};break;}
   case'applyManifest':{const manifest=Scenes.resolve(p,windowOf(p,args.windowId));if(manifest.sourceStamp!==args.sourceStamp)fail('Reference manifest changed; inspect again.','STALE_MANIFEST');Scenes.applyManifest(p,manifest);result={manifest};break;}
   case'recordInspection':{
    if(args.pixelsInspected!==true)fail('Explicit actual pixel-inspection attestation is required; metadata-only planning is not visual evidence.');
    const a=assetOf(p,args.assetId),blob=await this.verifiedBlob(a.id,a);
    Scenes.recordEvidence(p,windowOf(p,args.windowId),a.id,args.requirementIds,{reason:args.reason,authority:'vision-agent',accepted:args.accepted!==false,review:{kind:'explicit-caller-pixel-attestation',sha256:blob.sha}});break;
   }
   case'planImages':{const plan={...R.parsePlan(JSON.stringify(args.proposal),p),id:randomUUID(),status:'ready',createdAt:new Date().toISOString(),pixelsInspected:false};p.referencePlans||=[];p.referencePlans.push(plan);result={plan};break;}
   case'adoptImage':case'adoptVoice':case'adoptMusic':result=await this.adopt(p,args);break;
   case'toPost':{
    const source=assetOf(p,args.assetId);if(!['audio','image'].includes(source.kind))fail('Only audio/images can be imported into Post media.');
    const measured=await this.probe(source.id,source.kind,source),{provenance,...media}=clone(source);
    // Post's portable media contract supports generated-music provenance only;
    // the original reference retains its full provenance in project.assets.
    const asset=Post.mediaRecord({...media,...measured,...(provenance?.kind==='generated-music'?{provenance}:{})});p.postMedia||=[];
    const old=p.postMedia.find(a=>a.id===asset.id);if(old&&old.sha256!==asset.sha256)fail('Post media ID already owns different bytes.');if(!old)p.postMedia.push(asset);result={asset:old||asset};break;
   }
   case'mergePrepared':{
    const run=await this.referenceAgent.handle({action:'result',id:args.runId});
    if(run.projectId!==p.id&&run.project?.id!==p.id)fail('Reference run belongs to a different project.');
    const next=A.mergeResult(p,run);for(const a of next.assets)await this.verifiedBlob(a.id,a);
    return{record:await saveProject(this.studio,record,noConsent(next)),runId:args.runId};
   }
   case'copyCheckpoint':{
    if(!/^checkpoint_[a-f0-9]{32}$/.test(args.checkpointId))fail('Invalid checkpoint ID.');
    await this.referenceAgent.ready;
    const checkpoint=await loadJSON(join(this.referenceAgent.root,'checkpoints',args.checkpointId+'.json'));
    if(!checkpoint||checkpoint.runId!==args.runId)fail('No owned checkpoint matches this run. Save approved progress through reference_agent first.');
    const next=A.progressCopy(p,checkpoint);for(const a of next.assets)await this.verifiedBlob(a.id,a);
    await loadProject(this.studio,args,{write:true});
    return{record:await createProject(this.studio,noConsent(next)),sourceProjectId:p.id,partial:true};
   }
   default:throw agentError('UNKNOWN_ACTION','Unknown references action.');
  }
  return{record:await saveProject(this.studio,record,p),...result};
 }
 async adopt(p,args){
  const kind=args.action==='adoptImage'?'image':'audio',family=args.action==='adoptImage'?'reference-images':args.action==='adoptVoice'?'reference-voices':'music';
  if([...p.assets,...(p.postMedia||[])].some(a=>a.provenance?.jobId===args.jobId&&a.provenance?.outputId===args.outputId))fail('This output is already adopted; use its existing asset ID.');
  const id=randomUUID(),owned=await copyWorkerOutput({studio:this.studio,backend:this.backend,projectId:p.id,jobId:args.jobId,outputId:args.outputId,key:id});
  const operation=family==='reference-images'?'reference_image':family==='reference-voices'?'reference_voice':'music';
  if(owned.job.operation!==operation)fail('The authoritative worker job is not a '+operation+' operation.');
  const snapshot=owned.metadata.snapshot||(family==='music'?{kind:'music',settings:{}}:null);
  if(snapshot?.kind!==family)fail('The authoritative worker snapshot is not a '+family+' request.');
  if(owned.output.media_kind!==kind)fail('Worker output kind differs from the requested adoption.');
  const measured=await this.probe(id,kind),card=snapshot.cards?.[owned.output.task_index-1];
  const declaredType=({'audio/x-wav':'audio/wav','audio/mp3':'audio/mpeg','audio/x-m4a':'audio/mp4'})[owned.blob.type]||owned.blob.type;
  if(declaredType!==measured.type)fail('Actual media bytes do not match the worker-owned output content type.');
  const asset={id,kind,name:owned.output.name||family,...measured,missing:false,description:card?.description||card?.purpose||'',role:'',transcript:'',provenance:{kind:args.action==='adoptImage'?'generated-image':args.action==='adoptVoice'?'generated-voice':'generated-music',jobId:args.jobId,outputId:args.outputId,model:snapshot.settings?.modelType,requestId:owned.job.request_id,createdAt:new Date().toISOString(),licenseStatus:'unknown',outputClearance:'unknown'}};
  if(args.action==='adoptImage'){
   if(!card)fail('Completed image output has no authoritative plan card.');
   R.applyGenerated(p,asset,card,args.attachWindows===true);
  }else if(args.action==='adoptVoice'){
   const subject=p.subjects.find(s=>s.id===card?.subjectId);if(!subject)fail('Completed voice output has no current owned subject.');
   if(args.bind&&(measured.duration<2||measured.duration>15))fail('Binding needs an actual 2–15 second recording. Adopt without binding, then trim it in Voice workshop.');
   asset.role='Vocal timbre reference only. Do not copy source words.';
   asset.provenance.intendedText=snapshot.settings?.text||'';
   addAsset(p,asset);if(args.bind)subject.voiceAssetId=id;
  }else{Post.mediaRecord(asset);p.postMedia||=[];p.postMedia.push(asset);}
  return{asset,jobId:args.jobId,outputId:args.outputId};
 }
 async discover(family,modelType){
  if(!(family in routes))fail('Unknown generation family.');
  return workerJSON(this.backend,'/'+routes[family]+(modelType?'model?model_type='+encodeURIComponent(modelType):'models'));
 }
 async uploaded(p,ids,{prepare,health,target}){
  const mapping={},missing=[];
  for(const id of new Set(ids)){
   const asset=assetOf(p,id);H.assertGenerationInputs(p,[id]);
   const meta=await loadJSON(this.studio.blobPath(id)+'.json');
   if(!meta)fail('Registered reference bytes are unavailable: '+asset.name);
   // Project JSON is editable by clients: only bridge-observed upload replies are handles.
   const cacheKey=JSON.stringify([p.id,id,target.base,health.instance,meta.sha]),cached=this.uploads.get(cacheKey);
   if(cached){mapping[id]=cached;continue;}
   if(!prepare){missing.push({assetId:id,name:asset.name,reason:'No uploaded handle for these bytes on this configured worker instance.'});continue;}
   const bytes=await this.verifiedBlob(id,asset);
   const extension={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','audio/wav':'.wav','audio/mpeg':'.mp3','audio/flac':'.flac','audio/ogg':'.ogg','audio/aac':'.aac','audio/mp4':'.m4a','audio/webm':'.webm','video/mp4':'.mp4','video/webm':'.webm'}[asset.type];
   if(!extension)fail('Unsupported registered upload MIME type.');
   let response;try{response=await fetch(target.base+'/upload?filename='+encodeURIComponent(id+extension),{method:'POST',headers:{Authorization:'Bearer '+target.token,'Content-Type':asset.type,'Content-Length':String(bytes.size)},body:createReadStream(bytes.path),duplex:'half',redirect:'error',signal:AbortSignal.timeout(12*60*1000)});}catch{throw agentError('OUTCOME_UNKNOWN','Worker upload response was lost. No generation was dispatched and no automatic upload retry was made.',502);}
   const value=await response.json();if(!response.ok||!/^h3media:[a-f0-9]{32}$/.test(value.media_id||''))fail('Worker did not return a valid owned upload handle.');
   this.uploads.set(cacheKey,value.media_id);mapping[id]=value.media_id;
  }
  return{mapping,missing};
 }
 async generation(args){
  if(args.action==='discover')return this.discover(args.family,args.modelType);
  const match=/^(build|prepare)(Video|Images|Voices|Music)$/.exec(args.action);if(!match)throw agentError('UNKNOWN_ACTION','Unknown generation action.');
  const prepare=match[1]==='prepare',family=FAMILY[match[2]],record=await loadProject(this.studio,args,{write:prepare}),original=record.project;
  let p=original;
  if(family==='video'&&args.windowIds){
   if(args.context!=='fresh'||!['linked','independent'].includes(args.strategy))fail('Selected-window generation requires an explicit fresh context and linked/independent strategy. Existing footage is never silently used as a prefix.');
   Selection.review(original,args.windowIds,{strategy:args.strategy,context:args.context});
   p=Selection.snapshot({...original,jobs:[],variants:[],voiceWorkshops:[]},args.windowIds,{strategy:args.strategy,seed:original.seed});
  }else if(args.context!==undefined||args.strategy!==undefined)fail('Selection context and strategy require windowIds.');
  if(!safeID(args.requestId))fail('Choose and retain a stable request ID.');
  if(prepare&&original.agentGenerationRequests?.some(r=>r.requestId===args.requestId))throw agentError('REQUEST_ALREADY_PREPARED','This request ID already has durable preparation. Inspect the exact worker request or render intent; do not prepare or dispatch it again.',409,{request:original.agentGenerationRequests.find(r=>r.requestId===args.requestId)});
  const modelType=family==='video'?p.modelType:family==='image'?args.settings.modelType:args.modelType;
  const [info,health,target]=await Promise.all([this.discover(family,modelType),workerJSON(this.backend,'/health'),this.backend.target()]);
  if(!health.instance)fail('Worker does not report a stable instance identifier.');
  if(info.metadata?.model_type!==modelType)fail('Discovered model identity does not match the selected preset.');
  let tasks=[],snapshot,plan,missing=[],intent=null;
  if(family==='video'){
   const profile=info.director_profile||info.profile;
   if(profile?.inference_mode!==p.inferenceMode)fail('Saved inference mode differs from the actual discovered video profile. Configure the project explicitly.');
   const issues=H.validate(p,true).filter(i=>i.level==='error');if(issues.length)throw agentError('PROJECT_NOT_RENDERABLE','Resolve the saved project validation errors before preparation.',400,{issues});
   const settings=H.inferenceSettings(p);if(!profile.samplers?.includes(settings.sample_solver)||!Number.isInteger(settings.num_inference_steps)||settings.num_inference_steps<1||settings.num_inference_steps>200||!Number.isInteger(settings.guidance_phases)||settings.guidance_phases<1||settings.guidance_phases>profile.max_phases)fail('Saved inference settings do not match the discovered model profile.');
   const used=[...H.mediaIds(p)];
   const caps=health.capabilities||{};if(p.windows.some(w=>w.soundtrack?.assetId)&&caps.soundtrack_slices!==1)fail('Kept soundtracks need a worker with the soundtrack_slices capability. Restart the WanGP worker on this orch3stra version.');
   if(p.windows.some(w=>H.pool(p,w).filter(a=>a.kind==='audio').length>2)&&caps.audio_references!==3)fail('Three voice references need a worker with the audio_references=3 capability. Restart the WanGP worker on this orch3stra version.');
   if(p.mode==='managed'){
    if(health.capabilities?.bounded_continuation!==1)fail('Managed video requires the actual worker bounded-continuation capability.');
    if(prepare)for(const id of used)await this.verifiedBlob(id,assetOf(p,id));
   }else{
    const uploaded=await this.uploaded(p,used,{prepare,health,target});missing=uploaded.missing;
    if(!missing.length)tasks=H.tasks(p,id=>uploaded.mapping[id]||fail('Missing owned upload handle.'));
   }
   snapshot=noConsent({...p,jobs:[],variants:[],voiceWorkshops:[]});plan=H.renderPlan(p);
  }else if(family==='image'){
   if(args.licenseAccepted!==true)fail('Acknowledge this image model license separately for this request.');
   if(!health.capabilities?.reference_images||info.profile?.kind!=='reference_image')fail('Configured worker does not support this image model.');
   const saved=p.referencePlans?.find(plan=>plan.id===args.planId),cards=args.cardIds.map(id=>saved?.images.find(c=>c.id===id));
   if(!cards.length||cards.some(c=>!c))fail('Choose existing cards from this project’s saved image plan.');
   R.parsePlan(JSON.stringify({images:cards}),p);
   const acceleration=args.settings.accelerationProfile?info.image_profiles?.find(row=>row.id===args.settings.accelerationProfile):null;
   if(args.settings.accelerationProfile&&!acceleration)fail('Accelerator profile is not in the discovered model profile list. Arbitrary LoRA paths are not accepted.');
   if(args.settings.cameraLora&&!info.profile?.camera_loras?.some(row=>row.id===args.settings.cameraLora&&row.installed))fail('Camera LoRA '+args.settings.cameraLora+' is not installed or not reported by this worker. Arbitrary LoRA paths are not accepted.');
   const settings={...args.settings,steps:acceleration?.steps??args.settings.steps??info.profile.default_steps,guidance:acceleration?.guidance??args.settings.guidance??info.profile.default_guidance,imageProfile:info.profile,licenseAccepted:true};
   const [width,height]=(settings.resolution||'1024x1024').split('x').map(Number);if([width,height].some(n=>!Number.isInteger(n)||n<256||n>2048||n%32))fail('Image resolution dimensions must be multiples of 32 from 256 to 2048.');
   if(cards.some(c=>c.referenceIds.length>info.profile.max_references))fail('Selected cards exceed the discovered model reference capacity.');
   const uploaded=await this.uploaded(p,cards.flatMap(c=>c.referenceIds),{prepare,health,target});missing=uploaded.missing;
   if(!missing.length)tasks=cards.map(card=>R.task(card,settings,uploaded.mapping));
   snapshot={kind:'reference-images',cards:clone(cards),settings:noConsent(settings)};
  }else if(family==='voice'){
   if(!health.capabilities?.reference_voices||info.profile?.kind!=='reference_voice')fail('Configured worker does not support voice design.');
   if(!info.profile.languages?.includes(args.language))fail('Selected voice language is not in the discovered profile.');
   const text=assertLiteral(args.text,'Audition text'),cards=args.subjectIds.map(id=>{const s=p.subjects.find(s=>s.id===id);if(!s||['place','prop'].includes(s.kind))fail('Voice design requires existing character subjects.');return{subjectId:id,name:s.name,description:assertLiteral(s.voiceDesign,'Saved subject voice description')};});
   const settings={modelType,text,language:args.language,seconds:args.seconds,seed:args.seed??-1};
   tasks=cards.map(c=>({mode:'reference_voice',model_type:modelType,prompt:text,alt_prompt:c.description,model_mode:args.language,duration_seconds:args.seconds,seed:args.seed??-1}));snapshot={kind:'reference-voices',cards,settings};
  }else{
   if(!health.capabilities?.music||info.profile?.kind!=='music')fail('Configured worker does not support native music.');
   if(/\binstrumental(?:[ -]only)?\b|\bno vocals\b|\bwithout vocals\b/i.test(args.style))fail('This native route generates vocal songs with original lyrics, not verified instrumental-only music.');
   const settings={modelType,lyrics:args.lyrics,style:args.style,seconds:args.seconds,seed:args.seed};
   tasks=[{mode:'music',model_type:modelType,prompt:args.lyrics.trim(),alt_prompt:args.style.trim(),duration_seconds:args.seconds,seed:args.seed,num_inference_steps:32}];snapshot={kind:'music',settings};
  }
  const body={request_id:args.requestId,project_id:p.id,project:p.name,tasks,snapshot,...(plan?{plan}:{})};
  if(!prepare)return{projectId:p.id,serverRevision:record.serverRevision,requestId:args.requestId,model:info.metadata,profile:info.profile,ready:false,packet:missing.length?null:family==='video'&&p.mode==='managed'?{project:snapshot}:body,missingUploads:missing,nextAction:'prepare'+match[2],reason:missing.length?'Explicit network-authorized preparation must upload the listed sources.':'Review the packet, then prepare with expectedRevision to durably own this request before dispatch.'};
  // Store only identity/fingerprint, never request license consent, credentials or upload tokens.
  const request={requestId:args.requestId,family,workerInstance:health.instance,target:hash(target.base),digest:hash(JSON.stringify(body)),status:'prepared',createdAt:new Date().toISOString()};
  const commit=async()=>{
   if(family==='video'){
    // Serialize agent admissions across owners/projects: a new run may supersede
    // an owner's lease. Recheck CAS before begin-session can cancel that lease.
    await loadProject(this.studio,args,{write:true});
    const session=await this.renderIntents.handle({action:'begin-session',owner:args.owner,runId:args.runId});
    intent=await this.renderIntents.handle({action:'prepare',owner:args.owner,lease:session.lease,projectId:p.id,mode:p.mode,requestId:args.requestId,destination:target.base});
   }
   original.agentGenerationRequests||=[];original.agentGenerationRequests.push(request);
   let saved;
   try{saved=await saveProject(this.studio,record,original);}
   catch(error){
    if(intent){
     // Only a returned, newly admitted intent belongs to this operation.
     // Cancel never rolls back attempted/uncertain dispatch or frees its ID.
     let cancelled,cleanupError;
     try{cancelled=await this.renderIntents.handle({action:'cancel',id:intent.id});}catch(e){cleanupError=e.message;}
     error.details={...error.details,intent:cancelled||intent,...(cleanupError?{cleanupError}:{})};
     error.message+=' Render preparation did not commit. Inspect intent '+intent.id+'; this request ID is consumed and must not be replayed.';
    }
    throw error;
   }
   if(intent){
    // Native sessions may supersede us while the project save awaits I/O.
    // Keep the durable no-replay marker, but never return a dispatch operation
    // for an intent already known to be cancelled or attempted.
    const current=await this.renderIntents.handle({action:'get',id:intent.id});
    if(current.state!=='prepared'||current.lease!==intent.lease)throw agentError('PREPARATION_INVALIDATED','Render preparation changed before commit completed. Inspect this exact intent; no dispatch operation or replay is authorized.',409,{intent:current,request,serverRevision:saved.serverRevision});
   }
   return saved;
  };
  const saved=family==='video'?await this.studio.serialize('agent-video-preparation',commit):await commit();
  const operation=family==='video'&&p.mode==='managed'?{tool:'sequence',arguments:{action:'start',project:snapshot,intent:{id:intent.id,lease:intent.lease}}}:{tool:'worker',arguments:{path:'/generate',method:'POST',body,...(intent?{intent:{id:intent.id,lease:intent.lease},renderMode:p.mode}:{})}};
  return{record:saved,requestId:args.requestId,workerInstance:health.instance,ready:true,operation,...(intent?{intent}:{ }),requiredDispatchEffects:operation.tool==='sequence'?['network','cpu','gpu','provider']:['network','cpu','gpu'],reconciliation:family==='video'?{tool:'render_intent',arguments:{action:'get',id:intent.id}}:{tool:'worker',arguments:{path:'/requests/'+args.requestId,method:'GET'}},warning:'Preparation is not dispatch. Submit once through the returned existing service operation only after explicit approval. A lost response requires exact reconciliation, never automatic replay.'};
 }
}
