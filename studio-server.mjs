/** Shared single-user studio. No database daemon; atomic JSON + immutable media files.
 * All public handlers run behind bridge Host/Origin checks and pairing authentication.
 */
import {PortableBackups} from './backup-server.mjs';
import {mkdir,readFile,writeFile,rename,stat,readdir,chmod,rm} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {networkInterfaces,hostname} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), H3=require('./core.js'), S=require('./studio-core.js');
export const safeID=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(id);
const hash=s=>createHash('sha256').update(String(s)).digest('hex');
export async function atomicJSON(path,value){const tmp=path+'.'+randomBytes(6).toString('hex')+'.tmp';try{await writeFile(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});await rename(tmp,path);}finally{await rm(tmp,{force:true}).catch(()=>{});}}
export async function loadJSON(path,fallback=null){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export function allowedRequest(req,port,{extraHosts=[],publicOrigin=''}={}){
  const hosts=new Set(['localhost','127.0.0.1','[::1]',hostname().toLowerCase(),...extraHosts.map(h=>String(h).toLowerCase())]);
  for(const items of Object.values(networkInterfaces()))for(const n of items||[])if(n.family==='IPv4')hosts.add(n.address);
  const authorities=new Set([...hosts].map(h=>h+':'+port));let published=null;
  if(publicOrigin){published=new URL(publicOrigin);if(!['http:','https:'].includes(published.protocol)||published.username||published.password||published.pathname!=='/'||published.search||published.hash)throw Error('H3_PUBLIC_ORIGIN must be an exact http(s) origin.');authorities.add(published.host);}
  const host=String(req.headers.host||'').toLowerCase();if(!authorities.has(host))return false;
  const origin=req.headers.origin;return !origin||origin==='http://'+host||origin==='https://'+host||(published&&origin===published.origin&&host===published.host);
}
export class StudioStore{
  constructor(root,{network=false,password=process.env.H3_STUDIO_PASSWORD,beforeInit=Promise.resolve()}={}){this.beforeInit=beforeInit;this.root=root;this.network=network;this.password=password;this.sessions=new Map();this.attempts=new Map();this.locks=new Map();this.ready=this.init();this.backups=new PortableBackups(this);}
  async init(){await this.beforeInit;for(const n of ['', 'projects','blobs','renders','runs']){const p=join(this.root,n);await mkdir(p,{recursive:true,mode:0o700});await chmod(p,0o700);}
    this.credentials=await loadJSON(join(this.root,'credentials.json'),{});
    let pairing=await loadJSON(join(this.root,'pairing.json'));
    const changedPassword=this.password&&(!pairing||!timingSafeEqual(scryptSync(this.password,pairing.salt,32),Buffer.from(pairing.digest,'hex')));
    if(changedPassword||(!pairing&&this.network)){const password=this.password||randomBytes(18).toString('base64url'),salt=randomBytes(16).toString('hex');pairing={salt,digest:scryptSync(password,salt,32).toString('hex')};await atomicJSON(join(this.root,'pairing.json'),pairing);if(!this.password)this.newPassword=password;}
    this.pairing=pairing;this.password=undefined;
    const saved=await loadJSON(join(this.root,'paired-devices.json'));
    if(pairing&&saved?.pairingDigest===pairing.digest)for(const [key,until]of saved.sessions||[])if(/^[a-f0-9]{64}$/.test(key)&&Number.isFinite(until)&&until>Date.now())this.sessions.set(key,until);
  }
  authenticated(req){if(!this.network)return true;const cookie=String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('h3studio='))?.slice(9);const k=cookie&&hash(cookie),until=k&&this.sessions.get(k);if(until&&until>Date.now())return true;if(k)this.sessions.delete(k);return false;}
  async pair(req,password){if(!this.pairing)throw Error('Pairing is not enabled in loopback-only mode.');const address=req.socket.remoteAddress||'local',now=Date.now();let a=this.attempts.get(address)||{since:now,count:0};if(now-a.since>60000)a={since:now,count:0};if(++a.count>10)throw Error('Too many pairing attempts. Wait one minute.');this.attempts.set(address,a);if(typeof password!=='string'||password.length>512||!timingSafeEqual(scryptSync(password,this.pairing.salt,32),Buffer.from(this.pairing.digest,'hex')))throw Error('Incorrect studio password.');this.attempts.delete(address);const token=randomBytes(32).toString('base64url');if(this.sessions.size>200)this.sessions.delete(this.sessions.keys().next().value);this.sessions.set(hash(token),now+7*86400000);await this.serialize('paired-devices',()=>atomicJSON(join(this.root,'paired-devices.json'),{pairingDigest:this.pairing.digest,sessions:[...this.sessions]}));return token;}
  async serialize(id,fn){const prior=this.locks.get(id)||Promise.resolve();const next=prior.catch(()=>{}).then(fn);this.locks.set(id,next);try{return await next;}finally{if(this.locks.get(id)===next)this.locks.delete(id);}}
  blobPath(key){if(typeof key!=='string'||!key||key.length>250)throw Error('Invalid media key.');return join(this.root,'blobs',hash(key));}
  async putBlob(key,stream,length,type='application/octet-stream'){
    const path=this.blobPath(key);if(!Number.isSafeInteger(length)||length<1||length>2*1024**3)throw Error('A media upload must be 1 byte–2 GiB.');
    return this.serialize('blob:'+key,async()=>{const tmp=path+'.tmp-'+randomBytes(8).toString('hex');let n=0;const digest=createHash('sha256');
      try{await pipeline(stream,new Transform({transform(chunk,enc,cb){n+=chunk.length;if(n>length)return cb(Error('Upload exceeded Content-Length.'));digest.update(chunk);cb(null,chunk);}}),createWriteStream(tmp,{flags:'wx',mode:0o600}));if(n!==length)throw Error('Incomplete media upload.');const sha=digest.digest('hex'),old=await loadJSON(path+'.json');if(old&&old.sha!==sha)throw Error('This media ID already owns different bytes. Import as a new reference instead of overwriting it.');if(old)await rm(tmp);else{await rename(tmp,path);await atomicJSON(path+'.json',{key,size:n,type:String(type).slice(0,150),sha});}return {key,size:n,sha};}finally{await rm(tmp,{force:true}).catch(()=>{});}});
  }
  async getProject(id){if(!safeID(id))throw Error('Invalid project ID.');return loadJSON(join(this.root,'projects',id+'.json'));}
  async putProject(raw,expectedRevision){const p=H3.normalizeProject(raw);if(!safeID(p.id))throw Error('Invalid project ID.');return this.serialize(p.id,async()=>{const old=await this.getProject(p.id);if((old?.serverRevision??null)!==expectedRevision){const e=Error('Shared project changed on another device. Pull it or save your edits as a separate copy.');e.status=409;e.serverRevision=old?.serverRevision??null;throw e;}
    const record={id:p.id,name:p.name,updatedAt:new Date().toISOString(),serverRevision:(old?.serverRevision||0)+1,project:S.redact(p)};await atomicJSON(join(this.root,'projects',p.id+'.json'),record);return record;});}
  async listProjects(){const out=[];for(const file of await readdir(join(this.root,'projects'))){if(!file.endsWith('.json'))continue;const r=await loadJSON(join(this.root,'projects',file));out.push({id:r.id,name:r.name,updatedAt:r.updatedAt,serverRevision:r.serverRevision,windows:r.project.windows.length});}return out.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
  async handle(b){await this.ready;switch(b.action){case'backup-list':return this.backups.handle({...b,action:'list'});case'backup-retry':return this.backups.handle({...b,action:'retry'});case'backup-start':return this.backups.handle({...b,action:'start'});case'backup-get':return this.backups.handle({...b,action:'get'});case 'list':return{projects:await this.listProjects()};case'get':{const r=await this.getProject(b.id);if(!r)throw Error('Shared project not found.');return r;}case'put':return this.putProject(b.project,b.expectedRevision??null);case'credentials':return{credentials:this.credentials};case'save-credentials':return this.serialize('credentials',async()=>{for(const k of ['wangp','huggingface','wangpUrl'])if(typeof b.credentials?.[k]==='string')this.credentials[k]=b.credentials[k].slice(0,8192);await atomicJSON(join(this.root,'credentials.json'),this.credentials);return{saved:true};});case'blob-info':return{info:await loadJSON(this.blobPath(b.key)+'.json')};default:throw Error('Unknown studio action.');}}
  async serveBlob(req,res,key){const path=this.blobPath(key),meta=await loadJSON(path+'.json');if(!meta){res.writeHead(404);res.end();return;}await serveFile(req,res,path,meta.type);}
}
export async function serveFile(req,res,path,type='video/mp4',{mediaDocument=false}={}){
  const s=await stat(path);let start=0,end=s.size-1,status=200;const range=req.headers.range;
  if(range){const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2])){res.writeHead(416,{'Content-Range':'bytes */'+s.size});res.end();return;}
    if(!m[1])start=Math.max(0,s.size-Number(m[2]));else start=Number(m[1]);if(m[1]&&m[2])end=Math.min(end,Number(m[2]));if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=s.size){res.writeHead(416,{'Content-Range':'bytes */'+s.size});res.end();return;}status=206;}
  // Only verified completed finishing MP4s opt into native media documents.
  // Their CSP denies scripts/objects; arbitrary uploads retain the sandbox.
  const mime=String(type).split(';')[0].trim().toLowerCase(),inline=/^(image\/(png|jpeg|gif|webp|avif)|audio\/(wav|x-wav|mpeg|mp4|ogg|flac|webm)|video\/(mp4|webm|quicktime))$/.test(mime);res.writeHead(status,{'Content-Type':inline?mime:'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':mediaDocument&&mime==='video/mp4'?"default-src 'none'; media-src 'self'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'":"sandbox; default-src 'none'; frame-ancestors 'none'",...(!inline?{'Content-Disposition':'attachment; filename="studio-source.bin"'}:{}),...(status===206?{'Content-Range':`bytes ${start}-${end}/${s.size}`}:{})});if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(path,{start,end}),res);
}
