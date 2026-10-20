/** Set-plate composition (reference_edit) against a fake studio. No worker, GPU, provider or downloads. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createRequire} from 'node:module';
import {AgentClient} from '../agent-client.mjs';
import {imageSize,buildSetPlateRequest,DEFAULT_EDIT_MODEL} from '../reference-edit.mjs';
import {toolDefinition,validateArguments,requiredEffects} from '../agent-catalog.mjs';
const require=createRequire(import.meta.url),R=require('../reference-core.js'),exec=promisify(execFile);
const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const tmp=await mkdtemp(join(tmpdir(),'orch3stra-reference-edit-'));

// Pure helpers.
assert.equal(DEFAULT_EDIT_MODEL,'qwen_image_21_7B');
assert.equal(R.setPlateResolution({width:768,height:1344}),'576x1024');
assert.equal(R.setPlateResolution({width:1920,height:1080}),'1024x576');
assert.equal(R.setPlateResolution(null),'1024x1024');
assert.equal(R.setPlateResolution({width:768,height:1344},{width:512,height:288}),'512x288');
for(const size of [{width:500,height:288},{width:512},{width:4096,height:512}])assert.throws(()=>R.setPlateResolution(null,size),/multiples of 32/);
const one=R.setPlatePrompt('same marble hall, reverse angle, the entrance door now behind the camera',1);
assert.match(one,/^Same location as <image1>\. New camera view: same marble hall, reverse angle/);
assert.doesNotMatch(one,/<image2>/);
assert.match(R.setPlatePrompt('wide shot',3),/<image2> to <image3> show the same place/);
assert.equal(R.setPlatePrompt('Turn <image1> around to face the door.',1),'Turn <image1> around to face the door.','explicit tokens are sent literally');
assert.equal(R.setPlatePrompt('Low angle.',1,{literal:true}),'Low angle.');
assert.throws(()=>R.setPlatePrompt('Combine <image1> and <image2>.',1),/missing <imageN>/);
assert.throws(()=>R.setPlatePrompt('   ',1),/Describe the new camera angle/);

// Catalogue contract.
const tool=toolDefinition('reference_edit');
assert.equal(tool.endpoint,null);
assert.deepEqual(requiredEffects(tool,{projectId:'film',sourceImage:'a.png',prompt:'x',dryRun:true}),['network']);
assert.deepEqual(requiredEffects(tool,{projectId:'film',sourceImages:['a','b'],prompt:'x',licenseAccepted:true}),['network','cpu','gpu']);
for(const bad of [{projectId:'film',prompt:'x'},{projectId:'film',sourceImage:'a',sourceImages:['b'],prompt:'x'},{projectId:'film',sourceImages:[],prompt:'x'},{projectId:'film',sourceImage:'a',prompt:'x',width:500,height:512},{projectId:'film',sourceImage:'a',prompt:'x',licenseAccepted:false},{projectId:'film',sourceImage:'a',prompt:'x',extra:1}])
 assert.throws(()=>validateArguments(tool,bad),e=>e.code==='INVALID_ARGUMENTS',JSON.stringify(bad));

// Real image headers measured from ffmpeg-made files.
const files={};
for(const [name,size] of [['hall.png','96x64'],['hall.jpg','64x96'],['hall.webp','80x48']]){files[name]=join(tmp,name);await exec('ffmpeg',['-v','error','-f','lavfi','-i','color=c=gray:s='+size,'-frames:v','1','-threads','1',files[name]]);}
assert.deepEqual(await imageSize(files['hall.png']),{width:96,height:64});
assert.deepEqual(await imageSize(files['hall.jpg']),{width:64,height:96});
assert.deepEqual(await imageSize(files['hall.webp']),{width:80,height:48});

// Fake studio: real AgentClient transport and the bridge's wire format.
const qwenInfo={metadata:{model_type:'qwen_image_21_7B',name:'Qwen Image 2.1 TextImage2Image 7B'},profile:{kind:'reference_image',max_references:10,supports_reference_images:true,architecture:'qwen_image_21_7B',default_steps:40,default_guidance:4,license:'Qwen Research License'},image_profiles:[{id:'viggle-turbo-v0.2.1-6step',name:'Viggle 6',steps:6,guidance:1}]};
const kreaRaw={metadata:{model_type:'krea2_raw',name:'Krea 2 RAW'},profile:{kind:'reference_image',max_references:0,default_steps:52,default_guidance:3.5}};
let state,received,behaviour;
const cameraRow=installed=>({id:'multiple-angles-v2',name:'Qwen-Image-2.1 Multiple-Angles v2',trigger:'<mva>',prompt_format:'<mva> {azimuth}, {elevation}[ close-up]',default_strength:1,license:'Apache-2.0',installed});
const plus2Info={metadata:{model_type:'qwen_image_edit_plus2_20B',name:'Qwen Image Edit Plus (2511) 20B'},profile:{kind:'reference_image',max_references:3,supports_reference_images:true,architecture:'qwen_image_edit_plus2_20B',default_steps:30,default_guidance:4,license:'Apache-2.0 (Qwen-Image-Edit-2511)',
 camera_loras:[{id:'multiple-angles-2511',name:'Qwen-Image-Edit-2511 Multiple-Angles (fal, 96 poses)',trigger:'<sks>',prompt_format:'<sks> {azimuth} {elevation} {distance}',default_strength:0.9,license:'Apache-2.0',installed:true}]},image_profiles:[]};
const withCamera=info=>behaviour.cameraLoras==='absent'?info:{...info,profile:{...info.profile,camera_loras:[cameraRow(behaviour.cameraLoras==='installed')]}};
function reset(){
 state={revision:4,project:{id:'film',name:'Marble Hall',windows:[{id:'w1',title:'Hall',subjectIds:[],assetIds:[]}],subjects:[],counters:{image:1},assets:[{id:'hall-asset',kind:'image',name:'Marble hall',number:1,width:1344,height:768,missing:false}]},plans:[],adopted:null};
 received=[];behaviour={generate:'ok',jobStatus:'completed',cameraLoras:'installed',dropLora:false};
}
const record=()=>({id:'film',serverRevision:state.revision,project:state.project});
const bump=()=>{state.revision++;return record();};
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks);
 const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(req.url==='/api/health')return reply({app:'h3-director-bridge',token:'test-token'});
 if(req.url.startsWith('/api/studio-blob?key=')){received.push({route:'upload',bytes:raw.length,type:req.headers['content-type']});return reply({ok:true});}
 const input=raw.length?JSON.parse(raw):null;received.push({route:req.url,input});
 if(req.url==='/api/agent'){
  const {tool,arguments:a}=input;
  const write=()=>{if(a.expectedRevision!==state.revision)return reply({code:'REVISION_CONFLICT',error:'stale'},409),false;return true;};
  if(tool==='project'&&a.action==='get')return reply(record());
  if(tool==='generation'&&a.action==='discover')return reply(a.modelType==='krea2_raw'?kreaRaw:a.modelType==='qwen_image_edit_plus2_20B'?plus2Info:withCamera(qwenInfo));
  if(tool==='references'&&a.action==='register'){if(!write())return;const asset={id:'registered-'+state.project.assets.length,kind:'image',name:a.name,number:++state.project.counters.image,width:96,height:64,missing:false};state.project.assets.push(asset);return reply({record:bump(),asset});}
  if(tool==='references'&&a.action==='planImages'){if(!write())return;const plan={...R.parsePlan(JSON.stringify(a.proposal),state.project),id:'plan-1'};state.plans.push(plan);return reply({record:bump(),plan});}
  if(tool==='generation'&&a.action==='prepareImages'){if(!write())return;assert.equal(a.licenseAccepted,true);const plan=state.plans.find(p=>p.id===a.planId),card=plan.images.find(c=>c.id===a.cardIds[0]),uploaded=Object.fromEntries(card.referenceIds.map((id,i)=>[id,'h3media:'+String(i+1).repeat(32)]));const info=a.settings.modelType==='krea2_raw'?kreaRaw:withCamera(qwenInfo);const {request}=buildSetPlateRequest({project:state.project,card,info,model:a.settings.modelType,requestId:a.requestId,resolution:a.settings.resolution,seed:a.settings.seed,steps:a.settings.steps,guidance:a.settings.guidance,accelerationProfile:a.settings.accelerationProfile,...(behaviour.dropLora?{}:{cameraLora:a.settings.cameraLora,cameraLoraStrength:a.settings.cameraLoraStrength}),uploaded});return reply({record:bump(),ready:true,operation:{tool:'worker',arguments:request},reconciliation:{tool:'worker',arguments:{path:'/requests/'+a.requestId,method:'GET'}}});}
  if(tool==='references'&&a.action==='adoptImage'){if(!write())return;const asset={id:'adopted-asset',kind:'image',name:'set plate.png',number:++state.project.counters.image,type:'image/png',width:1024,height:576,sha256:'f'.repeat(64)};{const {_allow,...rest}=a;state.adopted=rest;}state.project.assets.push(asset);return reply({record:bump(),asset,jobId:a.jobId,outputId:a.outputId});}
  return reply({error:'unexpected agent call '+tool+' '+a.action},400);
 }
 if(req.url==='/api/wangp'){
  if(input.path==='/generate'){if(behaviour.generate==='lost'){res.destroy();return;}return reply({job_id:'a'.repeat(32),status:'queued'});}
  if(input.path==='/jobs/'+'a'.repeat(32))return reply({job_id:'a'.repeat(32),status:behaviour.jobStatus,outputs:behaviour.jobStatus==='completed'?[{id:'b'.repeat(32),media_kind:'image',task_index:1,available:true}]:[]});
 }
 reply({error:'unknown route'},404);
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const url='http://127.0.0.1:'+server.address().port,client=new AgentClient({url});
const generates=()=>received.filter(r=>r.route==='/api/wangp'&&r.input.path==='/generate');
const mutations=()=>received.filter(r=>r.route==='upload'||r.route==='/api/wangp'&&r.input.method==='POST'||r.route==='/api/agent'&&!['get','discover'].includes(r.input.arguments.action));
try{
 // Admission happens before HTTP.
 reset();
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',licenseAccepted:true,_allow:['network','cpu']}),e=>e.code==='AUTHORIZATION_REQUIRED');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',_allow:['network','cpu','gpu']}),e=>e.code==='LICENSE_REQUIRED');
 assert.equal(received.length,0,'no HTTP before authorization and licence');

 // Dry run: exact validated worker request, nothing written.
 const dry=await client.call('reference_edit',{projectId:'film',sourceImages:['hall-asset',files['hall.png']],prompt:'same marble hall, reverse angle, the entrance door now behind the camera',seed:7,dryRun:true,_allow:['network']});
 assert.equal(dry.submitted,false);assert.equal(mutations().length,0,'dry run never uploads, saves or submits');
 assert.equal(dry.resolution,'1024x576','resolution follows the first source aspect');
 const task=dry.workerRequest.body.tasks[0];
 assert.deepEqual(Object.keys(dry.workerRequest),['path','method','body']);
 assert.equal(task.mode,'reference_image');assert.equal(task.model_type,'qwen_image_21_7B');assert.equal(task.image_refs.length,2);
 assert.ok(task.image_refs.every(r=>/^h3media:[a-f0-9]{32}$/.test(r)));assert.match(task.prompt,/<image1>.*<image2>/s);
 assert.equal(task.num_inference_steps,40);assert.equal(task.guidance_scale,4);assert.equal(task.seed,7);assert.equal(task.multi_prompts_gen_type,'FG');
 assert.equal(dry.sources[1].willUpload,true);assert.equal(dry.sources[1].width,96);
 assert.equal(JSON.stringify(dry.workerRequest.body.snapshot).includes('licenseAccepted'),false,'licence consent is never saved in the snapshot');
 validateArguments(toolDefinition('worker'),dry.workerRequest);
 const fast=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',width:512,height:288,accelerationProfile:'viggle-turbo-v0.2.1-6step',dryRun:true,_allow:['network']});
 assert.equal(fast.workerRequest.body.tasks[0].num_inference_steps,6);assert.equal(fast.workerRequest.body.tasks[0].guidance_scale,1);assert.equal(fast.workerRequest.body.tasks[0].acceleration_profile,'viggle-turbo-v0.2.1-6step');assert.equal(fast.workerRequest.body.tasks[0].resolution,'512x288');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'x',accelerationProfile:'made-up',dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'x',model:'krea2_raw',dryRun:true,_allow:['network']}),e=>e.code==='MODEL_UNSUPPORTED','text-only presets are refused, inputs never dropped');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:join(tmp,'missing.png'),prompt:'x',dryRun:true,_allow:['network']}),e=>e.code==='SOURCE_NOT_FOUND');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'Use <image2>.',dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS');
 assert.equal(mutations().length,0);

 // Full run: register path source, plan, prepare, ONE generate, wait, adopt with window attachment.
 reset();
 const done=await client.call('reference_edit',{projectId:'film',sourceImages:['hall-asset',files['hall.webp']],prompt:'reverse angle, the entrance door now behind the camera',seed:7,windowIds:['w1'],requestId:'set_plate_test_1',licenseAccepted:true,_allow:['network','cpu','gpu']});
 assert.equal(done.outcome,'completed');assert.equal(done.assetId,'adopted-asset');assert.equal(done.pictureToken,'<Picture 3>');assert.equal(done.mediaUrl,'/api/studio-blob?key=adopted-asset');
 assert.equal(generates().length,1);assert.equal(received.filter(r=>r.route==='upload').length,1);
 assert.deepEqual(state.adopted,{action:'adoptImage',projectId:'film',expectedRevision:7,jobId:'a'.repeat(32),outputId:'b'.repeat(32),attachWindows:true});
 assert.deepEqual(state.plans[0].images[0].referenceIds,['hall-asset','registered-1']);assert.deepEqual(state.plans[0].images[0].windowIds,['w1']);
 assert.equal(generates()[0].input.body.request_id,'set_plate_test_1');

 // wait:false returns the job and exact follow-ups.
 reset();
 const queued=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',wait:false,licenseAccepted:true,_allow:['network','cpu','gpu']});
 assert.equal(queued.outcome,'submitted');assert.equal(queued.jobId,'a'.repeat(32));assert.equal(queued.next.adopt.arguments.action,'adoptImage');assert.equal(state.adopted,null);

 // A lost generate response is never replayed and carries reconciliation IDs.
 reset();behaviour.generate='lost';
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',requestId:'set_plate_lost',licenseAccepted:true,_allow:['network','cpu','gpu']}),e=>e.code==='OUTCOME_UNKNOWN'&&e.details.setPlate.stage==='dispatch'&&e.details.setPlate.reconciliation.arguments.path==='/requests/set_plate_lost'&&/Do not rerun/.test(e.details.setPlate.warning));
 assert.equal(generates().length,1,'unknown dispatch outcome must not be retried');

 // Wait deadline: report, do not adopt or resubmit.
 reset();behaviour.jobStatus='running';
 const slow=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',timeoutMs:1000,licenseAccepted:true,_allow:['network','cpu','gpu']});
 assert.equal(slow.outcome,'timeout');assert.equal(state.adopted,null);assert.equal(generates().length,1);

// Multiple-Angles camera LoRA: opt-in, allowlisted id, <mva> pose caption, strength.
 reset();
 assert.equal(R.multiAngleCaption('back view, eye-level shot'),'<mva> back view, eye-level shot');
 assert.equal(R.multiAngleCaption({azimuth:'left side view',elevation:'high-angle shot',closeUp:true}),'<mva> left side view, high-angle shot close-up');
 assert.throws(()=>R.multiAngleCaption('behind, eye-level shot'),/azimuth/);assert.throws(()=>R.multiAngleCaption('back view, worm-eye shot'),/elevation/);
 assert.match(R.setPlatePrompt('reverse angle',1,{cameraView:'back view, eye-level shot'}),/^<mva> back view, eye-level shot\nSame location as <image1>\. New camera view: reverse angle\n/);
 const plain=(await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',dryRun:true,_allow:['network']})).workerRequest.body.tasks[0];
 assert.equal('camera_lora' in plain,false,'LoRA stays off unless requested');
 const angled=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,multiAngleLoraStrength:0.9,width:512,height:288,accelerationProfile:'viggle-turbo-v0.2.1-6step',dryRun:true,_allow:['network']});
 const at=angled.workerRequest.body.tasks[0];
 assert.equal(at.camera_lora,'multiple-angles-v2');assert.equal(at.camera_lora_strength,0.9);assert.equal(at.acceleration_profile,'viggle-turbo-v0.2.1-6step');assert.match(at.prompt,/^<mva> back view, eye-level shot\n/);
 assert.deepEqual(angled.multiAngleLora,{id:'multiple-angles-v2',strength:0.9,installed:true,reportedByWorker:true});
 assert.equal(JSON.stringify(angled.workerRequest).includes('safetensors'),false,'clients never send LoRA paths or URLs');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',multiAngleLora:true,dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS'&&/cameraView/.test(e.message));
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',multiAngleLoraStrength:0.8,dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS');
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',multiAngleLora:true,multiAngleLoraStrength:3,cameraView:'back view, eye-level shot',dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS');
 const literal=(await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'<mva> back view, eye-level shot',literalPrompt:true,multiAngleLora:true,dryRun:true,_allow:['network']})).workerRequest.body.tasks[0];
 assert.equal(literal.prompt,'<mva> back view, eye-level shot');assert.equal(literal.camera_lora_strength,1);
 assert.equal(mutations().length,0);
 behaviour.cameraLoras='absent';
 const old=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,dryRun:true,_allow:['network']});
 assert.equal(old.multiAngleLora.reportedByWorker,false);assert.match(old.multiAngleLora.warning,/LORA_UNAVAILABLE/);
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,licenseAccepted:true,_allow:['network','cpu','gpu']}),e=>e.code==='LORA_UNAVAILABLE');
 behaviour.cameraLoras='missing';
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,licenseAccepted:true,_allow:['network','cpu','gpu']}),e=>e.code==='LORA_UNAVAILABLE'&&/not installed/.test(e.message));
 assert.equal(mutations().length,0,'unavailable LoRA fails before any upload, plan or GPU work');
 behaviour.cameraLoras='installed';behaviour.dropLora=true;
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,licenseAccepted:true,_allow:['network','cpu','gpu']}),e=>e.code==='LORA_UNAVAILABLE'&&/bridge predates/.test(e.message));
 assert.equal(generates().length,0,'an outdated bridge never gets a LoRA-less dispatch');
 reset();
 const lit=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',cameraView:'back view, eye-level shot',multiAngleLora:true,seed:7,licenseAccepted:true,_allow:['network','cpu','gpu']});
 assert.equal(lit.outcome,'completed');assert.equal(generates().length,1);assert.equal(generates()[0].input.body.tasks[0].camera_lora,'multiple-angles-v2');assert.equal(lit.multiAngleLora.strength,1);
 assert.equal(generates()[0].input.body.snapshot.settings.cameraLora,'multiple-angles-v2','snapshot records the LoRA');

 // Qwen Image Edit 2511 + fal Multiple-Angles LoRA: "<sks> {azimuth} {elevation} {distance}", no <imageN> tokens.
 reset();
 const P2='qwen_image_edit_plus2_20B';
 assert.equal(R.cameraLoraFor(P2).id,'multiple-angles-2511');assert.equal(R.cameraLoraFor('krea2_raw'),null);
 assert.equal(R.multiAngleCaption('back view eye-level shot medium shot',P2),'<sks> back view eye-level shot medium shot');
 assert.equal(R.multiAngleCaption('<sks> left side view (270°) eye-level shot (0°) close-up (×0.6)',P2),'<sks> left side view eye-level shot close-up','the card\'s annotated form');
 assert.equal(R.multiAngleCaption('front-right quarter view, low-angle shot',P2),'<sks> front-right quarter view low-angle shot medium shot');
 assert.equal(R.multiAngleCaption({azimuth:'right side view',elevation:'high-angle shot',distance:'wide shot'},P2),'<sks> right side view high-angle shot wide shot');
 assert.throws(()=>R.multiAngleCaption('back-right view eye-level shot',P2),/azimuth/);assert.throws(()=>R.multiAngleCaption('back view top-down shot',P2),/cameraView/);
 const p2prompt=R.setPlatePrompt('reverse angle',1,{model:P2,cameraView:'back view eye-level shot medium shot'});
 assert.match(p2prompt,/^<sks> back view eye-level shot medium shot\nMove the camera to a new position in the same location as the first image: reverse angle\./);assert.equal(/<image\d/.test(p2prompt),false);
 assert.throws(()=>R.setPlatePrompt('reverse angle',4,{model:P2}),/1–3/);
 const p2=await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',model:P2,prompt:'reverse angle',cameraView:'back view eye-level shot medium shot',multiAngleLora:true,width:512,height:896,dryRun:true,_allow:['network']});
 const p2t=p2.workerRequest.body.tasks[0];
 assert.equal(p2t.model_type,P2);assert.equal(p2t.camera_lora,'multiple-angles-2511');assert.equal(p2t.camera_lora_strength,0.9,'worker-reported default');assert.match(p2t.prompt,/^<sks> back view/);
 assert.deepEqual(p2.multiAngleLora,{id:'multiple-angles-2511',strength:0.9,installed:true,reportedByWorker:true});
 const p2plain=(await client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',model:P2,prompt:'reverse angle',dryRun:true,_allow:['network']})).workerRequest.body.tasks[0];
 assert.equal('camera_lora' in p2plain,false);assert.match(p2plain.prompt,/^Move the camera/);
 await assert.rejects(()=>client.call('reference_edit',{projectId:'film',sourceImage:'hall-asset',model:P2,prompt:'reverse angle',multiAngleLora:true,dryRun:true,_allow:['network']}),e=>e.code==='INVALID_ARGUMENTS'&&/<sks>/.test(e.message));
 assert.equal(mutations().length,0);

 // CLI JSON output (same dry run through orch3stra.mjs).
 reset();
 const {stdout}=await exec(process.execPath,[join(ROOT,'orch3stra.mjs'),'reference','editImage','--url',url,'--allow','network','--json',JSON.stringify({projectId:'film',sourceImage:'hall-asset',prompt:'reverse angle',seed:3,dryRun:true})],{cwd:tmp});
 const cli=JSON.parse(stdout);assert.equal(cli.dryRun,true);assert.equal(cli.workerRequest.body.tasks[0].seed,3);assert.equal(mutations().length,0);
 await assert.rejects(()=>exec(process.execPath,[join(ROOT,'orch3stra.mjs'),'reference','oops','--url',url,'--json','{}'],{cwd:tmp}),e=>JSON.parse(e.stdout).error.code==='INVALID_ARGUMENTS');
 console.log('PASS set-plate prompt/resolution helpers, image headers, catalogue admission, dry-run request validation without writes, full compose with one dispatch, opt-in Multiple-Angles LoRA (pose grammar, strength, allowlist, outdated worker/bridge refusal), wait:false, lost-dispatch non-replay, wait timeout and CLI JSON');
}finally{await new Promise(r=>server.close(r));await rm(tmp,{recursive:true,force:true});}
