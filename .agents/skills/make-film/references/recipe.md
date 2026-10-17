# Executable recipe: A Little Shelter

This is an original 17.625-second silent microfilm plan, not a claim of generated footage. The baseline creates only a **new** project, three 141-frame windows (24 fps), two prop subjects, a scene and one image-plan card. It calls no provider/worker and uses no imaginary media. Continue to actual generation only after explicit rights, model and budget approval. Each code block uses real public CLI actions; IDs come from returned results.

## 1. Start a persistent authoring session

From the checkout, confirm `node --version` is **22 or newer** and `node orch3stra.mjs doctor` reaches the desired studio. If the shell's Node is older, select an already installed supported runtime; do not install packages or change WanGP's Python environment. Start `node` (the Node REPL), then paste this initialization. Keep this session for subsequent blocks. These are JavaScript, not shell commands. Top-level `await` is supported in the REPL.

Set `ORCH3STRA_EVIDENCE` to a private retained evidence directory outside temporary studio data; otherwise each run creates `film-run-*` in the checkout.

```js
var fs = await import('node:fs');
var path = await import('node:path');
var cp = await import('node:child_process');
var crypto = await import('node:crypto');
var evidenceRoot = path.resolve(process.env.ORCH3STRA_EVIDENCE || '.');
fs.mkdirSync(evidenceRoot,{recursive:true,mode:0o700});
var runDir = fs.mkdtempSync(path.join(evidenceRoot,'film-run-'));
var sequenceNumber = 0;
function save(name, value) {
  fs.writeFileSync(path.join(runDir, name + '.json'), JSON.stringify(value, null, 2), {mode:0o600});
  return value;
}
function call(tool, args, allow = []) {
  var stem = String(++sequenceNumber).padStart(3,'0') + '-' + tool;
  var input = {...args, ...(allow.length ? {_allow:allow} : {})};
  save(stem + '-request', input);
  var result = cp.spawnSync(process.execPath,
    ['orch3stra.mjs','call',tool,'--json','@' + path.join(runDir,stem + '-request.json')],
    {encoding:'utf8',maxBuffer:64*1024*1024,env:process.env});
  fs.writeFileSync(path.join(runDir,stem + '-stdout.json'), result.stdout || '', {mode:0o600});
  if (result.error) throw result.error;
  var output = JSON.parse(result.stdout);
  if (result.status !== 0 || output.ok === false) throw Object.assign(new Error(JSON.stringify(output)), {output});
  return output;
}
var r;
function refresh() { r = call('project',{action:'get',projectId:r.project.id}); return r; }
function mutate(tool, action, fields = {}, allow = []) {
  var output = call(tool,{action,projectId:r.project.id,expectedRevision:r.serverRevision,...fields},allow);
  r = output.record || output;
  save('current-project',r);
  return output;
}
function observe(tool,id,allow = []) {
  var result = call('job_wait',{tool,id,timeoutMs:120000,intervalMs:1500},allow);
  save('last-observation',result);
  if (result.outcome !== 'completed') throw new Error('Stop and inspect '+result.outcome+' for '+tool+' '+id+'; no retry was submitted.');
  return result.result;
}
console.log({runDir});
```

The helper saves each request and actual response before interpreting it. It never retries. On a conflict or uncertain outcome, use the saved IDs/requests and [recovery rules](operations.md); do not rerun a block blindly. `ORCH3STRA_URL` and `ORCH3STRA_COOKIE` are inherited by each CLI process; keep any cookie secret. Restarting the REPL loses variables but not the private JSON evidence directory. Reload `current-project.json` from that actual printed directory and call `refresh()` before a new write; don't recreate the film.

## 2. Author the film without inference

