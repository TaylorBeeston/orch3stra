/** Public, dependency-free agent schemas. Service bodies remain the existing API wire format. */
import {PROJECT_TOOLS} from './agent-project-schema.mjs';
import {MEDIA_TOOLS} from './agent-media-schema.mjs';

export const AGENT_PROTOCOL_VERSION='1';
const EFFECTS=['provider','gpu','network','cpu','delete'];
const str=(description,options={})=>({type:'string',description,...options});
const text=str('Text.');
const id=str('Exact identifier returned by the owning service.',{pattern:'^[A-Za-z0-9_-]{1,128}$'});
const outputId=str('Immutable output ID returned by the worker.',{pattern:'^[a-f0-9]{32}$'});
const bool={type:'boolean'};
const yes={const:true};
const num=(minimum,maximum)=>({type:'number',minimum,...(maximum===undefined?{}:{maximum})});
const integer=(minimum,maximum)=>({...num(minimum,maximum),type:'integer'});
const choice=(...values)=>({enum:values});
const arr=(items,minItems=0,maxItems=10000)=>({type:'array',items,minItems,maxItems});
const obj=(properties={},required=[],description)=>({type:'object',properties,required,additionalProperties:false,...(description?{description}:{})});
const packet=description=>({type:'object',description,additionalProperties:true});
const project={...packet('Frozen normalized H3 project from project.get or generation.build. Use project/story/subjects/timeline/references tools to author it; core.js owns the full project format.'),properties:{id,name:text,windows:arr(packet('Normalized core.js window with its exact identifier.')),assets:arr(packet('Registered owned media.')),subjects:arr(packet('Registered subject.'))},required:['id','windows','assets','subjects']};
const confirm={...yes,description:'Explicit human confirmation of this exact reviewed operation.'};
const projectId={...id,description:'Published studio project ID; not an unsynced browser project.'};
const stamp=str('Exact stamp/revision returned by a fresh preview or diagnosis.',{minLength:1});
const intent=obj({id,lease:stamp},['id','lease'],'Exact prepared render intention; never invent or replay after uncertain admission.');
const provider=choice('codex','opencode','deepseek','go');
const connection={provider,key:str('Optional per-call secret; prefer server environment configuration.',{writeOnly:true,maxLength:8192}),opencodeUrl:str('Configured OpenCode HTTP origin.'),opencodeUsername:text};
const plannerConfig=obj({...connection,model:str('Exact model ID from models discovery.',{minLength:1,maxLength:200}),protocol:choice('auto','chat','responses','messages'),effort:str('Reasoning effort supported by the discovered model.'),vision:bool},['provider','model']);
const generationFields={...connection,model:plannerConfig.properties.model,protocol:plannerConfig.properties.protocol,effort:plannerConfig.properties.effort,system:str('Complete system instructions from the core planner packet.',{maxLength:131072}),prompt:str('Complete user prompt from the core packet.',{minLength:1,maxLength:2097152,pattern:'\\S'}),images:arr(obj({url:str('Image data URL or provider-supported image URL.',{minLength:1}),label:text},['url']),0,100)};
const policy=obj({enabled:bool,mode:choice('review','autonomous'),beforeDraft:bool,afterDraft:bool,beforeRender:bool,allowImages:bool,allowFrames:bool,allowNewIdentity:bool,vision:bool,auditEveryWindow:bool,allowSafeFixes:bool,repairLabels:bool,repairInspectionReplies:bool,maxImages:integer(0,100),maxCalls:integer(1,1024),maxAttempts:integer(1,20),maxMinutes:integer(1,360),maxInspectionImages:integer(1,12),threshold:num(.7,.99)},[],'Bounded reference-agent policy; threshold is model judgement, not calibrated certainty.');
const imageSettings=obj({modelType:str('Actual discovered image model_type.',{minLength:1}),licenseAccepted:{...yes,description:'Per-dispatch acknowledgement of the discovered model license, never inherited from backups.'},resolution:text,steps:integer(1,100),guidance:num(0,20),seed:integer(-1,2147483647),accelerationProfile:text,preserveFirstScene:bool,cameraLora:str('Allowlisted camera LoRA id from discovery profile.camera_loras, e.g. multiple-angles-v2.',{pattern:'^[a-z0-9-]{1,64}$'}),cameraLoraStrength:num(0,2),imageProfile:packet('Actual profile returned by worker image-model discovery; never invent reference capacity.')},[],'Image settings validated against worker /image-model?model_type= discovery.');
const source=obj({kind:choice('native','managed','finish'),jobId:id,outputId},['kind','jobId','outputId']);
const edit=obj({format:{const:'h3-edit'},version:integer(1,1),fps:{const:24},projectId,name:str('Export name.',{maxLength:200}),cuts:arr(obj({windowId:id,title:text,source,inFrame:integer(0),outFrame:integer(1),frames:integer(1),startFrame:integer(0),endFrame:integer(1),continuityReview:stamp},['windowId','source','inFrame','outFrame']),1,2000),totalFrames:integer(1)},['format','fps','projectId','cuts'],'Validated Edit.selection packet; outFrame is exclusive and must exceed inFrame.');
const post=obj({format:{const:'h3-post'},version:{const:1},projectId,post:packet('Complete Post snapshot with clips, audio, images and review stamps; author with the post tool.'),media:arr(packet('Immutable media record with measured metadata and SHA-256.'),0,128)},['format','version','projectId','post','media'],'Complete packet from post.exportPacket, validated by post-core.js validatePacket; do not hand-assemble.');
const conflictOperation={oneOf:[
 obj({kind:choice('allow-here','approve-image'),assetId:id,sourceStamp:stamp},['kind','assetId','sourceStamp']),
 obj({kind:{const:'confirm-coverage'},assetId:id,sourceStamp:stamp,requirementIds:arr(id,1,12),reason:str('Actual human review evidence.',{minLength:10})},['kind','assetId','sourceStamp','requirementIds','reason'])
]};
const action=(name,properties={},required=[],description)=>obj({action:{const:name},...properties},['action',...required],description);
const byId=(name,properties={},required=[],description)=>action(name,{id,...properties},['id',...required],description);
const example=(description,args)=>({description,arguments:args});
function group(name,endpoint,description,branches,readActions,effectsByAction,examples){return {name,endpoint,description,inputSchema:{type:'object',oneOf:branches},readActions,effectsByAction,annotations:{readOnlyHint:branches.every(b=>readActions.includes(b.properties.action.const)),destructiveHint:Object.values(effectsByAction).some(e=>e.includes('delete')),openWorldHint:Object.values(effectsByAction).some(e=>e.includes('network'))},examples};}
function single(name,endpoint,description,inputSchema,effects,examples,readOnly=false){return {name,endpoint,description,inputSchema,effects,readOnly,readActions:[],effectsByAction:{},annotations:{readOnlyHint:readOnly,destructiveHint:effects.includes('delete'),openWorldHint:effects.includes('network')},examples};}
const allWork=['provider','gpu','network','cpu'];
const serviceTools=[
 group('planner','/api/ai','Durable planner requests. Build prompts with project/story packet helpers, submit once, inspect output and explicitly adopt validated proposals. Completed text is not project adoption.',[
  action('start',{request:obj({...generationFields,requestId:id,projectId,context:packet('Recovery context from the core planner packet, maximum 2 MiB serialized.'),kind:choice('pacing','draft','soundscapes','reference-images')},['requestId','provider','model','system','prompt'])},['request']),
  action('list',{projectId}),byId('get',{detail:bool}),byId('cancel'),byId('validation',{status:choice('valid','invalid'),message:str('Validation result, not an instruction to regenerate.',{maxLength:2000})},['status'])
 ],['list','get'],{start:['provider','network','cpu'],list:[],get:[],cancel:['network'],validation:[]},[example('List published planner requests without contacting a provider.',{action:'list'})]),
 single('models','/api/models','Discover actual provider model IDs. Codex may spawn app-server and refresh account state; discovery does not authorize generation.',obj({...connection,includeHidden:bool},['provider']),['network','cpu'],[example('Discover subscription-backed Codex models.',{provider:'codex',includeHidden:false,_allow:['network','cpu']})]),
 single('provider','/api/generate','Synchronous provider generation, without a persistent request lifecycle. Prefer planner.start for recovery and explicit result validation.',obj(generationFields,['provider','model','system','prompt']),['provider','network','cpu'],[example('Discover IDs before using this family; this tool has no read operation.',{provider:'deepseek',model:'deepseek-chat',system:'Return a JSON object with a title field.',prompt:'Suggest one title for a quiet railway documentary.',_allow:['provider','network','cpu']})]),
 group('codex','/api/codex','Codex subscription login and model discovery. Starts local app-server processes; never substitutes API-key billing.',[action('status'),action('models',{includeHidden:bool}),action('start'),action('cancel')],[],{status:['cpu','network'],models:['cpu','network'],start:['cpu','network'],cancel:['network']},[example('Read account status (may spawn Codex).',{action:'status',_allow:['cpu','network']})]),
 group('render_intent','/api/render-intent','Authoritative submit-once render ownership. Begin a session, prepare, submit once, reconcile exact uncertain acceptance; not-found never authorizes replay.',[
  action('begin-session',{owner:id,runId:id},['owner','runId']),action('prepare',{owner:id,lease:stamp,projectId,mode:choice('managed','sliding','independent'),requestId:id,destination:text},['owner','lease','projectId','mode']),action('list'),byId('get'),byId('cancel'),action('invalidate-project',{projectId,reason:str('Reason for permanently blocking old intentions.',{maxLength:300})},['projectId']),byId('reconcile')
 ],['list','get'],{'begin-session':[],prepare:[],list:[],get:[],cancel:['delete'],'invalidate-project':['delete'],reconcile:['network']},[example('Inspect existing intentions before preparing anything.',{action:'list'})]),
 group('sequence','/api/sequence','Managed rendering, history and explicit recovery. Start requires a frozen managed project and prepared intent. Recovery does not imply resume; resume can generate and prepare references.',[
  action('start',{project,intent},['project','intent']),action('manager'),action('list'),byId('get'),byId('diagnostics'),...['pause','resume','reconcile','cancel','archive','restore','recover-preview','retire-preview'].map(a=>byId(a)),byId('attach-job',{jobId:id},['jobId']),...['clear-idle-preview','clear-idle'].map(a=>action(a,{ids:arr(id,1,200)},['ids'])),byId('recover-output',{revision:stamp,outputId,confirm},['revision','outputId','confirm']),byId('retire',{revision:stamp,expectedBackend:choice('headless','legacy'),expectedCurrentBackend:choice('headless','legacy'),acknowledgeOtherRendererStopped:yes},['revision','expectedBackend','expectedCurrentBackend','acknowledgeOtherRendererStopped'])
 ],['list','get','diagnostics','retire-preview'],{start:allWork,manager:['network','cpu'],list:[],get:[],diagnostics:[],pause:[],resume:allWork,reconcile:['cpu','network'],cancel:['network'],archive:['cpu'],restore:['cpu'],'attach-job':['network'],'clear-idle-preview':['network','cpu'],'clear-idle':['network','cpu','delete'],'recover-preview':['network'],'recover-output':['network','cpu'],'retire-preview':[],retire:['delete','cpu']},[example('Inspect managed history without worker queries.',{action:'list'}),example('Inspect live renderer ownership and queue.',{action:'manager',_allow:['network','cpu']})]),
 group('reference_agent','/api/reference-agent','Bounded reference preparation with exact review/recovery tokens. Completion and application are separate. Authorization never replaces current source stamps or license consent.',[
  action('preflight',{project,windowIds:arr(id,1,1000)},['project','windowIds']),action('start',{project,windowIds:arr(id,1,1000),consent:yes,planner:plannerConfig,policy,imageSettings,requestId:id,autoApply:bool,groupId:id,instruction:str('Scoped reference instructions.',{maxLength:12000})},['project','windowIds','consent','planner','requestId']),action('list',{projectId}),byId('get',{detail:bool}),...['result','diagnose','pause','cancel'].map(a=>byId(a)),action('prepare-sequence',{projectId,consent:yes,planner:plannerConfig,policy,imageSettings},['projectId','consent','planner']),byId('authorize',{consent:yes,planner:plannerConfig,policy,imageSettings,autoApply:bool},['consent','planner','policy']),byId('resume',{planner:plannerConfig,answer:str('Answer to the pending human question.',{maxLength:8000})}),byId('approve',{confirm,candidateId:id,planner:plannerConfig,answer:text},['confirm']),...['retry-plan','retry-image','retry-inspection'].map(a=>byId(a,{confirm,recoveryStamp:stamp,planner:plannerConfig},['confirm','recoveryStamp'])),...['retry-candidate','reject-candidate'].map(a=>byId(a,{confirm,candidateId:id,candidateStamp:stamp,reason:str('Human rejection reason.',{maxLength:4000}),prompt:str('Complete corrected replacement prompt.',{minLength:1,maxLength:16000}),extraAttempt:bool,planner:plannerConfig},['confirm','candidateId','candidateStamp'])),byId('extend-window',{confirm,budgetStamp:stamp,limit:{const:20},resume:bool,planner:plannerConfig},['confirm','budgetStamp','limit']),byId('save-progress',{confirm},['confirm']),byId('ack-applied',{confirm},['confirm']),byId('repair-conflict',{confirm,windowId:id,operation:conflictOperation},['confirm','windowId','operation'])
 ],['preflight','list','get','result','diagnose'],{preflight:[],start:allWork,list:[],get:[],result:[],diagnose:[],pause:[],cancel:['network'],'prepare-sequence':[],authorize:['network'],resume:allWork,approve:allWork,'retry-plan':allWork,'retry-image':allWork,'retry-inspection':allWork,'retry-candidate':allWork,'reject-candidate':[],'extend-window':allWork,'save-progress':['cpu'],'ack-applied':[],'repair-conflict':[]},[example('List runs and their application states.',{action:'list'})]),
 group('voice','/api/voice','Temporary CPU voice import/transcription/diarization. Local model downloads occur only with allowModels; import rights must be explicit. Temporary sources expire independently of project assets.',[
  action('capabilities'),action('nemotron-capabilities'),byId('status'),byId('cancel'),action('forget',{sourceId:id},['sourceId']),action('import',{uploadId:id,rightsConfirmed:yes,start:num(0),end:num(0)},['uploadId','rightsConfirmed']),action('import',{url:str('Supported source URL; you must hold usage rights.',{minLength:1}),rightsConfirmed:yes,start:num(0),end:num(0)},['url','rightsConfirmed']),...['transcribe','diarize'].map(a=>action(a,{sourceId:id,model:str('Cached supported Whisper model; capabilities reports availability.'),diarizationModel:choice('pyannote','nemotron3'),language:text,diarize:bool,allowModels:bool,numSpeakers:integer(1),hfToken:str('Optional model-access secret; prefer studio configuration.',{writeOnly:true})},['sourceId']))
 ],['status'],{capabilities:['cpu'],'nemotron-capabilities':['cpu'],status:[],cancel:[],forget:['delete'],import:['cpu','network'],transcribe:['cpu','network'],diarize:['cpu','network']},[example('Inspect local voice tooling (executes CPU capability probe).',{action:'capabilities',_allow:['cpu']})]),
];
const soundOptions=obj({thresholdDb:num(-80,-10),minGap:num(.1,5),minLength:num(.08,10),padding:num(0,1),method:choice('auto','silence','chapters','whole')});
const sample=obj({id,name:str('Sample label.',{maxLength:180}),start:num(0),end:num(.08),keep:bool,category:text,basis:str('Detection or manual selection basis.',{maxLength:80})},['id','start','end']);
const samples=arr(sample,0,500);
serviceTools.push(
 group('sounds','/api/sounds','Persistent CPU sound library import, segmentation, audition metadata and sample extraction. Revision is the sound-source revision, not the project server revision.',[
  ...['url','uploadKey'].map(field=>action('start',{id,projectId,consent:yes,[field]:field==='url'?str('Single YouTube video URL.'):id,name:str('Original file name including supported extension.',{maxLength:220}),options:soundOptions},['id','projectId','consent',field,...(field==='uploadKey'?['name']:[])])),action('list',{projectId},['projectId']),...['get','report','cancel'].map(a=>byId(a)),byId('resume',{confirm},['confirm']),byId('scan',{revision:integer(0),confirm,options:soundOptions},['revision','confirm']),byId('edit',{revision:integer(0),samples},['revision','samples']),byId('save-samples',{revision:integer(0),confirm,samples},['revision','confirm','samples']),action('restore',{projectId,confirm,library:packet('Saved source record from the project backup; source.id and source.sha256 must match restored immutable bytes.')},['projectId','confirm','library'])
 ],['list','get','report'],{start:['cpu','network'],list:[],get:[],report:[],cancel:[],resume:['cpu','network'],scan:['cpu'],edit:[],'save-samples':['cpu'],restore:['cpu']},[example('Inspect an existing source revision before editing samples.',{action:'get',id:'sound_source_01'})]),
 group('speech_quality','/api/speech-quality','Offline cached CPU analysis, listening review and separately authorized bounded GPU alternatives. ASR completion is not a passing quality judgement; alternatives never replace original selected takes.',[
  action('capabilities'),action('list'),action('start',{id:str('Stable speech analysis ID.',{pattern:'^speech_[a-f0-9]{32}$'}),edit,project,offlineOnly:yes,intended:arr(obj({windowId:id,text:str('Exact intended dialogue; empty is valid for no intended speech.',{maxLength:10000}),utteranceIds:arr(id),intentionalRepeat:bool},['windowId','text']),1,48),finalId:id,diarize:bool},['id','edit','project','offlineOnly','intended']),...['get','resume','cancel','repair-next','reconcile'].map(a=>byId(a)),byId('confirm',{windowId:id,confirmed:bool,ambiguous:bool,note:str('Actual listening observation.',{maxLength:2000})},['windowId']),byId('authorize-repair',{policy:obj({enabled:yes,maxWindows:integer(1,20),maxAttemptsPerWindow:{const:1},maxGpuFrames:integer(1,20000),context:{const:'fresh-independent'},dependencyAcknowledged:yes},['enabled','maxWindows','maxAttemptsPerWindow','maxGpuFrames','context','dependencyAcknowledged'])},['policy'])
 ],['list','get'],{capabilities:['cpu'],list:[],get:[],start:['cpu','network'],resume:['cpu','network'],cancel:['cpu','network'],confirm:[],'authorize-repair':[],'repair-next':['cpu','gpu','network'],reconcile:['cpu','network']},[example('List analyses without starting repair or model downloads.',{action:'list'})]),
 group('finish','/api/finish','CPU edit/Post export, optional worker late upscaling, continuation import and explicit server Videos save. context is effectful: uploads and imports the completed native-resolution film.',[
  action('list',{projectId}),action('start',{id:str('Stable optional finishing ID.',{pattern:'^finish_[a-f0-9]{32}$'}),edit,upscale:choice('','flashvsr*2','flashvsr*4','lanczos*2','lanczos*4'),size:arr({...integer(16,4096),multipleOf:2},2,2),chunked:bool},['edit']),action('start',{id:str('Stable optional finishing ID.',{pattern:'^finish_[a-f0-9]{32}$'}),post,size:arr({...integer(16,4096),multipleOf:2},2,2),chunked:bool},['post']),...['get','context','cancel','reconcile','resume','save-to-videos'].map(a=>byId(a))
 ],['list','get'],{list:[],get:[],start:['cpu','gpu','network'],context:['cpu','network'],cancel:['network'],reconcile:['network'],resume:['cpu','gpu','network'],'save-to-videos':['cpu']},[example('List exports without starting or resuming work.',{action:'list'})]),
 group('studio','/api/studio','Published project storage, media metadata and portable backup history. No plaintext credential read tool. Prefer project mutations with compare-and-swap; backups omit worker output videos. Download completed backups with media_download URL /api/agent-backup/ followed by the exact returned backup ID; server verifies the archived SHA-256.',[
  action('list'),byId('get'),action('put',{project,expectedRevision:{anyOf:[integer(1),{type:'null'}],description:'Current server revision; null only for creating a new project.'}},['project','expectedRevision']),action('blob-info',{key:id},['key']),action('save-credentials',{credentials:obj({wangp:str('Worker bearer secret.',{writeOnly:true,maxLength:8192}),huggingface:str('Hugging Face secret.',{writeOnly:true,maxLength:8192}),wangpUrl:str('Configured worker URL.',{maxLength:8192})})},['credentials']),action('backup-list',{projectId}),byId('backup-get'),action('backup-start',{project},['project']),byId('backup-retry',{attemptId:str('New stable attempt ID; never reuse an uncertain attempt.',{pattern:'^[-a-zA-Z0-9_]{16,100}$'})},['attemptId'])
 ],['list','get','blob-info','backup-list','backup-get'],{list:[],get:[],put:[],'blob-info':[],'save-credentials':['network'],'backup-list':[],'backup-get':[],'backup-start':['cpu'],'backup-retry':['cpu']},[example('List published projects and their server revisions.',{action:'list'}),example('List verified portable-backup attempts.',{action:'backup-list'})]),
 single('render_progress','/api/render-progress','Coalesced live sequence, queue, worker health and native-job snapshot; queries worker and may run backend diagnostics.',obj(),['network','cpu'],[example('Inspect current renderer ownership without changing queue state.',{_allow:['network','cpu']})]),
 single('media_ticket','/api/media-ticket','Create a short-lived same-studio capability URL for one native output; no credentials or worker destination overrides.',obj({jobId:id,outputId},['jobId','outputId']),[],[example('Request a ticket for IDs obtained from worker job outputs.',{jobId:'0123456789abcdef0123456789abcdef',outputId:'abcdef0123456789abcdef0123456789'})]),
 group('renderer','/api/renderer','Explicitly restart only a renderer that backend diagnosis confirms exited. Does not authorize rendering; runtime startup can consume CPU/GPU resources.',[action('restart')],[],{restart:['cpu','gpu','network']},[example('Recover an exited renderer only after inspecting the failure.',{action:'restart',_allow:['cpu','gpu','network']})])
);

