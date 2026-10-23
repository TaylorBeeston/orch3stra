/** CPU-only transport/metadata regression. No provider, GPU, model dispatch or downloads. */
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {toolDefinition,validateArguments} from '../agent-catalog.mjs';
import {createRequire} from 'node:module';
import {StudioStore} from '../studio-server.mjs';
import {RenderIntents} from '../render-intent-server.mjs';
import {MediaTools} from '../agent-media.mjs';
const require=createRequire(import.meta.url),H=require('../core.js'),exec=promisify(execFile);
const root=await mkdtemp(join(tmpdir(),'orch3stra-agent-media-'));
const calls=[],jobs=new Map();let intents,server,dialogueCaps=0;
try{
 const image=join(root,'source.png'),audio=join(root,'source.wav');
 await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=32x32','-frames:v','1','-threads','1',image]);
 await exec('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-c:a','pcm_s16le',audio]);
 const png=await readFile(image),wav=await readFile(audio);
 server=createServer(async(req,res)=>{
  calls.push(req.method+' '+req.url);
  if(req.headers.authorization!=='Bearer fixture-secret'){res.writeHead(403);res.end();return;}
  const u=new URL(req.url,'http://localhost');let value;
  if(u.pathname==='/health')value={instance:'fixture-worker',capabilities:{reference_images:true,reference_voices:true,music:true,bounded_continuation:1,voice_dialogue:dialogueCaps}};
  else if(u.pathname==='/image-model')value={metadata:{model_type:'fixture-image'},profile:{kind:'reference_image',max_references:10,default_steps:40,default_guidance:4},image_profiles:[{id:'fixture-curated-profile',steps:6,guidance:1}]};
  else if(u.pathname==='/voice-model'&&u.searchParams.get('model_type')==='fixture-fish')value={metadata:{model_type:'fixture-fish'},profile:{kind:'reference_voice',architecture:'fish_drama3',languages:['auto'],script:true,max_speakers:16,max_voice_references:3,max_seconds:300}};
  else if(u.pathname==='/voice-model')value={metadata:{model_type:'fixture-voice'},profile:{kind:'reference_voice',languages:['english']}};
  else if(u.pathname==='/music-model')value={metadata:{model_type:'fixture-music'},profile:{kind:'music'}};
  else if(u.pathname==='/model')value={metadata:{model_type:'fixture-video'},profile:{inference_mode:'standard',samplers:['euler'],max_phases:2}};
  else if(u.pathname==='/upload'){const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);assert(body.equals(png)||body.equals(wav));value={media_id:'h3media:'+(body.equals(png)?'a':'d').repeat(32)};}
  else if(u.pathname.startsWith('/jobs/')){
   const [, ,id,suffix,outputId]=u.pathname.split('/'),job=jobs.get(id);
   if(!job){res.writeHead(404);res.end(JSON.stringify({error:'missing fixture job'}));return;}
   if(suffix==='outputs'){
    if(outputId!==job.state.outputs[0].id){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':job.type,'Content-Length':job.bytes.length});res.end(job.bytes);return;
   }
   value=suffix==='metadata'?{project_id:job.state.project_id,job:job.state,snapshot:job.snapshot,plan:[]}:job.state;
  }else{res.writeHead(400);res.end(JSON.stringify({error:'Unexpected fixture request; generation is forbidden'}));return;}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port,backend={target:async()=>({base,token:'fixture-secret'})};
 const studio=new StudioStore(join(root,'studio'));await studio.ready;intents=new RenderIntents(studio);await intents.ready;
 const tools=new MediaTools({studio,backend,renderIntents:intents});
 const project=H.newProject();project.mode='independent';project.modelType='fixture-video';project.inferenceMode='standard';project.presetConfirmed=true;project.settings={num_inference_steps:20,sample_solver:'euler',guidance_phases:1,guidance_scale:4,flow_shift:3};
 project.windows[0].detail='[Shot 1] A blue sphere slowly rolls across a white tabletop.';project.windows[0].summary='A sphere rolls across a table.';
 project.windows[0].soundscape='Quiet room tone and a soft rolling sound against the tabletop.';
 project.windows.push({...H.newWindow(),detail:'[Shot 1] The blue sphere comes to rest.',summary:'The sphere stops.',overlap:0});
 project.subjects.push({id:'voice-subject',number:1,name:'Narrator',description:'An original fictional narrator.',voiceDesign:'Warm lower register with measured, clear delivery.',assetIds:[],voiceAssetId:'',speakerId:''});
 let record=await studio.putProject(project,null);
 const write=async(tool,args)=>{const reply=await tools.handle(tool,{projectId:record.id,expectedRevision:record.serverRevision,...args});if(reply.record)record=reply.record;return reply;};
 await studio.putBlob('uploaded-image',createReadStream(image),png.length,'application/octet-stream');
 // An executable override must inspect the real immutable bytes, not be ignored.
 const probeWrapper=join(root,'probe-wrapper.mjs'),probeLog=join(root,'probe-args.json'),configuredProbe=process.env.FFPROBE_BIN;
 await writeFile(probeWrapper,`#!${process.execPath}\nimport {writeFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';const args=process.argv.slice(2);writeFileSync(${JSON.stringify(probeLog)},JSON.stringify(args));const result=spawnSync(${JSON.stringify(configuredProbe||'ffprobe')},args,{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);\n`,{mode:0o700});
 let registered;
 try{process.env.FFPROBE_BIN=probeWrapper;registered=await write('references',{action:'register',key:'uploaded-image',name:'source.png',kind:'image',destination:'references'});}
 finally{if(configuredProbe===undefined)delete process.env.FFPROBE_BIN;else process.env.FFPROBE_BIN=configuredProbe;}
 assert.equal(JSON.parse(await readFile(probeLog,'utf8')).at(-1),studio.blobPath('uploaded-image'));
 assert.equal(registered.asset.width,32);assert.equal(registered.asset.type,'image/png');assert.match(registered.asset.sha256,/^[a-f0-9]{64}$/);
 await assert.rejects(tools.handle('references',{action:'classify',projectId:record.id,expectedRevision:1,assetId:registered.asset.id,kind:'direct'}),e=>e.code==='REVISION_CONFLICT');
 // Agent attestations never impersonate human approval of protected pixels.
 const inspectionProject=H.newProject();inspectionProject.assets=[H.clone(registered.asset)];inspectionProject.counters.image=1;
 inspectionProject.windows[0].referencePolicy={requirements:[{id:'blue-prop',role:'prop',description:'Blue fixture prop',assetIds:[registered.asset.id]}]};
 inspectionProject.referenceBoard={version:3,scenes:[],annotations:{[registered.asset.id]:{approved:false}}};
 let inspectionRecord=await studio.putProject(inspectionProject,null);
 const inspectArgs=()=>({action:'recordInspection',projectId:inspectionRecord.id,expectedRevision:inspectionRecord.serverRevision,windowId:inspectionRecord.project.windows[0].id,assetId:registered.asset.id,requirementIds:['blue-prop'],pixelsInspected:true,reason:'The synthetic fixture shows the required solid blue prop color.'});
 const protectedInspection=async()=>{await assert.rejects(tools.handle('references',inspectArgs()),/cannot approve or unexclude a protected image/);assert.deepEqual(await studio.getProject(inspectionRecord.id),inspectionRecord);};
 await protectedInspection();
 inspectionRecord.project.referenceBoard.annotations[registered.asset.id].approved=true;
 inspectionRecord.project.windows[0].excludedAssetIds=[registered.asset.id];
 inspectionRecord=await studio.putProject(inspectionRecord.project,inspectionRecord.serverRevision);
 await protectedInspection();
 inspectionRecord.project.windows[0].excludedAssetIds=[];
 inspectionRecord.project.assets[0].generationExcluded=true;
 inspectionRecord=await studio.putProject(inspectionRecord.project,inspectionRecord.serverRevision);
 await protectedInspection();
 inspectionRecord.project.assets[0].generationExcluded=false;
 inspectionRecord=await studio.putProject(inspectionRecord.project,inspectionRecord.serverRevision);
 const inspected=await tools.handle('references',inspectArgs());
 const evidence=inspected.record.project.windows[0].referencePolicy.coverageEvidence[registered.asset.id];
 assert.equal(evidence.length,1);assert.equal(evidence[0].authority,'vision-agent');
 assert.equal(evidence[0].review.kind,'explicit-caller-pixel-attestation');assert.equal(evidence[0].review.sha256,registered.asset.sha256);
 const planned=await write('references',{action:'planImages',proposal:{images:[{title:'Blue prop',prompt:'A blue sphere on a white tabletop, using <image1> as the prop reference.',referenceIds:[registered.asset.id]}]}});
 const imageArgs={planId:planned.plan.id,cardIds:[planned.plan.images[0].id],settings:{modelType:'fixture-image'},licenseAccepted:true,requestId:'image-request'};
 const review=await tools.handle('generation',{action:'buildImages',projectId:record.id,...imageArgs});assert.equal(review.missingUploads.length,1);assert.equal(review.packet,null);assert.equal(calls.filter(s=>s.startsWith('POST')).length,0);
 await assert.rejects(write('generation',{action:'prepareImages',...imageArgs,settings:{modelType:'fixture-image',accelerationProfile:'/arbitrary/lora.safetensors'}}),/not in the discovered/);
 const prepared=await write('generation',{action:'prepareImages',...imageArgs});assert.equal(prepared.operation.tool,'worker');assert.equal(prepared.operation.arguments.path,'/generate');assert.equal(prepared.operation.arguments.body.tasks[0].image_refs[0],'h3media:'+'a'.repeat(32));assert.equal(prepared.operation.arguments.body.tasks[0].license_accepted,true);assert(!JSON.stringify(record.project).includes('licenseAccepted'));assert(!JSON.stringify(record.project).includes('license_accepted'));
 await assert.rejects(write('generation',{action:'prepareImages',...imageArgs}),e=>e.code==='REQUEST_ALREADY_PREPARED');
 function completed(id,snapshot,kind,bytes,type,owner=record.id){const outputId=(kind==='image'?'b':'c').repeat(32);jobs.set(id,{snapshot,bytes,type,state:{job_id:id,project_id:owner,request_id:id+'-request',operation:snapshot.kind==='reference-images'?'reference_image':snapshot.kind==='reference-voices'?'reference_voice':'music',status:'completed',outputs:[{id:outputId,name:kind==='image'?'candidate.png':'candidate.wav',task_index:1,available:true,media_kind:kind,content_type:type}]}});return outputId;}
 const outputId=completed('image-job',prepared.operation.arguments.body.snapshot,'image',png,'image/png');
 const adopted=await write('references',{action:'adoptImage',jobId:'image-job',outputId});assert.equal(adopted.asset.width,32);assert.equal(adopted.asset.provenance.jobId,'image-job');
 const foreignId=completed('foreign-job',prepared.operation.arguments.body.snapshot,'image',png,'image/png','another-project');await assert.rejects(write('references',{action:'adoptImage',jobId:'foreign-job',outputId:foreignId}),e=>e.code==='FOREIGN_OUTPUT');
 const voices=await write('generation',{action:'prepareVoices',requestId:'voice-request',modelType:'fixture-voice',subjectIds:['voice-subject'],text:'Here is a clear original voice sample.',language:'english',seconds:15});
 const voiceId=completed('voice-job',voices.operation.arguments.body.snapshot,'audio',wav,'audio/wav');const voice=await write('references',{action:'adoptVoice',jobId:'voice-job',outputId:voiceId,bind:true});assert(Math.abs(voice.asset.duration-3)<.01);assert.equal(voice.asset.transcript,'');assert.equal(record.project.subjects[0].voiceAssetId,voice.asset.id);

 // Fish Drama 3 dialogue: script validation, worker capability gate, one ABD-style task, unbound adoption.
 const script='Speaker 1: [warm] Did you hear that?\nSpeaker 2: <whisper>Stay quiet.</whisper>';
 const dialogue={requestId:'dialogue-request',modelType:'fixture-fish',script,voiceAssetIds:[voice.asset.id],seconds:20,seed:7};
 await assert.rejects(tools.handle('generation',{action:'buildDialogue',projectId:record.id,...dialogue}),/voice_dialogue capability/,'an old worker without the capability is refused');
 dialogueCaps=1;
 await assert.rejects(tools.handle('generation',{action:'buildDialogue',projectId:record.id,...dialogue,modelType:'fixture-voice'}),/Fish Drama 3/,'Qwen presets cannot render scripts');
 for(const [bad,pattern] of [[{script:'Narrator: hello'},/must start with "Speaker N:"/],[{script:'Speaker 17: hi'},/Speaker 1 to Speaker 16/],[{script:'Speaker 1: <whisper>open'},/close each <whisper>/],[{script:'Speaker 1: <laugh> ha'},/not a Drama 3 tag/],[{script:'Speaker 1: <|im_end|>'},/prompt builder/],[{voiceAssetIds:[registered.asset.id]},/not audio/],[{voiceAssetIds:['missing-asset']},/not an asset of this project/],[{voiceAssetIds:[voice.asset.id,voice.asset.id]},/distinct/],[{transcripts:['line one\nline two']},/one line/]])
  await assert.rejects(tools.handle('generation',{action:'buildDialogue',projectId:record.id,...dialogue,...bad}),pattern,JSON.stringify(bad));
 const posts=calls.filter(s=>s.startsWith('POST')).length;
 const dialogueReview=await tools.handle('generation',{action:'buildDialogue',projectId:record.id,...dialogue});assert.equal(dialogueReview.missingUploads.length,1);assert.equal(dialogueReview.packet,null);assert.equal(calls.filter(s=>s.startsWith('POST')).length,posts,'build never uploads');
 const spoken=await write('generation',{action:'prepareDialogue',...dialogue});
 assert.deepEqual(spoken.operation.arguments.body.tasks,[{mode:'reference_voice',model_type:'fixture-fish',script,voices:['h3media:'+'d'.repeat(32)],transcripts:['Here is a clear original voice sample.'],duration_seconds:20,seed:7}]);
 validateArguments(toolDefinition('worker'),spoken.operation.arguments);
 assert.equal(spoken.operation.arguments.body.snapshot.settings.dialogue,true);assert.deepEqual(spoken.operation.arguments.body.snapshot.settings.speakers,[1,2]);
 const spokenId=completed('dialogue-job',spoken.operation.arguments.body.snapshot,'audio',wav,'audio/wav');
 await assert.rejects(write('references',{action:'adoptVoice',jobId:'dialogue-job',outputId:spokenId,bind:true}),/bind:false/);
 const track=await write('references',{action:'adoptVoice',jobId:'dialogue-job',outputId:spokenId,bind:false});
 assert.match(track.asset.name,/^Dialogue /);assert.equal(track.asset.kind,'audio');assert.equal(track.asset.provenance.intendedText,script);
 assert(record.project.assets.some(a=>a.id===track.asset.id));assert.equal(record.project.subjects[0].voiceAssetId,voice.asset.id,'dialogue never rebinds a subject voice');
 const music=await write('generation',{action:'prepareMusic',requestId:'music-request',modelType:'fixture-music',lyrics:'A blue sphere rolls along',style:'Gentle acoustic vocal song',seconds:10,seed:42});assert.equal(music.operation.arguments.body.tasks[0].num_inference_steps,32);
 const musicId=completed('music-job',music.operation.arguments.body.snapshot,'audio',wav,'audio/wav');const song=await write('references',{action:'adoptMusic',jobId:'music-job',outputId:musicId});assert(record.project.postMedia.some(a=>a.id===song.asset.id));assert(!record.project.assets.some(a=>a.id===song.asset.id));
 const post=await write('references',{action:'toPost',assetId:registered.asset.id});assert.equal(post.asset.sha256,registered.asset.sha256);
 // Binding a voice introduces an explicit speaker-ID validation requirement.
 record.project.subjects[0].speakerId='S1';
 record.project.jobs.push({id:'historical-job',snapshot:{jobs:[{id:'older-job',snapshot:{jobs:[{id:'oldest-job'}]}}]}});
 record.project.variants.push({id:'historical-variant',snapshot:{jobs:record.project.jobs}});
 record.project.voiceWorkshops=[{id:'historical-voice',blobKey:'voice:historical-voice',duration:3,segments:[],peaks:[.1,.2]}];
 record=await studio.putProject(record.project,record.serverRevision);
 const history=H.clone({jobs:record.project.jobs,variants:record.project.variants,voiceWorkshops:record.project.voiceWorkshops});
 const assertHistory=p=>{for(const key of Object.keys(history))assert.deepEqual(p[key],history[key]);};
 const assertCompact=p=>{for(const key of Object.keys(history))assert.deepEqual(p[key],[]);assert(!JSON.stringify(p).includes('oldest-job'));};
 const video=await write('generation',{action:'prepareVideo',requestId:'video-request',owner:'fixture-owner',runId:'fixture-run',windowIds:[record.project.windows[0].id],strategy:'independent',context:'fresh'});
 assert.equal(video.operation.arguments.body.plan.length,1);assert.equal(video.record.project.windows.length,2);assert.equal(video.intent.requestId,'video-request');assert.equal(video.operation.arguments.intent.id,video.intent.id);
 assertCompact(video.operation.arguments.body.snapshot);assertHistory(video.record.project);
 // The unselected future window was intentionally unfinished above. Full-film
 // preparation requires completing its real authoring preconditions.
 record.project.windows[1].soundscape='The rolling sound slows and stops against quiet room tone.';
 record=await studio.putProject(record.project,record.serverRevision);
 const fullBuild=await tools.handle('generation',{action:'buildVideo',projectId:record.id,requestId:'full-build'});
 assertCompact(fullBuild.packet.snapshot);assertHistory((await studio.getProject(record.id)).project);
 const managedProject={...H.clone(record.project),id:H.uid(),mode:'managed'};
 const managedRecord=await studio.putProject(managedProject,null);
 const managedBuild=await tools.handle('generation',{action:'buildVideo',projectId:managedRecord.id,requestId:'managed-build'});
 assertCompact(managedBuild.packet.project);assertHistory((await studio.getProject(managedRecord.id)).project);
 const originalPut=studio.putProject.bind(studio);
 const argsFor=(requestId,owner='preparation-owner',runId='preparation-run')=>({action:'prepareVideo',projectId:record.id,expectedRevision:record.serverRevision,requestId,owner,runId});
 const ledger=()=>intents.handle({action:'list'});
 const exact=id=>intents.handle({action:'get',id});
 const cancel=id=>intents.handle({action:'cancel',id});
 const unchanged=H.clone(record);
 // Definite rejection neither poisons the stable ID nor cancels the blocker.
 await assert.rejects(tools.handle('generation',argsFor('blocked-request')),/existing render intention/);
 assert.deepEqual(await studio.getProject(record.id),unchanged);
 assert.deepEqual(await exact(video.intent.id),video.intent);
 assert(!(await ledger()).records.some(r=>r.requestId==='blocked-request'));
 await cancel(video.intent.id);
 const unblocked=await tools.handle('generation',argsFor('blocked-request'));record=unblocked.record;
 assert.equal(unblocked.intent.requestId,'blocked-request');assertCompact(unblocked.operation.arguments.body.snapshot);assertHistory(record.project);
 assert.equal((await ledger()).records.filter(r=>r.requestId==='blocked-request').length,1);
 await cancel(unblocked.intent.id);
 // A save race may cancel only the intent this preparation actually admitted.
 const foreignSession=await intents.handle({action:'begin-session',owner:'foreign-owner',runId:'foreign-run'});
 const foreign=await intents.handle({action:'prepare',owner:'foreign-owner',lease:foreignSession.lease,projectId:'foreign-project',mode:'independent',requestId:'foreign-request'});
 studio.putProject=async(p,revision)=>{
  if(p.agentGenerationRequests?.some(r=>r.requestId==='cas-race')){
   const current=await studio.getProject(p.id);current.project.name='Concurrent editor wins';await originalPut(current.project,current.serverRevision);
  }
  return originalPut(p,revision);
 };
 let casError;
 try{await assert.rejects(tools.handle('generation',argsFor('cas-race')),e=>{casError=e;return e.code==='REVISION_CONFLICT';});}
 finally{studio.putProject=originalPut;}
 const failedIntent=(await ledger()).records.find(r=>r.requestId==='cas-race');
 assert.equal(failedIntent.state,'cancelled');assert.equal(casError.details.intent.id,failedIntent.id);assert.equal(casError.details.intent.lease,failedIntent.lease);
 assert.equal(casError.details.cleanupError,undefined);assert.deepEqual(await exact(foreign.id),foreign);
 record=await studio.getProject(record.id);assert.equal(record.project.name,'Concurrent editor wins');assertHistory(record.project);
 assert(!record.project.agentGenerationRequests.some(r=>r.requestId==='cas-race'));
 await assert.rejects(tools.handle('generation',argsFor('cas-race')),/Request ID already owned/);
 assert.equal((await ledger()).records.filter(r=>r.requestId==='cas-race').length,1);
 // An arbitrary save failure also consumes/cancels exactly the new ownership.
 studio.putProject=async()=>{throw Error('Fixture disk save failure');};
 let saveError;
 try{await assert.rejects(tools.handle('generation',argsFor('save-failure')),e=>{saveError=e;return /Fixture disk save failure/.test(e.message);});}
 finally{studio.putProject=originalPut;}
 assert.equal(saveError.details.intent.requestId,'save-failure');assert.equal(saveError.details.intent.state,'cancelled');
 assert.deepEqual(await exact(foreign.id),foreign);
 assert.deepEqual(await studio.getProject(record.id),record);
 // Separate consumers racing different runs of one owner cannot let the loser
 // supersede the winner's lease after both loaded the same serverRevision.
 let saveEntered,releaseSave,secondDiscovered;
 const entered=new Promise(resolve=>{saveEntered=resolve;}),release=new Promise(resolve=>{releaseSave=resolve;}),discovered=new Promise(resolve=>{secondDiscovered=resolve;});
 studio.putProject=async(p,revision)=>{if(p.agentGenerationRequests?.some(r=>r.requestId==='race-winner')){saveEntered();await release;}return originalPut(p,revision);};
 const secondTools=new MediaTools({studio,backend,renderIntents:intents}),discover=secondTools.discover.bind(secondTools);
 secondTools.discover=async(...args)=>{const result=await discover(...args);secondDiscovered();return result;};
 let winner;
 try{
  const first=tools.handle('generation',argsFor('race-winner','race-owner','first-run'));
  await entered;
  const second=assert.rejects(secondTools.handle('generation',argsFor('race-loser','race-owner','second-run')),e=>e.code==='REVISION_CONFLICT');
  await discovered;releaseSave();winner=await first;await second;
 }finally{releaseSave();studio.putProject=originalPut;}
 record=winner.record;assert.deepEqual(await exact(winner.intent.id),winner.intent);
 assert(!(await ledger()).records.some(r=>r.requestId==='race-loser'));
 assert(!record.project.agentGenerationRequests.some(r=>r.requestId==='race-loser'));
 await cancel(winner.intent.id);
 // Native callers are not in the agent lock. Supersession during save must
 // return no ready/dispatch result, retaining a durable exact-ID stop marker.
 studio.putProject=async(p,revision)=>{await intents.handle({action:'begin-session',owner:'native-race-owner',runId:'native-replacement'});return originalPut(p,revision);};
 let superseded;
 try{await assert.rejects(tools.handle('generation',argsFor('native-race','native-race-owner','native-original')),e=>{superseded=e;return e.code==='PREPARATION_INVALIDATED';});}
 finally{studio.putProject=originalPut;}
 assert.equal(superseded.details.intent.requestId,'native-race');assert.equal(superseded.details.intent.state,'cancelled');
 record=await studio.getProject(record.id);assert(record.project.agentGenerationRequests.some(r=>r.requestId==='native-race'));
 await assert.rejects(tools.handle('generation',argsFor('native-race')),e=>e.code==='REQUEST_ALREADY_PREPARED');
 // A lost admission reply is uncertain, not proof that we own an intent we
 // may cancel. The authoritative ledger prevents a same-ID replay.
 let lostIntent;
 const lostReplyTools=new MediaTools({studio,backend,renderIntents:{handle:async b=>{const reply=await intents.handle(b);if(b.action==='prepare'){lostIntent=reply;throw Error('Fixture lost admission reply');}return reply;}}});
 await assert.rejects(lostReplyTools.handle('generation',argsFor('lost-admission')),/lost admission reply/);
 assert.equal((await exact(lostIntent.id)).state,'prepared');assert.deepEqual(await studio.getProject(record.id),record);
 await assert.rejects(tools.handle('generation',argsFor('lost-admission')),/existing render intention/);
 assert.deepEqual(await exact(lostIntent.id),lostIntent);
 await cancel(lostIntent.id);
 await assert.rejects(tools.handle('generation',argsFor('lost-admission')),/Request ID already owned/);
 // Supersession between begin-session and admission is a definite rejection,
 // not durable preparation. A later explicit session can use the same ID.
 const staleLeaseTools=new MediaTools({studio,backend,renderIntents:{handle:async b=>{
  if(b.action==='prepare')await intents.handle({action:'begin-session',owner:b.owner,runId:'lease-replacement'});
  return intents.handle(b);
 }}});
 await assert.rejects(staleLeaseTools.handle('generation',argsFor('stale-lease','lease-owner','lease-original')),/superseded or blocked preparation/);
 assert.deepEqual(await studio.getProject(record.id),record);
 assert(!(await ledger()).records.some(r=>r.requestId==='stale-lease'));
 const refreshed=await tools.handle('generation',argsFor('stale-lease','lease-owner','lease-refreshed'));record=refreshed.record;
 assert.equal(refreshed.intent.state,'prepared');await cancel(refreshed.intent.id);
 // If native dispatch wins the save-failure race, cancel must fail closed:
 // preserve uncertain ownership and surface cleanup/reconciliation details.
 let uncertainIntent;
 studio.putProject=async()=>{
  uncertainIntent=(await ledger()).records.find(r=>r.requestId==='uncertain-save');
  await assert.rejects(intents.dispatch({id:uncertainIntent.id,lease:uncertainIntent.lease},{projectId:record.id,mode:'independent',requestId:'uncertain-save'},async()=>{throw Error('Fixture unknown acceptance; no worker called');}),/unknown acceptance/);
  throw Error('Fixture save failure after uncertain ownership');
 };
 let uncertainError;
 try{await assert.rejects(tools.handle('generation',argsFor('uncertain-save')),e=>{uncertainError=e;return /save failure after uncertain/.test(e.message);});}
 finally{studio.putProject=originalPut;}
 assert.equal(uncertainError.details.intent.id,uncertainIntent.id);assert.match(uncertainError.details.cleanupError,/may have been sent/);
 assert.equal((await exact(uncertainIntent.id)).state,'uncertain');assert.deepEqual(await exact(foreign.id),foreign);
 assert.deepEqual(await studio.getProject(record.id),record);
 await assert.rejects(tools.handle('generation',argsFor('uncertain-save')),/existing render intention/);
 assert.equal((await ledger()).records.filter(r=>r.requestId==='uncertain-save').length,1);
 assert(!calls.some(s=>s==='POST /generate'),'No model dispatch is allowed in media tests');
 console.log('Agent media CPU transport/metadata checks passed; fixtures are not generated-film quality evidence.');
}finally{if(intents)await intents.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
