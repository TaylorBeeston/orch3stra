/** Shared state/ownership operations for agent tools; StudioStore remains the only project writer. */
import {createRequire} from 'node:module';
import {Readable} from 'node:stream';
import {safeID} from './studio-server.mjs';
const require=createRequire(import.meta.url),H=require('./core.js');

export function agentError(code,message,status=400,details={}){return Object.assign(Error(message),{code,status,details});}
export async function loadProject(studio,args,{write=false}={}){
  await studio.ready;
  if(!safeID(args.projectId))throw agentError('INVALID_PROJECT_ID','Supply an existing server-published projectId.');
  const record=await studio.getProject(args.projectId);
  if(!record)throw agentError('PROJECT_NOT_FOUND','No published project has this ID. Publish browser-only work through Studio first, or create a server project.',404,{projectId:args.projectId});
  if(write){
    if(!Number.isSafeInteger(args.expectedRevision)||args.expectedRevision<1)throw agentError('REVISION_REQUIRED','Every existing-project edit needs expectedRevision from the latest project.get serverRevision.');
    if(record.serverRevision!==args.expectedRevision)throw agentError('REVISION_CONFLICT','The published project changed. Read the current version and review/rebase your edit; nothing was overwritten.',409,{projectId:args.projectId,currentRevision:record.serverRevision,expectedRevision:args.expectedRevision});
  }
  return record;
}
export async function saveProject(studio,record,project){
  if(project.id!==record.id)throw agentError('PROJECT_ID_CHANGED','An edit cannot change project ownership. Create a separate project for a new copy.');
  const next=H.normalizeProject({...project,revision:(Number(record.project.revision)||0)+1,updatedAt:new Date().toISOString()});
  try{return await studio.putProject(next,record.serverRevision);}
  catch(error){if(error.status===409){const current=await studio.getProject(record.id);throw agentError('REVISION_CONFLICT','The published project changed during this operation. Read and review the new version; nothing was overwritten.',409,{projectId:record.id,currentRevision:current?.serverRevision,expectedRevision:record.serverRevision});}throw error;}
}
export async function createProject(studio,project){await studio.ready;return studio.putProject(H.normalizeProject(project),null);}
export async function workerJSON(backend,path,{method='GET',body}={}){
  if(!path.startsWith('/')||path.startsWith('//')||path.includes('..')||/[\r\n#]/.test(path))throw agentError('INVALID_WORKER_PATH','Use a worker-relative API path.');
  const target=await backend.target();let response;
  try{response=await fetch(target.base+path,{method,headers:{Authorization:'Bearer '+target.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(120000)});}
  catch(error){throw agentError(method==='GET'?'WORKER_UNAVAILABLE':'OUTCOME_UNKNOWN',method==='GET'?'Cannot observe the configured renderer: '+error.message:'Renderer request outcome is unknown. Inspect this exact request ID; no retry was made.',502,{path});}
  let data;try{data=await response.json();}catch{throw agentError(method==='GET'?'INVALID_WORKER_RESPONSE':'OUTCOME_UNKNOWN','Renderer returned incomplete JSON; inspect its state before taking further action.',502,{path});}
  if(!response.ok)throw agentError(data.code||'WORKER_REJECTED',typeof data.error==='string'?data.error:'Renderer returned HTTP '+response.status,response.status,{path});
  return data;
}
export async function copyWorkerOutput({studio,backend,projectId,jobId,outputId,key}){
  if(!safeID(projectId)||!safeID(jobId)||!/^[a-f0-9]{32}$/.test(outputId||'')||!safeID(key))throw agentError('INVALID_MEDIA_ID','Supply owned project/job/output IDs and an immutable media key.');
  const job=await workerJSON(backend,'/jobs/'+encodeURIComponent(jobId));
  const metadata=await workerJSON(backend,'/jobs/'+encodeURIComponent(jobId)+'/metadata');
  if(job.status!=='completed'||job.job_id!==jobId)throw agentError('OUTPUT_NOT_READY','Adoption requires the exact completed worker job.');
  if(metadata.project_id!==projectId||job.project_id&&job.project_id!==projectId)throw agentError('FOREIGN_OUTPUT','This worker output does not belong to the selected project.',403);
  const output=job.outputs?.find(row=>row.id===outputId&&row.available===true);
  if(!output)throw agentError('OUTPUT_NOT_AVAILABLE','The chosen output is not available in this completed job.');
  const target=await backend.target();
  const response=await fetch(target.base+'/jobs/'+encodeURIComponent(jobId)+'/outputs/'+outputId,{headers:{Authorization:'Bearer '+target.token},redirect:'error',signal:AbortSignal.timeout(12*60*1000)});
  if(!response.ok||!response.body)throw agentError('OUTPUT_DOWNLOAD_FAILED','The owned output could not be downloaded (HTTP '+response.status+').',502);
  const length=Number(response.headers.get('content-length')),type=String(response.headers.get('content-type')||'').split(';')[0];
  if(!Number.isSafeInteger(length)||length<1||length>2*1024**3||! /^(image|audio|video)\//.test(type))throw agentError('INVALID_OUTPUT','Owned output must be real image/audio/video bytes with a known size up to 2 GiB.');
  if(output.content_type&&output.content_type!==type)throw agentError('OUTPUT_TYPE_CHANGED','Worker output content type differs from its recorded metadata.');
  const blob=await studio.putBlob(key,Readable.fromWeb(response.body),length,type);
  if(output.sha256&&output.sha256!==blob.sha)throw agentError('OUTPUT_HASH_CHANGED','Downloaded output does not match its recorded digest; no project adoption performed.');
  return {job,metadata,output,blob:{...blob,type}};
}