```js
r = call('project',{action:'create',name:'A Little Shelter',request:'An original silent miniature for a general audience: on a rainy patch of dark soil, a dry yellow leaf tips toward a tiny green seedling, then settles as a shelter. Isolation becomes apprehension, then relief. One setting, no people, brands, dialogue, singing or score. Restrained naturalistic macro photography.'});
save('created-project',r);
var firstWindowId = r.project.windows[0].id;
mutate('subjects','upsert',{name:'The seedling',kind:'prop',description:'One small seedling with exactly two fresh green leaves, a thin upright stem, rooted at frame right in dark wet soil.',retention:'Preserve the two-leaf silhouette, green color, upright stem and rooted position.'});
var seedling = r.project.subjects.find(s => s.name === 'The seedling');
mutate('subjects','upsert',{name:'The yellow leaf',kind:'prop',description:'One dry oval yellow leaf, brown central vein, slightly curled edges, larger than the seedling. No other falling leaves.',retention:'Preserve its oval shape, yellow color, brown vein and scale.'});
var leaf = r.project.subjects.find(s => s.name === 'The yellow leaf');
var cast = Object.fromEntries([seedling,leaf].map(s => [s.id,{visibleShots:[1],voiceShots:[],delivery:'scene'}]));
var seeds = '<Subject '+seedling.number+'>';
var leaves = '<Subject '+leaf.number+'>';
var shots = [
  {title:'Exposed',summary:'[reference generation] A small seedling stands exposed in rain; a yellow leaf rests nearby.',detail:'[Shot 1] Locked macro medium view at seedling height, soft overcast light. '+seeds+' stays frame right. '+leaves+' lies at frame left, one curled edge raised. Fine rain falls on the seedling and dark soil. Hold readable geography; the camera and leaf remain still.',entry:'Seedling frame right; yellow leaf flat at frame left.',exit:'The same arrangement remains; a small breeze begins.',soundscape:'Soft steady rain, faint breeze. No speech, singing or music.'},
  {title:'A precarious turn',summary:'[reference generation] One gust tips the yellow leaf toward the seedling, then it settles above the stem.',detail:'[Shot 1] Same camera side and soft light. '+leaves+' starts already touching the ground at frame left. One gust tips the leaf slowly toward '+seeds+' at frame right. It settles into a small arch above the seedling without crushing it. One tipping action only; hold the settled end state.',entry:'Yellow leaf at frame left, curled edge lifted; seedling rooted at frame right.',exit:'The yellow leaf has settled as an arch above the seedling.',soundscape:'Rain continues. One brief gust and one soft dry leaf rustle, then quiet rain. No voices or music.'},
  {title:'Sheltered',summary:'[reference generation] Rain beads on the settled leaf while the seedling is protected underneath.',detail:'[Shot 1] A closer view from the same side of the axis. '+leaves+' is already settled as a shelter; it does not arrive or tip again. '+seeds+' remains upright underneath at frame right. Show raindrops collecting on the yellow surface while the green leaves below stay protected. Hold the relief in this quiet composition.',entry:'The leaf is already settled above the seedling, matching the previous end state.',exit:'Hold the sheltered seedling and wet yellow leaf without a new action.',soundscape:'Gentle rain on the leaf and surrounding soil. No speech, singing or music.'}
];
for (var [i,shot] of shots.entries()) {
  mutate('timeline','upsert',{
    ...(i === 0 ? {windowId:firstWindowId} : {}),
    window:{...shot,frames:141,overlap:0,music:'N/A',subjectIds:[seedling.id,leaf.id],assetIds:[],casting:cast,notes:'Maintain left-to-right action and exact leaf/seedling identity. Editorial handles may be trimmed after reviewing actual footage.'}
  });
}
var windowIds = r.project.windows.map(w => w.id);
mutate('references','scenes',{scenes:[{name:'Rainy soil',windowIds,bankIds:[],location:'One patch of dark wet garden soil',time:'Overcast daylight'}]});
var imagePlan = mutate('references','planImages',{proposal:{images:[{title:'Seedling and leaf geography anchor',subjectId:seedling.id,referenceIds:[],windowIds,purpose:'Original identity, scale, setting and composition anchor; not proof of the later shelter action.',state:'Exposed before the gust',prompt:'Naturalistic macro still at seedling height, soft overcast daylight, dark wet garden soil. Frame right: one upright seedling with exactly two fresh green leaves and a thin stem. Frame left: one dry oval yellow leaf with a brown central vein and slightly curled edges, larger than the seedling, resting on the ground. Both subjects in focus, clear scale and geography. Fine rain, restrained natural colors. No people, lettering, logos or extra leaves.'}]}});
save('image-plan',imagePlan.plan);
save('timeline-review',call('timeline',{action:'inspect',projectId:r.project.id}));
save('validation-before-media',call('project',{action:'validate',projectId:r.project.id,forSend:false}));
save('authored-project',r);
console.log({projectId:r.project.id,serverRevision:r.serverRevision,windowIds,planId:imagePlan.plan.id,runDir});
```

This is the safe local planning smoke for the integrator. Validation can correctly report missing model confirmation/reference coverage: **do not claim render readiness**. The plan is complete; the pixels are not. The film has no speech, so no fabricated voice/transcript/caption is needed. To preserve this result now, use the backup block below with explicitly approved local CPU/network file transfer.

## 3. Discover and approve real prerequisites

After permission for discovery, run in the same session:

```js
var imageModels = save('image-models',call('generation',{action:'discover',family:'image'},['network']));
var videoModels = save('video-models',call('generation',{action:'discover',family:'video'},['network']));
console.dir(imageModels,{depth:null});
console.dir(videoModels,{depth:null});
```

