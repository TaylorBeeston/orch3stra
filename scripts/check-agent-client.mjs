import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentClient} from '../agent-client.mjs';

// The external HTTP boundary deliberately loses an accepted mutation's response.
// These tests assert admission, non-replay, review stopping and file preservation.
const tmp=await mkdtemp(join(tmpdir(),'orch3stra-agent-client-'));
const received=[];let plannerStarts=0;
const bytes=Buffer.from('owned-media-proof');
const server=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  const input=body?JSON.parse(body):null;received.push({path:req.url,input});
  const reply=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(req.url==='/api/health')return reply({app:'h3-director-bridge',token:'private-test-token',version:'test'});
  if(req.url==='/api/ai'&&input?.action==='start'){plannerStarts++;res.destroy();return;}
  if(req.url==='/api/generate'){res.statusCode=502;return reply({code:'ECONNRESET',error:'Upstream connection lost after acceptance'});}
  if(req.url==='/api/ai'&&input?.action==='get'&&input.id==='slow-job')return; // Wait's deadline must abort this stalled observation.
  if(req.url==='/api/reference-agent')return reply({id:'review-job',status:'needs_review',pending:{kind:'candidate',candidateId:'candidate-1'},message:'Human review needed.'});
  if(req.url==='/api/wangp')return reply({job_id:'worker-job',status:'uncertain',message:'Exact ownership requires inspection.'});
  if(req.url==='/api/studio-blob?key=owned'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length});res.end(bytes);return;}
  if(req.url==='/api/studio-blob?key=truncated'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length+100});res.write(bytes);setTimeout(()=>res.destroy(),20);return;}
  res.writeHead(404);reply({error:'Unknown test route'});
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const client=new AgentClient({url:'http://127.0.0.1:'+server.address().port});
try{
  const request={requestId:'lost-accepted-request',provider:'codex',model:'test-model',system:'Test contract.',prompt:'Test prompt.'};
  await assert.rejects(()=>client.call('planner',{action:'start',request}),error=>error.code==='AUTHORIZATION_REQUIRED');
  assert.equal(received.length,0,'Missing effect authorization must fail before any HTTP request');
  const health=await client.health();assert.equal(Object.hasOwn(health,'token'),false,'Health output must not disclose bridge token');
  await assert.rejects(()=>client.call('planner',{action:'start',request,_allow:['provider','network','cpu']}),error=>error.code==='OUTCOME_UNKNOWN');
  assert.equal(plannerStarts,1,'Unknown acceptance must not cause an automatic second paid request');
  await assert.rejects(()=>client.call('provider',{provider:'deepseek',model:'fixture-model',system:'Return JSON.',prompt:'One original title.',_allow:['provider','network','cpu']}),error=>error.code==='OUTCOME_UNKNOWN'&&error.details.retrySubmittedWork===false);
  assert.equal(received.filter(row=>row.path==='/api/generate').length,1,'A bridge 502 must not disguise uncertain provider acceptance or trigger replay');
  const review=await client.call('job_wait',{tool:'reference_agent',id:'review-job',timeoutMs:500});
  assert.equal(review.outcome,'attention');assert.equal(review.status,'needs_review');
  assert.equal(review.result.pending.candidateId,'candidate-1');
  assert.equal(received.filter(row=>row.path==='/api/reference-agent').length,1,'Wait must stop on review, not approve/resume/poll indefinitely');
  const uncertain=await client.call('job_wait',{tool:'worker',id:'worker-job',timeoutMs:500,_allow:['network']});
  assert.equal(uncertain.outcome,'attention');assert.equal(uncertain.status,'uncertain');
  const timed=await client.call('job_wait',{tool:'planner',id:'slow-job',timeoutMs:100,intervalMs:100});
  assert.equal(timed.outcome,'timeout');
  assert.equal(received.filter(row=>row.path==='/api/ai'&&row.input?.id==='slow-job').length,1);
  const output=join(tmp,'media.wav');
  const downloaded=await client.call('media_download',{url:'/api/studio-blob?key=owned',output,_allow:['network']});
  assert.deepEqual(await readFile(output),bytes);assert.equal(downloaded.bytes,bytes.length);
  await writeFile(output,'user-file');
  await assert.rejects(()=>client.call('media_download',{url:'/api/studio-blob?key=owned',output,_allow:['network']}),error=>error.code==='EEXIST');
  assert.equal(await readFile(output,'utf8'),'user-file','A download must never overwrite an existing local file');
  await assert.rejects(()=>client.download({url:'https://example.com/api/studio-blob?key=owned',output:join(tmp,'remote')}),error=>error.code==='INVALID_DOWNLOAD');
  const partial=join(tmp,'partial.wav');
  await assert.rejects(()=>client.call('media_download',{url:'/api/studio-blob?key=truncated',output:partial,_allow:['network']}));
  await assert.rejects(()=>readFile(partial),error=>error.code==='ENOENT','Incomplete media must never appear at the final path');
  assert.equal((await readdir(tmp)).some(name=>name.includes('.part-')),false,'Temporary download files must be removed after failure');
  console.log('PASS agent admission before HTTP, token privacy, unknown-outcome non-replay, review/uncertainty waits, owned atomic downloads and overwrite protection');
}finally{await new Promise(resolve=>server.close(resolve));await rm(tmp,{recursive:true,force:true});}
