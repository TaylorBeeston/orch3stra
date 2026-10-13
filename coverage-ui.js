/* A single entry point for coverage inspection, repair, generation and safe application.
 * Server work survives navigation. The client applies only to an unchanged project.
 */
window.H3CoverageUI = {create(ctx) {
  'use strict';
  const {$, esc, project, mutate, openDialog, toast, P, Store, download} = ctx;
  const H = H3, R = H3Scenes, A = H3ReferenceAgent, D = H3Doctor;
  const TERMINAL = new Set(['completed', 'cancelled', 'failed']);
  const licenseKey = 'h3-director:qwen-image-2.1:license-accepted';
  const licenseRevision = 'qwen-image-2.1-research-2026-09-20';
  let scopeIds = [], activeId = '', busy = false, polling = false, stopped = false;
  let rows = [], currentRun = null, timer, models = [], config = {}, lastDisplay = '', pendingLayout = false;
  const candidateDrafts=new Map();
  const progressCopies = new Map();
  const activities = new Map(), attemptedApply = new Set(), errors = new Map(), answers = new Map();
  const button = (action, text, extra = '') => `<button data-coverage="${action}" ${extra}>${text}</button>`;
  const isOpen = () => ctx.dialogName() === 'coverage-flow';
  function selectedScope() {
    const p = project(), w = p.windows.find(w => w.id === ctx.selected()) || p.windows[0];
    return (w && R.sceneFor(p, w)?.windowIds) || (w ? [w.id] : []);
  }
  function planner() { return {provider:P.config.provider, model:P.config.model, protocol:P.config.protocol === 'auto' ? (P.GO?.[P.config.model] || 'chat') : P.config.protocol, effort:P.config.effort, opencodeUrl:P.config.opencodeUrl, opencodeUsername:P.config.opencodeUsername, vision:P.config.images === true, key:P.secrets[P.config.provider] || ''}; }
  function resetConfig(r = null) {
    const pol = r?.policy || project().referenceAutomation || {};
    config = {mode:r?.policy?.mode||'autonomous', maxImages:pol.maxImages ?? 4, maxCalls:pol.maxCalls ?? 24, maxMinutes:pol.maxMinutes ?? 60,
      maxAttempts:pol.maxAttempts ?? 2, allowImages:true, repairLabels:true, repairInspectionReplies:r ? pol.repairInspectionReplies === true : true, allowFrames:pol.allowFrames === true, allowNewIdentity:pol.allowNewIdentity === true, autoApply:true,
      modelType:r?.imageSettings?.modelType || project().imageSettings?.modelType || '', license:false,
      instruction:project().referenceAutomation?.instruction || 'Reuse suitable approved images first. Generate only genuinely missing coverage. Preserve identities, dialogue, wardrobe and timing.', ...(!r ? project().coveragePreferences || {} : {})};
    try { config.license = localStorage.getItem(licenseKey) === licenseRevision; } catch {}
  }
  function capture() {
    if (!isOpen()) return;
    for (const n of document.querySelectorAll('[data-coverage-config]')) config[n.dataset.coverageConfig] = n.type === 'checkbox' ? n.checked : n.type === 'number' ? Number(n.value) : n.value;
  }
  function imageSettings() {
    const old = currentRun?.imageSettings || project().imageSettings || {};
    return {resolution:'1024x1024', steps:40, guidance:4, seed:-1, ...old,
      ...(old.modelType !== config.modelType ? {accelerationProfile:'',imageProfile:null,preserveFirstScene:false,...H3References.imageDefaults(config.modelType)} : {}), modelType:config.modelType, licenseAccepted:config.license === true};
  }
  function policy() {
    return A.policy({...A.defaults, ...project().referenceAutomation, ...(currentRun?.policy || {}), enabled:true,
      mode:config.mode, allowImages:config.allowImages, repairLabels:config.repairLabels, repairInspectionReplies:config.repairInspectionReplies, allowFrames:config.allowFrames, allowNewIdentity:config.allowNewIdentity,
      vision:P.config.images === true, maxImages:config.maxImages, maxCalls:config.maxCalls, maxMinutes:config.maxMinutes, maxAttempts:config.maxAttempts});
  }
  function options() {
    const list = models.slice();
    if (config.modelType && !list.some(x => x.model_type === config.modelType)) list.unshift({model_type:config.modelType, name:project().imageSettings?.modelLabel || config.modelType});
    return `<section class="coverage-options"><h3>2 · Permissions and budget</h3><p>Use existing images first. Only generate when inspected coverage is missing. This starts reference work, not H3 video generation.</p>
      <div class="coverage-grid"><label>Mode<select data-coverage-config="mode"><option value="autonomous" ${config.mode==='autonomous'?'selected':''}>Automatic · inspect, generate, review, label</option><option value="review" ${config.mode==='review'?'selected':''}>Review each new image</option></select></label>
      <label>Image preset<select data-coverage-config="modelType"><option value="">Choose a preset</option>${list.map(m=>`<option value="${esc(m.model_type)}" ${m.model_type===config.modelType?'selected':''}>${esc(m.name||m.model_type)}</option>`).join('')}</select></label></div>
      <div class="row wrap">${button('discover','Discover Image presets')}${button('connections','Planner connection')}${button('image-settings','Advanced image settings')}</div>
      <p class="field-note">Planner: ${esc(P.config.provider+' / '+(P.config.model||'not selected'))} · images ${P.config.images?'ON':'OFF'}. Selected reference and generated pixels are sent to this provider.</p>
      <label class="check"><input type="checkbox" data-coverage-config="repairLabels" ${config.repairLabels?'checked':''}>Inspect existing images and label verified coverage for the affected windows.</label>
      <label class="check"><input type="checkbox" data-coverage-config="repairInspectionReplies" ${config.repairInspectionReplies?'checked':''}>Repair a malformed inspection reply once automatically, within the AI-request allowance. Only unresolved images are rechecked.</label>
      <label class="check"><input type="checkbox" data-coverage-config="allowImages" ${config.allowImages?'checked':''}>Generate missing images through the existing WanGP queue. Krea Edit accepts two ordered inputs; text-only presets cannot preserve character anchors.</label>
      <label class="check"><input type="checkbox" data-coverage-config="autoApply" ${config.autoApply?'checked':''}>Apply completed reference results automatically, only if the project is unchanged.</label>
      <label class="check"><input type="checkbox" data-coverage-config="license" ${config.license?'checked':''}>I am authorized to use these sources and accept the selected image model’s license.</label>
      <div class="coverage-grid"><label>Image attempts per window (1–20)<input type="number" min="1" max="20" data-coverage-config="maxAttempts" value="${config.maxAttempts}"></label><label>Image attempts, total<input type="number" min="0" max="100" data-coverage-config="maxImages" value="${config.maxImages}"></label><label>AI requests, total<input type="number" min="1" max="1024" data-coverage-config="maxCalls" value="${config.maxCalls}"></label></div>
      <p class="field-note">Each window allowance covers ALL of its reference images and retries, not just one subject. Totals include work already spent; increasing the window allowance does not increase the run’s total image, AI or time budgets. ${scopeIds.length>8?'This is a large scope; default budgets are a small test, not a promise to finish every window.':''}</p>
      <details><summary>Direction and advanced limits</summary><label>Direction<textarea data-coverage-config="instruction" rows="3">${esc(config.instruction)}</textarea></label>
      <label class="check"><input type="checkbox" data-coverage-config="allowFrames" ${config.allowFrames?'checked':''}>Use eligible previous rendered frames as context.</label>
      <label class="check"><input type="checkbox" data-coverage-config="allowNewIdentity" ${config.allowNewIdentity?'checked':''}>Allow the first image for an existing text-only subject. Never invent new cast or replace an approved identity.</label>
      <div class="coverage-grid"><label>Preparation minutes<input type="number" min="1" max="360" data-coverage-config="maxMinutes" value="${config.maxMinutes}"></label></div></details>
      <p class="field-note">Manual pins, exclusions, unapproved images, dialogue and timing are protected. A model review is not a guarantee of visual quality. Shared projects can update on the server; local-only projects apply when open again. Stale results remain available for review.</p></section>`;
  }
  async function open(ids = null, id = '') {
    scopeIds = (ids || selectedScope()).filter(x => project().windows.some(w => w.id === x));
    activeId = id; currentRun = null; resetConfig(); lastDisplay = ''; pendingLayout = false;
    openDialog('Fill missing coverage', '<p>Loading coverage and saved runs…</p>', 'coverage-flow');
    await loadRows();
    if (!activeId) activeId = rows.find(r => !TERMINAL.has(r.status))?.id || '';
    if (activeId) {currentRun = await P.call('reference-agent', {action:'diagnose', id:activeId}); scopeIds = currentRun.windowIds; resetConfig(currentRun);}
    render(); schedule();
  }
  function issues() {
    if (currentRun) return currentRun.blockers || [];
    return scopeIds.flatMap(id => {const w = project().windows.find(w=>w.id===id); if(!w)return[];const m=R.resolve(project(),w);return m.issues.map(i=>({...i,windowId:id,windowTitle:w.title,sourceStamp:m.sourceStamp}));});
  }
  function issueHTML(i, index) {
    const a = (currentRun?.project || project()).assets.find(a=>a.id===i.assetId);
    const img = a ? `<img data-coverage-image="${esc(a.id)}" alt="${esc(a.name)}">` : '';
    const reasons = i.reasons || [], ids = R.unique(reasons.map(x=>x.requirementId).filter(Boolean));
    return `<article class="coverage-issue" data-coverage-issue="${index}">${img}<div><b>${esc(i.windowTitle || i.label || 'Window')}</b><p>${esc(i.message)}</p>
      ${i.origins?.length?`<p class="field-note">Required because: ${esc(i.origins.map(o=>o.label).join('; '))}</p>`:''}
      <div class="row wrap">${reasons.some(x=>x.code==='excluded')?button('allow-here','Allow this image here',`data-issue="${index}"`):''}
      ${reasons.some(x=>x.code==='unapproved')?button('approve-image','Approve this image for reference use',`data-issue="${index}" data-needs-pixels="${esc(a?.id||'')}" disabled`):''}
      ${a&&ids.length?button('confirm-coverage','I checked: this image matches',`data-issue="${index}" data-needs-pixels="${esc(a?.id||'')}" disabled`):''}
      ${a?button('label-image','Review image labels',`data-issue="${index}"`):''}
      ${i.origins?.filter(o=>o.fieldKey).slice(0,3).map(o=>button('field',esc(o.label),`data-key="${esc(o.fieldKey)}"`)).join('')||''}
      ${button('inspect-window','Inspect this window',`data-window="${esc(i.windowId)}"`)}</div>
      ${a&&ids.length?'<small>Different state labels may describe the same pixels. Confirm only after inspecting the image; do not approve an actually wrong outfit.</small>':''}</div></article>`;
  }
  function imageRecoveryHTML(r){
    const x=r.imageRecovery;if(!x)return '';
    return `<section class="coverage-image-recovery subtle-box"><h3>Retry this image—not the whole run</h3><p>${esc(x.windowTitle)}</p><p>${esc(x.message)}</p><p class="field-note">One new image attempt within your existing budget. The failed request remains in history; completed windows and accepted pictures are not repeated. Visual review still runs afterward.</p>${button('retry-image','Retry image as one prompt','class="primary" '+(!x.canRetry?'disabled':''))}<details><summary>Saved complete image prompt</summary><pre>${esc(x.promptPreview||'')}</pre></details></section>`;
  }
  function recoveryHTML(r) {
    const recovery=r.planRecovery;if(!recovery)return '';
    const retry=recovery.kind==='repair', ready=recovery.kind==='revalidate';
    return `<section class="coverage-plan-recovery subtle-box"><h3>${ready?'Saved image plan is recoverable':retry?'Repair one image-planning step':'Saved planning request needs attention'}</h3>
      <p>${esc(recovery.windowTitle||'Current window')}</p><p>${esc(recovery.message)}</p>
      <p class="field-note">${retry?'The previous response is retained. Repair requests one new plan for this window, within the existing allowance. It does not redo finished windows or accepted images.':ready?'Requirement labels come from the project, not an exact-text echo from the model. Continuing rechecks the saved response; actual generated pixels still need review.':'Nothing was assumed complete, regenerated, or discarded.'}</p>
      <div class="row wrap">${retry?button('retry-plan','Repair this step & continue','class="primary" '+(!recovery.canRetry?'disabled':'')):ready?button('resume','Continue saved plan','class="primary"'):''}
      ${recovery.requestId?button('open-ai','Open captured AI request',`data-id="${esc(recovery.requestId)}"`):''}</div>
      ${recovery.bindingChanges?.length?`<details><summary>Canonical labels used for this plan</summary>${recovery.bindingChanges.map(c=>`<p><b>${esc(c.field)}</b><br>Planner label: ${esc(c.proposed||'(empty)')}<br>Project requirement: ${esc(c.bound)}</p>`).join('')}</details>`:''}
      ${recovery.rawPreview?`<details><summary>Rejected response (kept for diagnosis)</summary><pre>${esc(recovery.rawPreview)}</pre></details>`:''}</section>`;
  }
  function inspectionHTML(r){
    const x=r.inspectionRecovery;if(!x)return '';
    return `<section class="coverage-inspection-recovery subtle-box"><h3>Image check reply needs attention</h3><p>${esc(x.windowTitle)}</p><p>${esc(x.message)}</p>
      <p class="field-note">This concerns the AI’s inspection reply, not duplicate files in your library. Valid image checks and completed windows are retained. ${x.budgetRemaining??0} AI requests remain.</p>
      <div class="row wrap">${x.kind==='revalidate'?button('resume','Continue saved inspection','class="primary" '+(!x.canRetry?'disabled':'')):x.kind==='repair'?button('retry-inspection','Recheck unresolved images','class="primary" '+(!x.canRetry?'disabled':'')):''}
      ${x.requestId?button('open-ai','Open captured inspection',`data-id="${esc(x.requestId)}"`):''}</div>
      <details><summary>Which images and what went wrong?</summary>${(x.issues||[]).map(i=>`<p>${esc(i.message)}</p>`).join('')}
      <ul>${(x.images||[]).map(i=>`<li>${esc(i.imageKey||'')} ${esc(i.name)}${x.unresolvedIds?.includes(i.assetId)?' — needs a valid check':' — retained'}</li>`).join('')}</ul>
      <pre>${esc(x.rawPreview||'Saved response unavailable; a new inspection requires confirmation.')}</pre></details></section>`;
  }
  function candidateHTML(r){
    const x=r.candidateReview;if(!x)return '';
    const c=(r.candidates||[]).find(c=>c.id===x.candidateId),draft=candidateDrafts.get(x.candidateId)||{prompt:x.prompt,reason:''};
    return `<section class="coverage-candidate-decision subtle-box"><h3>Keep this image, or try again?</h3><p>${esc(x.reason)}</p>
      <p class="field-note">${x.attempts}/${x.limit} attempts in this window. ${esc(x.message)}</p>
      <label>What should change? <small>(optional)</small><textarea rows="2" data-candidate-edit="reason" data-candidate-id="${esc(x.candidateId)}" placeholder="For example: remove the extra person in the background.">${esc(draft.reason)}</textarea></label>
      <details><summary>Edit the replacement image prompt</summary><textarea rows="6" data-candidate-edit="prompt" data-candidate-id="${esc(x.candidateId)}">${esc(draft.prompt)}</textarea><p class="field-note">The approved input order and required subject/state are retained. The retry uses a fresh random seed.</p></details>
      <div class="row wrap">${button('retry-candidate',x.requiresExtraAttempt?'Allow 1 more attempt & retry':'Reject & retry this image','class="primary" '+(!x.canRetry?'disabled':''))}
      ${button('approve','Accept this candidate',!x.canAct?'disabled':'')}${button('reject-candidate','Reject and pause',!x.canAct?'disabled':'')}</div>
      <small>No need to restart the reference pass. Rejected images remain in history, not in the approved bank.</small></section>`;
  }
  function budgetHTML(r){
    const x=r.budgetState;if(!x?.windowId)return '';
    const parked=['paused','needs_review'].includes(r.status);
    return `<section class="coverage-budget-status subtle-box"><h3>${x.exhausted?'This window has used its image allowance':'Image allowance · current window'}</h3>
      <p><b>${x.attempts} / ${x.limit}</b> attempts in this window · <b>${x.images} / ${x.imageLimit}</b> across the run · ${x.calls} / ${x.callLimit} AI requests</p>
      <p class="field-note">All references and retries in this window share that allowance. Accepting an image does not refund the attempt. Approved work is already retained on the server.</p>
      ${x.otherBudget?`<p class="warning-banner">The run’s ${esc(x.otherBudget)} allowance is also used. Increase that limit in Run settings before continuing; a window increase alone cannot bypass it.</p>`:''}
      ${parked&&x.exhausted?`<div class="row wrap">${x.limit<20?button('extend-window',r.candidateReview?'Allow 20 here, then review image':'Allow 20 here & continue','class="primary" '+(!x.canExtend||!!x.otherBudget?'disabled':'')):''}${button('show-limits','Review all run limits')}</div><p class="field-note">The shortcut changes only this window. Run settings can raise the normal per-window allowance for the rest of the run. It does not restart completed windows.</p>`:''}
      </section>`;
  }
  function progressHTML(r){
    const x=r.savedProgress;if(!x)return '';
    const copy=progressCopies.get(r.id);
    return `<section class="coverage-progress-save subtle-box"><h3>Keep what is ready</h3><p>${x.completed} / ${x.total} windows prepared · ${x.acceptedImages} approved new images · ${x.verifiedChecks} accepted image checks retained</p>
      <div class="row wrap">${button('save-progress','Save progress as a project copy…',!x.canSave?'disabled':'')}${button('progress-pack','Download progress + approved images',!x.canSave?'disabled':'')}</div>
      <p class="field-note">${x.canSave?'Save without cancelling or starting any work. The original run stays where it is and can continue. Cancel also keeps its archives; this panel remains available afterward.':'Pause at the next action boundary to save a consistent copy. Nothing is discarded while waiting.'} Only approved images are usable references; incomplete windows are not marked ready.</p>
      ${copy?`<p class="coverage-save-success" role="status">Saved in Projects: <b>${esc(copy.name)}</b>. Your original project remains open.</p><div class="row wrap">${button('download-progress-project','Download this project (portable)')}${button('projects','Open Projects')}</div>`:''}</section>`;
  }
  async function checkpoint(){
    if(!activeId)throw Error('Open a saved reference run first.');
    return P.call('reference-agent',{action:'save-progress',id:activeId,confirm:true});
  }
  async function fetchApproved(snapshot){
    const blobs=new Map();
    for(const c of snapshot.result.candidates){const blob=await P.getStudioBlob(c.id);if(!blob||blob.size!==c.size)throw Error('Unable to retrieve approved image: '+c.name+'. The checkpoint is retained on the server.');
      if(globalThis.crypto?.subtle&&c.sha256){const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==c.sha256)throw Error('Approved image hash mismatch: '+c.name);}
      blobs.set(c.id,blob);
    }
    return blobs;
  }
  async function cacheApproved(blobs){
    const missing=[];
    // A download must not replace a locally reattached/edited source with the same ID.
    // Verify all collisions before storing anything; progress-pack downloads never
    // touch the project media store at all.
    for(const [id,blob] of blobs){const old=await Store.getBlob(id);if(!old){missing.push([id,blob]);continue;}
      const a=new Uint8Array(await old.arrayBuffer()),b=new Uint8Array(await blob.arrayBuffer());
      if(a.length!==b.length||a.some((v,i)=>v!==b[i]))throw Error('A local image with this ID has changed. Nothing was overwritten. Use Download progress + approved images to save the original accepted bytes separately.');
    }
    for(const [id,blob]of missing)await Store.putBlob(id,blob);
  }
  async function saveProgressCopy(){
    if(!await askConfirm('Save approved reference progress as a SEPARATE project copy? Completed-window selections and approved images are kept. Unfinished windows retain their original selections. The original project and run remain unchanged; nothing is generated or cancelled.'))return;
    const source=H.clone(project()),stamp=D.stamp(source),snapshot=await checkpoint(),copy=A.progressCopy(source,snapshot);
    const blobs=await fetchApproved(snapshot);
    if(project().id!==source.id||D.stamp(project())!==stamp)throw Error('Your project changed during the save. The server checkpoint is safe; retry from the original project.');
    // Stable ID makes repeated saves idempotent without overwriting an edited copy.
    const existing=Store.load(copy.id);
    if(!existing){await cacheApproved(blobs);if(project().id!==source.id||D.stamp(project())!==stamp)throw Error('Project changed during the save. No project was overwritten.');await Store.save(copy,false);}
    progressCopies.set(snapshot.runId,{id:copy.id,name:(existing||copy).name,checkpointId:snapshot.id});errors.delete(snapshot.runId);
    toast('Progress saved in Projects. Keep working on this run, or download the copy.');render();
  }
  async function downloadProgressPack(){
    const snapshot=await checkpoint(),blobs=await fetchApproved(snapshot);
    const entries=[['checkpoint.json',new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'})]];
    for(const [i,c]of snapshot.result.candidates.entries()){const ext=c.type==='image/png'?'png':c.type==='image/webp'?'webp':'jpg';entries.push(['approved/'+String(i+1).padStart(3,'0')+'-'+c.id+'.'+ext,blobs.get(c.id)]);}
    entries.push(['README.txt',new Blob(['Reference progress checkpoint.\nContains the prepared project metadata and all NEW approved candidate images from this run. Rejected/unreviewed candidates and original library media are not included. This is not a full portable project backup. Keep your original project/media or use Save progress as a project copy, then Download this project (portable).\nNo GPU/model calls, cancellation, or timeline completion was performed.\nImage IDs and original names are recorded in checkpoint.json.\n'])]);
    const zip=await ctx.makeZip(entries);download('reference-progress-'+snapshot.id+'.zip',zip);errors.delete(activeId);
    toast('Progress pack downloaded with approved image files. The original run can still continue.');
  }
  function statusHTML(r) {
    if(!r)return '<p class="subtle-box">No run started. Inspect the scope and start when ready.</p>';
    const applied = project().referencePreparationHistory?.some(x=>x.id===r.id);
    const accepted=(r.candidates||[]).filter(c=>c.status==='accepted').length, labelled=(r.labelReviews||[]).filter(x=>x.accepted).length;
    const phase=({generating_reference:'Generating missing image',reviewing_candidate:'Checking actual generated pixels',finished:'Finished'})[r.phase]||r.phase||r.status;
    return `<div class="coverage-live" aria-live="polite"><div class="row wrap"><h3>${esc(r.name)}</h3><span class="pill">${applied?'Applied to project':esc(r.status)}</span></div><p>${esc(r.message)}</p>
      <progress value="${r.index}" max="${r.total||1}"></progress><p>${r.index}/${r.total} windows ready · ${labelled} existing-image checks accepted · ${accepted} new images accepted</p>
      <p class="field-note">${esc(phase)} · ${r.usage?.calls||0}/${r.policy.maxCalls} AI calls · ${r.usage?.images||0}/${r.policy.maxImages} image attempts. Auto-refreshes every 2 seconds.</p>
      ${r.native?`<p>Most recent image job: ${esc(r.native.status)} · ${esc(r.native.message||'')} · ${Math.round(r.native.progress||0)}%</p>`:''}
      ${budgetHTML(r)}${imageRecoveryHTML(r)}${inspectionHTML(r)}${recoveryHTML(r)}${candidateHTML(r)}${progressHTML(r)}
      ${errors.get(r.id)?`<p class="warning-banner">${esc(errors.get(r.id))}</p>`:''}
      ${r.application?.message?`<p class="warning-banner">${esc(r.application.message)}</p>`:''}
      ${r.pending?.question?`<label>${esc(r.pending.question)}<textarea id="coverage-answer" rows="3">${esc(answers.get(r.id)||'')}</textarea></label>`:''}
      ${r.pending?.kind==='generation'?`<details open><summary>Missing image · ${esc(r.pending.request.title)}</summary><p>${esc(r.pending.request.description)}</p><pre>${esc(r.pending.request.prompt)}</pre></details>`:''}
      <div class="row wrap">${r.status==='running'?button('pause','Pause after current action'):''}
      ${['needs_review','paused'].includes(r.status)&&!r.planRecovery&&!r.imageRecovery&&!r.inspectionRecovery&&!r.candidateReview?button('resume','Continue / reconcile'):''}
      ${r.pending?.kind==='generation'&&r.policy.allowImages&&!r.imageRecovery?button('approve','Approve this image generation'):''}
      ${r.pending?.candidateId&&!r.candidateReview?button('approve','Accept this candidate'):''}
      
      ${!TERMINAL.has(r.status)?button('cancel','Cancel reference work'):''}
      ${['needs_review','paused'].includes(r.status)&&!r.ownerSequenceId?button('fresh','Use my edited project instead…'):''}
      ${r.status==='completed'&&!applied?button('apply',r.application?.autoApply&&r.application.status==='pending'?'Committing results…':'Apply reference results','class="primary" '+(r.application?.autoApply&&r.application.status==='pending'?'disabled':'')):''}${button('report','Details / diagnostic')}</div>
      <div class="coverage-candidates">${(r.candidates||[]).slice(-8).map(c=>`<article><img src="/api/studio-blob?key=${encodeURIComponent(c.id)}" alt="${esc(c.name)}"><b>${esc(c.name)} · ${esc(c.status)}</b><p>${esc(c.review?.reason||'Awaiting review')}</p></article>`).join('')}</div>
      <details><summary>Decisions, reused-image checks and log</summary>${(r.labelReviews||[]).slice(-12).map(x=>`<p><b>${esc((currentRun?.project||project()).assets.find(a=>a.id===x.assetId)?.name||x.assetId)}:</b> ${esc(x.reason)} (${x.accepted?'used':'not used'})</p>`).join('')}${(r.events||[]).slice(-15).map(e=>`<p><small>${esc(e.at)}</small> ${esc(e.message)}</p>`).join('')}</details></div>`;
  }
  function render() {
    if(!isOpen())return;
    const all=issues(), hard=all.filter(i=>i.code!=='missing-coverage'), gaps=all.filter(i=>i.code==='missing-coverage');
    const w=project().windows.find(w=>w.id===ctx.selected())||project().windows[0];
    const existing=currentRun&&!TERMINAL.has(currentRun.status), disabled=existing&&(['running','cancelling'].includes(currentRun.status)||!!currentRun.ownerSequenceId);
    const html=`<div class="coverage-intro"><b>Check existing → Generate only gaps → Visually review → Label & assign</b><p>One workflow, no manual trip through Image studio. A missing label is not necessarily a missing picture.</p></div>
      <div class="coverage-quick-launch">${button('launch',existing?(currentRun.budgetState?.exhausted&&currentRun.budgetState?.canExtend?'Increase allowance below':currentRun.candidateReview?'Review this image below':currentRun.imageRecovery?'Retry image as one prompt':currentRun.inspectionRecovery?.kind==='repair'?'Recheck unresolved images':currentRun.inspectionRecovery?.kind==='revalidate'?'Continue saved inspection':currentRun.planRecovery?.kind==='repair'?'Repair this step & continue':'Continue with these settings'):'Fill missing coverage','class="primary" '+(disabled?'disabled':''))}<small>${config.maxImages} image attempts · ${config.maxCalls} AI requests total · ${config.autoApply?'auto-apply if unchanged':'review before applying'}<br>Settings and exact conflicts below.</small></div>
      <section id="coverage-live-host">${statusHTML(currentRun)}</section>
      <details ${!currentRun||hard.length?'open':''}><summary>1 · Scope and coverage · ${scopeIds.length} windows · ${gaps.length} gaps · ${hard.length} conflicts</summary>
      ${!existing?`<div class="row wrap">${button('scope-window','Selected window')}${button('scope-scene','Selected scene')}${button('scope-all','Whole film')}</div>`:''}
      <p>${scopeIds.slice(0,3).map(id=>esc(project().windows.find(w=>w.id===id)?.title||id)).join(' → ')}${scopeIds.length>3?' …':''}</p>
      <div id="coverage-issues">${all.slice(0,30).map(issueHTML).join('')||'<p>No structural gaps found. The visual pass can still find a missing angle or pose.</p>'}</div>${all.length>30?'<p>Showing the first 30 findings. Use a smaller scope to inspect the rest.</p>':''}</details>
      <details id="coverage-run-limits" ${!currentRun||['needs_review','paused'].includes(currentRun.status)?'open':''}><summary>${existing?'Change this run’s permissions / limits':'Run settings'}</summary>${options()}
      <div class="coverage-launch">${button(existing?'authorize':'start',existing?'Save permissions & continue':'Fill missing coverage','class="primary" '+(disabled?'disabled':''))}
      ${button('advanced','Advanced reference workbench')}</div>${existing?'<p class="field-note">Updates this existing run with explicit confirmation; does not reset spent budget or duplicate accepted jobs.</p>':''}</details>
      <details><summary>Other saved runs (${rows.length})</summary>${rows.map(r=>`<p>${button('open-run',esc(r.status+' · '+r.name),`data-id="${esc(r.id)}"`)} <small>${esc(r.createdAt)}</small></p>`).join('')}</details>`;
    $('#dialog-body').innerHTML=html; hydrateImages();
  }
  async function hydrateImages() {
    for (const n of document.querySelectorAll('[data-coverage-image]')) {
      try {const id=n.dataset.coverageImage;let b=await Store.getBlob(id);if(!b&&currentRun)b=await P.getStudioBlob(id);if(b){const thumb=await Store.thumbnail(b);if(n.isConnected){n.src=thumb.url;await n.decode();for(const b of document.querySelectorAll('[data-needs-pixels]'))if(b.dataset.needsPixels===id)b.disabled=false;}}}catch{}
    }
  }
  async function loadRows() {if(!P.bridge)return; const result=await P.call('reference-agent',{action:'list',projectId:project().id});rows=result.runs||[];}
  async function apply(r,automatic=false) {
    if(r.ownerSequenceId){await ctx.scene().useResult(r.id);return;}
    const start=project(),pid=start.id,stamp=D.stamp(start);
    if(start.referencePreparationHistory?.some(x=>x.id===r.id))return;
    if(automatic&&await Store.getBlob('coverage-applied:'+r.id))return;
    if(r.sourceStamp!==stamp){if(automatic)throw Error('Your project changed during preparation. Results retained; use Apply reference results to review a separate copy.');return ctx.scene().useResult(r.id);}
    const full=await P.call('reference-agent',{action:'result',id:r.id});
    if(full.application?.autoApply&&full.application.status==='pending')throw Error('The server is committing this result. Wait for the automatic application to finish.');
    for(const a of full.project.assets)if(!start.assets.some(x=>x.id===a.id))await Store.putBlob(a.id,await P.getStudioBlob(a.id));
    if(project().id!==pid||D.stamp(project())!==stamp)throw Error('Project changed while downloading reference results. Nothing was overwritten.');
    const next=A.mergeResult(project(),full);
    if(full.application?.status==='shared-applied'&&Number.isSafeInteger(full.application.serverRevision)){try{const k='h3-director:shared-revisions:v1',rs=JSON.parse(localStorage.getItem(k)||'{}');rs[pid]=full.application.serverRevision;localStorage.setItem(k,JSON.stringify(rs));}catch{}}
    mutate(()=>Object.assign(project(),next));await Store.save(project());await ctx.hydrate();
    await Store.putBlob('coverage-applied:'+r.id,new Blob([JSON.stringify({id:r.id,projectId:pid,at:new Date().toISOString()})],{type:'application/json'}));
    await P.call('reference-agent',{action:'ack-applied',id:r.id,confirm:true});
    toast('Coverage applied: images labelled and assigned. Undo restores the prior edit.');
  }
  async function poll() {
    if(polling||stopped)return;if(!P.bridge){schedule();return;}polling=true;
    try{
      const pid=project().id;await loadRows();if(pid!==project().id)return;
      for(const r of rows){
        if(r.application?.autoApply&&!r.ownerSequenceId&&r.status==='completed'&&r.application?.status!=='pending'&&!project().referencePreparationHistory?.some(x=>x.id===r.id)&&!attemptedApply.has(r.id)&&!busy){
          attemptedApply.add(r.id);try{await apply(r,true);}catch(e){errors.set(r.id,e.message);toast(e.message,true);}
        }
        if(activities.has(r.id)){const a=activities.get(r.id);if(r.status==='running')a.update(r.message);else{r.status==='completed'?a.done('Coverage ready / applied'):r.status==='cancelled'?a.done('Reference work cancelled'):a.fail(r.message);activities.delete(r.id);}}
      }
      if(isOpen()&&activeId){const item=rows.find(r=>r.id===activeId);if(item){const previous=currentRun;currentRun={...previous,...item};if(['needs_review','paused'].includes(item.status)&&!busy){currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});}
        // Never replace a live form or destroy focused answers while polling.
        pendingLayout ||= previous?.status!==item.status || previous?.budgetState?.canExtend!==item.budgetState?.canExtend || previous?.savedProgress?.canSave!==item.savedProgress?.canSave || previous?.planRecovery?.kind!==currentRun?.planRecovery?.kind || previous?.planRecovery?.canRetry!==currentRun?.planRecovery?.canRetry || previous?.imageRecovery?.stamp!==currentRun?.imageRecovery?.stamp || previous?.imageRecovery?.canRetry!==currentRun?.imageRecovery?.canRetry || previous?.inspectionRecovery?.stamp!==currentRun?.inspectionRecovery?.stamp || previous?.inspectionRecovery?.canRetry!==currentRun?.inspectionRecovery?.canRetry || previous?.candidateReview?.stamp!==currentRun?.candidateReview?.stamp || previous?.candidateReview?.canAct!==currentRun?.candidateReview?.canAct; if(item.updatedAt!==lastDisplay||pendingLayout){if(pendingLayout&&!busy&&!document.activeElement?.matches('input,textarea,select')){capture();currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();pendingLayout=false;lastDisplay=item.updatedAt;}else if(!$('#coverage-answer')?.matches(':focus')&&!document.activeElement?.matches('[data-candidate-edit]')){$('#coverage-live-host').innerHTML=statusHTML(currentRun);lastDisplay=item.updatedAt;} /* A focused answer defers paint, not the only future chance to show recovery. */}
      }}
    }catch(e){if(isOpen())errors.set(activeId,e.message);}finally{polling=false;schedule();}
  }
  function schedule(){clearTimeout(timer);if(!stopped)timer=setTimeout(poll,isOpen()||rows.some(r=>!TERMINAL.has(r.status))?2000:8000);}
  async function uploadSources(p) {
    const needed=new Set(scopeIds.flatMap(id=>{const w=p.windows.find(w=>w.id===id);return [...R.candidates(p,w),...(config.repairLabels?R.labelCandidates(p,w):[]),...R.reusable(p,w)].map(a=>a.id);}));
    for(const id of needed){const info=await P.call('studio',{action:'blob-info',key:id});if(info.info)continue;const b=await Store.getBlob(id);if(!b)throw Error('Missing source pixels: '+(p.assets.find(a=>a.id===id)?.name||id)+'. Reattach this file before filling coverage.');await P.studioBlob(id,b);}
  }
  async function start(authorize=false) {
    capture();const pol=policy(),cfg=imageSettings();
    if(!P.config.model||!P.config.images){ctx.connections();throw Error('Choose a planning model with visual input enabled.');}
    if(pol.allowImages&&(!cfg.modelType||!cfg.licenseAccepted))throw Error('Choose your Image preset and check source/model authorization.');
    if(!scopeIds.length)throw Error('Choose at least one window.');
    if(!await askConfirm(`${authorize?'Update and continue this saved run':'Fill missing coverage for '+scopeIds.length+' windows'}?\nUp to ${pol.maxImages} image attempts and ${pol.maxCalls} AI calls in total. ${authorize&&currentRun?.imageRecovery?'One new image attempt retries the saved prompt in FG mode; no planning call is repeated. ':authorize&&currentRun?.planRecovery?.kind==='repair'?'One new planning call will repair only the rejected current step. ':''}Existing source pixels go to ${P.config.provider}/${P.config.model}. ${config.autoApply?'Apply only if the project is unchanged.':'Keep results for review.'} Dialogue, timing, source files and old renders are preserved.`))return;
    if(config.license)try{localStorage.setItem(licenseKey,licenseRevision);}catch{}
    const pid=project().id;
    mutate(()=>{project().coveragePreferences={...config,license:undefined};});await Store.save(project());
    if(authorize){await P.call('reference-agent',{action:'authorize',id:activeId,policy:pol,planner:planner(),imageSettings:cfg,autoApply:config.autoApply,consent:true});const fresh=await P.call('reference-agent',{action:'diagnose',id:activeId});if(fresh.imageRecovery)await P.call('reference-agent',{action:'retry-image',id:activeId,planner:planner(),recoveryStamp:fresh.imageRecovery.stamp,confirm:true});else if(fresh.inspectionRecovery?.kind==='repair')await P.call('reference-agent',{action:'retry-inspection',id:activeId,planner:planner(),recoveryStamp:fresh.inspectionRecovery.stamp,confirm:true});else if(fresh.planRecovery?.kind==='repair')await P.call('reference-agent',{action:'retry-plan',id:activeId,planner:planner(),recoveryStamp:fresh.planRecovery.stamp,confirm:true});else await P.call('reference-agent',{action:'resume',id:activeId,planner:planner(),answer:$('#coverage-answer')?.value||answers.get(activeId)});}
    else{
      const p=H3.clone(project());await Store.save(project());await uploadSources(p);
      if(project().id!==pid||D.stamp(project())!==D.stamp(p))throw Error('The project changed during upload. Review the new scope before starting.');
      const requestId='fill_'+H3Edit.finishId();
      // Remember a small start marker in project metadata for response-loss diagnostics (never keys).
      mutate(()=>{project().coverageStart={requestId,sourceStamp:D.stamp(p),windowIds:scopeIds,at:new Date().toISOString()};});await Store.save(project());
      const r=await P.call('reference-agent',{action:'start',requestId,project:{...A.compactProject(p),jobs:p.jobs||[]},windowIds:scopeIds,policy:pol,planner:planner(),imageSettings:cfg,instruction:config.instruction,autoApply:config.autoApply,consent:true});activeId=r.id;
    }
    const a=window.H3Activity?.start('Fill missing coverage');if(a)activities.set(activeId,a);
    currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});await loadRows();render();schedule();
  }
  async function repair(kind,index){
    const issue=issues()[index],p=currentRun?.project||project(),w=p.windows.find(w=>w.id===issue.windowId);
    const requirementIds=R.unique((issue.reasons||[]).map(r=>r.requirementId).filter(Boolean));
    if(['confirm-coverage','approve-image'].includes(kind)&&!document.querySelector(`[data-coverage-issue="${index}"] img`)?.naturalWidth)throw Error('Wait for the actual picture to load before confirming it.');
    if(!await askConfirm(kind==='approve-image'?`Approve ${issue.assetName} for reference use? This explicitly changes its approval in the prepared library; original pixels stay unchanged.`:kind==='allow-here'?`Allow ${issue.assetName} in ${w.title}? This changes only this window’s exclusions; original pins and media stay.`:`Confirm from the displayed pixels that ${issue.assetName} satisfies these exact state requirements?\n${requirementIds.map(id=>R.requirements(p,w).needs.find(n=>n.id===id)?.description).join('\n')}\nThis is a scoped label confirmation, not an image edit.`))return;
    const operation={kind,assetId:issue.assetId,sourceStamp:issue.sourceStamp||R.stamp(p,w),requirementIds,reason:'User visually confirmed the displayed existing reference for the exact current-window requirements.'};
    if(currentRun){currentRun=await P.call('reference-agent',{action:'repair-conflict',id:activeId,windowId:w.id,operation,confirm:true});}
    else{const q=H.clone(p);R.repairConflict(q,q.windows.find(x=>x.id===w.id),operation);mutate(()=>Object.assign(project(),q));}
    render();
  }
  async function click(action,b){
    capture();switch(action){
      case'open':return open();
      case'open-run':return open(null,b.dataset.id);
      case'scope-window':scopeIds=[ctx.selected()||project().windows[0]?.id].filter(Boolean);currentRun=null;activeId='';return render();
      case'scope-scene':scopeIds=selectedScope();currentRun=null;activeId='';return render();
      case'scope-all':scopeIds=project().windows.map(w=>w.id);currentRun=null;activeId='';return render();
      case'discover':{models=(await P.wangp('/image-models')).models||[];if(!models.length)throw Error('No supported image preset found. Check the worker installation.');if(!config.modelType)config.modelType=models[0].model_type;return render();}
      case'connections':return ctx.connections();
      case'image-settings':return ctx.imageStudio();
      case'advanced':return ctx.scene().open('agent');
      case'launch':if(currentRun?.budgetState?.exhausted){$('.coverage-budget-status')?.scrollIntoView({block:'center',behavior:'smooth'});return;}if(currentRun?.candidateReview){$('.coverage-candidate-decision')?.scrollIntoView({block:'center',behavior:'smooth'});return;}return start(!!currentRun&&!TERMINAL.has(currentRun.status));
      case'start':return start();
      case'authorize':return start(true);
      case'apply':await apply(currentRun);return render();
      case'show-limits':$('#coverage-run-limits').open=true;$('#coverage-run-limits').scrollIntoView({block:'start',behavior:'smooth'});return;
      case'extend-window':{
        const x=currentRun?.budgetState;if(!x?.canExtend)throw Error('Refresh this safely parked run to review the allowance.');
        if(!await askConfirm(`Allow 20 image attempts TOTAL for this window (${x.attempts} already spent)? Earlier attempts and all run-wide limits remain. ${currentRun.candidateReview?'The current candidate still needs your decision.':'Continue the saved step without repeating completed windows.'}`))return;
        await P.call('reference-agent',{action:'extend-window',id:activeId,limit:20,budgetStamp:x.stamp,confirm:true,resume:true,planner:planner()});errors.delete(activeId);
        currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();schedule();return;
      }
      case'save-progress':return saveProgressCopy();
      case'progress-pack':return downloadProgressPack();
      case'projects':return ctx.projects();
      case'download-progress-project':{
        const saved=progressCopies.get(activeId),copy=saved&&Store.load(saved.id);if(!copy)throw Error('Save the progress copy first.');
        const portable=await Store.portable(copy);download('reference-progress-'+saved.checkpointId+'.h3project',new Blob([JSON.stringify(portable)],{type:'application/json'}));return;
      }
      case'approve-image':case'allow-here':case'confirm-coverage':return repair(action,Number(b.dataset.issue));
      case'field':if(currentRun)toast('This edits your live project, not the saved run. After editing, return here and choose Use my edited project instead.');return ctx.clinic.field(b.dataset.key);
      case'inspect-window':ctx.select(b.dataset.window);return ctx.scene().inspectWindow(b.dataset.window);
      case'label-image':{const i=issues()[Number(b.dataset.issue)];if(currentRun)toast('This edits the live library. To use those changes, return and choose Use my edited project instead.');return ctx.scene().labelImage(i.assetId);}
      case'open-ai':window.dispatchEvent(new CustomEvent('h3-open-ai',{detail:{id:b.dataset.id}}));return;
      case'retry-image':{
        const recovery=currentRun?.imageRecovery;if(!recovery)throw Error('Refresh this run to check the failed image job.');
        if(!await askConfirm('Retry this failed image request as ONE complete prompt? This requires the updated idle worker and uses one new image attempt. No planning request or completed window is repeated. The candidate will still be visually reviewed.'))return;
        await P.call('reference-agent',{action:'retry-image',id:activeId,planner:planner(),recoveryStamp:recovery.stamp,confirm:true});errors.delete(activeId);
        const a=window.H3Activity?.start('Retrying saved reference image');if(a)activities.set(activeId,a);
        currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();schedule();return;
      }
      case'retry-inspection':{
        const x=currentRun?.inspectionRecovery;if(!x||x.kind!=='repair')throw Error('Refresh this run before repairing its image inspection.');
        if(!await askConfirm('Recheck only unresolved images in this window? This makes one new AI request with actual image pixels, within the existing allowance. Already accepted rows, generated pictures and completed windows are preserved. No Qwen generation starts merely to repair this reply; the authorized workflow can continue afterward.'))return;
        await P.call('reference-agent',{action:'retry-inspection',id:activeId,planner:planner(),recoveryStamp:x.stamp,confirm:true});errors.delete(activeId);
        const a=window.H3Activity?.start('Rechecking image inspection');if(a)activities.set(activeId,a);
        currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();schedule();return;
      }
      case'retry-plan':{
        const recovery=currentRun?.planRecovery;if(recovery?.kind!=='repair')throw Error('Refresh this run to inspect the rejected planning step.');
        if(!await askConfirm('Request one new image plan for this blocked window, within the current AI allowance? The planner receives the validation error. Finished windows, accepted images, and the original response remain. Later generation/review continues under the existing policy.'))return;
        await P.call('reference-agent',{action:'retry-plan',id:activeId,planner:planner(),recoveryStamp:recovery.stamp,confirm:true});errors.delete(activeId);
        const a=window.H3Activity?.start('Repairing reference plan');if(a)activities.set(activeId,a);
        currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();schedule();return;
      }
      case'report':{const r=await P.call('reference-agent',{action:'result',id:activeId});return ctx.download('reference-coverage-'+r.id+'.json',new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));}
      case'reject-candidate':case'retry-candidate':{
        const x=currentRun?.candidateReview;if(!x)throw Error('Refresh this run to inspect the current candidate.');
        const draft=candidateDrafts.get(x.candidateId)||{prompt:x.prompt,reason:''};
        const retry=action==='retry-candidate';
        if(!await askConfirm(retry?`Reject this image and generate one replacement? ${x.requiresExtraAttempt?'Authorize ONE additional attempt for this window. ':''}Prior attempts, accepted pictures, and completed windows stay intact. Generation and visual review use the existing total allowance.`:'Reject this image and park the reference run? No new AI or GPU work will start; prior work is retained.'))return;
        const prompt=draft.prompt+(draft.reason.trim()?'\nUser correction for this attempt:\n'+draft.reason.trim():'');
        await P.call('reference-agent',{action,id:activeId,planner:planner(),candidateId:x.candidateId,candidateStamp:x.stamp,extraAttempt:retry&&x.requiresExtraAttempt,prompt,reason:draft.reason,confirm:true});errors.delete(activeId);
        if(retry){const a=window.H3Activity?.start('Retrying rejected candidate');if(a)activities.set(activeId,a);}
        currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});render();schedule();return;
      }
      case'fresh':{if(!await askConfirm('Cancel this parked reference workflow and prepare a new run from your current edited project? Completed images/history remain in the old run. No new AI or GPU request starts until you click Fill missing coverage.'))return;const old=activeId;await P.call('reference-agent',{action:'cancel',id:old});let r;for(let i=0;i<15;i++){r=await P.call('reference-agent',{action:'get',id:old});if(TERMINAL.has(r.status))break;await new Promise(resolve=>setTimeout(resolve,500));}if(!TERMINAL.has(r.status))throw Error('The old run is still cancelling. Wait and retry; no new request was submitted.');activeId='';currentRun=null;scopeIds=scopeIds.filter(id=>project().windows.some(w=>w.id===id));await loadRows();return render();}
      case'resume':case'pause':case'cancel':case'approve':{
        if(action==='approve'&&!await askConfirm('Approve the specific image request or displayed candidate, within this run’s existing budget?'))return;
        if(action==='cancel'&&!await askConfirm('Cancel only this reference run? Accepted sources and all video outputs are retained.'))return;
        await P.call('reference-agent',{action,id:activeId,planner:planner(),answer:$('#coverage-answer')?.value||answers.get(activeId),candidateId:currentRun?.pending?.candidateId,confirm:action==='approve'});
        errors.delete(activeId);currentRun=await P.call('reference-agent',{action:'diagnose',id:activeId});return render();
      }
    }
  }
  document.addEventListener('input',e=>{if(e.target.matches('[data-candidate-edit]')){const x=currentRun?.candidateReview;if(x){const draft=candidateDrafts.get(x.candidateId)||{prompt:x.prompt,reason:''};draft[e.target.dataset.candidateEdit]=e.target.value;candidateDrafts.set(x.candidateId,draft);}}if(e.target.matches('[data-coverage-config]'))capture();if(e.target.id==='coverage-answer'&&activeId)answers.set(activeId,e.target.value);});
  document.addEventListener('click',async e=>{const b=e.target.closest('[data-coverage]');if(!b)return;e.preventDefault();if(busy)return;busy=true;b.disabled=true;try{await click(b.dataset.coverage,b);}catch(err){toast(err.message,true);errors.set(activeId,err.message);}finally{busy=false;if(b.isConnected)b.disabled=false;}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
  schedule();return {open,poll,get busy(){return busy;},close(){stopped=true;clearTimeout(timer);}};
}};
