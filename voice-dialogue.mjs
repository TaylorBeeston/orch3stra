/** Multi-speaker dialogue: one Fish Drama 3 WAV from a "Speaker N: [direction] line" script, saved as a
 * project audio asset. Client-side composition of generation.discover / prepareDialogue, one worker
 * /generate, job_wait and references.adoptVoice (bind:false). Submitted work is never retried.
 */
import {randomUUID,createHash} from 'node:crypto';
import {AgentError} from './agent-client.mjs';
import {toolDefinition,validateArguments} from './agent-catalog.mjs';
import {DEFAULT_DIALOGUE_MODEL,dialogueRequest} from './dialogue-core.mjs';

const fail=(code,message,details)=>{throw new AgentError(code,message,details);};
const placeholder=id=>'h3media:'+createHash('sha256').update('dialogue-dry-run:'+id).digest('hex').slice(0,32);

export async function voiceDialogue(client,args){
 const allow=args._allow||[],dryRun=args.dryRun===true,model=args.model||DEFAULT_DIALOGUE_MODEL;
 const requestId=args.requestId||('dialogue_'+randomUUID().replaceAll('-',''));
 const progress={requestId,stage:'project'};
 const call=(tool,input)=>client.call(tool,{...input,_allow:allow});
 const options={modelType:model,script:args.script,voiceAssetIds:args.voiceAssetIds||[],transcripts:args.transcripts,seconds:args.seconds??60,seed:args.seed??-1};
 try{
  let record=await call('project',{action:'get',projectId:args.projectId});
  const p=record.project;
  progress.stage='validate';
  let built;
  try{built=dialogueRequest({...options,project:p,uploaded:Object.fromEntries(options.voiceAssetIds.map(id=>[id,placeholder(id)]))});}
  catch(e){if(e.code==='INVALID_DIALOGUE')fail('INVALID_ARGUMENTS',e.message);throw e;}
  progress.stage='discover';
  const unsupported=detail=>fail('MODEL_UNSUPPORTED','The worker does not expose '+model+' as a Fish Drama 3 dialogue preset'+(detail?': '+detail:'.')+' Dialogue needs the bridge and worker on this orch3stra version (restart them when idle). Nothing was uploaded.');
  let info;
  try{info=await call('generation',{action:'discover',family:'voice',modelType:model});}catch(e){unsupported(e?.message);}
  if(info.metadata?.model_type!==model||info.profile?.kind!=='reference_voice'||info.profile.script!==true)unsupported(info.profile?.architecture?'it reports architecture '+info.profile.architecture+' without script support':'');
  if(options.voiceAssetIds.length>info.profile.max_voice_references)fail('INVALID_ARGUMENTS',model+' accepts '+info.profile.max_voice_references+' voice references.');
  const summary={model:{modelType:model,name:info.metadata.name,profile:info.profile},speakers:built.speakers,audioPromptType:built.audioPromptType,voices:built.voices};
  if(dryRun){
   const request={path:'/generate',method:'POST',body:{request_id:requestId,project_id:p.id,project:p.name,tasks:[built.task],snapshot:built.snapshot}};
   validateArguments(toolDefinition('worker'),request);
   return{dryRun:true,submitted:false,projectId:p.id,serverRevision:record.serverRevision,...summary,workerRequest:request,requiredEffects:['network','cpu','gpu'],
    steps:['generation.prepareDialogue (uploads voice references to the worker; persists the request ID)','worker POST /generate once (gpu)','job_wait worker','references.adoptVoice with bind:false'],
    note:'Dry run: nothing was uploaded, saved or submitted. voices hold placeholders; preparation replaces them with worker-owned h3media upload IDs. Run again without dryRun and with _allow network,cpu,gpu after explicit GPU approval.'};
  }
  progress.stage='prepare';
  const {modelType,...rest}=options;
  const prepared=await call('generation',{action:'prepareDialogue',projectId:p.id,expectedRevision:record.serverRevision,requestId,modelType,script:rest.script,voiceAssetIds:rest.voiceAssetIds,...(rest.transcripts?{transcripts:rest.transcripts}:{}),seconds:rest.seconds,seed:rest.seed});
  if(!prepared.ready||prepared.operation?.tool!=='worker')fail('PREPARATION_INCOMPLETE','The studio did not return a worker dispatch operation.',{prepared});
  record=prepared.record;progress.reconciliation=prepared.reconciliation;
  progress.stage='dispatch';
  const job=await call('worker',prepared.operation.arguments);
  const jobId=job.job_id;progress.jobId=jobId;
  const adopt=outputId=>({tool:'references',arguments:{action:'adoptVoice',projectId:p.id,expectedRevision:'<current serverRevision from project get>',jobId,outputId:outputId||'<audio output id from the completed job>',bind:false}});
  if(args.wait===false)return{outcome:'submitted',submitted:true,projectId:p.id,requestId,jobId,status:job.status,next:{wait:'node orch3stra.mjs wait worker '+jobId+' --allow network',adopt:adopt()}};
  progress.stage='wait';
  const waited=await call('job_wait',{tool:'worker',id:jobId,timeoutMs:args.timeoutMs??1800000,intervalMs:3000});
  if(waited.outcome!=='completed')return{outcome:waited.outcome,submitted:true,projectId:p.id,requestId,jobId,status:waited.status,result:waited.result,next:{wait:'node orch3stra.mjs wait worker '+jobId+' --allow network',adopt:adopt()},warning:'Do not resubmit. Wait on this job ID, then adopt its output.'};
  const output=(waited.result.outputs||[]).find(o=>o.media_kind==='audio'&&o.available!==false);
  if(!output)return{outcome:'attention',submitted:true,projectId:p.id,requestId,jobId,status:waited.status,result:waited.result,message:'The job completed without an available audio output. Inspect the job; nothing was adopted.'};
  progress.stage='adopt';progress.outputId=output.id;
  record=await call('project',{action:'get',projectId:p.id});
  const adopted=await call('references',{...adopt(output.id).arguments,expectedRevision:record.serverRevision});
  const asset=adopted.asset;
  return{outcome:'completed',projectId:p.id,serverRevision:adopted.record.serverRevision,assetId:asset.id,asset:{id:asset.id,name:asset.name,number:asset.number,type:asset.type,duration:asset.duration,sha256:asset.sha256},mediaUrl:'/api/studio-blob?key='+asset.id,jobId,outputId:output.id,requestId,...summary,
   next:'Listen before relying on it. To keep it as a window soundtrack: node orch3stra.mjs soundtrack set --json {"projectId":"'+p.id+'","expectedRevision":'+adopted.record.serverRevision+',"windowIds":["<window>"],"assetId":"'+asset.id+'"}.'};
 }catch(caught){
  const error=caught?.code?caught:new AgentError('INVALID_ARGUMENTS',caught?.message||String(caught));
  error.details={...(error.details||{}),dialogue:{...progress}};
  if(['dispatch','wait','adopt'].includes(progress.stage)||error.code==='OUTCOME_UNKNOWN')error.details.dialogue.warning='Work may already be submitted. Do not rerun this request; reconcile with '+JSON.stringify(progress.reconciliation||{tool:'worker',arguments:{path:'/requests/'+requestId,method:'GET'}})+'.';
  throw error;
 }
}
