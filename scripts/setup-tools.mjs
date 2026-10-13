#!/usr/bin/env node
/** Explicit installs only. One venv; a dependency-only overlay protects WanGP's pinned Transformers. */
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {sharedPython} from '../python-env.mjs';
import {installNemotronOverlay,NEMOTRON_IMPORT_SMOKE,SMOKE_ENV} from './nemotron-overlay.mjs';
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..'),python=sharedPython(),data=resolve(process.env.H3_DATA_DIR||join(homedir(),'.local/share/h3-director'));
function run(args,capture=false,options={}){return new Promise((resolve,reject)=>{const p=spawn(python,args,{shell:false,env:{...process.env,...options.env},...(options.timeout?{timeout:options.timeout,killSignal:'SIGKILL'}:{}),stdio:capture?['ignore','pipe','inherit']:'inherit'});let text='';p.stdout?.on('data',b=>text+=b);p.on('error',reject);p.on('close',(c,signal)=>c===0?resolve(text):reject(Error('Command failed ('+(signal||c)+'). No renderer was restarted.')));});}
try{
 const arg=process.argv[2]||'--check';if(!['--check','--install-tools','--nemotron'].includes(arg))throw Error('Use --check, --install-tools, or --nemotron. Installs should run only between renders.');
 console.log('Shared interpreter: '+python);
 if(arg==='--check'){await run(['-c',`import sys,importlib.util,importlib.metadata as m,json; names=['torch','transformers','numpy','faster-whisper','yt-dlp','pyannote.audio']; print('Executable:',sys.executable); print(json.dumps({n:(m.version(n) if m.packages_distributions() and any(d.metadata['Name'].lower()==n.lower() for d in m.distributions()) else 'not installed') for n in names},indent=2))`]);process.exit(0);}
 const audit=join(data,'environment-backups',String(Date.now()));await mkdir(audit,{recursive:true,mode:0o700});await writeFile(join(audit,'freeze.txt'),await run(['-m','pip','freeze'],true),{mode:0o600});
 const versions=JSON.parse(await run(['-c',`import importlib.metadata as m,json; out={}; exec("for n in ['torch','torchaudio','torchvision','numpy','scipy','transformers','tokenizers','gradio','mmgp','pyannote.audio']:\\n try: out[n]=m.version(n)\\n except m.PackageNotFoundError: pass"); print(json.dumps(out))`],true));
 if(!versions.torch)throw Error('This interpreter does not contain WanGP’s torch. Point H3_PYTHON at WanGP/.venv/bin/python.');
 const pins=Object.entries(versions).filter(([n])=>arg==='--install-tools'||!['transformers','tokenizers'].includes(n)).map(([n,v])=>`${n}==${v}`).join('\n');const constraints=join(audit,'constraints.txt');await writeFile(constraints,pins+'\n');
 if(arg==='--install-tools'){await run(['-m','pip','install','-c',constraints,'-r',join(ROOT,'requirements-tools.txt')]);await run(['-m','pip','check']);}
 else{
  const target=process.env.H3_NEMOTRON_PACKAGES||join(data,'python-overlays','nemotron');await mkdir(dirname(target),{recursive:true,mode:0o700});
  console.log('Installing pinned Transformers (requirements-nemotron.txt) for the Nemotron subprocess ONLY into '+target+'. Same Python; no new venv; WanGP site-packages remain untouched.');
  const installed=await installNemotronOverlay({target,installStage:stage=>run(['-m','pip','install','--target',stage,'--upgrade','--no-compile','-c',constraints,'-r',join(ROOT,'requirements-nemotron.txt')]),validateStage:stage=>run(['-B','-c',NEMOTRON_IMPORT_SMOKE,stage],false,{env:SMOKE_ENV,timeout:60000})});
  if(installed.backup)console.log('Previous overlay preserved: '+installed.backup);
  console.log('Restart Director Node to pick up settings. The helper reads this overlay before importing Transformers. No GPU-worker restart is needed for this overlay.');
 }
 console.log('Original package inventory: '+audit+'/freeze.txt (inventory, not a complete rollback image).');
}catch(e){console.error(e.message);process.exitCode=1;}
