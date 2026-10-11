"""Real FFmpeg/FFprobe with synthetic decoded media; no WanGP/GPU inference."""
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
import numpy as np
from headless.continuation_media import write_decoded_tail, sample_boundary, choose_appearance_frame, write_appearance_frame


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg/FFprobe required')
class DecodedContinuationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.video = np.random.default_rng(76).integers(0, 256, size=(3, 209, 24, 32), dtype=np.uint8)

    def tearDown(self):
        self.tmp.cleanup()

    def decode(self, path, kind):
        args = ['ffmpeg', '-v', 'error', '-i', str(path)]
        args += ['-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24'] if kind == 'video' else ['-map', '0:a:0', '-f', 'f32le', '-c:a', 'pcm_f32le']
        return subprocess.run(args + ['pipe:1'], check=True, capture_output=True, timeout=30).stdout

    def test_exact_rgb_tail_and_local_global_offsets(self):
        p = self.root / 'tail.mkv'
        m = write_decoded_tail(self.video, p, count=18, timeline_end_frame=24000)
        expected = self.video[:, -18:].transpose(1, 2, 3, 0).tobytes()
        self.assertEqual(self.decode(p, 'video'), expected)
        self.assertEqual((m['source_start_frame'], m['source_end_frame']), (191, 209))
        self.assertEqual((m['timeline_start_frame'], m['timeline_end_frame']), (23982, 24000))
        self.assertEqual(m['representation'], 'decoded-rgb8')

    def test_audio_samples_preserved_without_resampling(self):
        for rate in (32000, 44100, 48000):
            with self.subTest(rate=rate):
                audio = np.random.default_rng(rate).uniform(-.75, .75, (sample_boundary(209, rate), 2)).astype('float32')
                p = self.root / f'{rate}.mkv'
                m = write_decoded_tail(self.video, p, count=18, audio=audio, sample_rate=rate)
                expected = audio[sample_boundary(191, rate):sample_boundary(209, rate)]
                self.assertEqual(self.decode(p, 'audio'), expected.astype('<f4').tobytes())
                self.assertEqual(m['audio']['samples'], len(expected))
                self.assertEqual(m['audio']['sample_rate'], rate)

    def test_audio_origin_is_explicit_when_video_includes_prefix(self):
        rate = 48000
        audio = np.random.default_rng(2).uniform(-.5, .5, (sample_boundary(191, rate),)).astype('float32')
        p = self.root / 'aligned.mkv'
        write_decoded_tail(self.video, p, count=18, audio=audio, sample_rate=rate, audio_start_frame=18)
        self.assertEqual(self.decode(p, 'audio'), audio[sample_boundary(173, rate):].tobytes())
        with self.assertRaisesRegex(ValueError, 'aligned'):
            write_decoded_tail(self.video, self.root / 'wrong.mkv', count=18, audio=audio, sample_rate=rate)

    def test_many_windows_keep_checkpoint_frame_count_and_size_bounded(self):
        sizes = []
        for i in range(12):
            p = self.root / f'window-{i}.mkv'
            m = write_decoded_tail(self.video, p, count=18, timeline_end_frame=209 * (i + 1))
            self.assertEqual(m['frames'], 18)
            sizes.append(p.stat().st_size)
        self.assertLess(max(sizes) - min(sizes), 128)
        self.assertEqual(self.video.shape[1], 209)

    def test_no_overwrite_and_invalid_inputs_never_publish(self):
        p = self.root / 'immutable.mkv'
        p.write_bytes(b'original')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            write_decoded_tail(self.video, p, count=18)
        self.assertEqual(p.read_bytes(), b'original')
        for count in (0, 121, 1.5):
            with self.assertRaises(ValueError):
                write_decoded_tail(self.video, self.root / f'bad-{count}.mkv', count=count)
        with self.assertRaisesRegex(ValueError, 'uint8'):
            write_decoded_tail(self.video.astype('float32'), self.root / 'float.mkv', count=18)

    def test_boundary_rounding_does_not_accumulate(self):
        rate = 44100
        counts = [sample_boundary(i + 1, rate) - sample_boundary(i, rate) for i in range(2400)]
        self.assertEqual(sum(counts), rate * 100)

    def test_writer_never_materializes_the_whole_decoded_video(self):
        class FrameOnly:
            def __init__(self, value):
                self.value = value
                self.shape, self.dtype = value.shape, value.dtype
                self.reads = []

            def __array__(self, *args, **kwargs):
                raise AssertionError('Whole-tensor copy attempted')

            def __getitem__(self, key):
                assert isinstance(key, tuple) and type(key[1]) is int
                self.reads.append(key[1])
                return self.value[key]

        frames = FrameOnly(self.video)
        write_decoded_tail(frames, self.root / 'streamed.mkv', count=18)
        self.assertEqual(frames.reads, list(range(191, 209)))

    def test_appearance_heuristic_stays_in_early_shot_and_skips_blank_frames(self):
        video = self.video.copy()
        video[:, :5] = 0
        selected = choose_appearance_frame(video)
        self.assertGreaterEqual(selected['frame'], 5)
        self.assertLess(selected['frame'], 14)
        self.assertTrue(selected['heuristic'])
        self.assertIsNone(choose_appearance_frame(np.zeros_like(video)))
        selected = choose_appearance_frame(video, start_frame=100, end_frame=150)
        self.assertGreaterEqual(selected['frame'], 102)
        self.assertLess(selected['frame'], 114)

    def test_degenerate_appearance_frames_do_not_produce_nan_scores(self):
        import warnings
        for shape in ((3, 5, 1, 8), (3, 5, 8, 1), (3, 5, 0, 8)):
            video = np.random.default_rng(42).integers(0, 256, size=shape, dtype=np.uint8)
            with warnings.catch_warnings():
                warnings.simplefilter('error', RuntimeWarning)
                self.assertIsNone(choose_appearance_frame(video))

    def test_anchor_png_preserves_chosen_decoded_rgb_and_never_overwrites(self):
        p = self.root / 'anchor.png'
        meta = write_appearance_frame(self.video, p, 8)
        self.assertTrue(meta['context_only'])
        self.assertEqual(self.decode(p, 'video'), self.video[:, 8].transpose(1, 2, 0).tobytes())
        with self.assertRaisesRegex(ValueError, 'already exists'):
            write_appearance_frame(self.video, p, 9)


if __name__ == '__main__':
    unittest.main()
