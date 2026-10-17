# Review actual footage, finish sound, and deliver evidence

Code snippets below use the persistent Node session and `call`, `mutate`, `refresh`, `observe`, `r`, `runDir`, `crypto` from [recipe.md](recipe.md). They are optional production branches, not part of its no-inference baseline. Obtain the stated permissions first. Choose source files/IDs from actual returned records; never fabricate a transcript, recording, take or approval.

## Picture and performance review

Download actual available outputs with `media_ticket` → `media_download`; keep job/output IDs and downloaded SHA-256. Play at normal speed with sound, then inspect cuts and defects frame-by-frame. Check start/middle/end frames, faces/hands/props, costume/state, gaze, action axis, motion consistency, repeated actions, unstable background, exposure, and readable payoff. A thumbnail/contact sheet alone misses temporal defects. Compare against the approved identity/scene anchors, not only your mental image of the prompt.

Annotate exact timestamps/source frame ranges and observed reasons. Review the assembled sequence as well as isolated takes. Distinguish artistic choices from errors and uncertainty. A pretty still can fail the scene; a minor flaw outside retained frames may need only a trim. Choose the least expensive adequate remedy:

1. Trim genuine dead handles or an isolated defect with `timeline.trim` or Post clip In/Out.
2. Select an already reviewed alternative using `timeline.take`.
3. Split/remove/mute a specific Post region when the story/audio remains coherent.
4. Generate a separately approved alternative only when editorial repair cannot preserve intent.

Never retime dialogue to pretend wrong words are correct. Playback-rate changes pitch-preserve tempo but do not create missing performance. A new independent take can break linked descendants: review entry/exit, continuity dependencies, later takes, Post source stamp and captions before accepting it. `revalidate` is a conscious reviewed decision, not “clear warning.” Preserve original takes.

Speech-repair jobs remain alternatives after native adoption; adoption must not change the automatic original take. Missing/incomplete repair ownership requires restoring or reconciling the authoritative speech analysis, not importing the job as an ordinary take. Selecting a repair with linked descendants or an existing Post cut returns `DEPENDENCY_REVIEW_REQUIRED` until those impacts have been reviewed. Only after that review, supply `dependencyReview:true` on `timeline.take` with the actual alternative's job/window IDs and latest revision. This acknowledges affected joins/frozen Post/captions; it does not approve speech quality, regenerate descendants, revalidate continuity, or rebuild Post automatically.

## Local voice workshop and diarization

Before using the optional CPU workflow:

```js
save('voice-capabilities',call('voice',{action:'capabilities'},['cpu']));
save('nemotron-capabilities',call('voice',{action:'nemotron-capabilities'},['cpu']));
```

Inspect installed packages and cached models; capability probes do not load weights or prove future inference. Source import needs actual rights/voice consent. In the following branch, `voiceFile` must be set to the existing permitted WAV filename; the app does not supply one. Use the actual MIME if it is not WAV.

```js
var uploadedVoice = call('media_upload',{file:voiceFile,type:'audio/wav',destination:'voice'},['network']);
var voiceImport = call('voice',{action:'import',uploadId:uploadedVoice.result.uploadId,rightsConfirmed:true},['cpu']);
var importedVoice = observe('voice',voiceImport.id);
var transcriptJob = call('voice',{action:'transcribe',sourceId:importedVoice.result.sourceId,model:'small',language:'en',diarize:true,diarizationModel:'nemotron3',allowModels:false},['cpu']);
var transcript = save('voice-transcript',observe('voice',transcriptJob.id));
```

Only run that model choice if the capability check confirms its local availability. Otherwise report missing prerequisites; do not silently swap diarizers or turn `allowModels` on. `allowModels:true` can enable downloads and requires separate network/model permission; this recipe does not grant it. Import defaults to at most the first 120 seconds; supply deliberately reviewed `start/end` if a different permitted excerpt is needed.

