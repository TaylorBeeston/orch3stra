/** Fish Drama 3 dialogue composite (voice_dialogue) against a fake client. No worker, GPU or downloads. */
import assert from 'node:assert/strict';
import {parseScript,dialogueRequest,DEFAULT_DIALOGUE_MODEL} from '../dialogue-core.mjs';
import {voiceDialogue} from '../voice-dialogue.mjs';
import {toolDefinition,validateArguments,requiredEffects} from '../agent-catalog.mjs';

assert.equal(DEFAULT_DIALOGUE_MODEL,'fish_drama3');
assert.deepEqual(parseScript('Speaker 2: [laughing] hi\n\n speaker 10 : <stress>no</stress>'),{speakers:[2,10],lines:2});
for(const [script,pattern] of [['',/1-12000/],['x'.repeat(12001),/1-12000/],['Speaker 0: hi',/Speaker 1 to Speaker 16/],['Speaker 1:   ',/no words/],['Speaker 1: <slow>a',/close each <slow>/],['Speaker 1: <break> a',/not a Drama 3 tag/],['Speaker 1: <|speaker:1|> a',/prompt builder/],['Hi\nSpeaker 1: a',/line 1/]])
 assert.throws(()=>parseScript(script),pattern,JSON.stringify(script));
const project={id:'film',name:'Film',assets:[
 {id:'v1',name:'Ann.wav',kind:'audio',duration:6,transcript:'Hello, I am Ann.'},
 {id:'v2',name:'Bob.wav',kind:'audio',duration:5,provenance:{intendedText:'Bob speaking now.'}},
 {id:'v3',name:'Cy.wav',kind:'audio',duration:4},
 {id:'still',name:'Still.png',kind:'image'},
 {id:'off',name:'Off.wav',kind:'audio',generationExcluded:true,transcript:'x'}]};
const handles={v1:'h3media:'+'1'.repeat(32),v2:'h3media:'+'2'.repeat(32),v3:'h3media:'+'3'.repeat(32)};
const script='Speaker 1: [calm] We should go.\nSpeaker 2: <whisper>Not yet.</whisper>\nSpeaker 3: Now!';
// Payload shape: three references map to ABD with transcripts in speaker order.
const three=dialogueRequest({project,script,voiceAssetIds:['v1','v2','v3'],transcripts:[undefined,undefined,'Cy here.'],seconds:30,seed:5,uploaded:handles});
assert.equal(three.audioPromptType,'ABD');
assert.deepEqual(three.task,{mode:'reference_voice',model_type:'fish_drama3',script,voices:[handles.v1,handles.v2,handles.v3],transcripts:['Hello, I am Ann.','Bob speaking now.','Cy here.'],duration_seconds:30,seed:5});
assert.deepEqual(three.snapshot.settings.speakers,[1,2,3]);
assert.equal(dialogueRequest({project,script,uploaded:handles}).audioPromptType,'');
assert.equal(dialogueRequest({project,script,voiceAssetIds:['v1'],uploaded:handles}).task.duration_seconds,60);
for(const [extra,pattern] of [[{voiceAssetIds:['v3']},/needs the exact words/],[{voiceAssetIds:['still']},/not audio/],[{voiceAssetIds:['off']},/excluded from generation/],[{voiceAssetIds:['v1','v2','v3','v1']},/at most three/],[{voiceAssetIds:['v1','v2'],script:'Speaker 1: alone'},/no matching Speaker 2/],[{seconds:301},/1-300/],[{seed:1.5},/seed/],[{voiceAssetIds:['v1'],transcripts:['a','b']},/one transcript per/]])
 assert.throws(()=>dialogueRequest({project,script,uploaded:handles,...extra}),pattern,JSON.stringify(extra));

// Composite: effects, dry run, and a refusal on an old worker that only knows Qwen.
const tool=toolDefinition('voice_dialogue');
assert.deepEqual(requiredEffects(tool,{projectId:'film',script,dryRun:true}),['network']);assert.deepEqual(requiredEffects(tool,{projectId:'film',script}),['network','cpu','gpu']);
validateArguments(tool,{projectId:'film',script,voiceAssetIds:['v1'],seconds:20,dryRun:true});
assert.throws(()=>validateArguments(tool,{projectId:'film',script,voiceAssetIds:['v1','v2','v3','v1']}));
const fish={metadata:{model_type:'fish_drama3',name:'Fish Drama 3'},profile:{kind:'reference_voice',architecture:'fish_drama3',script:true,max_voice_references:3}};
const fake=(discover)=>{const calls=[];return{calls,call:async(name,args)=>{calls.push(name+':'+(args.action||args.path||''));
 if(name==='project')return{project,serverRevision:4};
 if(name==='generation'&&args.action==='discover'){assert.equal(args.family,'voice');return discover(args);}
 throw new Error('dry run must not call '+name);}};};
const client=fake(()=>fish);
const dry=await voiceDialogue(client,{projectId:'film',script,voiceAssetIds:['v1','v2'],dryRun:true,requestId:'dialogue_1'});
assert.equal(dry.submitted,false);assert.equal(dry.audioPromptType,'AB');assert.deepEqual(dry.speakers,[1,2,3]);
assert.deepEqual(client.calls,['project:get','generation:discover']);
assert.equal(dry.workerRequest.body.tasks.length,1);assert.match(dry.workerRequest.body.tasks[0].voices[0],/^h3media:[a-f0-9]{32}$/);
assert.deepEqual(dry.workerRequest.body.tasks[0].transcripts,['Hello, I am Ann.','Bob speaking now.']);
await assert.rejects(voiceDialogue(fake(()=>{throw new Error('Only native Qwen3 TTS VoiceDesign is supported for this operation.');}),{projectId:'film',script,dryRun:true}),e=>e.code==='MODEL_UNSUPPORTED'&&/restart/.test(e.message));
await assert.rejects(voiceDialogue(fake(()=>({...fish,profile:{kind:'reference_voice',architecture:'qwen3_tts_voicedesign',script:false}})),{projectId:'film',script,dryRun:true}),e=>e.code==='MODEL_UNSUPPORTED');
await assert.rejects(voiceDialogue(fake(()=>fish),{projectId:'film',script:'Narrator: hi',dryRun:true}),e=>e.code==='INVALID_ARGUMENTS'&&e.details.dialogue.stage==='validate');
console.log('Voice dialogue composite checks passed: script grammar, A/AB/ABD payload shape, validation, dry run without uploads or submission.');
