#!/usr/bin/env bash
# Laptop-side MCP launcher. All application state and OAuth work stay on the VM.
set -euo pipefail
: "${LIFE_OS_PROJECT:?Set LIFE_OS_PROJECT to your Google Cloud project ID}"
exec "${LIFE_OS_GCLOUD:-gcloud}" compute ssh "${LIFE_OS_VM:-life-os}" \
  --project="${LIFE_OS_PROJECT}" --zone="${LIFE_OS_ZONE:-us-central1-a}" \
  --tunnel-through-iap --quiet \
  --command='sudo -n -u lifeos env LIFE_OS_INTERACTIVE_TOKEN_FILE=/etc/life-os/interactive.token /opt/life-os/current/bin/life-os serve --connect http://127.0.0.1:4748' \
  -- -T
