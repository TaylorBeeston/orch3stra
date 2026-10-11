/* Pure bounded-media and shot continuity decisions. Never dispatches a render. */
(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./core.js'):root.H3);if(node)module.exports=api;else root.H3Continuity=api;})(globalThis,function(H){
'use strict';
const LAYOUT='bounded-v1';
const int=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
function sourceRange(output,row=null){
 if(output?.layout===LAYOUT){
  const start=output.source_start_frame,end=output.source_end_frame;
  if(!int(start)||!int(end,1)||end<=start||!int(output.probe?.frames,1)||end>output.probe.frames)throw Error('Invalid bounded clip source range.');
  if(row&&end-start!==row.frames)throw Error('Bounded clip does not match the retained timeline range.');
  return {start,end,frames:end-start};
 }
 const start=output?.cumulative?(row?.start_frame??output.start_frame):0;
 const end=output?.cumulative?(row?.end_frame??output.end_frame):(row?.frames??output.probe?.frames);
 if(!int(start)||!int(end,1)||end<=start)throw Error('Invalid saved clip source range.');
 return {start,end,frames:end-start};
}
function boundedGeometry(row){
 if(!int(row?.start_frame)||!int(row?.frames,1)||!int(row?.overlap)||row.overlap>H.MAX_OVERLAP||row.overlap>row.start_frame||row.end_frame!==row.start_frame+row.frames)throw Error('Invalid managed timeline geometry.');
 return {layout:LAYOUT,timeline_start_frame:row.start_frame,timeline_end_frame:row.end_frame,
  source_start_frame:row.overlap,source_end_frame:row.overlap+row.frames,context_frames:row.overlap};
}
function tailSelection(segments,count){
 if(!int(count)||count>H.MAX_OVERLAP)throw Error('Context tail exceeds the supported overlap.');
 let remaining=count;const selected=[];
 for(let i=segments.length-1;i>=0&&remaining;i--){const s=segments[i];
  if(!int(s.inFrame)||!int(s.outFrame,1)||s.outFrame<=s.inFrame||s.issue)throw Error('Cannot continue from an unverified edit range.');
  const n=Math.min(remaining,s.outFrame-s.inFrame);selected.unshift({...s,inFrame:s.outFrame-n,frames:n});remaining-=n;
 }
 if(remaining)throw Error('Not enough saved footage for this overlap; no preceding generation was requested.');
 return selected;
}
function sceneId(p,w){return w.sceneId||(p.referenceBoard?.scenes||[]).find(s=>s.windowIds?.includes(w.id))?.id||null;}
function cuts(w){
 const result=[];const text=String(w.detail||'');
 for(const match of text.matchAll(/\[Shot\s+(\d+)\]([^[]*)/gi)){
  const n=Number(match[1]);if(n===1)continue;
  const t=match[2].match(/^\s*(?:At\s+)?(?:(\d{1,2}):)?(\d{1,2}):(\d{2}(?:\.\d+)?)\b/i);
  result.push({shot:n,frame:t?Math.round((Number(t[1]||0)*3600+Number(t[2])*60+Number(t[3]))*H.FPS):null});
 }
 if(!result.length&&/\b(?:hard\s+cut|cut\s+to|(?:the\s+)?camera\s+cuts)\b/i.test(text.replace(/^\s*(?:\[Shot\s+1\]\s*)?(?:hard\s+cut|cut\s+to|(?:the\s+)?camera\s+cuts)\b/i,'')))result.push({shot:2,frame:null});
 return result;
}
function shotPlan(p){
 const rows=H.schedule(p),result=[];
 p.windows.forEach((w,i)=>{
  const mode=w.continuity?.mode||'auto';if(!['auto','continue','new-shot','off'].includes(mode))throw Error('Unknown continuous-shot override.');
  const previous=p.windows[i-1],scene=sceneId(p,w),previousScene=previous&&sceneId(p,previous);
  const openingCut=/^\s*(?:\[Shot\s+1\]\s*)?(?:hard\s+cut|cut\s+to|the\s+camera\s+cuts)\b/i.test(w.detail||'');
  const explicitNew=w.continuity?.shotId&&previous?.continuity?.shotId&&w.continuity.shotId!==previous.continuity.shotId;
  let linked=!!previous&&rows[i].overlap>0&&mode!=='new-shot'&&mode!=='off';
  if(mode!=='continue'&&(openingCut||explicitNew||(scene!==previousScene&&(scene||previousScene))))linked=false;
  const internal=cuts(w),uncertain=internal.some(c=>c.frame===null),last=internal.at(-1);
  const group=linked?result[i-1].outgoingGroup:'shot:'+w.id;
  result.push({windowId:w.id,sceneId:scene,mode,linked,incomingGroup:group,
   outgoingGroup:internal.length?'shot:'+w.id+':'+last.shot:group,
   anchorStartFrame:last?.frame??0,
   protection:mode==='off'?'disabled':uncertain?'skipped':'eligible',
   reason:mode==='off'?'Disabled for this window.':uncertain?'Internal shot cut lacks a timestamp; choose an explicit appearance anchor.':linked?'Linked overlap within a continuous shot.':'New shot or scene boundary.',
   internalCuts:internal});
 });return result;
}
function anchorAdmission(pool,anchorId,{pins=[],excluded=[]}={}){
 if(excluded.includes(anchorId))return {use:false,reason:'Appearance anchor is explicitly excluded.'};
 if(pool.some(a=>a.id===anchorId))return {use:true,alreadyPresent:true};
 const images=pool.filter(a=>a.kind==='image').length;
 if(images>=9||pool.length>=12)return {use:false,reason:'Appearance protection skipped: no image slot remains. Existing and pinned references were preserved.',pins:[...pins]};
 return {use:true,alreadyPresent:false};
}
return {LAYOUT,sourceRange,boundedGeometry,tailSelection,shotPlan,anchorAdmission};
});
