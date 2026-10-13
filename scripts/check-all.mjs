#!/usr/bin/env node
/** Local fixture checks. H3 data is redirected; HOME/CODEX_HOME and other environment are inherited. Partial storage isolation, not hermetic. */
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const python=process.env.PYTHON_BIN||'python3';
const jobs=['check-nemotron-install.mjs','check-provider-startup.cjs','check-storage-decoder.cjs','check.mjs','check-timing.mjs','check-planner-timing.mjs','check-render.mjs','check-workflows.mjs','check-direction.mjs','check-soundscapes.mjs','check-dialogue.mjs','check-studio.mjs','check-headless.mjs','check-runtime-config.mjs','check-pending-intent.mjs','check-ledger-ownership.mjs','check-startup-ownership.mjs','check-cli-shutdown.mjs','check-render-intent-http.mjs','check-export-bundle.mjs','check-portable-disk.mjs','check-backup-audit.mjs','check-ai.mjs','check-sequences.mjs','check-progress.mjs','check-edit.mjs','check-take-dependencies.mjs','check-finishing.mjs','check-references.mjs','check-film.mjs','check-generation-exclusion.mjs','check-codex.mjs','check-scenes.mjs','check-reference-agent.mjs','check-post.mjs','check-soundtrack-placement.mjs','check-coverage.mjs','check-reference-recovery.mjs','check-render-selection.mjs','check-inspection.mjs','check-candidate-review.mjs','check-scene-edit.mjs','check-sounds.mjs','check-reference-progress.mjs','check-reference-replacement.mjs','check-continuity.mjs','check-speech-review.mjs','check-speech-quality.mjs','check-speech-quality-server.mjs'].map(s=>[process.execPath,['scripts/'+s]]);
jobs.push([python,['-u','-m','unittest','discover','-s','tests']]);
if(process.argv.includes('--integration')){jobs.push([python,['-u','tests/gradio_dispatch_check.py']]);for(const n of ['offline','workflows','direction','soundscapes','dialogue','studio','headless','ai','sequences','progress','editor','references','film','scenes','post','coverage','render_selection','workspace','sounds','reference_progress','speech_review','speech_quality','crop','generation_exclusion','music','confirm','timing','planner_timing','media_security'])jobs.push([python,['-u','tests/browser_'+n+'_check.py']]);}
const testEnv={...process.env};for(const key of Object.keys(testEnv))if(key.startsWith('H3_'))delete testEnv[key];testEnv.H3_WANGP_BACKEND='legacy';testEnv.H3_VOICE_PYTHON=python; // Explicit test interpreter; never use the user's WanGP env.
const disposableData=mkdtempSync(join(tmpdir(),'orch3stra-check-all-'));testEnv.H3_DATA_DIR=disposableData;process.on('exit',()=>rmSync(disposableData,{recursive:true,force:true}));
testEnv.GRADIO_ANALYTICS_ENABLED='False';
for(const [bin,args]of jobs){const started=Date.now();console.log('\n=== '+bin+' '+args.join(' ')+' ===');const r=spawnSync(bin,args,{cwd:root,stdio:'inherit',timeout:300000,env:testEnv});if(r.error||r.status!==0){console.error(r.error?.message||'Check failed with exit '+r.status);process.exit(r.status||1);}console.log('Finished in '+((Date.now()-started)/1000).toFixed(1)+'s');}
console.log('\nAll requested local checks passed. No live model/GPU verification is implied.');
