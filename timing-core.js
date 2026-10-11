/* Pure authored timing advice. No provider, worker, media or speech calls. */
(function(root,factory){const api=factory(typeof module==='object'?require('./core.js'):root.H3);if(typeof module==='object')module.exports=api;else root.H3Timing=api;})(globalThis,function(H){
  'use strict';
  const clone=H.clone,fail=m=>{throw Error(m);};
  function lines(w){return [...String(w.detail||'').matchAll(/<d>([\s\S]*?)<\/d>/g)].map((m,i)=>({id:i,text:m[1].replace(/^\[[^\]]+\]\s*/,''),block:m[0]}));}
  function sourceStamp(p,w){return JSON.stringify({projectId:p.id,mode:p.mode,maxSpan:p.maxSpan,preferences:p.timingPreferences,continuation:p.continuation,selectedTakes:p.selectedTakes,windows:p.windows.map(x=>[x.id,x.frames,x.overlap,x.detail,x.summary,x.entry,x.exit,x.continuity]),windowId:w.id});}
  function range(min,max,label){if(!Number.isFinite(min)||min<0||min>3600||max!==null&&(!Number.isFinite(max)||max<min||max>3600))fail('Invalid duration range for '+label);return {min,max};}
  function validatePlan(plan,w){if(plan?.version!==1||!Array.isArray(plan.groups)||plan.groups.length>128)fail('Timing plan needs version 1 and at most 128 ordered groups.');if(typeof plan.actionsReviewed!=='boolean')fail('Action review must be explicitly true or false.');const seen=new Set(),known=lines(w);for(const [i,g] of plan.groups.entries()){if(!Array.isArray(g.members)||!g.members.length||g.members.length>64)fail('Each ordered group needs 1–64 simultaneous members.');for(const m of g.members){if(!['action','dialogue','reaction','camera','hold','pause','constraint'].includes(m.kind))fail('Unknown timing member kind.');if(typeof m.label!=='string'||m.label.length>1000)fail('Timing members need a bounded label.');if(m.kind==='dialogue'){if(!Number.isInteger(m.line)||!known[m.line]||seen.has(m.line))fail('Unknown or duplicate dialogue assignment.');seen.add(m.line);}if(m.minSeconds!=null||m.maxSeconds!=null)range(m.minSeconds,m.maxSeconds??null,'group '+(i+1));}}return plan;}
  function analyzeWindow(p,w,options={}){
    const row=H.schedule(p).find(r=>r.id===w.id);if(!row)fail('Window no longer belongs to this project.');
    const target=Number(options.capacitySeconds??(p.plannerTiming?H.windowTiming(p).maximumGeneratedSeconds:p.timingPreferences?.capacitySeconds)??15);if(!Number.isFinite(target)||target<=0||target>3600)fail('Invalid generated-span capacity.');
    const wpm=options.wpm||p.timingPreferences?.wpm||[100,160];if(!Array.isArray(wpm)||wpm.length!==2||!wpm.every(n=>Number.isFinite(n)&&n>=20&&n<=500)||wpm[1]<wpm[0])fail('Invalid WPM range.');
    const source=sourceStamp(p,w),ls=lines(w),assumptions=['Capacity is an owner-reported planning preference, not a measured device limit.','Sequential groups sum; only explicitly simultaneous members share time.'];
    let plan=w.timingPlan,stale=!!plan&&plan.sourceStamp!==source;if(plan)validatePlan(plan,w);if(stale){assumptions.push('Saved timing plan is stale after text, geometry, selection or project changes; review it again.');plan=null;}
    const assigned=new Set(),groups=[],duration=m=>{
      if(m.kind==='constraint')return {min:0,max:0,reason:'Static continuity constraint; no elapsed time.'};
      if(m.kind==='dialogue')assigned.add(m.line);
      if(m.minSeconds!=null)return {...range(m.minSeconds,m.maxSeconds??null,m.label),reason:'Explicitly authored intended duration, not measured speech.'};
      if(m.kind!=='dialogue')return {min:0,max:null,reason:'Duration unspecified; no verb-duration guess.'};
      const text=ls[m.line]?.text||'';if(!text||/[^\u0000-\u024f\s\p{P}\p{N}]/u.test(text))return {min:0,max:null,reason:'Language/token timing needs an authored duration.'};
      const words=(text.match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu)||[]).length;
      return {min:60*words/wpm[1],max:60*words/wpm[0],reason:`Rough ${words}-word estimate at editable ${wpm[0]}–${wpm[1]} WPM; author pauses separately.`};
    };
    const add=g=>{const members=g.members.map(m=>({...m,...duration(m)}));groups.push({label:g.label||'Ordered group '+(groups.length+1),members,min:Math.max(...members.map(m=>m.min)),max:members.some(m=>m.max===null)?null:Math.max(...members.map(m=>m.max))});};
    for(const g of plan?.groups||[])add(g);
    for(const l of ls)if(!assigned.has(l.id))add({label:'Unassigned dialogue '+(l.id+1)+' · assumed sequential',members:[{kind:'dialogue',line:l.id,label:l.text}]});
    if(!plan?.actionsReviewed)add({label:'Action, reaction, camera, holds and pauses require review',members:[{kind:'action',label:'Unspecified action timing'}]});
    const min=groups.reduce((n,g)=>n+g.min,0),max=groups.some(g=>g.max===null)?null:groups.reduce((n,g)=>n+g.max,0),retained=row.kept/H.FPS,generated=row.span/H.FPS;
    const status=generated>target||row.span>p.maxSpan?'Over capacity':max===null?'Needs timing detail':min>retained||max>retained?'May be tight':'Fits stated assumptions';
    return {status,sourceStamp:source,stale,confidence:max===null?'unknown':groups.some(g=>g.members.some(m=>m.kind==='dialogue'&&m.minSeconds==null))?'rough':'authored',retainedSeconds:retained,newSeconds:retained,reusedOverlapSeconds:row.overlap/H.FPS,generatedSeconds:generated,generatedFrames:row.span,capacitySeconds:target,experimental:generated>15,requirement:{minSeconds:min,maxSeconds:max},groups,assumptions,missingEntryState:!String(w.entry||'').trim(),missingExitState:!String(w.exit||'').trim()};
  }
  function previewExtend(p,w,seconds,options={}){
    if(!Number.isFinite(seconds)||seconds<=0||seconds>3600)fail('Choose a positive intended retained duration.');
    const before=sourceStamp(p,w),rows=H.schedule(p),index=p.windows.findIndex(x=>x.id===w.id);if(index<0)fail('Window missing.');
    const need=Math.ceil(seconds*H.FPS),q=clone(p);let request=Math.max(w.frames,need),row;
    for(let i=0;i<=H.STEP*2;i++,request++){q.windows[index].frames=request;row=H.schedule(q)[index];if(row.kept>=need)break;}
    if(row.kept<need)fail('Cannot round to sufficient retained duration.');
    const analysis=analyzeWindow(q,q.windows[index],options),delta=row.kept-rows[index].kept;
    return {sourceStamp:before,projectId:p.id,windowId:w.id,requestedFrames:request,retainedFrames:row.kept,overlapFrames:row.overlap,generatedFrames:row.span,retainedSeconds:row.kept/H.FPS,generatedSeconds:row.span/H.FPS,overCapacity:row.span>p.maxSpan||row.span/H.FPS>analysis.capacitySeconds,experimental:row.span/H.FPS>15,downstreamShiftFrames:delta,downstreamWindowIds:p.windows.slice(index+1).map(x=>x.id),note:'Preview only. Existing jobs and selected takes retain their frozen ranges. Above 15s needs an explicit bounded experiment.'};
  }
  function applyExtend(p,preview){const w=p.windows.find(x=>x.id===preview.windowId);if(!w||p.id!==preview.projectId||sourceStamp(p,w)!==preview.sourceStamp)fail('Timing preview is stale; review again.');if(!Number.isSafeInteger(preview.requestedFrames)||preview.requestedFrames<w.frames)fail('Invalid extension preview.');const q=clone(p);q.windows.find(x=>x.id===w.id).frames=preview.requestedFrames;const row=H.schedule(q).find(x=>x.id===w.id),capacity=(p.plannerTiming?H.windowTiming(p).maximumGeneratedSeconds:p.timingPreferences?.capacitySeconds)??15;if(preview.overCapacity||row.span>p.maxSpan||row.span/H.FPS>capacity||row.span!==preview.generatedFrames||row.kept!==preview.retainedFrames)fail('Preview exceeds capacity or no longer matches schedule; no extension applied.');return q;}
  return {lines,sourceStamp,validatePlan,analyzeWindow,previewExtend,applyExtend};
});
