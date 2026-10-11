/** Disposable bridge state for standalone fixtures; never inherit user's private data. */
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const roots=[];
export function disposableData(){const root=mkdtempSync(join(tmpdir(),'orch3stra-fixture-'));roots.push(root);return root;}
process.on('exit',()=>{for(const root of roots)rmSync(root,{recursive:true,force:true});});
