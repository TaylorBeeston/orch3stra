"""Real FFmpeg saved-footage resampling fixtures; no inference or live files."""
import hashlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
import numpy as np
from headless.bounded_media import extract_owned_tail, persist_artifact_tail
from headless.continuation_media import sample_boundary, write_decoded_tail
from headless.engine import probe_video


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class SavedContextAudioTests(unittest.TestCase):
    def test_silent_saved_context_still_records_derived_visual_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);video=np.zeros((3,124,8,8),dtype=np.uint8)
            source=root/'silent-source.mkv'
            write_decoded_tail(video[:,:18],source,count=18)
            artifact=NS(video_tensor_uint8=video,audio_tensor=None,audio_sampling_rate=None)
            spec=dict(timeline_start_frame=697,context_frames=18,new_frames=106,checkpoint_frames=120)
            meta=persist_artifact_tail(artifact,root/'silent-tail.mkv',spec=spec,actual_frames=124,
                source=source,source_representation='decoded-from-saved-footage')
            self.assertTrue(meta['contains_saved_footage'])
            self.assertIsNone(meta['provenance']['generated_audio'])
            self.assertEqual(meta['provenance']['preceding'],
                {'representation':'decoded-from-saved-footage','frames':14})

    def test_saved_tail_resamples_only_old_pcm_with_exact_fractional_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for source_rate,new_frames in ((48000,106),(48000,107),(44100,106)):
                with self.subTest(source_rate=source_rate,new_frames=new_frames):
                    source=root/f'source-{source_rate}-{new_frames}.mkv'
                    old=np.arange(sample_boundary(225,source_rate),dtype=np.float64)
                    pcm=np.stack([.15*np.sin(old*2*np.pi*997/source_rate),
                                  .1*np.cos(old*2*np.pi*311/source_rate)],axis=1).astype(np.float32)
                    rgb=np.random.default_rng(6).integers(0,256,(3,225,8,8),dtype=np.uint8)
                    raw=root/f'audio-{source_rate}-{new_frames}.f32';raw.write_bytes(pcm.tobytes())
                    subprocess.run(['ffmpeg','-v','error','-f','rawvideo','-pixel_format','rgb24',
                        '-video_size','8x8','-framerate','24','-i','pipe:0','-f','f32le',
                        '-ar',str(source_rate),'-ac','2','-i',str(raw),'-c:v','ffv1',
                        '-pix_fmt','bgr0','-threads','1','-c:a','pcm_f32le',str(source)],
                        input=rgb.transpose(1,2,3,0).tobytes(),capture_output=True,check=True)
                    original=hashlib.sha256(source.read_bytes()).hexdigest()
                    tail=root/f'tail-{source_rate}-{new_frames}.mkv'
                    receipt=extract_owned_tail(source,tail,end=225,count=18,probe=probe_video)
                    self.assertEqual((receipt['source_start_frame'],receipt['source_end_frame']),(207,225))
                    video=np.random.default_rng(7).integers(0,256,(3,18+new_frames,8,8),dtype=np.uint8)
                    new=np.random.default_rng(8).uniform(-.2,.2,(sample_boundary(new_frames,32000),2)).astype(np.float32)
                    untouched=new.copy()
                    artifact=NS(video_tensor_uint8=video,audio_tensor=new,audio_sampling_rate=32000)
                    spec=dict(timeline_start_frame=697,context_frames=18,new_frames=new_frames,checkpoint_frames=120)
                    dest=root/f'checkpoint-{source_rate}-{new_frames}.mkv'
                    meta=persist_artifact_tail(artifact,dest,spec=spec,actual_frames=18+new_frames,
                        source=tail,source_representation='decoded-from-saved-footage')
                    old_count=160000-len(new);end=sample_boundary(18,32000);start=end-old_count
                    reference=subprocess.check_output(['ffmpeg','-v','error','-i',str(tail),'-map','0:a:0',
                        '-af',f'aresample=32000,atrim=start_sample={start}:end_sample={end}',
                        '-c:a','pcm_f32le','-f','f32le','pipe:1'])
                    decoded=subprocess.check_output(['ffmpeg','-v','error','-i',str(dest),'-map','0:a:0',
                        '-c:a','pcm_f32le','-f','f32le','pipe:1'])
                    self.assertEqual(decoded,reference+new.tobytes())
                    self.assertEqual(len(decoded)//8,160000)
                    pixels=subprocess.check_output(['ffmpeg','-v','error','-i',str(dest),'-map','0:v:0',
                        '-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
                    self.assertEqual(pixels,video[:,-120:].transpose(1,2,3,0).tobytes())
                    np.testing.assert_array_equal(new,untouched)
                    self.assertEqual(meta['timeline_end_frame'],697+new_frames)
                    self.assertTrue(meta['contains_saved_footage'])
                    self.assertEqual(meta['provenance']['preceding']['audio']['output_start_sample'],start)
                    self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),original)

    def test_original_decoded_pcm_rate_mismatch_and_missing_samples_still_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);video=np.zeros((3,124,8,8),dtype=np.uint8)
            source=root/'original-decoded.mkv'
            write_decoded_tail(video[:,:18],source,count=18,
                audio=np.zeros((36000,2),dtype=np.float32),sample_rate=48000)
            artifact=NS(video_tensor_uint8=video,audio_tensor=np.zeros((141333,2),dtype=np.float32),audio_sampling_rate=32000)
            spec=dict(timeline_start_frame=697,context_frames=18,new_frames=106,checkpoint_frames=120)
            with self.assertRaisesRegex(ValueError,'rates/channels disagree'):
                persist_artifact_tail(artifact,root/'refused.mkv',spec=spec,actual_frames=124,source=source)
            self.assertFalse((root/'refused.mkv').exists())
            artifact.audio_tensor=artifact.audio_tensor[:-1]
            with self.assertRaisesRegex(ValueError,'incomplete PCM coverage'):
                persist_artifact_tail(artifact,root/'short.mkv',spec=spec,actual_frames=124,
                    source=source,source_representation='decoded-from-saved-footage')
            self.assertFalse((root/'short.mkv').exists())
            artifact.audio_tensor=np.zeros((141333,2),dtype=np.float32)
            short_source=root/'short-source.mkv'
            subprocess.run(['ffmpeg','-v','error','-i',str(source),'-map','0:v:0','-map','0:a:0',
                '-c:v','copy','-af','atrim=end_sample=1000','-c:a','pcm_f32le',str(short_source)],
                capture_output=True,check=True)
            with self.assertRaisesRegex(ValueError,'incomplete PCM coverage'):
                persist_artifact_tail(artifact,root/'short-old.mkv',spec=spec,actual_frames=124,
                    source=short_source,source_representation='decoded-from-saved-footage')
            self.assertFalse((root/'short-old.mkv').exists())
            mono_source=root/'mono-source.mkv'
            write_decoded_tail(video[:,:18],mono_source,count=18,
                audio=np.zeros(24000,dtype=np.float32),sample_rate=32000)
            with self.assertRaisesRegex(ValueError,'rates/channels disagree'):
                persist_artifact_tail(artifact,root/'mono-refused.mkv',spec=spec,actual_frames=124,
                    source=mono_source,source_representation='decoded-from-saved-footage')
            self.assertFalse((root/'mono-refused.mkv').exists())


if __name__=='__main__':
    unittest.main()
