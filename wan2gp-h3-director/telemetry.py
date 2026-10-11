"""CPU-only, observation-based render telemetry; never executes or alters WanGP work.

Window/step IDs come from WanGP. Timers use monotonic time; wall clock is only
for display. An ETA range is a heuristic, not a statistical confidence interval.
No completed step is fabricated by a polling timer. WanGP switches the final
step event to decoding; that explicit phase transition closes the last step.
"""
from __future__ import annotations
import copy
import math
import json
import re
import statistics
import time


def integer(value, default=None):
    try:
        n = int(value)
        return n if not isinstance(value, bool) and float(value) == n else default
    except (TypeError, ValueError, OverflowError):
        return default


def positive(value, default=None):
    n = integer(value)
    return n if n is not None and n > 0 else default


def estimate(values, scale=1.0, uncertainty=0.25):
    values = [float(v) for v in values if isinstance(v, (int, float)) and math.isfinite(v) and v > 0]
    if not values:
        return None
    recent = values[-12:]
    center = statistics.median(recent)
    mad = statistics.median(abs(v-center) for v in recent)
    spread = max(center*uncertainty, mad*2, center*(0.5 if len(recent) < 3 else 0.2))
    return {'seconds': round(center*scale, 2), 'low': round(max(0, center-spread)*scale, 2),
            'high': round((center+spread)*scale, 2), 'samples': len(recent),
            'confidence': 'early' if len(recent) < 3 else 'measured'}


def remaining(value, elapsed):
    if value is None:
        return None
    result = dict(value)
    for k in ('seconds', 'low', 'high'):
        result[k] = round(max(0, value[k]-max(0, elapsed)), 2)
    if elapsed >= value['high']:
        # Do not show a permanently stuck zero-second countdown.
        return None
    return result


