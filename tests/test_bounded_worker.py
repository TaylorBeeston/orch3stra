"""Synthetic public-API result fixtures + real FFmpeg/SQLite; no model inference."""
import copy
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
import numpy as np
from headless.engine import HeadlessEngine, probe_video
from headless.bounded_media import bounded_spec, select_artifact, persist_artifact_tail, extract_owned_tail
from headless.continuation_media import sample_boundary, write_decoded_tail
from test_headless import Session, task, wait


class MediaSession(Session):
    def __init__(self, root):
        super().__init__(); self.root = root; self.omit_artifact = False
        self.shortest_mux = False
        self.sample_rate = 48000

    def submit_task(self, t):
        self.calls.append(copy.deepcopy(t))
        prefix = int(t.get('keep_frames_video_source') or 0)
        frames = prefix + t['video_length']
        video = np.random.default_rng(len(self.calls)).integers(0, 256, (3, frames, 16, 16), dtype=np.uint8)
        rate = 32000 if self.shortest_mux else self.sample_rate
        audio = np.full((sample_boundary(t['video_length'], rate), 2), .2, dtype=np.float32)
        full_audio = np.full((sample_boundary(frames, rate), 2), .2, dtype=np.float32)
        raw = self.root / 'audio.f32'; raw.write_bytes(full_audio.tobytes())
        out = self.root / f'output-{len(self.calls)}.mp4'
        video_only = self.root / f'video-{len(self.calls)}.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
            '-video_size', '16x16', '-framerate', '24', '-i', 'pipe:0', '-f', 'f32le',
            '-ar', str(rate), '-ac', '2', '-i', str(raw), '-c:v', 'libx264', '-threads', '1',
            *(['-an', str(video_only)] if self.shortest_mux else ['-c:a', 'aac', str(out)])],
            input=video.transpose(1,2,3,0).tobytes(), check=True,
            capture_output=True, timeout=30)
        if self.shortest_mux:
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video_only), '-f', 'f32le',
                '-ar', str(rate), '-ac', '2', '-i', str(raw), '-c:v', 'copy', '-c:a', 'aac',
                '-b:a', '128k', '-shortest', str(out)], check=True, capture_output=True, timeout=30)
        artifact = NS(client_id=t['client_id'], path=str(out), fps=24, media_type='video',
            hdr=False, video_tensor_uint8=video, audio_tensor=audio, audio_sampling_rate=rate)
        result = NS(success=True, generated_files=[str(out)], errors=[],
            artifacts=() if self.omit_artifact else (artifact,))
        return NS(events=NS(get=lambda **kw:None), done=True, result=lambda:result, cancel=lambda:None)


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class BoundedWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.session = MediaSession(self.root)
        self.engine = HeadlessEngine(self.root/'engine', session=self.session)

    def tearDown(self):
        self.engine.close(); self.tmp.cleanup()

    def submit(self, index, source=None, checkpoint=18, capture=False, new_frames=107):
        t=task(); context=18 if source else 0
        t['video_length'] = new_frames
        t['_director_bounded'] = dict(timeline_start_frame=index*107, context_frames=context,
            new_frames=new_frames, checkpoint_frames=checkpoint)
        if capture:t['_director_appearance_capture']={'start_frame':context}
        if source:
            t['_director_continuation']=dict(jobId=source['job_id'], outputId=source['id'], keepFrames=source['probe']['frames'])
        data=dict(tasks=[t], request_id=f'bounded-{index}', plan=[dict(id=f'w{index}',
            task_index=1,window_index=1,start_frame=context,end_frame=context+new_frames,frames=new_frames,overlap=context)])
        job=self.engine.submit(data)['job_id']
        wait(lambda:self.engine.job_state(job)['status'] in ('completed','failed'),timeout=15)
        return self.engine.job_state(job), data

    def test_successive_windows_use_only_owned_lossless_tails_and_keep_global_offsets(self):
        previous=None
        for i in range(8):
            state,data=self.submit(i, previous)
            self.assertEqual(state['status'],'completed')
            self.assertNotIn('continuation_error',state)
            out=state['outputs'][0]; previous=out
            self.assertEqual(out['layout'],'bounded-v1')
            self.assertEqual(out['timeline_start_frame'],i*107)
            self.assertEqual(out['timeline_end_frame'],(i+1)*107)
            self.assertEqual(out['source_end_frame']-out['source_start_frame'],107)
            self.assertLessEqual(out['probe']['frames'],125)
            self.assertEqual(out['continuation']['frames'],18)
            dispatched=self.session.calls[-1]
            self.assertEqual(dispatched['_api'],{'return_media':True})
            self.assertFalse(any(k.startswith('_director') for k in dispatched))
            if i:
                self.assertEqual(probe_video(dispatched['video_source'])['frames'],18)
                self.assertEqual(dispatched['keep_frames_video_source'],'18')
            self.assertEqual(self.engine.submit(data)['job_id'],state['job_id'])
        self.assertEqual(len(self.session.calls),8)
        self.assertNotIn('continuation_private',json.dumps(state))
        self.assertNotIn(str(self.root),json.dumps(state['outputs']))

    def test_missing_artifact_preserves_output_geometry_and_refuses_encoded_fallback(self):
        self.session.omit_artifact=True
        state,_=self.submit(0)
        self.assertEqual(state['status'],'completed')
        self.assertIn('continuation_error',state)
        out=state['outputs'][0]
        self.assertTrue(out['available']); self.assertEqual(out['layout'],'bounded-v1')
        with self.assertRaisesRegex(ValueError,'Decoded checkpoint unavailable'):
            self.submit(1,out)
        self.assertEqual(len(self.session.calls),1)
        self.engine.close(); self.engine=HeadlessEngine(self.root/'engine',session=self.session)
        self.assertTrue(self.engine.job_state(state['job_id'])['outputs'][0]['available'])
        self.assertEqual(len(self.session.calls),1)

    def test_legacy_tail_extracted_once_and_original_never_changed(self):
        state,_=self.submit(0)
        record=self.engine.outputs[state['outputs'][0]['id']]
        # Model an actual legacy record, whose decoded checkpoint never existed.
        record.pop('layout');record.pop('continuation_private');record.pop('continuation')
        original=Path(record['path']).read_bytes()
        p=self.engine.bounded_source(record,107,18)
        stamp=Path(p).stat().st_mtime_ns
        self.assertEqual(self.engine.bounded_source(record,107,18),p)
        self.assertEqual(Path(p).stat().st_mtime_ns,stamp)
        self.assertEqual(probe_video(p)['frames'],18)
        self.assertEqual(Path(record['path']).read_bytes(),original)

    def test_cross_boundary_tail_combines_source_pcm_without_silence_padding(self):
        video=np.random.default_rng(3).integers(0,256,(3,30,8,8),dtype=np.uint8)
        old=np.full((sample_boundary(18,48000),2),.1,dtype=np.float32)
        source=self.root/'source.mkv'
        write_decoded_tail(video[:,:18],source,count=18,audio=old,sample_rate=48000)
        new=np.full((sample_boundary(12,48000),2),.3,dtype=np.float32)
        artifact=NS(video_tensor_uint8=video,audio_tensor=new,audio_sampling_rate=48000)
        spec=dict(timeline_start_frame=107,context_frames=18,new_frames=12,checkpoint_frames=24)
        dest=self.root/'cross.mkv'
        meta=persist_artifact_tail(artifact,dest,spec=spec,actual_frames=30,source=source)
        decoded=subprocess.run(['ffmpeg','-v','error','-i',str(dest),'-map','0:a:0','-f','f32le','pipe:1'],capture_output=True,check=True).stdout
        expected=np.concatenate([old[sample_boundary(6,48000):],new]).tobytes()
        self.assertEqual(decoded,expected)
        self.assertEqual(meta['timeline_end_frame'],119)

    def test_saved_48k_prefix_and_32k_generation_publish_declared_derived_audio(self):
        first,_=self.submit(0)
        record=self.engine.outputs[first['outputs'][0]['id']]
        record.pop('layout');record.pop('continuation_private');record.pop('continuation')
        original=Path(record['path']).read_bytes()
        self.session.sample_rate=32000
        state,_=self.submit(1,first['outputs'][0],checkpoint=120,new_frames=106)
        self.assertEqual(state['status'],'completed')
        self.assertNotIn('continuation_error',state)
        out=state['outputs'][0];meta=out['continuation']
        self.assertTrue(meta['contains_saved_footage'])
        provenance=meta['provenance']['preceding']
        self.assertEqual(provenance['representation'],'decoded-from-saved-footage')
        self.assertEqual(provenance['audio']['input_sample_rate'],48000)
        self.assertEqual(provenance['audio']['output_sample_rate'],32000)
        self.assertEqual(provenance['audio']['samples'],18667)
        self.assertEqual(meta['audio']['samples'],160000)
        next_state,_=self.submit(2,out,checkpoint=120,new_frames=106)
        self.assertNotIn('continuation_error',next_state)
        self.assertEqual(Path(record['path']).read_bytes(),original)
        self.assertEqual(len(self.session.calls),3)

    def test_appearance_anchor_is_owned_lossless_and_counts_against_image_budget(self):
        state,_=self.submit(0,capture=True)
        self.assertNotIn('continuation_error',state)
        movie=next(o for o in state['outputs'] if o['media_kind']=='video')
        anchor=movie['appearance_anchor']
        record=self.engine.output_record(anchor['jobId'],anchor['outputId'])
        self.assertEqual(record['context_only'],'appearance')
        self.assertEqual(record['appearance']['representation'],'decoded-rgb8')
        t=task();t['image_refs']=['h3appearance:'+anchor['jobId']+':'+anchor['outputId']]
        resolved=self.engine.resolve_task(t)
        self.assertEqual(resolved['image_refs'],[record['path']])
        t['image_refs']*=10
        with self.assertRaisesRegex(ValueError,'nine image'):
            self.engine.resolve_task(t)
        self.assertEqual(len(self.session.calls),1)

    def test_rolling_checkpoint_can_exceed_current_task_without_full_tensor_copy(self):
        previous=np.random.default_rng(81).integers(0,256,(3,120,8,8),dtype=np.uint8)
        old_audio=np.full((sample_boundary(120,48000),2),.1,dtype=np.float32)
        source=self.root/'rolling-source.mkv'
        write_decoded_tail(previous,source,count=120,audio=old_audio,sample_rate=48000)
        # Only 18 overlap frames enter generation; the next checkpoint can still
        # retain 120 frames by preserving 13 older frames outside inference.
        current=np.random.default_rng(91).integers(0,256,(3,107,8,8),dtype=np.uint8)
        new_audio=np.full((sample_boundary(89,48000),2),.3,dtype=np.float32)
        artifact=NS(video_tensor_uint8=current,audio_tensor=new_audio,audio_sampling_rate=48000)
        spec=dict(timeline_start_frame=300,context_frames=18,new_frames=89,checkpoint_frames=120)
        dest=self.root/'rolling.mkv'
        meta=persist_artifact_tail(artifact,dest,spec=spec,actual_frames=107,source=source)
        decoded=subprocess.run(['ffmpeg','-v','error','-i',str(dest),'-map','0:v:0','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True).stdout
        expected=np.concatenate([previous[:,89:102],current],axis=1).transpose(1,2,3,0).tobytes()
        self.assertEqual(decoded,expected)
        self.assertEqual(meta['frames'],120)
        self.assertEqual(meta['timeline_end_frame'],389)

    def test_long_legacy_tail_seeks_with_exact_frame_and_sample_selection(self):
        source=self.root/'long.mkv'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=32x24:rate=24:duration=32',
            '-f','lavfi','-i','sine=frequency=523:sample_rate=48000:duration=32',
            '-c:v','ffv1','-pix_fmt','bgr0','-threads','1','-c:a','pcm_f32le',str(source)],check=True,capture_output=True,timeout=30)
        dest=self.root/'long-tail.mkv';end,count=701,18
        extract_owned_tail(source,dest,end=end,count=count,probe=probe_video)
        for kind in ('video','audio'):
            base=['ffmpeg','-v','error','-i',str(source)]
            if kind=='video':
                filters=['-map','0:v:0','-vf',f'trim=start_frame={end-count}:end_frame={end},setpts=PTS-STARTPTS','-pix_fmt','rgb24','-f','rawvideo']
                output=['-map','0:v:0','-pix_fmt','rgb24','-f','rawvideo']
            else:
                filters=['-map','0:a:0','-af',f'atrim=start_sample={sample_boundary(end-count,48000)}:end_sample={sample_boundary(end,48000)}','-f','f32le']
                output=['-map','0:a:0','-f','f32le']
            expected=subprocess.run(base+filters+['pipe:1'],capture_output=True,check=True).stdout
            actual=subprocess.run(['ffmpeg','-v','error','-i',str(dest)]+output+['pipe:1'],capture_output=True,check=True).stdout
            self.assertEqual(actual,expected,kind)

    def test_wrong_task_artifact_and_malformed_bounds_rejected(self):
        with self.assertRaisesRegex(ValueError,'unique'):
            select_artifact(NS(artifacts=(NS(client_id='wrong',path='other'),)),'actual','target')
        t=task();t['_director_bounded']=dict(timeline_start_frame=0,context_frames=18,new_frames=107,checkpoint_frames=18)
        with self.assertRaises(ValueError):bounded_spec(t)

    def test_mux_loss_records_transient_geometry_preserves_view_and_still_refuses_continuation(self):
        first, _ = self.submit(0)
        self.session.shortest_mux = True
        state, _ = self.submit(1, first['outputs'][0], new_frames=208, checkpoint=120)
        self.assertEqual(state['status'], 'completed')
        geometry = state['decoded_media_geometry']
        self.assertEqual(geometry['decoded_video_frames'], 226)
        self.assertEqual(geometry['viewing_video_frames'], 225)
        self.assertEqual(geometry['expected_video_frames'], 226)
        self.assertEqual(geometry['decoded_audio_samples'], 277333)
        self.assertEqual(geometry['audio_origin_frame'], 18)
        self.assertIn('frame counts disagree', state['continuation_error'])
        out = state['outputs'][0]
        self.assertTrue(out['available'])
        self.assertNotIn('continuation', out)
        self.assertEqual(out['source_end_frame'], 225)
        self.assertEqual(out['timeline_end_frame'], 314)
        original = Path(self.engine.outputs[out['id']]['path']).read_bytes()
        with self.assertRaisesRegex(ValueError, 'Decoded checkpoint unavailable'):
            self.submit(2, out)
        self.assertEqual(len(self.session.calls), 2)
        self.assertEqual(Path(self.engine.outputs[out['id']]['path']).read_bytes(), original)
        self.engine.close()
        self.engine = HeadlessEngine(self.root/'engine', session=self.session)
        self.assertEqual(self.engine.job_state(state['job_id'])['decoded_media_geometry'], geometry)
        self.assertEqual(len(self.session.calls), 2)

if __name__=='__main__':unittest.main()
