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
console.log(count+' audio-route checks passed. No worker, model or GPU was used.');