// Advanced native settings retain the worker as schema authority rather than duplicating its evolving model schema.
const nativeFields={model_type:str('Exact model_type from matching live model discovery.',{minLength:1}),prompt:str('Compiled H3 prompt or family-specific literal text.',{minLength:1,pattern:'\\S'}),alt_prompt:str('Optional alternative prompt; voice/music require literal nonempty content.'),num_inference_steps:integer(1,200),sample_solver:text,guidance_phases:integer(1,2),image_refs:arr(str('Owned h3media upload or permitted h3appearance ID.'),0,10),video_source:{anyOf:[str('Owned upload ID, never a filesystem path.'),{type:'null'}]},duration_seconds:num(3,180),seed:integer(-1,2147483647),start_frame:integer(0),end_frame:integer(1)};
const nativeFamily=(mode,properties,required)=>({type:'object',properties:{...nativeFields,mode:typeof mode==='string'?{const:mode}:choice('','generate'),...properties},required:[...(typeof mode==='string'?['mode']:[]),...required],additionalProperties:true});
const nativeTask={type:'object',description:'Use generation build/prepare helpers. Advanced settings must match schema/defaults/profile from GET /model?model_type= or its image/voice/music counterpart. Native engine remains authoritative for model-specific options, licenses, uploaded-media ownership and bounds.',oneOf:[
 nativeFamily(null,{image_refs:arr(nativeFields.image_refs.items,0,9)},['model_type','prompt','num_inference_steps','sample_solver']),
 nativeFamily('reference_image',{prompt:{...nativeFields.prompt,maxLength:24000},license_accepted:yes,num_inference_steps:integer(1,100),guidance_scale:num(0,20),resolution:str('256–2048 pixel dimensions divisible by 32.',{pattern:'^[0-9]+x[0-9]+$'}),acceleration_profile:text,preserve_first_scene:bool,camera_lora:str('Allowlisted camera LoRA id from image discovery profile.camera_loras; never a path.',{pattern:'^[a-z0-9-]{1,64}$'}),camera_lora_strength:num(0,2)},['model_type','prompt','license_accepted']),
 nativeFamily('reference_voice',{prompt:{...nativeFields.prompt,maxLength:4000},alt_prompt:{...nativeFields.prompt,maxLength:4000},duration_seconds:num(3,30),model_mode:choice('english','auto','chinese','japanese','korean','german','french','russian','portuguese','spanish','italian')},['model_type','prompt','alt_prompt']),
 nativeFamily('music',{prompt:{...nativeFields.prompt,maxLength:4000},alt_prompt:{...nativeFields.prompt,maxLength:4000},duration_seconds:num(5,180),num_inference_steps:integer(1,50)},['model_type','prompt','alt_prompt','duration_seconds','seed']),
 nativeFamily('edit_postprocessing',{spatial_upsampling:choice('flashvsr*2','flashvsr*4','lanczos*2','lanczos*4'),video_source:str('Owned uploaded video.',{pattern:'^h3media:[a-f0-9]{32}$'})},['video_source','spatial_upsampling'])
]};
const nativeBody=obj({request_id:id,project_id:projectId,project:str('Project display name.',{maxLength:300}),tasks:arr(nativeTask,1,10000),plan:arr(packet('Render-plan row built by core.js renderPlan.')),snapshot:packet('Exact generation.build/prepare snapshot: frozen H3 project for video, or typed reference-images/reference-voices/music provenance for auxiliary media. Never copy license authorization into saved settings.')},['request_id','project_id','tasks']);
const workerBranches=[
 obj({path:{enum:['/health','/queue','/models','/image-models','/voice-models','/music-models']},method:{const:'GET'}},['path','method'],'Discovery and queue snapshot; model lists expose supported presets.'),
 obj({path:str('Model schema/defaults/profile for an actual discovered model_type (URL-encode that value).',{pattern:'^/(?:image-|voice-|music-)?model\\?model_type=[A-Za-z0-9_.~%+:-]+$'}),method:{const:'GET'}},['path','method']),
 obj({path:str('Exact job, metadata or request lookup.',{pattern:'^/(?:jobs/[A-Za-z0-9_-]{1,128}(?:/metadata)?|requests/[A-Za-z0-9_-]{1,128})$'}),method:{const:'GET'}},['path','method']),
 obj({path:{enum:['/queue/pause','/queue/resume','/release-memory']},method:{const:'POST'},body:obj()},['path','method']),
 obj({path:str('Cancel exactly one accepted job.',{pattern:'^/jobs/[A-Za-z0-9_-]{1,128}/cancel$'}),method:{const:'POST'},body:obj()},['path','method']),
 obj({path:{const:'/import-render'},method:{const:'POST'},body:obj({media_id:str('Owned uploaded video ID.',{pattern:'^h3media:[a-f0-9]{32}$'}),plan:arr(packet('Actual frame mapping for the imported 24-fps video.'),1)},['media_id','plan'])},['path','method','body']),
 obj({path:{const:'/generate'},method:{const:'POST'},body:nativeBody,intent,renderMode:choice('sliding','independent')},['path','method','body'])
];
serviceTools.push({...single('worker','/api/wangp','Allowlisted native worker discovery, model schemas/presets, queue control, exact request/job lookup, media import and task dispatch. Uses path/method/body, not an action wrapper. Video requires a prepared intention; managed video must use sequence. Queue resume can dispatch previously queued GPU work.',{type:'object',oneOf:workerBranches},['network'],[
 example('Discover actual native video presets.',{path:'/models',method:'GET',_allow:['network']}),example('Inspect queue without resuming it.',{path:'/queue',method:'GET',_allow:['network']})]),effectsByAction:{'GET':['network'],'/generate':['network','cpu','gpu'],'/import-render':['network','cpu'],'/queue/pause':['network'],'/queue/resume':['network','gpu'],'/release-memory':['network','gpu'],'/jobs/:id/cancel':['network']}});
