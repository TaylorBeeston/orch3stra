"""Fish Drama 3 voice samples and multi-speaker dialogue task construction; no TTS inference."""
import tempfile
import unittest
import wave
from pathlib import Path
from headless.engine import HeadlessEngine
from headless.reference_voices import ARCHITECTURE, FISH

class Session:
    def list_model_metadata(self, **kw):
        if kw.get('main_output') != 'audio':
            return []
        if kw.get('query') == 'Qwen':
            return [self.get_model_metadata(ARCHITECTURE)]
        if kw.get('query') == 'Fish':
            return [self.get_model_metadata('fish_drama3'), self.get_model_metadata('fish_drama3_int4')]
        return []
    def get_model_metadata(self, m):
        return {'model_type': m, 'name': m, 'base_model_type': FISH if m.startswith('fish') else m}
    def list_model_defs(self, **kw):
        m = kw['model_type']
        return [{'model_type': m, 'model': {'architecture': FISH if m.startswith('fish') else m}}]
    def get_default_settings(self, _):
        return {'prompt': '', 'duration_seconds': 60}
    def get_model_schema(self, _):
        return {'fields': []}

SCRIPT = 'Speaker 1: [warm, amused] You came back.\nSpeaker 2: [quiet] I said I <stress>would</stress>.\nSpeaker 3: [whispering] <whisper>Both of you, hush.</whisper>'

class FishDialogue(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.e = HeadlessEngine(self.root/'worker', session=Session(), start_dispatcher=False)
        self.voices = []
        for n in range(1, 4):
            path = self.root/'worker'/'uploads'/('v%d.wav' % n); path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(path), 'wb') as f:
                f.setnchannels(1); f.setsampwidth(2); f.setframerate(16000); f.writeframes(b'\0\0'*16000*3)
            self.voices.append(self.e.register_upload(path, path.name, 'audio/wav')['media_id'])
    def tearDown(self):
        self.e.close(); self.tmp.cleanup()
    def dialogue(self, **kw):
        return {'mode': 'reference_voice', 'model_type': 'fish_drama3', 'script': SCRIPT, 'voices': self.voices,
                'transcripts': ['First words.', 'Second words.', 'Third words.'], 'duration_seconds': 120, 'seed': 7, **kw}

    def test_discovery_lists_qwen_and_both_fish_presets_with_profiles(self):
        self.assertEqual([m['model_type'] for m in self.e.voice_models()], [ARCHITECTURE, 'fish_drama3', 'fish_drama3_int4'])
        p = self.e.voice_model_info('fish_drama3_int4')['profile']
        self.assertEqual((p['architecture'], p['script'], p['max_voice_references'], p['max_seconds']), (FISH, True, 3, 300))
        self.assertFalse(self.e.voice_model_info(ARCHITECTURE)['profile']['script'])
        caps = self.e.health()['capabilities']
        self.assertEqual((caps['voice_dialogue'], caps['reference_voice_architectures']), (1, [ARCHITECTURE, FISH]))

    def test_three_voice_dialogue_payload_is_abd_with_speaker_transcripts(self):
        r = self.e.resolve_task(self.dialogue())
        self.assertEqual(r['audio_prompt_type'], 'ABD'); self.assertEqual(r['prompt'], SCRIPT)
        self.assertEqual(r['alt_prompt'], 'Speaker 1: First words.\nSpeaker 2: Second words.\nSpeaker 3: Third words.')
        self.assertEqual([Path(r[k]).name for k in ('audio_guide', 'audio_guide2', 'audio_guide3')], ['v1.wav', 'v2.wav', 'v3.wav'])
        self.assertEqual((r['temperature'], r['top_k'], r['top_p'], r['guidance_scale'], r['num_inference_steps'], r['duration_seconds'], r['seed']), (0.8, 30, 0.95, 1.0, 1, 120.0, 7))
        self.assertNotIn('script', r); self.assertNotIn('mode', r)

    def test_fewer_voices_and_new_voices(self):
        r = self.e.resolve_task(self.dialogue(voices=self.voices[:1], transcripts=['Only one.']))
        self.assertEqual((r['audio_prompt_type'], r['audio_guide2'], r['audio_guide3']), ('A', None, None))
        r = self.e.resolve_task(self.dialogue(voices=[], transcripts=[]))
        self.assertEqual((r['audio_prompt_type'], r['audio_guide'], r['alt_prompt']), ('', None, ''))

    def test_script_and_reference_validation(self):
        bad = [({'script': 'Narrator: hello'}, 'must start with "Speaker N:"'), ({'script': 'Speaker 17: hi'}, 'Speaker 1 to Speaker 16'),
               ({'script': 'Speaker 1: <whisper>open'}, 'close each <whisper>'), ({'script': 'Speaker 1: <shout>hey</shout>'}, 'not a Drama 3 tag'),
               ({'script': 'Speaker 1: <|speaker:0|> hi'}, 'prompt builder'), ({'script': 'Speaker 1:   '}, 'no words'),
               ({'voices': self.voices+[self.voices[0]], 'transcripts': ['a', 'b', 'c', 'd']}, 'at most three'),
               ({'transcripts': ['a', 'b']}, 'one exact transcript'), ({'transcripts': ['a', '', 'c']}, 'Transcript 2'),
               ({'script': 'Speaker 1: Alone.'}, 'no matching Speaker 3'), ({'duration_seconds': 301}, '1-300'),
               ({'voices': ['/etc/passwd', self.voices[1], self.voices[2]]}, 'Missing or changed upload'), ({'prompt': 'x'}, 'Unsupported dialogue fields')]
        for change, message in bad:
            with self.subTest(change=str(change)[:40]), self.assertRaisesRegex(ValueError, message):
                self.e.resolve_task(self.dialogue(**change))

    def test_script_needs_fish(self):
        with self.assertRaisesRegex(ValueError, 'Fish Drama 3'):
            self.e.resolve_task(self.dialogue(model_type=ARCHITECTURE))

    def test_fish_voice_sample_puts_description_in_direction_brackets(self):
        r = self.e.resolve_task({'mode': 'reference_voice', 'model_type': 'fish_drama3', 'prompt': 'I will read these words.', 'alt_prompt': 'Warm, low [gravelly] voice', 'model_mode': 'auto', 'duration_seconds': 15, 'seed': 3})
        self.assertEqual(r['prompt'], 'Speaker 1: [Warm, low gravelly voice] I will read these words.')
        self.assertEqual((r['audio_prompt_type'], r['alt_prompt'], r['top_k']), ('', '', 30))

    def test_dialogue_job_is_a_voice_job_and_archive_allows_long_audio(self):
        j = self.e.submit({'tasks': [self.dialogue()]})
        self.assertEqual(j['operation'], 'reference_voice')
        native = self.root/'long.wav'
        with wave.open(str(native), 'wb') as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(8000); f.writeframes(b'\0\0'*8000*200)
        self.assertEqual(self.e.archive_output(j['job_id'], 1, native)['probe']['duration'], 200)

if __name__ == '__main__':
    unittest.main()
