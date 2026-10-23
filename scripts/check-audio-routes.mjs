#!/usr/bin/env node
/** Pure H3 audio-route contracts: three voice references ('ABD') and kept soundtracks ('AS'). No worker, model or GPU. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const H3=createRequire(import.meta.url)('../core.js');
let count=0;function test(label,fn){fn();console.log('PASS '+label);count++;}
const detail='[Shot 1] A quiet kitchen at dawn. Three friends sit at the table and talk while the kettle starts to whistle.';
function fixture(audios=3){
 const p=H3.newProject();p.name='Audio routes';p.modelType='fixture_ref2va_pruned_pdd8';p.presetConfirmed=true;p.mode='independent';
 p.assets=[1,2,3].map(n=>({id:'img'+n,kind:'image',number:n,name:'face'+n+'.png'}));
 for(let n=1;n<=audios;n++)p.assets.push({id:'voice'+n,kind:'audio',number:n,name:'voice'+n+'.wav',duration:4});
 p.windows=[{...H3.newWindow('Kitchen',121,0),detail,summary:'[reference generation + audio reference] Three friends at breakfast.',soundscape:'Kettle hiss, chairs creak.',assetIds:p.assets.map(a=>a.id)}];
 return p;
}
const errors=p=>H3.validate(p,true).filter(x=>x.level==='error').map(x=>x.message);
test('Three standalone audio references compile to ABD with audio_guide3',()=>{
 const p=fixture(3);assert.deepEqual(errors(p).filter(m=>/audio/i.test(m)),[]);
 const t=H3.tasks(p,id=>'up:'+id)[0];
 assert.equal(t.audio_prompt_type,'ABD');assert.deepEqual([t.audio_guide,t.audio_guide2,t.audio_guide3],['up:voice1','up:voice2','up:voice3']);
});
test('One and two audio references keep A and AB with a null third slot',()=>{
 for(const [n,mode] of [[1,'A'],[2,'AB'],[0,'']]){const t=H3.tasks(fixture(n))[0];assert.equal(t.audio_prompt_type,mode);assert.equal(t.audio_guide3,null);}
});
test('A fourth audio reference is a validation error, not a silent drop',()=>{
 const p=fixture(3);p.assets.push({id:'img4',kind:'image',number:4,name:'face4.png'},{id:'voice4',kind:'audio',number:4,name:'voice4.wav',duration:3});p.windows[0].assetIds.push('img4','voice4');
 assert(errors(p).some(m=>/at most 3 standalone audio/.test(m)));
});
function song(mode='sliding'){
 const p=fixture(2);p.mode=mode;p.assets.push({id:'song',kind:'audio',number:3,name:'Song.wav',duration:30});
 const w0=p.windows[0];p.windows=[{...w0,id:'v1',title:'Verse 1',frames:121,overlap:0,soundtrack:{assetId:'song',startSeconds:2}},{...w0,id:'v2',title:'Verse 2',frames:121,overlap:mode==='independent'?0:18,soundtrack:{assetId:'song'}}];
 return p;
}
test('Independent soundtrack windows each get AS with their own contiguous slice and no voice references',()=>{
 const p=song('independent'),rows=H3.schedule(p),[a,b]=H3.soundtrackSlices(p);
 assert.deepEqual([a.startSeconds,b.startSeconds],[2,Math.round((2+rows[1].start/24)*1e6)/1e6]);assert.equal(b.continued,true);
 const t=H3.tasks(p,id=>'up:'+id);
 for(const [i,x] of t.entries()){assert.equal(x.audio_prompt_type,'AS');assert.equal(x.audio_guide,'up:song');assert.equal(x.audio_guide2,null);assert.equal(x.audio_guide3,null);assert.deepEqual(x._director_soundtrack,{start_seconds:[a,b][i].startSeconds,duration_seconds:[a,b][i].durationSeconds});assert(!/<Audio \d>/.test(x.prompt));}
 assert(H3.validate(p).some(x=>/voice and audio references are ignored/.test(x.message)));
 assert.deepEqual([...H3.mediaIds(p)].filter(id=>p.assets.find(a=>a.id===id).kind==='audio'),['song']);
});
test('Linked soundtrack windows send one PW task covering the whole timeline',()=>{
 const p=song('sliding'),t=H3.tasks(p,id=>'up:'+id),rows=H3.schedule(p);
 assert.equal(t.length,1);assert.equal(t[0].audio_prompt_type,'AS');assert.deepEqual(t[0]._director_soundtrack,{start_seconds:2,duration_seconds:Math.round(rows.reduce((n,r)=>n+r.kept,0)/24*1e6)/1e6});
});
test('Linked windows reject mixed or non-contiguous soundtracks before upload',()=>{
 const p=song('sliding');p.windows[1].soundtrack={assetId:'song',startSeconds:0};assert.throws(()=>H3.tasks(p),/must be contiguous/);
 const q=song('sliding');q.windows[1].soundtrack=null;assert(errors(q).some(m=>/same soundtrack/.test(m)));
});
test('Soundtrack validation: owned, audio, known duration, slice in range',()=>{
 const cases=[[p=>{p.windows[0].soundtrack.assetId='nope';},/not in this project/],[p=>{p.windows[0].soundtrack.assetId='img1';},/not an audio asset/],[p=>{delete p.assets.find(a=>a.id==='song').duration;},/no known duration/],[p=>{p.windows[0].soundtrack.startSeconds=25;},/exceeds Song.wav/],[p=>{p.assets.find(a=>a.id==='song').generationExcluded=true;},/excluded from generation/]];
 for(const [mutate,re] of cases){const p=song('independent');mutate(p);assert(errors(p).some(m=>re.test(m)),String(re));assert.throws(()=>H3.tasks(p));}
});
test('Soundtrack windows need no <d> lines, and warn when present',()=>{
 const p=song('independent');assert(!H3.validate(p).some(x=>/<d>/.test(x.message)));p.windows[0].detail+=' She sings: <d>[English] La la.</d>';assert(H3.validate(p).some(x=>/do not take <d> lines/.test(x.message)));
});
test('Managed single-window clones keep the resolved soundtrack offset',()=>{
 const S=createRequire(import.meta.url)('../studio-core.js'),p=song('managed'),slice=H3.soundtrackSlices(p)[1];
 const q=S.boundedManagedWindow(p,1,{jobId:'a'.repeat(32),outputId:'b'.repeat(32),keepFrames:121});
 assert.deepEqual(q.windows[0].soundtrack,{assetId:'song',startSeconds:slice.startSeconds});assert.equal(H3.tasks(q,id=>id)[0]._director_soundtrack.start_seconds,slice.startSeconds);
});
console.log(count+' audio-route checks passed. No worker, model or GPU was used.');
