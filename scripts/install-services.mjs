#!/usr/bin/env node
/** Generates user units only. Never starts GPU work or changes system services. */
import {mkdir,writeFile,access,readFile,lstat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {configuration} from '../start-headless.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const quote=s=>'"'+String(s).replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('%','%%')+'"';
const argument=s=>quote(s).replaceAll('$','$$');
const working=s=>{s=String(s);if(/[\r\n\0]/.test(s))throw Error('Service paths may not contain control characters.');return s.replaceAll('%','%%');};
const env=(k,v)=>'Environment='+quote(k+'='+v)+'\n';
export function units(c,root=ROOT,node=process.execPath){
 const vars=env('H3_PYTHON',c.python)+env('H3_DATA_DIR',c.data)+env('H3_HEADLESS_DATA_DIR',c.directory)+env('H3_WANGP_ROOT',c.root)+env('PATH',process.env.PATH||'/usr/local/bin:/usr/bin:/bin');
 return {
 'h3-wangp.service':`[Unit]\nDescription=Orch3stra standalone WanGP renderer\nAfter=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${working(c.root)}\n${vars}Environment=GRADIO_ANALYTICS_ENABLED=False\nEnvironmentFile=-%h/.config/h3-director/service.env\nExecStart=${argument(c.python)} -u ${argument(join(root,'headless/server.py'))} --root ${argument(c.root)} --data-dir ${argument(c.directory)} --port ${c.port}\nUMask=0077\nRestart=no\nTimeoutStopSec=90\n\n[Install]\nWantedBy=default.target\n`,
 'h3-director.service':`[Unit]\nDescription=Orch3stra editor and sequence coordinator\nWants=h3-wangp.service\nAfter=h3-wangp.service\n\n[Service]\nType=simple\nWorkingDirectory=${working(root)}\n${vars}${env('H3_WANGP_BACKEND','headless')}${env('H3_HOST',process.env.H3_HOST||'127.0.0.1')}${env('H3_PORT',process.env.H3_PORT||'8765')}EnvironmentFile=-%h/.config/h3-director/service.env\nExecStart=${argument(node)} ${argument(join(root,'bridge.mjs'))}\nUMask=0077\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=15\n\n[Install]\nWantedBy=default.target\n`
 };
}
export async function installUnits(directory,desired){
 await mkdir(directory,{recursive:true});
 // Review all existing bytes before any write. Existing explicit LAN bindings are preserved.
 for(const [name,text]of Object.entries(desired)){try{const st=await lstat(join(directory,name));if(!st.isFile()||st.isSymbolicLink()||await readFile(join(directory,name),'utf8')!==text)throw Error('Existing '+name+' differs. Preserved all existing units; compare the proposed units and migrate explicitly.');}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const [name,text]of Object.entries(desired)){try{await writeFile(join(directory,name),text,{mode:0o600,flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;const st=await lstat(join(directory,name));if(!st.isFile()||st.isSymbolicLink()||await readFile(join(directory,name),'utf8')!==text)throw Error('Service file changed during installation; existing bytes preserved. Review before retry.');}}
}
async function main(){if(!process.argv.includes('--install')){console.log('Run node scripts/install-services.mjs --install after testing headless rendering.\nWrites two systemd USER units for this exact folder, without starting them. Keep the app at a stable path.');return;}const c=configuration();await access(c.python);await access(join(c.root,'shared/api.py'));const dir=join(homedir(),'.config/systemd/user');await installUnits(dir,units(c));console.log('Wrote h3-wangp.service and h3-director.service to '+dir+'\nAfter both manual servers are idle and stopped:\n  systemctl --user daemon-reload\n  systemctl --user enable --now h3-wangp.service h3-director.service\nRead HEADLESS.md before enabling login/boot persistence.');}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
