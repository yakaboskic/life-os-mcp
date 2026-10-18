#!/usr/bin/env python3
"""Root-installed, read-only gateway smoke test; accepts identities, never a URL."""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


def config(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if line and not line.startswith('#'):
            key, value = line.split('=', 1)
            values[key] = value
    return values


def target(origin, run, mode):
    if not re.fullmatch(r'https://[a-z0-9-]+\.a\.run\.app', origin):
        raise ValueError('Configure one pinned legacy Cloud Run service origin')
    if not re.fullmatch(r'[1-9][0-9]{0,17}-[1-9][0-9]{0,5}', run) or mode not in ('candidate', 'production'):
        raise ValueError('Invalid smoke identity')
    # Prefix the exact pinned hostname. Caller cannot select another service, path or scheme.
    return origin if mode == 'production' else 'https://r-' + run + '---' + urllib.parse.urlsplit(origin).hostname


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Gateway redirects are forbidden')


def read_json(url, token, release=None):
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=20) as response:
                if response.status != 200 or not response.headers.get('Content-Type', '').startswith('application/json'):
                    raise ValueError('Invalid gateway response')
                if release and response.headers.get('X-Life-Os-Release') != release:
                    raise ValueError('Gateway release does not match the verified artifact')
                body = response.read(5 * 1024 * 1024 + 1)
                if len(body) > 5 * 1024 * 1024:
                    raise ValueError('Gateway response limit')
                return json.loads(body)
        except urllib.error.HTTPError as error:
            # Cloud Run/Direct VPC can need a short cold-start interval. Never retry
            # authentication, release mismatch, redirects or a malformed contract.
            if attempt == 2 or error.code not in (429, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                raise
        time.sleep(2)


def main():
    sha, run, mode = sys.argv[1:]
    if not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Invalid release identity')
    origin = target(config('/etc/life-os/deploy.env').get('LIFE_OS_GATEWAY_ORIGIN', ''), run, mode)
    runtime = config('/etc/life-os/runtime.env')
    interactive = Path(runtime['LIFE_OS_INTERACTIVE_TOKEN_FILE']).read_text().strip()
    ready = read_json('http://127.0.0.1:4748/readyz', interactive)
    if ready.get('release') != sha or not ready.get('ok') or ready.get('draining'):
        raise ValueError('VM must be ready on this exact release')
    token = Path(runtime['LIFE_OS_GATEWAY_TOKEN_FILE']).read_text().strip()
    # Consume personal snapshots only in memory. Never print response contents or exception bodies.
    for path in ['/api/data', '/api/triage', '/api/jobs', '/api/automation']:
        value = read_json(origin + path, token, sha)
        if not isinstance(value, dict):
            raise ValueError('Expected a JSON object')
    print(json.dumps({'ok': True, 'release': sha, 'target': mode, 'authenticatedReadRoutes': 4}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Gateway smoke failed: ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
