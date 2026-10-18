#!/usr/bin/env python3
"""Add one port-22 binding to one VM IAP resource, preserving its policy/etag."""
import json
import os
import subprocess
import urllib.request
project = os.environ['LIFE_OS_PROJECT']
zone = os.environ['LIFE_OS_ZONE']
member = os.environ['LIFE_OS_MEMBER']
token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
number = subprocess.check_output(['gcloud', 'projects', 'describe', project, '--format=value(projectNumber)'], text=True).strip()
url = f'https://iap.googleapis.com/v1/projects/{number}/iap_tunnel/zones/{zone}/instances/life-os'
def post(suffix, body):
    req = urllib.request.Request(url + suffix, data=json.dumps(body).encode(), headers={'Authorization': 'Bearer '+token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)
policy = post(':getIamPolicy', {'options': {'requestedPolicyVersion': 3}})
policy['version'] = 3
condition = {'title': 'LifeOS SSH only', 'expression': 'destination.port == 22'}
binding = next((b for b in policy.get('bindings', []) if b['role'] == 'roles/iap.tunnelResourceAccessor' and b.get('condition') == condition), None)
if binding is None:
    binding = {'role': 'roles/iap.tunnelResourceAccessor', 'members': [], 'condition': condition}
    policy.setdefault('bindings', []).append(binding)
if member not in binding['members']:
    binding['members'].append(member)
    post(':setIamPolicy', {'policy': policy})
print('LifeOS instance-scoped IAP policy configured')
