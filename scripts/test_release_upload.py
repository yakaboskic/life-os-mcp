"""CI release upload must work with an upload-only service account."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.parse

spec = importlib.util.spec_from_file_location('release_uploader', Path(__file__).with_name('release-upload.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)


class Response(io.BytesIO):
    def __init__(self, value, headers=None):
        super().__init__(json.dumps(value).encode())
        self.headers = headers or {}


class ReleaseUploadTests(unittest.TestCase):
    def test_upload_uses_only_create_operations_and_generation_zero(self):
        requests = []
        name = 'releases/' + 'a' * 40 + '/123-1.tar.gz'

        def open_request(request, timeout):
            requests.append(request)
            self.assertEqual(request.get_header('Authorization'), 'Bearer test-token')
            if request.method == 'POST':
                query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
                self.assertEqual(query['ifGenerationMatch'], ['0'])
                self.assertEqual(query['name'], [name])
                return Response({}, {'Location': 'https://storage.googleapis.com/upload/session'})
            self.assertEqual(request.method, 'PUT')
            data = request.data.read()
            self.assertEqual(data, b'example release')
            self.assertEqual(int(request.get_header('Content-length')), len(data))
            return Response({'name': name, 'size': str(len(data))})

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.tar.gz'
            path.write_bytes(b'example release')
            uploader.upload_release(path, 'test-bucket', 'a' * 40, '123-1', 'test-token', open_request)
        self.assertEqual([request.method for request in requests], ['POST', 'PUT'])

    def test_untrusted_session_origin_never_receives_token_or_archive(self):
        def open_request(request, timeout):
            self.assertEqual(request.method, 'POST')
            return Response({}, {'Location': 'https://untrusted.example/upload'})

        with tempfile.NamedTemporaryFile() as archive:
            with self.assertRaisesRegex(ValueError, 'session origin'):
                uploader.upload_release(archive.name, 'test-bucket', 'a' * 40, '123-1', 'test-token', open_request)

    def test_mismatched_upload_metadata_is_not_success(self):
        def open_request(request, timeout):
            if request.method == 'POST':
                return Response({}, {'Location': 'https://storage.googleapis.com/upload/session'})
            return Response({'name': 'wrong-object', 'size': '0'})

        with tempfile.NamedTemporaryFile() as archive:
            with self.assertRaisesRegex(ValueError, 'metadata did not match'):
                uploader.upload_release(archive.name, 'test-bucket', 'a' * 40, '123-1', 'test-token', open_request)


if __name__ == '__main__':
    unittest.main()