Transcription and grouping run on CPU. Nemotron/pyannote produce **anonymous** speaker turns, not speaker names, clean voice stems, emotion labels or celebrity identification. Listen and map identities explicitly. Mixed/overlapping cuts need manual audition; regrouping cannot establish voice consent. An already transcribed source can be grouped separately with `voice.diarize`; preserve the transcript and hand edits. Temporary workshop jobs/sources can expire on restart, so save permitted source audio and the resulting evidence deliberately. Use `subjects.voiceBind` only with a real registered, measured owned voice asset; uploading alone does not bind a cast voice.

## Speech evidence, observed captions and bounded alternatives

`speech_quality.capabilities` is a CPU-only inspection. Analysis uses already cached offline speech models and real retained source audio; missing weights/packages yield UNAVAILABLE rather than a download. Intended text is only a comparison target, never an ASR prompt or caption source. For the **silent** baseline, the intended words are correctly empty:

```js
refresh();
var speechCapabilities = save('speech-capabilities',call('speech_quality',{action:'capabilities'},['cpu']));
var selectedEdit = call('project',{action:'export',projectId:r.project.id,format:'edit'});
var speechId = 'speech_'+crypto.randomUUID().replaceAll('-','');
var speechJob = call('speech_quality',{action:'start',id:speechId,edit:selectedEdit,project:r.project,offlineOnly:true,intended:selectedEdit.cuts.map(c=>({windowId:c.windowId,text:''})),diarize:false},['cpu','network']);
var speechEvidence = save('speech-evidence',observe('speech_quality',speechJob.id));
```

For a dialogue film, replace the empty texts with the exact approved words for each cut in order, and preserve intentional repetitions/utterance IDs where available. Never use the silent branch for a dialogue scene. Review full retained-track words and boundary evidence. PASS means normalized word agreement, not certified intelligibility/performance/speaker identity. Silence, short replies, ASR disagreement and diarization failure cannot alone justify regeneration. Listen to the actual mismatch before `speech_quality.confirm`; use `ambiguous:true` where listening cannot establish it. Do not invent a confirmation note.

Captions derive only from full retained-track observed words, not the intended script or concatenated overlapping context crops. After genuine review of a completed matching analysis:

```js
refresh();
mutate('post','attachCaptions',{analysisId:speechEvidence.id});
mutate('post','captions',{burn:false});
```

A silent film ordinarily needs no captions; skip attachment if there are no observed words. ASR hallucinations must not become authoritative dialogue. Review spelling/timing against audio. Rebuild matching evidence after source/range/order/speed changes; do not force a stale source stamp. Burn-in remains off unless the delivery requires it; `post.captions {burn:true}` is explicit. Retain observed SRT/VTT as labeled drafts and audition the final mixed export, since score/vocals can obscure words.

If a listening-confirmed failure cannot be edited around, request a bounded **one-alternate-per-window** repair authorization. The actual schema is:

```js
var repairPolicy = {enabled:true,maxWindows:1,maxAttemptsPerWindow:1,maxGpuFrames:362,context:'fresh-independent',dependencyAcknowledged:true};
```

This object is a proposed ceiling, not consent. After the user approves the exact candidate, settings and dependency consequences, `call('speech_quality',{action:'authorize-repair',id:speechEvidence.id,policy:repairPolicy})` records that finite approval, and `call('speech_quality',{action:'repair-next',id:speechEvidence.id},['cpu','gpu','network'])` can submit it. Read the result and `reconcile` the same analysis/attempt after uncertainty. It cannot refill a spent budget, and a failed alternate does not authorize another. Alternatives remain comparison candidates; adopt/select only after actual audiovisual review and downstream continuity checks.

## Sound extraction and honest soundtrack choices

Music, ambience and effects should support the scene, not obscure it. Establish a quiet continuous bed, then a few motivated events. For A Little Shelter, rain plus one leaf rustle is enough; silence of speech/song is intentional. Do not add a generic dramatic song merely because the music model exists. The native music route generates vocal songs with original lyrics, not verified instrumental-only scores. For a score, use a permitted real recording or a deliberately appropriate vocal song; inspect all lyrics and rights.

For extraction, set `soundFile` to an actual authorized local WAV recording. This branch creates a persistent CPU source and suggestions, not separated instruments:

