/** Staged overlay validation/promotion only; no backend, model or installer execution on import. */
import {mkdir,mkdtemp,rename,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const NEMOTRON_IMPORT_SMOKE = `import sys
from pathlib import Path
stage = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(stage))
import transformers
assert Path(transformers.__file__).resolve().is_relative_to(stage), 'Transformers was not imported from the new staging overlay'
from transformers import AutoProcessor, AutoModelForAudioFrameClassification
from transformers.models.nemotron3_diarization.processing_nemotron3_diarization import Nemotron3DiarizationProcessor
from transformers.models.auto.configuration_auto import CONFIG_MAPPING_NAMES
assert 'nemotron3_diarization' in CONFIG_MAPPING_NAMES, 'No native Nemotron3 diarization support'
print('Nemotron staged processor/model imports passed (offline; no models loaded).')
`;
export const SMOKE_ENV = Object.freeze({HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_DATASETS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1',CUDA_VISIBLE_DEVICES:''});
export async function installNemotronOverlay({target,installStage,validateStage,renamePath=rename}) {
 await mkdir(dirname(target),{recursive:true,mode:0o700});
 const stage=await mkdtemp(join(dirname(target),'nemotron-install-'));
 let backup=null;
 try {
  await installStage(stage);
  await validateStage(stage);
  const saved=target+'.backup-'+randomUUID();
  try{await renamePath(target,saved);backup=saved;}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await renamePath(stage,target);}catch(promotionError){
   if(backup){try{await renamePath(backup,target);}catch(restoreError){throw new AggregateError([promotionError,restoreError],'Overlay promotion and rollback failed. Original overlay remains at '+backup+'; preserve it and restore explicitly.');}}
   throw promotionError;
  }
  return {target,backup};
 } finally {await rm(stage,{recursive:true,force:true});}
}
