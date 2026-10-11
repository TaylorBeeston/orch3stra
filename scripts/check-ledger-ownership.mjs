/** Synthetic multi-process ledger ownership. Minimal environment; no bridge/backend/provider. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';import {createHash} from 'node:crypto';
import {RenderIntents} from '../render-intent-server.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(process.argv[2]==='--child'){
 const root=process.argv[3];let tail=Promise.resolve();const store={root,ready:Promise.resolve(),serialize:(_key,fn)=>{const next=tail.catch(()=>{}).then(fn);tail=next;return next;}};
 const ledger=new RenderIntents(store);
 try{await ledger.ready;process.send({ready:true});}catch(e){process.send({ready:false,error:e.message});process.disconnect();process.exitCode=2;}
 process.on('message',async message=>{try{let result;if(message.action==='close'){await ledger.close();result=true;}else if(message.action==='dispatch'){result=await ledger.dispatch(message.intent,message.scope,async()=>{if(message.fail)throw Error('Synthetic lost response');return{job_id:'synthetic-job'};});}else result=await ledger.handle(message);process.send({serial:message.serial,result});if(message.action==='close')process.disconnect();}catch(e){process.send({serial:message.serial,error:e.message});}});
}else{
 const temp=await mkdtemp(join(tmpdir(),'orch3stra-ledger-ownership-')),children=[];
 try{
  const data=join(temp,'data');await mkdir(data);const minimal={HOME:join(temp,'home'),CODEX_HOME:join(temp,'codex'),H3_DATA_DIR:data,H3_WANGP_BACKEND:'legacy',H3_WANGP_ROOT:join(temp,'absent-backend')};await mkdir(minimal.HOME);await mkdir(minimal.CODEX_HOME);
  const spawn=async()=>{const child=fork(fileURLToPath(import.meta.url),['--child',data],{env:minimal,stdio:['ignore','ignore','pipe','ipc']});children.push(child);let stderr='';child.stderr.on('data',b=>stderr+=b);const ready=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Child readiness timeout '+stderr)),8000);child.once('message',m=>{clearTimeout(timeout);resolve(m);});child.once('error',e=>{clearTimeout(timeout);reject(e);});});let serial=0;return{child,ready,call:message=>new Promise((resolve,reject)=>{const token=++serial;const timer=setTimeout(()=>{child.off('message',receive);reject(Error('Child request timeout'));},8000);const receive=m=>{if(m.serial!==token)return;clearTimeout(timer);child.off('message',receive);m.error?reject(Error(m.error)):resolve(m.result);};child.on('message',receive);child.send({...message,serial:token});})};};
  const first=await spawn();assert(first.ready.ready);const session=await first.call({action:'begin-session',owner:'synthetic-owner',runId:'run-1'});
  const prepare=projectId=>first.call({action:'prepare',projectId,mode:'independent',owner:'synthetic-owner',lease:session.lease});
  const prepared=await prepare('pending'),accepted=await prepare('accepted'),uncertain=await prepare('uncertain');
  const scope=r=>({projectId:r.projectId,mode:r.mode,requestId:r.requestId});
  await first.call({action:'dispatch',intent:accepted,scope:scope(accepted)});await assert.rejects(first.call({action:'dispatch',intent:uncertain,scope:scope(uncertain),fail:true}),/lost response/);await first.call({action:'invalidate-project',projectId:'tombstone'});
  const ledgerPath=join(data,'render-intents.json'),before=await readFile(ledgerPath);
  const second=await spawn();assert.equal(second.ready.ready,false);assert.match(second.ready.error,/already has a writer/);assert.equal(hash(await readFile(ledgerPath)),hash(before));assert.equal((await first.call({action:'get',id:prepared.id})).state,'prepared');
  console.log('PASS second real Node process refused before initialization recovery; prepared/accepted/uncertain/owner/tombstone bytes preserved');
  await first.call({action:'close'});const reopened=await spawn();assert(reopened.ready.ready);const recovered=await reopened.call({action:'list'});assert.equal(recovered.records.find(r=>r.id===prepared.id).state,'cancelled');assert.equal(recovered.records.find(r=>r.id===accepted.id).state,'accepted');assert.equal(recovered.records.find(r=>r.id===uncertain.id).state,'uncertain');assert(recovered.blocked.tombstone);
  const current=await readFile(ledgerPath);await writeFile(ledgerPath,Buffer.concat([current,Buffer.from('\n')]));const externalHash=hash(await readFile(ledgerPath));await assert.rejects(reopened.call({action:'begin-session',owner:'synthetic-owner',runId:'run-2'}),/changed outside its owner/);assert.equal(hash(await readFile(ledgerPath)),externalHash);await reopened.call({action:'close'});
  console.log('PASS explicit close permits restart recovery once; accepted/uncertain/tombstone preserved; external mutation fences cached writes');
  const crash=await spawn();assert(crash.ready.ready);const exit=new Promise(r=>crash.child.once('exit',r));crash.child.kill('SIGKILL');await exit;const crashHash=hash(await readFile(ledgerPath));const refused=await spawn();assert.equal(refused.ready.ready,false);assert.match(refused.ready.error,/crash lock/);assert.equal(hash(await readFile(ledgerPath)),crashHash);
  console.log('PASS forced-crash lock fails closed without takeover, recovery write, or replay');
  // Only this disposable fixture may remove its own crash lock. Production recovery is manual and gated.
  await unlink(ledgerPath+'.writer-lock');
  const normal=await spawn();assert(normal.ready.ready);normal.child.disconnect();const normalExit=new Promise(r=>normal.child.once('exit',r));await normalExit;await assert.rejects(readFile(ledgerPath+'.writer-lock'),e=>e.code==='ENOENT');
  console.log('PASS normal process exit releases only its own writer lock; isolated HOME/CODEX_HOME/data/backend, no provider or worker');
 }finally{for(const child of children)if(child.exitCode===null&&!child.killed)child.kill('SIGKILL');await rm(temp,{recursive:true,force:true});}
}
