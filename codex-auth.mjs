/** Official Codex app-server account surface. No OAuth-file reading or token extraction. */
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export function modelRow(m){return {id:m.model||m.id,label:m.displayName||m.model||m.id,hidden:!!m.hidden,isDefault:!!m.isDefault,inputModalities:m.inputModalities||['text','image'],defaultReasoningEffort:m.defaultReasoningEffort||'',supportedReasoningEfforts:m.supportedReasoningEfforts||[],upgrade:m.upgrade||null};}
export async function listModels(rpc,includeHidden=true){const models=[],seen=new Set();let cursor=null;for(let page=0;page<30;page++){const r=await rpc.call('model/list',{limit:100,cursor,includeHidden});for(const m of r.data||[])if((m.model||m.id)&&!models.some(x=>x.id===(m.model||m.id)))models.push(modelRow(m));const next=r.nextCursor||null;if(!next)return{models,fetchedAt:new Date().toISOString()};if(seen.has(next))throw Error('Codex repeated its model-list cursor. Update the CLI.');seen.add(next);cursor=next;}throw Error('Codex catalog pagination exceeded its limit.');}
function timeout(p,ms=45000){let t;return Promise.race([p,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('Codex app-server did not respond. Check the CLI version and sign-in.')),ms);t.unref?.();})]).finally(()=>clearTimeout(t));}
export class CodexAuth{
 constructor(factory,{bin=process.env.CODEX_BIN||'codex',versionReader=null}={}){this.factory=factory;this.bin=bin;this.versionReader=versionReader||(()=>exec(bin,['--version'],{timeout:8000,windowsHide:true,env:process.env}).then(r=>r.stdout.trim()).catch(()=> 'CLI version unavailable'));this.rpc=null;this.login=null;this.timer=null;this.busy=false;}
 async temporary(fn){const rpc=this.factory();try{await timeout(rpc.initialize(false));return await timeout(fn(rpc));}finally{rpc.close();}}
 snapshot(){return this.login?{...this.login}:null;}
 async handle(b){
  if(b.action==='status'){const cliVersion=await this.versionReader();let info;try{info=this.rpc?await timeout(this.rpc.call('account/read',{refreshToken:false})):await this.temporary(r=>r.call('account/read',{refreshToken:false}));}catch(e){return{binary:this.bin,cliVersion,account:null,login:this.snapshot(),error:e.message};}const a=info.account;return{binary:this.bin,cliVersion,account:a?{type:a.type,email:a.email||null,planType:a.planType||a.plan_type||null}:null,login:this.snapshot()};}
  if(b.action==='models')return this.temporary(async r=>{const info=await r.call('account/read',{refreshToken:true});if(info.account?.type!=='chatgpt')throw Error('Sign in with your ChatGPT subscription first. API-key billing is not substituted.');return{...await listModels(r,b.includeHidden!==false),cliVersion:await this.versionReader(),binary:this.bin};});
  if(this.busy)throw Error('A Codex account operation is already in progress.');this.busy=true;
  try{
   if(b.action==='start'){
    if(this.login?.status==='pending')return{login:this.snapshot()};this.close();const rpc=this.factory();this.rpc=rpc;
    const events=m=>{if(m.method==='account/login/completed'&&this.login&&m.params?.loginId===this.login.loginId){this.login={...this.login,status:m.params.success?'completed':'failed',error:m.params.error||null,userCode:undefined};clearTimeout(this.timer);} };
    rpc.listeners.add(events);rpc.errorListeners.add(e=>{if(this.login?.status==='pending')this.login={...this.login,status:'failed',error:e.message,userCode:undefined};});
    try{await timeout(rpc.initialize(false));const r=await timeout(rpc.call('account/login/start',{type:'chatgptDeviceCode'}));const url=new URL(r.verificationUrl);if(r.type!=='chatgptDeviceCode'||!r.loginId||!r.userCode||url.protocol!=='https:'||!['auth.openai.com','chatgpt.com','auth.chatgpt.com'].includes(url.hostname))throw Error('CLI did not return a supported official device-code login. Update Codex or run codex login --device-auth in your server terminal.');this.login={status:'pending',loginId:r.loginId,verificationUrl:url.href,userCode:r.userCode,startedAt:new Date().toISOString()};this.timer=setTimeout(()=>{if(this.login?.status==='pending'){this.login={...this.login,status:'expired',userCode:undefined};this.rpc?.close();this.rpc=null;}},15*60*1000);this.timer.unref();return{login:this.snapshot()};}catch(e){this.close();throw e;}
   }
   if(b.action==='cancel'){if(this.rpc&&this.login?.status==='pending')await timeout(this.rpc.call('account/login/cancel',{loginId:this.login.loginId}));this.close();this.login={status:'cancelled'};return{login:this.snapshot()};}
   throw Error('Unsupported Codex account action.');
  }finally{this.busy=false;}
 }
 close(){clearTimeout(this.timer);this.rpc?.close();this.rpc=null;this.login=null;}
}
