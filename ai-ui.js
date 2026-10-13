/* AI transport activity is observable and recoverable without another model call. */
window.H3AIUI={create(ctx){
  'use strict';
  const {$,esc,P,toast,openDialog,download}=ctx;
  let selected=null,timer=null,generation=0,inflight=false,record=null;
  const active=j=>['accepted','running'].includes(j.status);
  function shell(){openDialog('AI requests · live log & recovery',`
    <p class="info-note">These requests belong to the Director server, not an open browser tab. Closing this dialog or losing a browser connection does not cancel them. Restarting Node interrupts unfinished AI requests. No automatic paid retries.</p>
    <div class="row wrap"><button data-ai-action="refresh">Refresh</button><label class="checkrow"><input type="checkbox" id="ai-all-projects">All projects</label><span id="ai-log-path" class="field-note"></span></div>
    <div class="ai-request-layout"><section id="ai-request-list" aria-label="Recent AI requests">Loading…</section><section id="ai-request-detail"><p>Select a request. New pacing requests show connection phase, elapsed time and received characters here.</p></section></div>
    <p class="field-note">Saved records contain private prompts and model text. Credentials and embedded media are excluded. Review downloads before sharing. The latest 100 finished server requests are retained.</p>`,'ai-requests');}
  async function open(id){selected=id||null;record=null;generation++;shell();clearTimeout(timer);await refresh();}
  function row(j){return `<div class="ai-request-row ${selected===j.id?'selected':''}"><button data-ai-select="${esc(j.id)}"><b>${esc(j.kind)} · ${esc(j.provider)} / ${esc(j.model)}</b><small>${esc(j.status)}${j.validation?.status==='invalid'?' · needs prompt review':''} · ${Math.floor(j.elapsedSeconds||0)}s · ${(j.outputCharacters||0).toLocaleString()} chars</small><small>${esc(j.createdAt)} · ${esc(j.id.slice(0,8))}</small></button></div>`;}
  async function refresh(){
    if(ctx.dialogName()!=='ai-requests'||inflight)return;
    const token=generation;inflight=true;
    try{
      if(!P.aiAvailable)throw Error('The live AI log needs the 1.2.1 Node server. Restart Node from the new folder, then reload the editor. Earlier requests cannot be reconstructed.');
      const data=await P.ai({action:'list',projectId:$('#ai-all-projects')?.checked?undefined:ctx.project().id});
      if(token!==generation||ctx.dialogName()!=='ai-requests')return;
      $('#ai-log-path').textContent='Server log: '+data.logPath;
      $('#ai-request-list').innerHTML=data.jobs.map(row).join('')||'<p>No captured requests for this project yet.</p>';
      if(!selected&&data.jobs.length)selected=data.jobs[0].id;
      if(selected){record=(await P.ai({action:'get',id:selected,detail:true})).job;if(token!==generation||ctx.dialogName()!=='ai-requests')return;show(record);}
    }catch(e){if(ctx.dialogName()==='ai-requests'&&token===generation){const target=$('#ai-monitor-error')||$('#ai-log-path');target.textContent=e.message+' Refresh reconnects without resubmitting.';}}
    finally{inflight=false;if(ctx.dialogName()==='ai-requests'){clearTimeout(timer);timer=setTimeout(refresh,2000);}}
  }
  function show(j){
    const panel=$('#ai-request-detail');
    if(panel.dataset.requestId!==j.id){panel.dataset.requestId=j.id;panel.innerHTML=`
      <h3 id="ai-request-title"></h3><pre id="ai-current-status" class="status-log" aria-live="polite"></pre>
      <p id="ai-monitor-error" class="warning-banner" hidden></p>
      <div class="row wrap"><button data-ai-action="cancel">Cancel request</button><button data-ai-action="recover" class="primary">Review pacing response</button><button data-ai-action="download">Download request + log</button></div>
      <p id="ai-result-note" class="field-note"></p>
      <details open><summary>Event log</summary><pre id="ai-events" class="ai-output"></pre></details>
      <details open><summary>Received output / partial response</summary><pre id="ai-output" class="ai-output"></pre></details>
      <details><summary>Exact captured request (private)</summary><pre id="ai-input" class="ai-output"></pre></details>`;}
    $('#ai-request-title').textContent=j.kind+' · '+j.provider+' / '+j.model;
    $('#ai-current-status').textContent=P.describeAI(j)+'\nRequest: '+j.id+'\nHTTP: '+(j.httpStatus??'not received')+' · finish: '+(j.finishReason||'not yet')+' · total deadline: '+(j.timeoutSeconds/60)+' min'+(j.usage?'\nUsage: '+JSON.stringify(j.usage):'');
    const error=j.error||j.validation?.status==='invalid'&&j.validation.message||j.logWarning||'';
    $('#ai-monitor-error').hidden=!error;$('#ai-monitor-error').textContent=error;
    panel.querySelector('[data-ai-action="cancel"]').hidden=!active(j);
    panel.querySelector('[data-ai-action="recover"]').hidden=j.kind!=='pacing'||j.status!=='completed';
    $('#ai-result-note').textContent=j.status==='completed'?'Response received; this does not mean it passed story validation. Review before creating a timeline copy.':active(j)?'Character counts reflect received text, not tokens or a completion percentage. A provider keep-alive proves a connection, not model progress.':'Partial responses are saved for diagnosis only. No timeline was created from incomplete JSON.';
    const fill=(id,text)=>{const el=$(id),bottom=el.scrollHeight-el.scrollTop-el.clientHeight<30;el.textContent=text;if(bottom)el.scrollTop=el.scrollHeight;};
    fill('#ai-events',(j.events||[]).map(e=>`${e.at} · ${e.phase} · ${e.message}`).join('\n'));
    fill('#ai-output',j.text||j.partialPreview||'(No text received yet.)');
    $('#ai-input').textContent=JSON.stringify(j.request,null,2);
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-ai-action],[data-ai-select]');if(!b)return;
    try{
      if(b.dataset.aiSelect){selected=b.dataset.aiSelect;record=null;generation++;$('#ai-request-detail').dataset.requestId='';await refresh();return;}
      switch(b.dataset.aiAction){
        case'open':await open();break;
        case'refresh':await refresh();break;
        case'cancel':if(record&&await askConfirm('Cancel this AI request? The provider may charge for work already performed.')){await P.ai({action:'cancel',id:record.id});await refresh();}break;
        case'download':if(record){const result=await P.ai({action:'get',id:record.id,detail:true});download('h3-ai-request-'+record.id+'.json',H3Studio.redact(result.job));toast('AI request log downloaded. Review private prompts before sharing.');}break;
        case'recover':if(record){try{ctx.recoverPacing(record);await P.ai({action:'validation',id:record.id,status:'valid',message:'Recovered pacing validated.'});}catch(err){await P.ai({action:'validation',id:record.id,status:'invalid',message:err.message});throw err;}}break;
      }
    }catch(err){toast(err.message,true);if($('#ai-monitor-error')){$('#ai-monitor-error').hidden=false;$('#ai-monitor-error').textContent=err.message;}}
  });
  document.addEventListener('change',e=>{if(e.target.id==='ai-all-projects'){selected=null;refresh();}});
  window.addEventListener('h3-open-ai',e=>open(e.detail?.id).catch(err=>toast(err.message,true)));
  return{open,refresh};
}};
