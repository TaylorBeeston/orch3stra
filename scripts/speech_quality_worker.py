#!/usr/bin/env python3
"""Offline CPU ASR with word alignment of observed text only. No script prompt/downloads."""
import json,os,sys,subprocess,tempfile,importlib.util
from pathlib import Path
os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',CUDA_VISIBLE_DEVICES='',PYANNOTE_METRICS_ENABLED='0',OMP_NUM_THREADS='2')
MODELS={'small.en':'Systran/faster-whisper-small.en','small':'Systran/faster-whisper-small'}
def cached(repo,required):
 root=Path(os.environ.get('HF_HUB_CACHE',str(Path(os.environ.get('HF_HOME',str(Path.home()/'.cache/huggingface')))/'hub')))/('models--'+repo.replace('/','--'))
 ref=root/'refs/main'
 if not ref.is_file():return None
 path=root/'snapshots'/ref.read_text().strip()
 return str(path) if all((path/f).is_file() for f in required) else None
def capabilities():
 return {'device':'cpu','offlineOnly':True,'alignment':'faster-whisper observed-word alignment; no forced script alignment','whisper':importlib.util.find_spec('faster_whisper') is not None,'models':{n:bool(cached(repo,['model.bin','config.json','tokenizer.json'])) for n,repo in MODELS.items()},'diarizerCached':bool(cached('pyannote/speaker-diarization-community-1',['config.yaml','segmentation/pytorch_model.bin','embedding/pytorch_model.bin','plda/plda.npz']))}
def analyze(req):
 from faster_whisper import WhisperModel
 result={'analyses':[],'warnings':[],'speakerIdentityVerified':False,'offlineOnly':True}
 # Server-owned inputs only. Decoded waveform strips streams/metadata; never send script to ASR.
 inputs=req['inputs']
 if len(inputs)>100 or any(not 0<float(x['duration'])<=600 for x in inputs):raise ValueError('Analyze at most 100 clips, each no longer than ten minutes.')
 for name in req.get('models',['small.en','small']):
  if name not in MODELS:raise ValueError('Unsupported cached model.')
  path=cached(MODELS[name],['model.bin','config.json','tokenizer.json'])
  if not path:raise ValueError('UNAVAILABLE: cached '+name+' model is missing. No download was attempted.')
  model=WhisperModel(path,device='cpu',compute_type='int8',cpu_threads=2,num_workers=1,local_files_only=True)
  for item in inputs:
   segments,info=model.transcribe(item['path'],language=req.get('language') or None,word_timestamps=True,vad_filter=True,beam_size=3,condition_on_previous_text=False,initial_prompt=None)
   words=[];quality=[]
   for s in segments:
    quality.append({'start':s.start,'end':s.end,'avgLogprob':s.avg_logprob,'noSpeechProbability':s.no_speech_prob,'compressionRatio':s.compression_ratio})
    for w in s.words or []:
     start=max(0,float(w.start));end=min(float(item['duration']),float(w.end))
     if end>start:words.append({'start':start,'end':end,'word':w.word,'probability':w.probability,'speaker':'UNASSIGNED'})
   result['analyses'].append({'label':item['label'],'model':name,'words':words,'segments':quality,'language':info.language,'alignment':'observed-word timestamps','speakerIdentityVerified':False})
   print(json.dumps({'phase':'analyzing','message':name+' · '+item['label']}),flush=True)
  del model
 if req.get('diarize'):
  try:
   from pyannote.audio import Pipeline
   from voice_worker import read_wave,diarization_turns,label_words
   import numpy as np,torch
   path=cached('pyannote/speaker-diarization-community-1',['config.yaml','segmentation/pytorch_model.bin','embedding/pytorch_model.bin','plda/plda.npz'])
   if not path:raise ValueError('Cached diarizer is missing; no download attempted.')
   torch.set_num_threads(2);pipe=Pipeline.from_pretrained(path+'/config.yaml')
   # Full retained track gives one anonymous numbering scope; do not restart IDs per window.
   full=next(x for x in inputs if x['label']=='retained-film');pcm,sr=read_wave(full['path']);waveform=torch.from_numpy(np.asarray(pcm,dtype=np.float32)/32768).unsqueeze(0)
   turns=diarization_turns(pipe({'waveform':waveform,'sample_rate':sr}));result['turns']=turns
   for a in result['analyses']:
    if a['label']=='retained-film':a['words']=label_words(a['words'],turns)
   result['speakerScope']='full retained-film; anonymous groups, identities unconfirmed'
  except Exception as e:result['warnings'].append('Diarization unavailable; observed transcription kept. '+str(e)[:500])
 return result
if __name__=='__main__':
 try:
  req=json.load(sys.stdin);r=capabilities() if req.get('action')=='capabilities' else analyze(req);print(json.dumps({'result':r}),flush=True)
 except Exception as e:print(json.dumps({'error':str(e)[:1600]}),flush=True);sys.exit(1)
