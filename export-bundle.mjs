/** Collision-safe exports of owned completed files. No browser downloads or overwrites. */
import {mkdir,copyFile,lstat,realpath} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
async function hash(path){const h=createHash('sha256');for await(const b of createReadStream(path))h.update(b);return h.digest('hex');}
async function regular(path){try{return (await lstat(path)).isFile()&&!(await lstat(path)).isSymbolicLink();}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function saveBundle({directory,source,stem,sidecars=[],copyImpl=copyFile}){
 await mkdir(directory,{recursive:true,mode:0o700});
 const clean=String(stem).replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,100)||'Movie';
 const inputs=[{extension:'mp4',path:source},...sidecars];
 if(inputs.some(x=>!['mp4','srt','vtt','json'].includes(x.extension))||new Set(inputs.map(x=>x.extension)).size!==inputs.length)throw Error('Invalid export bundle.');
 const hashes=[];for(const i of inputs){if(!await regular(i.path))throw Error('Owned export file unavailable.');hashes.push(await hash(i.path));}
 for(let n=0;n<1000;n++){
  const name=clean+(n?' ('+n+')':''),files=inputs.map(i=>join(directory,name+'.'+i.extension));
  const present=[];let conflict=false;
  for(let i=0;i<files.length;i++){try{const st=await lstat(files[i]);present[i]=true;if(!st.isFile()||st.isSymbolicLink()||await hash(files[i])!==hashes[i]){conflict=true;break;}}catch(e){if(e.code==='ENOENT')present[i]=false;else throw e;}}
  if(conflict)continue;
  const existing=present.every(Boolean);
  // Complete an identical partial bundle in place. Never recopy its movie or overwrite any bytes.
  for(let i=0;i<files.length;i++)if(!present[i]){try{await copyImpl(inputs[i].path,files[i],constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;if(!await regular(files[i])||await hash(files[i])!==hashes[i]){conflict=true;break;}}}
  if(conflict)continue;
  for(let i=0;i<files.length;i++)if(await hash(files[i])!==hashes[i])throw Error('Saved export verification failed; preserve files and inspect before retrying.');
  return{stem:name,files:files.map((path,i)=>({path,sha256:hashes[i],extension:inputs[i].extension})),existing};
 }
 throw Error('No free export filename. Existing files were preserved.');
}

const saves=new Map();
export async function saveExportBundle(args){await mkdir(args.directory,{recursive:true,mode:0o700});const key=await realpath(args.directory)+"\0"+(String(args.stem).replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,100)||'Movie');const prior=saves.get(key)||Promise.resolve(),next=prior.catch(()=>{}).then(()=>saveBundle(args));saves.set(key,next);try{return await next;}finally{if(saves.get(key)===next)saves.delete(key);}}
