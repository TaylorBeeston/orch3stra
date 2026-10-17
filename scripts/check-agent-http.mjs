import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from '../bridge.mjs';
import {AgentClient} from '../agent-client.mjs';

// Real authenticated bridge, CLI subprocesses, MCP transport and durable storage.
// The legacy renderer boundary is a local fixture; no real worker, provider or inference.
const root=resolve(import.meta.dirname,'..'),tmp=await mkdtemp(join(tmpdir(),'orch3stra-agent-http-'));
const worker=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture-worker-secret');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({models:[{model_type:'fixture-configured-renderer'}]}));});
worker.listen(0,'127.0.0.1');await once(worker,'listening');
const server=createServer({port:0,host:'0.0.0.0',dataDir:join(tmp,'studio'),studioPassword:'agent-fixture-password',backendOptions:{mode:'legacy'}});
server.listen(0,'127.0.0.1');await once(server,'listening');await server.ready;
const url='http://127.0.0.1:'+server.address().port,cookieFile=join(tmp,'session.cookie');
const env={...process.env,ORCH3STRA_URL:url,ORCH3STRA_COOKIE:''};
let mcp;
async function cli(args,input=''){
 const child=spawn(process.execPath,[join(root,'orch3stra.mjs'),...args],{cwd:root,env,stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(input);
 const [code]=await once(child,'exit');assert.equal(code,0,stderr||stdout);
 return JSON.parse(stdout);
}
try{
 assert.equal((await fetch(url+'/api/agent')).status,401,'Agent discovery must respect studio pairing');
 await cli(['pair','--password-stdin','--cookie-file',cookieFile],'agent-fixture-password\n');
 assert.equal((await stat(cookieFile)).mode&0o777,0o600);
 const cookie=(await readFile(cookieFile,'utf8')).trim(),client=new AgentClient({url,cookie});
 await client.call('studio',{action:'save-credentials',credentials:{wangpUrl:'http://127.0.0.1:'+worker.address().port,wangp:'fixture-worker-secret'},_allow:['network']});
 const nativeModels=await client.call('worker',{path:'/models',method:'GET',_allow:['network']});
 const creativeModels=await client.call('generation',{action:'discover',family:'video',_allow:['network']});
 assert.equal(nativeModels.models[0].model_type,'fixture-configured-renderer');assert.deepEqual(creativeModels,nativeModels);
 const created=await cli(['call','project','--cookie-file',cookieFile,'--json',JSON.stringify({action:'create',name:'CLI original',request:'A silent original film about a light returning home.'})]);
 assert.equal(created.project.name,'CLI original');assert.equal(created.serverRevision,1);
 const renamed=await client.call('project',{action:'configure',projectId:created.id,expectedRevision:1,name:'CLI renamed'});
 assert.equal(renamed.serverRevision,2);
 await assert.rejects(()=>client.call('project',{action:'configure',projectId:created.id,expectedRevision:1,name:'Stale overwrite'}),e=>e.code==='REVISION_CONFLICT');
 const concurrent=await Promise.allSettled(['Left revision','Right revision'].map(name=>client.call('project',{action:'configure',projectId:created.id,expectedRevision:2,name})));
 assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'Concurrent authoring cannot silently overwrite another writer');
 assert.equal(concurrent.find(r=>r.status==='rejected').reason.code,'REVISION_CONFLICT');
 const saved=await client.call('project',{action:'get',projectId:created.id});
 assert.equal(saved.serverRevision,3);assert.equal(saved.project.name,concurrent.find(r=>r.status==='fulfilled').value.project.name);
 const rejected=await fetch(url+'/api/agent',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json','X-H3-Token':'wrong'},body:JSON.stringify({tool:'project',arguments:{action:'create',name:'Rejected'}})});
 assert.equal(rejected.status,403);
 assert.equal((await client.call('project',{action:'list'})).projects.length,1);
 const backup=await client.call('studio',{action:'backup-start',project:saved.project,_allow:['cpu']});
 assert.equal(backup.status,'completed');
 const target=join(tmp,'verified.h3project'),download=await cli(['download','/api/agent-backup/'+backup.id,'--output',target,'--allow','network','--cookie-file',cookieFile]);
 assert.equal(download.sha256,backup.sha256);assert.equal(JSON.parse(await readFile(target,'utf8')).project.name,saved.project.name);
 await writeFile(server.studio.backups.path(backup.id)+'.h3project','corrupted archive');
 await assert.rejects(()=>client.call('media_download',{url:'/api/agent-backup/'+backup.id,output:join(tmp,'corrupt.h3project'),_allow:['network']}),e=>e.code==='BACKUP_HASH_CHANGED'&&e.details.status===409);
 await assert.rejects(()=>stat(join(tmp,'corrupt.h3project')),e=>e.code==='ENOENT');

 mcp=spawn(process.execPath,[join(root,'orch3stra.mjs'),'mcp','--cookie-file',cookieFile],{cwd:root,env,stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:mcp.stdout}),pending=new Map();let next=0,stderr='';mcp.stderr.on('data',b=>stderr+=b);
 lines.on('line',line=>{const msg=JSON.parse(line),p=pending.get(msg.id);if(p){pending.delete(msg.id);clearTimeout(p.timer);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}});
 function rpc(method,params){const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP timeout: '+method+' '+stderr));},10000);pending.set(id,{resolve,reject,timer});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});}
 const init=await rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'agent-http-check',version:'1'}});
 assert.equal(init.protocolVersion,'2025-03-26');
 const made=await rpc('tools/call',{name:'project',arguments:{action:'create',name:'MCP original',request:'An original silent paper-boat story.'}});
 assert.notEqual(made.isError,true);assert.equal(made.structuredContent.project.name,'MCP original');
 const inspected=await client.call('project',{action:'get',projectId:made.structuredContent.id});
 assert.equal(inspected.project.request,'An original silent paper-boat story.');
 const denied=await rpc('tools/call',{name:'worker',arguments:{path:'/queue/resume',method:'POST',body:{}}});
 assert.equal(denied.isError,true);assert.equal(denied.structuredContent.error.code,'AUTHORIZATION_REQUIRED');
 const skill=await rpc('resources/read',{uri:'orch3stra://filmmaking/SKILL.md'});
 assert.match(skill.contents[0].text,/name: make-film/);
 mcp.stdin.end();const [code]=await once(mcp,'exit');assert.equal(code,0,stderr);mcp=null;
 console.log('PASS real paired CLI/MCP authoring, CAS concurrent-writer protection, token guard, verified backup download and corrupt archive rejection');
}finally{
 if(mcp&&mcp.exitCode===null){mcp.kill('SIGTERM');await once(mcp,'exit');}
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.shutdown;
 worker.closeAllConnections();await new Promise(resolve=>worker.close(resolve));
 await rm(tmp,{recursive:true,force:true});
}
