#!/usr/bin/env bash
# Run as root on the dedicated Ubuntu 24.04 VM, from an inspected deploy bundle.
set -euo pipefail
[[ $EUID == 0 ]] || { echo 'bootstrap requires root' >&2; exit 2; }
base=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
: "${LIFE_OS_PROJECT:?Set LIFE_OS_PROJECT to your Google Cloud project ID}"
: "${LIFE_OS_RELEASE_BUCKET:=${LIFE_OS_PROJECT}-life-os-releases}"
: "${LIFE_OS_BACKUP_BUCKET:=${LIFE_OS_PROJECT}-life-os-backups}"
: "${LIFE_OS_DEPLOY_OS_USER:?Set the OS Login username for the GitHub deployment service account}"
[[ $LIFE_OS_DEPLOY_OS_USER =~ ^[a-zA-Z0-9_-]+$ ]] || exit 2
# shellcheck source=/dev/null
source /etc/os-release
[[ $ID == ubuntu && $VERSION_ID == 24.04 && $(uname -m) == x86_64 ]] || { echo 'Ubuntu 24.04 x86_64 required' >&2; exit 2; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends ca-certificates curl python3 util-linux jq gnupg
# Use the apt CLI: snap confinement is incompatible with hardened systemd jobs.
if [[ ! -x /usr/bin/gcloud ]]; then
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor --yes -o /usr/share/keyrings/google-cloud.gpg
  printf 'deb [signed-by=/usr/share/keyrings/google-cloud.gpg] https://packages.cloud.google.com/apt cloud-sdk main\n' >/etc/apt/sources.list.d/google-cloud-sdk.list
  apt-get update -qq
  apt-get install -y --no-install-recommends google-cloud-cli
fi
node_version=$(cat "$base/node-version")
[[ $node_version =~ ^24\.[0-9]+\.[0-9]+$ ]] || exit 2
if [[ ! -x /opt/node/bin/node || $(/opt/node/bin/node --version) != "v$node_version" ]]; then
  temp=$(mktemp -d)
  trap 'rm -rf "$temp"' EXIT
  curl -fsSL "https://nodejs.org/dist/v${node_version}/node-v${node_version}-linux-x64.tar.xz" -o "$temp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v${node_version}/SHASUMS256.txt" -o "$temp/checksums"
  checksum=$(awk -v file="node-v${node_version}-linux-x64.tar.xz" '$2==file {print $1}' "$temp/checksums")
  [[ $checksum =~ ^[a-f0-9]{64}$ ]] || exit 1
  printf '%s  %s\n' "$checksum" "$temp/node.tar.xz" | sha256sum --check --status
  mkdir -p /opt/node-versions
  tar -xJf "$temp/node.tar.xz" -C /opt/node-versions
  ln -sfn "/opt/node-versions/node-v${node_version}-linux-x64" /opt/node
fi
# Dedicated disk: format only a blank LifeOS disk, never any already formatted disk.
device=/dev/disk/by-id/google-life-os-data
[[ -b $device ]] || { echo "Missing persistent disk $device" >&2; exit 1; }
fstype=$(blkid -o value -s TYPE "$device" || true)
if [[ -z $fstype ]]; then
  [[ -z $(lsblk -n -o FSTYPE "$device" | tr -d '[:space:]') ]] || exit 1
  [[ $(lsblk -n -o NAME "$device" | wc -l) -eq 1 ]] || { echo 'Refusing disk with existing partitions' >&2; exit 1; }
  mkfs.ext4 -L life-os-data "$device"
elif [[ $fstype != ext4 ]]; then
  echo "Refusing non-ext4 state disk ($fstype)" >&2; exit 1
fi
uuid=$(blkid -o value -s UUID "$device")
mkdir -p /var/lib/life-os
if ! findmnt /var/lib/life-os >/dev/null; then
  [[ -z $(ls -A /var/lib/life-os) ]] || { echo 'Refusing to hide existing state beneath a mount' >&2; exit 1; }
  if ! grep -q "^UUID=$uuid " /etc/fstab; then
    printf 'UUID=%s /var/lib/life-os ext4 defaults 0 2\n' "$uuid" >>/etc/fstab
  fi
  mount /var/lib/life-os
fi
[[ $(findmnt -n -o UUID /var/lib/life-os) == "$uuid" ]] || { echo 'Unexpected mounted state disk' >&2; exit 1; }
id lifeos >/dev/null 2>&1 || useradd --system --home-dir /var/lib/life-os --shell /usr/sbin/nologin lifeos
getent group lifeos-agent-client >/dev/null || groupadd --system lifeos-agent-client
chown lifeos:lifeos /var/lib/life-os
chmod 700 /var/lib/life-os
install -o lifeos -g lifeos -m 600 /dev/null /var/lib/life-os/.vm-authoritative
install -d -m 755 /opt/life-os/releases /usr/local/lib/life-os /var/lib/life-os-deploy
install -d -o root -g lifeos -m 750 /etc/life-os
for kind in interactive job; do
  if [[ ! -s /etc/life-os/$kind.token ]]; then
    python3 -c 'import secrets;print(secrets.token_urlsafe(48))' >"/etc/life-os/$kind.token"
  fi
  chown root:lifeos "/etc/life-os/$kind.token"
  chmod 640 "/etc/life-os/$kind.token"
done
# Initial bootstrap may precede secret setup. Leave classification unavailable,
# without creating a dummy key or enabling a mutating schedule.
if [[ ! -s /etc/life-os/typesafe.key ]]; then
  if gcloud secrets versions access latest --project "$LIFE_OS_PROJECT" --secret life-os-typesafe-api-key >/etc/life-os/typesafe.key.new 2>/dev/null; then
    mv /etc/life-os/typesafe.key.new /etc/life-os/typesafe.key
    chown root:lifeos /etc/life-os/typesafe.key
    chmod 640 /etc/life-os/typesafe.key
  else
    rm -f /etc/life-os/typesafe.key.new
    echo 'Jev secret unavailable: complete secret setup before shadow triage.' >&2
  fi
fi
if [[ ! -f /etc/life-os/runtime.env ]]; then
  cat >/etc/life-os/runtime.env <<ENV
LIFE_OS_HOME=/var/lib/life-os
HOME=/var/lib/life-os
TZ=America/New_York
NODE_ENV=production
LIFE_OS_BACKEND_URL=http://127.0.0.1:4748
LIFE_OS_INTERACTIVE_TOKEN_FILE=/etc/life-os/interactive.token
LIFE_OS_JOB_TOKEN_FILE=/etc/life-os/job.token
TYPESAFE_API_KEY_FILE=/etc/life-os/typesafe.key
TYPESAFE_MODEL=jev-1.13.0
LIFE_OS_TRIAGE_MODE=dry-run
LIFE_OS_TRIAGE_APPLY_ENABLED=false
LIFE_OS_PROJECT=$LIFE_OS_PROJECT
LIFE_OS_BACKUP_BUCKET=$LIFE_OS_BACKUP_BUCKET
ENV
fi
gateway_origin=${LIFE_OS_GATEWAY_ORIGIN:-}
if [[ -z $gateway_origin && -f /etc/life-os/deploy.env ]]; then
  gateway_origin=$(sed -n 's/^LIFE_OS_GATEWAY_ORIGIN=//p' /etc/life-os/deploy.env)
fi
[[ -z $gateway_origin || $gateway_origin =~ ^https://[a-z0-9-]+\.a\.run\.app$ ]] || { echo 'Invalid pinned Cloud Run gateway origin' >&2; exit 2; }
cat >/etc/life-os/deploy.env <<ENV
LIFE_OS_RELEASE_BUCKET=$LIFE_OS_RELEASE_BUCKET
LIFE_OS_NODE_VERSION=$node_version
LIFE_OS_GATEWAY_ORIGIN=$gateway_origin
ENV
chmod 640 /etc/life-os/runtime.env
chown root:lifeos /etc/life-os/runtime.env
chmod 600 /etc/life-os/deploy.env
install -o root -g root -m 755 "$base/lifeos-deploy" /usr/local/sbin/lifeos-deploy
install -o root -g root -m 755 "$base/web-smoke.py" /usr/local/lib/life-os/web-smoke.py
install -o root -g root -m 755 "$base/backup-upload.sh" /usr/local/lib/life-os/backup-upload.sh
install -o root -g root -m 755 "$base/upload-backup.py" /usr/local/lib/life-os/upload-backup.py
install -o root -g root -m 755 "$base/monitor.py" /usr/local/lib/life-os/monitor.py
install -o root -g root -m 644 "$base"/systemd/* /etc/systemd/system/
printf '%s ALL=(root) NOPASSWD: /usr/local/sbin/lifeos-deploy *\n' "$LIFE_OS_DEPLOY_OS_USER" >/etc/sudoers.d/life-os-deploy
chmod 440 /etc/sudoers.d/life-os-deploy
visudo -cf /etc/sudoers.d/life-os-deploy
systemctl daemon-reload
# The optional isolated subscription runner is installed explicitly with
# deploy/install-claude-runner.sh; bootstrap does not initiate Claude login.
systemctl enable life-os.service life-os-backup.timer life-os-monitor.timer
systemctl start life-os-backup.timer life-os-monitor.timer
# The Gmail timer is deliberately NOT enabled before account migration and shadow review.
echo 'Bootstrap installed. Deploy the tested release, migrate credentials, run shadow triage, then enable the Gmail timer.'
