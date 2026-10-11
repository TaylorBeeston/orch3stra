"""Capability-checked Qwen Image 2.1 / Krea 2 support on the SAME serialized WanGP runtime.

Discovery uses the local model registry, not a guessed display label. Requests
carry owned upload IDs only. No H3 settings, output paths, or arbitrary models
cross this boundary. The model license must be accepted by the user per job.
"""
from __future__ import annotations
import copy
import math
import re
from pathlib import Path

ARCHITECTURE = 'qwen_image_21_7B'
# These are native WanGP architectures, not display-name guesses or arbitrary pipelines.
KREA_PROFILES = {
    'krea2_raw': (0, 52, 3.5),
    'krea2_turbo': (0, 8, 0.0),
    'krea2_raw_edit': (2, 20, 2.0),
    'krea2_turbo_edit': (2, 8, 0.0),
}
SUPPORTED_ARCHITECTURES = {ARCHITECTURE, *KREA_PROFILES}

IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.avif'}

VIGGLE_PROFILES = {
    'accelerator_profile:qwen21/Viggle Turbo 4 Steps.json': {
        'id': 'viggle-turbo-v0.1-4step', 'name': 'Viggle Turbo v0.1 · 4 steps',
        'steps': 4, 'lora': 'https://huggingface.co/DeepBeepMeep/Qwen_image_2/resolve/main/loras/Qwen-Image-2.1-viggle-turbo-4step-lora-r64.safetensors',
    },
    'accelerator_profile:qwen21/Viggle Turbo v0.2 5 Steps.json': {
        'id': 'viggle-turbo-v0.2-5step', 'name': 'Viggle Turbo v0.2 · 5 steps',
        'steps': 5, 'lora': 'https://huggingface.co/DeepBeepMeep/Qwen_image_2/resolve/main/loras/Qwen-Image-2.1-viggle-turbo-v0.2-5step-lora-r256.safetensors',
    },
    'accelerator_profile:qwen21/Viggle Turbo v0.2.1 6 Steps.json': {
        'id': 'viggle-turbo-v0.2.1-6step', 'name': 'Viggle Turbo v0.2.1 · 6 steps',
        'steps': 6, 'lora': 'https://huggingface.co/DeepBeepMeep/Qwen_image_2/resolve/main/loras/Qwen-Image-2.1-viggle-turbo-v0.2.1-6step-lora-r256.safetensors',
    },
}


def architectures(value):
    found = set()
    if isinstance(value, dict):
        for key, item in value.items():
            if key in {'architecture', 'base_model_type', 'model_type'} and isinstance(item, str):
                found.add(item)
            elif isinstance(item, (dict, list)):
                found |= architectures(item)
    elif isinstance(value, list):
        for item in value:
            found |= architectures(item)
    return found


def image_probe(path):
    # Pillow is already a WanGP dependency. Decode before advertising an output.
    from PIL import Image
    with Image.open(path) as image:
        if image.width * image.height > 32_000_000 or getattr(image, 'n_frames', 1) != 1:
            raise ValueError('Expected one reference image of at most 32 megapixels.')
        image.load()
        return {'width': image.width, 'height': image.height, 'format': image.format,
                'media_kind': 'image'}


