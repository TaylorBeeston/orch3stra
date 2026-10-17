import assert from 'node:assert/strict';
import {toolDefinition,validateArguments,requiredEffects} from '../agent-catalog.mjs';

// Pure contracts only: no bridge, providers, worker, model downloads or user state.
const invalid=(name,args)=>{
 assert.throws(()=>validateArguments(name,args),e=>e.code==='INVALID_ARGUMENTS');
 assert.throws(()=>requiredEffects(name,args),e=>e.code==='INVALID_ARGUMENTS','effect classification must not bypass validation');
};
assert.throws(()=>toolDefinition('not_a_service'),e=>e.code==='UNKNOWN_TOOL');
invalid('planner',{});
invalid('planner',{action:'retry',id:'draft_1'});
invalid('planner',{action:'get',id:'draft_1',request:{}});
invalid('planner',{action:'get',id:'draft_1',detail:'true'});
invalid('planner',{action:'start',request:{requestId:'draft_1',provider:'deepseek',model:'deepseek-chat',system:'',prompt:'   '}});
invalid('planner',{action:'start',request:{requestId:'draft_1',provider:'deepseek',model:'deepseek-chat',system:'',prompt:'A title',extra:true}});
for(const _allow of ['gpu',[true],['all'],['gpu','gpu'],null])invalid('planner',{action:'list',_allow});
assert.deepEqual(requiredEffects('planner',{action:'list',_allow:['gpu']}),[],'permissions never create work');
assert.deepEqual(requiredEffects('project',{action:'configure',projectId:'film',expectedRevision:1,name:'A new title',request:'A quiet station.'}),[]);
assert.deepEqual(requiredEffects('project',{action:'configure',projectId:'film',expectedRevision:1,modelType:'discovered_h3_model'}),['network']);
for(const kind of ['native','managed','finished'])assert.deepEqual(requiredEffects('timeline',{action:'adoptJob',projectId:'film',expectedRevision:1,kind,jobId:'render_1'}),kind==='native'?['network']:[]);
invalid('studio',{action:'credentials'});
invalid('doctor',{credentials:true});
invalid('studio',{action:'put',project:{id:'film',windows:[],assets:[],subjects:[]},expectedRevision:0});
assert.deepEqual(requiredEffects('studio',{action:'put',project:{id:'film',windows:[],assets:[],subjects:[]},expectedRevision:null}),[]);
invalid('sequence',{action:'clear-idle',ids:[]});
invalid('sequence',{action:'clear-idle',ids:Array(201).fill('seq_1')});
invalid('job_wait',{tool:'worker',id:'job',intervalMs:99});
invalid('job_wait',{tool:'worker',id:'job',timeoutMs:1.5});
invalid('voice',{action:'import',uploadId:'source',url:'https://www.youtube.com/watch?v=abcdefghijk',rightsConfirmed:true});
invalid('voice',{action:'import',uploadId:'source',rightsConfirmed:false});
invalid('sounds',{action:'scan',id:'sound',revision:1,confirm:true,options:{thresholdDb:-81}});
invalid('speech_quality',{action:'authorize-repair',id:'speech',policy:{enabled:true,maxWindows:1,maxAttemptsPerWindow:2,maxGpuFrames:100,context:'fresh-independent',dependencyAcknowledged:true}});
for(const args of [
 {path:'/shutdown',method:'POST'},
 {path:'/generate',method:'GET'},
 {path:'/health',method:'POST'},
 {path:'/health',method:'GET',body:{}},
 {path:'/health',method:'GET',url:'https://attacker.invalid'},
 {path:'/model?model_type=x&token=secret',method:'GET'},
 {path:'/jobs/../health',method:'GET'},
 {path:'/queue/resume',method:'POST',body:{force:true}},
 {path:'/generate',method:'POST',body:{request_id:'r',project_id:'film',tasks:[{}]}}
])invalid('worker',args);
assert.deepEqual(requiredEffects('worker',{path:'/queue',method:'GET'}),['network']);
assert.ok(requiredEffects('worker',{path:'/queue/resume',method:'POST'}).includes('gpu'));
assert.deepEqual(requiredEffects('job_wait',{tool:'worker',id:'job'}),['network']);
assert.deepEqual(requiredEffects('voice',{action:'transcribe',sourceId:'source',allowModels:false}),['cpu']);
assert.deepEqual(requiredEffects('voice',{action:'transcribe',sourceId:'source',allowModels:true}),['cpu','network']);
assert.deepEqual(requiredEffects('voice',{action:'import',uploadId:'source',rightsConfirmed:true}),['cpu']);
assert.deepEqual(requiredEffects('voice',{action:'import',url:'https://www.youtube.com/watch?v=abcdefghijk',rightsConfirmed:true}),['cpu','network']);
assert.ok(requiredEffects('finish',{action:'context',id:'finish_1'}).includes('network'));
assert.ok(!toolDefinition('finish').readActions.includes('context'));
assert.ok(!toolDefinition('speech_quality').readActions.includes('reconcile'));
assert.deepEqual(requiredEffects('reference_agent',{action:'extend-window',id:'run',confirm:true,budgetStamp:'fresh',limit:20,resume:false}),[]);
assert.ok(requiredEffects('reference_agent',{action:'extend-window',id:'run',confirm:true,budgetStamp:'fresh',limit:20,resume:true}).includes('gpu'));
const edit={format:'h3-edit',fps:24,projectId:'film',cuts:[{windowId:'window',source:{kind:'managed',jobId:'seq',outputId:'a'.repeat(32)},inFrame:0,outFrame:24}]};
assert.deepEqual(requiredEffects('finish',{action:'start',edit}),['cpu']);
const reviewedEdit={...edit,cuts:edit.cuts.map(cut=>({...cut,continuityReview:'reviewed-current-source-stamp'}))};
assert.deepEqual(requiredEffects('finish',{action:'start',edit:reviewedEdit}),['cpu'],'A reviewed Edit.selection packet must remain exportable without stripping its source stamp');
invalid('finish',{action:'start',edit:{...edit,cuts:edit.cuts.map(cut=>({...cut,continuityReview:{stamp:'fabricated'}}))}});
assert.ok(requiredEffects('finish',{action:'start',edit,upscale:'lanczos*2'}).includes('gpu'));
invalid('finish',{action:'start',edit,size:[17,32]});
invalid('finish',{action:'start',edit,post:{format:'h3-post',version:1,projectId:'film',post:{},media:[]}});
const auxiliary={path:'/generate',method:'POST',body:{request_id:'voice_1',project_id:'film',tasks:[{mode:'reference_voice',model_type:'discovered_voice_model',prompt:'The last train is leaving.',alt_prompt:'A gentle original alto.',duration_seconds:5}],snapshot:{kind:'reference-voices'}}};
assert.ok(requiredEffects('worker',auxiliary).includes('gpu'));
invalid('worker',{...auxiliary,body:{...auxiliary.body,tasks:Array(9).fill(auxiliary.body.tasks[0])}});
const native={path:'/generate',method:'POST',intent:{id:'intent_1',lease:'lease_1'},renderMode:'independent',body:{request_id:'render_1',project_id:'film',tasks:[{model_type:'discovered_h3_model',prompt:'A quiet station.',num_inference_steps:8,sample_solver:'euler',video_source:null}]}};
assert.deepEqual(requiredEffects('worker',native),['network','cpu','gpu'],'Core mediaSettings emits a valid null video_source');
invalid('worker',{...native,intent:undefined});
assert.deepEqual(requiredEffects('media_download',{url:'/api/agent-backup/backup_'+'a'.repeat(64),output:'film.h3project'}),['network']);
invalid('media_download',{url:'https://attacker.invalid/api/media/ticket',output:'film.mp4'});
console.log('Agent catalogue schema, permission and service-boundary checks passed.');
