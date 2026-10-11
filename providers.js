/* Browser adapters. The optional bridge uses official Codex app-server,
   OpenCode HTTP, and vendor APIs; it does NOT extract OAuth tokens. */
window.DirectorProviders=(()=>{
  const GO={
    'gpt-5.6-luna':'responses','grok-4.6':'responses','muse-spark-1.3-contributor':'responses','muse-spark-1.2-contributor':'responses',
    'glm-5.3-flash':'chat','glm-5.3':'chat','glm-5.2':'chat','glm-5.1':'chat','kimi-k3':'chat','kimi-k2.7-code':'chat','kimi-k2.6':'chat','longcat-2.0':'chat','deepseek-v4.1-flash':'chat','deepseek-v4-pro':'chat','deepseek-v4-flash':'chat','deepseek-v4-flash-vision-exp':'chat','mimo-v2.5':'chat','mimo-v2.5-pro':'chat',
    'minimax-m3':'messages','minimax-m2.7':'messages','minimax-m2.5':'messages','qwen3.8-max':'messages'
  };
  let token=null,bridge=false,renderProgressAvailable=false,aiAvailable=false,lastAIRequestId=null,backend={mode:"legacy",browser_required:true};
  const secrets={deepseek:'',go:'',opencode:'',wangp:'',huggingface:''};
  try{const saved=JSON.parse(localStorage.getItem('h3-director:remembered:v1')||'{}');for(const k of ['wangp','huggingface'])secrets[k]=String(saved[k]||'');}catch{}
  let config={batchSize:1,provider:'codex',model:'',protocol:'auto',images:true,videoSamples:3,opencodeUrl:'http://127.0.0.1:4096',opencodeUsername:'opencode',wangpUrl:'http://127.0.0.1:7867'};
  try{config={...config,...JSON.parse(localStorage.getItem('h3-director:connections:v1')||'{}')};}catch{}
  const remember=async()=>{localStorage.setItem('h3-director:remembered:v1',JSON.stringify({wangp:secrets.wangp,huggingface:secrets.huggingface}));if(bridge)await call('studio',{action:'save-credentials',credentials:{wangp:secrets.wangp,huggingface:secrets.huggingface,wangpUrl:config.wangpUrl}});};
  const persist=()=>{localStorage.setItem('h3-director:connections:v1',JSON.stringify(config));remember().catch(e=>window.dispatchEvent(new CustomEvent('h3-notice',{detail:{message:e.message,error:true}})));};
  async function readResponse(r){const text=await r.text();let value;try{value=JSON.parse(text);}catch{value={error:text.slice(0,1200)||r.statusText};}if(!r.ok){const e=Error(typeof value.error==='string'?value.error:value.error?.message||`HTTP ${r.status}: ${text.slice(0,500)}`);e.status=r.status;e.code=value.code;e.aiRequestId=value.aiRequestId;throw e;}return value;}
  async function init(){if(location.protocol==='file:')return false;try{const r=await fetch('/api/health',{signal:AbortSignal.timeout(1800)});if(!r.ok)return false;const info=await r.json();if(info.app==='h3-director-bridge'&&info.token){token=info.token;bridge=true;renderProgressAvailable=info.render_progress===true;aiAvailable=info.ai_requests===true;backend=info.wangp_backend||backend;try{const d=await call('studio',{action:'credentials'});for(const k of ['wangp','huggingface'])if(typeof d.credentials?.[k]==='string')secrets[k]=d.credentials[k];if(d.credentials?.wangpUrl)config.wangpUrl=d.credentials.wangpUrl;}catch{}return true;}}catch{}return false;}
  async function call(path,body,signal){if(!bridge)throw Error('This connection needs the local bridge. Run: node bridge.mjs, then use the URL printed in your terminal.');return readResponse(await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-H3-Token':token},body:JSON.stringify(body),signal}));}
  function protocol(){return config.protocol==='auto'?(GO[config.model]||'chat'):config.protocol;}
  function vendorRequest(system,prompt,images){const model=config.model;if(!model)throw Error('Choose a model in Connections first.');const wire=config.provider==='deepseek'?'chat':protocol();const base=config.provider==='deepseek'?'https://api.deepseek.com':'https://opencode.ai/zen/go/v1';const headers={Authorization:'Bearer '+secrets[config.provider],'Content-Type':'application/json'};
    let path,body;
    if(wire==='responses'){path='/responses';body={model,instructions:system,input:[{role:'user',content:[{type:'input_text',text:prompt},...images.map(i=>({type:'input_image',image_url:i.url}))]}],max_output_tokens:24000};}
    else if(wire==='messages'){path='/messages';headers['anthropic-version']='2023-06-01';headers['x-api-key']=secrets[config.provider];body={model,system,max_tokens:24000,messages:[{role:'user',content:[{type:'text',text:prompt},...images.map(i=>{const match=i.url.match(/^data:([^;]+);base64,(.*)$/s);if(!match)throw Error('Image must be a data URL.');return{type:'image',source:{type:'base64',media_type:match[1],data:match[2]}};})]}]};}
    else{path='/chat/completions';body={model,messages:[{role:'system',content:system},{role:'user',content:images.length?[{type:'text',text:prompt},...images.map(i=>({type:'image_url',image_url:{url:i.url}}))]:prompt}],max_tokens:24000};if(config.provider==='deepseek'){body.response_format={type:'json_object'};body.thinking={type:'disabled'};}}
    return{url:base+path,headers,body};
  }
  function extract(data){if(typeof data.text==='string')return data.text;if(typeof data.output_text==='string')return data.output_text;if(data.choices?.[0]?.message?.content)return data.choices[0].message.content;if(Array.isArray(data.output))return data.output.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');if(Array.isArray(data.content))return data.content.filter(x=>x.type==='text').map(x=>x.text).join('\n');throw Error('The provider returned no assistant text. Check model, authentication, and output limits.');}
  async function models(){if(config.provider==='go')return Object.keys(GO).map(id=>({id,label:id+' · '+GO[id],protocol:GO[id]}));if(bridge)return(await call('models',{provider:config.provider,key:secrets[config.provider],opencodeUrl:config.opencodeUrl,opencodeUsername:config.opencodeUsername})).models;if(config.provider==='deepseek'){if(!secrets.deepseek)throw Error('Enter your DeepSeek API key.');const d=await readResponse(await fetch('https://api.deepseek.com/models',{headers:{Authorization:'Bearer '+secrets.deepseek},signal:AbortSignal.timeout(30000)}));return d.data.map(x=>({id:x.id,label:x.id}));}throw Error('Start the local bridge to discover your signed-in Codex or OpenCode models.');}
  async function saveTrace(trace){
    try{const cleaned=window.H3Studio?H3Studio.redact(trace):trace;await DirectorStore.putBlob('trace:'+trace.id,new Blob([JSON.stringify(cleaned)],{type:'application/json'}));window.dispatchEvent(new CustomEvent('h3-trace',{detail:{id:trace.id,projectId:trace.projectId}}));}
    catch(e){window.dispatchEvent(new CustomEvent('h3-notice',{detail:{message:'Diagnostic trace could not be saved: '+e.message,error:true}}));}
  }
  function elapsed(seconds){const n=Math.max(0,Math.floor(seconds||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function describeAI(job){
    const phases={accepted:'Accepted by Director',connecting:'Connecting to provider',waiting_for_headers:'Connected; waiting for HTTP response',waiting_for_output:'Waiting for first output',streaming:'Receiving output',completed:'Response received',timed_out:'Timed out',error:'Request failed',cancelled:'Cancelled',interrupted:'Interrupted'};
    const age=job.secondsSinceData==null?'no response data yet':`last network data ${Math.floor(job.secondsSinceData)}s ago`;
    return `${phases[job.phase]||job.phase} · ${elapsed(job.elapsedSeconds)} elapsed · ${(job.outputCharacters||0).toLocaleString()} output characters · ${age}`;
  }
  async function ai(body,signal){return call('ai',body,signal||AbortSignal.timeout(15000));}
  function pause(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(signal.reason);return;}const stop=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);reject(signal.reason);};const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);signal?.addEventListener('abort',stop,{once:true});});}
  async function awaitAI(request,signal,notify){
    const id=request.requestId;let current;
    try{current=(await ai({action:'start',request},signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):undefined)).job;}
    catch(e){
      if(signal?.aborted)throw e;
      // A lost acceptance response is recovered read-only, never by resubmission.
      if(e.status)throw e;
      try{current=(await ai({action:'get',id})).job;}catch{
        throw Object.assign(Error('Could not confirm AI request acceptance. Open AI requests and reconnect before retrying; the server may still be working. Request '+id),{aiRequestId:id,requestMayContinue:true});
      }
    }
    let offlineSince=0;
    while(true){
      if(signal?.aborted)throw signal.reason;
      notify(current);
      if(!['accepted','running'].includes(current.status)){
        if(current.status==='completed')return current;
        throw Object.assign(Error(`${current.error||current.status} Request ${id}. Open AI requests for the event log and partial output.`),{code:current.errorCode,aiRequestId:id,partial:current.partialPreview||'',job:current});
      }
      await pause(1200,signal);
      try{current=(await ai({action:'get',id},signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):undefined)).job;offlineSince=0;}
      catch(e){
        if(signal?.aborted)throw e;
        if(e.status===401||e.status===403)throw Object.assign(Error('Director connection needs pairing or a page refresh. The AI request may continue; reopen AI requests to recover it. Request '+id),{aiRequestId:id,requestMayContinue:true});
        offlineSince ||= Date.now();
        window.dispatchEvent(new CustomEvent('h3-ai-offline',{detail:{id,message:'Connection lost; the server may still be planning. Reconnecting…'}}));
        if(Date.now()-offlineSince>60000)throw Object.assign(Error('Cannot reach the AI request monitor. The request may continue on the server. Reopen AI requests before retrying. Request '+id),{aiRequestId:id,requestMayContinue:true});
        await pause(2500,signal);
      }
    }
  }
  async function generate(system,packet,images,signal,meta={}){
    const prompt=JSON.stringify(packet,null,2)+'\n\nAttached visual samples (in attachment order):\n'+(images.map((x,i)=>`${i+1}: ${x.label}`).join('\n')||'None. Rely only on supplied descriptions; do not claim visual inspection.');
    const id=H3.uid(),projectId=packet.projectId||window.DirectorApp?.getProject()?.id;
    const kind=meta.kind||(packet.responseShape?.beats?'pacing':system===H3.SOUNDSCAPE_SYSTEM?'soundscapes':'draft');
    const trace={id,projectId,kind,provider:config.provider,model:config.model,effort:config.provider==='codex'?(config.reasoningEffort||undefined):undefined,protocol:protocol(),system,prompt,images:images.map(x=>({label:x.label,attached:true})),startedAt:new Date().toISOString(),status:'running'};
    const local=new AbortController(),combined=signal?AbortSignal.any([signal,local.signal]):local.signal;
    let inspectId=id;
    const activity=window.H3Activity?.start((kind==='pacing'?'Natural runtime':'AI planner')+' · '+config.model,{cancel:()=>local.abort(),details:()=>window.dispatchEvent(new CustomEvent('h3-open-ai',{detail:{id:inspectId}}))});
    let serverRequest=false,lastTrace=0;
    const show=job=>{trace.live=job;activity?.update(describeAI(job));meta.onProgress?.(job);window.dispatchEvent(new CustomEvent('h3-ai-progress',{detail:job}));if(Date.now()-lastTrace>5000){lastTrace=Date.now();saveTrace(trace);}};
    try{
      let data;
      if(bridge&&aiAvailable){
        serverRequest=true;lastAIRequestId=id;trace.aiRequestId=id;await saveTrace(trace);meta.onRequest?.(id);
        const job=await awaitAI({requestId:id,projectId,kind,context:meta.context||{},provider:config.provider,model:config.model,effort:config.provider==='codex'?(config.reasoningEffort||undefined):undefined,protocol:protocol(),key:secrets[config.provider],opencodeUrl:config.opencodeUrl,opencodeUsername:config.opencodeUsername,system,prompt,images},combined,show);
        trace.finishReason=job.finishReason;trace.usage=job.usage;trace.requestId=job.providerRequestId;trace.raw=job.text;data={text:job.text};
      }else if(bridge)data=await call('generate',{provider:config.provider,model:config.model,effort:config.provider==='codex'?(config.reasoningEffort||undefined):undefined,protocol:protocol(),key:secrets[config.provider],opencodeUrl:config.opencodeUrl,opencodeUsername:config.opencodeUsername,system,prompt,images},combined);
      else{if(['codex','opencode'].includes(config.provider))throw Error('Codex subscriptions and OpenCode sessions require the local bridge.');if(!secrets[config.provider])throw Error('Enter the provider API key in Connections.');const req=vendorRequest(system,prompt,images);data=await readResponse(await fetch(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(req.body),signal:combined}));}
      trace.finishReason ||= data.choices?.[0]?.finish_reason||data.status||null;trace.usage ||= data.usage||null;trace.requestId ||= data.id||null;trace.raw=extract(data);
      if(trace.finishReason==='length'||data.status==='incomplete')throw Error('The provider truncated its response at the output limit. '+(kind==='pacing'?'Simplify the story or use optional duration bounds.':'Use a one-window batch or simplify the request.')+' Raw output and finish reason are in diagnostics; no automatic paid retry was made.');
      trace.status='completed';activity?.done('Planner response received · validate and review before applying');return trace.raw;
    }catch(e){
      if(combined.aborted&&serverRequest){
        try{const r=await ai({action:'cancel',id});trace.live=r.job;}
        catch{e=Object.assign(Error('Cancellation could not be confirmed. The request may still be running; inspect AI requests before retrying. Request '+id),{aiRequestId:id,requestMayContinue:true});}
      }
      if(!(e instanceof Error))e=Error(String(e));
      e.aiRequestId ||= serverRequest?id:null;
      if(e.aiRequestId){inspectId=e.aiRequestId;trace.aiRequestId=e.aiRequestId;lastAIRequestId=e.aiRequestId;}
      trace.status=e.requestMayContinue?'disconnected':combined.aborted?'cancelled':'error';trace.error=e.message;trace.errorCode=e.code||null;
      if(e.job)trace.live=e.job;if(e.partial)trace.raw=e.partial;
      activity?.fail(e.message);throw e;
    }finally{trace.finishedAt=new Date().toISOString();await saveTrace(trace);}
  }
  async function wangp(path,method='GET',body,intent=null){const base=config.wangpUrl.replace(/\/+$/,'');if(bridge)return call('wangp',{url:base,path,method,body,token:secrets.wangp,intent:intent?{id:intent.id,lease:intent.lease}:undefined,renderMode:body?.snapshot?.mode||intent?.mode});try{return readResponse(await fetch(base+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+secrets.wangp},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)}));}catch(e){if(e instanceof TypeError)throw Error('Cannot reach the Orch3stra WanGP adapter. Check its URL/token, enable the plugin, and use the local bridge for CORS or mixed-content issues.');throw e;}}
  async function upload(asset,blob){if(asset.generationExcluded===true)throw Error('Excluded from generation: '+asset.name+'. Reactivate in Subjects & images or remove this selection.');const query='?filename='+encodeURIComponent(asset.name);if(bridge)return readResponse(await fetch('/api/wangp-upload'+query,{method:'POST',headers:{'X-H3-Token':token,'X-WanGP-URL':config.wangpUrl,'X-WanGP-Token':secrets.wangp,'Content-Type':blob.type||'application/octet-stream'},body:blob}));return readResponse(await fetch(config.wangpUrl.replace(/\/+$/,'')+'/upload'+query,{method:'POST',headers:{Authorization:'Bearer '+secrets.wangp,'Content-Type':blob.type||'application/octet-stream'},body:blob}));}
  async function mediaURL(jobId,outputId){if(!bridge)await init();if(String(jobId).startsWith('finish_'))return '/api/finish-media/'+encodeURIComponent(jobId);if(jobId.startsWith('seq_'))return '/api/studio-media/'+encodeURIComponent(outputId);if(!bridge)throw Error('Timeline playback requires the local Node bridge. Use WanGP’s gallery when running only the static editor.');const r=await call('media-ticket',{url:config.wangpUrl,token:secrets.wangp,jobId,outputId});return r.url;}
  async function uploadVoice(blob,name){if(!bridge)throw Error('Voice processing needs the included Node bridge.');return readResponse(await fetch('/api/voice-upload?filename='+encodeURIComponent(name),{method:'POST',headers:{'X-H3-Token':token,'Content-Type':blob.type||'application/octet-stream'},body:blob}));}
  async function studioBlob(key,blob){if(!bridge)throw Error('Shared media requires the Node bridge.');return readResponse(await fetch('/api/studio-blob?key='+encodeURIComponent(key),{method:'POST',headers:{'X-H3-Token':token,'Content-Type':blob.type||'application/octet-stream'},body:blob}));}
  async function getStudioBlob(key){const r=await fetch('/api/studio-blob?key='+encodeURIComponent(key));if(!r.ok)throw Error('Shared media unavailable: '+key);return r.blob();}
  return{get renderProgressAvailable(){return renderProgressAvailable;},ai,describeAI,config,secrets,saveTrace,remember,studioBlob,getStudioBlob,uploadVoice,persist,init,models,generate,wangp,upload,mediaURL,call,extract,GO,get aiAvailable(){return aiAvailable;},get lastAIRequestId(){return lastAIRequestId;},get bridge(){return bridge;},get headless(){return backend.mode==='headless';},get backend(){return backend;}};
})();
