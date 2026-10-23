#!/usr/bin/env node
/** Dependency-free CLI and MCP stdio access to Orch3stra's real tools. */
import {readFile,writeFile,stat,readdir} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline';
import {AgentClient,AgentError,errorRecord} from './agent-client.mjs';
import {AGENT_TOOLS,AGENT_PROTOCOL_VERSION,toolDefinition} from './agent-catalog.mjs';

const ROOT=dirname(fileURLToPath(import.meta.url));
const SKILL=join(ROOT,'.agents/skills/make-film');
const HELP=`Orch3stra agent tools (Node 22+, no npm install)

  node orch3stra.mjs tools                         Discover all tools and effects
  node orch3stra.mjs describe project              Read a tool's schema and examples
  node orch3stra.mjs doctor                        Check real studio/auth/capabilities
  node orch3stra.mjs call TOOL --json JSON          Call a tool (@file or - for stdin)
  node orch3stra.mjs wait TOOL JOB_ID               Observe an existing job, never retry
  node orch3stra.mjs reference editImage --json JSON Set plate: new angle of the same place (reference_edit)
  node orch3stra.mjs soundtrack set --json JSON     Keep an owned audio asset as window soundtrack (WanGP AS)
  node orch3stra.mjs voice dialogue --json JSON     Fish Drama 3 multi-speaker dialogue WAV (voice_dialogue)
  node orch3stra.mjs upload FILE --type MIME        Upload real media (immutable key)
  node orch3stra.mjs download API_URL --output FILE Download media without overwriting
  node orch3stra.mjs pair --password-stdin --cookie-file FILE
  node orch3stra.mjs mcp                           Serve MCP JSON-RPC on stdio

Options: --url ORIGIN, --cookie-file FILE, --allow cpu,gpu,provider,network,delete
Upload: --destination studio|worker|voice (default studio), --key MEDIA_KEY
Wait: --timeout-ms 120000, --interval-ms 1500
Connection defaults: ORCH3STRA_URL (http://127.0.0.1:8765), ORCH3STRA_COOKIE.
Read .agents/skills/make-film/SKILL.md before making a film.
Allow flags are explicit authorization scopes, not licence acceptance or a safety sandbox.
Uncertain requests are never replayed. Publish browser-only projects before agent editing.
`;

function options(argv){
  const positional=[],flags={};
  const valued=new Set(['url','cookie-file','allow','json','type','destination','key','output','timeout-ms','interval-ms']);
  for(let i=0;i<argv.length;i++){
    const item=argv[i];
    if(item==='--help'||item==='-h'){flags.help=true;continue;}
    if(item==='--password-stdin'){flags['password-stdin']=true;continue;}
    if(item.startsWith('--')){const key=item.slice(2);if(!valued.has(key))throw new AgentError('INVALID_ARGUMENTS','Unknown option '+item);if(i+1>=argv.length||argv[i+1].startsWith('--'))throw new AgentError('INVALID_ARGUMENTS','Missing value for '+item);if(Object.hasOwn(flags,key))throw new AgentError('INVALID_ARGUMENTS','Duplicate option '+item);flags[key]=argv[++i];}
    else positional.push(item);
  }
  return {positional,flags};
}
async function stdin(){let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>32*1024*1024)throw new AgentError('INPUT_TOO_LARGE','JSON input exceeds 32 MiB.');}return text;}
async function jsonInput(raw){
  if(raw===undefined)return {};
  const text=raw==='-'?await stdin():raw.startsWith('@')?await readFile(resolve(raw.slice(1)),'utf8'):raw;
  try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected object');return value;}catch(error){throw new AgentError('INVALID_JSON','Supply a JSON object, @file, or - for stdin: '+error.message);}
}
async function cookieFile(path){const info=await stat(path);if(!info.isFile()||(info.mode&0o077))throw new AgentError('PRIVATE_FILE_REQUIRED','Cookie file must be a private regular file (chmod 600).');const value=(await readFile(path,'utf8')).trim();if(!/^h3studio=[A-Za-z0-9_-]{43}$/.test(value))throw new AgentError('INVALID_COOKIE','Cookie file must contain h3studio=<session>, not a password or full browser profile.');return value;}
function allowed(flags,args={}){return flags.allow?{...args,_allow:flags.allow.split(',').filter(Boolean)}:args;}
function print(value){process.stdout.write(JSON.stringify(value,null,2)+'\n');}
function exitFor(value){if(value?.outcome==='timeout')process.exitCode=2;else if(value?.outcome==='attention')process.exitCode=3;}

