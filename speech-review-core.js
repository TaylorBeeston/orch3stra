/* Review observations belong to an immutable take/range, not future dialogue. */
(function(root,factory){const node=typeof module==='object'&&module.exports;const api=factory(node?require('./core.js'):root.H3,node?require('./edit-core.js'):root.H3Edit);if(node)module.exports=api;else root.H3SpeechReview=api;})(globalThis,function(H,E){
'use strict';
function target(p,windowId){
 const s=E.segment(p,windowId);if(!s||s.issue)throw Error(s?.issue||'Select a rendered window with available footage.');
 return {windowId,jobId:s.job.id,outputId:s.output.id,inFrame:s.inFrame,outFrame:s.outFrame,
  key:JSON.stringify([windowId,s.job.id,s.output.id,s.inFrame,s.outFrame])};
}
function scriptSource(p,windowId){const s=E.segment(p,windowId),id=s?.sourceWindowId||windowId,snapshot=s?.job?.snapshot;return snapshot?.windows?.some(w=>w.id===id)?{project:snapshot,windowId:id,kind:'captured render script'}:{project:p,windowId,kind:'current script (captured render script unavailable)'};}
function script(p,windowId){const source=scriptSource(p,windowId);return H.dialogueEntries(source.project).filter(e=>e.windowId===source.windowId).map(e=>({speakerId:e.speakerId||'',subjectId:e.subjectId||'',text:String(e.block).replace(/^<d>\s*(?:\[[^\]]+\]\s*)?/,'').replace(/<\/d>$/,'')}));}
function tokens(text){return String(text).normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)||[];}
function compare(expected,observed){
 const a=tokens(expected),b=tokens(observed);if(a.length>2000||b.length>2000)throw Error('Compare one rendered window at a time (maximum 2,000 words per side).');
 let row=Array.from({length:b.length+1},(_,i)=>i);
 for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+Number(a[i-1]!==b[j-1]));row=next;}
 return {expectedWords:a.length,observedWords:b.length,editDistance:row[b.length],
  suggestion:!a.length&&!b.length?'No words to compare; listen for unintended speech.':row[b.length]===0?'Words match after normalization; listen to verify delivery and speaker.':'Transcript differs from the script; listen before marking a take suspect.',
  advisory:true,speakerIdentityVerified:false};
}
function save(p,selected,{status='unreviewed',note='',transcript}={}){
 if(!['unreviewed','reviewed','suspect'].includes(status))throw Error('Unknown speech review status.');
 if(target(p,selected.windowId).key!==selected.key)throw Error('The selected take or trim changed. Review the new range instead.');
 if(typeof note!=='string'||note.length>4000||transcript!==undefined&&(typeof transcript!=='string'||transcript.length>40000))throw Error('Review text is too long.');
 p.speechReviews||={};const old=p.speechReviews[selected.key]||{};
 p.speechReviews[selected.key]={...old,...selected,status,note,...(transcript!==undefined?{transcript}:{}),updatedAt:new Date().toISOString()};return p;
}
function suspectWindows(p){return p.windows.filter(w=>{try{return p.speechReviews?.[target(p,w.id).key]?.status==='suspect';}catch{return false;}}).map(w=>w.id);}
return {target,scriptSource,script,compare,save,suspectWindows};
});
