import {createRequire} from 'node:module';
import {loadProject,saveProject,createProject,agentError,workerJSON} from './agent-project-state.mjs';
import {PROJECT_TOOLS} from './agent-project-schema.mjs';
const require = createRequire(import.meta.url);
const H = require('./core.js');
const Clinic = require('./clinic-core.js');
const Film = require('./film-core.js');
const References = require('./reference-core.js');
const Edit = require('./edit-core.js');
const Render = require('./render-selection-core.js');
const Post = require('./post-core.js');
const Speech = require('./speech-quality-core.js');
const fail = message => {throw agentError('INVALID_ARGUMENT',message);};
const copy = H.clone;
const own = (value,key) => Object.hasOwn(value,key);
const pick = (value,keys) => Object.fromEntries(keys.filter(key=>own(value,key)).map(key=>[key,copy(value[key])]));
const WINDOW_FIELDS = ['title','frames','overlap','subjectIds','assetIds','casting','definitions','summary','retention','detail','soundscape','music','entry','exit','notes','exceptionalReason','exceptionalRisk','continuity'];
const TEXT_FIELDS = ['title','summary','detail','soundscape','music','entry','exit','notes'];
const getWindow = (p,id) => p.windows.find(w=>w.id===id) || fail('Unknown window. Refresh project get for current window IDs.');
const getSubject = (p,id) => p.subjects.find(s=>s.id===id) || fail('Unknown subject. Register it with subjects upsert first.');
function windows(p,ids) {return ids ? Render.ordered(p,ids).map(id=>getWindow(p,id)) : p.windows;}
function voice(p,id) {
  if(!id)return;
  const a=p.assets.find(a=>a.id===id&&a.kind==='audio');
  if(!a||!Number.isFinite(a.duration)||a.duration<=0)fail('Voice binding requires an owned, measured audio reference. Register the real recording first; project validation separately enforces the shared 15-second conditioning budget.');
  H.assertGenerationInputs(p,[id]);
}
function cast(p,w) {
  if(new Set(w.subjectIds).size!==w.subjectIds.length||w.subjectIds.some(id=>!p.subjects.some(s=>s.id===id)))fail('Window cast must use unique registered subject IDs.');
  if(w.assetIds.some(id=>!p.assets.some(a=>a.id===id)))fail('Window references must be registered assets.');
  const c=H.normalizeCasting(w.casting,p);
  if(Object.keys(c).some(id=>!w.subjectIds.includes(id))||w.subjectIds.some(id=>!c[id]))fail('Provide one casting entry for every active subject, and no inactive subjects.');
  const shots=H.shotNumbers(w);
  for(const [id,row] of Object.entries(c)) {
    if([...row.visibleShots,...row.voiceShots].some(n=>!shots.includes(n)))fail('Casting shot numbers must exist in this window detailed description.');
    if(row.voiceShots.length&&['place','prop'].includes(getSubject(p,id).kind))fail('Places and props cannot be cast as speaking voices.');
  }
  w.casting=c;
}
function authorWindow(p,old,value) {
  const unknown=Object.keys(value).filter(k=>!WINDOW_FIELDS.includes(k));
  if(unknown.length)fail('Unsupported window fields: '+unknown.join(', '));
  const w={...old,...pick(value,WINDOW_FIELDS)};
  cast(p,w);
  return w;
}
function assertTiming(p,changed) {
  const rows=H.schedule(p);
  for(const w of changed)H.assertPlannerWindow(p,w,rows.find(r=>r.id===w.id));
}
export class ProjectTools {
  constructor(services) {Object.assign(this,services);}
  async speechAlternative(projectId,jobId,requestId) {
    const records=await this.speechQuality.handle({action:'list'});
    const matches=(records.jobs||[]).flatMap(record=>(record.attempts||[])
      .filter(attempt=>attempt.jobId===jobId||requestId&&attempt.requestId===requestId)
      .map(attempt=>({record,attempt})));
    if(!matches.length) {
      if(typeof requestId==='string'&&/^speech_[a-f0-9]{32}_[a-f0-9]{24}$/.test(requestId))fail('Speech repair origin is unavailable. Restore its owning speech analysis and reconcile the attempt before adopting or choosing it.');
      return null;
    }
    if(matches.length!==1)fail('Speech repair ownership is ambiguous. Resolve the owning analysis before adopting or choosing it.');
    const {record,attempt}=matches[0];
    if(record.edit?.projectId!==projectId||attempt.snapshot?.id!==projectId||attempt.jobId!==jobId||
      requestId&&attempt.requestId!==requestId)fail('Speech repair does not match its owning analysis and project. Reconcile the attempt first.');
    if(attempt.status!=='completed'||attempt.native?.job_id!==jobId||attempt.native.status!=='completed'||
      !Array.isArray(attempt.descendants))fail('Speech repair is not reconciled as a completed alternative. Reconcile its owning analysis first.');
    return {speechAlternative:true,speechAnalysisId:record.id,speechDependencyReview:{descendants:copy(attempt.descendants),required:true},...(attempt.snapshot.branch?{branch:copy(attempt.snapshot.branch)}:{})};
  }
  async createDerived(args,project) {
    // Hold the source writer lock while rechecking the reviewed revision and creating
    // the distinct copy. A concurrent source edit must never silently produce a stale fork.
    return this.studio.serialize(args.projectId,async()=>{
      await loadProject(this.studio,args,{write:true});
      return createProject(this.studio,project);
    });
  }
  async handle(tool,args) {
    const descriptor=PROJECT_TOOLS.find(t=>t.name===tool);
    if(!descriptor||!own(descriptor.effectsByAction,args.action))throw agentError('UNKNOWN_ACTION','Unknown project tool or action.');
    if(tool==='project'&&args.action==='list'){await this.studio.ready;return {projects:await this.studio.listProjects()};}
    if(tool==='project'&&args.action==='create') {
      const p=H.newProject();Object.assign(p,pick(args,['name','request']));return createProject(this.studio,p);
    }
    const write=!descriptor.readActions.includes(args.action);
    const record=await loadProject(this.studio,args,{write});
    const p=record.project;
    if(tool==='project')return this.project(record,p,args,write);
    if(tool==='story')return this.story(record,p,args,write);
    if(tool==='subjects')return this.subjects(record,p,args);
    if(tool==='timeline')return this.timeline(record,p,args,write);
    return this.post(record,p,args,write);
  }
  async project(record,p,a) {
    switch(a.action) {
      case 'get':return record;
      case 'fields':return {projectId:p.id,serverRevision:record.serverRevision,fields:Clinic.fields(p)};
      case 'validate':return {projectId:p.id,serverRevision:record.serverRevision,issues:H.validate(p,a.forSend===true),clinic:Clinic.scan(p),schedule:H.schedule(p)};
      case 'export': {
        const selected=windows(p,a.windowIds);
        if(a.format==='project')return {project:copy(p),serverRevision:record.serverRevision};
        if(a.format==='prompts')return {projectId:p.id,serverRevision:record.serverRevision,prompts:selected.map(w=>({windowId:w.id,sections:H.compileSections(p,w,p.windows.indexOf(w)),prompt:H.compileWindow(p,w,p.windows.indexOf(w),p.mode!=='independent')})),compiled:H.compile(p)};
        if(a.format==='edit')return Edit.selection(p,a.windowIds);
        return Post.snapshot(p);
      }
      case 'patch':Clinic.applyPatches(p,a.patches,{allowDialogue:a.allowDialogue===true});break;
      case 'configure': {
        if(Object.keys(a).some(k=>/license|consent/i.test(k))||Object.keys(a.settings||{}).some(k=>/license|consent/i.test(k)))fail('License acceptance is per dispatch, never saved as project configuration.');
        if(a.modelType) {
          const catalogue=await workerJSON(this.backend,'/models');
          const model=catalogue.models?.find(m=>m.model_type===a.modelType);
          if(!model)fail('Model is absent from the configured worker catalogue. Discover current models before configuring.');
          const d=await workerJSON(this.backend,'/model?model_type='+encodeURIComponent(a.modelType));
          p.modelType=a.modelType;p.modelLabel=model.name||a.modelType;
          p.settings=copy(d.defaults||{});p.directorProfile=copy(d.director_profile||null);
          p.inferenceMode=d.director_profile?.inference_mode||(/pdd/i.test(a.modelType+' '+p.modelLabel)?'pdd8':'standard');
          p.presetConfirmed=false;
        }
        Object.assign(p,pick(a,['name','request','mode','resolution','seed','maxSpan','presetConfirmed','inferenceMode','allowAudioTruncation','audioOrder']));
        if(a.settings)p.settings={...p.settings,...a.settings};
        // Even discovered defaults must not carry reusable consent into a saved film.
        for(const key of Object.keys(p.settings))if(/license|consent/i.test(key))delete p.settings[key];
        if(a.plannerTiming)p.plannerTiming=H.normalizePlannerTiming({...p.plannerTiming,...a.plannerTiming});
        if(a.audioOrder?.some(id=>!p.assets.some(x=>x.id===id&&x.kind==='audio')))fail('Audio order must contain owned audio asset IDs.');
        const minimum=/h3_(?:ref2va|fl2va)(?:_|$)/i.test(p.modelType)?124:107;
        if((own(a,'maxSpan')||a.modelType)&&p.maxSpan<minimum)fail('Selected H3 model needs a window ceiling of at least '+minimum+' frames.');
        if((a.settings||a.modelType||a.inferenceMode)&&p.inferenceMode==='standard') {
          const x=p.settings;
          if(!Number.isInteger(Number(x.num_inference_steps))||x.num_inference_steps<1||x.num_inference_steps>200||!['euler','res_multistep','ralston_2s'].includes(x.sample_solver)||![1,2].includes(Number(x.guidance_phases)))fail('Standard inference requires discovered steps (1–200), supported sampler, and one or two guidance phases.');
        }
        break;
      }
    }
    return saveProject(this.studio,record,p);
  }
  async story(record,p,a) {
    if(a.action==='packet') {
      let system,packet;
      const selected=windows(p,a.windowIds);
      if(a.kind==='bootstrap'){system=Film.BOOT_SYSTEM;packet={brief:p.request,name:p.name,windowTiming:H.windowTiming(p)};}
      if(a.kind==='pacing'){system=H.STORY_SYSTEM;packet=H.storyPacket(p,a.options);}
      if(a.kind==='draft'){system=H.PLANNER_SYSTEM;packet=H.plannerPacket(p,selected);}
      if(a.kind==='soundscape'){system=H.SOUNDSCAPE_SYSTEM;packet=H.soundscapePacket(p,selected);}
      if(a.kind==='refinement'){system=Film.CHAT_SYSTEM;packet=Film.packet(p,a.history||[],a.request||p.request,{subjectId:a.subjectId,allowDialogue:a.allowDialogue===true});}
      return {projectId:p.id,serverRevision:record.serverRevision,system,packet};
    }
    if(a.action==='bootstrap') {
      const proposal=Film.parseBootstrap(JSON.stringify(a.proposal),p);
      if(!proposal.beats.length)fail('Question-only bootstrap cannot create a film. Answer the questions first.');
      return this.createDerived(a,Film.createFilm(p,proposal));
    } else if(a.action==='pace') {
      const proposal=H.parseStoryProposal(JSON.stringify(a.proposal),p,a.options);
      return this.createDerived(a,H.storyScaffold(p,proposal,a.options));
    } else if(a.action==='refine') {
      const options={allowDialogue:a.allowDialogue===true,allowedKeys:a.allowedKeys};
      const proposal=Film.parseEdits(JSON.stringify(a.proposal),p,options);
      return saveProject(this.studio,record,Film.applyEdits(p,proposal,options));
    } else if(a.action==='soundscape') {
      const ids=windows(p,a.windowIds).map(w=>w.id);
      const proposal=H.parseSoundscapeProposal(JSON.stringify(a.proposal),ids);
      for(const w of proposal.windows)getWindow(p,w.id).soundscape=w.soundscape;
    } else if(a.action==='applyDraft') {
      const ids=windows(p,a.windowIds).map(w=>w.id);
      const proposal=H.parseProposal(JSON.stringify(a.proposal),ids,p);
      for(const d of proposal.windows) {
        const w=getWindow(p,d.id);Object.assign(w,pick(d,TEXT_FIELDS));
        if(d.subjectIds)w.subjectIds=copy(d.subjectIds);
        if(d.casting)w.casting=copy(d.casting);
        if(d.referenceRequests) {
          if(d.referenceRequests.some(r=>r.subjectId&&!w.subjectIds.includes(r.subjectId)))fail('Reference requests must refer to active subjects in this window.');
          w.referenceRequests=copy(d.referenceRequests);
        }
        if(a.includeTiming)Object.assign(w,pick(d,['frames','overlap','exceptionalReason','exceptionalRisk']));
        cast(p,w);
      }
      for(const d of proposal.subjects||[])getSubject(p,d.id).description=d.description;
      if(a.includeTiming)assertTiming(p,windows(p,ids));
    }
    return saveProject(this.studio,record,p);
  }
  async subjects(record,p,a) {
    if(a.action==='upsert') {
      const old=a.subjectId?getSubject(p,a.subjectId):null;
      const input={...old,...pick(a,['name','description','retention','assetIds','voiceAssetId']),...(old?{id:old.id,number:old.number}:{})};
      voice(p,input.voiceAssetId);
      const subject=References.subjectDraft(p,input);
      Object.assign(subject,pick(a,['kind','voiceDesign']));
      const index=p.subjects.findIndex(s=>s.id===subject.id);
      if(index<0)p.subjects.push(subject);else p.subjects[index]=subject;
      p.counters.subject=Math.max(p.counters.subject||0,subject.number);
      if(own(a,'speakerId'))H.assignSpeaker(p,subject.id,a.speakerId);
      if(subject.voiceAssetId&&!subject.speakerId)fail('Assign a speaker ID before binding a voice recording.');
    } else if(a.action==='speaker')H.assignSpeaker(p,a.subjectId,a.speakerId);
    else if(a.action==='voiceBind') {
      const subject=getSubject(p,a.subjectId);voice(p,a.assetId);
      if(a.assetId&&!subject.speakerId)fail('Assign a speaker ID before binding a voice recording.');
      subject.voiceAssetId=a.assetId;
    } else {
      const w=getWindow(p,a.windowId);w.subjectIds=copy(a.subjectIds);w.casting=copy(a.casting);cast(p,w);
    }
    return saveProject(this.studio,record,p);
  }
  async timeline(record,p,a) {
    if(a.action==='inspect')return {projectId:p.id,serverRevision:record.serverRevision,windows:windows(p,a.windowIds),schedule:H.schedule(p),layout:Edit.layout(p),issues:H.validate(p),jobs:p.jobs};
    if(a.action==='renderPlan') {
      const review=Render.review(p,a.windowIds,a),options={strategy:a.strategy,seed:a.seed??p.seed};
      if(review.context==='prefix') {
        const prefix=p.mode==='managed'?Edit.continuationTail(p,review.start).edit:review.prefix;
        if(prefix) {
          if(!a.prefixFinishId)return {projectId:p.id,serverRevision:record.serverRevision,review,snapshot:null,requiredPrefixEdit:prefix,next:'Submit this exact edit to finish start, wait for completion, call finish context, then repeat with prefixFinishId. Nothing was rendered or submitted.'};
          const finished=await this.finishing.handle({action:'get',id:a.prefixFinishId});
          if(finished.status!=='completed'||finished.edit?.projectId!==p.id||JSON.stringify(finished.edit)!==JSON.stringify(prefix)||!finished.context)fail('Prefix finishing job must be completed for this exact current edit and have an existing finish context. Refresh review and prepare that prefix explicitly.');
          options.source=copy(finished.context);
          if(p.mode==='managed')options.source.timelineFrames=Edit.layout(p)[review.start].start;
        }
      } else if(a.prefixFinishId)fail('A fresh selection cannot adopt a prefix.');
      const snapshot=Render.snapshot(p,review.ids,options);
      return {projectId:p.id,serverRevision:record.serverRevision,review,snapshot,plan:H.renderPlan(snapshot),issues:H.validate(snapshot,true)};
    }
    if(a.action==='upsert') {
      const old=a.windowId?getWindow(p,a.windowId):H.newWindow();
      const w=authorWindow(p,old,a.window),index=p.windows.findIndex(x=>x.id===w.id);
      if(index<0)p.windows.push(w);else p.windows[index]=w;
      assertTiming(p,[w]);
    } else if(a.action==='insert') {
      if(a.anchorId!==null)getWindow(p,a.anchorId);
      const added=a.windows.map(value=>authorWindow(p,H.newWindow(),value));
      Edit.insert(p,{anchorId:a.anchorId,side:a.side,windows:added});assertTiming(p,added);
    } else if(a.action==='reorder') {
      if(a.windowIds.length!==p.windows.length||new Set(a.windowIds).size!==p.windows.length)fail('Reorder must include every window exactly once.');
      p.windows=a.windowIds.map(id=>getWindow(p,id));
    } else if(a.action==='remove') {
      const remove=new Set(windows(p,a.windowIds).map(w=>w.id));
      if(remove.size>=p.windows.length)fail('Keep at least one timeline window.');
      p.windows=p.windows.filter(w=>!remove.has(w.id));
      // Frozen jobs, source ranges and Post remain historical and immutable.
      for(const scene of p.referenceBoard?.scenes||[])scene.windowIds=scene.windowIds.filter(id=>!remove.has(id));
    } else if(a.action==='adoptJob') {
      let job;
      if(a.kind==='native') {
        const d=await workerJSON(this.backend,'/jobs/'+encodeURIComponent(a.jobId)+'/metadata');
        if(d.project_id!==p.id||d.snapshot?.id!==p.id||(d.job?.project_id&&d.job.project_id!==p.id))fail('Native job belongs to a different project.');
        if(!d.snapshot||!d.plan?.length||d.job?.job_id!==a.jobId)fail('Native metadata has no film snapshot/plan. Managed subtasks must be adopted through their owning sequence.');
        const j=d.job,{base}=await this.backend.target();
        job={id:j.job_id,status:j.status,name:j.project_name||d.snapshot.name,url:base,backend:'headless',createdAt:new Date(j.created_at*1000).toISOString(),plan:d.plan,snapshot:d.snapshot,live:j,submittedRevision:d.snapshot.revision};
        const alternative=await this.speechAlternative(p.id,j.job_id,j.request_id);
        if(!alternative&&p.jobs.find(existing=>existing.id===j.job_id)?.speechAlternative)fail('Speech repair origin is unavailable. Restore its owning speech analysis before adopting it.');
        if(alternative)Object.assign(job,alternative);
      } else if(a.kind==='managed') {
        job=await this.sequences.handle({action:'get',id:a.jobId});
        if(job.id!==a.jobId||job.snapshot?.id!==p.id)fail('Managed sequence belongs to a different project.');
      } else {
        const finished=await this.finishing.handle({action:'get',id:a.jobId});
        if(finished.edit?.projectId!==p.id||finished.status!=='completed'||!finished.renderJob||finished.renderJob.id!==a.jobId)fail('Adoption requires a completed owned generation edit export, not a Post master or incomplete job.');
        job=finished.renderJob;
      }
      const index=p.jobs.findIndex(j=>j.id===job.id);
      if(index<0)p.jobs.push(copy(job));else p.jobs[index]={...p.jobs[index],...copy(job)};
    } else {
      getWindow(p,a.windowId);
      if(a.action==='take') {
        const job=p.jobs.find(j=>j.id===a.jobId);
        if(!job)fail('Unknown take. Adopt its owning service job first.');
        const alternative=await this.speechAlternative(p.id,job.id,job.live?.request_id);
        if(job.speechAlternative&&!alternative)fail('Speech repair origin is unavailable. Restore its owning speech analysis before choosing it.');
        if(alternative&&(alternative.speechDependencyReview.descendants.length||p.postEdit)&&a.dependencyReview!==true)
          throw agentError('DEPENDENCY_REVIEW_REQUIRED','Fresh speech alternative: review linked descendants and joins. Post and subtitles remain frozen; rebuild them explicitly if needed. Repeat with dependencyReview:true only after review.',400,{speechAnalysisId:alternative.speechAnalysisId,descendants:alternative.speechDependencyReview.descendants,postFrozen:!!p.postEdit});
        if(alternative)Object.assign(job,alternative);
        Edit.chooseTake(p,a.windowId,a.jobId);
      }
      if(a.action==='automaticTake')Edit.automaticTake(p,a.windowId);
      if(a.action==='trim')Edit.trim(p,a.windowId,a.inFrame,a.outFrame);
      if(a.action==='resetTrim')Edit.resetTrim(p,a.windowId);
      if(a.action==='split')Edit.split(p,a.windowId,a.localFrame);
      if(a.action==='revalidate')Edit.revalidate(p,a.windowId);
    }
    return saveProject(this.studio,record,p);
  }
  async post(record,p,a) {
    if(a.action==='get')return {projectId:p.id,serverRevision:record.serverRevision,postEdit:p.postEdit||null,postMedia:p.postMedia||[]};
    if(a.action==='validate'||a.action==='exportPacket')return Post.snapshot(p);
    if(a.action==='create') {
      if(p.postEdit&&a.replaceExisting!==true)fail('Post already exists. Review it and explicitly set replaceExisting to start a new cut.');
      p.postEdit=Post.create(p,a.windowIds?windows(p,a.windowIds).map(w=>w.id):null);
    } else {
      if(!p.postEdit)fail('Create a Post cut from selected completed takes first.');
      const post=p.postEdit;
      const clip=id=>post.clips.find(c=>c.id===id)||fail('Unknown Post clip.');
      if(a.action==='clip')Object.assign(clip(a.clipId),a.changes);
      if(a.action==='master')Object.assign(post,a.changes);
      if(a.action==='cue') {
        const {kind,startFrame,...changes}=a.changes;
        const cue=post[kind].find(c=>c.id===a.cueId)||fail('Unknown Post cue.');
        Object.assign(cue,changes);
        if(startFrame!==undefined){if(startFrame>=Post.total(post))fail('Cue starts past the Post runtime.');cue.anchor=Post.anchor(post,startFrame);}
      }
      if(a.action==='removeCue') {
        if(!post[a.kind].some(c=>c.id===a.cueId))fail('Unknown Post cue.');
        post[a.kind]=post[a.kind].filter(c=>c.id!==a.cueId);
      }
      if(a.action==='placeAudio') {
        const asset=p.postMedia?.find(x=>x.id===a.assetId&&x.kind==='audio')||fail('Register owned audio in Post media first.');
        Post.placeMusic(post,Post.mediaRecord(asset),pick(a,['startFrame','endFrame','sourceInFrame','mode','fadeFrames']),a.placementKey);
      }
      if(a.action==='placeLogo') {
        const asset=p.postMedia?.find(x=>x.id===a.assetId&&x.kind==='image')||fail('Register owned image in Post media first.');
        Post.mediaRecord(asset);
        if(a.startFrame>=Post.total(post)||a.endFrame<=a.startFrame)fail('Choose a positive logo range within Post.');
        post.images.push({id:H.uid(),title:asset.name,assetId:asset.id,anchor:Post.anchor(post,a.startFrame),durationFrames:a.endFrame-a.startFrame,...pick(a,['x','y','width','opacity','fadeInFrames','fadeOutFrames'])});
      }
      if(a.action==='split')Post.split(post,a.clipId,a.localFrame);
      if(a.action==='remove')Post.remove(post,a.clipId);
      if(a.action==='cutRange')Post.cutRange(post,a.clipId,a.startFrame,a.endFrame);
      if(a.action==='captions') {
        if(a.clear&&own(a,'burn'))fail('Clear captions or change burn-in, not both.');
        if(a.clear)delete post.captions;
        else {if(!post.captions||!own(a,'burn'))fail('Attach observed captions first and supply burn, or clear:true.');post.captions.burn=a.burn;}
      }
      if(a.action==='attachCaptions')await this.attachCaptions(p,a.analysisId);
    }
    p.postEdit=Post.check(p.postEdit,(p.postMedia||[]).map(Post.mediaRecord));
    return saveProject(this.studio,record,p);
  }
  async attachCaptions(p,id) {
    const r=await this.speechQuality.handle({action:'get',id});
    if(r.id!==id||r.status!=='completed'||r.edit?.projectId!==p.id)fail('Captions require completed observed speech analysis owned by this project.');
    if(Speech.editStamp(Edit.selection(p))!==Speech.editStamp(r.edit))fail('Selected takes changed. Analyze the current retained edit; historical captions were not attached.');
    const words=r.result?.analyses?.find(a=>a.label==='retained-film'&&a.model==='small.en')?.words;
    if(!Array.isArray(words))fail('Observed retained transcript is unavailable. Intended dialogue is not evidence.');
    const out=[];
    for(const c of Post.layout(p.postEdit)) {
      const cut=r.edit.cuts.find(x=>x.windowId===c.windowId&&JSON.stringify(x.source)===JSON.stringify(c.source));
      if(!cut||c.inFrame<cut.inFrame||c.outFrame>cut.outFrame)fail('Post sources differ from the analyzed retained footage. Analyze matching sources before attaching captions.');
      const global=words.filter(w=>(w.start+w.end)/2>=cut.startFrame/24&&(w.start+w.end)/2<cut.endFrame/24).map(w=>({...w,start:w.start-cut.startFrame/24+cut.inFrame/24,end:w.end-cut.startFrame/24+cut.inFrame/24}));
      out.push(...Speech.retained(global,{sourceIn:c.inFrame/24,sourceOut:c.outFrame/24,globalStart:c.startFrame/24,rate:c.rate}));
    }
    p.postEdit.captions={analysisId:r.id,sourceStamp:Post.captionStamp(p.postEdit),words:out,burn:false};
  }
}
