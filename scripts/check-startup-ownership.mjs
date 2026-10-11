/** All synthetic bootstrap state must be unchanged when a second bridge is refused. */
import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,readFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash,scryptSync} from 'node:crypto';
import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {createServer} from '../bridge.mjs';import {RenderIntentWriter} from '../render-intent-server.mjs';
const temp=await mkdtemp(join(tmpdir(),'orch3stra-startup-ownership-'));const data=join(temp,'data');let first,second;const originalFetch=globalThis.fetch;
const forbidden=()=>{throw Error('Unexpected provider/backend/media call in synthetic startup');};globalThis.fetch=forbidden;
async function snapshot(root){const result={};async function walk(folder){for(const name of await readdir(folder)){const path=join(folder,name),s=await stat(path),key=path.slice(root.length+1);result[key]={kind:s.isDirectory()?'directory':'file',mode:s.mode&0o777};if(s.isDirectory())await walk(path);else result[key]={...result[key],bytes:s.size,mtime:s.mtimeMs,sha256:createHash('sha256').update(await readFile(path)).digest('hex')};}}await walk(root);return result;}
async function seed(name,value){const path=join(data,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});}
try{
 first=createServer({host:'127.0.0.1',port:0,dataDir:data,backendOptions:{mode:'legacy'},aiOptions:{runner:forbidden,silent:true},finishOptions:{fetchImpl:forbidden,probeImpl:forbidden},referenceAgentOptions:{fetchImpl:forbidden},soundOptions:{python:join(temp,'absent-python')},speechQualityOptions:{runner:forbidden}});await first.ready;
 // These unfinished records are created after the active owner's recovery has completed.
 await seed('ai-requests/synthetic-ai.json',{id:'synthetic-ai',status:'running',phase:'streaming',events:[],createdAt:'2026-01-01T00:00:00Z'});
 await seed('backups/backup_'+ 'a'.repeat(64)+'.json',{id:'backup_'+'a'.repeat(64),status:'building',projectId:'synthetic-project',createdAt:'2026-01-01T00:00:00Z'});
 await seed('projects/synthetic-project.json',{id:'synthetic-project',serverRevision:7,project:{name:'Synthetic private project'}});
 await seed('runs/seq_'+ 'b'.repeat(32)+'.json',{id:'seq_'+'b'.repeat(32),status:'running',requestId:'synthetic-owned-request',outputs:[],plan:[],project:{id:'synthetic-project'}});
 await seed('finishing/finish_'+ 'c'.repeat(32)+'.json',{id:'finish_'+'c'.repeat(32),status:'running',cancelRequested:true});
 await seed('sounds/sound_'+ 'd'.repeat(32)+'.json',{id:'sound_'+'d'.repeat(32),status:'running'});
 await seed('reference-agent/ref_'+ 'e'.repeat(32)+'.json',{id:'ref_'+'e'.repeat(32),status:'running'});
 await seed('speech-quality/speech_'+ 'f'.repeat(32)+'.json',{id:'speech_'+'f'.repeat(32),status:'running',attempts:[{status:'submitting'}]});
 await seed('headless/queue.sqlite3','Synthetic inert queue bytes; no worker opens this fixture.');await seed('headless/queue-meta.json',{paused:true,nonterminal:0,ownedRequest:'synthetic-owned-request'});
 await seed('credentials.json',{fixtureOnly:true});const salt='synthetic-salt';await seed('pairing.json',{salt,digest:scryptSync('prior-synthetic-password',salt,32).toString('hex')});await seed('paired-devices.json',{fixtureOnly:true,sessions:[]});
 await writeFile(join(temp,'forbid-fetch.mjs'),"globalThis.fetch=()=>{throw Error('No network in locked-launch fixture');};");
 const before=await snapshot(temp);
 const launcher=spawnSync(process.execPath,['--import',join(temp,'forbid-fetch.mjs'),'start-headless.mjs'],{cwd:fileURLToPath(new URL('..',import.meta.url)),env:{...process.env,H3_DATA_DIR:data,H3_WANGP_ROOT:join(temp,'absent-backend'),H3_WANGP_PYTHON:join(temp,'absent-python')},encoding:'utf8',timeout:8000});assert.equal(launcher.status,1,launcher.stderr);assert.match(launcher.stderr,/already has a writer/);assert.deepEqual(await snapshot(temp),before);
 console.log('PASS refused default launcher never reaches worker health, queue bootstrap, Python spawn or studio recovery');
 second=createServer({host:'0.0.0.0',port:0,dataDir:data,studioPassword:'different-synthetic-password',backendOptions:{mode:'legacy'},aiOptions:{runner:forbidden,silent:true},finishOptions:{fetchImpl:forbidden,probeImpl:forbidden},referenceAgentOptions:{fetchImpl:forbidden},soundOptions:{python:join(temp,'absent-python')},speechQualityOptions:{runner:forbidden}});
 await assert.rejects(second.ready,/already has a writer/);await Promise.allSettled([second.studio.ready,second.studio.backups.ready,second.ai.ready,second.sequences.ready,second.finishing.ready,second.referenceAgent.ready,second.sounds.ready,second.speechQuality.ready,second.voice.root]);
 await new Promise(resolve=>second.close(()=>resolve()));await second.shutdown;assert.deepEqual(await snapshot(temp),before);
 console.log('PASS refused second bridge preserves every synthetic ledger/AI/backup/project/queue/pairing/credential/recovery file byte, mtime and mode; no listener, fetch, provider or Python invocation');
 let finishSequence;const pendingSequence=new Promise(resolve=>finishSequence=resolve).then(()=>seed('synthetic-sequence-shutdown-tail.json',{finished:true}));first.sequences.work.set('synthetic-sequence-close-tail',pendingSequence);
 let finish;const pendingWrite=new Promise(resolve=>finish=resolve).then(()=>seed('synthetic-shutdown-tail.json',{finished:true}));first.referenceAgent.work.set('synthetic-close-tail',pendingWrite);first.sounds.runningDone=pendingWrite;first.sequences.maintenanceWork=pendingWrite;
 await new Promise(resolve=>first.close(()=>resolve()));const third=createServer({host:'127.0.0.1',port:0,dataDir:data,backendOptions:{mode:'legacy'},aiOptions:{runner:forbidden,silent:true}});await assert.rejects(third.ready,/already has a writer/);await new Promise(resolve=>third.close(()=>resolve()));await third.shutdown;assert.deepEqual(await snapshot(temp),before);
 finish();await pendingWrite;await new Promise(resolve=>setTimeout(resolve,0));const beforeSequence=await snapshot(temp);const fourth=createServer({host:'127.0.0.1',port:0,dataDir:data,backendOptions:{mode:'legacy'},aiOptions:{runner:forbidden,silent:true}});await assert.rejects(fourth.ready,/already has a writer/);await new Promise(resolve=>fourth.close(()=>resolve()));await fourth.shutdown;assert.deepEqual(await snapshot(temp),beforeSequence);finishSequence();await first.shutdown;const next=new RenderIntentWriter(data);await next.ready;next.releaseSync();first=null;
 console.log('PASS shutdown retains ownership until pending manager/maintenance/sound and final sequence writes settle, then permits explicit writer handoff');

}finally{globalThis.fetch=originalFetch;if(first){await new Promise(resolve=>first.close(()=>resolve()));await first.shutdown;await first.renderIntents.close();}await rm(temp,{recursive:true,force:true});}
