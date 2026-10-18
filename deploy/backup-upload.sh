#!/usr/bin/env bash
set -euo pipefail
: "${LIFE_OS_HOME:?}"
: "${LIFE_OS_BACKUP_BUCKET:?}"
export PATH=/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/snap/bin
mkdir -p "$LIFE_OS_HOME/backups"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=$(mktemp -d "$LIFE_OS_HOME/backups/.working-XXXXXX")
trap 'rm -rf "$backup"' EXIT
/opt/life-os/current/bin/life-os backup create --output "$backup/snapshot" >/dev/null
/opt/life-os/current/bin/life-os backup verify "$backup/snapshot"
# Include configuration and rotating Gmail credentials. Archive never leaves via logs.
tar -C "$backup" -czf "$backup/$stamp.tar.gz" snapshot
(cd "$backup" && sha256sum "$stamp.tar.gz" >"$stamp.tar.gz.sha256")
prefixes=(hourly)
if [[ $(date -u +%H) == 00 ]]; then prefixes+=(daily); fi
/usr/bin/python3 /usr/local/lib/life-os/upload-backup.py "$backup/$stamp.tar.gz" "$LIFE_OS_BACKUP_BUCKET" "${prefixes[@]}"
# Only update after all required objects have been durably uploaded.
printf '%s\n' "$(date -u +%s)" >"$LIFE_OS_HOME/backups/last-success.tmp"
mv "$LIFE_OS_HOME/backups/last-success.tmp" "$LIFE_OS_HOME/backups/last-success"
