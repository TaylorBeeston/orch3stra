/** One coalesced, read-only studio snapshot shared by every paired device. */
export class RenderProgress {
  constructor(sequences,{ttl=1500,now=Date.now}={}){this.sequences=sequences;this.ttl=ttl;this.now=now;this.pending=null;this.cached=null;this.jobs=new Map();}
  async snapshot(){if(this.pending)return this.pending;if(this.cached&&this.now()-this.cached.receivedAt<this.ttl)return this.cached.value;this.pending=this.collect().then(value=>{this.cached={value,receivedAt:this.now()};return value;}).finally(()=>this.pending=null);return this.pending;}
  async collect(){
    const c=this.sequences;await c.ready;
    const [manager,health]=await Promise.all([c.manager(),c.backendMode==='headless'?c.api({backendMode:c.backendMode},'/health').catch(e=>({runtime_state:'unavailable',error:e.message})):Promise.resolve({runtime_state:'legacy',note:'Legacy backend requires its browser.'})]);
    const jobs=new Map();for(const [id,o]of c.observations){const r=c.runs.get(id);if(r&&!c.backendMismatch(r)&&o.reachable&&o.job)jobs.set(o.job.job_id,o.job);}
    const list=manager.queue.jobs||[],ids=[...new Set([...list.filter(j=>!['completed','cancelled','failed'].includes(j.status)).map(j=>j.job_id),...list.filter(j=>['completed','cancelled','failed'].includes(j.status)).slice(0,6).map(j=>j.job_id)])];
    await Promise.all(ids.filter(id=>!jobs.has(id)).map(async id=>{
      const cached=this.jobs.get(id);if(cached&&this.now()-cached.at<30000){jobs.set(id,cached.job);return;}
      try{const job=await c.api({backendMode:c.backendMode},'/jobs/'+encodeURIComponent(id));jobs.set(id,job);if(['completed','cancelled','failed'].includes(job.status))this.jobs.set(id,{job,at:this.now()});}
      catch(e){jobs.set(id,{...list.find(j=>j.job_id===id),observation_error:e.message});}
    }));
    for(const [id,v]of this.jobs)if(this.now()-v.at>60000)this.jobs.delete(id);
    const sequences=manager.runs.map(row=>{const r=c.runs.get(row.id),o=c.observations.get(row.id);const live=c.public({...r,native:!row.backend.mismatch&&o?.reachable&&o.job?o.job:r.native}).live;return{...row,plan:r.plan,live,liveVerified:!row.backend.mismatch&&(row.observed?.reachable||['completed','cancelled','failed','retired'].includes(row.status)),timingAdjustments:r.timingAdjustments||[]};});
    const referenceAgents=c.referenceAgent?[...c.referenceAgent.runs.values()].filter(r=>!['completed','cancelled','failed'].includes(r.status)).map(r=>c.referenceAgent.view(r)):[];
    const active=referenceAgents.some(r=>r.status==='running'||r.status==='cancelling')||sequences.some(r=>r.status==='running'||r.status==='cancelling')||list.some(j=>!['completed','cancelled','failed'].includes(j.status));
    return{version:1,checkedAt:new Date(this.now()).toISOString(),backend:c.backendMode,referenceAgents,health,queue:manager.queue,sequences,nativeJobs:[...jobs.values()],canSubmitManaged:manager.canSubmitManaged,explanation:manager.explanation,nextPollMs:active?2000:8000};
  }
}
