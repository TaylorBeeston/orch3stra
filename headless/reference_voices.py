"""Original character-voice samples and Fish Drama 3 dialogue through WanGP's serialized TTS runtime."""
from __future__ import annotations
import copy
import json
import math
import os
from pathlib import Path
import re
import subprocess
from .reference_images import architectures

ARCHITECTURE = 'qwen3_tts_voicedesign'
FISH = 'fish_drama3'
ARCHITECTURES = (ARCHITECTURE, FISH)
# Fish Drama 3 (WanGP models/TTS/fish_audio): 'Speaker N:' labels map to its 16 speaker tokens and
# audio_guide/2/3 are the voice references for speakers 1-3 ('A', 'AB', 'ABD').
FISH_SPEAKERS = 16
FISH_MAX_SECONDS = 300
FISH_PAIRED_TAGS = ('whisper', 'stress', 'slow')
FISH_STRUCTURAL = ('<|im_start|>', '<|im_end|>', '<|voice|>', '<|text|>', '<|interleave|>', '<|semantic:', '<|speaker')
FISH_LINE = re.compile(r'^[ \t]*Speaker[ \t]*(\d+)[ \t]*:[ \t]*(.*)$', re.IGNORECASE)
VOICE_PROMPT_TYPES = ('', 'A', 'AB', 'ABD')
VOICE_GUIDES = ('audio_guide', 'audio_guide2', 'audio_guide3')
AUDIO_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus'}
LANGUAGES = {'auto', 'english', 'chinese', 'japanese', 'korean', 'german', 'french', 'russian', 'portuguese', 'spanish', 'italian'}

