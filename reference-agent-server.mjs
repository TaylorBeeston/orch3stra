/** Durable, bounded reference preparation. One worker queue; no browser-driven dispatch.
 * Every provider/GPU request is checkpointed before sending. Restart never blindly retries.
 */
import {mkdir,readdir,readFile,stat,rm} from 'node:fs/promises';
import {createWriteStream,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {atomicJSON,loadJSON,safeID} from './studio-server.mjs';
const require=createRequire(import.meta.url),H=require('./core.js'),R=require('./scene-core.js'),D=require('./doctor-core.js'),A=require('./reference-agent-core.js'),Refs=require('./reference-core.js'),E=require('./edit-core.js');
const exec=promisify(execFile),now=()=>new Date().toISOString(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Findings the coverage run either fixes itself (missing images) or that only matter at render time (audio limits, checked again before sending).
const NON_BLOCKING=new Set(['missing-coverage','voice-capacity','voice-duration']);
const DONE=new Set(['completed','cancelled','failed']),NATIVE_DONE=new Set(['completed','cancelled','failed']);
function promptSplitFailure(native){
 const errors=(native?.errors||[]).map(e=>typeof e==='string'?e:e?.message||'').join('\n');
 return native?.status==='failed'&&!native.outputs?.length&&!native.generated_files?.length&&/multi_prompts_gen_type=['\"](?:PG|G)['\"]/.test(errors)&&/parses this prompt into (?:[2-9]|[1-9][0-9]+) separate generation requests/.test(errors)&&/accepts one generation task/.test(errors);
}
class Parked extends Error {constructor(message,code='NEEDS_REVIEW'){super(message);this.code=code;}}
function noSecrets(value){return JSON.parse(JSON.stringify(value,(k,v)=>['key','token','hfToken','password','apiKey'].includes(k)?undefined:v));}
export class ReferenceAgent {
 constructor(store,sequences,ai,{pollMs=1000,fetchImpl=fetch,mediaTools=null}={}){
  this.store=store;this.sequences=sequences;this.ai=ai;this.root=join(store.root,'reference-agent');this.pollMs=pollMs;this.fetch=fetchImpl;this.mediaTools=mediaTools;
  this.runs=new Map();this.work=new Map();this.credentials=new Map();this.closed=false;this.ready=this.init();
 }
 async init(){await this.store.ready;await mkdir(this.root,{recursive:true,mode:0o700});
  for(const name of await readdir(this.root)){if(!name.endsWith('.json'))continue;const r=await loadJSON(join(this.root,name));if(!r||!safeID(r.id))continue;
   if(!DONE.has(r.status)){if(r.activeSince){r.elapsedMs=(r.elapsedMs||0)+Math.max(0,(Date.parse(r.updatedAt)||r.activeSince)-r.activeSince);r.activeSince=null;}r.status='paused';r.message='Director restarted. Resume explicitly to reconcile saved AI/image requests; no automatic retry.';r.pausedReason='restart';await this.save(r);}
   this.runs.set(r.id,r);
  }
 }
 path(id){if(!safeID(id))throw Error('Invalid agent ID.');return join(this.root,id+'.json');}
 async save(r){r.updatedAt=now();return this.store.serialize('reference-agent:'+r.id,()=>atomicJSON(this.path(r.id),noSecrets(r)));}
 event(r,kind,message,data={}){r.events=[...(r.events||[]),{at:now(),kind,message,...noSecrets(data)}].slice(-300);r.message=message;}
 get(id){const r=this.runs.get(id);if(!r)throw Object.assign(Error('Reference-agent run not found.'),{status:404});return r;}
 view(r,details=false){let blockers=r.blockers||[],message=r.message;const w=r.project?.windows?.find(w=>w.id===r.windowIds?.[r.index]);if(w&&!DONE.has(r.status)&&(r.pausedReason==='MANIFEST_CONFLICT'||/A pinned or explicitly named image is missing/.test(message||''))){try{const m=R.resolve(r.project,w);blockers=m.issues.map(i=>({...i,windowId:w.id,windowTitle:w.title,sourceStamp:m.sourceStamp}));blockers.sort((a,b)=>NON_BLOCKING.has(a.code)-NON_BLOCKING.has(b.code));const stop=blockers.find(i=>!NON_BLOCKING.has(i.code));if(stop)message=stop.message+(blockers.length>1?' ('+(blockers.length-1)+' other findings in conflict details.)':'');else if(r.pausedReason==='MANIFEST_CONFLICT')message='Nothing blocks this window any more. Choose Continue / reconcile to resume; completed work is kept.';}catch{}}return noSecrets({id:r.id,projectId:r.projectId,ownerSequenceId:r.ownerSequenceId,name:r.name,status:r.status,phase:r.phase,index:r.index,total:r.windowIds.length,windowId:r.windowIds[r.index],message,error:r.error,createdAt:r.createdAt,updatedAt:r.updatedAt,sourceStamp:r.sourceStamp,blockers,labelReviews:r.labelReviews||[],application:r.application||null,windowIds:r.windowIds,usage:r.usage,policy:r.policy,aiIds:r.aiIds,pending:r.pending,candidates:r.candidates,events:r.events?.slice(-40),lastAI:this.latestAI(r),planRecovery:this.planRecovery(r),imageRecovery:this.imageRecovery(r),inspectionRecovery:this.inspectionRecovery(r),candidateReview:this.candidateReview(r),budgetState:this.budgetState(r),savedProgress:this.progressInfo(r),pausedReason:r.pausedReason,native:r.native?{job_id:r.native.job_id,status:r.native.status,progress:r.native.progress,message:r.native.message}:null,...(details?{project:r.project,windows:r.windows,manifests:r.manifests,events:r.events,planner:r.planner,lastPlan:r.lastPlan||null,planFailure:r.planFailure||null,planRepairHistory:r.planRepairHistory||[],imageRetryHistory:r.imageRetryHistory||[],lastInspection:r.lastInspection||null,inspectionFailure:r.inspectionFailure||null,inspectionHistory:r.inspectionHistory||[],lastAIRequest:this.lastAIRequest(r)}:{} )});}
 // A completed response rejected by our validator is not a running provider request.
 latestAI(r){try{const j=this.ai.get(r.lastAI?.id);const {text,request,context,events,...meta}=this.ai.view(j);return meta;}catch{return r.lastAI;}}
 lastAIRequest(r){try{return this.ai.view(this.ai.get(r.lastAI?.id),true);}catch{return null;}}
 planKey(r,step){return 'w'+r.index+'_plan'+step.round+(step.planRevision?'_fix'+step.planRevision:'');}
 validatePlan(r,w,raw,attachedIds,frames=[]){
  const d=A.decision(raw,r.project,w,attachedIds,{frames});
  if(d.action==='ready'){const m=R.resolve(r.project,w);if(!m.imageReady)throw Error('The planner said ready but these requirements remain unresolved: '+m.issues.filter(i=>!NON_BLOCKING.has(i.code)||i.code==='missing-coverage').map(i=>i.message).slice(0,3).join(' '));}
  if(['inspect','reuse_reference'].includes(d.action)&&d.inspectIds.length>r.policy.maxInspectionImages)throw Error('The inspection selection exceeds this run’s image budget. Request a smaller batch.');
  if(d.action==='need_reference'&&d.request.subjectId){
   const req=d.request,anchors=R.candidates(r.project,w).filter(a=>a.annotation.approved&&a.annotation.subjectIds.includes(req.subjectId));
   if(!req.sourceIds.some(id=>anchors.some(a=>a.id===id))&&(anchors.length||!r.policy.allowNewIdentity))throw Error(anchors.length?'Use an approved identity anchor alongside rendered context; existing identity cannot be replaced.':'No approved identity anchor exists. Enable original identity creation deliberately before creating the first appearance.');
  }
  return d;
 }
 planRecovery(r){
  if(DONE.has(r.status)||r.pending||r.cancelRequested||!['paused','needs_review'].includes(r.status))return null;
  const w=r.project?.windows.find(w=>w.id===r.windowIds[r.index]),step=w&&r.windows?.[w.id];if(!w||!step)return null;
  const key=this.planKey(r,step),call=r.calls?.[key],id=call?.id||r.lastPlan?.requestId||r.lastAI?.id;
  if(!r.planFailure&&!/Generated coverage must preserve|Agent attempted to change the required character state/.test(r.error||r.message||''))return null;
  let job;try{job=this.ai.get(id);}catch{}
  const raw=(job?.status==='completed'?job.text:call?.phase==='completed'?call.text:undefined)??((r.lastPlan?.callKey||r.lastPlan?.key)===key?r.lastPlan.raw:undefined);
  const stamp=R.fingerprint({window:R.stamp(r.project,w),key,id,raw:raw??null});
  if(typeof raw!=='string')return{kind:'unavailable',requestId:id||null,stamp,windowId:w.id,windowTitle:w.title,message:'The saved planning response is unavailable or not completed. Open its AI request; no replacement request will be sent automatically.'};
  const attached=job?.request?.images?.filter(i=>i.attached!==false).map(i=>i.label.split(' · ')[0])||r.lastPlan?.attachedIds||step.inspectedIds||[];
  const frames=Object.values(r.contextFrames||{}).flat();
  try{
   const d=this.validatePlan(r,w,raw,attached,frames);
   return {kind:'revalidate',requestId:id,stamp,windowId:w.id,windowTitle:w.title,message:'The saved plan can be revalidated without another planning request. Continue this run; finished windows, images and spent allowance stay intact.',bindingChanges:d.request?.bindingChanges||[]};
  }catch(e){
   return {kind:'repair',requestId:id,stamp,windowId:w.id,windowTitle:w.title,message:e.message,previousError:r.error||null,requirements:R.requirements(r.project,w).needs,rawPreview:raw.slice(0,16000),canRetry:!this.work.has(r.id)&&!(r.gpu&&!r.gpu.terminal),instructions:'Ask the planner to repair only this step. This is one new planning call within the existing budget; it does not restart completed windows or bypass validation.'};
  }
 }
 imageRecovery(r){
  if(DONE.has(r.status)||r.cancelRequested||!['paused','needs_review'].includes(r.status)||r.pending?.kind!=='generation'||!r.gpu?.terminal||r.gpu.jobId!==r.native?.job_id||!promptSplitFailure(r.native))return null;
  const task=r.gpu.payload?.tasks?.[0],w=r.project.windows.find(w=>w.id===r.windowIds[r.index]);
  if(!w||r.gpu.payload?.tasks?.length!==1||task?.mode!=='reference_image'||typeof task.prompt!=='string')return null;
  return {kind:'prompt-mode',stamp:R.fingerprint({window:R.stamp(r.project,w),gpu:r.gpu,pending:r.pending,native:{id:r.native.job_id,status:r.native.status,errors:r.native.errors}}),windowId:w.id,windowTitle:w.title,jobId:r.gpu.jobId,requestId:r.gpu.requestId,
   canRetry:!this.work.has(r.id),message:'WanGP treated paragraphs inside one image prompt as separate jobs. The failed job produced no output. Update the idle worker to 1.9.2, then retry only this saved image request in full-prompt (FG) mode. No new planning call is required.',promptPreview:task.prompt};
 }
 async requireImageWorker(){
  const h=await this.sequences.api({backendMode:this.sequences.backendMode},'/health');
  if(h.capabilities?.reference_image_prompt_mode!=='FG')throw new Parked('Qwen images need the single-prompt fix in worker 1.9.2. When GPU work is idle, stop Director, run node start-headless.mjs --stop from the new release, then node start-headless.mjs. Existing references and this run are retained.','IMAGE_WORKER_UPGRADE');
 }
 async retryImage(r,b){
  return this.store.serialize('reference-agent-retry:'+r.id,async()=>{
   if(b.confirm!==true||this.work.has(r.id)||r.cancelRequested)throw Error('Pause this run and explicitly confirm the image retry.');
   const recovery=this.imageRecovery(r);if(!recovery)throw Error('No confirmed prompt-splitting failure is available to retry. Refresh and reconcile the existing image job.');
   if(b.recoveryStamp!==recovery.stamp)throw Error('The failed image request changed. Refresh before retrying.');
   const owner=r.ownerSequenceId?this.sequences.runs.get(r.ownerSequenceId):null;
   if(r.ownerSequenceId&&(!owner||owner.cancelRequested||['completed','cancelled','failed','retired'].includes(owner.status)))throw Error('The parent sequence cannot continue. Its saved image work was not changed.');
   const native=await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+r.gpu.jobId);
   if(native.job_id!==r.gpu.jobId||!promptSplitFailure(native))throw Error('The worker did not confirm this failed, output-free prompt-splitting job. No retry submitted.');
   if(!r.policy.allowImages||!r.policy.vision||!r.planner.vision)throw Error('Enable image generation and visual review in this run’s settings before retrying.');
   await this.requireImageWorker();this.budget(r,'images');
   const w=r.project.windows.find(w=>w.id===recovery.windowId),step=r.windows[w.id];
   if(step.attempts>=A.attemptLimit(r.policy,step))throw Error('Per-window image-attempt budget reached. Increase the limit explicitly in this run’s settings before retrying; previous attempts still count.');
   A.assertTargetCurrent(r.pending.request,r.project,w);
   const retryTask=H.clone(r.gpu.payload.tasks[0]);retryTask.multi_prompts_gen_type='FG';
   if(!Array.isArray(retryTask.image_refs)||retryTask.image_refs.length!==r.pending.request.sourceIds.length)throw Error('Saved image source order is inconsistent. No retry submitted.');
   const config=b.planner?this.planner(b.planner,true):null;
   if(this.work.has(r.id)||r.cancelRequested||this.imageRecovery(r)?.stamp!==b.recoveryStamp||owner?.cancelRequested)throw Error('The run changed while checking the worker. No image retry submitted; refresh its state.');
   // Atomic checkpoint before clearing the failed handle. History and old request ID remain.
   r.imageRetryHistory=[...(r.imageRetryHistory||[]),{at:now(),windowId:w.id,gpu:H.clone(r.gpu),native:H.clone(native),reason:'Explicit retry of output-free prompt-splitting rejection with full-prompt mode.'}];
   r.pending={...r.pending,retryTask,generationApproved:true};r.gpu=null;r.native=null;
   if(config)this.credentials.set(r.id,config);
   r.status='running';r.phase='retrying_reference_image';r.pauseRequested=false;r.error=null;r.pausedReason=null;r.activeSince=Date.now();
   this.event(r,'image-retry','Retrying only the saved image with full-prompt mode; original text, prior attempts, accepted images and finished windows retained.',{windowId:w.id,previousJobId:recovery.jobId,previousRequestId:recovery.requestId});
   await this.save(r);this.launch(r,owner);return this.view(r);
  });
 }
 async retryPlan(r,b){
  return this.store.serialize('reference-agent-retry:'+r.id,async()=>{
   if(b.confirm!==true||DONE.has(r.status)||this.work.has(r.id)||r.cancelRequested||r.pending||r.gpu&&!r.gpu.terminal)throw Error('Pause this reference run with no unresolved image work, then explicitly confirm a planning repair.');
   const recovery=this.planRecovery(r);if(recovery?.kind!=='repair')throw Error('There is no rejected, completed planning response to repair. Reopen Fill references for its current state.');
   if(b.recoveryStamp!==recovery.stamp)throw Error('The rejected planning step changed. Refresh and review it again.');
   this.budget(r,'calls');const w=r.project.windows.find(w=>w.id===recovery.windowId),step=r.windows[w.id],key=this.planKey(r,step);
   const feedback={requestId:recovery.requestId,error:recovery.message,previousResponse:recovery.rawPreview,requirements:recovery.requirements,instruction:'Repair this one response using only current IDs and attached sources. Do not rewrite the project or repeat completed work.'};
   r.planRepairHistory=[...(r.planRepairHistory||[]),{at:now(),windowId:w.id,callKey:key,feedback}].slice(-32);
   step.planRevision=(step.planRevision||0)+1;step.planRepairFeedback=feedback;r.planFailure=null;r.lastPlan=null;
   if(b.planner)this.credentials.set(r.id,this.planner(b.planner,true));
   r.status='running';r.phase='repairing_image_plan';r.error=null;r.pauseRequested=false;r.activeSince=Date.now();
   this.event(r,'plan-repair','Authorized one new planning attempt for the current window. Previous response, completed work and spent budgets retained.',{windowId:w.id,previousRequestId:recovery.requestId});
   await this.save(r);this.launch(r);return this.view(r);
  });
 }
 candidateReview(r){
  if(DONE.has(r.status)||r.pending?.kind!=='candidate')return null;
  const c=r.candidates.find(x=>x.id===r.pending.candidateId),w=r.project.windows.find(x=>x.id===r.windowIds[r.index]),step=w&&r.windows[w.id];
  if(!c||!w||!step||c.status==='accepted')return null;
  const limit=A.attemptLimit(r.policy,step),stable=['paused','needs_review'].includes(r.status)&&!this.work.has(r.id)&&!r.cancelRequested&&!(r.gpu&&!r.gpu.terminal);
  const single=r.project.subjects.find(x=>x.id===c.request.subjectId)?.kind==='person';
  const base=String(c.review?.retryPrompt||c.request.prompt||'').trim();
  const prompt=base+(single&&/duplicat|extra (?:person|people)|two .*?(?:men|women)|clone/i.test(c.review?.reason||'')?'\nCorrection: exactly one person in frame, using the approved identity. No background duplicate, extra face, clone, or mirrored person.':'');
  let budgetIssue='';try{this.budget(r,'images');this.budget(r,'calls');}catch(e){budgetIssue=e.message;}
  const message=!stable?'Wait for the current action to finish parking. No uncertain image work will be duplicated.':!r.policy.allowImages?'Enable image generation in this run’s settings first.':budgetIssue||(step.attempts>=limit?'The window allowance is used. You may authorize exactly one additional attempt here; prior attempts still count.':'Retry only this image; approved sources and completed windows stay intact.');
  return{candidateId:c.id,windowId:w.id,name:c.name,windowTitle:w.title,reason:c.review?.reason||'',prompt,attempts:step.attempts,limit,requiresExtraAttempt:step.attempts>=limit,canAct:stable,canRetry:stable&&r.policy.allowImages&&!budgetIssue,message,
   stamp:R.fingerprint({candidate:c.id,status:c.status,pending:r.pending,target:R.stamp(r.project,w),attempts:step.attempts,extra:step.extraAttempts||0})};
 }
 async changeCandidate(r,b){
  const info=this.candidateReview(r);if(b.confirm!==true||!info||!info.canAct)throw Error('Pause this run and confirm the exact candidate action; no unresolved GPU work can be replaced.');
  if(b.candidateId!==info.candidateId||(b.candidateStamp&&b.candidateStamp!==info.stamp))throw Error('The candidate changed. Refresh before deciding.');
  const c=r.candidates.find(x=>x.id===info.candidateId),w=r.project.windows.find(x=>x.id===info.windowId),step=r.windows[w.id],owner=r.ownerSequenceId?this.sequences.runs.get(r.ownerSequenceId):null;
  if(r.ownerSequenceId&&(!owner||owner.cancelRequested||DONE.has(owner.status)||owner.status==='retired'))throw Error('The parent sequence cannot continue. Saved images were preserved.');
  const reason=String(b.reason||c.review?.reason||'Rejected by the user.').trim().slice(0,4000);
  if(b.action==='reject-candidate'){
   c.status='rejected-by-user';c.rejectedAt=now();c.rejectedReason=reason;r.pending.humanApproved=false;
   r.status='needs_review';r.error=null;r.phase='candidate_rejected';r.pausedReason='CANDIDATE_REVIEW';
   this.event(r,'candidate-rejected','Candidate rejected and kept only in history. No AI or GPU work started.',{candidateId:c.id,reason});await this.save(r);return this.view(r);
  }
  if(!info.canRetry)throw Error(info.message);
  if(info.requiresExtraAttempt&&b.extraAttempt!==true)throw Error('Authorize one additional attempt for this window or increase its allowance. Spent attempts are not reset.');
  if(info.requiresExtraAttempt&&(step.extraAttempts||0)>=20)throw Error('Twenty extra attempts have already been authorized. Revise the inputs rather than retrying indefinitely.');
  if(typeof b.prompt!=='undefined'&&(typeof b.prompt!=='string'||!b.prompt.trim()||b.prompt.length>16000))throw Error('The corrected prompt must contain 1–16000 characters.');
  A.assertTargetCurrent(c.request,r.project,w);
  const request={...H.clone(c.request),prompt:typeof b.prompt==='string'?b.prompt:info.prompt};
  const d=this.validatePlan(r,w,JSON.stringify({action:'need_reference',reason:'User rejected the previous candidate and authorized a corrected replacement.',request}),c.sourceIds,r.pending.frames||[]);
  const config=b.planner?this.planner(b.planner,true):null;
  if(config&&!config.vision)throw Error('Replacement candidates still require visual inspection.');
  c.status='rejected-by-user';c.rejectedAt=now();c.rejectedReason=reason;
  if(info.requiresExtraAttempt){step.extraAttempts=(step.extraAttempts||0)+1;step.attemptLimit=Math.max(info.limit+1,A.attemptLimit(r.policy,step));}
  r.pending={kind:'generation',request:d.request,frames:r.pending.frames||[],generationApproved:true,retryOf:c.id,retrySeed:-1};
  r.gpu=null; // A pending archived candidate has no unresolved native submission.
  if(config)this.credentials.set(r.id,config);
  r.status='running';r.phase='retrying_candidate';r.error=null;r.pausedReason=null;r.pauseRequested=false;r.activeSince=Date.now();
  this.event(r,'candidate-retry','Rejected candidate retained; one replacement uses the approved original inputs, corrected prompt and a new random seed.',{candidateId:c.id,reason,extraAttempt:info.requiresExtraAttempt,prompt:d.request.prompt});
  await this.save(r);this.launch(r,owner);return this.view(r);
 }
 // Counts are observational; opening the budget panel cannot submit anything.
 budgetState(r){
  const w=r.project.windows.find(w=>w.id===r.windowIds[r.index]),step=w&&r.windows[w.id],pol=r.policy;
  const peers=r.ownerSequenceId||r.groupId?[...this.runs.values()].filter(x=>x.projectId===r.projectId&&(r.ownerSequenceId?x.ownerSequenceId===r.ownerSequenceId:x.groupId===r.groupId)):[r];
  const images=peers.reduce((n,x)=>n+(x.usage?.images||0),0),calls=peers.reduce((n,x)=>n+(x.usage?.calls||0),0),elapsed=peers.reduce((n,x)=>n+(x.elapsedMs||0)+(x.activeSince?Math.max(0,Date.now()-x.activeSince):0),0);
  const limit=A.attemptLimit(pol,step||{}),attempts=step?.attempts||0;
  const stable=!!w&&['paused','needs_review'].includes(r.status)&&!this.work.has(r.id)&&!r.cancelRequested&&!(r.gpu&&!r.gpu.terminal);
  const owner=r.ownerSequenceId?this.sequences.runs.get(r.ownerSequenceId):null;
  const ownerOK=!r.ownerSequenceId||(owner&&!owner.cancelRequested&&!DONE.has(owner.status)&&owner.status!=='retired');
  return {windowId:w?.id||null,windowTitle:w?.title||'',attempts,limit,configured:pol.maxAttempts,maxConfigurable:20,
   images,calls,imageLimit:pol.maxImages,callLimit:pol.maxCalls,minutes:elapsed/60000,minuteLimit:pol.maxMinutes,
   exhausted:attempts>=limit,otherBudget:images>=pol.maxImages?'images':calls>=pol.maxCalls?'calls':elapsed>=pol.maxMinutes*60000?'time':null,
   canExtend:stable&&ownerOK&&limit<20,stamp:R.fingerprint({windowId:w?.id,index:r.index,attempts,limit,policy:pol,usage:r.usage,pending:r.pending,gpu:r.gpu})};
 }
 progressInfo(r){return {canSave:!this.work.has(r.id)&&r.status!=='running',acceptedImages:(r.candidates||[]).filter(c=>c.status==='accepted').length,completed:r.index,total:r.windowIds.length,verifiedChecks:(r.labelReviews||[]).filter(x=>x.accepted).length,lastCheckpoint:r.lastProgressCheckpoint||null};}
 async extendWindow(r,b){
  const info=this.budgetState(r);
  if(b.confirm!==true||!info.canExtend||b.budgetStamp!==info.stamp)throw Error('This allowance changed or the run is not safely parked. Refresh before extending it.');
  if(b.limit!==20)throw Error('This shortcut authorizes a total of 20 attempts for the current window only.');
  const config=b.planner?this.planner(b.planner,true):null;
  if(config&&r.policy.allowImages&&!config.vision)throw Error('Image review still requires visual input.');
  const step=r.windows[info.windowId]||={round:0,inspectedIds:[],attempts:0};
  // Check permissions/budgets before mutating the grant. Granting an allowance alone
  // is safe offline; resuming remains subject to the original renderer checks.
  if(b.resume===true&&(!r.policy.allowImages||info.otherBudget))throw Error(!r.policy.allowImages?'Enable image generation in this run’s settings first.':'The overall '+info.otherBudget+' allowance is used. Increase it in run settings, or save progress so far.');
  const before=step.attemptLimit,keys=['status','activeSince','pauseRequested','error','pausedReason','events','message','updatedAt'],backup=Object.fromEntries(keys.map(k=>[k,r[k]]));
  step.attemptLimit=20;
  const nextIsCandidate=!!r.pending?.candidateId;
  r.error=null;r.pausedReason=nextIsCandidate?'CANDIDATE_REVIEW':null;
  this.event(r,'budget-extension','Authorized 20 total image attempts for this window. Other allowances, earlier attempts and accepted work are unchanged.',{windowId:info.windowId,previousLimit:info.limit,newLimit:20,attempts:info.attempts});
  // Never reinterpret a budget grant as approval or rejection of a pending image.
  if(b.resume===true&&!nextIsCandidate){r.pauseRequested=false;r.status='running';r.activeSince=Date.now();}
  try{await this.save(r);}catch(e){Object.assign(r,backup);if(before===undefined)delete step.attemptLimit;else step.attemptLimit=before;throw e;}
  if(config)this.credentials.set(r.id,config);
  if(r.status==='running')this.launch(r);return this.view(r);
 }
 async saveProgress(r,b){
  if(b.confirm!==true||!this.progressInfo(r).canSave)throw Error('Pause reference work at a boundary, then save its approved progress. Cancelling is not required.');
  const snapshot=A.progressSnapshot(r),fingerprint=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),id='checkpoint_'+fingerprint.slice(0,32),dir=join(this.root,'checkpoints'),path=join(dir,id+'.json');
  await mkdir(dir,{recursive:true,mode:0o700});
  // A checkpoint only describes approved image IDs. Verify the owned immutable
  // media exist before calling it a usable backup; never relink missing bytes.
  for(const c of snapshot.result.candidates){const meta=await loadJSON(this.store.blobPath(c.id)+'.json'),st=await stat(this.store.blobPath(c.id));if(!meta||st.size!==c.size||meta.sha!==c.sha256)throw Error('Accepted image is missing or changed on the server: '+c.name+'. The run was not modified.');}
  let stored=await loadJSON(path);
  if(!stored){stored={...snapshot,id,createdAt:now(),sha256:fingerprint};await atomicJSON(path,noSecrets(stored));}
  r.lastProgressCheckpoint={id,createdAt:stored.createdAt,summary:stored.summary};await this.save(r);
  // No lifecycle, approval, queue or application status is changed by checkpointing.
  return noSecrets(stored);
 }
 busyGPU(exceptOwner=null){return [...this.runs.values()].some(r=>(!exceptOwner||r.ownerSequenceId!==exceptOwner)&&(this.work.has(r.id)&&r.policy.allowImages||r.gpu&&!r.gpu.terminal));}
 activeForSequence(id){return [...this.runs.values()].filter(r=>r.ownerSequenceId===id&&!DONE.has(r.status));}
 async handle(b){
  await this.ready;
  const controls=new Set(['authorize','repair-conflict','retry-plan','retry-image','retry-inspection','retry-candidate','reject-candidate','extend-window','save-progress','resume','approve','pause','cancel']);
  if(controls.has(b.action)&&safeID(b.id))return this.store.serialize('reference-agent-control:'+b.id,()=>this.handleAction(b));
  return this.handleAction(b);
 }
 async handleAction(b){await this.ready;
  if(b.action==='start')return this.start(b);
  if(b.action==='preflight'){const p=H.normalizeProject(b.project),ids=b.windowIds||[];if(!ids.length||ids.length>1000||ids.some(id=>!p.windows.some(w=>w.id===id)))throw Error('Choose existing windows.');return {sourceStamp:D.stamp(p),manifests:ids.map(id=>R.resolve(p,p.windows.find(w=>w.id===id)))};}
  if(b.action==='list')return{runs:[...this.runs.values()].filter(r=>!b.projectId||r.projectId===b.projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(r=>this.view(r))};
  if(b.action==='prepare-sequence'){
   if(!safeID(b.projectId)||b.consent!==true)throw Error('Authorize the reference agent for this submission.');
   const policy=A.policy(b.policy);const planner=this.planner(b.planner,true);
   if(policy.allowImages&&(!b.imageSettings?.modelType||b.imageSettings.licenseAccepted!==true||!policy.vision||!planner.vision))throw Error('Choose an image preset, acknowledge its license, and enable actual visual inspection.');
   this.credentials.set('project:'+b.projectId,{...planner,authorization:{policyStamp:R.fingerprint(policy),imageSettings:noSecrets(b.imageSettings||{}),at:Date.now()}});return{configured:true};
  }
  const r=this.get(b.id);
  if(b.action==='extend-window')return this.extendWindow(r,b);
  if(b.action==='save-progress')return this.saveProgress(r,b);
  if(b.action==='retry-candidate'||b.action==='reject-candidate')return this.changeCandidate(r,b);
  if(b.action==='retry-inspection')return this.retryInspection(r,b);
  if(b.action==='retry-plan')return this.retryPlan(r,b);
  if(b.action==='retry-image')return this.retryImage(r,b);
  if(b.action==='repair-conflict'){
   if(b.confirm!==true||DONE.has(r.status)||this.work.has(r.id)||r.cancelRequested||r.gpu&&!r.gpu.terminal)throw Error('Pause reference work and confirm the exact fix. No running/unknown GPU work may be changed.');
   const q=H.clone(r.project),w=q.windows.find(w=>w.id===b.windowId);if(!w||w.id!==r.windowIds[r.index])throw Error('Only the current blocked window can be repaired.');
   R.repairConflict(q,w,b.operation);r.project=q;r.blockers=R.resolve(q,w).issues;r.windows[w.id]||={round:0,inspectedIds:[],attempts:0};r.windows[w.id].labelChecked={};r.windows[w.id].labelRound=(r.windows[w.id].labelRound||0)+1;
   this.event(r,'user-fix','Confirmed a scoped reference fix; original media, story and completed takes were preserved.',{windowId:w.id,operation:b.operation});await this.save(r);return this.view(r,true);
  }
  if(b.action==='authorize'){
   if(b.consent!==true||DONE.has(r.status)||r.cancelRequested||this.work.has(r.id)||r.gpu&&!r.gpu.terminal)throw Error('Only a parked run without unresolved GPU work can receive new authorization.');
   if(r.ownerSequenceId)throw Error('Change the managed sequence policy through its submission workflow; this shortcut is for standalone reference runs.');
   const pol=A.policy(b.policy),planner=this.planner(b.planner,true),cfg=noSecrets(b.imageSettings||r.imageSettings);
   if(!pol.enabled||pol.allowImages&&(!cfg.modelType||cfg.licenseAccepted!==true||!pol.vision||!planner.vision))throw Error('Enable reference work and choose licensed image settings with visual inspection.');
   if(r.groupId)throw Error('Grouped draft budgets cannot be expanded here. Start a separately authorized workflow.');
   if(pol.maxCalls<r.usage.calls||pol.maxImages<r.usage.images)throw Error('Budgets are totals, including work already spent.');
   if(pol.allowImages){if(this.sequences.backendMode!=='headless')throw Error('Image jobs require the headless backend.');await this.sequences.assertAvailable();}
   r.policy=pol;r.planner=this.planner(planner);r.imageSettings=cfg;this.credentials.set(r.id,planner);
   if(r.pending?.kind==='generation')r.pending.generationApproved=pol.mode==='autonomous';
   r.application={...(r.application||{}),autoApply:b.autoApply===true,status:'pending'};
   this.event(r,'authorization','Explicitly updated this parked run’s permissions. Prior requests/candidates and spent budget retained.',{policy:pol});await this.save(r);return this.view(r);
  }
  if(b.action==='diagnose'){const w=r.project.windows.find(w=>w.id===r.windowIds[r.index]);const view=this.view(r,true);view.imageSettings=r.imageSettings;if(w&&!DONE.has(r.status)){const m=R.resolve(r.project,w);view.blockers=m.issues.map(i=>({...i,windowId:w.id,windowTitle:w.title,sourceStamp:m.sourceStamp}));}return view;}
  if(b.action==='ack-applied'){if(r.status!=='completed'||b.confirm!==true)throw Error('Only committed completed results can be acknowledged.');r.application={...(r.application||{}),autoApply:false,localAcknowledgedAt:now()};await this.save(r);return this.view(r);}
  if(b.action==='get')return this.view(r,!!b.detail);
  if(b.action==='result')return this.view(r,true);
  if(b.action==='cancel'){if(DONE.has(r.status))return this.view(r);r.cancelRequested=true;r.status='cancelling';await this.save(r);this.launch(r);return this.view(r);}
  if(b.action==='pause'){if(DONE.has(r.status))return this.view(r);r.pauseRequested=true;await this.save(r);return this.view(r);}
  if(b.action==='resume'||b.action==='approve'){
   if(DONE.has(r.status))throw Error('Finished runs cannot resume.');if(this.work.has(r.id))throw Error('The agent is still parking.');
   if(b.planner)this.credentials.set(r.id,this.planner(b.planner,true));
   if(r.pending?.kind==='question'){if(typeof b.answer!=='string'||!b.answer.trim())throw Error('Answer the pending question, or cancel and edit the project.');r.instruction+='\nHuman clarification: '+b.answer.trim().slice(0,8000);r.pending=null;}
   if(b.action==='approve'){
    if(b.confirm!==true)throw Error('Confirm this exact reference action.');
    if(r.pending?.candidateId){if(b.candidateId!==r.pending.candidateId)throw Error('Candidate changed.');r.pending.humanApproved=true;}
    else if(r.pending?.kind==='generation'){if(!r.policy.allowImages)throw Error('Generation is disabled for this run. Use Enable generation & continue to explicitly authorize it.');r.pending.generationApproved=true;}
    else throw Error('No approvable image request/candidate. Resolve the reported conflict in the project instead.');
   }
   if(r.cancelRequested)throw Error('Cancellation cannot be resumed.');
   r.pauseRequested=false;r.status='running';r.error=null;r.activeSince=Date.now();await this.save(r);this.launch(r);return this.view(r);
  }
  throw Error('Unknown reference-agent action.');
 }
 planner(raw={},keepKey=false){const {provider,model,protocol='auto',effort,opencodeUrl,opencodeUsername,vision}=raw;if(!['deepseek','codex','go','opencode'].includes(provider)||typeof model!=='string'||!model)throw Error('Choose a planner model.');return{provider,model,protocol,effort,opencodeUrl,opencodeUsername,vision:vision===true,...(keepKey&&typeof raw.key==='string'?{key:raw.key}:{})};}
 async start(b,{owner=null,locked=false}={}){
  await this.ready;if(!owner&&!locked)return this.store.serialize('sequence-start',()=>this.start(b,{locked:true}));const p=H.normalizeProject(b.project),ids=R.unique(b.windowIds||[]);if(!ids.length||ids.length>1000||ids.some(id=>!p.windows.some(w=>w.id===id)))throw Error('Choose existing windows (maximum 1000).');
  if(b.requestId){if(!safeID(b.requestId))throw Error('Invalid start request ID.');const old=[...this.runs.values()].find(r=>r.startRequestId===b.requestId);if(old){if(old.projectId!==p.id||old.sourceStamp!==D.stamp(b.project)||JSON.stringify(old.windowIds)!==JSON.stringify(ids)||R.fingerprint(old.policy)!==R.fingerprint(A.policy(b.policy||p.referenceAutomation)))throw Error('This start ID already belongs to a different request.');return this.view(old);}}
  const normalizedSourceStamp=D.stamp(p);const pol=A.policy(b.policy||p.referenceAutomation);if(!pol.enabled||b.consent!==true)throw Error('Review the reference-agent permissions and explicitly start it.');
  if(pol.allowImages&&(!b.imageSettings?.modelType||b.imageSettings.licenseAccepted!==true))throw Error('Choose a Qwen image preset and acknowledge its license before allowing autonomous image work.');
  if(pol.allowImages&&(!pol.vision||!b.planner?.vision))throw Error('Autonomous candidates require an image-capable planner with visual input enabled.');
  const planner=this.planner(b.planner,true);
  if(!owner){if([...this.runs.values()].some(r=>r.projectId===p.id&&!DONE.has(r.status)))throw Error('This project already has reference work. Open its existing run and continue or cancel it first.');if(this.busyGPU())throw Error('Another reference agent reserves the renderer.');if(pol.allowImages)await this.sequences.assertAvailable();}
  if(pol.allowImages&&this.sequences.backendMode!=='headless')throw Error('Autonomous image handoff requires the headless worker, not the browser plugin.');
  for(const a of p.assets.filter(a=>a.kind==='image')){
   try{const meta=await loadJSON(this.store.blobPath(a.id)+'.json');if(meta)a.sha256=meta.sha;}catch{}
  }
  const id='agent_'+randomBytes(16).toString('hex'),r={id,startRequestId:b.requestId||null,application:{autoApply:b.autoApply===true,status:'pending'},blockers:[],labelReviews:[],projectId:p.id,groupId:safeID(b.groupId)?b.groupId:null,name:p.name,renderEvidence:this.renderEvidence(p,ids,pol),ownerSequenceId:owner?.id||null,sourceStamp:D.stamp(b.project),normalizedSourceStamp,project:A.compactProject(p),windowIds:ids,windows:{},index:0,status:'running',phase:'starting',createdAt:now(),activeSince:Date.now(),elapsedMs:0,policy:pol,planner:this.planner(planner),imageSettings:noSecrets(b.imageSettings||{}),instruction:String(b.instruction||'').slice(0,12000),usage:{calls:0,images:0},aiIds:[],manifests:[],candidates:[],events:[],cancelRequested:false,pauseRequested:false};
  this.credentials.set(id,planner);this.runs.set(id,r);this.event(r,'start','Reference preparation authorized with explicit budgets.',{policy:pol});await this.save(r);this.launch(r,owner);return this.view(r);
 }
 launch(r,owner=null){owner||=r.ownerSequenceId?this.sequences.runs.get(r.ownerSequenceId):null;if(this.closed||this.work.has(r.id)||DONE.has(r.status))return this.work.get(r.id);
  const task=(async()=>{try{if(r.cancelRequested)await this.cancelRun(r);else {await this.loop(r,owner);if(r.status==='completed')await this.applyShared(r);}}catch(e){if(!this.closed&&!DONE.has(r.status)){r.error=e.message;r.status=r.cancelRequested?'cancelling':e instanceof Parked?'needs_review':'paused';r.pausedReason=e.code||'error';this.event(r,'parked',e.message);await this.save(r);}}finally{r.elapsedMs=(r.elapsedMs||0)+Math.max(0,Date.now()-(r.activeSince||Date.now()));r.activeSince=null;await this.save(r);}})().finally(()=>this.work.delete(r.id));this.work.set(r.id,task);return task;
 }
 async checkpoint(r,owner){
  if(this.closed)throw new Parked('Director stopped; resume explicitly.','SERVER_STOPPED');
  if(owner?.cancelRequested||r.cancelRequested){r.cancelRequested=true;await this.cancelRun(r);throw new Parked('Reference preparation cancelled.','CANCELLED');}
  if(owner?.pauseAfterWindow||r.pauseRequested)throw new Parked('Parked at a reference boundary. Accepted image work is retained.','PAUSED');
  const peers=r.ownerSequenceId||r.groupId?[...this.runs.values()].filter(x=>x.projectId===r.projectId&&(r.ownerSequenceId?x.ownerSequenceId===r.ownerSequenceId:x.groupId===r.groupId)):[r];const elapsed=peers.reduce((n,x)=>n+(x.elapsedMs||0)+(x.activeSince?Date.now()-x.activeSince:0),0);if(elapsed>r.policy.maxMinutes*60000)throw new Parked('Reference-preparation time budget reached. Review or start a new explicitly budgeted run.','BUDGET');
 }
 async call(r,key,system,packet,images,owner){
  r.calls||={};let saved=r.calls[key];
  if(!saved){await this.checkpoint(r,owner);this.budget(r,'calls');
   const id=r.id+'_'+key.replace(/[^a-zA-Z0-9_-]/g,'_');saved=r.calls[key]={id,phase:'prepared'};r.usage.calls++;r.aiIds.push(id);await this.save(r);
  }
  await this.ai.ready;let job;try{job=this.ai.get(saved.id);}catch{}
  if(!job&&saved.phase==='completed'&&typeof saved.text==='string')return saved.text;
  if(!job){
   if(saved.phase!=='prepared')throw new Parked('Saved AI request is unavailable; do not repeat a possibly paid request automatically.','AI_UNKNOWN');
   const config=this.credentials.get(r.id)||this.credentials.get('project:'+r.projectId)||r.planner;
   saved.phase='sent';await this.save(r);
   await this.ai.start({...config,requestId:saved.id,projectId:r.projectId,kind:'reference-images',system,prompt:JSON.stringify(packet),images,context:{referenceAgentId:r.id,windowId:r.windowIds[r.index],stage:key}});
   job=this.ai.get(saved.id);
  }
  while(['accepted','running'].includes(job.status)){
   if(this.closed)throw new Parked('Director stopped during AI work. Inspect the saved request before resuming.');
   if(r.cancelRequested||owner?.cancelRequested){await this.ai.cancel(job.id);await this.cancelRun(r);throw new Parked('Cancelled.');}
   r.phase='ai_'+key;r.lastAI=this.ai.view(job);await this.save(r);await sleep(this.pollMs);job=this.ai.get(saved.id);
  }
  r.lastAI=this.ai.view(job);
  if(job.status!=='completed'){await this.save(r);throw new Parked('Planner '+job.status+': '+(job.error||'Inspect AI requests. No automatic paid retry.'),'AI_FAILED');}
  saved.phase='completed';saved.text=job.text;await this.save(r);return job.text;
 }
 budget(r,kind){
  const cap=kind==='calls'?r.policy.maxCalls:r.policy.maxImages;
  let used=r.usage[kind];if(r.ownerSequenceId||r.groupId)used=[...this.runs.values()].filter(x=>x.projectId===r.projectId&&(r.ownerSequenceId?x.ownerSequenceId===r.ownerSequenceId:x.groupId===r.groupId)).reduce((n,x)=>n+(x.usage[kind]||0),0);
  if(used>=cap)throw new Parked((kind==='calls'?'AI request':'Image generation')+' budget reached ('+cap+'). No further request submitted.','BUDGET');
 }
 async sample(asset){
  if(asset.generationExcluded===true)throw new Parked('Excluded from generation: '+asset.name+'. Reactivate in Subjects & images or remove the selection.');
  if(this.mediaTools?.sample)return this.mediaTools.sample(asset);
  const path=this.store.blobPath(asset.id),out=join(this.root,'sample-'+randomBytes(12).toString('hex')+'.jpg');
  try{await exec(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-threads','1','-i',path,'-vf','scale=640:640:force_original_aspect_ratio=decrease','-frames:v','1','-threads','1','-y',out],{timeout:30000,maxBuffer:1024*1024});const b=await readFile(out);return{url:'data:image/jpeg;base64,'+b.toString('base64'),label:asset.id+' · '+asset.name};}finally{await rm(out,{force:true});}
 }
 renderEvidence(p,ids,pol){
  if(!pol.allowFrames)return {};
  const evidence={};for(const id of ids){const i=p.windows.findIndex(w=>w.id===id),w=p.windows[i],prev=p.windows[i-1];if(!prev)continue;
   if(!w.overlap&&(!R.sceneFor(p,w)||R.sceneFor(p,w)?.id!==R.sceneFor(p,prev)?.id))continue;
   const cut=E.segment(p,prev.id);if(!cut||cut.issue||!cut.job.id.startsWith('seq_'))continue;
   const owner=this.sequences.runs.get(cut.job.id),o=owner?.outputs.find(o=>o.id===cut.output.id&&o.available);
   const sourceStart=o?.layout==='bounded-v1'?o.source_start_frame:o?.start_frame,sourceEnd=o?.layout==='bounded-v1'?o.source_end_frame:o?.end_frame;
   if(o&&cut.inFrame>=sourceStart&&cut.outFrame<=sourceEnd)evidence[id]={sequenceId:owner.id,outputId:o.id,start_frame:cut.inFrame,end_frame:cut.outFrame};
  }return evidence;
 }
 async frames(r,w,owner){
  if(!r.policy.allowFrames)return [];
  if(!owner?.outputs?.length){const e=r.renderEvidence?.[w.id],saved=e&&this.sequences.runs.get(e.sequenceId),o=saved?.outputs.find(o=>o.id===e.outputId&&o.available);if(!o)return [];owner={id:saved.id,project:r.project,index:r.project.windows.findIndex(x=>x.id===w.id),outputs:[{...o,...(o.layout==='bounded-v1'?{source_start_frame:e.start_frame,source_end_frame:e.end_frame}:{start_frame:e.start_frame,end_frame:e.end_frame})}]};}
  const previous=owner.outputs.at(-1),prevWindow=owner.project.windows[owner.index-1];
  if(!w.overlap&&(!R.sceneFor(owner.project,w)||R.sceneFor(owner.project,w)?.id!==R.sceneFor(owner.project,prevWindow)?.id))return [];
  const sourceStart=previous.layout==='bounded-v1'?previous.source_start_frame:previous.start_frame,sourceEnd=previous.layout==='bounded-v1'?previous.source_end_frame:previous.end_frame;
  if(!Number.isSafeInteger(sourceStart)||sourceStart<0||!Number.isSafeInteger(sourceEnd)||sourceEnd<=sourceStart)throw new Parked('Prior-frame source range is invalid; no pixels were sampled.');
  const key='frame_'+previous.id+'_'+sourceStart+'_'+sourceEnd;if(r.contextFrames?.[key])return r.contextFrames[key];
  const path=join(this.store.root,'renders',previous.id+'.mp4');await stat(path);
  const frames=[];
  for(const offset of [1,12,24]){const frame=Math.max(sourceStart,sourceEnd-offset),id='frame_'+randomBytes(16).toString('hex'),out=join(this.root,id+'.jpg');
   try{if(this.mediaTools?.frame)await this.mediaTools.frame(path,out,frame);else await exec(process.env.FFMPEG_BIN||'ffmpeg',['-v','error','-ss',String(frame/24),'-i',path,'-frames:v','1','-vf','scale=960:960:force_original_aspect_ratio=decrease','-threads','1','-y',out],{timeout:60000,maxBuffer:1024*1024});
    const bytes=await readFile(out),meta=await this.store.putBlob(id,Readable.from(bytes),bytes.length,'image/jpeg');frames.push({id,name:'Previous rendered context · frame '+frame+'.jpg',kind:'image',type:'image/jpeg',sha256:meta.sha,frameIndex:frame,outputId:previous.id,sequenceId:owner.id,contextOnly:true});
   }finally{await rm(out,{force:true});}
  }
  r.contextFrames||={};r.contextFrames[key]=frames;this.event(r,'frame-evidence','Sampled verified prior footage. These frames are not automatically identity anchors.',{frames:frames.map(f=>({id:f.id,frameIndex:f.frameIndex,outputId:f.outputId}))});await this.save(r);return frames;
 }
 async gather(r,w,ids,frames){
  const known=new Map([...R.candidates(r.project,w).filter(a=>a.annotation.approved&&!a.missing&&!R.exclusions(r.project,w).has(a.id)),...frames].map(a=>[a.id,a]));const out=[];
  if(!r.policy.vision||!r.planner.vision)return out;
  for(const id of ids){const a=known.get(id);if(!a)throw new Parked('A selected inspection image disappeared.');out.push(await this.sample(a));}
  return out;
 }
 // Read the exact saved inspection input rather than assuming that an old response
 // belongs to the images currently selected by the planner.
 savedInspection(r,w,step){
  if(step.inspectionBatch)return step.inspectionBatch;
  const key='w'+r.index+'_labels'+(step.labelRound||0),call=r.calls?.[key];
  let job;try{job=this.ai.get(call?.id||r.lastInspection?.requestId||r.lastAI?.id);}catch{}
  if(!call&&!/\_labels\d+(?:\_.*)?$/.test(job?.id||''))return null;
  let packet;try{packet=JSON.parse(job?.request?.prompt||'');}catch{}
  const previous=r.lastInspection?.windowId===w.id?r.lastInspection:null;
  return {legacy:true,callKey:key,requestId:call?.id||job?.id,windowId:w.id,
   items:packet?.items||previous?.items||[],packet:packet||previous?.packet||null,
   attachedIds:job?.request?.images?.filter(i=>i.attached!==false).map(i=>i.label.split(' · ')[0])||previous?.attachedIds||[],
   raw:job?.status==='completed'?job.text:call?.phase==='completed'?call.text:previous?.raw,
   jobStatus:job?.status||call?.phase||null,appliedIds:[]};
 }
 inspectionRecovery(r){
  if(DONE.has(r.status)||r.cancelRequested||r.pending||!['paused','needs_review'].includes(r.status))return null;
  const w=r.project?.windows.find(w=>w.id===r.windowIds[r.index]),step=w&&r.windows?.[w.id];if(!step)return null;
  if(!r.inspectionFailure&&!/Uninspected or duplicate existing image|Existing-image inspection omitted|Invalid existing-image coverage evidence|Existing-image inspection needs repair/i.test(r.error||r.message||''))return null;
  const batch=this.savedInspection(r,w,step)||{},items=batch.items||[];
  let job;try{job=this.ai.get(batch.requestId||r.calls?.[batch.callKey]?.id);}catch{}
  const raw=job?.status==='completed'?job.text:batch.raw??r.lastInspection?.raw;
  const waiting=['accepted','running'].includes(job?.status),gpu=!!(r.gpu&&!r.gpu.terminal);
  let report;try{if(typeof raw==='string'&&items.length)report=A.labelBatch(raw,r.project,w,items,batch.attachedIds||[],r.policy.threshold);}catch{}
  const stale=!!batch.sourceStamp&&batch.sourceStamp!==A.inspectionStamp(r.project,w,items);
  const canRetry=!this.work.has(r.id)&&!gpu&&!waiting&&r.policy.vision&&r.planner.vision;
  const kind=waiting?'waiting':report?.complete&&!stale?'revalidate':'repair';
  const stamp=R.fingerprint({id:r.id,index:r.index,batch,raw:raw??null,current:items.length?A.inspectionStamp(r.project,w,items):R.stamp(r.project,w),failure:r.inspectionFailure||null});
  const problems=stale?[{code:'stale-input',message:'The saved inspection belongs to an earlier image selection or scene state.'}]:report?.issues||r.inspectionFailure?.issues||[];
  return {kind,stamp,requestId:batch.requestId||r.calls?.[batch.callKey]?.id||null,windowId:w.id,windowTitle:w.title,
   canRetry,message:waiting?'The original inspection request is still running. Wait or cancel it in AI requests; no duplicate request will be sent.':kind==='revalidate'?'The saved inspection can be validated with the updated response parser, without repeating the AI request.':'The AI inspection reply needs a correction—not changes to your image library. Recheck only the unresolved images in this window.',
   issues:problems,unresolvedIds:report?.unresolvedIds||r.inspectionFailure?.unresolvedIds||items.map(x=>x.assetId),
   images:items.map(x=>({assetId:x.assetId,name:r.project.assets.find(a=>a.id===x.assetId)?.name||x.name||x.assetId,imageKey:x.imageKey||'',requirementIds:x.requirementIds})),rawPreview:typeof raw==='string'?raw.slice(0,16000):'',
   budgetRemaining:Math.max(0,r.policy.maxCalls-(r.usage.calls||0))};
 }
 async retryInspection(r,b){
  if(b.confirm!==true||DONE.has(r.status)||this.work.has(r.id)||r.cancelRequested||r.pending||r.gpu&&!r.gpu.terminal)throw Error('Pause the inspection and confirm one new AI check; no running or unresolved GPU work can be replaced.');
  const recovery=this.inspectionRecovery(r);if(!recovery||recovery.kind==='waiting'||!recovery.canRetry)throw Error('No stopped image inspection is ready for repair. Refresh its state.');
  if(b.recoveryStamp!==recovery.stamp)throw Error('The inspection changed. Refresh before confirming this repair.');
  const owner=r.ownerSequenceId?this.sequences.runs.get(r.ownerSequenceId):null;
  if(r.ownerSequenceId&&(!owner||owner.cancelRequested||DONE.has(owner.status)||owner.status==='retired'))throw Error('The parent sequence can no longer continue; completed image work was preserved.');
  this.budget(r,'calls');
  const w=r.project.windows.find(w=>w.id===recovery.windowId),step=r.windows[w.id];
  const config=b.planner?this.planner(b.planner,true):null;
  if(config&&!config.vision)throw Error('Existing-image inspection needs an image-capable planner with visual input enabled.');
  r.inspectionHistory=[...(r.inspectionHistory||[]),{at:now(),windowId:w.id,previous:r.lastInspection||this.savedInspection(r,w,step),failure:r.inspectionFailure||null}].slice(-24);
  // Completed rows are already checked. Force a new request ID for the remaining
  // rows; never reinterpret a cached reply against a different batch.
  step.labelRound=(step.labelRound||0)+1;
  while(r.calls?.['w'+r.index+'_labels'+step.labelRound])step.labelRound++;
  step.inspectionBatch=null;step.inspectionOnlyIds=recovery.unresolvedIds?.length?recovery.unresolvedIds:recovery.images.map(x=>x.assetId);
  step.inspectionFeedback={issues:recovery.issues,previousResponse:recovery.rawPreview,instruction:'Return one judgement per supplied item only. Copy its short imageKey; do not duplicate rows or refer to unshown catalog images.'};
  step.inspectionAutoUsed=true; // A human repair gets one request, not another hidden retry.
  r.inspectionFailure=null;r.lastInspection=null;
  if(config)this.credentials.set(r.id,config);
  r.pauseRequested=false;r.status='running';r.phase='repairing_image_inspection';r.error=null;r.pausedReason=null;r.activeSince=Date.now();
  this.event(r,'inspection-repair','Authorized a new inspection for only the unresolved images. Completed windows, approved sources and all spent allowance are retained.',{windowId:w.id,previousRequestId:recovery.requestId});
  await this.save(r);this.launch(r,owner);return this.view(r);
 }
 reconcileInspectionEvidence(r,w){
  // Old completed replies may have recorded negative reviews without feeding
  // them into deterministic coverage. Reuse only the exact still-current batch;
  // this migration never calls a model or touches a completed window/budget.
  const batch=r.lastInspection;
  if(!batch||batch.windowId!==w.id||!batch.raw||!Array.isArray(batch.items)||batch.coverageVersion===1)return 0;
  if(batch.sourceStamp!==A.inspectionStamp(r.project,w,batch.items))return 0;
  let report;try{report=A.labelBatch(batch.raw,r.project,w,batch.items,batch.attachedIds||[],r.policy.threshold);}catch{return 0;}
  let changed=0;
  for(const review of report.reviews){
   if(review.accepted)continue;
   const item=batch.items.find(x=>x.assetId===review.assetId),asset=r.project.assets.find(a=>a.id===review.assetId);
   if(!item?.requirementIds?.length||!asset||asset.missing||!R.annotations(r.project,asset).approved||R.exclusions(r.project,w).has(asset.id))continue;
   R.recordEvidence(r.project,w,asset.id,item.requirementIds,{reason:review.reason,authority:'vision-agent',review,runId:r.id,accepted:false});changed++;
  }
  batch.coverageVersion=1;return changed;
 }
 async inspectExisting(r,w,step,owner,manifest){
  if(!r.policy.repairLabels||!r.policy.vision||!r.planner.vision)return false;
  const hard=manifest.issues.filter(i=>i.code!=='missing-coverage'&&!(i.code==='pin-conflict'&&i.reasons?.every(x=>x.code==='state-label')));if(hard.length)return false;
  const wanted=new Set([...manifest.missing.map(n=>n.id),...manifest.issues.flatMap(i=>(i.reasons||[]).map(x=>x.requirementId).filter(Boolean))]);
  if(!wanted.size&&!step.inspectionBatch){r.inspectionFailure=null;return false;}
  const scene=R.sceneFor(r.project,w),currentWindow={location:scene?.location||'',time:scene?.time||'',summary:w.summary,casting:Object.fromEntries(w.subjectIds.map(id=>[id,{name:r.project.subjects.find(s=>s.id===id)?.name,appearance:w.casting?.[id]?.appearance||'',retention:w.casting?.[id]?.retention||''}]))};
  step.labelChecked||={};const all=R.labelCandidates(r.project,w),needs=R.requirements(r.project,w).needs;
  let batch=step.inspectionBatch;
  if(!batch){
   let items=all.map(a=>({assetId:a.id,name:a.name,requirementIds:needs.filter(n=>wanted.has(n.id)&&(!n.subjectId||a.annotation.subjectIds.includes(n.subjectId))&&(!n.assetIds?.length||n.assetIds.includes(a.id))).map(n=>n.id),a}))
    .filter(x=>x.requirementIds.length&&step.labelChecked[x.assetId]!==R.fingerprint({ann:x.a.annotation,req:x.requirementIds.map(id=>needs.find(n=>n.id===id)),currentWindow}))
    .sort((a,b)=>Number(manifest.issues.some(i=>i.assetId===b.assetId))-Number(manifest.issues.some(i=>i.assetId===a.assetId)));
   if(step.inspectionOnlyIds?.length){const targeted=items.filter(x=>step.inspectionOnlyIds.includes(x.assetId));if(targeted.length)items=targeted;else{step.inspectionOnlyIds=null;step.inspectionFeedback=null;}}
   items=items.slice(0,Math.min(8,r.policy.maxInspectionImages));if(!items.length){r.inspectionFailure=null;return false;}
   const key='w'+r.index+'_labels'+(step.labelRound||0);
   const packet={windowTitle:w.title,currentWindow,requirements:needs.filter(n=>wanted.has(n.id)),items:items.map(({a,...x},i)=>({...x,imageKey:'I'+(i+1),registeredOwnership:a.annotation.subjectIds,existingLabels:a.annotation,requirements:needs.filter(n=>x.requirementIds.includes(n.id))})),instruction:r.instruction,
    repair:step.inspectionFeedback||null};
   batch={version:1,callKey:key,windowId:w.id,items:packet.items,packet,attachedIds:items.map(x=>x.assetId),sourceStamp:A.inspectionStamp(r.project,w,packet.items),appliedIds:[]};
   const saved=r.calls?.[key];
   if(saved){
    let job;try{job=this.ai.get(saved.id);}catch{}
    let old;try{old=JSON.parse(job?.request?.prompt||'');}catch{}
    const simplify=list=>(list||[]).map(i=>[i.assetId,[...(i.requirementIds||[])].sort()]);
    if(!old||R.fingerprint({items:simplify(old.items),currentWindow:old.currentWindow})!==R.fingerprint({items:simplify(packet.items),currentWindow})){ 
     r.lastInspection={...batch,requestId:saved.id,raw:job?.status==='completed'?job.text:saved.text};
     r.inspectionFailure={windowId:w.id,issues:[{code:'stale-input',message:'The prior reply cannot be safely matched to this current image batch. Recheck the inspection, not your image library.'}],unresolvedIds:items.map(i=>i.assetId)};
     step.inspectionBatch={...batch,raw:r.lastInspection.raw,requestId:saved.id,sourceStamp:'legacy-unverified'};
     await this.save(r);throw new Parked('Existing-image inspection needs repair: the saved reply belongs to a different or unavailable input batch. Use Recheck unresolved images.','INSPECTION_RESPONSE');
    }
    // An old reply can be revalidated only against its original closed set of IDs.
    batch.items=old.items;batch.packet=old;batch.attachedIds=job.request.images.filter(i=>i.attached!==false).map(i=>i.label.split(' · ')[0]);
   }
   step.inspectionBatch=batch;await this.save(r);
  }
  if(batch.sourceStamp!==A.inspectionStamp(r.project,w,batch.items)){
   r.inspectionFailure={windowId:w.id,issues:[{code:'stale-input',message:'The images or scene changed after this inspection was prepared.'}],unresolvedIds:batch.items.map(x=>x.assetId)};await this.save(r);
   throw new Parked('Existing-image inspection needs repair: input context changed. Use Recheck unresolved images.','INSPECTION_RESPONSE');
  }
  const samples=[];for(const item of batch.items){await this.checkpoint(r,owner);const a=r.project.assets.find(a=>a.id===item.assetId);if(!a||a.missing)throw new Parked('Missing inspection pixels for '+(item.name||item.assetId)+'. Restore that source before retrying.','INSPECTION_PIXELS');samples.push(await this.sample(a));}
  this.event(r,'label-inspection','Checking '+batch.items.length+' existing image(s) before generating replacements.',{windowId:w.id,ids:batch.items.map(x=>x.assetId)});
  const raw=await this.call(r,batch.callKey,A.LABEL_SYSTEM,batch.packet,samples,owner);
  batch.raw=raw;batch.requestId=r.calls[batch.callKey].id;batch.attachedIds=samples.map(x=>x.label.split(' · ')[0]);
  r.lastInspection=H.clone(batch);
  const report=A.labelBatch(raw,r.project,w,batch.items,batch.attachedIds,r.policy.threshold);
  const changes=report.reviews.filter(x=>!batch.appliedIds.includes(x.assetId));
  // Validate every row first, then commit only rows known to correspond to attached pixels.
  for(const review of changes){const item=batch.items.find(x=>x.assetId===review.assetId),a=all.find(x=>x.id===review.assetId);
   if(!a)throw new Parked('An inspection source became unavailable. No substitute was selected.','INSPECTION_PIXELS');
   step.labelChecked[review.assetId]=R.fingerprint({ann:a.annotation,req:item.requirementIds.map(id=>needs.find(n=>n.id===id)),currentWindow});
   r.labelReviews||=[];r.labelReviews.push({...review,windowId:w.id,requestId:batch.requestId,at:now()});
   if(review.accepted){R.recordEvidence(r.project,w,item.assetId,review.requirementIds,{reason:review.reason,authority:'vision-agent',review,runId:r.id});R.addToScene(r.project,w.id,item.assetId);this.event(r,'labelled','Existing image verified for this window; no Qwen job needed.',{assetId:item.assetId,requirementIds:review.requirementIds});}
   else if(item.requirementIds.length){R.recordEvidence(r.project,w,item.assetId,item.requirementIds,{reason:review.reason,authority:'vision-agent',review,runId:r.id,accepted:false});this.event(r,'coverage-rejected','Existing pixels did not verify these requirements; matching labels do not count as coverage.',{assetId:item.assetId,requirementIds:item.requirementIds});}
   batch.appliedIds.push(review.assetId);
  }
  if(report.warnings.length||report.issues.length)this.event(r,'inspection-validation','Inspection response checked: '+changes.length+' usable row(s), '+report.unresolvedIds.length+' image(s) still need a valid judgement.',{warnings:report.warnings,issues:report.issues});
  if(report.complete){step.labelRound=(step.labelRound||0)+1;step.inspectionBatch=null;step.inspectionOnlyIds=null;step.inspectionFeedback=null;step.inspectionAutoUsed=false;r.inspectionFailure=null;await this.save(r);return true;}
  r.inspectionFailure={windowId:w.id,requestId:batch.requestId,issues:report.issues,unresolvedIds:report.unresolvedIds,at:now()};
  if(r.policy.repairInspectionReplies&&!step.inspectionAutoUsed){
   this.budget(r,'calls');
   r.inspectionHistory=[...(r.inspectionHistory||[]),{at:now(),windowId:w.id,previous:H.clone(batch),failure:H.clone(r.inspectionFailure)}].slice(-24);
   step.labelRound=(step.labelRound||0)+1;step.inspectionBatch=null;step.inspectionOnlyIds=report.unresolvedIds;
   step.inspectionFeedback={issues:report.issues,previousResponse:raw.slice(0,16000),instruction:'Repair only the supplied unresolved images. Copy the supplied short imageKey; one row per item.'};
   step.inspectionAutoUsed=true;r.inspectionFailure=null;
   this.event(r,'inspection-repair','One corrective inspection authorized by this run’s policy. Valid rows are kept; only unresolved images will be sent again.',{windowId:w.id,ids:report.unresolvedIds});
   await this.save(r);return true;
  }
  await this.save(r);
  throw new Parked('Existing-image inspection needs repair: '+report.issues.map(x=>x.message).slice(0,2).join(' ')+' Use Recheck unresolved images. Accepted work is retained.','INSPECTION_RESPONSE');
 }
 async applyShared(r){
  if(!r.application?.autoApply||r.ownerSequenceId)return;
  try{const record=await this.store.getProject(r.projectId);if(!record){r.application.status='awaiting-browser';return;}
   if(record.project.referencePreparationHistory?.some(x=>x.id===r.id)){r.application.status='shared-applied';r.application.serverRevision=record.serverRevision;return;}
   if(D.stamp(record.project)!==r.sourceStamp&&D.stamp(record.project)!==r.normalizedSourceStamp){r.application.status='conflict';r.application.message='Shared project changed. Review the retained result before applying.';return;}
   const next=A.mergeResult(record.project,{...this.view(r,true),sourceStamp:D.stamp(record.project)}),saved=await this.store.putProject(next,record.serverRevision);
   r.application.status='shared-applied';r.application.serverRevision=saved.serverRevision;this.event(r,'applied','Prepared references safely applied to the unchanged Shared Studio project.',{revision:saved.serverRevision});
  }catch(e){r.application.status='conflict';r.application.message=e.message;}finally{await this.save(r);}
 }
 async loop(r,owner){
  while(r.index<r.windowIds.length&&!this.closed){await this.checkpoint(r,owner);
   const w=r.project.windows.find(w=>w.id===r.windowIds[r.index]);if(!w)throw new Parked('Window disappeared.');
   const step=r.windows[w.id]||=( {round:0,inspectedIds:[],attempts:0} );
   if(this.reconcileInspectionEvidence(r,w)){this.event(r,'coverage-reconciled','Reused current saved negative inspections without another provider request. Completed work and spent budgets retained.');await this.save(r);}
   if(!step.safeDone&&r.policy.allowSafeFixes){const plan=D.safeFormatting(r.project,[w.id]);if(plan.operations.length){r.project=D.apply(r.project,plan,{mechanicalOnly:true}).project;this.event(r,'doctor','Applied '+plan.operations.length+' exact mechanical syntax fixes.');}step.safeDone=true;await this.save(r);continue;}
   let manifest=R.resolve(r.project,w);r.blockers=manifest.issues.map(i=>({...i,windowId:w.id,windowTitle:w.title,sourceStamp:manifest.sourceStamp}));
   if(!r.pending&&await this.inspectExisting(r,w,step,owner,manifest))continue;
   const bad=manifest.issues.filter(i=>!NON_BLOCKING.has(i.code)&&!(i.code==='task-budget'&&i.kind!=='images'));if(bad.length)throw new Parked(bad[0].message+' Resolve this specific conflict in Fill missing coverage; no story decisions were guessed.','MANIFEST_CONFLICT');
   if(r.pending?.candidateId){await this.finishCandidate(r,w,step,owner);continue;}
   if(r.pending?.kind==='generation'){await this.generate(r,w,step,owner);continue;}
   if(step.attempts>=A.attemptLimit(r.policy,step)&&manifest.missing.length)throw new Parked('Image allowance used for '+w.title+' ('+step.attempts+'/'+A.attemptLimit(r.policy,step)+'). This counts all references and retries in this window. Increase the allowance or save progress so far; no completed work was discarded.','ATTEMPTS');
   if(!r.policy.auditEveryWindow&&!manifest.issues.length&&!step.round){R.applyManifest(r.project,manifest);r.manifests.push(manifest);r.index++;r.blockers=[];await this.save(r);continue;}
   const frames=await this.frames(r,w,owner);let ids=step.inspectedIds;
   if(!ids.length&&r.policy.vision){ids=R.unique([...manifest.selectedIds,...R.candidates(r.project,w).filter(a=>a.annotation.approved&&!a.missing&&!R.exclusions(r.project,w).has(a.id)).map(a=>a.id),...frames.map(a=>a.id)]).slice(0,r.policy.maxInspectionImages);if(frames.length){ids=ids.slice(0,Math.max(0,r.policy.maxInspectionImages-2)).concat(frames.slice(0,2).map(f=>f.id));}step.inspectedIds=ids;}
   const samples=await this.gather(r,w,ids,frames),context=R.context(r.project,w.id);
   const planKey=this.planKey(r,step),raw=await this.call(r,planKey,A.PLAN_SYSTEM,{...context,repairPreviousDecision:step.planRepairFeedback||null,reusableLibraryCandidates:R.reusable(r.project,w).map(a=>({id:a.id,name:a.name,annotation:a.annotation})),userDirection:r.instruction,policy:r.policy,generationCapabilities:{...Refs.imageDefaults(r.imageSettings?.modelType),maxReferences:r.imageSettings?.imageProfile?.max_references??Refs.imageDefaults(r.imageSettings?.modelType).maxReferences,modelType:r.imageSettings?.modelType},existingImageReviews:(r.labelReviews||[]).filter(x=>x.windowId===w.id).slice(-24),coverageRule:'Required inputs need not each cover every requirement. Keep identity-only pins and create a compatible state variant for missing coverage. Describe visible reference properties, not proof of software use or off-camera plot.',attachedIds:samples.map(x=>x.label.split(' · ')[0]),previousRenderedFrames:frames,attempts:step.attempts,previousRejections:r.candidates.filter(c=>c.windowId===w.id).map(c=>({reason:c.review?.reason,status:c.status})),outputSchema:{action:'ready|inspect|reuse_reference|need_reference|question',reason:'string',inspectIds:[],request:null,question:''}},samples,owner);
   const attachedIds=samples.map(x=>x.label.split(' · ')[0]);
   r.lastPlan={callKey:planKey,requestId:r.calls?.[planKey]?.id||r.lastAI?.id,windowId:w.id,at:now(),raw,attachedIds,requirements:R.requirements(r.project,w).needs};await this.save(r);
   let d;try{d=this.validatePlan(r,w,raw,attachedIds,frames);}catch(e){r.planFailure={callKey:planKey,requestId:r.lastPlan.requestId,windowId:w.id,message:e.message,at:now()};await this.save(r);throw new Parked('Image planning response needs repair: '+e.message+' Use Repair this step & continue; completed work is retained.','PLAN_VALIDATION');}
   r.planFailure=null;
   if(d.request?.bindingChanges?.length)this.event(r,'target-binding','Bound image metadata to the existing requirement ID. Actual candidate inspection is still required.',{windowId:w.id,changes:d.request.bindingChanges});
   step.round++;delete step.planRepairFeedback;
   this.event(r,'decision',d.reason,{action:d.action,windowId:w.id});
   if(d.action==='question'){r.pending={kind:'question',question:d.question||d.reason};throw new Parked(d.question||d.reason);}
   if(d.action==='reuse_reference'){
    if(!r.policy.vision||!r.planner.vision)throw new Parked('Reusing additional image coverage requires visual inspection.');
    if(d.inspectIds.length>r.policy.maxInspectionImages)throw new Parked('Reuse selection exceeds the inspection image budget.');
    if(!R.sceneFor(r.project,w))throw new Parked('Assign the window to a scene before importing coverage from another bank.');
    for(const id of d.inspectIds)R.addToScene(r.project,w.id,id);
    step.inspectedIds=d.inspectIds;this.event(r,'reuse','Approved compatible library images added to this scene bank for actual visual inspection. No new image job.',{ids:d.inspectIds});await this.save(r);continue;
   }
   if(d.action==='inspect'){
    if(!r.policy.vision)throw new Parked('Image inspection is disabled.');if(d.inspectIds.length>r.policy.maxInspectionImages)throw new Parked('Inspection request exceeds the configured image budget.');
    // Keep a bounded rolling batch. Only IDs in the next actual attachment set can become sources.
    step.inspectedIds=d.inspectIds;await this.save(r);continue;
   }
   if(d.action==='ready'){
    if(!manifest.imageReady)throw new Parked('The planner said ready, but deterministic requirements are unresolved.');
    R.applyManifest(r.project,manifest);r.manifests.push(manifest);r.index++;r.pending=null;r.blockers=[];this.event(r,'window-ready',w.title+' reference manifest compiled and ready.');await this.save(r);continue;
   }
   const req=d.request;
   if(req.subjectId){const anchors=R.candidates(r.project,w).filter(a=>a.annotation.approved&&a.annotation.subjectIds.includes(req.subjectId));
    if(!req.sourceIds.some(id=>anchors.some(a=>a.id===id))&&(anchors.length||!r.policy.allowNewIdentity))throw new Parked(anchors.length?'Use an approved identity anchor alongside the rendered context; original-identity permission does not replace an existing approved identity.':'No approved identity anchor exists. Enable original identity creation deliberately before creating the first appearance.');} 
   if(!r.policy.allowImages){r.pending={kind:'generation',request:req,frames,generationApproved:false};await this.save(r);throw new Parked('Missing reference identified; image generation is disabled.','GENERATION_DISABLED');}
   r.pending={kind:'generation',request:req,frames,generationApproved:r.policy.mode==='autonomous'};await this.save(r);
  }
  if(r.index>=r.windowIds.length){r.status='completed';r.phase='finished';this.event(r,'completed','Reference preparation finished. Original timeline, dialogue and recorded takes were not rewritten.');await this.save(r);}
 }
 async generate(r,w,step,owner){
  const pending=r.pending;if(!pending.generationApproved)throw new Parked('Review the missing-reference request and approve generation.','APPROVAL');
  if(!r.policy.allowImages)throw new Parked('Generation was not authorized in this run. Start a newly authorized run.');
  await this.checkpoint(r,owner);
  if(!r.gpu&&step.attempts>=A.attemptLimit(r.policy,step))throw new Parked('Image allowance used for this window ('+step.attempts+'/'+A.attemptLimit(r.policy,step)+'). Raise its allowance to continue the saved image request, or save progress so far.','ATTEMPTS');
  const request=pending.request;if(!r.gpu)A.assertTargetCurrent(request,r.project,w);const frames=pending.frames||[],sources=request.sourceIds.map(id=>r.project.assets.find(a=>a.id===id)||frames.find(f=>f.id===id));
  if(sources.some(s=>!s))throw new Parked('A generation source is missing.');
  H.assertGenerationInputs(r.project,request.sourceIds);
  let gpu=r.gpu;
  if(!gpu){await this.requireImageWorker();this.budget(r,'images');const map=new Map();for(const s of sources){await this.checkpoint(r,owner);map.set(s.id,await this.sequences.upload({backendMode:this.sequences.backendMode},this.store.blobPath(s.id),s.name,s.type||'image/jpeg'));}
   const card={prompt:A.generationPrompt(request),referenceIds:request.sourceIds},task=pending.retryTask?{...H.clone(pending.retryTask),multi_prompts_gen_type:'FG',image_refs:request.sourceIds.map(id=>map.get(id))}:Refs.task(card,r.imageSettings,Object.fromEntries(map));
   if(pending.retrySeed===-1)task.seed=-1;
   const requestId=r.id+'_image_'+r.usage.images;gpu=r.gpu={requestId,phase:'prepared',payload:{tasks:[task],project:r.name+' · reference repair',project_id:r.projectId,request_id:requestId},sourceIds:request.sourceIds,terminal:false};r.usage.images++;step.attempts++;await this.save(r);
  }
  let native=gpu.jobId?await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+gpu.jobId):null;
  if(!native&&gpu.phase!=='prepared'){
   const found=await this.sequences.api({backendMode:this.sequences.backendMode},'/requests/'+gpu.requestId);if(found.job_id)native=found;else throw new Parked('Image acceptance is unknown. No automatic resubmission. Inspect WanGP server / request '+gpu.requestId+'.','GPU_UNKNOWN');
  }
  if(!native){
   await this.requireImageWorker();
   await this.store.serialize('sequence-start',async()=>{
    await this.checkpoint(r,owner);const q=await this.sequences.workerQueue();if(!q.reachable||!q.idle||q.paused)throw new Parked('Renderer is busy, paused, or unreachable. Resume reference preparation when it is available.','GPU_BUSY');
    // The containing managed sequence owns this handoff. Standalone requests may not cut in.
    for(const other of this.sequences.runs.values())if(other.id!==owner?.id&&!['completed','cancelled','failed','retired'].includes(other.status)&&this.sequences.summary(other,await this.sequences.observe(other,q)).blocking)throw new Parked('Another managed sequence reserves the GPU.');
    if(this.sequences.finishingBusy?.())throw new Parked('Finishing reserves the GPU.');
    gpu.phase='submitting';await this.save(r);native=await this.sequences.api({backendMode:this.sequences.backendMode},'/generate',gpu.payload);
    if(!native.job_id)throw new Parked('Image submission returned no job ID.','GPU_UNKNOWN');
    gpu.jobId=native.job_id;gpu.phase='accepted';r.native=native;await this.save(r);
   });
  }else{gpu.jobId=native.job_id;gpu.phase='accepted';await this.save(r);}
  while(!NATIVE_DONE.has(native.status)){
   if(this.closed)throw new Parked('Director stopped; the accepted image job may continue. Reconcile on Resume.');
   if(r.cancelRequested||owner?.cancelRequested){r.cancelRequested=true;await this.cancelRun(r);return;}
   r.phase='generating_reference';if(r.native?.message!==native.message)this.event(r,'progress',native.message||'Generating reference picture.');r.native=native;await this.save(r);await sleep(this.pollMs);native=await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+gpu.jobId);
  }
  gpu.terminal=true;r.native=native;await this.save(r);
  if(native.status!=='completed')throw new Parked('Image job '+native.status+': '+(native.errors||[]).map(e=>typeof e==='string'?e:e?.message||'').join('; ')+(promptSplitFailure(native)?' Use Retry image as one prompt after updating the idle worker.':''),promptSplitFailure(native)?'IMAGE_PROMPT_SPLIT':'IMAGE_FAILED');
  const output=native.outputs?.find(o=>o.available&&/^image\//.test(o.content_type||''));if(!output)throw new Parked('Completed image job has no available image.');
  const existing=r.candidates.find(c=>c.nativeJobId===native.job_id&&c.outputId===output.id);
  const candidate=existing||await this.archiveCandidate(r,w,native.job_id,output,request,sources);
  if(!existing)r.candidates.push(candidate);
  r.pending={...pending,kind:'candidate',candidateId:candidate.id};r.gpu=null;r.phase='reviewing_candidate';await this.save(r);
 }
 async archiveCandidate(r,w,jobId,output,request,sources){
  if(!safeID(jobId)||!/^[a-f0-9]{32}$/.test(output.id||''))throw Error('Invalid output ownership.');
  const id='ref_'+randomBytes(16).toString('hex'),target=join(this.root,id+'.image'),{base,token}=await this.sequences.credentials({backendMode:this.sequences.backendMode});
  const res=await this.fetch(base+'/jobs/'+jobId+'/outputs/'+output.id,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(120000)});if(!res.ok||!res.body)throw new Parked('Could not retrieve generated pixels. Candidate cannot be approved.');let size=0;
  try{await pipeline(Readable.fromWeb(res.body),new Transform({transform(c,e,cb){size+=c.length;if(size>40*1024*1024)cb(Error('Candidate exceeds 40 MiB.'));else cb(null,c);}}),createWriteStream(target,{flags:'wx',mode:0o600}));
   let info;if(this.mediaTools?.probe)info=await this.mediaTools.probe(target);else{const {stdout}=await exec(process.env.FFPROBE_BIN||'ffprobe',['-v','error','-show_entries','stream=width,height,codec_type','-of','json',target],{timeout:30000,maxBuffer:1024*1024});info=JSON.parse(stdout).streams?.find(s=>s.width&&s.height);}
   if(!info||!Number.isInteger(info.width)||!Number.isInteger(info.height)||info.width<64||info.height<64||info.width*info.height>64*1024*1024)throw new Parked('Invalid candidate dimensions.');
   const metadata=await this.store.putBlob(id,createReadStream(target),size,output.content_type);return {id,windowId:w.id,name:request.title+'.'+(output.content_type==='image/png'?'png':'jpg'),kind:'image',type:output.content_type,size,width:info.width,height:info.height,duration:null,sha256:metadata.sha,status:'unreviewed',nativeJobId:jobId,outputId:output.id,request:H.clone(request),sourceIds:sources.map(s=>s.id),provenance:{kind:'reference-agent',agentId:r.id,jobId,outputId:output.id,prompt:r.gpu?.payload?.tasks?.[0]?.prompt||A.generationPrompt(request),proposedPrompt:request.prompt,coverageTarget:request.coverageTarget||null,referenceIds:sources.map(s=>s.id),sourceHashes:sources.map(s=>({id:s.id,sha256:s.sha256||null})),generatedAt:now(),contextFrames:sources.filter(s=>s.contextOnly)}};
  }finally{await rm(target,{force:true});}
 }
 async finishCandidate(r,w,step,owner){
  const pending=r.pending,c=r.candidates.find(c=>c.id===pending.candidateId);if(!c)throw new Parked('Candidate record missing.');
  if(!c.review){const sourceIds=c.sourceIds;const images=[];
   if(sourceIds.length&&r.policy.maxInspectionImages<2)throw new Parked('Candidate review requires room for the candidate and its reference. Set the inspection image budget to at least two.','REVIEW_BUDGET');
   const reviewIds=[...sourceIds].sort((a,b)=>{const owns=id=>{const x=r.project.assets.find(s=>s.id===id);return x&&c.request.subjectId&&R.annotations(r.project,x).subjectIds.includes(c.request.subjectId)?1:0;};return owns(b)-owns(a);});
   for(const id of reviewIds.slice(0,r.policy.maxInspectionImages-1)){const a=r.project.assets.find(a=>a.id===id)||pending.frames?.find(a=>a.id===id);if(a)images.push(await this.sample(a));} 
   images.push({...await this.sample(c),label:c.id+' · candidate'});
   const raw=await this.call(r,'w'+r.index+'_review'+step.attempts,A.REVIEW_SYSTEM,{candidateId:c.id,request:c.request,sourceIds:images.slice(0,-1).map(i=>i.label.split(' · ')[0]),threshold:r.policy.threshold,requirements:R.requirements(r.project,w)},images,owner);
   c.review=A.review(raw,c.id,r.policy.threshold,images.some(i=>i.label===c.id+' · candidate'));c.status=c.review.accepted?'passed-review':c.review.verdict==='retry'?'rejected':'needs-review';await this.save(r);
  }
  if(c.status==='rejected-by-user'&&!pending.humanApproved)throw new Parked('You rejected this candidate. Retry it with a correction when ready; it is not an approved reference.','CANDIDATE_REVIEW');
  const canAccept=pending.humanApproved||r.policy.mode==='autonomous'&&c.review.accepted;
  if(canAccept){
   const asset={id:c.id,number:Math.max(0,...r.project.assets.filter(a=>a.kind==='image').map(a=>a.number))+1,name:c.name,kind:'image',type:c.type,size:c.size,width:c.width,height:c.height,duration:null,description:c.request.description,role:c.request.role,referenceKind:c.request.subjectId?'character':c.request.role==='setting'?'scene':c.request.role==='prop'?'prop':'direct',referenceState:c.request.state,missing:false,sha256:c.sha256,provenance:{...c.provenance,review:c.review,approvedBy:pending.humanApproved?'user':'bounded-vision-agent'}};
   if(!r.project.assets.some(a=>a.id===asset.id)){const card={subjectId:c.request.subjectId,windowIds:[w.id],state:c.request.state};Refs.applyGenerated(r.project,asset,card,false);R.annotate(r.project,asset.id,{subjectIds:c.request.subjectId?[c.request.subjectId]:[],roles:R.unique([c.request.role,...(c.request.subjectId?['identity']:[])]),states:c.request.state?[c.request.state]:[],angles:c.request.angle?[c.request.angle]:[],approved:true,quality:2,sha256:c.sha256});R.addToScene(r.project,w.id,asset.id);
    if(!c.request.subjectId){w.referencePolicy||={};w.referencePolicy.pins=R.unique([...(w.referencePolicy.pins||[]),asset.id]);}
    w.referencePolicy||={};if(!c.request.requirementId){w.referencePolicy.requirements=[...(w.referencePolicy.requirements||[]),{id:'agent-'+c.id,subjectId:c.request.subjectId,role:c.request.role,state:c.request.state,angle:c.request.angle,description:c.request.description,required:true,shots:H.shotNumbers(w),assetIds:[c.id]}];}
   }
   // A visually accepted candidate is evidence for its specific requested requirement.
   // The requested shot state may describe a pose rather than an outfit; do not lose
   // that result just because the planner called the variant 'pose' instead of 'wardrobe'.
   if(c.request.requirementId)R.recordEvidence(r.project,w,c.id,[c.request.requirementId],{reason:c.review.reason,authority:pending.humanApproved?'user':'vision-agent',review:c.review,runId:r.id});
   c.status='accepted';c.approvedAt=now();step.inspectedIds=R.unique([c.id,...step.inspectedIds]).slice(0,r.policy.maxInspectionImages);r.pending=null;this.event(r,'accepted','Candidate passed actual visual review and was added to the scoped bank. Original assets remain.',{candidateId:c.id});await this.save(r);return;
  }
  if(r.policy.mode==='autonomous'&&c.review.verdict==='retry'&&step.attempts<A.attemptLimit(r.policy,step)){
   const request={...c.request,prompt:typeof c.review.retryPrompt==='string'&&c.review.retryPrompt.trim()?c.review.retryPrompt:c.request.prompt};
   // Review cannot alter source ownership or smuggle new token IDs.
   const retry=A.decision(JSON.stringify({action:'need_reference',reason:'Retry after rejected candidate.',request}),r.project,w,c.sourceIds,{frames:pending.frames});
   r.pending={kind:'generation',request:retry.request,frames:pending.frames,generationApproved:true};this.event(r,'retry','Candidate rejected; retry within the authorized attempt budget.',{reason:c.review.reason});await this.save(r);return;
  }
  throw new Parked(c.review.accepted?'Candidate passed the visual check. Approve it to continue in review mode.':'Candidate needs human review: '+c.review.reason,'CANDIDATE_REVIEW');
 }
 async cancelRun(r){
  if(this.closed)return;r.cancelRequested=true;r.status='cancelling';
  for(const id of r.aiIds){try{const j=this.ai.get(id);if(['accepted','running'].includes(j.status))await this.ai.cancel(id);}catch{}}
  if(r.gpu&&!r.gpu.terminal){let job;
   if(r.gpu.jobId)job=await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+r.gpu.jobId);
   else if(r.gpu.phase==='prepared'){r.gpu.terminal=true;}
   else{const found=await this.sequences.api({backendMode:this.sequences.backendMode},'/requests/'+r.gpu.requestId);if(found.job_id)job=found;else throw new Parked('Cancellation cannot prove an uncertain image submission stopped. Inspect the worker.','GPU_UNKNOWN');}
   if(job){r.gpu.jobId=job.job_id;while(!NATIVE_DONE.has(job.status)){if(this.closed)return;if(job.status!=='cancelling')await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+job.job_id+'/cancel',{});await sleep(this.pollMs);job=await this.sequences.api({backendMode:this.sequences.backendMode},'/jobs/'+job.job_id);}r.gpu.terminal=true;}
  }
  r.status='cancelled';r.phase='finished';this.event(r,'cancelled','Reference loop cancelled. Accepted sources and candidate archives are retained.');await this.save(r);
 }
 async cancelForSequence(ownerId){await this.ready;for(const r of this.activeForSequence(ownerId)){r.cancelRequested=true;await this.save(r);await this.launch(r);}return !this.activeForSequence(ownerId).some(r=>r.status!=='cancelled');}
 sequenceAuthorization(project){
  const pol=A.policy(project.referenceAutomation||{});if(!pol.enabled||!pol.beforeRender)return null;
  const config=this.credentials.get('project:'+project.id),a=config?.authorization;
  if(!a||Date.now()-a.at>15*60*1000||a.policyStamp!==R.fingerprint(pol))throw Error('Reference automation needs fresh permission for this submission. Open Reference agent / confirm the send prompt.');
  return{policyStamp:a.policyStamp,imageSettings:a.imageSettings,planner:this.planner(config),authorizedAt:now()};
 }
 async preflightProject(project){
  const approval=this.sequenceAuthorization(project);if(!approval)return null;
  // Binding optimization is authorized; no dialogue, timing or cast changes here.
  for(const w of project.windows){const m=R.resolve(project,w);if(m.imageReady)R.applyManifest(project,m);else if(m.issues.every(i=>['missing-coverage','voice-capacity','voice-duration'].includes(i.code)))R.applySelection(project,w.id,m.selectedIds);}
  return approval;
 }
 auxiliary(ownerId){const rows=this.activeForSequence(ownerId);return{runs:rows.map(r=>this.view(r)),jobIds:rows.filter(r=>r.gpu?.jobId&&!r.gpu.terminal).map(r=>r.gpu.jobId),unknown:rows.some(r=>r.gpu&&!r.gpu.terminal&&!r.gpu.jobId&&r.gpu.phase!=='prepared'),busy:rows.some(r=>this.work.has(r.id)||r.gpu&&!r.gpu.terminal)};}
 async prepareWindow(owner){
  await this.ready;const pol=A.policy(owner.project.referenceAutomation||{});if(!pol.enabled||!pol.beforeRender)return true;
  const w=owner.project.windows[owner.index];let run=[...this.runs.values()].find(r=>r.ownerSequenceId===owner.id&&r.windowIds[0]===w.id);
  if(!run){const config=this.credentials.get('project:'+owner.project.id)||owner.referenceConsent?.planner;
   if(!config)throw new Parked('Reconnect the planner in Reference agent before dispatch.');
   const reply=await this.start({project:owner.project,windowIds:[w.id],policy:pol,planner:config,imageSettings:owner.referenceConsent?.imageSettings||{},consent:true,instruction:owner.project.referenceAutomation.instruction||''},{owner});run=this.get(reply.id);
  }else if(run.status==='paused'||run.status==='needs_review'){
   if(run.status==='needs_review'&&!run.pending?.generationApproved&&!run.pending?.humanApproved){owner.referenceAgentId=run.id;owner.status='paused';owner.phase='reference_review';owner.message=run.message;await this.sequences.save(owner);return false;}
   run.status='running';run.activeSince=Date.now();await this.save(run);this.launch(run,owner);
  }
  owner.referenceAgentId=run.id;owner.phase='reference_preflight';owner.message='Reference agent is preparing '+w.title;await this.sequences.save(owner);
  if(run.status==='running'&&!this.work.has(run.id))this.launch(run,owner);await this.work.get(run.id);
  if(run.status!=='completed'){owner.status=owner.cancelRequested?'cancelling':'paused';owner.phase='reference_review';owner.message=run.message;await this.sequences.save(owner);return false;}
  // Copy only reference changes in the immutable submission snapshot. Never edit an older task manifest.
  owner.project=run.project;owner.referenceDecisions||=[];if(!owner.referenceDecisions.some(x=>x.agentId===run.id))owner.referenceDecisions.push({agentId:run.id,windowId:w.id,usage:run.usage,at:now()});
  const actual=owner.project.windows.find(x=>x.id===w.id);owner.windowManifests||={};owner.windowManifests[w.id]={...R.resolve(owner.project,actual),capturedAt:now()};
  await this.sequences.save(owner);return true;
 }
 close(){this.closed=true;this.credentials.clear();}
}
