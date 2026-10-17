/** Typed agent authoring over the existing studio; no new project store or renderer owner. */
import {AGENT_TOOLS,AGENT_PROTOCOL_VERSION,toolDefinition,validateArguments,requiredEffects} from './agent-catalog.mjs';
import {ProjectTools} from './agent-projects.mjs';
import {MediaTools} from './agent-media.mjs';
import {PROJECT_TOOLS} from './agent-project-schema.mjs';
import {agentError} from './agent-project-state.mjs';
import {lstat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {serveFile} from './studio-server.mjs';

const projectNames=new Set(PROJECT_TOOLS.map(tool=>tool.name));
export function agentCatalog(){return {app:'orch3stra-agent',protocolVersion:AGENT_PROTOCOL_VERSION,projectOwnership:'Server-published projects only. Browser-only edits must be published first; existing-project writes require expectedRevision.',tools:AGENT_TOOLS};}
export class AgentTools {
  constructor(services){this.projects=new ProjectTools(services);this.media=new MediaTools(services);}
  async handle(body){
    if(!body||typeof body.tool!=='string'||!body.arguments||typeof body.arguments!=='object')throw agentError('INVALID_ARGUMENTS','Supply {tool, arguments} from the agent catalogue.');
    const tool=toolDefinition(body.tool);
    if(!tool.agent)throw agentError('WRONG_TOOL_ROUTE','Use this tool through the CLI/MCP or its discovered endpoint.',400,{endpoint:tool.endpoint});
    validateArguments(tool,body.arguments);
    const {_allow=[],...args}=body.arguments;
    const missing=requiredEffects(tool,args).filter(effect=>!_allow.includes(effect));
    if(missing.length)throw agentError('AUTHORIZATION_REQUIRED','This action needs explicit user authorization for: '+missing.join(', '),403,{required:missing});
    return (projectNames.has(tool.name)?this.projects:this.media).handle(tool.name,args);
  }
}
export async function serveAgentBackup(studio,req,res,id){
  await studio.backups.ready;
  const backup=await studio.backups.handle({action:'get',id});
  if(backup.status!=='completed')throw agentError('BACKUP_NOT_READY','Only a completed, verified portable backup can be downloaded.',409);
  const path=studio.backups.path(id)+'.h3project',info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())throw agentError('INVALID_BACKUP','Backup is not a regular owned file.',409);
  const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
  if(hash.digest('hex')!==backup.sha256)throw agentError('BACKUP_HASH_CHANGED','Saved backup failed its recorded SHA-256 check. Preserve it for inspection.',409);
  res.setHeader('Content-Disposition','attachment; filename="'+id+'.h3project"');
  await serveFile(req,res,path,'application/json');
}