async function resourceList(){
  const files=['SKILL.md'];
  for(const name of await readdir(join(SKILL,'references')))if(name.endsWith('.md'))files.push('references/'+name);
  return files.map(file=>({uri:'orch3stra://filmmaking/'+file,name:file,mimeType:'text/markdown',description:file==='SKILL.md'?'Start here: complete filmmaking workflow, safety and quality review.':'Detailed filmmaking reference: '+file}));
}
async function readResource(uri){const resources=await resourceList(),match=resources.find(resource=>resource.uri===uri);if(!match)throw new AgentError('UNKNOWN_RESOURCE','Unknown filmmaking resource. Use resources/list.');return {contents:[{uri,mimeType:'text/markdown',text:await readFile(join(SKILL,match.name),'utf8')}]};}
export async function serveMCP(client){
  const send=message=>process.stdout.write(JSON.stringify(message)+'\n');
  const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  const pending=new Set();
  async function handle(message){
    const {id,method,params={}}=message;
    if(id===undefined)return; // Notifications, including initialized/cancelled, have no response.
    let result;
    try{
      switch(method){
        case 'initialize':result={protocolVersion:['2024-11-05','2025-03-26','2025-06-18'].includes(params.protocolVersion)?params.protocolVersion:'2025-06-18',capabilities:{tools:{},resources:{},prompts:{}},serverInfo:{name:'orch3stra',version:AGENT_PROTOCOL_VERSION},instructions:'Read orch3stra://filmmaking/SKILL.md first. Use doctor and schemas. Projects are server-published copies; edits use revision CAS. _allow is explicit user authorization, never automatic consent. Never replay an uncertain render.'};break;
        case 'ping':result={};break;
        case 'tools/list':result={tools:AGENT_TOOLS.map(({name,description,inputSchema,annotations})=>({name,description,inputSchema,annotations}))};break;
        case 'tools/call':{
          if(typeof params.name!=='string')throw new AgentError('INVALID_ARGUMENTS','tools/call needs a tool name.');
          try{const value=await client.call(params.name,params.arguments||{});const attention=value?.outcome&&value.outcome!=='completed';result={isError:!!attention,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value&&typeof value==='object'&&!Array.isArray(value)?value:{result:value}};}
          catch(error){const failure={ok:false,error:errorRecord(error)};result={isError:true,content:[{type:'text',text:JSON.stringify(failure)}],structuredContent:failure};}
          break;
        }
        case 'resources/list':result={resources:await resourceList()};break;
        case 'resources/read':result=await readResource(params.uri);break;
        case 'prompts/list':result={prompts:[{name:'make_film',description:'Plan, produce, review, and finish an original film using the real Orch3stra tools.',arguments:[{name:'brief',description:'Creative brief and audience, plus any hard requirements.',required:true},{name:'constraints',description:'Duration, budget, permitted providers/GPU work, rights and delivery constraints.'}]}]};break;
        case 'prompts/get':{
          if(params.name!=='make_film'||typeof params.arguments?.brief!=='string')throw new AgentError('INVALID_ARGUMENTS','Use make_film with a brief.');
          result={description:'Orch3stra filmmaking workflow',messages:[{role:'user',content:{type:'text',text:(await readFile(join(SKILL,'SKILL.md'),'utf8'))+'\n\n## Requested film\n'+params.arguments.brief+'\n\n## User constraints\n'+(params.arguments.constraints||'No additional paid-provider/GPU authorization supplied. Clarify material budget/rights choices before dispatch.')}}]};break;
        }
        default:send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found: '+method}});return;
      }
      send({jsonrpc:'2.0',id,result});
    }catch(error){send({jsonrpc:'2.0',id,error:{code:-32602,message:error.message,data:errorRecord(error)}});}
  }
  for await(const line of lines){
    if(!line.trim())continue;
    let message;try{message=JSON.parse(line);if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string')throw Error('Expected JSON-RPC 2.0 request');}catch(error){send({jsonrpc:'2.0',id:null,error:{code:-32700,message:error.message}});continue;}
    // A read-only wait must not block cancellation/inspection calls from the host.
    const work=handle(message);pending.add(work);work.finally(()=>pending.delete(work));
  }
  await Promise.allSettled(pending);
}

export async function main(argv=process.argv.slice(2)){
  const {positional,flags}=options(argv),[command,...rest]=positional;
  if(flags.help||!command){process.stdout.write(HELP);return;}
  if(Number(process.versions.node.split('.')[0])<22)throw new AgentError('NODE_VERSION','Orch3stra agent tools require Node 22 or newer; found '+process.versions.node+'. Select an installed supported Node executable.');
  if(command==='tools'){print({protocolVersion:AGENT_PROTOCOL_VERSION,tools:AGENT_TOOLS});return;}
  if(command==='describe'){if(rest.length!==1)throw new AgentError('INVALID_ARGUMENTS','describe needs exactly one tool name.');print(toolDefinition(rest[0]));return;}
  const client=new AgentClient({url:flags.url,cookie:command!=='pair'&&flags['cookie-file']?await cookieFile(resolve(flags['cookie-file'])):process.env.ORCH3STRA_COOKIE||''});
  if(command==='mcp'){await serveMCP(client);return;}
  if(command==='pair'){
    if(!flags['password-stdin']||!flags['cookie-file'])throw new AgentError('INVALID_ARGUMENTS','pair requires --password-stdin and --cookie-file; never pass passwords in argv.');
    const password=(await stdin()).trim();if(!password)throw new AgentError('INVALID_ARGUMENTS','No pairing password on stdin.');
    const response=await client.response('/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password}),mutation:true});
    if(!response.ok){const data=await response.json();throw new AgentError('PAIR_FAILED',data.error||'Pairing failed');}
    const cookie=response.headers.get('set-cookie')?.split(';')[0];if(!cookie?.startsWith('h3studio='))throw new AgentError('PAIR_FAILED','Studio did not issue a session cookie.');
    const path=resolve(flags['cookie-file']);await writeFile(path,cookie+'\n',{mode:0o600,flag:'wx'});print({paired:true,cookieFile:path,url:client.url});return;
  }
  let result;
  switch(command){
    case 'doctor':result=await client.call('doctor',{});break;
    case 'call':if(rest.length<1||rest.length>2)throw new AgentError('INVALID_ARGUMENTS','call needs TOOL and --json JSON (or a positional JSON object).');result=await client.call(rest[0],allowed(flags,await jsonInput(flags.json??rest[1])));break;
    case 'wait':if(rest.length!==2)throw new AgentError('INVALID_ARGUMENTS','wait needs TOOL JOB_ID.');result=await client.call('job_wait',allowed(flags,{tool:rest[0],id:rest[1],...(flags['timeout-ms']?{timeoutMs:Number(flags['timeout-ms'])}:{}),...(flags['interval-ms']?{intervalMs:Number(flags['interval-ms'])}:{})}));break;
    case 'reference':if(rest[0]!=='editImage'||rest.length>2)throw new AgentError('INVALID_ARGUMENTS','Use: reference editImage --json JSON (see describe reference_edit).');result=await client.call('reference_edit',allowed(flags,await jsonInput(flags.json??rest[1])));break;
    case 'voice':if(rest[0]!=='dialogue'||rest.length>2)throw new AgentError('INVALID_ARGUMENTS','Use: voice dialogue --json JSON (see describe voice_dialogue).');result=await client.call('voice_dialogue',allowed(flags,await jsonInput(flags.json??rest[1])));break;
    case 'soundtrack':if(rest[0]!=='set'||rest.length>2)throw new AgentError('INVALID_ARGUMENTS','Use: soundtrack set --json JSON (timeline action soundtrack).');result=await client.call('timeline',allowed(flags,{...await jsonInput(flags.json??rest[1]),action:'soundtrack'}));break;
    case 'upload':if(rest.length!==1||!flags.type)throw new AgentError('INVALID_ARGUMENTS','upload needs FILE --type MIME.');result=await client.call('media_upload',allowed(flags,{file:rest[0],type:flags.type,...(flags.key?{key:flags.key}:{}),...(flags.destination?{destination:flags.destination}:{})}));break;
    case 'download':if(rest.length!==1||!flags.output)throw new AgentError('INVALID_ARGUMENTS','download needs API_URL --output FILE.');result=await client.call('media_download',allowed(flags,{url:rest[0],output:flags.output}));break;
    default:throw new AgentError('INVALID_ARGUMENTS','Unknown command '+command+'. Use --help.');
  }
  print(result);exitFor(result);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{print({ok:false,error:errorRecord(error)});process.exitCode=1;});
