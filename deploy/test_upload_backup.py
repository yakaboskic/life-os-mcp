"""The VM can create backup objects but cannot read/list existing objects."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.parse

spec = importlib.util.spec_from_file_location('uploader', Path(__file__).with_name('upload-backup.py'))
uploader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(uploader)

class UploadTests(unittest.TestCase):
    def test_upload_uses_only_create_operations_and_generation_zero(self):
        requests = []
        pending = {}
        class Response(io.BytesIO):
            def __init__(self, value, headers=None):
                super().__init__(json.dumps(value).encode())
                self.headers = headers or {}
        def open_request(request, timeout):
            requests.append(request)
            if 'metadata.google.internal' in request.full_url:
                return Response({'access_token': 'test-token'})
            if request.method == 'POST':
                query = urllib.parse.parse_qs(urllib.parse.urlparse(request.full_url).query)
                self.assertEqual(query['ifGenerationMatch'], ['0'])
                pending['name'] = query['name'][0]
                return Response({}, {'Location': 'https://storage.googleapis.com/upload/session'})
            self.assertEqual(request.method, 'PUT')
            data = request.data.read()
            self.assertEqual(int(request.get_header('Content-length')), len(data))
            return Response({'name': pending['name'], 'size': str(len(data))})
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'test.tar.gz'
            path.write_bytes(b'example archive')
            Path(str(path)+'.sha256').write_text('example checksum')
            uploader.upload_backup(path, 'private-test-bucket', ['hourly', 'daily'], open_request)
        self.assertEqual(len(requests), 9)
        self.assertTrue(all(r.method in ('POST', 'PUT') for r in requests[1:]))

if __name__ == '__main__':
    unittest.main()
