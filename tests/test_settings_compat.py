"""Strict-generation-settings regression: real queue/files; no model inference.

The public API double rejects mask/audio_file even when None, reproducing the
reported WanGP validation contract. It is not WanGP's full validator.
"""
import copy
import json
from pathlib import Path
import tempfile
import time
import unittest

from headless.engine import HeadlessEngine, normalize_generation_settings, TERMINAL
from test_headless import Session, payload, task, plan, wait


class SettingsCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.session = Session()
        self.e = HeadlessEngine(self.root, session=self.session,
                                probe=lambda p: {'fps': 24, 'frames': 107},
                                start_dispatcher=False)

    def tearDown(self):
        self.e.close()
        self.tmp.cleanup()

    def upload(self, filename, content_type, data):
        path = self.root/'uploads'/filename
        path.write_bytes(data)
        mid = self.e.register_upload(path, filename, content_type)['media_id']
        return mid, str(path)

    def test_strict_double_reproduces_old_null_placeholder_error(self):
        old = dict(task(), mask=None, audio_file=None)
        with self.assertRaisesRegex(AssertionError, 'Unknown settings: mask, audio_file'):
            self.session.submit_task(old)
        self.assertFalse(self.session.active)
        self.assertEqual(self.session.calls, [])

    def test_fresh_video_no_longer_injects_invalid_empty_names(self):
        source = task()
        before = copy.deepcopy(source)
        resolved = self.e.resolve_task(source)
        self.assertNotIn('mask', resolved)
        self.assertNotIn('audio_file', resolved)
        self.assertEqual(source, before)
        self.assertIsNone(resolved['image_mask'])
        self.assertIsNone(resolved['video_mask'])
        self.assertIsNone(resolved['audio_source'])

    def test_three_voice_references_resolve_audio_guide3(self):
        ids, paths = zip(*[self.upload('speaker-%d.wav' % n, 'audio/wav', b'voice-%d' % n) for n in (1, 2, 3)])
        i, _ = self.upload('portrait.png', 'image/png', b'portrait')
        resolved = self.e.resolve_task(dict(task(), audio_guide=ids[0], audio_guide2=ids[1], audio_guide3=ids[2],
                                            audio_prompt_type='ABD', image_refs=[i], video_prompt_type='I'))
        self.assertEqual([resolved['audio_guide'], resolved['audio_guide2'], resolved['audio_guide3']], list(paths))
        self.assertEqual(resolved['audio_prompt_type'], 'ABD')

    def test_unowned_audio_guide3_path_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Missing or changed upload'):
            self.e.resolve_task(dict(task(), audio_guide3='/etc/passwd', audio_prompt_type='ABD'))

    def test_real_voice_bindings_are_preserved_not_renamed_to_audio_scale(self):
        a, pa = self.upload('speaker-one.wav', 'audio/wav', b'voice-one')
        b, pb = self.upload('speaker-two.wav', 'audio/wav', b'voice-two')
        i, pi = self.upload('portrait.png', 'image/png', b'portrait')
        t = dict(task(), audio_guide=a, audio_guide2=b, audio_prompt_type='AB',
                 image_refs=[i], video_prompt_type='I', mask=None, audio_file=None)
        resolved = self.e.resolve_task(t)
        self.assertEqual(resolved['audio_guide'], pa)
        self.assertEqual(resolved['audio_guide2'], pb)
        self.assertEqual(resolved['audio_prompt_type'], 'AB')
        self.assertEqual(resolved['image_refs'], [pi])
        self.assertNotIn('audio_scale', resolved)
        self.assertEqual(Path(pa).read_bytes(), b'voice-one')
        self.assertEqual(Path(pb).read_bytes(), b'voice-two')
        self.assertEqual(t['audio_guide'], a)

    def test_only_exact_empty_legacy_keys_removed(self):
        original = {'mask': None, 'audio_file': '', 'audio_scale': 0.75,
                    'custom_settings': {'mask': 'declared-model-setting', 'keep': 2},
                    'future_unrecognized_option': None, 'image_mask': None,
                    'audio_guide': '/owned/voice.wav'}
        before = copy.deepcopy(original)
        fixed = normalize_generation_settings(original)
        self.assertEqual(set(original)-set(fixed), {'mask', 'audio_file'})
        self.assertEqual(fixed['audio_scale'], 0.75)
        self.assertEqual(fixed['custom_settings'], original['custom_settings'])
        self.assertIn('future_unrecognized_option', fixed)
        self.assertEqual(normalize_generation_settings(fixed), fixed)
        self.assertEqual(original, before)

    def test_nonempty_legacy_inputs_never_silently_dropped_or_guessed(self):
        for key in ('mask', 'audio_file'):
            for value in ('/some/input', ' ', False, 0, [], {}):
                with self.subTest(key=key, value=value):
                    p = payload()
                    p['tasks'][0][key] = value
                    with self.assertRaisesRegex(ValueError, 'Unsupported nonempty setting'):
                        self.e.submit(p)
                    self.assertEqual(self.e.jobs, {})
        self.assertEqual(self.session.calls, [])

    def test_nine_images_and_two_audio_slots_keep_order(self):
        ids, paths = [], []
        for n in range(9):
            mid, path = self.upload('image-%d.png' % n, 'image/png', ('image%d' % n).encode())
            ids.append(mid); paths.append(path)
        a, ap = self.upload('first.wav', 'audio/wav', b'first')
        b, bp = self.upload('second.wav', 'audio/wav', b'second')
        resolved = self.e.resolve_task(dict(task(), image_refs=ids, audio_guide=a, audio_guide2=b))
        self.assertEqual(resolved['image_refs'], paths)
        self.assertEqual([resolved['audio_guide'], resolved['audio_guide2']], [ap, bp])

    def test_owned_continuation_and_prompt_schedule_remain_unchanged(self):
        mid, _ = self.upload('prefix.mp4', 'video/mp4', b'verified-video-fixture')
        j = self.e.import_render({'media_id': mid, 'plan': plan()})
        output = j['outputs'][0]
        spec = dict(jobId=j['job_id'], outputId=output['id'], keepFrames=107)
        t = dict(task(), _director_continuation=spec,
                 sliding_window_size=243, sliding_window_overlap=18,
                 mask=None, audio_file=None)
        resolved = self.e.resolve_task(t)
        self.assertEqual(resolved['keep_frames_video_source'], '107')
        self.assertEqual(resolved['video_source'], self.e.output_record(j['job_id'], output['id'])['path'])
        self.assertEqual(resolved['image_prompt_type'], 'V')
        for name in ('prompt', 'video_length', 'multi_prompts_gen_type',
                     'sliding_window_size', 'sliding_window_overlap'):
            self.assertEqual(resolved[name], t[name])
        self.assertEqual(t['_director_continuation'], spec)

    def test_standard_sampler_and_custom_settings_are_not_blanket_filtered(self):
        t = dict(task(), model_type='test_h3_ref2va_standard', sample_solver='ralston_2s',
                 num_inference_steps=30, guidance_phases=2, guidance_scale=4,
                 custom_settings={'test_setting': {'mode': 'safe'}})
        resolved = self.e.resolve_task(t)
        for key in ('custom_settings', 'sample_solver', 'num_inference_steps', 'guidance_phases', 'guidance_scale'):
            self.assertEqual(t[key], resolved[key])

    def test_restored_queued_placeholders_fixed_only_on_dispatch_copy(self):
        p = payload('legacy-queue')
        p['tasks'][0].update(mask=None, audio_file=None)
        jid = self.e.submit(p)['job_id']
        item = self.e.jobs[jid]
        # This is the already-resolved form persisted by the old worker.
        item['resolved'][0].update(mask=None, audio_file=None)
        self.e._save_job(jid)
        before = copy.deepcopy(item['resolved'])
        original_digest = item['digest']
        self.e.close()
        self.e = HeadlessEngine(self.root, session=self.session)
        self.assertTrue(self.e.paused)
        self.assertEqual(self.session.calls, [])
        self.assertEqual(self.e.jobs[jid]['resolved'], before)
        self.e.set_paused(False)
        wait(lambda: len(self.session.jobs) == 1)
        native = self.session.calls[0]
        self.assertNotIn('mask', native)
        self.assertNotIn('audio_file', native)
        self.assertEqual(native['client_id'], before[0]['client_id'])
        self.session.jobs[0].gate.set()
        wait(lambda: self.e.job_state(jid)['status'] in TERMINAL)
        self.assertEqual(self.e.job_state(jid)['status'], 'completed')
        self.assertEqual(self.e.jobs[jid]['payload'], p)
        self.assertEqual(self.e.jobs[jid]['resolved'], before)
        self.assertEqual(self.e.jobs[jid]['digest'], original_digest)
        self.assertEqual(self.e.submit(p)['job_id'], jid)
        self.assertEqual(len(self.session.calls), 1)
        disk = json.loads(self.e.db.execute('SELECT document FROM jobs WHERE id=?', (jid,)).fetchone()[0])
        self.assertEqual(disk['resolved'], before)
        self.assertEqual(disk['payload'], p)

    def test_previous_failed_render_not_replayed_on_restart_or_same_request(self):
        p = payload('old-failed')
        jid = self.e.submit(p)['job_id']
        state = self.e.jobs[jid]['state']
        state.update(status='failed', message='Headless job failed.',
                     errors=['Unknown settings: mask, audio_file (use audio_scale).'],
                     finished_at=time.time())
        self.e._save_job(jid)
        before = self.e.db.execute('SELECT document FROM jobs WHERE id=?', (jid,)).fetchone()[0]
        self.e.close()
        self.e = HeadlessEngine(self.root, session=self.session)
        self.e.set_paused(False)
        time.sleep(.05)
        self.assertEqual(self.session.calls, [])
        self.assertEqual(self.e.submit(p)['job_id'], jid)
        self.assertEqual(self.e.job_state(jid)['status'], 'failed')
        self.assertEqual(self.e.db.execute('SELECT document FROM jobs WHERE id=?', (jid,)).fetchone()[0], before)
        # A new, explicitly requested render is distinct; historical failure stays.
        new = self.e.submit(payload('new-explicit-render'))['job_id']
        wait(lambda: len(self.session.jobs) == 1)
        self.session.jobs[0].gate.set()
        wait(lambda: self.e.job_state(new)['status'] == 'completed')
        self.assertNotEqual(new, jid)
        self.assertEqual(self.e.job_state(jid)['status'], 'failed')

    def test_health_reports_compatibility_without_secrets(self):
        health = self.e.health()
        self.assertEqual(health['version'], '2.3.0')
        self.assertEqual(health['capabilities']['h3_settings_compatibility'], 1)
        self.assertNotIn('token', health)


if __name__ == '__main__':
    unittest.main()
