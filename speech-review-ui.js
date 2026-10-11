/* Listen -> script -> optional existing ASR workshop -> flags -> take selection. */
window.H3SpeechReviewUI={create(ctx){
'use strict';
const {$,esc,P,Store,toast}=ctx,R=H3SpeechReview,E=H3Edit;
let selected=null,projectId=null,epoch=0,busy=false;
const opened=()=>ctx.dialogName()==='speech-review';
const button=document.createElement('button');button.textContent='Speech review…';button.dataset.speechReview='open';
document.querySelector('[data-action="send"]')?.before(button);
document.querySelector('.render-selection-toolbar')?.append(button.cloneNode(true));
function current(){const p=ctx.project();if(p.id!==projectId||!selected||R.target(p,selected.windowId).key!==selected.key)throw Error('The project, selected take or trim changed. Reopen speech review.');return p;}
function saveText(status){const p=current(),old=p.speechReviews?.[selected.key]||{};ctx.mutate(()=>R.save(p,selected,{status:status||old.status||'unreviewed',note:$('#speech-review-note').value,transcript:$('#speech-review-transcript').value}));}
async function open(windowId=ctx.selected()){
 const ticket=++epoch,p=ctx.project();selected=R.target(p,windowId);projectId=p.id;
 const s=E.segment(p,windowId),w=p.windows.find(w=>w.id===windowId),review=p.speechReviews?.[selected.key]||{};
 const rows=R.script(p,windowId),prepared=p.voiceWorkshops?.find(x=>x.reviewTarget?.key===selected.key&&x.transcribed);
 const transcript=review.transcript??prepared?.segments.map(s=>s.text).join(' ')??'';
 ctx.openDialog('Speech review · '+w.title,`<p>Listen to this exact selected take and trim. ASR differences are suggestions, not proof of gibberish or speaker identity.</p>
 <video id="speech-review-video" controls preload="metadata" class="full" aria-label="Audition rendered window"></video>
 <p class="field-note">Source frames ${s.inFrame}–${s.outFrame} (end exclusive). Original dialogue and footage stay unchanged.</p>
 <h3>Scripted dialogue</h3><p class="field-note">${esc(R.scriptSource(p,windowId).kind)}</p><div>${rows.map(r=>`<p><b>${esc(r.speakerId||'Unassigned speaker')}</b> ${esc(r.text)}</p>`).join('')||'<p>No scripted dialogue. Listen for unintended speech or sounds.</p>'}</div>
 <label>Optional transcript<textarea id="speech-review-transcript" rows="5" placeholder="Paste a transcript, or use the local speech workshop">${esc(transcript)}</textarea></label>
 <div class="row wrap"><button data-speech-review="transcribe">Prepare this clip for local transcription…</button><button data-speech-review="compare">Compare words</button></div>
 <p id="speech-review-comparison" role="status"></p><label>Listening notes<textarea id="speech-review-note" rows="3">${esc(review.note||'')}</textarea></label>
 <div class="row wrap"><button data-speech-review="reviewed">Mark reviewed</button><button data-speech-review="suspect">Mark suspect</button><button data-speech-review="unreviewed">Clear flag</button><button data-speech-review="select">Select suspect windows for alternate takes…</button></div>
 <p id="speech-review-status" role="status">${esc(review.status||'unreviewed')} · selecting windows does not start generation.</p>`,'speech-review');
 const url=await P.mediaURL(s.job.id,s.output.id);
 if(ticket!==epoch||!opened()||ctx.project().id!==projectId)return;
 const video=$('#speech-review-video');video.src=url;
 video.addEventListener('loadedmetadata',()=>{video.currentTime=s.start;});
 video.addEventListener('timeupdate',()=>{if(video.currentTime>=s.end){video.pause();video.currentTime=s.start;}});
 video.addEventListener('play',()=>{if(video.currentTime<s.start||video.currentTime>=s.end)video.currentTime=s.start;});
}
async function prepareTranscript(){
 const p=current(),target=H3.clone(selected),pid=p.id,requestEpoch=epoch;
 const existing=p.voiceWorkshops?.find(w=>w.reviewTarget?.key===target.key);if(existing){await ctx.voice().open(existing.id);return;}
 if(!await H3Confirm.ask({title:'Prepare selected speech excerpt',summary:'Project: '+p.name+'\nWindow: '+(p.windows.find(w=>w.id===target.windowId)?.title||target.windowId)+'\nSelected output: '+target.outputId+'\nSource frames: '+target.inFrame+'–'+target.outFrame+' (end exclusive)\n\nCPU finishing prepares this exact clip and opens the speech workshop. No GPU generation, transcription or model download starts automatically.',accept:'Prepare excerpt',valid:()=>ctx.project()===p&&epoch===requestEpoch&&R.target(p,target.windowId).key===target.key}))return;
 const edit=E.selection(p,[target.windowId]);if(edit.totalFrames>600*H3.FPS)throw Error('Review a clip of at most ten minutes.');
 let record=p.speechReviewPreparations?.[target.key];
 if(!record){record={finishId:E.finishId(),target,edit:H3.clone(edit),phase:'prepared',createdAt:new Date().toISOString()};ctx.mutate(()=>{p.speechReviewPreparations||={};p.speechReviewPreparations[target.key]=record;});}
 // Commit a durable request ID before admission, exactly as the finishing UI does.
 await Store.save(p);
 let job;
 if(record.phase==='prepared'||record.phase==='submitting'){
  record.phase='submitting';await Store.save(p);
  job=await P.call('finish',{action:'start',id:record.finishId,edit:record.edit||edit,upscale:''});
  record.phase='finishing';await Store.save(p);
 }else job=await P.call('finish',{action:'get',id:record.finishId});
 while(['running','queued'].includes(job.status)){
  if(opened())$('#speech-review-status').textContent='Preparing bounded review clip: '+(job.message||job.status);
  await new Promise(r=>setTimeout(r,1000));job=await P.call('finish',{action:'get',id:record.finishId});
 }
 if(job.status!=='completed')throw Error('Clip preparation is '+job.status+'. Inspect Finishing; no automatic resume or retry was made.');
 if(ctx.project().id!==pid||R.target(ctx.project(),target.windowId).key!==target.key)throw Error('Take changed; prepared clip remains in Finishing but was not attached to the new take.');
 if(!opened()||epoch!==requestEpoch){record.phase='clip-ready';await Store.save(p);return;}
 if(record.phase==='importing')throw Error('A previous voice import has an uncertain result. Check Voice workshop before deliberately importing again; it was not resubmitted.');
 if(job.downloadURL!=='/api/finish-media/'+record.finishId)throw Error('Unexpected review clip URL.');
 const response=await fetch(job.downloadURL,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw Error('Prepared review clip is unavailable.');
 const length=Number(response.headers.get('content-length'));if(!Number.isFinite(length)||length<=0||length>256*1024**2){await response.body?.cancel();throw Error('Prepared clip exceeds the bounded speech upload limit.');}
 const blob=await response.blob();record.phase='importing';await Store.save(p);
 await ctx.voice().importReviewClip(blob,'Speech review · '+p.windows.find(w=>w.id===target.windowId).title+'.mp4',target,()=>opened()&&epoch===requestEpoch);
 record.phase='imported';await Store.save(p);
}
document.addEventListener('click',async event=>{
 const action=event.target.closest('[data-speech-review]')?.dataset.speechReview;if(!action)return;
 try{
  if(busy)throw Error('Wait for the current review operation; it will not be submitted twice.');
  if(action==='open'){await open();return;}if(!opened())return;
  if(['reviewed','suspect','unreviewed'].includes(action)){saveText(action);$('#speech-review-status').textContent='Saved: '+action+'. No render was started.';return;}
  if(action==='compare'){saveText();const p=current(),c=R.compare(R.script(p,selected.windowId).map(x=>x.text).join(' '),$('#speech-review-transcript').value);$('#speech-review-comparison').textContent=c.suggestion+' Word edits: '+c.editDistance+'.';return;}
  if(action==='select'){saveText();const ids=R.suspectWindows(current());if(!ids.length)throw Error('No currently selected takes are marked suspect.');ctx.renderSelection().openIds(ids);return;}
  if(action==='transcribe'){saveText();busy=true;try{await prepareTranscript();}finally{busy=false;}return;}
 }catch(error){toast(error.message,true);if(opened())$('#speech-review-status').textContent=error.message;}
});
return {open,get busy(){return busy;}};
}};