Inspect those responses. Select actual `model_type` values and any image accelerator from discovery, verify the worker's installed weights/dependencies and current terms, and obtain a finite attempt/rights approval. **Do not select the first model automatically or treat listing as proof weights are cached.** For the following code, set `imageModelType` and `videoModelType` to the exact approved strings from these outputs in the REPL. These variables intentionally have no fake defaults. If no model or approval exists, stop with the saved project/backup and precise prerequisite. Further blocks are not the safe local smoke.

## 4. Generate and inspect the single look anchor

Only after explicit image license acknowledgement and approval of one real GPU attempt:

```js
var imageInfo = save('image-model-info',call('generation',{action:'discover',family:'image',modelType:imageModelType},['network']));
var imageRequestId = 'image_'+crypto.randomUUID().replaceAll('-','');
var imageArgs = {requestId:imageRequestId,planId:imagePlan.plan.id,cardIds:[imagePlan.plan.images[0].id],settings:{modelType:imageModelType,resolution:'1024x1024',seed:7},licenseAccepted:true};
save('image-build',call('generation',{action:'buildImages',projectId:r.project.id,...imageArgs},['network']));
```

Review the build/profile and resource requirements before the next block. If 1024-square is unsuitable, choose a supported smaller 32-pixel-grid canvas before preparation. Changing settings is a reviewed new decision, not a hidden fallback.

```js
refresh();
var imagePrepared = mutate('generation','prepareImages',imageArgs,['network','cpu']);
save('image-prepared',imagePrepared);
var imageJob = save('image-submitted',call(imagePrepared.operation.tool,imagePrepared.operation.arguments,['network','cpu','gpu']));
var imageDone = observe('worker',imageJob.job_id,['network']);
var imageOutput = imageDone.outputs.find(o => o.available && o.media_kind === 'image');
if (!imageOutput) throw new Error('No available real image output; inspect this job, do not retry automatically.');
var imageTicket = call('media_ticket',{jobId:imageJob.job_id,outputId:imageOutput.id});
var downloadedAnchor = call('media_download',{url:imageTicket.url,output:path.join(runDir,'anchor-image')},['network']);
save('anchor-download',downloadedAnchor);
```

Open the actual downloaded image with an image-capable viewer. Inspect the two-leaf identity, oval yellow leaf, left/right positions, count, scale, light and artifacts. Do not run the next block unless it is an accepted anchor. If rejected, keep the evidence and ask for another attempt only within the real budget.

```js
refresh();
var adoptedAnchor = mutate('references','adoptImage',{jobId:imageJob.job_id,outputId:imageOutput.id,attachWindows:false},['network','cpu']);
var anchorId = adoptedAnchor.asset.id;
mutate('references','annotate',{assetId:anchorId,value:{subjectIds:[seedling.id,leaf.id],roles:['identity','setting'],states:['Exposed before the gust'],angles:['Seedling-height view from south side'],quality:2,approved:true}});
for (var windowId of windowIds) mutate('references','assign',{windowId,assetIds:[anchorId]});
save('reference-review',call('references',{action:'inspect',projectId:r.project.id,windowIds}));
```

This anchor establishes identity/geography, not every later pose. If the inspected manifest needs shelter-state coverage, plan and approve a scoped variant using this real anchor in `referenceIds` before rendering the later window. Never mark unsupported pose evidence true merely because the original plan requested it. Use `recordInspection` only for actual returned requirement IDs whose visible properties were reviewed.

## 5. Configure, calibrate one shot, then render the rest

`configure` obtains actual model defaults from the worker; do not hand-invent sampler settings. The recipe uses independent fresh shots and reviews each join rather than claiming linked continuity.

```js
refresh();
mutate('project','configure',{mode:'independent',modelType:videoModelType,presetConfirmed:true,resolution:'832x480',seed:11},['network']);
save('render-validation',call('project',{action:'validate',projectId:r.project.id,forSend:true}));
save('calibration-plan',call('timeline',{action:'renderPlan',projectId:r.project.id,windowIds:[windowIds[0]],strategy:'independent',context:'fresh',seed:11}));
```

Read issues and the compiled plan; stop on unresolved errors. Confirm actual model canvas/VRAM support and approve **one** calibration attempt, not all three. Define this function; defining it does not submit work:

