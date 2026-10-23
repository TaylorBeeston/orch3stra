"""Original character-voice samples through WanGP's existing serialized Qwen3 TTS runtime."""
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
AUDIO_EXTENSIONS = {'.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac', '.opus'}
LANGUAGES = {'auto', 'english', 'chinese', 'japanese', 'korean', 'german', 'french', 'russian', 'portuguese', 'spanish', 'italian'}

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
            rows = self.session.list_model_metadata(query='Qwen', main_output='audio', limit=500, offset=0)
            result = []
            for row in rows:
                if not isinstance(row, dict) or not row.get('model_type'):
                    continue
                try:
                    result.append(self.voice_model_info(row['model_type'])['metadata'])
                except ValueError:
                    continue
            self._voice_models = result
            return copy.deepcopy(result)

    def voice_model_info(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('Select a discovered Qwen3 TTS VoiceDesign model.')
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
            if not meta or ARCHITECTURE not in architectures([meta, defs]):
                raise ValueError('Only native Qwen3 TTS VoiceDesign is supported for this operation. Update WanGP and rediscover presets.')
            getter = getattr(self.session, 'get_exported_default_settings', None) or self.session.get_default_settings
            info = {'metadata': meta, 'defaults': getter(model_type), 'schema': self.session.get_model_schema(model_type),
                    'profile': {'kind': 'reference_voice', 'architecture': ARCHITECTURE, 'languages': sorted(LANGUAGES)}}
            cache[model_type] = info
            return copy.deepcopy(info)

    def resolve_reference_voice(self, task):
        self.voice_model_info(task.get('model_type'))
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
        return {'model_type': task['model_type'], 'image_mode': 0, 'prompt': text.strip(), 'alt_prompt': description.strip(),
                'model_mode': language, 'duration_seconds': float(duration), 'seed': seed,
                'temperature': 0.9, 'top_k': 50, 'repeat_generation': 1, 'video_length': 0,
                'num_inference_steps': 0, 'negative_prompt': '', 'multi_prompts_gen_type': 'FG',
                'prompt_enhancer': '', 'audio_prompt_type': '', 'video_prompt_type': '', 'image_prompt_type': '',
                'audio_guide': None, 'audio_guide2': None, 'audio_guide3': None, 'image_refs': [], 'video_source': None}
