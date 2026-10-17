/** Server-side WanGP routing. Browser URLs/tokens cannot override headless mode. */
import {readFile,lstat,open} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export class WanGPBackend {
  constructor(dataDir,{mode=process.env.H3_WANGP_BACKEND||'legacy',headlessDir=process.env.H3_HEADLESS_DATA_DIR,legacyConnection=null}={}){
    if(!['legacy','headless'].includes(mode))throw Error('H3_WANGP_BACKEND must be legacy or headless.');
    this.mode=mode;this.directory=resolve(headlessDir||join(dataDir,'headless'));
    this.legacyConnection=legacyConnection;
  }
  async target(url,token){
    if(this.mode==='headless'){
      try{
        const path=join(this.directory,'token'),s=await lstat(path);
        if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077))throw Error('Headless token file must be a private regular file (chmod 600).');
        token=(await readFile(path,'utf8')).trim();
        const connection=JSON.parse(await readFile(join(this.directory,'connection.json'),'utf8'));
        const u=new URL(connection.url);
        if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Invalid local headless connection file.');
        if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw Error('Invalid headless credential file.');
        return {base:u.origin,token};
      }catch(e){throw Error('Headless WanGP is not configured/reachable. Run node start-headless.mjs. '+e.message);}
    }
    if(!url&&this.legacyConnection){const configured=await this.legacyConnection();url=configured?.url;token=token||configured?.token;}
    if(!url)throw Error('No legacy adapter URL is configured. Save wangpUrl in Studio credentials, or use the managed headless runtime.');
    const u=new URL(url);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid legacy adapter URL.');
    return {base:u.href.replace(/\/+$/,''),token:token||process.env.H3_WANGP_TOKEN||''};
  }
  // Read-only crash diagnosis for a headless worker that stopped answering.
  async diagnose(){
    if(this.mode!=='headless')return null;
    let connection=null;try{connection=JSON.parse(await readFile(join(this.directory,'connection.json'),'utf8'));}catch{}
    const pid=connection?.pid,logPath=join(this.directory,'worker.log');let alive=null;
    if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);alive=true;if(process.platform==='linux'){const stat=await readFile('/proc/'+pid+'/stat','utf8'),cmd=await readFile('/proc/'+pid+'/cmdline','utf8');if(stat.slice(stat.lastIndexOf(')')+2).startsWith('Z')||!cmd.includes('server.py'))alive=false;}}catch(e){alive=e.code==='EPERM';}}
    if(alive!==false)return {exited:false,pid:pid??null,logPath};
    let tail='';try{const fh=await open(logPath,'r');try{const {size}=await fh.stat(),n=Math.min(size,32768),buf=Buffer.alloc(n);await fh.read(buf,0,n,size-n);tail=buf.toString('utf8');}finally{await fh.close();}}catch{}
    // worker.log is append-only: judge only this run (after its last ready line) and only its final lines.
    const mark=tail.lastIndexOf('H3 headless WanGP ready');if(mark>=0)tail=tail.slice(mark);tail=tail.slice(-6000);
    const reason=/out of memory|OutOfMemoryError/i.test(tail)?'Its log reports running out of memory.':/Traceback \(most recent call last\)/.test(tail)?'Its log ends with a Python error.':'Its log ends without an error, which usually means the operating system stopped it'+(process.platform==='linux'?' (most often the out-of-memory killer while a model was loading; check journalctl -k | grep -i oom)':'')+'.';
    return {exited:true,restartable:true,pid,logPath,message:`The headless renderer (process ${pid}) is no longer running. ${reason} See the end of ${logPath}. Free some RAM (close memory-heavy apps) before restarting. Use Restart renderer here, or stop Director and run node start-headless.mjs. Interrupted work is never replayed automatically.`};
  }
  description(){return {mode:this.mode,browser_required:this.mode!=='headless',token_managed:this.mode==='headless',plugin_required:this.mode!=='headless'};}
}
