/* Narrow, review-first repair: only window.soundscape can be applied.
   No source audio, transcripts, file uploads, or WanGP calls in this workflow. */
window.H3SoundscapeUI = {create(ctx) {
  'use strict';
  const {$,esc,P,toast,openDialog,closeDialog,mutate}=ctx;
  const $$=s=>[...document.querySelectorAll(s)];
  let busy=false,abort=null;
  const button=(action,label,extra='')=>`<button data-soundscape-action="${action}" ${extra}>${label}</button>`;
  function unfinished(w) {return !H3.promptField('soundscape',w.soundscape).trim()||H3.hasEditorDefault(w.soundscape);}
  function show() {
    const p=ctx.project(),count=p.windows.filter(unfinished).length;
    openDialog('Repair soundscapes without rewriting the film',`
      <p class="info-note">Only <code>overall_soundscape</code> changes when you accept a draft. Your dialogue, visuals, cast, window lengths, overlap, music, voice bindings, and previous renders stay untouched.</p>
      <div class="subtle-box">${count} window${count===1?'':'s'} need a soundscape. Pacing proposals create timing/action outlines, not complete audio direction. Blank means unfinished; it does not mean silence.</div>
      <label>Windows to draft<select id="soundscape-scope">
        <option value="missing" ${count?'selected':''}>Only missing / helper-filled windows (${count})</option>
        <option value="selected" ${count?'':'selected'}>Selected window · ${esc(ctx.current()?.title||'none')}</option>
        <option value="all">All windows — propose replacements for existing soundscapes</option>
      </select></label>
      <p class="field-note">Uses your selected AI planner in batches of three. Text-only: the scene, casting and neighboring context are supplied. No reference recordings, source transcripts, images or video are sent. Existing dialogue blocks are withheld from this specialized request; the brief may still contain words you wrote.</p>
      <pre id="soundscape-status" class="status-log" aria-live="polite"></pre>
      <div class="dialog-actions">${button('cancel','Cancel request')}${button('generate','Draft soundscapes','class="primary"')}</div>
      <details class="extra-fields"><summary>Manual alternative — no extra background layer</summary>
        <p class="info-note">This explicitly keeps the speech and sounds already scripted in the detailed description, with no additional ambience/effects. It does not mute the video or erase existing dialogue. Review any contradictory prose.</p>
        ${button('scripted-missing','Use scripted sounds only for all unfinished windows')}
      </details>`, 'soundscapes');
  }
  async function generate() {
    if(busy||ctx.isBusy())throw Error('Finish the current planning/media operation first.');
    if(!P.config.model){ctx.showConnections();toast('Choose a planner model first.');return;}
    const project=ctx.project(),scope=$('#soundscape-scope').value;
    const selected=scope==='missing'?project.windows.filter(unfinished):scope==='selected'?[ctx.current()].filter(Boolean):project.windows.slice();
    if(!selected.length)throw Error('No windows in this selection need soundscapes.');
    if(!await askConfirm(`Ask ${P.config.provider} / ${P.config.model} to draft ${selected.length} soundscapes in ${Math.ceil(selected.length/3)} text-only request(s)? You will review the results before applying. Provider usage limits/charges apply.`))return;
    const snapshot=H3.clone(project),ids=selected.map(w=>w.id),variant={
      id:H3.uid(),kind:'soundscape',model:P.config.provider+' / '+P.config.model,createdAt:new Date().toISOString(),
      baseRevision:project.revision,status:'drafting',proposal:{windows:[]},raw:'',
      baseline:Object.fromEntries(selected.map(w=>[w.id,{soundscape:w.soundscape,context:H3.soundscapeContext(w)}]))
    };
    busy=true;abort=new AbortController();const raw=[];
    try {
      for(let start=0;start<ids.length;start+=3) {
        if(abort.signal.aborted)throw new DOMException('Cancelled','AbortError');
        if(P.config.provider+' / '+P.config.model!==variant.model)throw Error('Planner selection changed during the draft. No further requests were sent.');
        if($('#soundscape-status'))$('#soundscape-status').textContent=`Drafting soundscapes ${start+1}–${Math.min(start+3,ids.length)} of ${ids.length}…`;
        const batch=ids.slice(start,start+3).map(id=>snapshot.windows.find(w=>w.id===id));
        const response=await P.generate(H3.SOUNDSCAPE_SYSTEM,H3.soundscapePacket(snapshot,batch),[],abort.signal);
        raw.push(response);
        if(abort.signal.aborted)throw new DOMException('Cancelled','AbortError');
        const part=H3.parseSoundscapeProposal(response,batch.map(w=>w.id));
        variant.proposal.windows.push(...part.windows);
      }
      variant.status='ready';
    } catch(e) {
      variant.status=e.name==='AbortError'?'cancelled':'error';variant.error=e.message;
    } finally {
      busy=false;abort=null;variant.raw=raw.join('\n\n--- NEXT BATCH ---\n\n');
    }
    // Never write the result into a different project after an asynchronous call.
    if(ctx.project()!==project){toast('Project changed. No soundscape draft was applied or saved into the new project.',true);return;}
    mutate(()=>project.variants.push(variant));
    if(variant.proposal.windows.length)review(variant.id);
    else {if($('#soundscape-status'))$('#soundscape-status').textContent=variant.error||'No draft returned.';toast(variant.error||'No draft returned.',true);}
  }
  function review(id) {
    const v=ctx.project().variants.find(v=>v.id===id&&v.kind==='soundscape');
    if(!v)return;
    openDialog('Review soundscapes · '+v.model,`
      <p class="info-note">Only the checked soundscapes will change. Edit each proposal before accepting; the rest of the film is locked for this operation.</p>
      ${v.error?`<div class="warning-banner">${esc(v.error)} Completed drafts below are still available for review.</div>`:''}
      ${(v.proposal?.windows||[]).map(d=>{const w=ctx.project().windows.find(w=>w.id===d.id);return `<section class="dialog-section">
        <label class="checkrow"><input data-soundscape-keep="${esc(d.id)}" type="checkbox" ${w?'checked':'disabled'}><b>${esc(w?.title||'Removed window')}</b></label>
        <div class="dialog-grid"><div><div class="field-label">Current soundscape</div><p class="info-note">${esc(H3.promptField('soundscape',w?.soundscape)||'Unfinished')}</p></div>
        <label>Proposed soundscape<textarea data-soundscape-draft="${esc(d.id)}" class="soundscape-proposal">${esc(d.soundscape)}</textarea></label></div></section>`;}).join('')}
      <details><summary>Raw model response</summary><pre class="export-text">${esc(v.raw||'')}</pre></details>
      <div class="dialog-actions">${button('apply','Apply checked soundscapes',`class="primary" data-variant-id="${esc(id)}"`)}</div>`, 'soundscape-review');
  }
  function apply(id) {
    const p=ctx.project(),v=p.variants.find(v=>v.id===id&&v.kind==='soundscape');
    if(!v)throw Error('This soundscape proposal is no longer in the active project.');
    const ids=$$('[data-soundscape-keep]:checked').map(el=>el.dataset.soundscapeKeep);
    if(!ids.length)throw Error('Select at least one soundscape to apply.');
    const proposal=H3.parseSoundscapeProposal(JSON.stringify({windows:ids.map(id=>({id,soundscape:$(`[data-soundscape-draft="${id}"]`).value}))}),ids);
    // Validate all patches before committing any, so conflicts cannot partially apply.
    const patches=proposal.windows.map(d=>{
      const w=p.windows.find(w=>w.id===d.id),base=v.baseline?.[d.id];
      if(!w||!base)throw Error('A target window is no longer available. Draft again.');
      if(w.soundscape!==base.soundscape||H3.soundscapeContext(w)!==base.context)throw Error(`${w.title} changed since this draft. Nothing was applied; draft again from the current scene.`);
      return {w,d};
    });
    mutate(()=>{for(const {w,d} of patches){w.soundscape=d.soundscape;const saved=v.proposal.windows.find(x=>x.id===w.id);saved.soundscape=d.soundscape;}v.status='applied';v.appliedWindowIds=ids;});
    closeDialog();toast(`${patches.length} soundscape${patches.length===1?'':'s'} updated. Dialogue, cast, timing, music and renders are unchanged.`);
  }
  document.addEventListener('click',async e=>{
    const el=e.target.closest('[data-soundscape-action]');if(!el)return;
    try {
      const action=el.dataset.soundscapeAction;
      if(action==='cancel'){abort?.abort();return;}
      if(busy||ctx.isBusy())throw Error('Finish or cancel the current planning/media operation first.');
      if(action==='generate')await generate();
      else if(action==='apply')apply(el.dataset.variantId);
      else if(action==='scripted-missing'){
        const windows=ctx.project().windows.filter(unfinished);if(!windows.length)throw Error('No unfinished soundscapes.');
        if(!await askConfirm(`Set ${windows.length} unfinished soundscapes to keep only the sounds already scripted, without adding an ambient bed? Existing custom soundscapes and all other fields remain unchanged.`))return;
        mutate(()=>{for(const w of windows)w.soundscape=H3.SCRIPTED_SOUNDS_ONLY;});closeDialog();toast('Unfinished soundscapes now explicitly keep only scripted sounds.');
      }
    }catch(err){toast(err.message||String(err),true);}
  });
  return {show,review,get busy(){return busy;}};
}};
