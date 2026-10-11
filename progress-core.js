/* Pure, observation-only render summaries. Time estimates are ranges, never progress events. */
(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.H3Progress=api;})(globalThis,function(){
  'use strict';
  const terminal=new Set(['completed','cancelled','failed','retired']);
  const finite=n=>typeof n==='number'&&Number.isFinite(n);
  const median=a=>{a=a.slice().sort((a,b)=>a-b);return a.length%2?a[a.length>>1]:(a[a.length/2-1]+a[a.length/2])/2;};
  function range(values,uncertainty=.55){values=values.filter(x=>finite(x)&&x>0).slice(-8);if(!values.length)return null;const seconds=median(values),spread=Math.max(seconds*uncertainty,median(values.map(x=>Math.abs(x-seconds)))*2);return{seconds,low:Math.max(0,seconds-spread),high:seconds+spread,samples:values.length,confidence:values.length<3?'early':'observed-range'};}
  function remaining(r,elapsed){if(!r||!finite(elapsed)||elapsed>=r.high)return null;return{...r,...Object.fromEntries(['seconds','low','high'].map(k=>[k,Math.max(0,r[k]-Math.max(0,elapsed))]))};}
  function sumRanges(a){return a.length&&a.every(Boolean)?{...Object.fromEntries(['seconds','low','high'].map(k=>[k,a.reduce((n,r)=>n+r[k],0)])),samples:Math.min(...a.map(r=>r.samples||1)),confidence:'rough whole-film range'}:null;}
  function managedTelemetry(r,native=r.native,now=Date.now()){
    const source=native?.telemetry||{},current=source.current?JSON.parse(JSON.stringify(source.current)):null;
    const samples=(r.timingSamples||[]).filter(s=>finite(s.seconds)&&s.seconds>0&&s.span>0);
    const index=Math.min(r.index,r.plan.length),finished=terminal.has(r.status),end=finished?Date.parse(r.finishedAt||r.updatedAt||r.createdAt):now;
    let c=current&&index<r.plan.length?{...current,...r.plan[index],window_index:index+1}:null;
    const windows=r.plan.map((w,i)=>i===index&&c?c:{...w,window_index:i+1,status:i<index?'completed':'pending',phase:i<index?'saved':'pending',elapsed_seconds:samples.find(s=>s.index===i)?.nativeElapsed??null});
    const row=r.plan[index],estimateFor=w=>range(samples.filter(s=>w.span/s.span>=.5&&w.span/s.span<=2).map(s=>s.seconds*Math.pow(w.span/s.span,1.3)),samples.length<3?.8:.6);
    let currentEta=null;
    const active=r.status==='running'&&!r.cancelRequested&&!r.pauseAfterWindow;
    if(c&&active){
      const learned=estimateFor(row),elapsed=Math.max(0,(r.prepareSeconds||0)+(source.generation_elapsed_seconds||0)-(c.phase_seconds?.loading_model||0));
      currentEta=c.window_eta||remaining(learned,elapsed);
      // A whole window cannot finish before its remaining denoising. Keep both
      // ranges ordered when a coarse whole-window model is temporarily optimistic.
      if(currentEta&&c.phase==='inference'&&c.denoising_eta)currentEta={...currentEta,...Object.fromEntries(['seconds','low','high'].map(k=>[k,Math.max(currentEta[k],c.denoising_eta[k])]))};
      // A step taking longer than the observed range is not a reliable finish estimate.
      if(c.estimate_overdue)currentEta=null;
      c.window_eta=currentEta;
    }
    const future=index<r.plan.length?r.plan.slice(index+1).map(estimateFor):[];
    const totalEta=active&&c&&currentEta?sumRanges([currentEta,...future]):null;
    const rendering=samples.reduce((n,s)=>n+(s.nativeElapsed||0),0)+(finite(source.generation_elapsed_seconds)&&index<r.plan.length?source.generation_elapsed_seconds:0);
    return {...source,version:2,observed_at:now/1000,status:r.status,elapsed_seconds:Math.max(0,(end-Date.parse(r.createdAt))/1000),generation_elapsed_seconds:rendering||null,
      current:c,windows,complete_windows:index,total_eta:totalEta,queue_wait_seconds:source.queue_wait_seconds??null,
      eta_note:samples.length?'Rough range from completed windows in this sequence; durations are coarsely scaled. Reference changes, loading/offload, prefix I/O and pauses can change the cost. Not a deadline.':'Learning full-window cost. Step ETA may appear first; whole-film ETA waits for a saved, timed window.',
      saved_windows:index,estimate_samples:samples.length,estimate_status:finished?'finished':r.cancelRequested?'cancelling':r.status!=='running'||r.pauseAfterWindow?'paused / stopping':totalEta?'estimated':samples.length?'recalibrating':'learning'};
  }
  function terminalOutcome(status){return ({completed:'Finished',failed:'Failed — not completed',cancelled:'Cancelled — not completed',retired:'Tracking retired'})[status]||null;}
  function formatTime(n){if(!finite(n))return '—';n=Math.max(0,Math.round(n));return(n>=3600?Math.floor(n/3600)+'h ':'')+(n>=60?Math.floor(n/60)%60+'m ':'')+n%60+'s';}
  function formatRange(r){return r&&finite(r.low)&&finite(r.high)?formatTime(r.low)+'–'+formatTime(r.high):'Learning / recalibrating';}
  return{terminal,terminalOutcome,finite,range,remaining,sumRanges,managedTelemetry,formatTime,formatRange};
});