```js
var soundUpload = call('media_upload',{file:soundFile,type:'audio/wav'},['network']);
var soundJob = call('sounds',{action:'start',id:'sound_'+crypto.randomUUID().replaceAll('-',''),projectId:r.project.id,consent:true,uploadKey:soundUpload.key,name:path.basename(soundFile),options:{method:'auto',thresholdDb:-42,minGap:0.45,minLength:0.25,padding:0.12}},['cpu']);
var soundSource = save('sound-source',observe('sounds',soundJob.id));
```

Audition source/sample URLs from the returned source/report through same-studio downloads. Chapter boundaries or quiet gaps propose ranges; they do not know that a sound is “rain,” remove commentary, isolate instruments or find musical beats. Edit real returned `samples` with `sounds.edit {id,revision,samples}`, then save chosen rows with `sounds.save-samples {id,revision,confirm:true,samples}` and CPU permission. `revision` is the **sound-source revision**, not project CAS. Reread `sounds.get` after each change. Keep original IDs, measured in/out seconds and explicit Keep decisions. `sounds.report` aids diagnosis; `resume` after restart is explicit. URL imports additionally need download/use rights and network permission; the example video links in old docs are not a license grant.

After extraction, `sounds.get` exposes saved `media` and source provenance. Register the chosen real immutable sample key via `references.register` into `destination:"post"`, or download/inspect and upload your own permitted recording. Keep the source/range/rights evidence with the delivery. No need to send Post audio into the generation reference pool.

## Mix in Post

Create Post only when every included window has accessible selected footage. It is a snapshot separate from Director; later take changes do not silently rewrite it. A reset needs explicit `replaceExisting:true`; preserve an existing cut before replacing it.

For an actual registered Post audio `asset.id`, choose a reviewed placement within actual cut bounds and call `post.placeAudio` with `startFrame`, exclusive `endFrame`, `mode:"trim"|"loop"|"shorter"`, and a stable `placementKey`. `sourceInFrame` chooses the recording start. It does not stretch a short recording into a longer interval. Use loop only for material whose seam survives listening. Existing `post.get` returns actual clip/cue IDs for edits.

- Use cue `gainDb`, source gain and master gain conservatively; start music well below speech, then audition rather than prescribing a universal level.
- `duckDb` is a manual whole-original-track reduction over the cue, **not** automatic dialogue detection or speech-only ducking. It lowers ambience too; overlapping ducks combine.
- Fade abrupt cue edges and check loop seams. Preserve room tone under dialogue edits. Don't mix several competing rain recordings unless they improve continuity.
- Clip mute removes the full original soundtrack; it cannot separate bad speech from good ambience. `post.cutRange` ripples picture/cues; recheck cue anchors afterward.
- Image/logo cues must be permitted raster media; alpha is honored, not generated. No automatic background removal. Keep captions and logos legible inside delivery-safe margins.
- Post supports fades, not true overlapping video cross-dissolves. Rate changes use frame repeat/drop, not optical flow. Do not promise unsupported transitions.

Final export has a peak limiter, **not broadcast loudness normalization**. If delivery requires LUFS/true-peak targets, measure the rendered mix with a trusted meter/FFmpeg and report actual values; do not claim the limiter established them. Listen on headphones and a small speaker, inspect mono intelligibility where relevant, and compare preview to the final file.

## Export, sidecars and late upscale

Use `post.exportPacket` → `finish.start {post:packet,id}` as in the recipe; do not hand-assemble the Post packet. It freezes sources/media hashes. Keep Node running for CPU FFmpeg export. Lost responses: `finish.get` on the saved ID, not a new export. A paused restart requires deliberate resume; export may restart its frozen encoding, not continue at the last frame. `finish.context` is **effectful continuation upload/import**, not a diagnostic read, and is not applicable to a Post master.

The finished record contains measured `result` and actual `downloadURL`. Save/download the movie; `finish.save-to-videos` additionally writes the movie and available sidecars into the server user's Videos directory with CPU approval. Sidecars listed in `finished.sidecars` can be downloaded from `finished.downloadURL + '?format=' + extension`, using only returned extensions, not invented caption files.

