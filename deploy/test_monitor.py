"""Check operational alerts against captured daemon responses without cloud access."""
import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

class MonitorTests(unittest.TestCase):
    def monitor(self, status, *, at='2026-11-10T12:00:00+00:00', apply=True, backup_age=0):
        now = datetime.datetime.fromisoformat(at)
        class Clock(datetime.datetime):
            @classmethod
            def now(cls, tz=None):
                return now if tz is not None else now.replace(tzinfo=None)
        captured = []
        def open_request(request, timeout=None):
            url = request.full_url
            if url.endswith('/readyz'):
                value = {'ok': True}
            elif url.endswith('/v1/jobs/status'):
                value = status
            elif 'metadata.google.internal' in url:
                value = {'access_token': 'fake-for-test'}
            elif url.endswith('/timeSeries'):
                captured.extend(json.loads(request.data)['timeSeries'])
                value = {}
            else:
                raise AssertionError('Unexpected network destination: ' + url)
            return io.BytesIO(json.dumps(value).encode())
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            (home/'job.token').write_text('fake-for-test')
            (home/'backups').mkdir()
            (home/'backups/last-success').write_text(str(now.timestamp()-backup_age))
            env = {'LIFE_OS_PROJECT': 'test-project', 'LIFE_OS_HOME': directory, 'LIFE_OS_JOB_TOKEN_FILE': str(home/'job.token'), 'LIFE_OS_TRIAGE_APPLY_ENABLED': str(apply).lower()}
            with patch.dict(os.environ, env), patch('urllib.request.urlopen', open_request), patch('datetime.datetime', Clock), patch('time.time', return_value=now.timestamp()), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(Path(__file__).with_name('monitor.py')))
        self.assertTrue(all(item['resource']['type'] == 'global' for item in captured))
        return {item['metric']['type'].split('/')[-1]: int(item['points'][0]['value']['int64Value']) for item in captured}

    def test_shadow_does_not_satisfy_production_due_run(self):
        status = {'configuredAccounts': ['a@example.com'], 'runs': [
            {'scheduled': True, 'mode': 'dry-run', 'finishedAt': '2026-11-10T11:00:00Z', 'accounts': [{'account': 'a@example.com', 'state': 'success', 'failed': 0}]}
        ]}
        self.assertEqual(self.monitor(status)['triage_overdue'], 1)
        self.assertEqual(self.monitor(status, apply=False)['triage_overdue'], 0)

    def test_each_configured_account_requires_its_own_success(self):
        status = {'configuredAccounts': ['a@example.com', 'b@example.com'], 'runs': [
            {'scheduled': True, 'mode': 'apply', 'finishedAt': '2026-11-10T11:00:00Z', 'accounts': [{'account': 'a@example.com', 'state': 'partial', 'failed': 0}, {'account': 'b@example.com', 'state': 'auth_blocked', 'failed': 1}]}
        ]}
        values = self.monitor(status)
        self.assertEqual(values['triage_overdue'], 1)
        self.assertEqual(values['auth_blocked'], 1)
        status['configuredAccounts'] = ['a@example.com']
        self.assertEqual(self.monitor(status)['triage_overdue'], 0)

    def test_eastern_due_time_and_two_hour_backup_target(self):
        status = {'configuredAccounts': ['a@example.com'], 'runs': []}
        self.assertEqual(self.monitor(status, at='2026-11-10T11:52:00+00:00')['triage_overdue'], 0)
        self.assertEqual(self.monitor(status, at='2026-11-10T11:54:00+00:00')['triage_overdue'], 1)
        self.assertEqual(self.monitor(status, backup_age=7201)['backup_stale'], 1)
        self.assertEqual(self.monitor(status, backup_age=3600)['backup_stale'], 0)

if __name__ == '__main__':
    unittest.main()