serviceTools.push(
 single('doctor',null,'Read authenticated studio identity, protocol/catalogue and published projects. Never read credentials, load models, call providers or resume queues.',obj(),[],[example('Inspect studio readiness without generation.',{})],true),
 single('media_upload',null,'Upload actual local media bytes to studio, worker or temporary voice storage. Upload alone does not register a project asset.',obj({file:str('Existing local regular media file.',{minLength:1}),type:str('Actual image/audio/video MIME type.',{pattern:'^(image|audio|video)/[A-Za-z0-9.+-]+$'}),key:id,destination:choice('studio','worker','voice')},['file','type']),['network'],[example('Upload a local WAV to temporary voice storage.',{file:'dialogue.wav',type:'audio/wav',destination:'voice',_allow:['network']})]),
 single('media_download',null,'Download real bytes from a same-studio media URL into a new local output file. Never send studio credentials to arbitrary URLs. Completed backups use /api/agent-backup/ plus their actual returned ID.',obj({url:str('Relative media URL returned by this studio.',{pattern:'^/api/(?:studio-blob\\?|studio-media/|finish-media/|sounds-media/|voice/audio/|media/|agent-backup/)'}),output:str('New local output filename; existing files are not overwritten.',{minLength:1})},['url','output']),['network'],[example('Save a completed finish to a new local file.',{url:'/api/finish-media/finish_0123456789abcdef0123456789abcdef',output:'film.mp4',_allow:['network']})]),
 single('reference_edit',null,'Set plate: edit one or more existing reference stills (project image asset IDs or local PNG/JPEG/WebP paths) into a NEW camera angle of the SAME location with an image-editing preset (default qwen_image_21_7B, Qwen Image 2.1, up to 10 ordered inputs). Composes references.register, references.planImages, generation.prepareImages, one worker /generate, job_wait and references.adoptImage; returns the adopted reference asset ID. windowIds attaches it to those windows. dryRun builds and validates the exact worker request without uploading, saving or submitting. Never resubmits; a lost or timed-out job is reported with its IDs.',{type:'object',oneOf:['sourceImage','sourceImages'].map(field=>obj({projectId,[field]:field==='sourceImage'?str('Image asset ID of this project, or a local image file path.',{minLength:1,maxLength:4096}):arr(str('Image asset ID or local file path; <image1> is the first.',{minLength:1,maxLength:4096}),1,10),prompt:str('Camera instruction, e.g. "same marble hall, reverse angle, the entrance door now behind the camera". Wrapped in a keep-the-same-room template unless it already uses <imageN> tokens or literalPrompt is true.',{minLength:1,maxLength:20000,pattern:'\\S'}),model:str('Discovered image model_type with input images (default qwen_image_21_7B).',{minLength:1,maxLength:200}),seed:integer(-1,2147483647),width:{...integer(256,2048),multipleOf:32},height:{...integer(256,2048),multipleOf:32},steps:integer(1,100),guidance:num(0,20),accelerationProfile:str('Discovered image profile ID, e.g. viggle-turbo-v0.2.1-6step.',{minLength:1,maxLength:300}),title:str('Card/asset title.',{minLength:1,maxLength:200}),windowIds:arr(id,0,1000),subjectId:id,requestId:id,licenseAccepted:{...yes,description:'Per-request acknowledgement of the selected model licence; required unless dryRun.'},literalPrompt:bool,multiAngleLora:{...bool,description:'Stack the Qwen-Image-2.1 Multiple-Angles camera LoRA (multiple-angles-v2, Apache-2.0). Opt-in. Needs cameraView or a literal prompt containing <mva>.'},multiAngleLoraStrength:{...num(0.05,2),description:'LoRA strength; card recommends 0.8–1.0 (default 1.0). Lower it if the result copies the source view.'},cameraView:str('Pose in the LoRA grammar "{azimuth}, {elevation}[ close-up]", e.g. "back view, eye-level shot". Azimuths: front, front-right, front-right quarter, right side, back-right quarter, back-right, back, back-left, back-left quarter, left side, front-left quarter, front-left (+" view"). Elevations: eye-level, elevated, high-angle, top-down (+" shot"). Prepended as "<mva> …".',{minLength:3,maxLength:200}),dryRun:bool,wait:bool,timeoutMs:integer(1000,86400000)},['projectId',field,'prompt']))},['network','cpu','gpu'],[example('Build and validate the exact worker request without submitting anything.',{projectId:'film',sourceImage:'marble-hall.png',prompt:'same marble hall, reverse angle, the entrance door now behind the camera',dryRun:true,_allow:['network']}),example('Render a set plate after explicit GPU approval and attach it to one window.',{projectId:'film',sourceImages:['0b7c2d1e-0000-4000-8000-000000000001'],prompt:'reverse angle, the entrance door now behind the camera',seed:7,windowIds:['window_1'],licenseAccepted:true,_allow:['network','cpu','gpu']})]),
 single('job_wait',null,'Poll only. Stop on completion, failure, review, pause or uncertainty; never reconcile, retry, approve, resume or adopt automatically.',obj({tool:choice('planner','sequence','reference_agent','finish','sounds','speech_quality','voice','worker'),id,timeoutMs:integer(1,86400000),intervalMs:integer(100,60000)},['tool','id']),[],[example('Wait for the exact planner request without starting another.',{tool:'planner',id:'railway_draft_01',timeoutMs:120000})],true)
);

