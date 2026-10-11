/* Pure sound-library decisions; not an H3 conditioning input. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.H3Sound=api;})(globalThis,function(){
 'use strict';
 const categories=['unclassified','theme','music','transition','sting','ambience','effect'];
 function youtube(raw){let u;try{u=new URL(String(raw).trim());}catch{throw Error('Use a single YouTube video link.');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('Use a public YouTube URL without credentials or a custom port.');
  let id=u.hostname==='youtu.be'?u.pathname.slice(1):['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(u.hostname)?u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1]:null;
  if(!/^[\w-]{11}$/.test(id||''))throw Error('Only single YouTube video links are supported, not playlists or arbitrary websites.');return 'https://www.youtube.com/watch?v='+id;}
 function samples(raw,duration){if(!Array.isArray(raw)||raw.length>500)throw Error('Use up to 500 sample ranges.');const seen=new Set();return raw.map(r=>{
  if(typeof r.id!=='string'||! /^[\w-]{1,128}$/.test(r.id)||seen.has(r.id))throw Error('Invalid or duplicate sample ID.');seen.add(r.id);
  if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end-r.start<.08||r.end>duration+1/48000)throw Error('Sample In/Out must fit inside the recording (minimum 0.08 seconds).');
  const name=String(r.name||'Sample').trim().slice(0,180);return{id:r.id,name:name||'Sample',start:r.start,end:Math.min(duration,r.end),keep:r.keep!==false,category:categories.includes(r.category)?r.category:'unclassified',basis:String(r.basis||'manual').slice(0,80)};});}
 function split(rows,id,time,newId){const out=structuredClone(rows),i=out.findIndex(r=>r.id===id),r=out[i];if(!r||time-r.start<.08||r.end-time<.08)throw Error('Put the source playhead inside this sample, away from its edges.');out.splice(i,1,{...r,end:time,basis:'manual'},{...r,id:newId,start:time,name:r.name+' · part 2',basis:'manual'});return out;}
 function merge(rows,id){const out=structuredClone(rows),i=out.findIndex(r=>r.id===id);if(i<0||i===out.length-1)throw Error('No following sample to merge.');const a=out[i],b=out[i+1];out.splice(i,2,{...a,start:Math.min(a.start,b.start),end:Math.max(a.end,b.end),basis:'manual'});return out;}
 function attach(project,result){if(project.id!==result.projectId)throw Error('Open the project that owns this sound import.');project.postMedia||=[];
  const added=[];for(const a of result.media||[]){if(!project.postMedia.some(x=>x.id===a.id)){project.postMedia.push(structuredClone(a));added.push(a.id);}}
  project.soundLibraries||=[];const item={id:result.id,name:result.name,source:result.source,duration:result.duration,options:result.options,provenance:result.provenance,samples:structuredClone(result.samples||[]),savedIds:(result.media||[]).map(a=>a.id)};
  const i=project.soundLibraries.findIndex(x=>x.id===result.id);if(i<0)project.soundLibraries.push(item);else project.soundLibraries[i]=item;return added;}
 return{youtube,samples,split,merge,attach,categories};
});
