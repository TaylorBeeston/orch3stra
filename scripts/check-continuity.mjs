#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),H=require('../core.js'),C=require('../continuity-core.js');
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
function project(){const p=H.newProject();p.mode='managed';p.windows=Array.from({length:5},(_,i)=>({...H.newWindow('Room',209,i?18:0),id:'window-'+i,detail:'[Shot 1] The camera holds its framing.'}));p.referenceBoard={scenes:[{id:'room',windowIds:p.windows.map(w=>w.id)}]};return p;}
test('H3 window-size minimum is separate from the 107-frame generation span',()=>{
 const p=H.demo();p.mode='sliding';p.modelType='h3_ref2va_pruned_pdd8';p.maxSpan=107;
 assert(H.validate(p).some(x=>x.level==='error'&&x.message.includes('at least 124')));
 assert.throws(()=>H.tasks(p),/at least 124/);
 p.maxSpan=124;assert(!H.validate(p).some(x=>x.message.includes('window ceiling')));
 p.windows=[{...p.windows[0],frames:107,overlap:0}];assert.equal(H.tasks(p)[0].sliding_window_size,124);assert.equal(H.tasks(p)[0].video_length,107);
 p.maxSpan=107;p.modelType='unrelated_model';assert(!H.validate(p).some(x=>x.message.includes('at least 124')));
});
test('New source coordinates remain bounded as film coordinates increase',()=>{
 for(let i=0;i<1000;i++){const start=i*209,overlap=i?18:0,g=C.boundedGeometry({start_frame:start,end_frame:start+209,frames:209,overlap});assert.equal(g.source_end_frame,209+overlap);assert.equal(g.timeline_end_frame,start+209);}
});
test('Legacy cumulative and bounded source ranges describe the same retained length',()=>{
 const row={start_frame:24000,end_frame:24209,frames:209};
 assert.deepEqual(C.sourceRange({cumulative:true},row),{start:24000,end:24209,frames:209});
 assert.deepEqual(C.sourceRange({layout:'bounded-v1',source_start_frame:18,source_end_frame:227,probe:{frames:227}},row),{start:18,end:227,frames:209});
 assert.throws(()=>C.sourceRange({layout:'bounded-v1',source_start_frame:18,source_end_frame:999,probe:{frames:227}},row),/Invalid/);
});
test('Suffix context contains only needed tail ranges and never preceding prompts',()=>{
 const segments=[{outputId:'old-cumulative',inFrame:5000,outFrame:5209},{outputId:'new-bounded',inFrame:18,outFrame:22}];const snapshot=structuredClone(segments);
 assert.deepEqual(C.tailSelection(segments,18),[{outputId:'old-cumulative',inFrame:5195,outFrame:5209,frames:14},{outputId:'new-bounded',inFrame:18,outFrame:22,frames:4}]);assert.deepEqual(segments,snapshot);
 assert.throws(()=>C.tailSelection([],18),/Not enough/);assert.deepEqual(C.tailSelection(segments,0),[]);
});
test('One scene can contain several continuous shots; zero overlap and cuts reset groups',()=>{
 const p=project();p.windows[2].overlap=0;p.windows[4].detail='[Shot 1] Cut to a reverse view.';const plan=C.shotPlan(p);
 assert.equal(plan[0].incomingGroup,plan[1].incomingGroup);assert.notEqual(plan[1].incomingGroup,plan[2].incomingGroup);assert.equal(plan[2].incomingGroup,plan[3].incomingGroup);assert.notEqual(plan[3].incomingGroup,plan[4].incomingGroup);
});
test('Internal timestamped cut anchors the outgoing shot, not the opening pose',()=>{
 const p=project();p.windows[1].detail='[Shot 1] Hold the view. [Shot 2] At 00:04.200, the camera cuts to a close-up.';
 const plan=C.shotPlan(p);assert.equal(plan[1].anchorStartFrame,101);assert.notEqual(plan[1].incomingGroup,plan[1].outgoingGroup);assert.equal(plan[2].incomingGroup,plan[1].outgoingGroup);
});
test('Untimed internal cuts report skipped protection rather than guessing',()=>{
 const p=project();p.windows[1].detail='[Shot 1] Wide view. [Shot 2] Close-up.';assert.equal(C.shotPlan(p)[1].protection,'skipped');
});
test('Scene transitions reset automatically; explicit continuation override is honored',()=>{
 const p=project();p.referenceBoard.scenes=[{id:'a',windowIds:['window-0']},{id:'b',windowIds:p.windows.slice(1).map(w=>w.id)}];assert(!C.shotPlan(p)[1].linked);
 p.windows[1].continuity={mode:'continue'};assert(C.shotPlan(p)[1].linked);p.windows[1].overlap=0;assert(!C.shotPlan(p)[1].linked);
});
test('Appearance anchor never becomes the tenth image or displaces pins',()=>{
 const pool=Array.from({length:9},(_,i)=>({id:'image-'+i,kind:'image'})),snapshot=structuredClone(pool);
 assert(!C.anchorAdmission(pool,'anchor',{pins:['image-0']}).use);assert.deepEqual(pool,snapshot);assert(C.anchorAdmission(pool.slice(1),'anchor').use);assert(!C.anchorAdmission(pool.slice(1),'anchor',{excluded:['anchor']}).use);
});
console.log(`${count} bounded geometry/shot fixture checks passed. No live inference.`);
