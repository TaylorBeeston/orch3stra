// Agent-facing reference and generation contracts; all dispatch remains on existing services.
const text=(maxLength=4000)=>({type:'string',minLength:1,maxLength});
const id={...text(128),pattern:'^[A-Za-z0-9_-]+$'}, ids={type:'array',items:id,uniqueItems:true,maxItems:2000};
const bool={type:'boolean'}, integer=(minimum,maximum)=>({type:'integer',minimum,maximum});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const list=(items,maxItems=2000,minItems=0)=>({type:'array',items,minItems,maxItems});
const choice=(...values)=>({type:'string',enum:values});
const project={projectId:id}, write={...project,expectedRevision:integer(1,Number.MAX_SAFE_INTEGER)};
const branch=(action,properties={},required=Object.keys(properties))=>object({action:{const:action},...properties},['action',...required]);
const imageCard=object({title:text(200),prompt:text(24000),referenceIds:{...ids,maxItems:10},subjectId:{type:'string',maxLength:128},windowIds:ids,purpose:text(),state:text(500),appearance:text(),retention:text()},['prompt','referenceIds']);
const imageSettings=object({modelType:text(200),resolution:{type:'string',pattern:'^[0-9]+x[0-9]+$'},steps:integer(1,100),guidance:{type:'number',minimum:0,maximum:20},seed:integer(-1,2147483647),accelerationProfile:text(300),preserveFirstScene:bool,cameraLora:{...text(64),pattern:'^[a-z0-9-]+$'},cameraLoraStrength:{type:'number',minimum:0,maximum:2}},['modelType']);
const scene=object({name:text(200),windowIds:ids,bankIds:ids,location:{type:'string',maxLength:4000},time:{type:'string',maxLength:500},states:{type:'object',additionalProperties:{type:'string',maxLength:500}}},['name','windowIds']);
const annotation=object({subjectIds:ids,roles:list(choice('identity','wardrobe','setting','prop','angle','pose','style'),7),states:list(text(500),100),angles:list(text(500),100),quality:integer(0,3),approved:bool},['subjectIds','roles']);
const refs=[
 branch('list',project),
 branch('register',{...write,key:text(250),name:text(200),kind:choice('image','audio','video'),destination:choice('references','post'),description:{type:'string',maxLength:4000},role:{type:'string',maxLength:4000}},['projectId','expectedRevision','key','name','kind','destination']),
 branch('annotate',{...write,assetId:id,value:annotation}),
 branch('classify',{...write,assetId:id,kind:choice('scene','prop','style','direct'),description:{type:'string',maxLength:4000},role:{type:'string',maxLength:4000}},['projectId','expectedRevision','assetId','kind']),
 branch('assign',{...write,windowId:id,assetIds:ids}),
 branch('scenes',{...write,scenes:list(scene)}),
 branch('inspect',{...project,windowIds:ids},['projectId']),
 branch('applyManifest',{...write,windowId:id,sourceStamp:text(200)}),
 branch('recordInspection',{...write,windowId:id,assetId:id,requirementIds:{...ids,minItems:1,maxItems:12},reason:{...text(),minLength:10},pixelsInspected:{const:true},accepted:bool},['projectId','expectedRevision','windowId','assetId','requirementIds','reason','pixelsInspected']),
 branch('imagePlanPacket',{...project,request:text(24000)}),
 branch('planImages',{...write,proposal:object({images:list(imageCard,8,1),notes:list(text(),100)},['images'])}),
 branch('adoptImage',{...write,jobId:id,outputId:{type:'string',pattern:'^[a-f0-9]{32}$'},attachWindows:bool},['projectId','expectedRevision','jobId','outputId']),
 branch('adoptVoice',{...write,jobId:id,outputId:{type:'string',pattern:'^[a-f0-9]{32}$'},bind:bool},['projectId','expectedRevision','jobId','outputId','bind']),
 branch('adoptMusic',{...write,jobId:id,outputId:{type:'string',pattern:'^[a-f0-9]{32}$'}}),
 branch('toPost',{...write,assetId:id}),
 branch('mergePrepared',{...write,runId:id}),
 branch('copyCheckpoint',{...write,runId:id,checkpointId:{type:'string',pattern:'^checkpoint_[a-f0-9]{32}$'}})
];
const gen=[];
for(const prepare of [false,true]){
 const base=prepare?write:project,prefix=prepare?'prepare':'build';
 const common={...base,requestId:id};
 gen.push(branch(prefix+'Video',{...common,...(prepare?{owner:id,runId:id}:{}),windowIds:{...ids,minItems:1},strategy:choice('linked','independent'),context:{const:'fresh'}},[...Object.keys(common),...(prepare?['owner','runId']:[])]));
 gen.push(branch(prefix+'Images',{...common,planId:id,cardIds:{...ids,minItems:1,maxItems:8},settings:imageSettings,licenseAccepted:{const:true}}));
 gen.push(branch(prefix+'Voices',{...common,modelType:text(200),subjectIds:{...ids,minItems:1,maxItems:8},text:text(4000),language:choice('english','auto','chinese','japanese','korean','german','french','russian','portuguese','spanish','italian'),seconds:{type:'number',minimum:3,maximum:30},seed:integer(-1,2147483647)},['projectId',...(prepare?['expectedRevision']:[]),'requestId','modelType','subjectIds','text','language','seconds']));
 gen.push(branch(prefix+'Dialogue',{...common,modelType:{...text(200),description:'Fish Drama 3 voice model_type, e.g. fish_drama3.'},script:{...text(12000),description:'One line per utterance: "Speaker N: [direction] words" with N 1-16. Only <whisper>, <stress>, <slow> paired tags.'},voiceAssetIds:{...ids,maxItems:3,description:'Owned audio assets; the first is Speaker 1, then 2 and 3. Empty for new voices.'},transcripts:{...list(text(2000),3),description:'Exact words of each voice reference; defaults to the asset transcript or generated text.'},seconds:{type:'number',minimum:1,maximum:300},seed:integer(-1,2147483647)},['projectId',...(prepare?['expectedRevision']:[]),'requestId','modelType','script']));
 gen.push(branch(prefix+'Music',{...common,modelType:text(200),lyrics:text(4000),style:text(4000),seconds:{type:'number',minimum:5,maximum:180},seed:integer(-1,2147483647)}));
}
gen.push(branch('discover',{family:choice('video','image','voice','music'),modelType:text(200)},['family']));
const readRefs=['list','inspect','imagePlanPacket'];
const effectsRefs=Object.fromEntries(refs.map(b=>[b.properties.action.const,[]]));
for(const a of ['register','toPost','recordInspection','mergePrepared','copyCheckpoint'])effectsRefs[a]=['cpu'];
for(const a of ['adoptImage','adoptVoice','adoptMusic'])effectsRefs[a]=['network','cpu'];
const descriptor=(name,description,branches,readActions,effectsByAction,examples)=>({name,description,inputSchema:{type:'object',oneOf:branches},annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true},endpoint:'/api/agent',agent:true,readActions,effectsByAction,examples});
export const MEDIA_TOOLS=[
 descriptor('references','Register immutable uploaded media with measured metadata; author reference plans and metadata manifests; record explicitly attested pixel inspection separately; adopt authoritative completed outputs or source-stamped preparation. Mutations require current serverRevision. No generated result or visual evidence is invented.',refs,readRefs,effectsRefs,[{description:'Read registered references and saved image plan IDs',arguments:{action:'list',projectId:'film'}}]),
 descriptor('generation','Discover configured worker models and build request packets from the saved project. Optional video windowIds use an explicitly fresh context and linked/independent strategy without modifying the authored timeline. build actions never upload or dispatch and report missing handles. prepare actions persist request identity with CAS, upload referenced blobs, and prepare bridge-owned video intent. Execute returned operation separately with explicit GPU/network/CPU approval. License acknowledgement is per image request, never saved in project settings. Reconcile exact request IDs after uncertainty; never replay automatically.',gen,gen.map(b=>b.properties.action.const).filter(a=>!a.startsWith('prepare')),Object.fromEntries(gen.map(b=>[b.properties.action.const,b.properties.action.const.startsWith('prepare')?['network','cpu']:['network']])),[{description:'Discover real installed image presets before choosing a model',arguments:{action:'discover',family:'image'}}])
];
