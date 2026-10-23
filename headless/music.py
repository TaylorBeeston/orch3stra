"""Owned YuE2 song jobs on the existing serialized native Session queue."""
import copy
import math
from .reference_images import architectures

class MusicSupport:
    def music_model_info(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('Select a discovered native YuE2 song preset.')
        with self.lock:
            cache = getattr(self, '_music_cache', {})
            self._music_cache = cache
            if model_type in cache:
                return copy.deepcopy(cache[model_type])
            if self.session is None or self.runtime_state != 'ready' or self.active_id:
                raise ValueError('Discover YuE2 while the existing worker is ready and idle.')
            meta = self.session.get_model_metadata(model_type)
            defs = self.session.list_model_defs(model_type=model_type)
            if not meta or 'yue2' not in architectures([meta, defs]):
                raise ValueError('Only the native YuE2 song preset is supported. Hum/source modes are separate operations.')
            getter = getattr(self.session, 'get_exported_default_settings', None) or self.session.get_default_settings
            info = {'metadata': meta, 'defaults': getter(model_type), 'profile': {'kind': 'music', 'architecture': 'yue2'}}
            cache[model_type] = info
            return copy.deepcopy(info)

    def music_models(self):
        if self.session is None or self.runtime_state != 'ready' or self.active_id:
            raise ValueError('Discover music presets while the renderer is ready and idle.')
        rows = self.session.list_model_metadata(query='YuE2', main_output='audio', limit=500, offset=0)
        result = []
        for row in rows:
            try:
                result.append(self.music_model_info(row['model_type'])['metadata'])
            except (ValueError, KeyError):
                continue
        return result

    def resolve_music(self, task):
        self.music_model_info(task.get('model_type'))
        lyrics, style = task.get('prompt'), task.get('alt_prompt')
        if not all(isinstance(s, str) and 1 <= len(s.strip()) <= 4000 for s in (lyrics, style)):
            raise ValueError('Provide original lyrics and a music style, each 1–4000 characters.')
        seconds, seed, steps = task.get('duration_seconds'), task.get('seed'), task.get('num_inference_steps', 32)
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or not 5 <= seconds <= 180:
            raise ValueError('Music duration cap must be 5–180 seconds; it does not guarantee exact duration.')
        if type(seed) is not int or not -1 <= seed <= 2**31-1 or type(steps) is not int or not 1 <= steps <= 50:
            raise ValueError('Use a 31-bit seed and 1–50 music rendering steps.')
        # Closed settings: no URLs, source recordings, enhancer or automatic
        # instrumental LoRA download. Source-based covers require a separate flow.
        return {'model_type': task['model_type'], 'image_mode': 0, 'prompt': lyrics.strip(),
                'alt_prompt': style.strip(), 'duration_seconds': seconds, 'seed': seed,
                'num_inference_steps': steps, 'guidance_scale': 1.0, 'temperature': 1.0,
                'top_k': 100, 'top_p': .95, 'model_mode': 0, 'custom_guide': None,
                'custom_settings': {'save_score': 0}, 'repeat_generation': 1,
                'video_length': 0, 'multi_prompts_gen_type': 'FG', 'prompt_enhancer': '',
                'audio_prompt_type': '0', 'audio_guide': None, 'audio_guide2': None, 'audio_guide3': None,
                'video_source': None, 'image_refs': [], 'negative_prompt': ''}