def check_fish_text(text, location):
    """Mirror WanGP's Drama 3 prompt checks so a bad script fails before upload or queueing."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError(location + ': text must not be empty.')
    for token in FISH_STRUCTURAL:
        if token in text:
            raise ValueError(location + ': ' + token + ' is written by the prompt builder; use Speaker N: labels.')
    for match in re.finditer(r'</?([A-Za-z][^<>|]*)>?', text):
        if match.group(1) not in FISH_PAIRED_TAGS or not match.group(0).endswith('>'):
            raise ValueError(location + ': ' + repr(match.group(0)) + ' is not a Drama 3 tag; tags are <whisper>, <stress> and <slow> around words, other directions go in square brackets such as [smiling].')
    for tag in FISH_PAIRED_TAGS:
        if text.count('<' + tag + '>') != text.count('</' + tag + '>'):
            raise ValueError(location + ': close each <' + tag + '> with </' + tag + '>.')

def fish_script(script):
    """Each nonempty line is 'Speaker N: [direction] words' with N in 1..16. Returns the speaker numbers used."""
    if not isinstance(script, str) or not script.strip() or len(script) > 12000:
        raise ValueError('Provide a 1-12000 character dialogue script.')
    speakers = []
    for number, line in enumerate(script.splitlines(), 1):
        if not line.strip():
            continue
        match = FISH_LINE.match(line)
        if not match:
            raise ValueError('Script line %d must start with "Speaker N:".' % number)
        speaker = int(match.group(1))
        if not 1 <= speaker <= FISH_SPEAKERS:
            raise ValueError('Script line %d: speakers go from Speaker 1 to Speaker %d.' % (number, FISH_SPEAKERS))
        if not match.group(2).strip():
            raise ValueError('Script line %d has no words.' % number)
        speakers.append(speaker)
    check_fish_text(script, 'Dialogue script')
    return sorted(set(speakers))

def audio_probe(path, *, max_duration=90):
    result = subprocess.run([os.environ.get('FFPROBE_BIN', 'ffprobe'), '-v', 'error', '-show_entries',
                             'stream=codec_type,sample_rate,channels,duration:format=duration', '-of', 'json', str(path)],
                            check=True, capture_output=True, timeout=45)
    doc = json.loads(result.stdout)
    streams = doc.get('streams', [])
    audio = [s for s in streams if s.get('codec_type') == 'audio']
    if len(audio) != 1 or any(s.get('codec_type') == 'video' for s in streams):
        raise ValueError('Expected one audio stream, not a video or multi-track container.')
    duration = float(audio[0].get('duration') or doc.get('format', {}).get('duration') or 0)
    if not math.isfinite(duration) or not 0 < duration <= max_duration:
        raise ValueError('Audio output must be nonempty and within its declared duration limit.')
    # Decode before marking it ready, not merely accepting a corrupt header.
    subprocess.run([os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-xerror', '-i', str(path),
                    '-map', '0:a:0', '-f', 'null', '-'], check=True, capture_output=True, timeout=60)
    return {'media_kind': 'audio', 'duration': duration, 'sample_rate': int(audio[0].get('sample_rate') or 0),
            'channels': audio[0].get('channels')}

class ReferenceVoiceSupport:
    def voice_models(self):
        with self.lock:
            if self.session is None or self.runtime_state != 'ready':
                raise ValueError('Wait for WanGP initialization before discovering voice models.')
            if self.active_id:
                if hasattr(self, '_voice_models'):
                    return copy.deepcopy(self._voice_models)
                raise ValueError('Discover voice models when the renderer is idle.')
            rows = [row for query in ('Qwen', 'Fish') for row in self.session.list_model_metadata(query=query, main_output='audio', limit=500, offset=0)]
            result, seen = [], set()
            for row in rows:
                if not isinstance(row, dict) or not row.get('model_type') or row['model_type'] in seen:
                    continue
                seen.add(row['model_type'])
                try:
                    result.append(self.voice_model_info(row['model_type'])['metadata'])
                except ValueError:
                    continue
            self._voice_models = result
            return copy.deepcopy(result)

    def voice_model_info(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('Select a discovered Qwen3 TTS VoiceDesign or Fish Drama 3 model.')
        with self.lock:
            cache = getattr(self, '_voice_cache', None)
            if cache is None:
                self._voice_cache = cache = {}
            if model_type in cache:
                return copy.deepcopy(cache[model_type])
            if self.session is None or self.runtime_state != 'ready' or self.active_id:
                raise ValueError('Discover this voice preset while the renderer is ready and idle.')
            meta = self.session.get_model_metadata(model_type)
            defs = self.session.list_model_defs(model_type=model_type)
            found = [arch for arch in ARCHITECTURES if meta and arch in architectures([meta, defs])]
            if len(found) != 1:
                raise ValueError('Only native Qwen3 TTS VoiceDesign and Fish Drama 3 are supported for this operation. Update WanGP and rediscover presets.')
            getter = getattr(self.session, 'get_exported_default_settings', None) or self.session.get_default_settings
            profile = ({'kind': 'reference_voice', 'architecture': ARCHITECTURE, 'languages': sorted(LANGUAGES), 'script': False, 'max_voice_references': 0, 'max_seconds': 30}
                       if found[0] == ARCHITECTURE else
                       {'kind': 'reference_voice', 'architecture': FISH, 'languages': ['auto'], 'script': True, 'max_speakers': FISH_SPEAKERS,
                        'max_voice_references': 3, 'max_seconds': FISH_MAX_SECONDS, 'paired_tags': list(FISH_PAIRED_TAGS)})
            info = {'metadata': meta, 'defaults': getter(model_type), 'schema': self.session.get_model_schema(model_type), 'profile': profile}
            cache[model_type] = info
            return copy.deepcopy(info)

    def resolve_reference_voice(self, task):
        profile = self.voice_model_info(task.get('model_type'))['profile']
        if profile['architecture'] == FISH and 'script' in task:
            return self.resolve_fish_dialogue(task)
        if 'script' in task:
            raise ValueError('Dialogue scripts need a Fish Drama 3 voice model.')
        text, description = task.get('prompt'), task.get('alt_prompt')
        for name, value in [('sample text', text), ('voice description', description)]:
            if not isinstance(value, str) or not value.strip() or len(value) > 4000:
                raise ValueError('Provide 1–4000 characters of ' + name + '.')
            if re.match(r'^(?:/|~[/\\]|[A-Za-z]:[/\\]|https?:|file:)', value.strip()):
                raise ValueError('Voice inputs must be literal text, not filenames or URLs.')
        duration = task.get('duration_seconds', 15)
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 3 <= duration <= 30:
            raise ValueError('Reference voice duration limit must be 3–30 seconds.')
        seed = task.get('seed', -1)
        if type(seed) is not int or not -1 <= seed <= 2**31-1:
            raise ValueError('Voice seed must be -1 or a 31-bit integer.')
        language = task.get('model_mode', 'english')
        if language not in LANGUAGES:
            raise ValueError('Choose a supported voice language.')
        if profile['architecture'] == FISH:
            # Fish has no voice-description input: the description becomes a leading direction and the
            # seed picks a new voice ('' audio_prompt_type).
            line = '[' + re.sub(r'[\[\]<>]', '', ' '.join(description.split())) + '] ' + text.strip()
            check_fish_text(line, 'Voice sample')
            return self.fish_settings(task['model_type'], 'Speaker 1: ' + line, float(duration), seed, [], '')
        return {'model_type': task['model_type'], 'image_mode': 0, 'prompt': text.strip(), 'alt_prompt': description.strip(),
                'model_mode': language, 'duration_seconds': float(duration), 'seed': seed,
                'temperature': 0.9, 'top_k': 50, 'repeat_generation': 1, 'video_length': 0,
                'num_inference_steps': 0, 'negative_prompt': '', 'multi_prompts_gen_type': 'FG',
                'prompt_enhancer': '', 'audio_prompt_type': '', 'video_prompt_type': '', 'image_prompt_type': '',
                'audio_guide': None, 'audio_guide2': None, 'audio_guide3': None, 'image_refs': [], 'video_source': None}

    def fish_settings(self, model_type, prompt, duration, seed, guides, transcripts):
        settings = {'model_type': model_type, 'image_mode': 0, 'prompt': prompt, 'alt_prompt': transcripts,
                    'duration_seconds': duration, 'seed': seed, 'temperature': 0.8, 'top_k': 30, 'top_p': 0.95,
                    'guidance_scale': 1.0, 'num_inference_steps': 1, 'repeat_generation': 1, 'video_length': 0,
                    'negative_prompt': '', 'multi_prompts_gen_type': 'FG', 'prompt_enhancer': '',
                    'audio_prompt_type': VOICE_PROMPT_TYPES[len(guides)], 'video_prompt_type': '', 'image_prompt_type': '',
                    'image_refs': [], 'video_source': None}
        for index, key in enumerate(VOICE_GUIDES):
            settings[key] = guides[index] if index < len(guides) else None
        return settings

    def resolve_fish_dialogue(self, task):
        """One multi-speaker WAV: script lines 'Speaker N: [direction] words', voices[i] is speaker i+1's reference."""
        extra = set(task) - {'mode', 'model_type', 'script', 'voices', 'transcripts', 'duration_seconds', 'seed'}
        if extra:
            raise ValueError('Unsupported dialogue fields: ' + ', '.join(sorted(extra)) + '.')
        speakers = fish_script(task.get('script'))
        voices, transcripts = task.get('voices', []), task.get('transcripts', [])
        if not isinstance(voices, list) or len(voices) > 3:
            raise ValueError('Dialogue takes at most three voice references (speakers 1-3).')
        if not isinstance(transcripts, list) or len(transcripts) != len(voices):
            raise ValueError('Give one exact transcript per voice reference.')
        for number, text in enumerate(transcripts, 1):
            if not isinstance(text, str) or not text.strip() or len(text) > 2000 or '\n' in text.strip():
                raise ValueError('Transcript %d must be one nonempty line of at most 2000 characters.' % number)
            check_fish_text(text, 'Reference transcript %d' % number)
        if voices and max(speakers) < len(voices):
            raise ValueError('Voice reference %d has no matching Speaker %d line.' % (len(voices), len(voices)))
        duration = task.get('duration_seconds', 60)
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not 1 <= duration <= FISH_MAX_SECONDS:
            raise ValueError('Dialogue duration limit must be 1-%d seconds.' % FISH_MAX_SECONDS)
        seed = task.get('seed', -1)
        if type(seed) is not int or not -1 <= seed <= 2**31-1:
            raise ValueError('Voice seed must be -1 or a 31-bit integer.')
        guides = []
        for media_id in voices:
            path = self.uploaded_path(media_id)
            if Path(path).suffix.lower() not in AUDIO_EXTENSIONS:
                raise ValueError('Voice references must be uploaded audio files.')
            guides.append(path)
        lines = '\n'.join('Speaker %d: %s' % (i, t.strip()) for i, t in enumerate(transcripts, 1))
        return self.fish_settings(task['model_type'], task['script'].strip(), float(duration), seed, guides, lines)