class ReferenceImageSupport:
    def reference_models(self):
        with self.lock:
            if self.session is None or self.runtime_state != 'ready':
                raise ValueError('WanGP is not ready. Wait for initialization before discovering image models.')
            if self.active_id:
                cached = getattr(self, '_reference_models', None)
                if cached is not None:
                    return copy.deepcopy(cached)
                raise ValueError('Discover image presets after the current render finishes.')
            rows, seen = [], set()
            for query in ('Qwen', 'Krea'):
                for offset in range(0, 2000, 500):
                    batch = self.session.list_model_metadata(query=query, main_output='image', limit=500, offset=offset)
                    if not isinstance(batch, list):
                        raise ValueError('Unexpected WanGP image-model registry response.')
                    added = 0
                    for row in batch:
                        key = row.get('model_type') if isinstance(row, dict) else None
                        if key and key not in seen:
                            rows.append(row); seen.add(key); added += 1
                    if len(batch) < 500 or not added:
                        break
            result = []
            for row in rows:
                if not isinstance(row, dict) or not row.get('model_type'):
                    continue
                try:
                    info = self.reference_model_info(row['model_type'])
                except ValueError:
                    continue
                result.append(info['metadata'])
            self._reference_models = result
            return copy.deepcopy(result)
    def _discover_viggle_profiles(self, model_type):
        getter = getattr(self.session, 'get_model_settings', None)
        if not callable(getter):
            return [], {}
        try:
            listing = getter(model_type, include_selection=True)
        except TypeError:
            try:
                listing = getter(model_type)
            except Exception:
                return [], {}
        except Exception:
            return [], {}
        entries = listing.get('settings', []) if isinstance(listing, dict) else []
        public, native = [], {}
        for entry in entries:
            setting_id = entry.get('id') if isinstance(entry, dict) else None
            profile = VIGGLE_PROFILES.get(setting_id)
            if not profile or entry.get('type') != 'accelerator profile':
                continue
            try:
                content = getter(model_type, setting_id=setting_id).get('content', {})
            except Exception:
                continue
            if (content.get('model_type') not in (None, model_type)
                    or content.get('sample_solver') != 'viggle_v02'
                    or type(content.get('num_inference_steps')) is not int
                    or content['num_inference_steps'] != profile['steps']
                    or content.get('guidance_scale') != 1
                    or content.get('activated_loras') != [profile['lora']]
                    or str(content.get('loras_multipliers', '')).strip() not in {'1', '1.0'}):
                continue
            public.append({'id': profile['id'], 'name': profile['name'], 'steps': profile['steps'], 'guidance': 1.0})
            native[profile['id']] = {
                'sample_solver': content['sample_solver'],
                'num_inference_steps': profile['steps'],
                'guidance_scale': 1.0,
                'activated_loras': [profile['lora']],
                'loras_multipliers': '1',
            }
        return public, native

    def reference_model_info(self, model_type):
        if not isinstance(model_type, str) or not model_type:
            raise ValueError('Discover and select an image preset first.')
        with self.lock:
            cache = getattr(self, '_reference_cache', None)
            if cache is None:
                self._reference_cache = cache = {}
            if model_type in cache:
                return copy.deepcopy(cache[model_type])
            if self.session is None or self.runtime_state != 'ready' or self.active_id:
                raise ValueError('Discover the image preset while the renderer is ready and idle.')
            meta = self.session.get_model_metadata(model_type)
            defs = self.session.list_model_defs(model_type=model_type)
            found = architectures([meta, defs]) & SUPPORTED_ARCHITECTURES
            if not meta or not found:
                raise ValueError('This operation accepts native Qwen Image 2.1 and Krea 2 presets only. Update WanGP and rediscover its image presets.')
            arch = model_type if model_type in found else next((a for a in KREA_PROFILES if a in found), ARCHITECTURE)
            is_qwen = arch == ARCHITECTURE
            max_refs, default_steps, default_guidance = (10, 40, 4.0) if is_qwen else KREA_PROFILES[arch]
            # Refuse a misleading child variant with a different sampler contract.
            if is_qwen and 'turbo' in (model_type + ' ' + str(meta.get('name', ''))).lower():
                raise ValueError('Choose the standard Qwen Image 2.1 preset, not a distilled/Turbo variant.')
            getter = getattr(self.session, 'get_exported_default_settings', None) or self.session.get_default_settings
            defaults = getter(model_type)
            image_profiles, profile_settings = self._discover_viggle_profiles(model_type) if is_qwen else ([], {})
            if not hasattr(self, '_reference_image_profile_settings'):
                self._reference_image_profile_settings = {}
            self._reference_image_profile_settings[model_type] = profile_settings
            profile = {'kind': 'reference_image', 'max_references': max_refs,
                       'supports_reference_images': max_refs > 0, 'architecture': arch,
                       'default_steps': default_steps, 'default_guidance': default_guidance,
                       'license': 'Qwen Research License' if is_qwen else 'See the installed Krea model license',
                       'reference_order': 'Ordered <imageN> sources' if is_qwen else
                           ('Up to two inputs. Scene first, subject second when preserving a scene; otherwise ordered identity inputs.' if max_refs else 'Text-to-image only; input references are not accepted.')}
            info = {'metadata': {**meta, 'image_profile': profile}, 'defaults': defaults,
                    'schema': self.session.get_model_schema(model_type),
                    'image_profiles': image_profiles, 'profile': profile}
            cache[model_type] = info
            return copy.deepcopy(info)

    def resolve_reference_image(self, task):
        from .engine import fingerprint
        info = self.reference_model_info(task.get('model_type'))
        profile = info['profile']
        is_qwen = profile['architecture'] == ARCHITECTURE
        if task.get('license_accepted') is not True:
            raise ValueError('Review and accept the selected image model license before generating.')
        prompt = task.get('prompt')
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 24000:
            raise ValueError('Provide a reference-image prompt of 1–24000 characters.')
        resolution = task.get('resolution', '1024x1024')
        match = re.fullmatch(r'(\d{3,4})x(\d{3,4})', str(resolution))
        if not match or any(not 256 <= int(x) <= 2048 or int(x) % 32 for x in match.groups()):
            raise ValueError('Image width and height must be multiples of 32 from 256 to 2048.')
        acceleration = task.get('acceleration_profile', '')
        supported = {p['id'] for p in VIGGLE_PROFILES.values()} if is_qwen else set()
        if acceleration and acceleration not in supported:
            raise ValueError('Unsupported acceleration profile for this image model. Clear Qwen/Viggle settings when switching families.')
        with self.lock:
            native_profile = copy.deepcopy(getattr(self, '_reference_image_profile_settings', {}).get(task.get('model_type'), {}).get(acceleration)) if acceleration else None
        if acceleration and native_profile is None:
            raise ValueError('This Viggle Turbo profile is not exposed by the current WanGP checkout. Update WanGP, restart the idle worker, and rediscover image profiles.')
        steps = native_profile['num_inference_steps'] if native_profile else task.get('num_inference_steps', profile['default_steps'])
        guidance = native_profile['guidance_scale'] if native_profile else task.get('guidance_scale', profile['default_guidance'])
        seed = task.get('seed', -1)
        if type(steps) is not int or not 1 <= steps <= 100:
            raise ValueError('Image step count must be 1–100.')
        if isinstance(guidance, bool) or not isinstance(guidance, (int, float)) or not math.isfinite(guidance) or not 0 <= guidance <= 20:
            raise ValueError('Image guidance must be between 0 and 20.')
        if type(seed) is not int or not -1 <= seed <= 2**31-1:
            raise ValueError('Image seed must be -1 or a 31-bit integer.')
        refs = task.get('image_refs', [])
        if not isinstance(refs, list) or len(refs) > profile['max_references'] or any(not isinstance(x, str) for x in refs) or len(set(refs)) != len(refs):
            raise ValueError('Choose up to ten distinct uploaded image references.' if is_qwen else f"This Krea preset accepts at most {profile['max_references']} distinct references. Choose an Edit preset for character anchors; references are never dropped.")
        paths = []
        for key in refs:
            media = self.media.get(key)
            if not media or Path(media['path']).suffix.lower() not in IMAGE_EXTENSIONS or tuple(media['stat']) != fingerprint(media['path']):
                raise ValueError('Reference image is missing or changed. Upload it again; paths are not accepted.')
            image_probe(media['path'])
            paths.append(media['path'])
        mentioned = [int(x) for x in re.findall(r'<image(\d+)>', prompt)]
        if any(n < 1 or n > len(paths) for n in mentioned):
            raise ValueError('An <imageN> token refers to a missing input. Check image order.')
        # Client task fields never supply LoRA paths. A named profile is resolved
        # from WanGP's own exported accelerator profile and filtered at discovery.
        resolved = {'model_type': task['model_type'], 'image_mode': (1 if is_qwen else (0 if profile['max_references'] else 2)), 'prompt': prompt,
                    'resolution': resolution, 'num_inference_steps': steps,
                    'guidance_scale': float(guidance), 'sample_solver': 'default',
                    'guidance_phases': 1, 'seed': seed, 'batch_size': 1,
                    # One image card is one task. Keep all paragraphs together even
                    # when WanGP or an exported preset defaults to paragraph batching.
                    'multi_prompts_gen_type': 'FG',
                    'repeat_generation': 1, 'prompt_enhancer': '',
                    'image_refs': paths, 'image_prompt_type': '',
                    'video_prompt_type': (('KI' if not is_qwen and task.get('preserve_first_scene') is True else 'I') if paths else ''), 'audio_prompt_type': '',
                    'remove_background_images_ref': 0, 'denoising_strength': 1.0,
                    'custom_settings': ({'qwen21_kv_cache': 'Disabled', 'rgba': 'Disabled'} if is_qwen else {})}
        if native_profile:
            resolved.update({key: copy.deepcopy(native_profile[key]) for key in ('sample_solver', 'activated_loras', 'loras_multipliers')})
        return resolved
