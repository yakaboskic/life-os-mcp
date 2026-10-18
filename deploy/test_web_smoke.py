import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('smoke', pathlib.Path(__file__).with_name('web-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)


class SmokeTargetTest(unittest.TestCase):
    def test_fixed_service_and_candidate_only(self):
        origin = 'https://life-os-web-gateway-example-uc.a.run.app'
        self.assertEqual(smoke.target(origin, '123-2', 'production'), origin)
        self.assertEqual(smoke.target(origin, '123-2', 'candidate'), 'https://r-123-2---life-os-web-gateway-example-uc.a.run.app')

    def test_no_arbitrary_hosts_paths_query_or_run_injection(self):
        origin = 'https://life-os-web-gateway-example-uc.a.run.app'
        for bad in ['http://x.run.app', 'https://x.run.app.evil.test', 'https://x.run.app/path', 'https://x.run.app?x=1', 'https://x@evil.run.app']:
            with self.assertRaises(ValueError): smoke.target(bad, '123-1', 'candidate')
        for run in ['1-1.evil', '1/1', '0-1', '1-0', '-1-1', '1-1\n']:
            with self.assertRaises(ValueError): smoke.target(origin, run, 'candidate')

    def test_redirect_is_never_followed(self):
        with self.assertRaises(ValueError): smoke.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://attacker.example')
