"""Real PCM analysis and extraction; YouTube transport is a stub, never a network call."""
import importlib.util
import math
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('sound_worker_tested', ROOT / 'scripts/sound_worker.py')
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

class SoundWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root/'fixture.wav'
        self.emit = patch.object(S, 'emit')
        self.emit.start()
    def tearDown(self):
        self.emit.stop()
        self.tmp.cleanup()
    def pcm(self, active=lambda t: True, duration=3):
        with wave.open(str(self.path), 'wb') as f:
            f.setparams((2, 2, S.RATE, 0, 'NONE', 'not compressed'))
            data = bytearray()
            for i in range(round(S.RATE * duration)):
                x = int(8000*math.sin(2*math.pi*330*i/S.RATE)) if active(i/S.RATE) else 0
                data.extend(struct.pack('<hh', x, -x))
            f.writeframes(data)
    def test_chapters_keep_titles_and_bounds(self):
        self.pcm()
        result = S.analyze(self.path, {}, [dict(start_time=0,end_time=1,title='Opening'),dict(start_time=1,end_time=3,title='Transition')])
        self.assertEqual(result['method'], 'chapters')
        self.assertEqual([x['name'] for x in result['samples']], ['Opening','Transition'])
    def test_silence_and_continuous_music_have_honest_results(self):
        self.pcm(lambda t: False)
        self.assertEqual(S.analyze(self.path, {})['samples'], [])
        self.pcm()
        result = S.analyze(self.path, {})
        self.assertEqual(len(result['samples']), 1)
        self.assertTrue(result['warnings'])
        self.assertGreater(max(result['peaks']), .2)
    def test_gap_padding_stereo_and_exact_extract(self):
        self.pcm(lambda t: .4<t<1 or 1.8<t<2.4)
        result = S.analyze(self.path, {})
        self.assertEqual(len(result['samples']), 2)
        self.assertLessEqual(result['samples'][0]['end'], result['samples'][1]['start'])
        out = self.root/'cut.wav'
        S.main(dict(action='extract',input=str(self.path),output=str(out),start=.5,end=.9))
        with wave.open(str(out),'rb') as f:
            self.assertEqual(f.getnframes(), 19200)
            self.assertEqual(f.getnchannels(), 2)
    def test_bad_settings_and_out_of_bounds_refuse(self):
        self.pcm()
        with self.assertRaises(ValueError): S.analyze(self.path, {'minGap':float('nan')})
        with self.assertRaises(ValueError): S.main(dict(action='extract',input=str(self.path),output=str(self.root/'bad.wav'),start=0,end=4))
    def test_youtube_adapter_downloads_only_confirmed_single_source(self):
        self.pcm()
        calls=[]; outer=self
        class FakeYDL:
            def __init__(self,opts): calls.append(opts); self.opts=opts
            def __enter__(self): return self
            def __exit__(self,*a): pass
            def extract_info(self,url,download):
                calls.append((url,download))
                shutil.copyfile(outer.path,outer.root/'download.wav')
                return dict(title='Test sound compilation',uploader='Test source',license='test',chapters=[dict(start_time=0,end_time=1,title='Sting'),dict(start_time=1,end_time=3,title='Theme')])
        with patch.dict(sys.modules,{'yt_dlp':types.SimpleNamespace(YoutubeDL=FakeYDL)}):
            with self.assertRaises(ValueError): S.download(dict(url='https://www.youtube.com/watch?v=NirnxVtIcRc'),self.root)
            self.assertFalse(calls)
            result=S.main(dict(url='https://www.youtube.com/watch?v=NirnxVtIcRc',rightsConfirmed=True,output=str(self.root/'source.wav')))
        self.assertEqual(calls[1], ('https://www.youtube.com/watch?v=NirnxVtIcRc',True))
        self.assertTrue(calls[0]['noplaylist'])
        self.assertNotIn('cookiefile',calls[0])
        self.assertEqual(result['method'],'chapters')
        self.assertEqual(result['provenance']['name'],'Test sound compilation')
    def test_network_manifest_rejected_before_decode(self):
        self.path.write_text('#EXTM3U\nhttp://127.0.0.1/private\n')
        with self.assertRaisesRegex(ValueError,'Playlists'):
            S.main(dict(input=str(self.path),output=str(self.root/'blocked.wav')))

if __name__ == '__main__': unittest.main()
