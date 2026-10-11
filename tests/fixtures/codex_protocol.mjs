#!/usr/bin/env node
// Offline protocol fixture. Never authenticates to a service.
import {createInterface} from 'node:readline';
const mode=process.argv[2]||'signed';let signed=mode!=='login'&&mode!=='badurl';const send=x=>process.stdout.write(JSON.stringify(x)+'\n');
const a={id:'gpt-6-sol-fixture',model:'gpt-6-sol-fixture',displayName:'GPT 6 Sol (fixture)',defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Balanced'},{reasoningEffort:'high',description:'High'}],inputModalities:['text','image']};let threadSandbox='',threadCwd='',threadEphemeral=false;
createInterface({input:process.stdin}).on('line',line=>{
 let m;try{m=JSON.parse(line);}catch{return;}
 if(m.id===undefined)return;
 const{id,method,params:p}=m,ok=result=>send({id,result});
 const invalidSandbox=(value,expected)=>send({id,error:{message:'unknown variant `'+value+'`, expected one of '+expected.map(v=>'`'+v+'`').join(', ')}});
 if(method==='initialize')return ok({userAgent:'fixture'});
 if(method==='account/read')return ok({account:signed?{type:mode==='apikey'?'apiKey':'chatgpt',email:'fixture@example.invalid',planType:'test'}:null});
 if(method==='account/login/start'){
  ok({type:'chatgptDeviceCode',loginId:'fixture-login',userCode:'ABCD-1234',verificationUrl:mode==='badurl'?'https://evil.invalid/device':'https://auth.openai.com/codex/device'});
  if(mode==='login')setTimeout(()=>{signed=true;send({method:'account/login/completed',params:{loginId:'fixture-login',success:true,error:null}});},75);
  return;
 }
 if(method==='account/login/cancel')return ok({status:'cancelled'});
 if(method==='model/list'){
  if(mode==='repeat')return ok({data:[a],nextCursor:'repeated'});
  if(!p.cursor)return ok({data:[a],nextCursor:'page-two'});
  return ok({data:[a,{id:'hidden-fixture',displayName:'Hidden test',hidden:true}],nextCursor:null});
 }
 if(method==='thread/start'){
  if(p.sandbox!=='read-only')return invalidSandbox(p.sandbox,['read-only','workspace-write','danger-full-access']);
  threadSandbox=p.sandbox;threadCwd=p.cwd;threadEphemeral=p.ephemeral===true;
  return ok({thread:{id:'thread-fixture'}});
 }
 if(method==='turn/start'){
  if(p.sandboxPolicy?.type!=='readOnly')return invalidSandbox(p.sandboxPolicy?.type,['dangerFullAccess','readOnly','externalSandbox','workspaceWrite']);
  if(Object.hasOwn(p.sandboxPolicy,'access'))return send({id,error:{message:'readOnly.access is no longer supported; use permissionProfile for restricted reads'}});
  ok({turn:{id:'t',status:'inProgress'}});
  const text=JSON.stringify({model:p.model,effort:p.effort||null,approval:p.approvalPolicy,sandbox:p.sandboxPolicy.type,sandboxPolicy:p.sandboxPolicy,threadSandbox,threadCwd,threadEphemeral,turnCwd:p.cwd,images:p.input.filter(i=>i.type==='image').length,apiKeyPresent:!!process.env.OPENAI_API_KEY});
  send({method:'item/completed',params:{threadId:'thread-fixture',item:{type:'agentMessage',phase:'final_answer',text}}});
  return send({method:'turn/completed',params:{threadId:'thread-fixture',turn:{status:'completed'}}});
 }
 send({id,error:{message:'Unexpected fixture method '+method}});
});
