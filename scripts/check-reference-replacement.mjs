#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {ReferenceAgent} from '../reference-agent-server.mjs';
const require=createRequire(import.meta.url),H=require('../core.js'),C=require('../clinic-core.js'),R=require('../scene-core.js'),A=require('../reference-agent-core.js');
const old='3a17701c-20b5-4c84-9a82-7a3959941f7d',replacement='3ad24b6e-c2b1-4964-b81a-e020a37de9c7';
function fixture(){
 const p=H.newProject();p.mode='managed';
 p.assets=[old,replacement,'other'].map((id,i)=>({id,kind:'image',number:i+1,name:id+'.png',size:100,type:'image/png'}));
 p.subjects=[{id:'person',number:1,name:'Person',kind:'person',description:'A person.',assetIds:[old],referenceVariants:[]},{id:'other-person',number:2,name:'Other',kind:'person',description:'Other person.',assetIds:['other'],referenceVariants:[]}];
 p.windows=[{...H.newWindow('Club',209,0),id:'club',subjectIds:['person'],assetIds:[],casting:{person:{visibleShots:[1],voiceShots:[],sourceAssetIds:[replacement]}},referencePolicy:{managedSubjects:['person'],managedSourceValues:{person:[old]},manualSubjectSources:{person:[old]},pins:[old],requirements:[{id:'outfit',subjectId:'person',role:'wardrobe',state:'club',assetIds:[old]}]},referenceManifest:{selectedIds:[old]}},{...H.newWindow('Elsewhere',209,0),id:'elsewhere',subjectIds:['other-person'],assetIds:['other'],casting:{'other-person':{visibleShots:[1],voiceShots:[],sourceAssetIds:['other']}},referenceManifest:{selectedIds:['other'],usageGuard:'keep'}}];
 p.referenceBoard={version:3,annotations:{},scenes:[{id:'scene',name:'Club',windowIds:['club'],bankIds:[old],pins:[old],excluded:[],states:{}}]};
 p.jobs=[{id:'historic',snapshot:H.clone(p.windows[0])}];return p;
}
let count=0;const test=(label,fn)=>{fn();count++;console.log('PASS '+label);};
test('Exact reported replacement IDs update all live registrations, not historical captures',()=>{
 const p=fixture(),history=H.clone(p.jobs),unrelated=H.clone(p.windows[1]);C.replaceAsset(p,old,replacement);
 const w=p.windows[0];assert.deepEqual(w.casting.person.sourceAssetIds,[replacement]);
 assert.deepEqual(w.referencePolicy.managedSourceValues.person,[replacement]);assert.deepEqual(w.referencePolicy.manualSubjectSources.person,[replacement]);
 assert.deepEqual(w.referencePolicy.requirements[0].assetIds,[replacement]);assert.deepEqual(p.referenceBoard.scenes[0].bankIds,[replacement]);
 assert.deepEqual(p.referenceBoard.scenes[0].pins,[replacement]);assert.equal(w.referenceManifest,undefined);
 assert.deepEqual(p.jobs,history);assert.deepEqual(p.windows[1],unrelated);assert(p.assets.some(a=>a.id===old));
});
test('Explicit exclusions remain protected for both original and replacement media',()=>{
 const p=fixture();p.windows[0].excludedAssetIds=[old];p.referenceBoard.scenes[0].excluded=[old];C.replaceAsset(p,old,replacement);
 assert.deepEqual(new Set(p.windows[0].excludedAssetIds),new Set([old,replacement]));assert.deepEqual(new Set(p.referenceBoard.scenes[0].excluded),new Set([old,replacement]));
 assert(R.exclusions(p,p.windows[0]).has(replacement));
});
test('Existing valid evidence for unrelated pixels is retained; no evidence is copied to new pixels',()=>{
 const p=fixture();p.windows[0].referencePolicy.coverageEvidence={[old]:[{requirementId:'outfit',reason:'old proof'}],[replacement]:[{requirementId:'identity:person',reason:'already inspected replacement'}],other:[{requirementId:'other',reason:'untouched'}]};
 const expected=H.clone(p.windows[0].referencePolicy.coverageEvidence[replacement]);C.replaceAsset(p,old,replacement);
 assert.equal(p.windows[0].referencePolicy.coverageEvidence[old],undefined);assert.deepEqual(p.windows[0].referencePolicy.coverageEvidence[replacement],expected);assert.equal(p.windows[0].referencePolicy.coverageEvidence.other[0].reason,'untouched');
});
test('Failed pixel inspection overrides matching labels only for the inspected requirement',()=>{
 const p=fixture(),w=p.windows[0];w.casting.person.sourceAssetIds=[old];w.referencePolicy={states:{person:'club'}};
 R.annotate(p,old,{subjectIds:['person'],roles:['identity','wardrobe'],states:['club'],approved:true});
 let a=R.candidates(p,w).find(a=>a.id===old),needs=R.requirements(p,w).needs;
 assert(R.coverage(a,needs.find(r=>r.id==='state:person')));
 R.recordEvidence(p,w,old,['state:person'],{accepted:false,authority:'vision-agent',reason:'Actual inspected outfit does not match the required club clothing.'});
 a=R.candidates(p,w).find(a=>a.id===old);assert(!R.coverage(a,needs.find(r=>r.id==='state:person')));assert(R.coverage(a,needs.find(r=>r.id==='identity:person')));
 assert(R.resolve(p,w).missing.some(r=>r.id==='state:person'));
 R.recordEvidence(p,w,old,['state:person'],{authority:'user',reason:'I inspected these pixels and explicitly confirmed this exact club outfit.'});
 assert(R.coverage(R.candidates(p,w).find(a=>a.id===old),needs.find(r=>r.id==='state:person')));
});
test('Negative evidence expires when the inspected source changes',()=>{
 const p=fixture(),w=p.windows[0];w.referencePolicy={};w.casting.person.sourceAssetIds=[old];
 R.recordEvidence(p,w,old,['identity:person'],{accepted:false,reason:'This inspected image does not establish the intended identity.'});
 assert(!R.coverage(R.candidates(p,w).find(a=>a.id===old),R.requirements(p,w).needs[0]));p.assets[0].sha256='new-pixels';
 assert(R.coverage(R.candidates(p,w).find(a=>a.id===old),R.requirements(p,w).needs[0]));
});
test('Saved current negative inspection reconciles once without resetting progress or budget',()=>{
 const p=fixture(),w=p.windows[0];w.referencePolicy={states:{person:'club'}};w.casting.person.sourceAssetIds=[old];R.annotate(p,old,{subjectIds:['person'],roles:['identity','wardrobe'],states:['club'],approved:true});
 const items=[{assetId:old,imageKey:'I1',requirementIds:['state:person']}];
 const r={id:'saved-run',index:21,usage:{calls:8,images:3},candidates:[{id:'accepted',status:'accepted'}],windows:{done:{attempts:4}},project:p,policy:{threshold:.8},lastInspection:{windowId:w.id,items,attachedIds:[old],sourceStamp:A.inspectionStamp(p,w,items),raw:JSON.stringify({inspections:[{assetId:old,verdict:'does_not_fit',requirementIds:[],reason:'These inspected pixels have the wrong outfit despite their old labels.',score:1}]})}};
 const keep=JSON.stringify([r.index,r.usage,r.candidates,r.windows]);assert.equal(ReferenceAgent.prototype.reconcileInspectionEvidence(r,w),1);assert.equal(ReferenceAgent.prototype.reconcileInspectionEvidence(r,w),0);assert.equal(JSON.stringify([r.index,r.usage,r.candidates,r.windows]),keep);assert(R.resolve(p,w).missing.some(x=>x.id==='state:person'));
 delete r.lastInspection.coverageVersion;r.lastInspection.sourceStamp='stale';assert.equal(ReferenceAgent.prototype.reconcileInspectionEvidence(r,w),0);
});
console.log(`${count} reference replacement/rejection fixture checks passed. No live vision inference.`);
