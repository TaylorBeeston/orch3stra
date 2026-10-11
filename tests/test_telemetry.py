"""Deterministic telemetry checks: no GPU, browser, or external calls."""
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('director_timers',Path(__file__).resolve().parents[1]/'wan2gp-h3-director/telemetry.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Clock:
 def __init__(self):self.n=0
 def __call__(self):return self.n
 def advance(self,n):self.n+=n
class TimingTests(unittest.TestCase):
 def setUp(self):
  self.clock=Clock();self.tasks=[{'multi_prompts_gen_type':'PW','prompt':'[/duration=226]\none\n\n[/duration=208,/overlap=18]\ntwo\n\n[/duration=208,/overlap=18]\nthree','num_inference_steps':8,'resolution':'832x480','video_length':642}]
  self.t=m.JobTelemetry(self.tasks,[{'id':'w1','task_index':1,'window_index':1,'title':'First'}],self.clock,lambda:1000+self.clock.n)
 def event(self,step=None,phase='inference',wi=1,**kw):
  self.t.observe({'phase':phase,'current_step':step,'total_steps':8 if phase=='inference' else None,**kw},1,wi,3)
 def test_waiting_is_not_denoising(self):
  self.clock.advance(70);s=self.t.snapshot();self.assertEqual(s['elapsed_seconds'],70);self.assertIsNone(s['current']);self.assertIsNone(s['generation_elapsed_seconds']);self.assertIsNone(s['total_eta'])
 def test_compile_plan_and_stable_ids(self):
  self.assertEqual(self.t.windows[0]['id'],'w1');self.assertEqual(self.t.windows[1]['span'],226);self.assertEqual(self.t.windows[1]['start_frame'],226)
 def test_total_includes_queue_but_window_does_not(self):
  self.clock.advance(20);self.event(0);self.clock.advance(10);s=self.t.snapshot();self.assertEqual(s['elapsed_seconds'],30);self.assertEqual(s['queue_wait_seconds'],20);self.assertEqual(s['current']['elapsed_seconds'],10)
 def test_no_rate_until_a_measured_counter_transition(self):
  self.event(0);self.clock.advance(9);self.assertIsNone(self.t.snapshot()['current']['seconds_per_step'])
 def test_first_measured_step(self):
  self.event(0);self.clock.advance(10);self.event(1);c=self.t.snapshot()['current'];self.assertEqual(c['last_step_seconds'],10);self.assertEqual(c['completed_steps'],1);self.assertEqual(c['seconds_per_step']['seconds'],10)
 def test_duplicate_counter_does_not_reset_step_clock(self):
  self.event(0);self.clock.advance(5);self.event(0);self.clock.advance(5);self.event(1);self.assertEqual(self.t.snapshot()['current']['last_step_seconds'],10)
 def test_missing_callbacks_are_batch_average(self):
  self.event(0);self.clock.advance(30);self.event(3);c=self.t.snapshot()['current'];self.assertTrue(c['last_step_is_batch_average']);self.assertEqual(c['last_step_seconds'],10)
 def test_polling_does_not_invent_completed_steps(self):
  self.event(0);self.clock.advance(100);self.assertEqual(self.t.snapshot()['current']['completed_steps'],0)
 def test_overdue_countdown_is_withheld_not_stuck_zero(self):
  self.event(0);self.clock.advance(10);self.event(1);self.clock.advance(20);c=self.t.snapshot()['current'];self.assertIsNone(c['next_step_eta']);self.assertTrue(c['estimate_overdue'])
 def test_pause_not_added_to_denoising_rate(self):
  self.event(0);self.clock.advance(10);self.event(1);self.event(None,'paused');self.clock.advance(100);self.event(1);self.clock.advance(10);self.event(2);c=self.t.snapshot()['current'];self.assertEqual(c['denoising_seconds'],20);self.assertEqual(c['phase_seconds']['paused'],100);self.assertEqual(c['last_step_seconds'],10)
 def test_final_decoding_transition_closes_last_step(self):
  self.event(0);self.clock.advance(70);self.event(7);self.clock.advance(10);self.event(None,'decoding');c=self.t.snapshot()['current'];self.assertEqual(c['completed_steps'],8);self.assertTrue(c['final_step_inferred_from_decode']);self.assertEqual(c['denoising_seconds'],80)
 def test_upscaler_denoising_does_not_become_h3_steps(self):
  self.event(0);self.clock.advance(70);self.event(7);self.clock.advance(10);self.event(None,'decoding');self.clock.advance(10);self.t.observe({'phase':'inference','raw_phase':'Denoising','current_step':20,'total_steps':50},1,1,3);c=self.t.snapshot()['current'];self.assertEqual(c['completed_steps'],8);self.assertEqual(c['total_steps'],8);self.assertEqual(c['phase'],'postprocessing');self.assertEqual(c['native_current_step'],20);self.assertEqual(c['denoising_seconds'],80)
 def test_step_reset_withholds_rate(self):
  self.event(0);self.clock.advance(10);self.event(1);self.event(0);self.assertIsNone(self.t.snapshot()['current']['seconds_per_step'])
 def test_next_window_completes_previous_without_shared_step_timer(self):
  self.event(0);self.clock.advance(70);self.event(7);self.clock.advance(10);self.event(None,'decoding');self.clock.advance(20);self.event(0,wi=2);s=self.t.snapshot();self.assertEqual(s['complete_windows'],1);self.assertEqual(s['current']['window_index'],2);self.assertIsNone(s['current']['seconds_per_step']);self.assertEqual(s['windows'][0]['elapsed_seconds'],100)
 def test_whole_job_eta_waits_for_finished_overhead(self):
  self.event(0);self.clock.advance(10);self.event(1);self.assertIsNone(self.t.snapshot()['total_eta'])
 def test_whole_job_eta_after_comparable_window(self):
  self.event(0);self.clock.advance(70);self.event(7);self.clock.advance(10);self.event(None,'decoding');self.clock.advance(20);self.event(0,wi=2);self.clock.advance(10);self.event(1,wi=2);s=self.t.snapshot();self.assertIsNotNone(s['current']['window_eta']);self.assertIsNotNone(s['total_eta']);self.assertGreater(s['total_eta']['high'],s['total_eta']['low'])
 def test_unknown_runtime_window_warns_without_assigning_other_id(self):
  self.event(0,wi=4);s=self.t.snapshot();self.assertIsNone(s['current']['id']);self.assertTrue(s['plan_warning']);self.assertIsNone(s['total_eta'])
 def test_terminal_timers_freeze(self):
  self.event(0);self.clock.advance(10);self.t.finish('cancelled');a=self.t.snapshot();self.clock.advance(60);b=self.t.snapshot();self.assertEqual(a['elapsed_seconds'],b['elapsed_seconds']);self.assertEqual(b['current']['status'],'cancelled')
 def test_output_before_any_progress_records_no_fabricated_duration(self):
  self.t.mark_output(1,1);c=self.t.snapshot()['windows'][0];self.assertEqual(c['status'],'completed');self.assertIsNone(c['elapsed_seconds'])
 def test_status_window_number_overrides_stale_state(self):
  self.event(0,wi=1,status='Sliding Window 2/3');self.assertEqual(self.t.snapshot()['current']['window_index'],2)
if __name__=='__main__':unittest.main()