class JobTelemetry:
    def __init__(self, tasks, plan=None, clock=time.monotonic, wall=time.time):
        self.clock, self.wall = clock, wall
        self.created = clock()
        self.created_at = wall()
        self.started = self.finished = None
        self.status = 'submitted'
        self.current = None
        self.windows = []
        self.last_event = None
        self.plan_warning = None
        plan = plan if isinstance(plan, list) else []
        supplied = {}
        for row in plan[:10000]:
            if isinstance(row, dict):
                key = (positive(row.get('task_index')), positive(row.get('window_index')))
                if key not in supplied:
                    supplied[key] = row
        for ti, task in enumerate(tasks, 1):
            linked = task.get('multi_prompts_gen_type') == 'PW'
            blocks = re.split(r'\n\s*\n', str(task.get('prompt', '')).strip()) if linked else ['']
            cursor = positive(task.get('keep_frames_video_source'), 0) if task.get('video_source') else 0
            for wi, block in enumerate(blocks, 1):
                source = supplied.get((ti, wi), {})
                command = re.match(r'^\[([^\]]+)\]', block)
                duration = re.search(r'/duration=(\d+)', command.group(1)) if command else None
                ov = re.search(r'/overlap=(\d+)', command.group(1)) if command else None
                frames = positive(duration.group(1) if duration else task.get('video_length'), 0)
                overlap = positive(ov.group(1), 0) if ov else (0 if wi == 1 or '/new_shot' in block[:120] else positive(task.get('sliding_window_overlap'), 0))
                wid = source.get('id')
                if not isinstance(wid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', wid):
                    wid = None
                # Labels only; the browser's plan never changes native task settings.
                row = self._new(ti, wi, wid, str(source.get('title', 'Window '+str(wi)))[:160],
                                frames, overlap, cursor, positive(task.get('num_inference_steps'), 8),
                                str(task.get('resolution', '')), linked)
                row['profile'] = json.dumps({'resolution':task.get('resolution'), 'steps':task.get('num_inference_steps'), 'phases':task.get('guidance_phases',1), 'sampler':task.get('sample_solver'), 'upscale':task.get('spatial_upsampling',''), 'interpolate':task.get('temporal_upsampling',''), 'images':len(task.get('image_refs') or []), 'video':sum(bool(task.get(k)) for k in ('video_guide','video_guide2')), 'audio':sum(bool(task.get(k)) for k in ('audio_guide','audio_guide2'))}, sort_keys=True)
                self.windows.append(row)
                cursor += frames
        self._index = {(w['task_index'], w['window_index']): w for w in self.windows}

    @staticmethod
    def _new(ti, wi, wid, title, frames, overlap, start, steps, resolution, linked):
        return dict(task_index=ti, window_index=wi, id=wid, title=title,
                    frames=frames, overlap=overlap, span=frames+overlap, start_frame=start, end_frame=start+frames,
                    total_steps=steps, resolution=resolution, linked=linked, phase='pending', status='pending',
                    completed_steps=0, sample_count=0, step_samples=[], phase_seconds={},
                    _started=None, _finished=None, _phase_since=None, _step_at=None, _step_count=None,
                    _denoise_started=None, _denoise_finished=None, _last_event=None,
                    boundary_observed=False, final_step_inferred_from_decode=False, discontinuous=False)

    def _accrue(self, row, now):
        if row['_phase_since'] is not None:
            key = row['phase']
            row['phase_seconds'][key] = row['phase_seconds'].get(key, 0) + max(0, now-row['_phase_since'])
        row['_phase_since'] = now

    def _complete(self, row, now, status='completed'):
        if row['_finished'] is not None:
            return
        self._accrue(row, now)
        row['_finished'] = now
        row['_phase_since'] = None
        row['status'] = status
        row['boundary_observed'] = status == 'completed'
        row['_step_at'] = None

    def mark_running(self):
        if self.started is None:
            self.started = self.clock()
        if self.finished is None:
            self.status = 'running'

    def observe(self, update, task_index=1, window_index=None, total_windows=None):
        if self.finished is not None:
            return
        get = (lambda k, default=None: update.get(k, default)) if isinstance(update, dict) else (lambda k, default=None: getattr(update, k, default))
        text = str(get('status', '') or '')
        match = re.search(r'(?:Sliding\s+)?Window\s+(\d+)\s*/\s*(\d+)', text, re.I)
        if match:
            window_index, total_windows = int(match[1]), int(match[2])
        wi = positive(window_index, 1)
        ti = positive(task_index, 1)
        phase = str(get('phase', '') or 'unknown')
        raw = str(get('raw_phase', '') or '')
        if re.search(r'\bpaus(?:e|ed)\b|\bon pause\b', text+' '+raw, re.I):
            phase = 'paused'
        elif 'denois' in raw.lower() and phase not in {'decoding', 'cancelled'}:
            phase = 'inference'
        now = self.clock()
        self.mark_running()
        row = self._index.get((ti, wi))
        if row is None:
            row = self._new(ti, wi, None, 'Unmapped runtime window '+str(wi), 0, 0, 0, 8, '', True)
            self._index[(ti, wi)] = row
            self.windows.append(row)
            self.plan_warning = 'WanGP reported a window outside the submitted plan. Do not assume timeline alignment.'
        if positive(total_windows) and total_windows != len([w for w in self.windows if w['task_index'] == ti]):
            self.plan_warning = 'Native window count differs from the submitted plan. Render timeline/total ETA may be incomplete.'
        if self.current is not row:
            if self.current is not None and self.current['_finished'] is None:
                self._complete(self.current, now)
            self.current = row
            if row['_finished'] is not None:
                # Unknown restart/repeat: never quietly combine timings of two takes.
                row['discontinuous'] = True
                self.plan_warning = 'A completed window restarted. Estimates are withheld for that window.'
                return
            row['_started'] = now
            row['_phase_since'] = now
            row['status'] = 'running'
        if row['_finished'] is not None:
            return
        # Upscalers can also report a phase named Denoising with their own
        # counters. Never fold those steps into H3's eight diffusion steps.
        row['native_phase'] = phase
        row['native_current_step'] = integer(get('current_step'))
        row['native_total_steps'] = positive(get('total_steps'))
        row['raw_phase'] = raw[:120]
        if row['_denoise_finished'] is not None and phase == 'inference':
            phase = 'postprocessing'
        old_phase = row['phase']
        self._accrue(row, now)
        current_step = integer(get('current_step'))
        total_steps = positive(get('total_steps'))
        if phase == 'inference':
            if total_steps:
                row['total_steps'] = total_steps
            if row['_denoise_started'] is None:
                row['_denoise_started'] = now
            if old_phase != 'inference':
                row['_step_at'] = now
                row['_step_count'] = current_step
            elif current_step is not None and 0 <= current_step <= row['total_steps']:
                last = row['_step_count']
                if last is not None and current_step > last and row['_step_at'] is not None:
                    delta = current_step-last
                    seconds = (now-row['_step_at'])/delta
                    if seconds > 0:
                        row['step_samples'].append(seconds)
                        row['step_samples'] = row['step_samples'][-32:]
                        row['sample_count'] += delta
                        row['last_step_seconds'] = round(seconds, 3)
                        row['last_step_is_batch_average'] = delta > 1
                    row['_step_at'], row['_step_count'] = now, current_step
                elif last is not None and current_step < last:
                    row['discontinuous'] = True
                    row['_step_at'], row['_step_count'] = now, current_step
                    row['step_samples'] = []
                elif last is None:
                    row['_step_at'], row['_step_count'] = now, current_step
            if current_step is not None:
                row['completed_steps'] = max(0, min(row['total_steps'], current_step))
        elif old_phase == 'inference':
            if phase == 'decoding':
                # The native callback labels the last completed diffusion step
                # as VAE decoding. The API may strip that step's counter.
                left = row['total_steps']-row['completed_steps']
                if left > 0 and row['_step_at'] is not None:
                    seconds = (now-row['_step_at'])/left
                    if seconds > 0:
                        row['step_samples'].append(seconds)
                        row['step_samples'] = row['step_samples'][-32:]
                        row['sample_count'] += left
                        row['last_step_seconds'] = round(seconds, 3)
                        row['last_step_is_batch_average'] = left > 1
                    row['final_step_inferred_from_decode'] = True
                row['completed_steps'] = row['total_steps']
                row['_denoise_finished'] = now
            row['_step_at'], row['_step_count'] = None, None
        row['phase'] = phase
        row['native_status'] = text[:600]
        row['_last_event'] = self.last_event = now

    def mark_output(self, task_index, window_index):
        row = self._index.get((task_index, window_index))
        if row is not None and row['_finished'] is None:
            self._complete(row, self.clock())

    def finish(self, status):
        if self.finished is not None:
            return
        now = self.clock()
        self.finished, self.status = now, status
        if self.current is not None:
            self._complete(self.current, now, status)

    def snapshot(self):
        now = self.finished if self.finished is not None else self.clock()
        public = []
        for row in self.windows:
            out = {k: copy.deepcopy(v) for k, v in row.items() if not k.startswith('_') and k != 'step_samples'}
            end = row['_finished'] if row['_finished'] is not None else now
            durations = dict(row['phase_seconds'])
            if row['_phase_since'] is not None:
                durations[row['phase']] = durations.get(row['phase'], 0)+max(0, end-row['_phase_since'])
            out['phase_seconds'] = {k: round(v, 2) for k,v in durations.items()}
            out['elapsed_seconds'] = round(max(0, end-row['_started']), 2) if row['_started'] is not None else None
            out['denoising_seconds'] = round(durations.get('inference', 0), 2)
            out['step_elapsed_seconds'] = round(max(0, now-row['_step_at']), 2) if row['_step_at'] is not None and row['phase'] == 'inference' and row['_finished'] is None else None
            out['last_event_age_seconds'] = round(max(0, now-row['_last_event']), 2) if row['_last_event'] is not None else None
            rate = None if row['discontinuous'] else estimate(row['step_samples'])
            out['seconds_per_step'] = rate
            left = max(0, row['total_steps']-row['completed_steps'])
            elapsed = out['step_elapsed_seconds'] or 0
            out['next_step_eta'] = remaining(rate, elapsed) if row['phase'] == 'inference' and left else None
            out['denoising_eta'] = remaining(estimate(row['step_samples'], left), elapsed) if rate and row['phase'] == 'inference' and left else None
            out['estimate_overdue'] = bool(rate and row['phase'] == 'inference' and left and elapsed >= rate['high'])
            out['window_eta'] = None
            public.append(out)
        finished = [r for r in public if r['status'] == 'completed' and r['elapsed_seconds'] is not None and not r['discontinuous'] and r['denoising_seconds'] > 0]
        current = next((r for r in public if self.current is not None and r['task_index'] == self.current['task_index'] and r['window_index'] == self.current['window_index']), None)
        total_eta = None
        if current and current['status'] == 'running' and current['phase'] != 'paused' and not self.plan_warning:
            comparable = [r for r in finished if r.get('profile') == current.get('profile') and r['span'] > 0 and 0.5 <= current['span']/r['span'] <= 2]
            scaled = any(r['span'] != current['span'] for r in comparable)
            # A step-only estimate is not a finish estimate. Wait for measured
            # decode/save/postprocessing overhead from a comparable full window.
            tails = [max(0.001, r['elapsed_seconds']-r['denoising_seconds']-sum(v for k,v in r['phase_seconds'].items() if k in {'loading_model','encoding_text','pending','paused'}))*(current['span']/r['span']) for r in comparable]
            tail = estimate(tails, uncertainty=0.7 if scaled else 0.5)
            if current['phase'] == 'inference' and current['denoising_eta'] and tail and not current['estimate_overdue']:
                a, b = current['denoising_eta'], tail
                current['window_eta'] = {k: round(a[k]+b[k],2) for k in ('seconds','low','high')}
                current['window_eta'].update(confidence='length-scaled' if scaled else 'early', samples=len(comparable))
            elif tail and current['phase'] not in {'inference','loading_model','encoding_text','pending','unknown'}:
                post = sum(v for k,v in current['phase_seconds'].items() if k not in {'inference','loading_model','encoding_text','pending','paused'})
                current['window_eta'] = remaining(tail, post)
            current_pos = public.index(current)
            future = public[current_pos+1:]
            future_estimates = []
            for target in future:
                sources = [r for r in finished if r.get('profile') == target.get('profile') and r['span'] > 0 and 0.5 <= target['span']/r['span'] <= 2]
                # Explicit, coarse length extrapolation, not an asserted cost law.
                samples = [(r['elapsed_seconds']-r['phase_seconds'].get('loading_model',0)-r['phase_seconds'].get('paused',0))*(target['span']/r['span'])**1.5 for r in sources]
                extrapolated = any(r['span'] != target['span'] for r in sources)
                e = estimate(samples, uncertainty=0.7 if extrapolated else 0.5)
                if e and extrapolated:
                    e['confidence'] = 'length-scaled'
                if e is None:
                    break
                future_estimates.append(e)
            if current['window_eta'] and len(future_estimates) == len(future):
                values = [current['window_eta']]+future_estimates
                total_eta = {k: round(sum(v[k] for v in values), 2) for k in ('seconds','low','high')}
                total_eta.update(confidence='early' if len(finished)<3 else 'measured', samples=len(finished))
        return {'version':1, 'observed_at':self.wall(), 'status':self.status,
                'elapsed_seconds':round(max(0, now-self.created),2),
                'generation_elapsed_seconds':round(max(0, now-self.started),2) if self.started is not None else None,
                'queue_wait_seconds':round(max(0, (self.started if self.started is not None else now)-self.created),2),
                'last_event_age_seconds':round(max(0, now-self.last_event),2) if self.last_event is not None else None,
                'current':current, 'windows':public, 'total_eta':total_eta,
                'complete_windows':sum(w['status']=='completed' for w in public),
                'plan_warning':self.plan_warning,
                'eta_note':'Ranges are heuristics from this job, not guarantees. Whole-window/total estimates wait for completed windows with matching settings/reference counts (nearby lengths are coarsely scaled). Final queue bookkeeping and future pauses are not predictable. Prefix saving, upscaling, references, and thermal/offload changes can widen error.'}
