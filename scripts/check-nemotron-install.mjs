/** Real offline Python imports of synthetic staged modules; no pip, models or network. */
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rename,rm} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {installNemotronOverlay,NEMOTRON_IMPORT_SMOKE,SMOKE_ENV} from './nemotron-overlay.mjs';
const execute=promisify(execFile),python=process.env.PYTHON_BIN||'python3';let passed=0;
async function fixture(root,missing=''){
 const files={
  'transformers/__init__.py':`class NeverLoad:\n def __new__(cls,*a,**k): raise AssertionError('No model construction')\n @classmethod\n def from_pretrained(cls,*a,**k): raise AssertionError('No model downloads')\n${missing==='AutoProcessor'?'':'class AutoProcessor(NeverLoad): pass\n'}${missing==='AutoModelForAudioFrameClassification'?'':'class AutoModelForAudioFrameClassification(NeverLoad): pass\n'}`,
  'transformers/models/__init__.py':'', 'transformers/models/auto/__init__.py':'',
  'transformers/models/auto/configuration_auto.py':"CONFIG_MAPPING_NAMES={'nemotron3_diarization':'SyntheticConfig'}\n",
  'transformers/models/nemotron3_diarization/__init__.py':'',
  'transformers/models/nemotron3_diarization/processing_nemotron3_diarization.py':missing==='Nemotron3DiarizationProcessor'?'':"class Nemotron3DiarizationProcessor:\n def __new__(cls,*a,**k): raise AssertionError('No processor construction')\n",
 };
 for(const [name,text]of Object.entries(files)){const p=join(root,name);await mkdir(join(p,'..'),{recursive:true});await writeFile(p,text);}
}
async function context(fn){const root=await mkdtemp(join(tmpdir(),'nemotron-install-check-')),target=join(root,'overlay');try{await mkdir(target);await writeFile(join(target,'original'),'original bytes');await fn({root,target});assert.equal((await readdir(root)).filter(n=>n.startsWith('nemotron-install-')).length,0,'Failed staging directories must be removed');}finally{await rm(root,{recursive:true,force:true});}}
async function smoke(stage,extraEnv={}){const {stdout}=await execute(python,['-B','-c',NEMOTRON_IMPORT_SMOKE,stage],{env:{...process.env,...SMOKE_ENV,...extraEnv},timeout:10000});assert.match(stdout,/staged processor\/model imports passed/);}
async function check(name,fn){await fn();console.log('PASS '+name);passed++;}
await check('Fresh staged imports succeed before promotion; original overlay backup is retained',()=>context(async({target})=>{
 const result=await installNemotronOverlay({target,installStage:fixture,validateStage:smoke});assert.equal(await readFile(join(result.backup,'original'),'utf8'),'original bytes');assert.match(await readFile(join(target,'transformers/__init__.py'),'utf8'),/AutoProcessor/);
}));
for(const missing of ['AutoProcessor','AutoModelForAudioFrameClassification','Nemotron3DiarizationProcessor'])await check('Mapping alone cannot promote a stage missing '+missing,()=>context(async({root,target})=>{
 await assert.rejects(installNemotronOverlay({target,installStage:stage=>fixture(stage,missing),validateStage:smoke}),error=>error.stderr?.includes(missing));assert.equal(await readFile(join(target,'original'),'utf8'),'original bytes');assert.equal((await readdir(root)).filter(n=>n.startsWith('overlay.backup-')).length,0);
}));
await check('An installed/base Transformers fallback cannot masquerade as the fresh stage',()=>context(async({root,target})=>{
 const fallback=join(root,'base-site');await fixture(fallback);await assert.rejects(installNemotronOverlay({target,installStage:async stage=>writeFile(join(stage,'unrelated'),'fixture'),validateStage:stage=>smoke(stage,{PYTHONPATH:fallback})}),error=>error.stderr?.includes('not imported from the new staging overlay'));assert.equal(await readFile(join(target,'original'),'utf8'),'original bytes');
}));
await check('Installation failure leaves target untouched and removes partial staging',()=>context(async({target})=>{
 let validated=false;await assert.rejects(installNemotronOverlay({target,installStage:async stage=>{await writeFile(join(stage,'partial'),'fixture');throw Error('Synthetic install failure');},validateStage:async()=>{validated=true;}}),/Synthetic install failure/);assert.equal(validated,false);assert.equal(await readFile(join(target,'original'),'utf8'),'original bytes');
}));
await check('Promotion failure restores original target and removes unpromoted stage',()=>context(async({target})=>{
 const renamePath=async(a,b)=>{if(basename(a).startsWith('nemotron-install-'))throw Object.assign(Error('Synthetic promotion failure'),{code:'EIO'});await rename(a,b);};await assert.rejects(installNemotronOverlay({target,installStage:fixture,validateStage:smoke,renamePath}),/Synthetic promotion failure/);assert.equal(await readFile(join(target,'original'),'utf8'),'original bytes');
}));
await check('Failed rollback reports the retained original backup instead of hiding restoration failure',()=>context(async({root,target})=>{
 const renamePath=async(a,b)=>{if(basename(a).startsWith('nemotron-install-')||a.startsWith(target+'.backup-'))throw Object.assign(Error('Synthetic rename failure'),{code:'EACCES'});await rename(a,b);};await assert.rejects(installNemotronOverlay({target,installStage:fixture,validateStage:smoke,renamePath}),error=>error instanceof AggregateError&&error.message.includes(target+'.backup-'));const backup=(await readdir(root)).find(n=>n.startsWith('overlay.backup-'));assert(backup);assert.equal(await readFile(join(root,backup,'original'),'utf8'),'original bytes');
}));
await check('First installation can promote a validated stage without an existing overlay',()=>context(async({target})=>{
 await rm(target,{recursive:true});const result=await installNemotronOverlay({target,installStage:fixture,validateStage:smoke});assert.equal(result.backup,null);assert.match(await readFile(join(target,'transformers/__init__.py'),'utf8'),/AutoProcessor/);
}));
console.log(`${passed} offline installer staging/rollback checks passed; no packages installed or models loaded.`);
