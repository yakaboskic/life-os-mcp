#!/usr/bin/env python3
"""Upload immutable backup objects using objectCreator permission only."""
import json
import os
from pathlib import Path
import sys
import urllib.parse
import urllib.request


def upload_backup(archive, bucket, prefixes, opener=urllib.request.urlopen):
    metadata = urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', headers={'Metadata-Flavor': 'Google'})
    with opener(metadata, timeout=15) as response:
        token = json.load(response)['access_token']
    for prefix in prefixes:
        if prefix not in ('hourly', 'daily'):
            raise ValueError('Unexpected backup prefix')
        for path in (Path(archive), Path(str(archive) + '.sha256')):
            name = prefix + '/' + path.name
            size = path.stat().st_size
            content_type = 'application/gzip' if path.suffix == '.gz' else 'text/plain'
            query = urllib.parse.urlencode({'uploadType': 'resumable', 'name': name, 'ifGenerationMatch': '0'})
            request = urllib.request.Request('https://storage.googleapis.com/upload/storage/v1/b/' + urllib.parse.quote(bucket, safe='') + '/o?' + query, data=b'{}', method='POST', headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Upload-Content-Type': content_type, 'X-Upload-Content-Length': str(size)})
            with opener(request, timeout=30) as response:
                session = response.headers['Location']
            location = urllib.parse.urlparse(session)
            if location.scheme != 'https' or location.netloc != 'storage.googleapis.com':
                raise ValueError('Unexpected upload session origin')
            with path.open('rb') as stream:
                request = urllib.request.Request(session, data=stream, method='PUT', headers={'Authorization': 'Bearer ' + token, 'Content-Type': content_type, 'Content-Length': str(size)})
                with opener(request, timeout=300) as response:
                    result = json.load(response)
            if result.get('name') != name or int(result.get('size', -1)) != size:
                raise ValueError('Uploaded backup object metadata did not match')
    print('Verified backup archive and checksum uploaded')

if __name__ == '__main__':
    if len(sys.argv) < 4:
        raise SystemExit('Usage: upload-backup.py <archive> <bucket> hourly [daily]')
    upload_backup(sys.argv[1], sys.argv[2], sys.argv[3:])
