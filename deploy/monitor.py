#!/usr/bin/env python3
"""Publish operational gauges using VM metadata identity; never log private data."""
import datetime as dt
import json
import os
from pathlib import Path
import time
import urllib.request
from zoneinfo import ZoneInfo

project = os.environ['LIFE_OS_PROJECT']
home = Path(os.environ['LIFE_OS_HOME'])
now = dt.datetime.now(dt.timezone.utc)
metrics = {'heartbeat': 1, 'unhealthy': 0, 'backup_stale': 1, 'triage_overdue': 0, 'auth_blocked': 0}

def request(url, headers=None, body=None):
    req = urllib.request.Request(url, headers=headers or {}, data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(req, timeout=10) as response:
        return json.load(response)

try:
    token = Path(os.environ['LIFE_OS_JOB_TOKEN_FILE']).read_text().strip()
    headers = {'Authorization': 'Bearer ' + token}
    ready = request('http://127.0.0.1:4748/readyz', headers)
    metrics['unhealthy'] = int(not ready.get('ok'))
    status = request('http://127.0.0.1:4748/v1/jobs/status', headers)
    # Until cutover the schedule is intentionally disabled, with no overdue alert.
    if os.environ.get('LIFE_OS_TRIAGE_APPLY_ENABLED') == 'true':
        local = now.astimezone(ZoneInfo('America/New_York'))
        due = local.replace(hour=6, minute=53, second=0, microsecond=0)
        accounts = status.get('configuredAccounts', [])
        metrics['triage_overdue'] = int(local >= due and not accounts)
        runs = [run for run in status.get('runs', []) if run.get('scheduled') and run.get('mode') == 'apply']
        for account in accounts:
            email = account if isinstance(account, str) else account.get('account')
            recent = next((entry for run in runs for entry in run.get('accounts', []) if entry.get('account') == email), {})
            metrics['auth_blocked'] |= int(recent.get('state') == 'auth_blocked')
            successful = next((run for run in runs if run.get('finishedAt') and any(entry.get('account') == email and entry.get('state') in ['success', 'partial'] and entry.get('failed') == 0 for entry in run.get('accounts', []))), None)
            success_date = None
            if successful:
                success_date = dt.datetime.fromisoformat(successful['finishedAt'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/New_York')).date()
            if local >= due and success_date != local.date():
                metrics['triage_overdue'] = 1
except Exception:
    metrics['unhealthy'] = 1
try:
    age = time.time() - float((home / 'backups/last-success').read_text().strip())
    metrics['backup_stale'] = int(age > 7200 or age < -60)
except (OSError, ValueError):
    pass
identity = request('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token', {'Metadata-Flavor': 'Google'})
series = []
for name, value in metrics.items():
    series.append({'metric': {'type': 'custom.googleapis.com/life_os/' + name}, 'resource': {'type': 'global', 'labels': {'project_id': project}}, 'metricKind': 'GAUGE', 'valueType': 'INT64', 'points': [{'interval': {'endTime': now.isoformat().replace('+00:00', 'Z')}, 'value': {'int64Value': str(value)}}]})
request(f'https://monitoring.googleapis.com/v3/projects/{project}/timeSeries', {'Authorization': 'Bearer ' + identity['access_token'], 'Content-Type': 'application/json'}, {'timeSeries': series})
print('LifeOS operational metrics published')
