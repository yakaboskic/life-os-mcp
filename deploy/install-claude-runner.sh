#!/usr/bin/env bash
# Administrator-only bootstrap. Downloads a pinned official binary; no remote shell script executes.
set -euo pipefail
[[ $EUID == 0 && $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Root on Linux x86_64 required' >&2; exit 2; }
base=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
version=$(cat "$base/claude-version")
checksum=$(cat "$base/claude-linux-x64.sha256")
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && $checksum =~ ^[a-f0-9]{64}$ ]] || exit 2
getent group lifeos-agent >/dev/null || groupadd --system lifeos-agent
getent group lifeos-agent-client >/dev/null || groupadd --system lifeos-agent-client
id lifeos-agent >/dev/null 2>&1 || useradd --system --gid lifeos-agent --home-dir /var/lib/life-os-agent --shell /usr/sbin/nologin lifeos-agent
[[ $(getent passwd lifeos-agent | cut -d: -f6) == /var/lib/life-os-agent ]] || { echo 'Refusing unexpected runner account home' >&2; exit 2; }
# Refuse a reused account with access to authoritative state.
if id -nG lifeos-agent | tr ' ' '\n' | grep -qx lifeos; then echo 'Runner must not belong to the LifeOS data group' >&2; exit 2; fi
usermod -a -G lifeos-agent-client lifeos-agent
usermod -a -G lifeos-agent-client lifeos
install -d -o lifeos-agent -g lifeos-agent -m 700 /var/lib/life-os-agent /var/lib/life-os-agent/.claude /var/lib/life-os-agent/work
install -d -o root -g root -m 755 /opt/claude-code "/opt/claude-code/$version"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
binary="/opt/claude-code/$version/claude"
if [[ ! -f $binary ]] || ! printf '%s  %s\n' "$checksum" "$binary" | sha256sum --check --status; then
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    "https://downloads.claude.ai/claude-code-releases/$version/linux-x64/claude" -o "$work/claude"
  printf '%s  %s\n' "$checksum" "$work/claude" | sha256sum --check --status
  install -o root -g root -m 755 "$work/claude" "$binary"
fi
# Capability check as the isolated unprivileged account, never as root.
runuser -u lifeos-agent -- env HOME=/var/lib/life-os-agent CLAUDE_CONFIG_DIR=/var/lib/life-os-agent/.claude DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 "$binary" --help >"$work/help"
for flag in --safe-mode --json-schema --strict-mcp-config --no-session-persistence --disallowedTools; do
  grep -q -- "$flag" "$work/help" || { echo "Pinned Claude binary lacks required flag $flag" >&2; exit 1; }
done
ln -sfn "/opt/claude-code/$version" /opt/claude-code/current.next
mv -Tf /opt/claude-code/current.next /opt/claude-code/current
install -o root -g root -m 644 "$base/systemd/life-os-agent.service" /etc/systemd/system/life-os-agent.service
systemctl daemon-reload
# No login, token reading, runner startup or authoritative-daemon restart occurs here.
printf 'Pinned Claude Code %s installed. Owner must complete native auth login as lifeos-agent.\n' "$version"
