/* Pure render selection. A click never changes the generation edit or existing takes. */
(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./core.js'):root.H3,node?require('./edit-core.js'):root.H3Edit);if(node)module.exports=api;else root.H3RenderSelection=api;})(globalThis,function(H,E){
'use strict';
function ordered(p,ids){if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)throw Error('Choose one or more unique windows.');const known=new Set(p.windows.map(w=>w.id));if(ids.some(id=>!known.has(id)))throw Error('A selected window was removed. Refresh the selection.');return p.windows.filter(w=>ids.includes(w.id)).map(w=>w.id);}
function analyze(p,ids){const selected=ordered(p,ids),indices=selected.map(id=>p.windows.findIndex(w=>w.id===id));const groups=[];for(const i of indices){const last=groups.at(-1);if(last&&i===last.end+1){last.end=i;last.ids.push(p.windows[i].id);}else groups.push({start:i,end:i,ids:[p.windows[i].id]});}
 let prefix=null,prefixError='The selection starts at the beginning of the film.';if(indices[0]>0)try{prefix=E.selection(p,p.windows.slice(0,indices[0]).map(w=>w.id));prefixError='';}catch(e){prefixError=e.message;}
 return{ids:selected,indices,groups,contiguous:groups.length===1,start:indices[0],end:indices.at(-1),prefix,prefixError,ready:selected.filter(id=>{const s=E.segment(p,id);return !!s&&!s.issue;}),firstMissing:p.windows.find(w=>{const s=E.segment(p,w.id);return !s||s.issue;})?.id||null};}
function choose(p,mode,startId,endId=null){if(!['all','current','from','range','missing','unfinished'].includes(mode))throw Error('Unknown render selection mode.');const i=p.windows.findIndex(w=>w.id===startId);if(i<0&&mode!=='all'&&mode!=='missing'&&mode!=='unfinished')throw Error('Select a current window.');if(mode==='all')return p.windows.map(w=>w.id);if(mode==='current')return[startId];if(mode==='from')return p.windows.slice(i).map(w=>w.id);if(mode==='range'){const j=p.windows.findIndex(w=>w.id===endId);if(j<i)throw Error('End must be at or after the start window.');return p.windows.slice(i,j+1).map(w=>w.id);}const missing=p.windows.filter(w=>{const s=E.segment(p,w.id);return !s||s.issue;});if(!missing.length)throw Error('All windows have selected footage. Choose a range to rerender deliberately.');return mode==='missing'?missing.map(w=>w.id):p.windows.slice(p.windows.indexOf(missing[0])).map(w=>w.id);}
function snapshot(p,ids,{source=null,seed=-1,strategy='linked'}={}){
 if(!Number.isSafeInteger(seed)||seed< -1)throw Error('Seed must be −1 or a nonnegative integer.');
 const a=analyze(p,ids);if(!['linked','independent'].includes(strategy))throw Error('Choose linked continuation or separate independent shots.');
 if(strategy==='linked'&&!a.contiguous)throw Error('Linked continuation requires a continuous selection. Include the gaps or choose independent shots; gaps will never be silently rendered.');
 if(source&&(strategy==='independent'||a.start===0))throw Error('This selection does not accept a preceding prefix.');
 let q;
 if(strategy==='linked'){q=E.branch(p,a.ids[0],'count',source,seed,a.ids.length);q.mode=p.mode==='managed'?'managed':'sliding';}
 else{q=H.clone(p);const rows=H.schedule(p);q.windows=a.indices.map(i=>({...H.clone(p.windows[i]),frames:rows[i].kept,overlap:0}));q.mode='independent';q.jobs=[];q.variants=[];q.seed=seed;delete q.continuation;q.branch={parentProjectId:p.id,fromWindowId:a.ids[0],scope:'selected-independent',source:null,windowIds:a.ids};q.name=p.name+' · '+a.ids.length+' selected shots';}
 q.settings={...q.settings,spatial_upsampling:''};q.branch.selection={indices:a.indices,ids:a.ids,strategy,sourceRevision:p.revision};
 return q;
}
function review(p,ids,{strategy='linked',context=''}={}){
 const a=analyze(p,ids);
 if(!['linked','independent'].includes(strategy))throw Error('Choose how to render these windows.');
 if(strategy==='linked'&&!a.contiguous)throw Error('Linked continuation requires consecutive windows. Include the gaps or explicitly choose Independent shots; gaps are never silently rendered.');
 if(strategy==='independent'||a.start===0)context='fresh';
 if(!['prefix','fresh'].includes(context))throw Error('Choose starting context. Reconnect the earlier footage to continue it, or explicitly choose Fresh start to make a cut.');
 if(context==='prefix'&&!a.prefix)throw Error('Earlier footage is unavailable: '+a.prefixError+'. Reconnect it or explicitly choose Fresh start.');
 return{...a,context,rerenderCount:a.ready.length,newCount:a.ids.length-a.ready.length,warning:context==='fresh'&&a.start>0?'This starts without preceding motion or audio. It makes a cut at the start of the selected range.':''};
}
return{ordered,analyze,choose,snapshot,review};
});
