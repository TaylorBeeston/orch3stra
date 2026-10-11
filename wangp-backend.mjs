/** Server-side WanGP routing. Browser URLs/tokens cannot override headless mode. */
import {readFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
export class WanGPBackend {
  constructor(dataDir,{mode=process.env.H3_WANGP_BACKEND||'legacy',headlessDir=process.env.H3_HEADLESS_DATA_DIR}={}){
    if(!['legacy','headless'].includes(mode))throw Error('H3_WANGP_BACKEND must be legacy or headless.');
    this.mode=mode;this.directory=resolve(headlessDir||join(dataDir,'headless'));
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
    const u=new URL(url);
    if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw Error('Invalid legacy adapter URL.');
    return {base:u.href.replace(/\/+$/,''),token:token||process.env.H3_WANGP_TOKEN||''};
  }
  description(){return {mode:this.mode,browser_required:this.mode!=='headless',token_managed:this.mode==='headless',plugin_required:this.mode!=='headless'};}
}
