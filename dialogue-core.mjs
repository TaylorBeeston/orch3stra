/** Fish Drama 3 multi-speaker dialogue: pure request construction shared by the studio
 * (generation buildDialogue/prepareDialogue) and the voice_dialogue CLI composite.
 * Mirrors headless/reference_voices.py so a bad script fails before upload or queueing.
 */
export const DEFAULT_DIALOGUE_MODEL='fish_drama3';
export const MAX_SPEAKERS=16,MAX_VOICES=3,MAX_SECONDS=300;
const PAIRED=['whisper','stress','slow'];
const STRUCTURAL=['<|im_start|>','<|im_end|>','<|voice|>','<|text|>','<|interleave|>','<|semantic:','<|speaker'];
const LINE=/^[ \t]*Speaker[ \t]*(\d+)[ \t]*:[ \t]*(.*)$/i;
const invalid=message=>{throw Object.assign(new Error(message),{code:'INVALID_DIALOGUE'});};

export function checkText(text,location){
 if(typeof text!=='string'||!text.trim())invalid(location+': text must not be empty.');
 for(const token of STRUCTURAL)if(text.includes(token))invalid(location+': '+token+' is written by the prompt builder; use Speaker N: labels.');
 for(const m of text.matchAll(/<\/?([A-Za-z][^<>|]*)>?/g))if(!PAIRED.includes(m[1])||!m[0].endsWith('>'))invalid(location+': '+JSON.stringify(m[0])+' is not a Drama 3 tag; tags are <whisper>, <stress> and <slow> around words, other directions go in square brackets such as [smiling].');
 for(const tag of PAIRED)if(text.split('<'+tag+'>').length!==text.split('</'+tag+'>').length)invalid(location+': close each <'+tag+'> with </'+tag+'>.');
}

/** Returns {speakers:[1..16 used], lines}. Every nonempty line is "Speaker N: [direction] words". */
export function parseScript(script){
 if(typeof script!=='string'||!script.trim()||script.length>12000)invalid('Provide a 1-12000 character dialogue script.');
 const speakers=new Set();let lines=0;
 script.split(/\r?\n/).forEach((line,i)=>{
  if(!line.trim())return;
  const m=LINE.exec(line);if(!m)invalid('Script line '+(i+1)+' must start with "Speaker N:".');
  const n=Number(m[1]);if(!(n>=1&&n<=MAX_SPEAKERS))invalid('Script line '+(i+1)+': speakers go from Speaker 1 to Speaker '+MAX_SPEAKERS+'.');
  if(!m[2].trim())invalid('Script line '+(i+1)+' has no words.');
  speakers.add(n);lines++;
 });
 checkText(script,'Dialogue script');
 return{speakers:[...speakers].sort((a,b)=>a-b),lines};
}

/** Voice references are owned project audio assets, speaker i+1 = voiceAssetIds[i]. Transcripts default to
 * the asset transcript, then the generated voice's intended text. Returns the resolved voice rows. */
export function dialogueVoices(project,voiceAssetIds=[],transcripts=[]){
 if(!Array.isArray(voiceAssetIds)||voiceAssetIds.length>MAX_VOICES)invalid('Dialogue takes at most three voice references (speakers 1-3).');
 if(new Set(voiceAssetIds).size!==voiceAssetIds.length)invalid('Voice references must be distinct assets.');
 if(transcripts!==undefined&&(!Array.isArray(transcripts)||transcripts.length>voiceAssetIds.length))invalid('Give at most one transcript per voice reference.');
 return voiceAssetIds.map((id,i)=>{
  const a=(project.assets||[]).find(x=>x.id===id);
  if(!a)invalid('Voice reference '+id+' is not an asset of this project.');
  if(a.kind!=='audio')invalid('Voice reference '+a.name+' is '+a.kind+', not audio.');
  if(a.generationExcluded)invalid('Voice reference '+a.name+' is excluded from generation. Reactivate it first.');
  const transcript=String(transcripts?.[i]||a.transcript||a.provenance?.intendedText||'').trim();
  if(!transcript)invalid('Voice reference '+(i+1)+' ('+a.name+') needs the exact words it says. Pass transcripts['+i+'].');
  if(transcript.length>2000||/\n/.test(transcript))invalid('Transcript '+(i+1)+' must be one line of at most 2000 characters.');
  checkText(transcript,'Reference transcript '+(i+1));
  return{speaker:i+1,assetId:a.id,name:a.name,duration:a.duration??null,transcript};
 });
}

/** The single worker task and saved snapshot. uploaded maps asset IDs to worker h3media IDs. */
export function dialogueRequest({project,modelType=DEFAULT_DIALOGUE_MODEL,script,voiceAssetIds=[],transcripts,seconds=60,seed=-1,uploaded}){
 const parsed=parseScript(script),voices=dialogueVoices(project,voiceAssetIds,transcripts);
 if(voices.length&&parsed.speakers.at(-1)<voices.length)invalid('Voice reference '+voices.length+' has no matching Speaker '+voices.length+' line.');
 if(typeof seconds!=='number'||!Number.isFinite(seconds)||seconds<1||seconds>MAX_SECONDS)invalid('Dialogue duration limit must be 1-'+MAX_SECONDS+' seconds.');
 if(!Number.isInteger(seed)||seed<-1||seed>2147483647)invalid('Voice seed must be -1 or a 31-bit integer.');
 const task={mode:'reference_voice',model_type:modelType,script:script.trim(),voices:voices.map(v=>uploaded?.[v.assetId]||invalid('Missing owned upload handle for '+v.name+'.')),transcripts:voices.map(v=>v.transcript),duration_seconds:seconds,seed};
 const settings={modelType,dialogue:true,script:task.script,voiceAssetIds:voices.map(v=>v.assetId),transcripts:task.transcripts,seconds,seed,speakers:parsed.speakers};
 return{task,snapshot:{kind:'reference-voices',cards:[],settings},voices,speakers:parsed.speakers,audioPromptType:['','A','AB','ABD'][voices.length]};
}
