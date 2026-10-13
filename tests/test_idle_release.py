"""Idle/explicit model release frees WanGP memory between jobs, never during one."""
import os, tempfile, unittest
from pathlib import Path
from headless.engine import HeadlessEngine, TERMINAL
from test_headless import Session, payload, wait


class ClosingSession(Session):
    def __init__(self):
        super().__init__()
        self.closed = 0

    def close(self):
        self.closed += 1


class IdleReleaseTests(unittest.TestCase):
    def make(self, seconds):
        old = os.environ.get('H3_IDLE_RELEASE_SECONDS')
        os.environ['H3_IDLE_RELEASE_SECONDS'] = seconds
        try:
            self.tmp = tempfile.TemporaryDirectory()
            self.session = ClosingSession()
            self.e = HeadlessEngine(Path(self.tmp.name)/'engine', session=self.session, probe=lambda p: {'fps': 24, 'frames': 107})
        finally:
            if old is None:
                os.environ.pop('H3_IDLE_RELEASE_SECONDS', None)
            else:
                os.environ['H3_IDLE_RELEASE_SECONDS'] = old
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.e.close)

    def run_job(self, request='r1'):
        before, count = self.session.closed, len(self.session.jobs)
        jid = self.e.submit(payload(request))['job_id']
        wait(lambda: len(self.session.jobs) > count)
        self.assertEqual(self.session.closed, before, 'never released while a job is running')
        self.assertRaises(ValueError, self.e.request_release)
        self.session.jobs[-1].gate.set()
        wait(lambda: self.e.job_state(jid)['status'] in TERMINAL)

    def test_idle_timeout_releases_once_and_next_job_still_runs(self):
        self.make('0.2')
        self.assertFalse(self.e.health()['model_resident'])
        self.run_job()
        wait(lambda: self.session.closed == 1, timeout=5)
        self.assertFalse(self.e.health()['model_resident'])
        self.assertEqual(self.e.health()['last_model_release']['reason'], 'idle')
        self.run_job('r2')
        wait(lambda: self.session.closed == 2, timeout=5)

    def test_explicit_release_and_disabled_timeout(self):
        self.make('0')
        self.assertFalse(self.e.request_release()['requested'], 'nothing loaded yet')
        self.run_job()
        self.assertTrue(self.e.health()['model_resident'])
        self.assertTrue(self.e.request_release()['requested'])
        wait(lambda: self.session.closed == 1, timeout=5)
        self.assertEqual(self.e.health()['last_model_release']['reason'], 'requested')


if __name__ == '__main__':
    unittest.main()
