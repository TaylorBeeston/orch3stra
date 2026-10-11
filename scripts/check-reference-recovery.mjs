#!/usr/bin/env node
/** Real local disk/HTTP/FFmpeg and durable AI records. The model and GPU responses are fixtures. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Readable} from 'node:stream';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {StudioStore,atomicJSON} from '../studio-server.mjs';
import {AIRequests} from '../ai-server.mjs';
import {ReferenceAgent} from '../reference-agent-server.mjs';
import {SequenceCoordinator} from '../sequence-server.mjs';
import {createServer} from '../bridge.mjs';
const require=createRequire(import.meta.url),H=require('../core.js'),R=require('../scene-core.js'),D=require('../doctor-core.js'),A=require('../reference-agent-core.js');
let count=0;const sleep=ms=>new Promise(r=>setTimeout(r,ms));const check=async(n,fn)=>{await fn();console.log('PASS '+n);count++;};
const testRoot=await mkdtemp(join(tmpdir(),'h3-reference-tests-'));const secret='fixture-not-saved-4f6b9';
function makeImage(name,color){const path=join(testRoot,name+'.png');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`color=c=${color}:s=128x96`,'-frames:v','1','-threads','1','-y',path]);return readFile(path);}
const original=await makeImage('anchor','red'),candidate=await makeImage('candidate','blue');
const filmPath=join(testRoot,'film.mp4');execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','testsrc2=size=128x96:rate=24','-frames:v','209','-c:v','libx264','-threads','1','-y',filmPath]);const film=await readFile(filmPath);
function fixture(){const p=H.newProject();p.id='project-test';p.name='Small shot test';p.mode='managed';p.modelType='minimax-test';p.presetConfirmed=true;p.subjects=[{id:'person',number:1,name:'Pilot',description:'Adult in a plain coat.',kind:'person',assetIds:['anchor'],referenceVariants:[],speakerId:'S1',voiceAssetId:''}];p.assets=[{id:'anchor',number:1,name:'anchor.png',kind:'image',type:'image/png',size:original.length,description:'Portrait identity',role:'identity',missing:false}];p.windows=[{...H.newWindow('Cabin',209,0),id:'window-one',subjectIds:['person'],assetIds:[],casting:{person:{visibleShots:[1],voiceShots:[],delivery:'scene',appearance:'',retention:''}},summary:'[reference generation] A pilot turns to the window.',detail:'[Shot 1] The pilot looks toward the stars without speaking.',soundscape:'A quiet ventilation hum.',music:'N/A',referencePolicy:{requirements:[{id:'profile-view',subjectId:'person',role:'angle',angle:'profile',description:'A clear profile view of the pilot.',shots:[1],required:true}]}}];R.setScenes(p,R.suggestScenes(p));p.referenceAutomation={...A.defaults,enabled:true,mode:'autonomous',allowImages:true,vision:true,maxImages:2,maxCalls:10,maxAttempts:2,beforeRender:true};return p;}
const settings={modelType:'qwen_image_21_7B',licenseAccepted:true,resolution:'1024x1024',steps:20,guidance:4,seed:1};
const planner={provider:'deepseek',model:'deepseek-flash-fixture',vision:true,key:secret};
async function harness({mode='accept',releaseJob=true,loseResponse=false,policy={},runner=null}={}){
 const root=await mkdtemp(join(testRoot,'run-'));const store=new StudioStore(root);await store.ready;await store.putBlob('anchor',Readable.from(original),original.length,'image/png');
 const state={submissions:[],requests:[],jobs:new Map(),requestIds:new Map(),uploads:[],releaseJob,loseResponse,mode};
 const native=http.createServer(async(req,res)=>{let bytes=Buffer.alloc(0);for await(const c of req)bytes=Buffer.concat([bytes,c]);const reply=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};const path=new URL(req.url,'http://localhost').pathname;
 if(req.headers.authorization!=='Bearer native-secret')return reply(401,{error:'unauthorized'});
 if(path==='/health')return reply(200,{app:'h3-director-wangp',backend:'headless',version:'1.9.2',capabilities:{reference_image_prompt_mode:state.workerFG===false?undefined:'FG'}});
 if(path==='/queue'){const jobs=[...state.jobs.values()];return reply(200,{paused:false,active_job_id:jobs.find(j=>!['completed','cancelled','failed'].includes(j.status))?.job_id||null,jobs});}
 if(path==='/generate'){const b=JSON.parse(bytes);const image=b.tasks[0].mode==='reference_image';state.submissions.push(b);const id='job'+state.submissions.length,o=randomBytes(16).toString('hex'),job={job_id:id,status:'running',outputs:[],message:'Fixture rendering',outputId:o,polls:0,image};if(image&&state.failNextImage){job.status='failed';job.errors=[state.failNextImage];job.generated_files=[];job.message='Fixture prompt validation failed';state.failNextImage=null;}state.jobs.set(id,job);state.requestIds.set(b.request_id,id);if(state.loseResponse){state.loseResponse=false;req.socket.destroy();return;}return reply(200,job);}
 if(path.startsWith('/requests/')){const id=state.requestIds.get(decodeURIComponent(path.slice(10)));return id?reply(200,state.jobs.get(id)):reply(404,{error:'not found'});}
 if(/^\/jobs\/[^/]+\/outputs\/[a-f0-9]+$/.test(path)){const j=state.jobs.get(path.split('/')[2]);if(j?.outputId!==path.split('/')[4])return reply(404,{error:'not owned'});const content=j.image?candidate:film;res.writeHead(200,{'Content-Type':j.image?'image/png':'video/mp4','Content-Length':content.length});res.end(content);return;}
 if(path.endsWith('/cancel')){const j=state.jobs.get(path.split('/')[2]);if(!j)return reply(404,{});j.status='cancelled';return reply(200,j);}
 if(path.startsWith('/jobs/')){const j=state.jobs.get(path.slice(6));if(!j)return reply(404,{});j.polls++;if(state.releaseJob&&j.status==='running'&&j.polls>=2){j.status='completed';j.outputs=[{id:j.outputId,available:true,content_type:j.image?'image/png':'video/mp4',name:j.image?'candidate.png':'film.mp4',media_kind:j.image?'image':'video',window_index:1}];}return reply(200,j);}
 return reply(404,{error:path});});await new Promise(r=>native.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+native.address().port;
 const sequences={backendMode:'headless',runs:new Map(),save:async r=>atomicJSON(join(root,'runs',r.id+'.json'),r),assertAvailable:async()=>{const q=await sequences.workerQueue();if(!q.idle)throw Error('Busy');},credentials:async()=>({base,token:'native-secret'}),summary:r=>({blocking:!['paused','completed','cancelled'].includes(r.status)}),observe:async r=>({}),finishingBusy:()=>false,
 api:async(r,path,body)=>{const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer native-secret','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!response.ok)throw Error('HTTP '+response.status);return response.json();},
 upload:async(r,path,name,type)=>{const b=await readFile(path);state.uploads.push({b,name,type});return'h3media:'+state.uploads.length;},workerQueue:async()=>{const q=await sequences.api({},'/queue');return{...q,reachable:true,idle:q.active_job_id===null};}};
 const ai=new AIRequests(root,async(b,signal,progress)=>{const packet=JSON.parse(b.prompt);state.requests.push({b,packet});if(runner)return runner(b,packet,signal,progress,state);
 if(b.system===A.REVIEW_SYSTEM){assert(b.images.some(i=>i.label===packet.candidateId+' · candidate'));return{text:JSON.stringify({inspectedCandidateId:packet.candidateId,verdict:state.mode==='reject'?'retry':state.mode==='uncertain'?'review':'accept',reason:state.mode==='reject'?'The fixture subject has an extra hand; retry with a plain pose.':'The actual candidate pixels and identity references are attached for inspection.',scores:{identity:1,state:1,composition:1,clarity:1,noExtraPeople:1},retryPrompt:'Preserve <image1> identity in profile, no extra limbs.'})};}
 if(state.mode==='question')return{text:JSON.stringify({action:'question',reason:'The request needs a human choice.',question:'Which side profile should be used?'})};
 if(packet.manifest?.missing?.length)return{text:JSON.stringify({action:'need_reference',reason:'Profile coverage is missing from the approved scene bank.',request:{title:'Profile coverage',subjectId:'person',role:'angle',state:'',angle:'profile',description:'Clear profile for this shot',sourceIds:['anchor'],prompt:'Preserve the person from <image1> in a clear profile view.',requirementId:'profile-view'}})};
 return{text:JSON.stringify({action:'ready',reason:'Required coverage is available; retain the prepared manifest.'})};
 },{silent:true,timeoutMs:5000,idleMs:2000,maxHistory:200});await ai.ready;
 let agent=new ReferenceAgent(store,sequences,ai,{pollMs:5});await agent.ready;sequences.referenceAgent=agent;
 const p=fixture();Object.assign(p.referenceAutomation,policy);
 return{root,store,sequences,ai,state,p,get agent(){return agent;},async start(extra={}){const v=await agent.start({project:p,windowIds:p.windows.map(w=>w.id),policy:p.referenceAutomation,planner,imageSettings:settings,consent:true,...extra});return agent.get(v.id);},async finish(r){for(let i=0;i<1000;i++){const task=agent.work.get(r.id);if(task){await task;return r;}if(r.status!=='running')return r;await sleep(5);}throw Error('Did not finish');},async restart(){agent.close();await Promise.allSettled([...agent.work.values()]);agent=new ReferenceAgent(store,sequences,ai,{pollMs:5});sequences.referenceAgent=agent;await agent.ready;},async cleanup(){agent.close();ai.close();await Promise.allSettled([...agent.work.values()]);await ai.writes;await new Promise(r=>native.close(r));await rm(root,{recursive:true,force:true});}};
}
try {
 await check('Requirement IDs bind canonical state/angle; paraphrased labels do not edit the project',async()=>{
  const p=fixture(),w=p.windows[0];w.referencePolicy.states={person:'Retells the dessert dispute and watches the service.'};w.casting.person.appearance='Standing in the apartment in a navy shirt.';const before=H.clone(p);
  const raw={action:'need_reference',reason:'Need the current shot coverage.',request:{subjectId:'person',role:'pose',state:'standing, apartment, navy shirt',angle:'left-facing',sourceIds:['anchor'],prompt:'Use <image1> as the approved identity. Show a standing adult in the apartment.',requirementId:'state:person'}};
  const d=A.decision(JSON.stringify(raw),p,w,['anchor']);assert.equal(d.request.state,w.referencePolicy.states.person);assert.equal(d.request.coverageTarget.appearance,w.casting.person.appearance);assert.equal(d.request.bindingChanges[0].field,'state');assert.deepEqual(p,before);
  const angle=A.decision(JSON.stringify({...raw,request:{...raw.request,role:'angle',requirementId:'profile-view',angle:'side-view'}}),p,w,['anchor']);assert.equal(angle.request.angle,'profile');assert.equal(angle.request.prompt,raw.request.prompt);
  assert.match(A.generationPrompt(d.request),/Current window appearance \/ pose: Standing in the apartment/);assert.match(A.generationPrompt(d.request),/coverage target takes precedence/);
 });
 await check('Canonical binding never relaxes subject, required-source, exclusion or inspection checks',async()=>{
  const p=fixture(),w=p.windows[0],request={action:'need_reference',reason:'Need profile coverage.',request:{subjectId:'person',role:'angle',angle:'side',state:'',sourceIds:['anchor'],prompt:'Use <image1>.',requirementId:'profile-view'}};
  assert.throws(()=>A.decision(JSON.stringify({...request,request:{...request.request,subjectId:''}}),p,w,['anchor']),/subject/);
  assert.throws(()=>A.decision(JSON.stringify({...request,request:{...request.request,requirementId:'unknown'}}),p,w,['anchor']),/nonexistent/);
  assert.throws(()=>A.decision(JSON.stringify(request),p,w,[]),/inspected/);
  w.excludedAssetIds=['anchor'];assert.throws(()=>A.decision(JSON.stringify(request),p,w,['anchor']),/inspected/);w.excludedAssetIds=[];
  w.referencePolicy.requirements[0].assetIds=['anchor'];assert.throws(()=>A.decision(JSON.stringify(request),p,w,['anchor']),/pinned/);
 });
 await check('A bound target becomes stale after a local appearance change; it never rewrites casting',async()=>{
  const p=fixture(),w=p.windows[0];w.casting.person.appearance='Blue coat';const r=A.decision(JSON.stringify({action:'need_reference',reason:'Need profile.',request:{subjectId:'person',role:'angle',angle:'side view',sourceIds:['anchor'],prompt:'Use <image1> in profile.',requirementId:'profile-view'}}),p,w,['anchor']).request;
  A.assertTargetCurrent(r,p,w);w.casting.person.appearance='Red coat';assert.throws(()=>A.assertTargetCurrent(r,p,w),/target changed/);assert.equal(w.casting.person.appearance,'Red coat');
 });
 await check('Live image payload and candidate provenance contain the locked target, not only proposed labels',async()=>{
  const x=await harness({runner:async(b,p)=>{
   if(b.system===A.REVIEW_SYSTEM){assert.equal(p.request.coverageTarget.appearance,'Standing in the cabin in a blue coat.');return{text:JSON.stringify({inspectedCandidateId:p.candidateId,verdict:'accept',reason:'Actual candidate pixels and identity source match the current blue coat and profile.',scores:{identity:1,state:1,composition:1,clarity:1,noExtraPeople:1}})};}
   return{text:JSON.stringify(p.manifest.missing.length?{action:'need_reference',reason:'Need a side view.',request:{subjectId:'person',role:'angle',angle:'side view',state:'same outfit',sourceIds:['anchor'],prompt:'Use <image1> in a side view.',requirementId:'profile-view'}}:{action:'ready',reason:'Coverage is now ready.'})};
  }});
  try{x.p.windows[0].casting.person.appearance='Standing in the cabin in a blue coat.';const r=await x.start();await x.finish(r);assert.equal(r.status,'completed',r.error);assert.equal(x.state.submissions.length,1);const sent=x.state.submissions[0].tasks[0].prompt;assert.match(sent,/Required angle: profile/);assert.match(sent,/blue coat/);assert.equal(r.candidates[0].provenance.prompt,sent);assert.match(r.candidates[0].provenance.proposedPrompt,/side view/);assert.equal(r.candidates[0].request.angle,'profile');assert(r.events.some(e=>e.kind==='target-binding'));}
  finally{await x.cleanup();}
 });
 await check('Rebound labels are not candidate approval: rejected pixels still stop at the finite budget',async()=>{
  const x=await harness({mode:'reject',policy:{maxImages:1}});try{const r=await x.start();await x.finish(r);assert.equal(r.status,'needs_review');assert.equal(r.project.assets.length,1);assert.equal(r.candidates[0].status,'rejected');assert.equal(r.usage.images,1);assert.equal(x.state.submissions.length,1);}finally{await x.cleanup();}
 });
 await check('Legacy state-string failure at window 22 reuses completed response, preserves 21 windows and accepted image',async()=>{
  const raw=JSON.stringify({action:'need_reference',reason:'Need the current scene state.',request:{title:'Current standing pose',subjectId:'person',role:'pose',state:'standing in the apartment',sourceIds:['anchor'],prompt:'Using <image1>, show the same adult standing in a blue coat in the apartment.',requirementId:'state:person'}});
  const x=await harness({policy:{maxCalls:1024,maxImages:100},runner:async(b,p)=>{
   if(p.legacy)return{text:raw};
   if(b.system===A.REVIEW_SYSTEM)return{text:JSON.stringify({inspectedCandidateId:p.candidateId,verdict:'accept',reason:'The attached candidate pixels retain the approved person and the current standing pose.',scores:{identity:1,state:1,composition:1,clarity:1,noExtraPeople:1}})};
   return{text:JSON.stringify({action:'ready',reason:'The canonical state has visually reviewed coverage.'})};
  }});
  try{
   const p=H.normalizeProject(x.p),w=p.windows[0];w.referencePolicy={states:{person:'Retells the dessert dispute and watches the service.'}};w.casting.person.appearance='Standing in the apartment in a blue coat.';
   const earlier=Array.from({length:21},(_,i)=>({...H.clone(w),id:'completed-'+i}));p.windows=[...earlier,w];R.setScenes(p,R.suggestScenes(p));
   p.assets.push({id:'previous-approved',number:2,name:'Previous approved.png',kind:'image',type:'image/png',size:candidate.length});await x.store.putBlob('previous-approved',Readable.from(candidate),candidate.length,'image/png');
   const id='agent-legacy-state',key='w21_plan0',requestId=id+'_'+key;
   await x.ai.start({...planner,requestId,projectId:p.id,kind:'reference-images',system:'Legacy fixture',prompt:JSON.stringify({legacy:true}),images:[{label:'anchor · identity',url:'data:image/png;base64,'+original.toString('base64')}],context:{referenceAgentId:id}});
   for(let i=0;i<100&&x.ai.get(requestId).status!=='completed';i++)await sleep(5);assert.equal(x.ai.get(requestId).status,'completed');
   const previous={id:'previous-approved',windowId:earlier[0].id,status:'accepted',name:'Previously accepted image',review:{accepted:true,reason:'Previously reviewed fixture.'}};
   const manifests=earlier.map(w=>({windowId:w.id,ready:true,unchanged:true}));
   const record={id,projectId:p.id,name:p.name,project:p,sourceStamp:D.stamp(p),normalizedSourceStamp:D.stamp(p),index:21,windowIds:p.windows.map(w=>w.id),windows:{[w.id]:{round:0,inspectedIds:['anchor'],attempts:0,safeDone:true}},manifests,status:'paused',phase:'ai_'+key,error:'Generated coverage must preserve the requested requirement state.',message:'Generated coverage must preserve the requested requirement state.',pausedReason:'error',usage:{calls:49,images:1},policy:p.referenceAutomation,imageSettings:settings,planner,calls:{[key]:{id:requestId,phase:'completed'}},aiIds:[requestId],lastAI:{id:requestId,status:'running'},candidates:[previous],events:[],createdAt:new Date().toISOString(),elapsedMs:0,instruction:'Fill missing references',pending:null};
   await atomicJSON(x.agent.path(id),record);await x.restart();const r=x.agent.get(id);
   const view=await x.agent.handle({action:'diagnose',id});assert.equal(view.planRecovery.kind,'revalidate');assert.equal(view.lastAI.status,'completed');assert.equal(view.lastAIRequest.text,raw);assert.equal(x.state.requests.length,1);
   await x.agent.handle({action:'resume',id,planner});await x.finish(r);assert.equal(r.status,'completed',r.error);assert.equal(r.index,22);assert.equal(r.usage.images,2);assert.equal(r.usage.calls,51);assert.equal(x.state.requests.length,3);assert.equal(x.state.submissions.length,1);
   assert.deepEqual(r.manifests.slice(0,21),manifests);assert.deepEqual(r.project.windows.slice(0,21),p.windows.slice(0,21));assert.deepEqual(r.candidates[0],previous);assert.equal(r.candidates[1].status,'accepted');assert.equal(r.calls[key].text,raw);
  }finally{await x.cleanup();}
 });
 async function broken(){let repaired=false;const x=await harness({runner:async(b,p)=>{
  if(b.system===A.REVIEW_SYSTEM)return{text:JSON.stringify({inspectedCandidateId:p.candidateId,verdict:'accept',reason:'The actual candidate image matches the supplied profile requirement and approved identity.',scores:{identity:1,state:1,composition:1,clarity:1,noExtraPeople:1}})};
  if(!p.repairPreviousDecision&&!repaired)return{text:'{"action":"need_reference","reason":"test","request":{"subjectId":"person","role":"angle","sourceIds":["anchor"],"prompt":"Use <image1>.","requirementId":"invented"}}'};
  if(p.repairPreviousDecision){assert.match(p.repairPreviousDecision.error,/nonexistent/);repaired=true;}
  return{text:JSON.stringify(p.manifest.missing.length?{action:'need_reference',reason:'Correct requirement ID.',request:{subjectId:'person',role:'angle',sourceIds:['anchor'],prompt:'Use <image1> for a profile.',requirementId:'profile-view'}}:{action:'ready',reason:'The fixed profile is available.'})};
 }});const r=await x.start();await x.finish(r);return{x,r};}
 await check('Rejected planning response gets actionable diagnostics and an explicit same-run repair',async()=>{
  const {x,r}=await broken();try{assert.equal(r.pausedReason,'PLAN_VALIDATION');assert.equal(r.status,'needs_review');const d=await x.agent.handle({action:'diagnose',id:r.id});assert.equal(d.planRecovery.kind,'repair');assert.match(d.planRecovery.rawPreview,/invented/);assert.equal(d.lastAI.status,'completed');assert(d.lastAIRequest.request.prompt);assert.equal(x.state.submissions.length,0);
   await x.agent.handle({action:'retry-plan',id:r.id,planner,confirm:true,recoveryStamp:d.planRecovery.stamp});await x.finish(r);assert.equal(r.status,'completed',r.error);assert.equal(x.state.submissions.length,1);assert.equal(r.usage.calls,4);assert.equal(r.planRepairHistory.length,1);assert.equal(r.aiIds[1],r.id+'_w0_plan0_fix1');assert(x.ai.get(r.aiIds[0]).text.includes('invented'));assert.equal(r.project.windows[0].detail,x.p.windows[0].detail);
  }finally{await x.cleanup();}
 });
 await check('Retrying is confirmation-gated and revision-checked; it cannot reset usage',async()=>{
  const {x,r}=await broken();try{const d=await x.agent.handle({action:'diagnose',id:r.id});const b={action:'retry-plan',id:r.id,planner,confirm:true,recoveryStamp:d.planRecovery.stamp};await assert.rejects(x.agent.handle({...b,confirm:false}),/confirm/);await assert.rejects(x.agent.handle({...b,recoveryStamp:'stale'}),/changed/);assert.equal(r.usage.calls,1);assert.equal(x.state.requests.length,1);r.policy.maxCalls=1;await assert.rejects(x.agent.handle(b),/budget/);assert.equal(r.usage.calls,1);assert.equal(x.state.submissions.length,0);}finally{await x.cleanup();}
 });
 await check('Unresolved GPU work or pending cancellation forbids plan replacement',async()=>{
  const {x,r}=await broken();try{const recovery=x.agent.planRecovery(r),b={action:'retry-plan',id:r.id,planner,confirm:true,recoveryStamp:recovery.stamp};r.gpu={terminal:false,phase:'submitting',requestId:'unknown'};await assert.rejects(x.agent.handle(b),/unresolved/);r.gpu=null;r.cancelRequested=true;await assert.rejects(x.agent.handle(b),/confirm/);assert.equal(x.state.requests.length,1);assert.equal(x.state.submissions.length,0);r.cancelRequested=false;}finally{await x.cleanup();}
 });
 await check('Two-device repair clicks admit only one new plan',async()=>{
  const {x,r}=await broken();try{const b={action:'retry-plan',id:r.id,planner,confirm:true,recoveryStamp:x.agent.planRecovery(r).stamp};const results=await Promise.allSettled([x.agent.handle(b),x.agent.handle(b)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);await x.finish(r);assert.equal(r.status,'completed',r.error);assert.equal(r.planRepairHistory.length,1);assert.equal(x.state.submissions.length,1);}finally{await x.cleanup();}
 });
 await check('A rejected completed plan stays recoverable when the external AI history is pruned',async()=>{
  const {x,r}=await broken();try{const first=r.aiIds[0];x.ai.jobs.delete(first);await x.restart();const saved=x.agent.get(r.id);const d=await x.agent.handle({action:'diagnose',id:r.id});assert.equal(d.planRecovery.kind,'repair');assert.match(d.planRecovery.rawPreview,/invented/);assert(saved.calls.w0_plan0.text);assert.equal(saved.lastPlan.callKey,'w0_plan0');assert.equal(saved.planFailure.callKey,'w0_plan0');await x.agent.handle({action:'resume',id:r.id,planner});await x.finish(saved);assert.equal(x.state.requests.length,1);assert.equal(saved.pausedReason,'PLAN_VALIDATION');assert.equal(x.state.submissions.length,0);}finally{await x.cleanup();}
 });
 await check('Existing-image reviewers get specific local appearance/location alongside the broad scene state',async()=>{
  const x=await harness({policy:{repairLabels:true},runner:async(b,p)=>{
   if(b.system===A.LABEL_SYSTEM){assert.equal(p.currentWindow.location,'Apartment');assert.equal(p.currentWindow.casting.person.appearance,'Standing in a navy shirt, phone pocketed.');return{text:JSON.stringify({inspections:p.items.map(i=>({assetId:i.assetId,verdict:'fits',requirementIds:i.requirementIds,reason:'The visible profile and navy shirt match the current local apartment shot.',score:.98}))})};}
   return{text:JSON.stringify({action:'ready',reason:'Actual profile is covered.'})};
  }});try{x.p.windows[0].casting.person.appearance='Standing in a navy shirt, phone pocketed.';R.sceneFor(x.p,x.p.windows[0]).location='Apartment';const r=await x.start();await x.finish(r);assert.equal(r.status,'completed',r.error);assert.equal(x.state.submissions.length,0);}finally{await x.cleanup();}
 });

 const splitError="multi_prompts_gen_type='PG' parses this prompt into 2 separate generation requests, but this submission accepts one generation task. Submit separate tasks or use 'FG' if the line breaks belong to one prompt.";
 async function failedImage(){const x=await harness({policy:{maxImages:10,maxAttempts:4}});x.state.failNextImage=splitError;const r=await x.start();await x.finish(r);assert.equal(r.pausedReason,'IMAGE_PROMPT_SPLIT');assert.equal(r.gpu.terminal,true);assert.equal(x.state.submissions.length,1);return{x,r};}
 await check('One full image prompt, including canonical target and composition paragraphs, is sent with FG',async()=>{
  const x=await harness();try{const r=await x.start();await x.finish(r);assert.equal(r.status,'completed',r.error);const task=x.state.submissions[0].tasks[0];assert.equal(task.multi_prompts_gen_type,'FG');assert.match(task.prompt,/target.*\n/s);assert.match(task.prompt,/\n\nImage composition suggestion:/);assert.equal(r.candidates[0].provenance.prompt,task.prompt);}finally{await x.cleanup();}
 });
 await check('A failed PG image is explicitly retried in the same run without repeating the planning call',async()=>{
  const {x,r}=await failedImage();try{const d=await x.agent.handle({action:'diagnose',id:r.id});assert.equal(d.imageRecovery.kind,'prompt-mode');assert.equal(d.planRecovery,null);assert.equal(r.usage.calls,1);assert.equal(r.usage.images,1);
   const before=H.clone(r.project),first=H.clone(x.state.submissions[0]);await x.agent.handle({action:'retry-image',id:r.id,confirm:true,recoveryStamp:d.imageRecovery.stamp,planner});await x.finish(r);
   assert.equal(r.status,'completed',r.error);assert.equal(x.state.submissions.length,2);assert.equal(r.usage.images,2);assert.equal(r.usage.calls,3);assert.notEqual(first.request_id,x.state.submissions[1].request_id);assert.equal(x.state.submissions[1].tasks[0].prompt,first.tasks[0].prompt);assert.equal(x.state.submissions[1].tasks[0].multi_prompts_gen_type,'FG');assert.equal(r.imageRetryHistory.length,1);assert.equal(r.imageRetryHistory[0].native.status,'failed');assert.equal(r.candidates[0].status,'accepted');assert.equal(r.project.windows[0].detail,before.windows[0].detail);assert.equal(r.project.assets[0].id,before.assets[0].id);
   assert.equal(x.state.requests.filter(q=>q.b.system===A.PLAN_SYSTEM&&q.packet.manifest.missing.length).length,1);
  }finally{await x.cleanup();}
 });
 await check('Image retries require confirmation, current stamp, budgets and no pending cancellation',async()=>{
  const {x,r}=await failedImage();try{const b={action:'retry-image',id:r.id,confirm:true,recoveryStamp:x.agent.imageRecovery(r).stamp,planner};await assert.rejects(x.agent.handle({...b,confirm:false}),/confirm/);await assert.rejects(x.agent.handle({...b,recoveryStamp:'stale'}),/changed/);r.policy.maxImages=1;await assert.rejects(x.agent.handle(b),/budget/i);r.policy.maxImages=10;r.policy.maxAttempts=1;await assert.rejects(x.agent.handle(b),/budget/i);r.policy.maxAttempts=4;r.cancelRequested=true;await assert.rejects(x.agent.handle(b),/confirm/);r.cancelRequested=false;assert.equal(r.usage.images,1);assert.equal(x.state.submissions.length,1);assert.equal(r.imageRetryHistory,undefined);}finally{await x.cleanup();}
 });
 await check('A stale worker blocks image retry before reserving budget or discarding the failed handle',async()=>{
  const {x,r}=await failedImage();try{x.state.workerFG=false;const before=H.clone(r.gpu);await assert.rejects(x.agent.handle({action:'retry-image',id:r.id,confirm:true,recoveryStamp:x.agent.imageRecovery(r).stamp,planner}),/worker 1.9.2/);assert.deepEqual(r.gpu,before);assert.equal(r.usage.images,1);assert.equal(x.state.submissions.length,1);}finally{await x.cleanup();}
 });
 await check('New image preparation refuses old workers before uploading or counting a GPU attempt',async()=>{
  const x=await harness();try{x.state.workerFG=false;const r=await x.start();await x.finish(r);assert.equal(r.pausedReason,'IMAGE_WORKER_UPGRADE');assert.equal(r.usage.images,0);assert.equal(x.state.submissions.length,0);assert.equal(x.state.uploads.length,0);}finally{await x.cleanup();}
 });
 await check('Live worker confirmation prevents retrying completed, active, unknown or output-bearing jobs',async()=>{
  const {x,r}=await failedImage();try{const b={action:'retry-image',id:r.id,confirm:true,recoveryStamp:x.agent.imageRecovery(r).stamp,planner},job=x.state.jobs.get(r.gpu.jobId);for(const state of ['running','completed','cancelled']){job.status=state;await assert.rejects(x.agent.handle(b),/did not confirm/);}job.status='failed';job.outputs=[{id:'retained-output',available:true}];await assert.rejects(x.agent.handle(b),/did not confirm/);job.outputs=[];job.generated_files=['/saved/image.png'];await assert.rejects(x.agent.handle(b),/did not confirm/);job.generated_files=[];x.state.jobs.delete(job.job_id);await assert.rejects(x.agent.handle(b),/HTTP 404/);assert.equal(x.state.submissions.length,1);}finally{await x.cleanup();}
 });
 await check('Image retry recovery survives Node restart and concurrent clicks create one replacement only',async()=>{
  const {x,r}=await failedImage();try{const originalGpu=H.clone(r.gpu);await x.restart();const saved=x.agent.get(r.id);assert.equal(saved.status,'paused');const d=await x.agent.handle({action:'diagnose',id:r.id});assert.equal(d.imageRecovery.kind,'prompt-mode');const b={action:'retry-image',id:r.id,confirm:true,recoveryStamp:d.imageRecovery.stamp,planner};const results=await Promise.allSettled([x.agent.handle(b),x.agent.handle(b)]);assert.equal(results.filter(v=>v.status==='fulfilled').length,1);await x.finish(saved);assert.equal(saved.status,'completed',saved.error);assert.equal(x.state.submissions.length,2);assert.deepEqual(saved.imageRetryHistory[0].gpu,originalGpu);assert.equal(saved.imageRetryHistory.length,1);}finally{await x.cleanup();}
 });
 await check('A cancellation arriving during worker verification wins over image retry',async()=>{
  const {x,r}=await failedImage();try{const before=H.clone(r.gpu),api=x.sequences.api;x.sequences.api=async(...args)=>{const value=await api(...args);if(args[1]==='/health')r.cancelRequested=true;return value;};await assert.rejects(x.agent.handle({action:'retry-image',id:r.id,confirm:true,recoveryStamp:x.agent.imageRecovery(r).stamp,planner}),/changed/);assert.deepEqual(r.gpu,before);assert.equal(r.usage.images,1);assert.equal(x.state.submissions.length,1);assert.equal(r.imageRetryHistory,undefined);r.cancelRequested=false;}finally{await x.cleanup();}
 });
 await check('Unrelated image errors are not mistaken for a safe prompt-mode retry',async()=>{
  const x=await harness();try{x.state.failNextImage='CUDA out of memory';const r=await x.start();await x.finish(r);assert.equal(r.pausedReason,'IMAGE_FAILED');assert.equal(x.agent.imageRecovery(r),null);await assert.rejects(x.agent.handle({action:'retry-image',id:r.id,confirm:true,recoveryStamp:'x'}),/No confirmed/);assert.equal(x.state.submissions.length,1);}finally{await x.cleanup();}
 });
 console.log(`\n${count} reference-plan recovery checks passed. Actual local HTTP/FFmpeg/storage; vision decisions and GPU jobs are fixtures.`);
} finally {await rm(testRoot,{recursive:true,force:true});}
