"""Offline rollout checks: no cloud calls or application data are used."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('deploy-gateway.sh').resolve()
SHA = 'a' * 40
DIGEST = 'sha256:' + 'b' * 64


class GatewayDeployTest(unittest.TestCase):
    def run_rollout(self, failure=''):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / 'bin'
            binary.mkdir()
            release = root / 'release'
            release.mkdir()
            image = b'verified image fixture'
            (release / 'gateway-image.tar.gz').write_bytes(image)
            (release / 'gateway-image.tar.gz.sha256').write_text(hashlib.sha256(image).hexdigest() + '  gateway-image.tar.gz\n')
            log = root / 'calls.jsonl'
            fake = '''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['GATEWAY_TEST_LOG'],'a') as f:f.write(json.dumps([os.path.basename(sys.argv[0]),*args])+'\\n')
if os.path.basename(sys.argv[0])=='docker':
 if args[:2]==['image','inspect']:print('linux/amd64' if '.Os' in args[-1] else os.environ['GITHUB_SHA'])
 sys.exit(0)
if args[:1]==['--project']:args=args[2:]
if args[:4]==['artifacts','docker','images','describe']: print('sha256:'+'b'*64)
elif args[:3]==['run','services','describe']: print(json.dumps({'status':{'traffic':[{'percent':100,'revisionName':'gateway-previous'}]}}))
elif args[:3]==['run','revisions','describe']: print(json.dumps({'status':{'imageDigest':'sha256:'+'b'*64,'conditions':[{'type':'Ready','status':'True'}]},'spec':{'containers':[{'env':[{'name':'LIFE_OS_RELEASE_SHA','value':os.environ['GITHUB_SHA']}]}]}}))
elif args[:2]==['compute','ssh'] and os.environ.get('GATEWAY_TEST_FAIL') and args[-1].endswith(' '+os.environ['GATEWAY_TEST_FAIL']):sys.exit(1)
'''
            for name in ('gcloud', 'docker'):
                path = binary / name
                path.write_text(fake)
                path.chmod(0o755)
            if not shutil.which('sha256sum'):
                path = binary / 'sha256sum'
                path.write_text("#!/usr/bin/env python3\nimport hashlib,pathlib,sys\nfor line in pathlib.Path(sys.argv[-1]).read_text().splitlines():\n digest,name=line.split();assert hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()==digest\n")
                path.chmod(0o755)
            env = {**os.environ, 'PATH': str(binary) + ':' + os.environ['PATH'], 'GCP_PROJECT': 'example-project', 'GCP_ZONE': 'us-central1-a', 'GCP_INSTANCE': 'example-vm', 'GCP_GATEWAY_REGION': 'us-central1', 'GCP_GATEWAY_SERVICE': 'example-gateway', 'GCP_GATEWAY_REPOSITORY': 'example-images', 'GITHUB_SHA': SHA, 'GITHUB_RUN_ID': '123', 'GITHUB_RUN_ATTEMPT': '1', 'GATEWAY_TEST_LOG': str(log), 'GATEWAY_TEST_FAIL': failure}
            env.pop('GOOGLE_GHA_CREDS_PATH', None)
            result = subprocess.run(['bash', str(SCRIPT)], cwd=root, env=env, capture_output=True, text=True)
            calls = [json.loads(line) for line in log.read_text().splitlines()]
            return result, calls

    def test_switches_only_after_candidate_smoke_and_uses_immutable_digest(self):
        result, calls = self.run_rollout()
        self.assertEqual(result.returncode, 0, result.stderr)
        update = next(call for call in calls if call[3:6] == ['run', 'services', 'update'])
        self.assertIn('--no-traffic', update)
        self.assertTrue(update[update.index('--image') + 1].endswith('@' + DIGEST))
        self.assertNotIn('--set-env-vars', update)
        self.assertNotIn('--service-account', update)
        candidate = next(i for i, call in enumerate(calls) if call[-1].endswith(' candidate'))
        promote = next(i for i, call in enumerate(calls) if '--to-revisions' in call)
        self.assertLess(candidate, promote)
        self.assertFalse(any('gateway-previous=100' in call for call in calls))

    def test_failed_candidate_keeps_production_traffic_unchanged(self):
        result, calls = self.run_rollout('candidate')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('--to-revisions' in call for call in calls))

    def test_failed_production_smoke_rolls_back_previous_revision(self):
        result, calls = self.run_rollout('production')
        self.assertNotEqual(result.returncode, 0)
        traffic = [call for call in calls if '--to-revisions' in call]
        self.assertEqual(len(traffic), 2)
        self.assertIn('gateway-previous=100', traffic[-1])
