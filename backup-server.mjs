/** Private durable portable snapshots. Uses existing immutable studio media and auth. */
import {mkdir,readFile,writeFile,rename,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {createReadStream} from 'node:fs';
const require=createRequire(import.meta.url),H3=require('./core.js'),S=require('./studio-core.js');
export const BACKUP_ENCODED_LIMIT=64*1024**2;
export function encodedBackupBytes(project,media){const files=Object.create(null);let encoded=0;for(const {key,type,size} of media){if(!Number.isSafeInteger(size)||size<0)throw Error('Invalid project media size.');files[key]={type,data:'data:'+type+';base64,'};encoded+=4*Math.ceil(size/3);}return Buffer.byteLength(JSON.stringify({format:'h3-director-portable',version:1,project,files}))+encoded;}
export class BackupQueue{constructor(limit=8){this.limit=limit;this.pending=0;this.tail=Promise.resolve();}async run(work){if(this.pending>=this.limit)throw Error('Portable backup queue is full; no attempt was started.');this.pending++;const result=this.tail.catch(()=>{}).then(work);this.tail=result.catch(()=>{});try{return await result;}finally{this.pending--;}}}
const backupQueue=new BackupQueue();
function publicBackup(job){const {snapshot,...safe}=job;return safe;}
async function fileSha(path){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
const sha=b=>createHash('sha256').update(b).digest('hex');
async function load(p){try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function atomic(p,v){const t=p+'.'+randomBytes(6).toString('hex')+'.tmp';try{await writeFile(t,JSON.stringify(v),{flag:'wx',mode:0o600});await rename(t,p);}finally{await rm(t,{force:true});}}
export function backupMedia(p){return [...new Set([...p.assets.map(a=>a.id),...(p.postMedia||[]).map(a=>a.id),...(p.soundLibraries||[]).map(l=>l.source?.id),...(p.voiceWorkshops||[]).map(w=>w.blobKey)].filter(Boolean))];}
export class PortableBackups{
 constructor(store){this.store=store;this.root=join(store.root,'backups');this.ready=this.recover();}
 async recover(){await this.store.ready;await mkdir(this.root,{recursive:true,mode:0o700});for(const name of await readdir(this.root))if(/^backup_[a-f0-9]{64}\.json$/.test(name)){const path=join(this.root,name),j=await load(path);if(j?.status==='building'){j.status='interrupted';j.message='Backup building was interrupted by a bridge restart. Original attempt is preserved; explicitly create a new attempt with the same snapshot.';await atomic(path,j);}}}
 path(id){if(!/^backup_[a-f0-9]{64}$/.test(id))throw Error('Invalid backup ID.');return join(this.root,id);}
 async handle(b){await this.ready;if(b.action==='list'){const jobs=[];for(const name of await readdir(this.root))if(/^backup_[a-f0-9]{64}\.json$/.test(name)){const j=await load(join(this.root,name));if(j&&(!b.projectId||j.projectId===b.projectId))jobs.push(publicBackup(j));}return {jobs:jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100)};}if(b.action==='get'){const j=await load(this.path(b.id)+'.json');if(!j)throw Error('Backup not found.');return publicBackup(j);}if(!['start','retry'].includes(b.action))throw Error('Unknown backup action.');
 const retrySource=b.action==='retry'?await load(this.path(b.id)+'.json'):null;const project=S.redact(H3.normalizeProject(retrySource?.snapshot||b.project)),text=JSON.stringify(project),snapshotHash=sha(text);let id='backup_'+snapshotHash;if(b.action==='retry'){const old=await load(this.path(b.id)+'.json');if(!old||!['interrupted','failed'].includes(old.status))throw Error('Only an interrupted or failed backup permits a new attempt.');if((old.snapshotHash||old.id.slice(7))!==snapshotHash)throw Error('Project changed since this backup. Save a new snapshot instead.');if(typeof b.attemptId!=='string'||!/^[-a-zA-Z0-9_]{16,100}$/.test(b.attemptId))throw Error('New backup attempt needs a stable client attempt ID.');id='backup_'+sha(text+'\0'+b.id+'\0'+b.attemptId);}const path=this.path(id);
 return this.store.serialize(id,()=>backupQueue.run(async()=>{const old=await load(path+'.json');if(old?.status==='completed'){if(await fileSha(path+'.h3project')!==old.sha256)throw Error('Saved backup verification failed; preserve it for inspection.');return publicBackup(old);}
 if(old)throw Error('Backup already owns an incomplete or failed attempt. Inspect its saved status; no automatic retry.');
 const j={id,snapshot:project,snapshotHash,previousAttempt:b.action==='retry'?b.id:null,projectId:project.id,name:project.name,status:'building',progress:0,message:'Building private portable backup; rendered worker clips are not embedded.',createdAt:new Date().toISOString()};await atomic(path+'.json',j);
 try{const files=Object.create(null),keys=backupMedia(project),media=[];for(const key of keys){const meta=await load(this.store.blobPath(key)+'.json');if(!meta||! /^(image|audio|video)\//.test(meta.type))throw Error('Missing or unsupported project media: '+key);media.push({key,type:meta.type,size:meta.size,sha:meta.sha});}
 const encodedBytes=encodedBackupBytes(project,media);if(encodedBytes>BACKUP_ENCODED_LIMIT)throw Error('Portable backup exceeds the 64 MiB encoded JSON limit. Use a smaller project backup; original media remains unchanged.');
 for(let i=0;i<media.length;i++){const {key,type,size,sha:expected}=media[i],bytes=await readFile(this.store.blobPath(key));if(bytes.length!==size||sha(bytes)!==expected)throw Error('Project media verification failed: '+key);files[key]={type,data:'data:'+type+';base64,'+bytes.toString('base64')};j.progress=Math.round((i+1)/Math.max(1,keys.length)*90);j.message='Verified project media '+(i+1)+'/'+keys.length;await atomic(path+'.json',j);}
 if(keys.some(key=>!Object.hasOwn(files,key))||Object.keys(files).length!==keys.length)throw Error('Portable media key coverage failed.');
 const payload=JSON.stringify({format:'h3-director-portable',version:1,project,files});await writeFile(path+'.h3project',payload,{flag:'wx',mode:0o600});const verifiedSha=await fileSha(path+'.h3project');if(verifiedSha!==sha(payload))throw Error('Backup file verification failed.');Object.assign(j,{status:'completed',progress:100,message:'Verified portable project backup saved on the studio computer. Worker video outputs remain separate.',path:path+'.h3project',sha256:verifiedSha,mediaCount:keys.length,bytes:Buffer.byteLength(payload)});await atomic(path+'.json',j);return publicBackup(j);
 }catch(e){j.status='failed';j.message=e.message;await atomic(path+'.json',j);throw e;}}));
 }
}
