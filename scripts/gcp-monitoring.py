#!/usr/bin/env python3
"""Idempotent LifeOS Cloud Monitoring alerts, independent of Gmail OAuth."""
import json
import os
import subprocess
import time
import urllib.request
import urllib.error
import urllib.parse
project = os.environ['LIFE_OS_PROJECT']
email = os.environ['LIFE_OS_ALERT_EMAIL']
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
base = f'https://monitoring.googleapis.com/v3/projects/{project}'
def request(path, body=None, method=None):
    req = urllib.request.Request(base+path, data=None if body is None else json.dumps(body).encode(), method=method, headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Newly created metric descriptors can lag in the alerting backend.
            # A definite 404 has not committed a policy; do not retry ambiguous
            # write timeouts or 5xx responses that could create duplicates.
            detail = error.read().decode('utf-8', errors='replace')[:4000]
            if error.code == 404 and path.startswith('/alertPolicies') and body is not None and attempt < 5:
                time.sleep(min(2 ** (attempt + 1), 8))
                continue
            # API error bodies never contain the request bearer header.
            raise RuntimeError(f'Monitoring API {req.method} {path}: HTTP {error.code}: {detail}') from None
descriptor_filter = urllib.parse.urlencode({'filter': 'metric.type = starts_with("custom.googleapis.com/life_os/")', 'pageSize': '1000'})
existing_types = {item['type'] for item in request('/metricDescriptors?' + descriptor_filter).get('metricDescriptors', [])}
for metric in ['heartbeat', 'unhealthy', 'backup_stale', 'triage_overdue', 'auth_blocked']:
    metric_type = 'custom.googleapis.com/life_os/' + metric
    if metric_type not in existing_types:
        request('/metricDescriptors', {'type': metric_type, 'metricKind': 'GAUGE', 'valueType': 'INT64', 'unit': '1', 'displayName': 'LifeOS ' + metric})
channels = request('/notificationChannels').get('notificationChannels', [])
channel = next((c for c in channels if c.get('displayName') == 'LifeOS owner' and c.get('labels', {}).get('email_address') == email), None)
if channel is None:
    channel = request('/notificationChannels', {'type': 'email', 'displayName': 'LifeOS owner', 'labels': {'email_address': email}})
conditions = [{'displayName': 'LifeOS host heartbeat absent for 15 minutes', 'conditionAbsent': {'filter': 'metric.type="custom.googleapis.com/life_os/heartbeat" AND resource.type="global"', 'duration': '900s', 'trigger': {'count': 1}, 'aggregations': [{'alignmentPeriod': '300s', 'perSeriesAligner': 'ALIGN_COUNT'}]}}]
for metric in ['unhealthy', 'backup_stale', 'triage_overdue', 'auth_blocked']:
    conditions.append({'displayName': 'LifeOS '+metric.replace('_', ' '), 'conditionThreshold': {'filter': f'metric.type="custom.googleapis.com/life_os/{metric}" AND resource.type="global"', 'comparison': 'COMPARISON_GT', 'thresholdValue': 0.5, 'duration': '300s', 'trigger': {'count': 1}, 'aggregations': [{'alignmentPeriod': '300s', 'perSeriesAligner': 'ALIGN_MAX'}]}})
policy = {'displayName': 'LifeOS production reliability', 'combiner': 'OR', 'enabled': True, 'conditions': conditions, 'notificationChannels': [channel['name']], 'documentation': {'mimeType': 'text/markdown', 'content': 'Connect through IAP and inspect `systemctl status life-os` and the LifeOS runbook. This alert is independent of Gmail credentials. Do not replay uncertain Gmail writes without reconciliation.'}, 'userLabels': {'app': 'life-os'}}
existing = next((p for p in request('/alertPolicies').get('alertPolicies', []) if p.get('displayName') == policy['displayName'] and p.get('userLabels', {}).get('app') == 'life-os'), None)
if existing:
    policy['name'] = existing['name']
    request('/alertPolicies/'+existing['name'].split('/')[-1], policy, 'PATCH')
else:
    request('/alertPolicies', policy)
print('LifeOS monitoring configured; verify the owner email notification channel and test delivery before cutover.')