const allowance=arr(choice(...EFFECTS),0,EFFECTS.length);
allowance.uniqueItems=true;allowance.description='Only scopes explicitly authorized by the human for this call. Presence is permission, never inferred from readiness or prior work.';
function decorate(schema){
 const result={...schema};
 if(schema.type==='object'&&(schema.properties||!schema.oneOf&&!schema.anyOf))result.properties={...schema.properties,_allow:allowance};
 if(schema.oneOf)result.oneOf=schema.oneOf.map(decorate);
 if(schema.anyOf)result.anyOf=schema.anyOf.map(decorate);
 return result;
}
const supported=new Set(['type','description','title','properties','required','additionalProperties','oneOf','anyOf','enum','const','items','minItems','maxItems','uniqueItems','minLength','maxLength','pattern','minimum','maximum','exclusiveMinimum','exclusiveMaximum','multipleOf','default','examples','readOnly','writeOnly']);
function checkSchema(schema,path){
 if(typeof schema==='boolean')return;
 if(!schema||typeof schema!=='object'||Array.isArray(schema))throw Error('Invalid catalogue schema at '+path);
 for(const key of Object.keys(schema))if(!supported.has(key))throw Error('Unsupported schema keyword '+path+'.'+key);
 if(schema.type&&!['object','array','string','number','integer','boolean','null'].includes(schema.type))throw Error('Unsupported schema type at '+path);
 if(schema.pattern)new RegExp(schema.pattern);
 for(const [key,value] of Object.entries(schema.properties||{}))checkSchema(value,path+'.'+key);
 if(schema.items)checkSchema(schema.items,path+'[]');
 if(typeof schema.additionalProperties==='object')checkSchema(schema.additionalProperties,path+'.*');
 for(const keyword of ['oneOf','anyOf'])for(const branch of schema[keyword]||[])checkSchema(branch,path+'.'+keyword);
}
export const AGENT_TOOLS=[...PROJECT_TOOLS,...MEDIA_TOOLS,...serviceTools].map(tool=>({...tool,inputSchema:decorate(tool.inputSchema)}));
const tools=new Map();
for(const tool of AGENT_TOOLS){
 if(tools.has(tool.name))throw Error('Duplicate agent tool '+tool.name);
 checkSchema(tool.inputSchema,tool.name);tools.set(tool.name,tool);
}
function invalid(message){return Object.assign(new Error(message),{code:'INVALID_ARGUMENTS',status:400});}
export function toolDefinition(name){const tool=tools.get(name);if(!tool)throw Object.assign(new Error('Unknown agent tool: '+name),{code:'UNKNOWN_TOOL',status:400});return tool;}
function equal(a,b){if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));}
function validate(schema,value,path){
 if(schema===true)return;if(schema===false)throw invalid(path+' is not allowed.');
 if(schema.const!==undefined&&!equal(value,schema.const))throw invalid(path+' must equal '+JSON.stringify(schema.const)+'.');
 if(schema.enum&&!schema.enum.some(v=>equal(v,value)))throw invalid(path+' must be one of '+schema.enum.map(x=>JSON.stringify(x)).join(', ')+'.');
 if(schema.type){const valid=schema.type==='null'?value===null:schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):schema.type==='integer'?Number.isSafeInteger(value):schema.type==='number'?typeof value==='number'&&Number.isFinite(value):typeof value===schema.type;if(!valid)throw invalid(path+' must be '+schema.type+'.');}
 for(const keyword of ['oneOf','anyOf'])if(schema[keyword]){
  let matches=0;const errors=[];
  const branches=schema[keyword],discriminator=['action','mode','path'].find(key=>value&&typeof value==='object'&&typeof value[key]==='string'&&branches.every(b=>b.properties?.[key]?.const!==undefined));
  const candidates=discriminator?branches.filter(b=>b.properties[discriminator].const===value[discriminator]):branches;
  for(const branch of candidates){try{validate(branch,value,path);matches++;}catch(e){errors.push(e.message);}}
  if(keyword==='oneOf'?matches!==1:matches===0)throw invalid(path+' must match '+(keyword==='oneOf'?'exactly one':'a')+' supported input shape. '+(candidates.length?errors.slice(0,4).join(' '):'Unknown '+discriminator+'.'));
 }
 if(typeof value==='string'){
  const length=[...value].length;
  if(schema.minLength!==undefined&&length<schema.minLength||schema.maxLength!==undefined&&length>schema.maxLength)throw invalid(path+' has an invalid length.');
  if(schema.pattern&&!new RegExp(schema.pattern).test(value))throw invalid(path+' has an invalid format.');
 }
 if(typeof value==='number'){
  if(!Number.isFinite(value))throw invalid(path+' must be finite.');
  if(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum||schema.exclusiveMinimum!==undefined&&value<=schema.exclusiveMinimum||schema.exclusiveMaximum!==undefined&&value>=schema.exclusiveMaximum||schema.multipleOf!==undefined&&Math.abs(value/schema.multipleOf-Math.round(value/schema.multipleOf))>1e-9)throw invalid(path+' is outside supported numeric bounds.');
 }
 if(Array.isArray(value)){
  if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)throw invalid(path+' has an invalid number of items.');
  if(schema.uniqueItems&&value.some((v,i)=>value.slice(0,i).some(p=>equal(p,v))))throw invalid(path+' must contain unique items.');
  if(schema.items)value.forEach((v,i)=>validate(schema.items,v,path+'['+i+']'));
 }
 if(value!==null&&typeof value==='object'&&!Array.isArray(value)){
  for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw invalid(path+'.'+key+' is required.');
  for(const [key,field] of Object.entries(value)){if(Object.hasOwn(schema.properties||{},key))validate(schema.properties[key],field,path+'.'+key);else if(schema.additionalProperties===false)throw invalid(path+'.'+key+' is not supported.');else if(typeof schema.additionalProperties==='object')validate(schema.additionalProperties,field,path+'.'+key);}
 }
}
export function validateArguments(tool,args){
 tool=typeof tool==='string'?toolDefinition(tool):tool;
 if(!tool||tools.get(tool.name)!==tool)throw invalid('Use a registered catalogue tool definition.');
 validate(tool.inputSchema,args,tool.name);
 if(tool.name==='worker'&&args.path==='/generate'){
  const tasks=args.body.tasks,auxiliary=tasks.every(t=>['reference_image','reference_voice','music'].includes(t.mode));
  if(!auxiliary&&(!args.intent||!args.renderMode&&!args.body.snapshot?.mode))throw invalid('Native video dispatch requires intent and a non-managed render mode.');
  if(args.body.snapshot?.mode==='managed')throw invalid('Managed video uses sequence.start, not worker dispatch.');
  for(const mode of ['reference_image','reference_voice','music'])if(tasks.some(t=>t.mode===mode)&&(tasks.some(t=>t.mode!==mode)||tasks.length>(mode==='music'?1:8)))throw invalid('Native '+mode+' tasks require their own bounded job.');
 }
 return args;
}
export function requiredEffects(tool,args){
 tool=typeof tool==='string'?toolDefinition(tool):tool;validateArguments(tool,args);
 if(tool.name==='project'&&args.action==='configure')return args.modelType?['network']:[];
 if(tool.name==='timeline'&&args.action==='adoptJob')return args.kind==='native'?['network']:[];
 if(tool.name==='worker'){
  if(args.method==='GET')return ['network'];
  if(args.path==='/generate')return ['network','cpu','gpu'];
  if(args.path==='/import-render')return ['network','cpu'];
  if(args.path==='/queue/resume'||args.path==='/release-memory')return ['network','gpu'];
  if(args.path==='/queue/pause'||/^\/jobs\/[A-Za-z0-9_-]+\/cancel$/.test(args.path))return ['network'];
  throw invalid('Unclassified worker operation.');
 }
 if(tool.name==='job_wait')return args.tool==='worker'?['network']:[];
 if(tool.name==='reference_edit')return args.dryRun===true?['network']:['network','cpu','gpu'];
 if(tool.name==='voice'&&(args.action==='transcribe'||args.action==='diarize'))return args.allowModels===true?['cpu','network']:['cpu'];
 if((tool.name==='voice'&&args.action==='import')||(tool.name==='sounds'&&args.action==='start'))return args.url?['cpu','network']:['cpu'];
 if(tool.name==='reference_agent'&&args.action==='extend-window')return args.resume===true?allWork.slice():[];
 if(tool.name==='reference_agent'&&args.action==='start'){
  const p=args.policy||args.project.referenceAutomation;
  return ['provider','network','cpu',...(p?.allowImages===false?[]:['gpu'])];
 }
 if(tool.name==='finish'&&args.action==='start')return ['cpu',...(args.upscale?['gpu','network']:args.post||args.edit?.cuts.some(c=>c.source.kind==='native')?['network']:[])];
 if(tool.name==='speech_quality'&&args.action==='start')return ['cpu',...(args.edit.cuts.some(c=>c.source.kind==='native')?['network']:[])];
 if(args.action!==undefined){if(!Object.hasOwn(tool.effectsByAction||{},args.action))throw invalid('Unclassified action for '+tool.name+'.');return [...tool.effectsByAction[args.action]];}
 if(Array.isArray(tool.effects))return [...tool.effects];
 throw invalid('Tool has no effect classification: '+tool.name);
}
