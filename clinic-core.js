/* Live-project repair primitives. Captured takes, model responses and provenance are immutable. */
(function(root,factory){const H=typeof module==='object'&&module.exports?require('./core.js'):root.H3;const api=factory(H);if(typeof module==='object'&&module.exports)module.exports=api;else root.H3Clinic=api;})(globalThis,function(H){
'use strict';
const WINDOW_FIELDS=['title','definitions','summary','retention','detail','soundscape','music','entry','exit','notes'];
function fields(p){
 const out=[{key:'project/request',value:p.request||'',label:'Director brief',kind:'project',field:'request'}];
 for(const s of p.subjects) for(const f of ['name','description','voiceDesign'])out.push({key:`subject/${s.id}/${f}`,value:String(s[f]||''),label:`${s.name} · ${f}`,kind:'subject',subjectId:s.id,field:f});
 for(const a of p.assets)for(const f of ['description','role'])out.push({key:`asset/${a.id}/${f}`,value:String(a[f]||''),label:`${a.name} · ${f}`,kind:'asset',assetId:a.id,field:f});
 for(const w of p.windows){for(const f of WINDOW_FIELDS)out.push({key:`window/${w.id}/${f}`,value:String(w[f]||''),label:`${w.title} · ${f}`,kind:'window',windowId:w.id,field:f});for(const [sid,c]of Object.entries(w.casting||{}))for(const f of ['appearance','retention'])out.push({key:`cast/${w.id}/${sid}/${f}`,value:String(c[f]||''),label:`${w.title} · ${p.subjects.find(s=>s.id===sid)?.name||sid} · ${f}`,kind:'cast',windowId:w.id,subjectId:sid,field:f});}
 return out;
}
function locate(p,key){const f=fields(p).find(f=>f.key===key);if(!f)throw Error('This editable field no longer exists. Refresh the review.');let owner=f.kind==='project'?p:f.kind==='subject'?p.subjects.find(s=>s.id===f.subjectId):f.kind==='asset'?p.assets.find(a=>a.id===f.assetId):f.kind==='window'?p.windows.find(w=>w.id===f.windowId):p.windows.find(w=>w.id===f.windowId).casting[f.subjectId];return {field:f,owner};}
const spoken=text=>String(text).match(/<d>[\s\S]*?<\/d>/g)||[];
function applyPatches(p,patches,{allowDialogue=false}={}){
 if(!Array.isArray(patches)||patches.length>300)throw Error('At most 300 field edits per review.');
 const seen=new Set();for(const patch of patches){if(seen.has(patch.key))throw Error('Duplicate field edit.');seen.add(patch.key);const {field}=locate(p,patch.key);if(field.value!==patch.before)throw Error('The project changed: '+field.label+'. Review a fresh proposal.');if(typeof patch.after!=='string'||patch.after.length>80000)throw Error('Invalid replacement text.');if(!allowDialogue&&JSON.stringify(spoken(patch.before))!==JSON.stringify(spoken(patch.after)))throw Error('A repair would change spoken words. Enable explicit dialogue changes or revise it.');}
 for(const patch of patches){const {field,owner}=locate(p,patch.key);owner[field.field]=patch.after;}
 return p;
}
function effective(p,w){const a=H.pool(p,w);return {assets:a,images:a.filter(a=>a.kind==='image'),videos:a.filter(a=>a.kind==='video'),audios:a.filter(a=>a.kind==='audio')};}
function selectImages(p,windowId,ids){const w=p.windows.find(w=>w.id===windowId);if(!w)throw Error('Window not found.');const allowed=new Set(ids);if(ids.some(id=>!p.assets.some(a=>a.id===id&&a.kind==='image')))throw Error('Unknown image.');const q=H.clone(p),qw=q.windows.find(w=>w.id===windowId);qw.excludedAssetIds=[];const local=H.usedIds(q,qw);w.excludedAssetIds=[...new Set([...(w.excludedAssetIds||[]).filter(id=>p.assets.find(a=>a.id===id)?.kind!=='image'),...p.assets.filter(a=>a.kind==='image'&&local.has(a.id)&&!allowed.has(a.id)).map(a=>a.id)])];return p;}
function localCandidates(p,w){const q=H.clone(p),qw=q.windows.find(x=>x.id===w.id);qw.excludedAssetIds=[];const ids=H.usedIds(q,qw);return q.assets.filter(a=>ids.has(a.id));}
function references(p,assetId){const a=p.assets.find(a=>a.id===assetId);if(!a)return[];const tag=`<${a.kind==='image'?'Picture':a.kind==='video'?'Video':'Audio'} ${a.number}>`;const list=fields(p).filter(f=>f.value.includes(tag));for(const s of p.subjects)if((s.assetIds||[]).includes(assetId)||(s.referenceVariants||[]).some(v=>v.assetId===assetId)||s.voiceAssetId===assetId)list.push({label:s.name+' · bound source',subjectId:s.id,kind:'binding'});for(const w of p.windows)if(w.assetIds.includes(assetId)||Object.values(w.casting||{}).some(c=>c.sourceAssetIds?.includes(assetId)))list.push({label:w.title+' · loaded source',windowId:w.id,kind:'binding'});return list;}
// Only live registrations are rewritten. Never recursively replace IDs in jobs,
// captured submissions, candidate history, provenance, or historical snapshots.
function replaceRegistrations(p,fromId,toId){
 const map=xs=>[...new Set((xs||[]).flatMap(id=>id===fromId?(toId?[toId]:[]):[id]))];
 const exclusions=xs=>[...new Set([...(xs||[]),...map(xs)])];
 const mentions=v=>JSON.stringify(v||{}).includes(JSON.stringify(fromId));
 const affectedSubjects=new Set(p.subjects.filter(s=>mentions(s)).map(s=>s.id));
 const affectedScenes=new Set();
 for(const scene of p.referenceBoard?.scenes||[]){
  if(mentions({bankIds:scene.bankIds,pins:scene.pins,excluded:scene.excluded}))affectedScenes.add(scene.id);
  for(const k of ['bankIds','pins'])if(Array.isArray(scene[k]))scene[k]=map(scene[k]);
  if(Array.isArray(scene.excluded))scene.excluded=exclusions(scene.excluded);
 }
 for(const w of p.windows){
  const pol=w.referencePolicy,scene=(p.referenceBoard?.scenes||[]).find(s=>s.windowIds?.includes(w.id));
  const affected=mentions(w)||(w.subjectIds||[]).some(id=>affectedSubjects.has(id))||affectedScenes.has(scene?.id);
  if(pol){
   for(const k of ['pins','manualDirect','managedDirect','allowedSceneIds'])if(Array.isArray(pol[k]))pol[k]=map(pol[k]);
   if(Array.isArray(pol.excluded))pol.excluded=exclusions(pol.excluded);
   for(const k of ['manualSubjectSources','managedSourceValues'])for(const sid of Object.keys(pol[k]||{}))pol[k][sid]=map(pol[k][sid]);
   for(const requirement of pol.requirements||[])if(Array.isArray(requirement.assetIds))requirement.assetIds=map(requirement.assetIds);
   // Replacing pixels is never a positive visual judgement about the new file.
   if(pol.coverageEvidence)delete pol.coverageEvidence[fromId];
   if(affected)delete pol.lastManifest;
  }
  if(affected)delete w.referenceManifest;
 }
 return p;
}
function replaceAsset(p,fromId,toId){const a=p.assets.find(a=>a.id===fromId),b=p.assets.find(a=>a.id===toId);if(!a||!b||a.kind!==b.kind||a.id===b.id)throw Error('Choose another existing file of the same type.');H.assertGenerationInputs(p,[toId]);const type=a.kind==='image'?'Picture':a.kind==='video'?'Video':'Audio',before=`<${type} ${a.number}>`,after=`<${type} ${b.number}>`;
 applyPatches(p,fields(p).filter(f=>f.value.includes(before)).map(f=>({key:f.key,before:f.value,after:f.value.split(before).join(after)})));
 replaceRegistrations(p,fromId,toId);
 const map=xs=>[...new Set((xs||[]).map(id=>id===fromId?toId:id))];for(const s of p.subjects){s.assetIds=map(s.assetIds);if(s.voiceAssetId===fromId)s.voiceAssetId=toId;for(const v of s.referenceVariants||[])if(v.assetId===fromId)v.assetId=toId;}for(const w of p.windows){w.assetIds=map(w.assetIds);if(Array.isArray(w.excludedAssetIds))w.excludedAssetIds=[...new Set([...w.excludedAssetIds,...map(w.excludedAssetIds)])];for(const c of Object.values(w.casting||{}))if(c.sourceAssetIds)c.sourceAssetIds=map(c.sourceAssetIds);}
 if(Array.isArray(p.audioOrder))p.audioOrder=map(p.audioOrder);return p;
}
function scan(p){const out=[],seen=new Set(),add=x=>{const k=x.code+'|'+(x.key||x.windowId||'')+'|'+(x.token||x.message);if(!seen.has(k)){seen.add(k);out.push({id:'issue-'+out.length,...x});}};const all=fields(p);
 for(const f of all){const w=f.windowId&&!['notes','title'].includes(f.field)?p.windows.find(w=>w.id===f.windowId):null;const assets=w?H.pool(p,w):p.assets;for(const m of f.value.matchAll(/<(Picture|Video|Audio|Subject) (\d+)>/g)){const n=Number(m[2]),valid=m[1]==='Subject'?p.subjects.some(s=>s.number===n&&(!w||w.subjectIds.includes(s.id))):assets.some(a=>a.number===n&&a.kind===({Picture:'image',Video:'video',Audio:'audio'}[m[1]]));if(!valid)add({level:'error',code:'reference',...f,token:m[0],message:`${m[0]} is missing or not loaded here.`,action:'field'});}}
 for(const w of p.windows){const e=effective(p,w);if(e.images.length>9)add({level:'error',code:'image-budget',windowId:w.id,label:w.title,message:`${e.images.length} / 9 image inputs in ${p.mode==='sliding'?'the shared native task':'this task'}. Unload inputs; do not delete library files.`,action:'pool'});for(const id of [...w.assetIds,...Object.values(w.casting||{}).flatMap(c=>c.sourceAssetIds||[])])if(!p.assets.some(a=>a.id===id))add({level:'error',code:'binding',missingId:id,windowId:w.id,message:'A loaded source ID was deleted: '+id,action:'casting'});}
 for(const s of p.subjects){for(const id of [...(s.assetIds||[]),...(s.referenceVariants||[]).map(v=>v.assetId),...(s.voiceAssetId?[s.voiceAssetId]:[])])if(!p.assets.some(a=>a.id===id))add({level:(s.assetIds||[]).includes(id)||s.voiceAssetId===id?'error':'warning',code:'subject-binding',missingId:id,subjectId:s.id,message:s.name+((s.assetIds||[]).includes(id)||s.voiceAssetId===id?' has a missing source binding: ':' has a missing optional variant registration: ')+id,action:'subject'});
 // Deliberately narrow contradiction detector. Never replaces other characters or old image provenance.
 if(/\b(brunette|brown hair)\b/i.test(s.description))for(const f of all.filter(f=>f.kind==='cast'&&f.subjectId===s.id))if(/\bblack\s+(?:hair|bob)\b/i.test(f.value))add({level:'warning',code:'identity',...f,message:`${s.name}: this local override still says black hair/bob; the character card says brown. Review the intended state.`,action:'field'});}
 for(const x of H.validate(p)){if(x.level==='info')continue;const token=x.message.match(/<(?:Picture|Video|Audio|Subject) \d+>/)?.[0],w=p.windows.find(w=>w.id===x.windowId);if(token&&out.some(i=>i.code==='reference'&&i.token===token&&i.windowId===x.windowId))continue;let locator=null;if(token&&w){locator=all.find(f=>f.windowId===w.id&&!['notes','title'].includes(f.field)&&f.value.includes(token));if(!locator)locator=all.find(f=>f.kind==='subject'&&f.field==='description'&&w.subjectIds.includes(f.subjectId)&&!H.castFor(w,f.subjectId).appearance&&f.value.includes(token));}add({...x,...(locator||{}),windowId:x.windowId||locator?.windowId,code:'validation',label:locator?.label||w?.title||'Project',action:locator?'field':x.windowId?'window':'project'});}
 return out;
}
function repairMissingBinding(p,fromId,toId=null){
 if(p.assets.some(a=>a.id===fromId))throw Error('Source still exists; use normal source replacement.');
 const target=toId?p.assets.find(a=>a.id===toId):null;if(toId&&!target)throw Error('Choose an existing replacement.');
 let found=0;const check=(ids,voice=false)=>{if(!(ids||[]).includes(fromId))return;found++;if(target&&(voice?target.kind!=='audio':target.kind==='audio'))throw Error('Replacement media type does not match this binding.');};
 for(const subject of p.subjects){check(subject.assetIds);check((subject.referenceVariants||[]).map(v=>v.assetId));check([subject.voiceAssetId],true);}
 for(const w of p.windows){check(w.assetIds);for(const c of Object.values(w.casting||{}))check(c.sourceAssetIds);}
 if(!found)throw Error('No live dangling binding remains. Recheck the project.');
 replaceRegistrations(p,fromId,toId);
 const map=ids=>[...new Set((ids||[]).flatMap(id=>id===fromId?(toId?[toId]:[]):[id]))];
 for(const subject of p.subjects){subject.assetIds=map(subject.assetIds);subject.referenceVariants=(subject.referenceVariants||[]).flatMap(v=>v.assetId===fromId?(toId?[{...v,assetId:toId}]:[]):[v]);if(subject.voiceAssetId===fromId)subject.voiceAssetId=toId||'';}
 for(const w of p.windows){w.assetIds=map(w.assetIds);w.excludedAssetIds=map(w.excludedAssetIds);for(const c of Object.values(w.casting||{}))if(Array.isArray(c.sourceAssetIds))c.sourceAssetIds=map(c.sourceAssetIds);}
 p.referenceRepairs||=[];p.referenceRepairs.push({kind:'missing-binding',fromId,toId,locations:found,time:new Date().toISOString()});return p;
}
function liveStamp(p){return JSON.stringify({request:p.request,subjects:p.subjects,assets:p.assets.map(({id,number,kind,name,role,description})=>({id,number,kind,name,role,description})),windows:p.windows.map(w=>{const c={...w};return c;}),mode:p.mode});}
return{fields,locate,spoken,applyPatches,effective,selectImages,localCandidates,references,replaceAsset,repairMissingBinding,scan,liveStamp};
});
