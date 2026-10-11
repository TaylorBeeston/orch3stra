/* Managed sequence manager. Server state is authoritative; refresh never resumes GPU work. */
window.H3SequenceUI={create(ctx){
  const {P,esc,openDialog,toast,$}=ctx;
  let epoch=0,timer=null,view='closed',data=null,filter='active',busy=false,detailId=null;
  try{filter=localStorage.getItem('h3-director:sequence-filter')||'active';}catch{}
  const finished=new Set(['completed','failed','cancelled','retired']);
  const button=document.createElement('button');button.id='managed-sequences';button.textContent='Sequences';
  button.title='Manage running, paused, cancelling and finished sequences across every project';
  const anchor=document.querySelector('#wangp-server')||document.querySelector('[data-action="connections"]');
  (anchor?.parentNode||document.querySelector('.header-actions')).insertBefore(button,anchor||null);
  button.onclick=()=>show();
  const call=body=>P.call('sequence',body);
  const pretty=v=>esc(String(v||'—'));
  const backendName=v=>v==='headless'?'Headless worker':v==='legacy'?'Legacy browser plugin':String(v||'Unknown');
  const stamp=v=>v?esc(new Date(v).toLocaleTimeString()):'Not yet checked';
  function close(){view='closed';epoch++;clearTimeout(timer);timer=null;}
  const present=()=>view==='manager'&&!!$('#sequence-manager');
  function controls(row){
    const a=row.actions;
    return `<div class="seq-actions">
      ${a.recoverOutput?`<button class="primary" data-seq-action="recover-preview" data-seq-id="${row.id}">Recover saved window…</button>`:''}
      ${a.retire?`<button data-seq-action="retire-preview" data-seq-id="${row.id}">Retire old-backend record…</button>`:''}
      ${a.pause?`<button data-seq-action="pause" data-seq-id="${row.id}">Pause after window</button>`:''}
      ${a.resume?`<button class="primary" data-seq-action="resume" data-seq-id="${row.id}">Resume sequence</button>`:''}
      ${a.reconcile?`<button data-seq-action="reconcile" data-seq-id="${row.id}">Reconcile state</button>`:''}
      ${a.cancel?`<button class="danger-text" data-seq-action="cancel" data-seq-id="${row.id}">Cancel sequence</button>`:''}
      ${a.endIdle?`<button data-seq-action="end-idle" data-seq-id="${row.id}">End idle sequence…</button>`:''}
      <button data-seq-action="inspect" data-seq-id="${row.id}">Details / log</button>
      ${row.projectId===ctx.project().id?`<button data-seq-action="attach" data-seq-id="${row.id}">Reconnect renders</button>`:''}
      ${a.archive?`<button data-seq-action="archive" data-seq-id="${row.id}">Move to history</button>`:''}
      ${a.restore?`<button data-seq-action="restore" data-seq-id="${row.id}">Restore to list</button>`:''}
    </div>`;
  }
  function card(r){
    const o=r.observed,j=o?.job,tone=finished.has(r.status)?'finished':r.backend?.mismatch||r.cancelRequested||r.status==='uncertain'?'attention':r.parked?'parked':finished.has(r.status)?'finished':'running';
    return `<article class="seq-card ${tone}" data-seq-card="${r.id}">
      <div class="seq-card-head"><div><h3>${pretty(r.name)}</h3><code>${esc(r.id)}</code></div><span class="seq-badge">${pretty(r.label)}</span></div>
      <div class="seq-progress"><progress max="${Math.max(1,r.total)}" value="${r.index}" aria-label="Saved windows"></progress><span>${r.index} / ${r.total} windows saved · ${r.outputs} outputs kept</span></div>
      ${r.backend?`<p class="seq-backends"><b>Record:</b> ${pretty(backendName(r.backend.recorded))}${r.backend.inferred?' (older record; no backend tag)':''} · <b>Director now:</b> ${pretty(backendName(r.backend.current))}</p>`:''}
      <div class="seq-facts"><div><small>DIRECTOR STATE</small><b>${pretty(r.status)}</b><span>Saved phase: ${pretty(String(r.phase||'unknown').replaceAll('_',' '))} — not a separate live status</span><span>${r.blocking?'Reserves / blocks managed dispatch':r.parked?'Parked · does not reserve renderer':'No dispatch reservation'}</span></div>
        <div><small>WANGP</small><b>${r.status==='retired'?'Not queried (retired)':r.backend?.mismatch?'Other backend — not queried':o?.reachable?(j?pretty(j.status):o.unknown?'Acceptance unknown':'No matching active job'):'Not verified'}</b><span>${r.backend?.mismatch?'Current queue cannot verify the old renderer.':j?pretty(j.job_id):pretty(o?.error||'Checked '+stamp(o?.checkedAt))}</span></div></div>
      <p class="seq-reason">${pretty(r.reason)}</p>
      ${r.appearance?`<p class="${r.appearance.action==='appearance-skipped'?'warning-banner':'field-note'}"><b>Appearance:</b> ${pretty(r.appearance.message)}</p>`:''}
      ${r.layout==='legacy-cumulative'&&!finished.has(r.status)?'<div class="warning-banner">This saved run uses episode-long cumulative context. Resume keeps that historical behavior and can increase memory/storage use. To use bounded continuation, keep it parked and start a new selected-window suffix from its saved footage.</div>':''}
      ${r.message&&!r.backend?.mismatch?`<p class="field-note">${pretty(r.message)}</p>`:''}
      ${r.error&&!r.backend?.mismatch?`<div class="warning-banner">${pretty(r.error)}</div>`:''}
      ${r.status==='cancelling'&&!r.backend?.mismatch?'<p class="field-note">Director keeps checking cancellation on the server. Closing this panel does not stop it. Resume cannot undo a cancellation.</p>':''}
      ${controls(r)}
    </article>`;
  }
  function render(){
    const root=$('#sequence-manager');if(!root||!data)return;
    const q=data.queue,active=data.runs.filter(r=>!finished.has(r.status)),parked=active.filter(r=>r.parked),blockers=active.filter(r=>r.blocking);
    const native=q.jobs?.filter(j=>!finished.has(j.status))||[];
    root.innerHTML=`${data.backend==='legacy'?'<div class="warning-banner">Director is using the <b>legacy browser plugin</b>. For the no-browser worker, stop only this Node server and restart with <code>node start-headless.mjs</code> using the same data directory. Do not retire a headless run merely to hide a wrong launch mode.</div>':''}<div class="seq-overview">
      <div class="seq-summary"><small>CURRENT BACKEND · ${pretty(backendName(data.backend||'headless'))}</small><strong>${q.reachable?(q.idle?'Idle':q.active_job_id?'Rendering / stopping':'Queued work'):'Unavailable'}</strong><span>${q.reachable?(q.paused?'WanGP queue is paused':'WanGP queue is unpaused'):pretty(q.error||'Headless backend needed')}</span></div>
      <div class="seq-summary"><small>MANAGED SEQUENCES</small><strong>${blockers.length} need attention / running</strong><span>${parked.length} safely parked · ${active.length} unfinished total</span></div>
      <div class="seq-summary ${data.canSubmitManaged?'ready':'needs-review'}"><small>NEW SUBMISSION</small><strong>${data.canSubmitManaged?'Ready':'Not ready'}</strong><span>${pretty(data.explanation)}</span></div>
    </div>
    <div class="seq-toolbar"><button data-seq-action="refresh">Refresh state</button>
      <button data-seq-action="clear-preview" ${!active.length?'disabled':''}>End all safely idle…</button>
      ${q.reachable?`<button data-seq-action="queue-${q.paused?'resume':'pause'}">${q.paused?'Unpause WanGP queue':'Pause WanGP after current job'}</button>`:''}
      <button data-seq-action="native">Open native queue</button>
      <label>Show <select id="sequence-filter" aria-label="Filter sequences">${[['active','Current list'],['attention','Needs attention / running'],['parked','Parked'],['history','History'],['all','Everything']].map(([v,n])=>`<option value="${v}" ${filter===v?'selected':''}>${n}</option>`).join('')}</select></label>
    </div>
    <p class="field-note">Sequence pause parks one film; WanGP queue pause stops dispatch for the whole renderer. These are separate controls. Reconcile never submits another window. Last check <span id="seq-last-check">${stamp(data.checkedAt)}</span>.</p>
    ${q.reachable&&q.paused?'<div class="warning-banner">The WanGP queue is paused. Ending stale sequences will not unpause it. Use <b>Unpause WanGP queue</b> when ready; parked sequences stay parked.</div>':''}
    ${native.length?`<details class="seq-native"><summary>${native.length} native job(s) still owned by WanGP</summary>${native.map(j=>`<p><code>${pretty(j.job_id)}</code> · ${pretty(j.status)} · ${pretty(j.project_name)}</p>`).join('')}</details>`:''}
    <div id="sequence-cards">${data.runs.filter(r=>filter==='all'||filter==='history'?(filter==='all'||finished.has(r.status)):filter==='parked'?r.parked:filter==='attention'?r.blocking:!r.archivedAt).map(card).join('')||'<div class="seq-empty">No sequences in this view. Change the filter to see finished history.</div>'}</div>
    <p class="field-note">No controls here delete source media or saved videos. Safe cleanup makes a private record backup before ending it. Unknown or unreachable renderer state is never assumed idle.</p>`;
    $('#sequence-filter').onchange=e=>{filter=e.target.value;try{localStorage.setItem('h3-director:sequence-filter',filter);}catch{}render();};
  }
  async function refresh(manual=false){
    if(!present()||busy)return;
    if(window.DirectorApp?.progress?.enabled){await window.DirectorApp.progress.refresh();return;}
    const ticket=epoch;clearTimeout(timer);
    const activity=manual?window.H3Activity?.start('Checking sequences and renderer'):null;
    try{
      const next=await call({action:'manager'});if(ticket!==epoch||!present()){activity?.remove();return;}
      data=next;ctx.syncStates?.(data.runs);render();activity?.done('Sequence states checked');
    }catch(e){if(ticket===epoch&&present())$('#sequence-manager').innerHTML=`<div class="warning-banner">${esc(e.message)}</div><p>Saved records have not been force-cleared. Check that Director and its renderer are reachable.</p><button data-seq-action="refresh">Try again</button>`;activity?.fail(e.message);}
    finally{if(ticket===epoch&&present())timer=setTimeout(()=>refresh(false),3000);}
  }
  function show(){
    close();if(!P.bridge){toast('Open Director through the Node server to manage its sequences.',true);return;}
    view='manager';openDialog('Managed sequence manager','<div id="sequence-manager" aria-live="polite"><p>Checking saved sequences and the renderer…</p></div>','sequence-manager');refresh();
  }
  async function preview(ids){
    close();view='confirm';const token=epoch;
    openDialog('End safely idle sequences','<div id="seq-cleanup"><p>Verifying each sequence against WanGP…</p></div>','sequence-cleanup');
    const result=await call({action:'clear-idle-preview',ids});if(epoch!==token||!$('#seq-cleanup'))return;
    const allowed=result.results.filter(r=>r.eligible),skipped=result.results.filter(r=>!r.eligible);
    $('#seq-cleanup').innerHTML=`<p>End only the following idle records? Their finished videos, source media, and project plans stay intact. A record backup is saved first. This is not a pause: an ended sequence cannot be resumed.</p>
      ${allowed.map(r=>`<div class="seq-card"><b>${pretty(r.name)}</b><p><code>${esc(r.id)}</code> · ${pretty(r.status)} · ${r.outputs} saved outputs</p></div>`).join('')||'<div class="warning-banner">No sequences are safe to end right now. A running request, unknown submission, or unreachable renderer is never force-cleared.</div>'}
      ${skipped.length?'<h3>Will not change</h3>'+skipped.map(r=>`<p><b>${pretty(r.name||r.id)}</b>: ${pretty(r.reason)}</p>`).join(''):''}
      <div class="seq-actions"><button data-seq-action="open">Back</button><button class="primary" id="seq-confirm-clear" ${allowed.length?'':'disabled'}>End ${allowed.length} idle sequence${allowed.length===1?'':'s'}</button></div>
      <p class="field-note">WanGP is rechecked when you confirm. This does not unpause the renderer, restart either server, or resubmit any task.</p>`;
    $('#seq-confirm-clear').onclick=()=>perform(async()=>{
      const r=await call({action:'clear-idle',ids:allowed.map(x=>x.id)});show();
      const n=r.results.filter(x=>x.cleared).length;
      toast(n+' idle record(s) ended. '+(r.queuePaused?'WanGP queue is still paused; unpause it separately.':'No new work was submitted.'));
      if(r.results.some(x=>!x.cleared))toast('Some records changed or were not idle. Review their current state.',true);
    },'Ending verified idle sequences');
  }
  async function previewRecovery(id){
    close();view='recovery';const ticket=epoch;
    openDialog('Recover a saved window','<div id="seq-recovery">Checking the completed native result…</div>','sequence-recovery');
    const d=await call({action:'recover-preview',id});if(ticket!==epoch||!$('#seq-recovery'))return;
    $('#seq-recovery').innerHTML=`<h3>${pretty(d.name)}</h3><p>The saved video is ${d.probe?pretty(d.probe.frames)+' frames at '+pretty(d.probe.fps)+' fps':'ready for decoded-frame verification'}. Planned boundary: ${d.expected} frames.</p>
      <p>This recovers the already rendered window into a <b>new parked sequence</b>, keeping the original attempt and its cancellation history unchanged. The saved video is not re-encoded. Small frame differences update this take’s playback/continuation boundaries, not your editable film.</p>
      <p><b>No GPU generation is submitted.</b> Review the recovered take, then explicitly Resume its remaining windows. The copy uses the original submitted prompts/references, not any later edits you made.</p>
      <div class="seq-actions"><button data-seq-action="open">Back — keep everything as is</button><button class="primary" id="seq-confirm-recovery">Recover into a parked sequence</button></div>`;
    $('#seq-confirm-recovery').onclick=()=>perform(async()=>{
      const r=await call({action:'recover-output',id,revision:d.revision,outputId:d.outputId,confirm:true});
      if(r.snapshot?.id===ctx.project().id)ctx.addJob(r);
      show();toast('Saved window recovered. New sequence is parked; no render was started.');
    },'Verifying and recovering saved output');
  }
  async function previewRetirement(id){
    close();view='retire';const ticket=epoch;
    openDialog('Retire old-backend tracking','<div id="seq-retirement">Reading saved checkpoint…</div>','sequence-retirement');
    const d=await call({action:'retire-preview',id});if(ticket!==epoch||!$('#seq-retirement'))return;
    $('#seq-retirement').innerHTML=`<h3>${pretty(d.name)}</h3><code>${pretty(d.id)}</code>
      <p><b>Record:</b> ${pretty(backendName(d.backend.recorded))}${d.backend.inferred?' (older record; no backend tag)':''}<br><b>Director now:</b> ${pretty(backendName(d.backend.current))}</p>
      ${d.backend.current==='legacy'?'<div class="warning-banner">Using the wrong launch command? Restart only Director with <code>node start-headless.mjs</code> to manage headless runs. Do not retire one you intend to resume.</div>':''}
      <p>This ends <b>Director tracking only</b> and moves this attempt to History. It does <b>not</b> cancel or contact the other renderer, prove its GPU is idle, resume a queue, or submit work. Do not run the old renderer and the headless worker against the same GPU concurrently.</p>
      <p><b>${d.outputs} saved output(s) are kept</b>, along with the project, input media, native job IDs and the original checkpoint. A private backup is saved first. This retired attempt cannot be resumed from the UI; restoring its history entry only shows it again.</p>
      <label class="seq-retire-consent"><input id="seq-retire-ack" type="checkbox"> I have stopped the other renderer, or confirmed that it has finished this job. I only want to retire this old tracking record.</label>
      <div class="seq-actions"><button data-seq-action="open">Back — keep record</button><button class="primary" id="seq-confirm-retire" disabled>Retire tracking and keep outputs</button></div>`;
    $('#seq-retire-ack').onchange=e=>{$('#seq-confirm-retire').disabled=!e.target.checked;};
    $('#seq-confirm-retire').onclick=()=>perform(async()=>{
      const r=await call({action:'retire',id,acknowledgeOtherRendererStopped:$('#seq-retire-ack').checked,
        expectedBackend:d.backend.recorded,expectedCurrentBackend:d.backend.current,revision:d.revision});
      if(r.snapshot?.id===ctx.project().id)ctx.addJob(r);
      show();toast('Old tracking moved to History. Outputs kept; no renderer was stopped or resumed.');
    },'Retiring old tracking locally');
  }
  async function inspect(id){
    close();view='detail';detailId=id;const token=epoch;
    openDialog('Sequence details / recovery log','<div id="sequence-detail">Loading…</div>','sequence-detail');
    const d=await call({action:'diagnostics',id});if(token!==epoch||!$('#sequence-detail'))return;
    const o=d.observation,j=o?.job;
    $('#sequence-detail').innerHTML=`<div class="seq-actions"><button data-seq-action="open">Back to manager</button><button data-seq-action="inspect" data-seq-id="${esc(id)}">Refresh details</button><button data-seq-action="download" data-seq-id="${esc(id)}">Download diagnostic</button></div>
      <h3>${pretty(d.name)}</h3>${d.backend?`<p>Recorded backend: <b>${pretty(backendName(d.backend.recorded))}</b>${d.backend.inferred?' (inferred from an untagged pre-headless checkpoint)':''}. Director backend: <b>${pretty(backendName(d.backend.current))}</b>.</p>`:''}${d.retirement?`<div class="info-note">Retired locally at ${pretty(d.retirement.at)}. Previous state: ${pretty(d.retirement.previousStatus)}; previous phase: ${pretty(d.retirement.previousPhase)}. No native cancellation was verified. Outputs retained.</div>`:''}<code>${pretty(id)}</code><p>${pretty(d.status)} · ${pretty(d.phase)} · ${d.index} / ${d.plan.length} windows saved</p><p>${pretty(d.message)}</p>
      ${d.error?'<div class="warning-banner">'+pretty(d.error)+'</div>':''}
      <p>Last native job: <code>${pretty(d.activeJobId||d.lastNativeJobId||d.unarchivedJobId)}</code>. Renderer observation: <b>${pretty(j?.status||o?.error||'No matching job')}</b>.</p>
      ${d.lastBackup?'<p>Recovery backup in <code>sequence-backups/'+pretty(d.lastBackup)+'</code>.</p>':''}
      ${d.unarchivedJobId?'<div class="warning-banner">An unmapped native result remains in WanGP. Open the native queue to inspect it; no original was deleted.</div>':''}
      <h3>Recovery / control events</h3><div class="seq-log">${(d.events||[]).slice().reverse().map(e=>`<p><time>${stamp(e.at)}</time> <b>${pretty(e.action)}</b> ${pretty(e.message)}</p>`).join('')||'This older record has no recorded control events.'}</div>
      <details><summary>Last observation / checkpoint metadata</summary><pre class="ai-output">${esc(JSON.stringify({status:d.status,phase:d.phase,index:d.index,activeJobId:d.activeJobId,cancelRequested:d.cancelRequested,pauseAfterWindow:d.pauseAfterWindow,observation:d.observation,backend:d.backend,retirement:d.retirement},null,2))}</pre></details>
      <p class="field-note">Diagnostics contain creative prompts and filenames but omit credentials. Review before sharing.</p>`;
  }
  async function perform(fn,label){
    if(busy)return;busy=true;epoch++;clearTimeout(timer);
    const a=window.H3Activity?.start(label||'Updating sequence');
    document.querySelectorAll('#sequence-manager button,#seq-cleanup button,#seq-retirement button,#seq-recovery button').forEach(b=>b.disabled=true);
    try{await fn();a?.done(label||'Sequence updated');}
    catch(e){a?.fail(e.message);toast(e.message,true);}
    finally{busy=false;window.dispatchEvent(new CustomEvent('h3-render-refresh'));if(view==='recovery')document.querySelectorAll('#seq-recovery button').forEach(b=>b.disabled=false);if(view==='retire'){const ok=$('#seq-confirm-retire');if(ok)ok.disabled=!$('#seq-retire-ack')?.checked;$('#seq-retirement [data-seq-action="open"]')?.removeAttribute('disabled');}if(present())refresh();else if(view==='confirm')document.querySelectorAll('#seq-cleanup [data-seq-action="open"]').forEach(b=>b.disabled=false);}
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-seq-action]');if(!b)return;
    const action=b.dataset.seqAction,id=b.dataset.seqId;
    if(action==='open')return show();
    if(action==='refresh')return refresh(true);
    if(action==='native'){close();return ctx.nativeQueue?.();}
    if(action==='recover-preview')return previewRecovery(id).catch(e=>{const box=$('#seq-recovery');if(box)box.innerHTML='<div class="warning-banner">'+esc(e.message)+'</div><button data-seq-action="open">Back to sequences</button>';toast(e.message,true);});
    if(action==='retire-preview')return previewRetirement(id).catch(e=>toast(e.message,true));
    if(action==='inspect')return inspect(id).catch(e=>toast(e.message,true));
    if(action==='clear-preview'||action==='end-idle'){
      const ids=action==='end-idle'?[id]:(data?.runs||[]).filter(r=>!finished.has(r.status)).map(r=>r.id);
      if(!ids.length)return toast('No unfinished sequences.');return preview(ids).catch(e=>toast(e.message,true));
    }
    if(action==='download')return perform(async()=>ctx.download('sequence-'+id+'-diagnostic.json',await call({action:'diagnostics',id})),'Preparing sequence diagnostic');
    if(action==='queue-resume'||action==='queue-pause'){
      const resume=action==='queue-resume';
      if(!confirm(resume?'Unpause WanGP? Already queued native jobs may start. Parked managed sequences will NOT resume.':'Pause WanGP dispatch after the current native job? This affects the whole renderer, not just one film.'))return;
      return perform(()=>P.wangp('/queue/'+(resume?'resume':'pause'),'POST',{}),resume?'Unpausing renderer queue':'Pausing renderer queue');
    }
    if(action==='cancel'&&!confirm('Cancel this sequence and cooperatively stop its current native job? No later window will submit. Finished videos are kept.'))return;
    if(action==='resume'&&!confirm('Resume this sequence? Director will reconcile any accepted job, then may submit the remaining windows.'+(data?.runs?.find(r=>r.id===id)?.layout==='legacy-cumulative'?'\nThis legacy run retains episode-long context and its increasing memory/storage cost. Use a new selected-window suffix for bounded continuation.':'')))return;
    return perform(async()=>{
      const r=await call({action:action==='attach'?'get':action,id});
      if(r.snapshot?.id===ctx.project().id)ctx.addJob(r);
      if(action==='attach')toast('Sequence and saved renders reconnected. Your editable film was not changed.');
      if(action==='reconcile')toast('Reconciliation requested; no new window will submit.');
    },action==='cancel'?'Requesting sequence cancellation':action==='resume'?'Resuming sequence':'Updating sequence record');
  });
  window.addEventListener('h3-render-snapshot',e=>{if(present()&&!busy){data={...e.detail,runs:e.detail.sequences};ctx.syncStates?.(data.runs);render();}});
  window.addEventListener('h3-open-sequences',()=>show());
  $('#dialog')?.addEventListener('close',()=>close());
  return{show,close,refresh};
}};
