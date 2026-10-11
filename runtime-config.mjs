/** Nonsecret, explicitly reviewed runtime paths. Never installs or changes credentials. */
import {existsSync,readFileSync} from 'node:fs';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
const packageRoot=dirname(fileURLToPath(import.meta.url));
export function runtimeConfig(env=process.env){
 const data=resolve(env.H3_DATA_DIR||join(homedir(),'.local/share/h3-director'));
 let saved={};const path=join(data,'runtime-settings.json');
 if(existsSync(path)){try{saved=JSON.parse(readFileSync(path,'utf8'));if(saved.version!==1||typeof saved.root!=='string'||typeof saved.python!=='string')throw Error();}catch{throw Error('Invalid runtime-settings.json. Review or restore this nonsecret settings file before using --setup; existing data and token are preserved.');}}
 const candidates=[resolve(packageRoot,'..','Wan2GP'),resolve(process.cwd(),'..','Wan2GP'),join(homedir(),'Wan2GP')];
 const root=resolve(env.H3_WANGP_ROOT||saved.root||candidates.find(p=>existsSync(join(p,'shared/api.py'))&&existsSync(join(p,'wgp.py')))||candidates[0]);
 const python=env.H3_PYTHON||env.H3_WANGP_PYTHON||(!env.H3_WANGP_ROOT&&saved.python)||join(root,'.venv',process.platform==='win32'?'Scripts':'bin',process.platform==='win32'?'python.exe':'python');
 return{data,root,python,settingsPath:path,configured:!!(env.H3_WANGP_ROOT||saved.root),discovered:candidates.includes(root)&&existsSync(join(root,'shared/api.py'))};
}
export async function saveRuntimeConfig(env,{root,python,replace=false}){
 const c=runtimeConfig(env);if(!root||!python)throw Error('Choose both the existing WanGP folder and its Python interpreter.');
 const next={version:1,root:resolve(root),python:resolve(python)};
 if(!existsSync(join(next.root,'shared/api.py'))||!existsSync(join(next.root,'wgp.py'))||!existsSync(next.python))throw Error('Selected WanGP folder/interpreter is missing. Nothing was saved or installed.');
 await mkdir(c.data,{recursive:true,mode:0o700});
 if(!replace){await writeFile(c.settingsPath,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});}
 else{const tmp=c.settingsPath+'.tmp';await writeFile(tmp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});await rename(tmp,c.settingsPath);}
 return next;
}