```js
function prepareShot(windowId) {
  refresh();
  var args = {requestId:'video_'+crypto.randomUUID().replaceAll('-',''),owner:'make_film_agent',runId:'film_'+crypto.randomUUID().replaceAll('-',''),windowIds:[windowId],strategy:'independent',context:'fresh'};
  save('video-build-'+windowId,call('generation',{action:'buildVideo',projectId:r.project.id,requestId:args.requestId,windowIds:args.windowIds,strategy:args.strategy,context:args.context},['network']));
  var prepared = mutate('generation','prepareVideo',args,['network','cpu']);
  save('video-prepared-'+windowId,prepared);
  return prepared;
}
function dispatchPrepared(prepared) {
  return save('video-submitted-'+prepared.requestId,call(prepared.operation.tool,prepared.operation.arguments,['network','cpu','gpu']));
}
var calibration = prepareShot(windowIds[0]);
```

Inspect the saved prepared operation/intent. Then, only with approved dispatch:

```js
var calibrationJob = dispatchPrepared(calibration);
var calibrationDone = observe('worker',calibrationJob.job_id,['network']);
var calibrationOutput = calibrationDone.outputs.find(o => o.available && o.media_kind === 'video');
if (!calibrationOutput) throw new Error('No available calibration video; inspect authoritative job.');
var calibrationTicket = call('media_ticket',{jobId:calibrationJob.job_id,outputId:calibrationOutput.id});
save('calibration-download',call('media_download',{url:calibrationTicket.url,output:path.join(runDir,'calibration.mp4')},['network']));
```

Watch/listen to `calibration.mp4`, at full speed and frame-by-frame around visible defects. Use the rubric in [creative-direction.md](creative-direction.md). Only if acceptable, adopt and select:

```js
refresh();
mutate('timeline','adoptJob',{kind:'native',jobId:calibrationJob.job_id},['network']);
mutate('timeline','take',{windowId:windowIds[0],jobId:calibrationJob.job_id});
```

For each remaining window, repeat `prepareShot(windowIds[1])` and then `prepareShot(windowIds[2])` **one at a time**, with separately budgeted approval; dispatch/observe/download/review/adopt/select exactly as above using that window's actual job/output IDs. Do not loop through unreviewed spending. Compare beginning/end state to adjacent footage; do not repeat the tipping action. A rejected alternate remains evidence, not a selected take. `timeline.trim` uses actual source-frame In/Out (exclusive out); inspect real bounds before choosing them. `timeline.revalidate` is an explicit continuity review, not a warning suppressor.

## 6. Post, export, review and backup

Once all included windows have actual selected usable footage:

```js
refresh();
mutate('post','create',{windowIds});
mutate('post','master',{changes:{fadeInFrames:6,fadeOutFrames:12,audioFadeInFrames:6,audioFadeOutFrames:12,masterGainDb:-3}});
save('post-validation',call('post',{action:'validate',projectId:r.project.id}));
var postPacket = save('post-packet',call('post',{action:'exportPacket',projectId:r.project.id}));
var finishId = 'finish_'+crypto.randomUUID().replaceAll('-','');
save('finish-request',{action:'start',id:finishId,post:postPacket});
var finishJob = call('finish',{action:'start',id:finishId,post:postPacket},['cpu','network']);
var finished = observe('finish',finishJob.id);
if (!finished.downloadURL) throw new Error('Completed export has no download URL; inspect finish record.');
var movieEvidence = save('movie-download',call('media_download',{url:finished.downloadURL,output:path.join(runDir,'a-little-shelter.mp4')},['network']));
```

Read [finishing.md](finishing.md) for deliberate cue placement, local voice/speech review, observed captions, alternatives and late upscale. No speech means no invented subtitles. Download/play this final MP4: the exported audio/joins/fades are authoritative, not browser preview. Record actual measured frame count/duration/canvas/audio and timestamped review findings alongside `movieEvidence` (which reports the downloaded hash and size). Do not infer artistic quality from successful export.

A portable backup is available **even at the planning stage**. This block requires approved CPU work and same-studio download, not a worker:

```js
refresh();
var backup = save('portable-backup',call('studio',{action:'backup-start',project:r.project},['cpu']));
if (backup.status !== 'completed') throw new Error('Backup not complete; inspect backup-get using saved ID.');
var backupEvidence = save('backup-download',call('media_download',{url:'/api/agent-backup/'+backup.id,output:path.join(runDir,'a-little-shelter.h3project')},['network']));
console.log({projectId:r.project.id,serverRevision:r.serverRevision,backup:backupEvidence,runDir});
```

Retain downloaded generated source takes and the final movie separately: portable backups include registered reference/Post media, not all worker videos. Back up the server data directory through the installation's normal approved process. Delivery states exactly which stages actually ran, which footage was reviewed, the selected take IDs and revision, downloaded filenames/hashes, rights constraints, and any missing prerequisites. A completed baseline is **an authored plan and backup**, never a completed generated film.