After picture/sound lock, an explicitly approved GPU upscale of the actual Post master uses the existing finishing path. It does not regenerate story content and cannot repair identity/action/speech. Using `finished` from the recipe:

```js
var masterEdit = {format:'h3-edit',version:1,fps:24,projectId:finished.edit.projectId,name:finished.name+' - upscaled master',cuts:[{windowId:'post-master',title:finished.name,source:{kind:'finish',jobId:finished.id,outputId:finished.outputId},inFrame:0,outFrame:finished.result.frames}]};
var upscaleId = 'finish_'+crypto.randomUUID().replaceAll('-','');
var upscaleJob = call('finish',{action:'start',id:upscaleId,edit:masterEdit,upscale:'flashvsr*2',chunked:true},['cpu','gpu','network']);
var upscaled = save('upscaled-master',observe('finish',upscaleJob.id));
save('upscaled-download',call('media_download',{url:upscaled.downloadURL,output:path.join(runDir,'a-little-shelter-2x.mp4')},['network']));
```

Only run after verifying FlashVSR is actually installed/available and the user approved its cost, model license and target size. The fixed `post-master` is an editorial cut label, not a fabricated worker/window/output identity; all source ownership IDs and frame bounds come from the actual completed master. Compare fine detail, shimmer, edge artifacts, duration and retained audio to the native master. Keep both. Do not adopt the scored/logoed master as an H3 continuation take.

## Evidence checklist

Deliver actual files plus: project ID/server revision; selected job/window IDs and source trims; exported job ID/frozen decisions; downloaded bytes/SHA-256; measured resolution/fps/frame count/duration/audio presence; observed subtitle provenance; timestamped visual/audio review; rights/consent restrictions; and any uncertainty. Verify the final first/last frame, joins, sync, clipping, aspect-fit padding, fades, text and playback. A screenshot or “completed” response alone is insufficient.

After the recipe produces `movieEvidence.path`, capture actual stream/frame metadata in the same Node session:

```js
var measured = cp.spawnSync(process.env.FFPROBE_BIN || 'ffprobe',
  ['-v','error','-count_frames','-show_entries','format=duration,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,nb_read_frames,sample_rate,channels','-of','json',movieEvidence.path],
  {encoding:'utf8',maxBuffer:16*1024*1024});
fs.writeFileSync(path.join(runDir,'movie-probe-stderr.txt'),measured.stderr || '',{mode:0o600});
if (measured.error || measured.status !== 0) throw new Error('Media measurement failed; inspect the retained probe error.');
var movieProbe = save('movie-probe',JSON.parse(measured.stdout));
console.dir(movieProbe,{depth:null});
if (movieProbe.streams.some(s => s.codec_type === 'audio')) {
  var loudness = cp.spawnSync(process.env.FFMPEG_BIN || 'ffmpeg',
    ['-hide_banner','-nostdin','-i',movieEvidence.path,'-af','ebur128=peak=true','-vn','-f','null','-'],
    {encoding:'utf8',maxBuffer:32*1024*1024});
  fs.writeFileSync(path.join(runDir,'movie-loudness.txt'),loudness.stderr || '',{mode:0o600});
  if (loudness.error || loudness.status !== 0) throw new Error('Loudness measurement failed; do not claim a delivery target.');
}
```

These are local CPU measurements of a real completed file; obtain that scope first. They do not normalize or overwrite the movie. Compare measured frames/duration/canvas/audio to the frozen finishing record and delivery agreement, then listen/watch the actual file. A missing audio stream may be intentional or a failure depending on the brief; never invent a meter result. No generated-film measurement is implied by the planning-only baseline.

Portable `.h3project` backup and generated videos are different assets. The recipe backs up registered media and project state; separately retain worker take files, final movies and approved server backup. A portable snapshot has a bounded encoded size; if it exceeds the limit, report that exact failure and preserve original media rather than deleting references to make it fit. Never claim restoration was tested unless it was actually exercised.
