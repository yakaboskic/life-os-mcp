#!/usr/bin/env python3
"""Upload an immutable release with storage.objects.create permission only."""
import json
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


def upload_release(archive, bucket, sha, run, token, opener=urllib.request.urlopen):
    if not re.fullmatch(r'[0-9a-f]{40}', sha) or not re.fullmatch(r'[1-9][0-9]*-[1-9][0-9]*', run):
        raise ValueError('Invalid release identity')
    path = Path(archive)
    size = path.stat().st_size
    name = f'releases/{sha}/{run}.tar.gz'
    query = urllib.parse.urlencode({'uploadType': 'resumable', 'name': name, 'ifGenerationMatch': '0'})
    # gcloud storage cp probes destination metadata and requires objectViewer.
    # Initiate and finish directly so CI retains its upload-only bucket role.
    request = urllib.request.Request(
        'https://storage.googleapis.com/upload/storage/v1/b/' + urllib.parse.quote(bucket, safe='') + '/o?' + query,
        data=b'{}', method='POST', headers={
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            'X-Upload-Content-Type': 'application/gzip',
            'X-Upload-Content-Length': str(size),
        })
    with opener(request, timeout=30) as response:
        session = response.headers['Location']
    location = urllib.parse.urlparse(session)
    if location.scheme != 'https' or location.netloc != 'storage.googleapis.com':
        raise ValueError('Unexpected upload session origin')
    with path.open('rb') as stream:
        request = urllib.request.Request(session, data=stream, method='PUT', headers={
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/gzip',
            'Content-Length': str(size),
        })
        with opener(request, timeout=300) as response:
            result = json.load(response)
    if result.get('name') != name or int(result.get('size', -1)) != size:
        raise ValueError('Uploaded release object metadata did not match')
    print('Immutable release uploaded')


if __name__ == '__main__':
    if len(sys.argv) != 5:
        raise SystemExit('Usage: release-upload.py <archive> <bucket> <sha> <run-id-attempt>')
    try:
        token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
        if not token:
            raise ValueError('Deployment access token is unavailable')
        upload_release(*sys.argv[1:], token)
    except urllib.error.HTTPError as error:
        # Avoid exposing private bucket URLs or resumable session IDs in public logs.
        raise SystemExit(f'Release upload failed with HTTP {error.code}') from None
