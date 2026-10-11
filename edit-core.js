/* Frame-accurate edit decisions over immutable generated takes. No renderer I/O. */
(function(root,factory){const api=factory(typeof module==='object'?require('./core.js'):root.H3);if(typeof module==='object')module.exports=api;else root.H3Edit=api;})(globalThis,function(H3){
  'use strict';
  const FPS=24;
  function finishId(){if(!globalThis.crypto?.getRandomValues)throw Error('This browser cannot create a secure export request ID.');return 'finish_'+Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');}
  const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min;
  function rawSegment(p,id){
    const saved=p.editCuts?.[id],sourceId=saved?.sourceWindowId||id;
    const wanted=p.selectedTakes?.[id]||saved?.jobId;
    const job=wanted?p.jobs.find(j=>j.id===wanted):p.jobs.map((j,i)=>({j,i})).filter(x=>!x.j.speechAlternative&&H3.renderSegment(x.j,sourceId)).sort((a,b)=>(Date.parse(b.j.createdAt)||0)-(Date.parse(a.j.createdAt)||0)||b.i-a.i)[0]?.j;
    if(!job)return null;
    const raw=H3.renderSegment(job,sourceId);if(!raw)return null;
    let start=Math.round(raw.start*FPS),end=Math.round(raw.end*FPS);
    // A trim belongs to a particular immutable take. Never transfer its offsets
    // to a different replacement or silently clamp an invalid saved edit.
    let issue=null;
    if(saved&&saved.jobId===job.id){
      if(saved.outputId!==raw.output.id)issue='This trimmed source changed or is unavailable. Reset the trim or reselect its original take.';
      else if(!integer(saved.inFrame)||!integer(saved.outFrame,1)||saved.inFrame<start||saved.outFrame>end||saved.outFrame<=saved.inFrame)issue='Trim is outside the saved take.';
      else {start=saved.inFrame;end=saved.outFrame;}
    }
    return{...raw,job,windowId:id,sourceWindowId:sourceId,start:start/FPS,end:end/FPS,inFrame:start,outFrame:end,frames:end-start,rawInFrame:Math.round(raw.start*FPS),rawOutFrame:Math.round(raw.end*FPS),issue,trimmed:start!==Math.round(raw.start*FPS)||end!==Math.round(raw.end*FPS)};
  }
  // Compare immutable captured conditioning to the currently selected edit.
  // Never mutate render snapshots or launch work when a take changes.
  function identity(s){return s?{jobId:s.job.id,outputId:s.output.id,inFrame:s.inFrame,outFrame:s.outFrame}:null;}
  function dependencies(p,s,seen=new Set()){
    const dependencyKey=s.job.id+':'+s.sourceWindowId;if(seen.has(dependencyKey))return [{windowId:'unknown',source:null}];const visited=new Set(seen);visited.add(dependencyKey);
    const j=s.job,id=s.sourceWindowId,rows=j.plan||[],at=rows.findIndex(r=>r.id===id),row=rows[at];
    if(j.sourceEdit){const c=j.sourceEdit.cuts?.find(c=>c.windowId===id),owner=p.jobs.find(x=>x.id===c?.source.jobId),raw=owner&&H3.renderSegment(owner,id);if(raw&&owner.id!==j.id)return dependencies(p,{job:owner,sourceWindowId:id,output:raw.output},visited);return [{windowId:'unknown',source:null}];}
    if(j.kind==='finished')return [{windowId:'unknown',source:null}];
    if(!row||!(row.overlap>0)||j.snapshot?.mode==='independent')return [];
    if(at>0){const prev=rows[at-1],raw=H3.renderSegment(j,prev.id);return raw?[{windowId:prev.id,contextFrames:row.overlap,source:{jobId:j.id,outputId:raw.output.id,inFrame:Math.round(raw.start*FPS),outFrame:Math.round(raw.end*FPS)}}]:[{windowId:prev.id,source:null}];}
    if(Array.isArray(j.snapshot?.conditioningCuts))return H3.clone(j.snapshot.conditioningCuts);
    // Older branches retain explicit predecessor selections in their frozen snapshot.
    const i=p.windows.findIndex(w=>w.id===id),wid=p.windows[i-1]?.id,snap=j.snapshot;
    if(!wid)return [{windowId:'unknown',source:null}];
    const saved=snap?.editCuts?.[wid],wanted=snap?.selectedTakes?.[wid]||saved?.jobId,owner=p.jobs.find(x=>x.id===wanted),raw=owner&&H3.renderSegment(owner,saved?.sourceWindowId||wid);
    return [{windowId:wid,contextFrames:row.overlap,source:raw?{jobId:owner.id,outputId:raw.output.id,inFrame:saved?.inFrame??Math.round(raw.start*FPS),outFrame:saved?.outFrame??Math.round(raw.end*FPS)}:null}];
  }
  // Compact deterministic 128-bit change fingerprint, not an authentication hash.
  function fingerprint(text){let a=0xcbf29ce484222325n,b=0x84222325cbf29ce4n;for(let i=0;i<text.length;i++){const n=BigInt(text.charCodeAt(i));a=BigInt.asUintN(64,(a^n)*0x100000001b3n);b=BigInt.asUintN(64,(b^n)*0x100000001b3n);}return a.toString(16).padStart(16,'0')+b.toString(16).padStart(16,'0');}
  function contextMatches(d,actual){const expected=d.source;if(!expected||!actual)return false;const n=d.contextFrames??(expected.outFrame-expected.inFrame);return expected.jobId===actual.jobId&&expected.outputId===actual.outputId&&expected.outFrame===actual.outFrame&&actual.inFrame<=expected.outFrame-n;}
  function continuity(p,id,seen=new Set(),memo=new Map()){
    const s=rawSegment(p,id);if(!s)return {issue:null,stamp:'',dependencies:[]};
    const key=s.job.id+':'+s.sourceWindowId+':'+id+':'+s.inFrame+':'+s.outFrame;if(memo.has(key))return memo.get(key);if(seen.has(key))return {issue:'Continuity dependency cycle. Inspect the saved takes.',stamp:key,dependencies:[]};
    const next=new Set(seen);next.add(key);const deps=dependencies(p,s),parents=deps.map(d=>continuity(p,d.windowId,next,memo)),actual=deps.map((d,i)=>({windowId:d.windowId,source:identity(rawSegment(p,d.windowId)),continuityStamp:parents[i].stamp})),stamp=fingerprint(JSON.stringify({take:identity(s),ancestors:actual}));
    const ancestor=deps.find((d,i)=>parents[i].issue);
    const changed=deps.find((d,i)=>!contextMatches(d,actual[i].source)||parents[i].modified);
    const reviewed=p.takeRevalidations?.[s.job.id+':'+id+':'+s.sourceWindowId]?.stamp===stamp;
    const title=d=>p.windows.find(w=>w.id===d.windowId)?.title||'preceding context';
    const issue=ancestor?'Stale linked take: '+title(ancestor)+' needs continuity review first.':changed&&!reviewed?'Stale linked take: conditioning from '+title(changed)+' changed or cannot be verified. Inspect this take in Takes, then explicitly revalidate it or regenerate it. Originals are kept; no generation starts automatically.':null;
    const result={issue,stamp,dependencies:deps,modified:!!changed};memo.set(key,result);return result;
  }
  function segment(p,id,memo=new Map()){const s=rawSegment(p,id);if(!s)return null;const c=continuity(p,id,new Set(),memo);return {...s,editIssue:s.issue,issue:s.issue||c.issue,continuity:c};}
  function revalidate(p,id){const s=rawSegment(p,id);if(!s||s.issue)throw Error(s?.issue||'Select a completed take first.');const c=continuity(p,id);for(const d of c.dependencies)if(continuity(p,d.windowId).issue)throw Error('Review the preceding linked take first.');p.takeRevalidations||={};p.takeRevalidations[s.job.id+':'+id+':'+s.sourceWindowId]={stamp:c.stamp,reviewedAt:new Date().toISOString()};}
  function layout(p){let at=0;const memo=new Map();return H3.schedule(p).map((r,i)=>{const s=segment(p,r.id,memo),kept=s&&!s.editIssue?s.frames:r.kept;const row={...r,index:i,plannedStart:r.start,plannedEnd:r.end,plannedKept:r.kept,start:at,end:at+kept,kept,segment:s,ready:!!s&&!s.issue};at=row.end;return row;});}
  function locate(p,frame){const rows=layout(p),total=rows.at(-1)?.end||0;frame=Math.min(Math.max(0,Math.round(Number(frame)||0)),Math.max(0,total-1));const row=rows.find(r=>frame>=r.start&&frame<r.end)||rows.at(-1);return row?{row,frame,localFrame:frame-row.start,sourceFrame:row.segment?row.segment.inFrame+frame-row.start:null}:null;}
  function selection(p,ids=null){
    const rows=layout(p).filter(r=>!ids||ids.includes(r.id));if(!rows.length)throw Error('Select at least one window.');
    let at=0;const cuts=rows.map(r=>{if(!r.ready)throw Error((p.windows[r.index]?.title||'Window')+': '+(r.segment?.issue||'no finished take. Generate it or remove it before exporting.'));
      const s=r.segment,source={kind:s.job.id.startsWith('seq_')?'managed':s.job.id.startsWith('finish_')?'finish':'native',jobId:s.job.id,outputId:s.output.id};
      const review=p.takeRevalidations?.[s.job.id+':'+r.id+':'+s.sourceWindowId];
      const cut={windowId:r.id,title:p.windows[r.index].title,source,...(review?{continuityReview:review.stamp}:{}),inFrame:s.inFrame,outFrame:s.outFrame,frames:s.frames,startFrame:at,endFrame:at+s.frames};at=cut.endFrame;return cut;});
    return {format:'h3-edit',version:1,fps:FPS,projectId:p.id,name:p.name,cuts,totalFrames:at};
  }
  function continuationTail(p,startIndex){
    if(!integer(startIndex,1)||startIndex>=p.windows.length)throw Error('Invalid continuation boundary.');
    const edit=selection(p,p.windows.slice(0,startIndex).map(w=>w.id)),timelineFrames=edit.totalFrames;
    const count=H3.schedule(p)[startIndex].overlap;
    if(!count)return {edit:null,timelineFrames,contextFrames:0};
    let remain=count;const cuts=[];
    for(let i=edit.cuts.length-1;i>=0&&remain;i--){const c=edit.cuts[i],n=Math.min(remain,c.frames);cuts.unshift({...c,inFrame:c.outFrame-n,frames:n});remain-=n;}
    if(remain)throw Error('Not enough preceding footage for this overlap.');
    let at=0;for(const c of cuts){c.startFrame=at;at+=c.frames;c.endFrame=at;}
    return {edit:{...edit,cuts,totalFrames:count},timelineFrames,contextFrames:count};
  }
  function trim(p,id,inFrame,outFrame){const s=segment(p,id);if(!s)throw Error('Generate/select a take before trimming.');if(!integer(inFrame)||!integer(outFrame,1)||inFrame<s.rawInFrame||outFrame>s.rawOutFrame||outFrame<=inFrame)throw Error('In/Out must leave at least one frame inside this take.');p.editCuts||={};p.editCuts[id]={jobId:s.job.id,outputId:s.output.id,sourceWindowId:s.sourceWindowId,inFrame,outFrame};}
  function resetTrim(p,id){const saved=p.editCuts?.[id];if(!saved)return;if(saved.sourceWindowId&&saved.sourceWindowId!==id){const j=p.jobs.find(j=>j.id===saved.jobId),raw=j&&H3.renderSegment(j,saved.sourceWindowId);if(!raw)throw Error('Original split source is no longer available.');saved.inFrame=Math.round(raw.start*FPS);saved.outFrame=Math.round(raw.end*FPS);saved.outputId=raw.output.id;}else delete p.editCuts[id];}
  function automaticTake(p,id){if(p.selectedTakes)delete p.selectedTakes[id];if(p.editCuts)delete p.editCuts[id];}
  function chooseTake(p,id,jobId){if(!p.jobs.some(j=>j.id===jobId&&H3.renderSegment(j,id)))throw Error('This take has no saved range for the selected window.');p.selectedTakes||={};p.selectedTakes[id]=jobId;if(p.editCuts)delete p.editCuts[id];}
  function split(p,id,localFrame){const s=segment(p,id),i=p.windows.findIndex(w=>w.id===id);if(!s||s.issue)throw Error('Split footage needs a ready take. For an unrendered window use the planning Split control.');if(!integer(localFrame,1)||localFrame>=s.frames)throw Error('Move the playhead inside this clip, away from its ends.');const a=p.windows[i],b=H3.clone(a);b.id=H3.uid();b.sceneSourceWindowId=a.id;b.title=a.title+' · cut 2';b.overlap=0;b.notes=(b.notes||'')+'\nEditor cut: source footage reused; prompt not regenerated.';p.windows.splice(i+1,0,b);p.selectedTakes||={};p.selectedTakes[id]=s.job.id;p.selectedTakes[b.id]=s.job.id;p.editCuts||={};p.editCuts[id]={jobId:s.job.id,outputId:s.output.id,sourceWindowId:s.sourceWindowId,inFrame:s.inFrame,outFrame:s.inFrame+localFrame};p.editCuts[b.id]={...p.editCuts[id],inFrame:s.inFrame+localFrame,outFrame:s.outFrame};return b.id;}
  function insertion(p,anchorId,side,count=1,seconds=6){const at=anchorId==null?p.windows.length:p.windows.findIndex(w=>w.id===anchorId)+(side==='before'?0:1);if(at<0||anchorId!=null&&!p.windows.some(w=>w.id===anchorId))throw Error('Insertion boundary is no longer available.');if(!integer(count,1)||count>6||!Number.isFinite(seconds)||seconds<=0)throw Error('Choose 1–6 windows and a positive duration.');const frames=H3.nearestGrid(seconds*FPS);if(frames>p.maxSpan)throw Error('Each new window exceeds this model’s window ceiling. Choose a shorter duration.');const windows=Array.from({length:count},(_,i)=>({...H3.newWindow('New insert '+(i+1),frames,0),soundscape:'',music:'N/A',summary:'',detail:'',subjectIds:[],assetIds:[],casting:{},entry:'',exit:''}));return{at,windows,anchorId,side};}
  function insert(p,proposal){if(!proposal.windows?.length)throw Error('No windows to insert.');const at=proposal.anchorId==null?p.windows.length:p.windows.findIndex(w=>w.id===proposal.anchorId)+(proposal.side==='before'?0:1);if(at<0||proposal.anchorId&&!p.windows.some(w=>w.id===proposal.anchorId))throw Error('Insertion boundary changed. Review again.');const existing=new Set(p.windows.map(w=>w.id));for(const w of proposal.windows)if(existing.has(w.id))throw Error('This insert was already applied.');if(proposal.sceneId&&!p.referenceBoard?.scenes?.some(s=>s.id===proposal.sceneId))throw Error('The target scene changed; review the insert again.');p.windows.splice(at,0,...H3.clone(proposal.windows));if(proposal.sceneId){const s=p.referenceBoard.scenes.find(s=>s.id===proposal.sceneId);const members=new Set([...s.windowIds,...proposal.windows.map(w=>w.id)]);s.windowIds=p.windows.filter(w=>members.has(w.id)).map(w=>w.id);}return proposal.windows[0].id;}
  function insertionPacket(p,proposal,request){const q=H3.clone(p);q.windows=proposal.windows;return{...H3.plannerPacket(q,q.windows),responseShape:{...H3.plannerPacket(q,q.windows).responseShape,windows:H3.plannerPacket(q,q.windows).responseShape.windows.map(w=>({...w,subjectIds:[],assetIds:[],casting:{}}))},task:request,editOperation:'insert-only',instructions:'Fill ONLY the supplied new window IDs. No edits or replacement dialogue for existing windows. No dialogue unless explicitly requested. Do not invent references or visible characters. Use [Shot 1], concrete soundscape (or intentional N/A), and N/A music unless score is requested. Hard cuts for B-roll. Return assets via the existing assetIds field only. Keep geometry unchanged.',before:proposal.at?p.windows[proposal.at-1]:null,after:p.windows[proposal.at]||null,storyOutline:p.windows.map(w=>({id:w.id,title:w.title,summary:w.summary,entry:w.entry,exit:w.exit})),references:H3.plannerPacket(p,[]).references};}
  function parseInsert(p,proposal,raw){const q=H3.clone(p);q.windows=H3.clone(proposal.windows);const value=H3.parseProposal(raw,q.windows.map(w=>w.id),q,{allowReview:true});const assets=new Set(p.assets.map(a=>a.id));const windows=q.windows.map(w=>{const d=value.windows.find(x=>x.id===w.id);if(d.assetIds&&(!Array.isArray(d.assetIds)||d.assetIds.some(id=>!assets.has(id))))throw Error('Insert references an unknown media file.');const next={...w,...d,frames:w.frames,overlap:w.overlap,assetIds:d.assetIds||[]};return next;});return{...proposal,windows,notes:value.notes||[]};}
  function branch(p,id,scope,source=null,seed=-1,count=1){
    const i=p.windows.findIndex(w=>w.id===id);
    if(scope==='count'&&(i<0||!integer(count,1)||count>p.windows.length-i))throw Error('Choose a positive window count inside the remaining timeline.');
    const q=H3.branch(p,id,scope==='count'?'end':scope,source,seed);
    if(p.mode==='managed')q.timelineOffsetFrames=layout(p)[i].start;
    if(source&&i>0){const tail=p.mode==='managed'?continuationTail(p,i):{edit:selection(p,p.windows.slice(0,i).map(w=>w.id))};q.conditioningCuts=(tail.edit?.cuts||[]).map(c=>({windowId:c.windowId,contextFrames:c.frames,source:identity(rawSegment(p,c.windowId))}));}
    if(scope==='count'){q.windows=q.windows.slice(0,count);q.branch.scope='count';q.branch.windowIds=q.windows.map(w=>w.id);q.name=p.name+' · '+count+'-window alternate';}
    return q;
  }
  return {FPS,finishId,segment,continuity,revalidate,layout,locate,selection,continuationTail,trim,resetTrim,automaticTake,chooseTake,split,insertion,insert,insertionPacket,parseInsert,branch};
});
