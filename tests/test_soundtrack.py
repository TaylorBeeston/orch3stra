"""Kept-soundtrack ('AS') slicing: real FFmpeg files and queue resolution; no model inference."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from headless.engine import HeadlessEngine
from headless.reference_voices import audio_probe
from test_headless import Session, task


def tone(path, seconds):
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=%s' % seconds,
                    '-c:a', 'pcm_s16le', str(path)], check=True, capture_output=True, timeout=60)


class SoundtrackSliceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.e = HeadlessEngine(self.root, session=Session(), probe=lambda p: {'fps': 24, 'frames': 107}, start_dispatcher=False)
        path = self.root/'uploads'/'song.wav'
        tone(path, 12)
        self.song = self.e.register_upload(path, 'song.wav', 'audio/wav')['media_id']

    def tearDown(self):
        self.e.close()
        self.tmp.cleanup()

    def as_task(self, **extra):
        return dict(task(), audio_prompt_type='AS', audio_guide=self.song, _director_soundtrack={'start_seconds': 2.5, 'duration_seconds': 5.0}, **extra)

    def test_window_gets_an_owned_cut_of_exactly_its_slice(self):
        resolved = self.e.resolve_task(self.as_task())
        out = Path(resolved['audio_guide'])
        self.assertEqual(out.parent, self.root/'soundtracks')
        self.assertAlmostEqual(audio_probe(out)['duration'], 5.0, delta=.02)
        self.assertEqual(resolved['audio_prompt_type'], 'AS')
        self.assertNotIn('_director_soundtrack', resolved)
        self.assertEqual(self.e.resolve_task(self.as_task())['audio_guide'], str(out))  # deterministic, cached

    def test_source_video_prefix_is_covered_with_leading_silence_when_needed(self):
        path = self.e.resolve_task(self.as_task())['audio_guide']
        media = self.e.media[self.song]['path']
        covered = self.e.soundtrack_slice(media, 1.0, 4.0, prefix_frames=48)  # 2 s prefix, 1 s before the asset start
        self.assertAlmostEqual(audio_probe(covered)['duration'], 6.0, delta=.02)
        volume = subprocess.run(['ffmpeg', '-v', 'info', '-nostdin', '-t', '0.9', '-i', covered, '-af', 'volumedetect', '-f', 'null', '-'],
                                capture_output=True, text=True, timeout=60).stderr
        self.assertRegex(volume, r'max_volume: -(9\d|inf)')
        self.assertNotEqual(covered, path)

    def test_out_of_range_slice_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'exceeds the 12.000s asset'):
            self.e.resolve_task(dict(self.as_task(), _director_soundtrack={'start_seconds': 9.0, 'duration_seconds': 5.0}))

    def test_as_without_slice_and_slice_without_as_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'needs audio_prompt_type'):
            self.e.resolve_task(dict(task(), audio_prompt_type='AS', audio_guide=self.song))
        with self.assertRaisesRegex(ValueError, 'needs audio_prompt_type'):
            self.e.resolve_task(dict(self.as_task(), audio_prompt_type='A'))

    def test_soundtrack_excludes_other_audio_references(self):
        with self.assertRaisesRegex(ValueError, 'audio_guide only'):
            self.e.resolve_task(self.as_task(audio_guide2=self.song))

    def test_unowned_path_is_never_accepted(self):
        with self.assertRaisesRegex(ValueError, 'Missing or changed upload'):
            self.e.resolve_task(dict(self.as_task(), audio_guide=str(self.root/'uploads'/'song.wav')))

    def test_health_advertises_soundtrack_and_three_voice_capabilities(self):
        caps = self.e.health()['capabilities']
        self.assertEqual((caps['soundtrack_slices'], caps['audio_references']), (1, 3))


if __name__ == '__main__':
    unittest.main()
