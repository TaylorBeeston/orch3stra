/* Pure studio helpers; creative state is never changed by a render observation. */
(function(root,factory){const api=factory(typeof module==='object'?require('./core.js'):root.H3);if(typeof module==='object')module.exports=api;else root.H3Studio=api;})(globalThis,function(H3){
  'use strict';
  const secretKey=/^(?:authorization|cookie|set-cookie|token|apiKey|api_key|hfToken|huggingfaceToken|wangpToken|password|secrets|key|access_token|refresh_token|x-h3-token|x-wangp-token)$/i;
  function redact(value){
    if(typeof value==='string')return value.replace(/data:(?:image|audio|video)\/[^\s"']+/g,'[media omitted]').replace(/\b(?:hf_[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{12,})\b/g,'[credential omitted]').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi,'Bearer [omitted]');
    if(Array.isArray(value))return value.map(redact);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,secretKey.test(k)?'[omitted]':redact(v)]));
    return value;
  }
  function mediaKeys(p){return [...new Set([...p.assets.map(a=>a.id),...(p.postMedia||[]).map(a=>a.id),...(p.soundLibraries||[]).map(l=>l.source?.id).filter(Boolean),...(p.voiceWorkshops||[]).map(w=>w.blobKey),...p.assets.map(a=>'thumb:'+a.id),...Object.values(p.renderThumbnails||{})])];}
  function managedPlan(p){return H3.schedule(p).map((g,i)=>({id:p.windows[i].id,title:p.windows[i].title,task_index:i+1,window_index:1,start_frame:g.start,end_frame:g.end,frames:g.kept,overlap:g.overlap,span:g.span}));}
  function managedWindow(p,index,source=null,observedRow=null){
    if(p.mode!=='managed')throw Error('Choose Director-managed continuation first.');
    if(!Number.isInteger(index)||!p.windows[index])throw Error('Invalid sequence window.');
    const planned=H3.schedule(p)[index];
    const g=observedRow?{...planned,start:observedRow.start_frame,end:observedRow.end_frame,kept:observedRow.frames,overlap:observedRow.overlap}:planned;
    if(observedRow&&(!Number.isSafeInteger(g.start)||g.start<0||g.kept!==planned.kept||g.overlap!==planned.overlap))throw Error('Only the measured prefix boundary may differ for an unrendered window.');
    if(g.start>0&&(!source||source.keepFrames!==g.start))throw Error('A verified preceding prefix is required at this exact boundary.');
    const q=H3.clone(p);q.mode='sliding';q.windows=[{...q.windows[index],frames:g.kept,overlap:g.overlap}];q.jobs=[];q.variants=[];q.voiceWorkshops=[];delete q.continuation;
    if(source)q.continuation=H3.clone(source);
    const problems=H3.validate(q,true).filter(x=>x.level==='error');if(problems.length)throw Error(problems[0].message);
    const actual=H3.schedule(q)[0];if(actual.kept!==g.kept||actual.overlap!==g.overlap)throw Error('Single-window geometry differs from the submitted plan.');
    return q;
  }
  function boundedManagedWindow(p,index,source=null,observedRow=null){
    if(p.mode!=='managed'||!Number.isInteger(index)||!p.windows[index])throw Error('Invalid managed window.');
    const planned=H3.schedule(p)[index],row=observedRow||{start_frame:planned.start,frames:planned.kept,overlap:planned.overlap};
    if(!Number.isSafeInteger(row.start_frame)||row.start_frame<0||row.frames!==planned.kept||row.overlap!==planned.overlap)throw Error('Invalid bounded managed geometry.');
    if(row.overlap&&(!source||!Number.isSafeInteger(source.keepFrames)||source.keepFrames<row.overlap))throw Error('A verified preceding tail is required.');
    const q=H3.clone(p);q.mode='sliding';q.windows=[{...q.windows[index],frames:row.frames,overlap:row.overlap}];q.jobs=[];q.variants=[];q.voiceWorkshops=[];delete q.continuation;
    // The local plan contains overlap + new footage. The task keeps the original
    // source boundary separately so the worker can extract an old saved tail.
    if(row.overlap)q.continuation={...H3.clone(source),keepFrames:row.overlap};
    const errors=H3.validate(q,true).filter(x=>x.level==='error');if(errors.length)throw Error(errors[0].message);
    const actual=H3.schedule(q)[0];if(actual.kept!==row.frames||actual.overlap!==row.overlap)throw Error('Bounded task changed requested geometry.');
    return q;
  }
  // Warnings are deliberately narrow and labelled heuristic. No NLP guess changes a shot.
  function continuityWarnings(p){
    const out=[],add=(code,w,message,extra={})=>out.push({level:'warning',code,windowId:w.id,message,...extra});
    p.windows.forEach((w,i)=>{
      const prev=p.windows[i-1],d=w.detail||'',entry=w.entry||'',exit=w.exit||'';
      if(/\[Shot\s+1\]\s*\[Shot\s+1\]/i.test(d))add('duplicate-shot',w,`${w.title}: repeated [Shot 1] marker.`);
      const afterPhone=/phone[^.]{0,85}(?:hanging|at (?:his|her|their) side|lowered|pocketed)|(?:hanging|pocketed)[^.]{0,45}phone/i;
      const atEar=/\bphone\b[^.]{0,100}\b(?:ear|listening)\b|\b(?:holds?|keeps?)\b[^.]{0,60}\bphone\b[^.]{0,55}\bear\b/i;
      if(prev&&prev.subjectIds.some(id=>w.subjectIds.includes(id)&&H3.castFor(prev,id).visibleShots?.length&&H3.castFor(w,id).visibleShots?.length)&&afterPhone.test(prev.exit||'')&&atEar.test(d.slice(0,420)))add('phone-reset',w,`${w.title}: the previous exit lowers/pockets the phone, but this opening puts it near the ear again. Review before rerendering.`,{previousWindowId:prev.id});
      if(/parked/i.test(exit)&&/(?:slows toward|approaches|comes into view)/i.test(d.slice(-550)))add('arrival-state',w,`${w.title}: exit says parked, while the action still describes approaching. Choose one handoff state.`);
      const events=[/keys|unlock/i,/driver|car door/i,/ignition|starts? the engine/i,/red light/i,/neon.*(?:building|bowling)|bowling.*(?:view|ahead)/i].filter(re=>re.test(d)).length;
      if(events>=4&&H3.schedule(p)[i].kept/H3.FPS<12)add('compressed-travel',w,`${w.title}: several travel stages fit in under 12 seconds. Simplify the action or use explicit timed cuts.`);
      if(prev&&w.overlap===0&&/continu(?:e|es|ing)|still standing|directly from/i.test(d.slice(0,240)))add('cut-versus-continuity',w,`${w.title}: this is a hard cut, although its opening asks to continue the previous pose. Intentional cuts are fine; confirm the state.`);
    });return out;
  }
  function diagnostic(p,traces=[]){const copy=H3.clone(p);return redact({format:'h3-director-diagnostic',version:'1.1.0',createdAt:new Date().toISOString(),notice:'Contains private prompts, transcripts, filenames and output paths. No media bytes or credentials. Review before sharing.',project:copy,traces,validation:H3.validate(p),continuity:continuityWarnings(p),compiled:p.windows.map((w,i)=>({windowId:w.id,title:w.title,geometry:H3.schedule(p)[i],references:H3.refMap(p,w,i).map(a=>({id:a.id,name:a.name,authoring:a.libraryToken,submitted:a.token})),prompt:H3.compileWindow(p,w,i,p.mode!=='independent')}))});}
  return {redact,mediaKeys,managedPlan,managedWindow,boundedManagedWindow,continuityWarnings,diagnostic};
});
