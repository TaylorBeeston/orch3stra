#!/usr/bin/env node
/** Real HTTP/SSE and private disk state; no real provider/API key or GPU. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {mkdtemp, rm, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {streamChat} from '../ai-stream.mjs';
import {AIRequests, aiConfiguration} from '../ai-server.mjs';
import {createServer} from '../bridge.mjs';
const root = await mkdtemp(join(tmpdir(),'h3-ai-tests-'));
let count=0;
const test=async(name,fn)=>{await fn();count++;console.log('PASS '+name);};
async function until(fn){for(let i=0;i<200;i++){const x=await fn();if(x)return x;await delay(15);}throw Error('Test wait expired');}
async function close(server){await new Promise(resolve=>server.close(resolve));await server.ai?.close();}
const chunk=(text,finish=null,extra={})=>'data: '+JSON.stringify({id:'upstream-fixture',choices:[{delta:{content:text},finish_reason:finish}],...extra})+'\n\n';
let requests=0;
const fixture=http.createServer(async(req,res)=>{
 requests++;let text='';for await(const c of req)text+=c;
 const input=JSON.parse(text||'{}');
 const scenario=req.url;
 if(scenario==='/http-error'){res.writeHead(429,{'Content-Type':'application/json','Retry-After':'2'});res.end(JSON.stringify({error:{message:'fixture rate limit'}}));return;}
 if(scenario==='/idle'){return;}
 if(scenario==='/json'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'{"ok":true}'},finish_reason:'stop'}]}));return;}
 res.writeHead(200,{'Content-Type':'text/event-stream','x-request-id':'header-id'});res.flushHeaders();
 if(scenario==='/broken'){res.end(chunk('{"partial":'));return;}
 if(scenario==='/invalid'){res.end('data: {bad json}\n\n');return;}
 if(scenario==='/done-only'){res.end('data: [DONE]\n\n');return;}
 if(scenario==='/slow'){
   const t=setInterval(()=>res.write(': keep-alive\n\n'),20);res.on('close',()=>clearInterval(t));
   await delay(220);if(res.destroyed)return;clearInterval(t);
 }
 if(scenario==='/cancel'){
   res.write(chunk('{"partial":'));const t=setInterval(()=>res.write(': keep-alive\n\n'),20);res.on('close',()=>clearInterval(t));return;
 }
 const answer=scenario==='/length'?'{"unfinished":':'{"value":"café 🎥"}';
 const data=chunk(answer,scenario==='/length'?'length':'stop',scenario==='/usage-same'?{usage:{completion_tokens:9}}:{});
 // Split UTF-8 and CRLF arbitrarily, exercising the incremental decoder.
 const bytes=Buffer.from(data.replaceAll('\n','\r\n'));
 for(let i=0;i<bytes.length;i+=5)res.write(bytes.subarray(i,i+5));
 if(scenario==='/usage-separate')res.write('data: '+JSON.stringify({choices:[],usage:{completion_tokens:7}})+'\n\n');
 if(input.stream!==true||input.stream_options?.include_usage!==true){res.end('data: {"error":"stream not enabled"}\n\n');return;}
 res.write('data: [DONE]\n\n');
 if(scenario!=='/done-hold')res.end();
});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const url=path=>'http://127.0.0.1:'+fixture.address().port+path;
const run=(path,options={})=>streamChat({url:url(path),headers:{},body:{model:'fixture'},idleMs:500,connectMs:500,...options});
let manager,server;
try{
 await test('Timeout settings are explicit and invalid settings fail closed',()=>{assert.equal(aiConfiguration({}).timeoutMs,1200000);assert.equal(aiConfiguration({H3_AI_TIMEOUT_SECONDS:'60'}).timeoutMs,60000);assert.throws(()=>aiConfiguration({H3_AI_IDLE_SECONDS:'NaN'}));});
 await test('SSE handles arbitrary byte and CRLF boundaries, without corrupting Unicode',async()=>{assert.equal((await run('/ok')).choices[0].message.content,'{"value":"café 🎥"}');});
 await test('SSE keepalives prevent false idle timeouts without being model output',async()=>{const events=[];await run('/slow',{idleMs:90,progress:x=>events.push(x)});assert(events.some(e=>e.keepalive));assert(events.some(e=>e.phase==='waiting_for_headers'));assert(events.some(e=>e.httpStatus===200));});
 await test('Usage on the final content chunk is retained',async()=>{assert.equal((await run('/usage-same')).usage.completion_tokens,9);});
 await test('Older separate usage-only chunk is retained',async()=>{assert.equal((await run('/usage-separate')).usage.completion_tokens,7);});
 await test('DONE finishes without waiting for server to close an otherwise idle socket',async()=>{const r=await run('/done-hold',{idleMs:100});assert.equal(r.choices[0].finish_reason,'stop');});
 await test('HTTP rate limit preserves status and retry-after; never retries',async()=>{const n=requests;await assert.rejects(run('/http-error'),e=>e.code==='AI_HTTP_429'&&e.httpStatus===429&&e.retryAfter==='2');assert.equal(requests,n+1);});
 await test('Stalled headers report idle timeout, not generic fetch failed',async()=>{await assert.rejects(run('/idle',{idleMs:75}),e=>e.code==='AI_IDLE_TIMEOUT');});
 await test('Premature streaming EOF preserves partial output and fails closed',async()=>{const events=[];await assert.rejects(run('/broken',{progress:e=>events.push(e)}),e=>e.code==='AI_STREAM_INCOMPLETE');assert(events.some(e=>e.delta==='{"partial":'));});
 await test('Invalid SSE JSON and missing finish reason are rejected',async()=>{await assert.rejects(run('/invalid'),e=>e.code==='AI_STREAM_INVALID');await assert.rejects(run('/done-only'),e=>e.code==='AI_STREAM_INCOMPLETE');});
 await test('A non-streaming JSON reply remains compatible',async()=>{assert.equal((await run('/json')).choices[0].message.content,'{"ok":true}');});
 await test('Explicit cancellation stops receiving a streaming response',async()=>{const c=new AbortController();setTimeout(()=>c.abort(Object.assign(Error('test cancel'),{code:'AI_CANCELLED'})),60);await assert.rejects(run('/cancel',{signal:c.signal}),e=>e.code==='AI_CANCELLED');});
 const runner=(b,signal,progress)=>run(b.scenario||'/slow',{signal,progress});
 manager=new AIRequests(root,runner,{timeoutMs:1200,silent:true});await manager.ready;
 const input={requestId:'request-1',provider:'deepseek',model:'fixture',projectId:'p1',kind:'pacing',key:'PRIVATE_API_KEY_FIXTURE',system:'Only JSON',prompt:'A fictional story',context:{options:{},storyPacket:{task:'fixture'}},images:[]};
 await test('Durable acceptance returns before provider finishes',async()=>{const before=Date.now();const j=await manager.start(input);assert(['accepted','running'].includes(j.status));assert(Date.now()-before<200);assert(await stat(join(root,'ai-requests','request-1.json')));});
 await test('Same request ID is idempotent; changed input or duplicate pacing does not bill again',async()=>{const n=requests;await manager.start(input);await assert.rejects(manager.start({...input,prompt:'changed'}),e=>e.status===409);await assert.rejects(manager.start({...input,requestId:'request-other'}),e=>e.status===409&&e.aiRequestId==='request-1');assert.equal(requests,n);});
 await test('Background request completes without any browser polling',async()=>{await delay(350);const j=manager.get('request-1');assert.equal(j.status,'completed');assert(j.text.includes('café'));});
 await test('Stored request has no key or media data; terminal log contains no prose',async()=>{await manager.writes;const disk=await readFile(join(root,'ai-requests','request-1.json'),'utf8');assert(!disk.includes(input.key));assert(disk.includes('A fictional story'));const log=await readFile(join(root,'ai-requests.log'),'utf8');assert(!log.includes('A fictional story'));assert(!log.includes(input.key));assert(!log.includes('café'));assert.equal((await stat(join(root,'ai-requests','request-1.json'))).mode&0o077,0);});
 await test('Transport errors redact echoed credentials, while partial output survives',async()=>{const bad=new AIRequests(join(root,'secret'),async(b,s,p)=>{p({delta:'private '+b.key});throw Error('provider echoed '+b.key);},{silent:true});await bad.ready;await bad.start({...input,requestId:'redact'});await until(()=>bad.get('redact').status==='error');const j=(await bad.handle({action:'get',id:'redact',detail:true})).job;assert(!JSON.stringify(j).includes(input.key));assert(j.text.includes('[credential omitted]'));await bad.close();});
 await test('Output-length cutoff is distinct from malformed JSON and retains all partial text',async()=>{await manager.start({...input,requestId:'length',scenario:'/length'});await until(()=>manager.get('length').status==='error');const j=manager.get('length');assert.equal(j.errorCode,'AI_OUTPUT_LIMIT');assert.equal(j.text,'{"unfinished":');});
 await test('Total deadline still fires while provider sends keepalives',async()=>{const limited=new AIRequests(join(root,'limited'),runner,{timeoutMs:140,silent:true});await limited.ready;await limited.start({...input,requestId:'deadline',scenario:'/cancel'});await until(()=>limited.get('deadline').status==='timed_out');assert.equal(limited.get('deadline').errorCode,'AI_TOTAL_TIMEOUT');assert(limited.get('deadline').text);await limited.close();});
 await test('User cancellation is explicit and durable',async()=>{await manager.start({...input,requestId:'cancel-me',scenario:'/cancel'});await delay(50);const j=await manager.cancel('cancel-me');assert.equal(j.status,'cancelled');assert.equal(j.errorCode,'AI_CANCELLED');});
 await test('Node/service restart recovers completed records and marks unfinished work interrupted without retry',async()=>{await manager.close();const record=JSON.parse(await readFile(join(root,'ai-requests','request-1.json'),'utf8'));await writeFile(join(root,'ai-requests','crashed.json'),JSON.stringify({...record,id:'crashed',status:'running',phase:'streaming',finishedAt:null}));const n=requests;manager=new AIRequests(root,runner,{silent:true});await manager.ready;assert.equal(manager.get('request-1').status,'completed');assert.equal(manager.get('crashed').status,'interrupted');assert.equal(requests,n);});
 await test('Reference-image plans keep their distinct request kind and recovery context',async()=>{await manager.start({...input,requestId:'image-plan-kind',kind:'reference-images',context:{planId:'plan-one'},scenario:'/ok'});await until(()=>manager.get('image-plan-kind').status==='completed');const j=(await manager.handle({action:'get',id:'image-plan-kind',detail:true})).job;assert.equal(j.kind,'reference-images');assert.equal(j.context.planId,'plan-one');});
 await test('Private record download includes input, output and timestamped phase log',async()=>{const j=(await manager.handle({action:'get',id:'request-1',detail:true})).job;assert.equal(j.request.prompt,'A fictional story');assert(j.events.some(e=>e.phase==='waiting_for_output'));assert(j.context.storyPacket);});
 await test('Provider completion and creative validation are separate states',async()=>{await manager.handle({action:'validation',id:'request-1',status:'invalid',message:'Missing locked dialogue'});assert.equal(manager.get('request-1').status,'completed');assert.equal(manager.get('request-1').validation.status,'invalid');});
 // Exercise the actual bridge security boundary + browser disconnect + recovery.
 server=createServer({port:0,host:'0.0.0.0',studioPassword:'fixture-pair-password',dataDir:join(root,'bridge'),aiOptions:{runner,silent:true},backendOptions:{mode:'legacy'}});await new Promise(r=>server.listen(0,'127.0.0.1',r));await server.ready;
 const base='http://127.0.0.1:'+server.address().port;
 const pair=await fetch(base+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'fixture-pair-password'})});
 const cookie=pair.headers.get('set-cookie').split(';')[0];
 const health=await(await fetch(base+'/api/health',{headers:{Cookie:cookie}})).json();
 const post=(b,extra={})=>fetch(base+'/api/ai',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-H3-Token':health.token,...extra},body:JSON.stringify(b)});
 await test('New AI endpoints require studio pairing, CSRF and allowed origin',async()=>{assert(health.ai_requests);assert.equal((await fetch(base+'/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);assert.equal((await post({action:'list'},{'X-H3-Token':'bad'})).status,403);assert.equal((await post({action:'list'},{Origin:'https://evil.invalid'})).status,403);});
 await test('HTTP start responds 202; later requests recover result and never resubmit',async()=>{const n=requests;const r=await post({action:'start',request:{...input,requestId:'http-request'}});assert.equal(r.status,202);await delay(300);const j=(await(await post({action:'get',id:'http-request',detail:true})).json()).job;assert.equal(j.status,'completed');assert.equal(requests,n+1);});
 await test('HTTP structured errors identify the existing active pacing request',async()=>{await post({action:'start',request:{...input,requestId:'http-active',scenario:'/cancel'}});const r=await post({action:'start',request:{...input,requestId:'http-duplicate'}});assert.equal(r.status,409);assert.equal((await r.json()).aiRequestId,'http-active');await post({action:'cancel',id:'http-active'});});
 await test('Graceful Node shutdown interrupts AI work but does not restart renderer',async()=>{await post({action:'start',request:{...input,requestId:'http-stop',scenario:'/cancel'}});await close(server);server=null;const disk=JSON.parse(await readFile(join(root,'bridge','ai-requests','http-stop.json'),'utf8'));assert.equal(disk.status,'interrupted');assert.equal(disk.errorCode,'AI_SERVER_STOPPED');});
 console.log(`\n${count} AI request checks passed. Real local HTTP/SSE/disk; no live provider or GPU.`);
}finally{if(server)await close(server);await manager?.close();fixture.closeAllConnections();await close(fixture);await rm(root,{recursive:true,force:true});}
