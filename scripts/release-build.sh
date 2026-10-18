#!/usr/bin/env bash
set -euo pipefail
# Package only executable application files; never bundle the working directory.
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"
sha=${LIFE_OS_RELEASE_SHA:-$(git rev-parse HEAD)}
[[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected full commit SHA' >&2; exit 2; }
expected_node=$(cat deploy/node-version)
[[ $(node --version) == "v$expected_node" ]] || { echo "Build requires Node $expected_node" >&2; exit 2; }
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Release builds require Linux x86_64' >&2; exit 2; }
output=${1:-release}
mkdir -p "$output"
output=$(cd "$output" && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/bin"
cp package.json package-lock.json "$stage/"
cp -R dist "$stage/dist"
(cd "$stage" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
cat > "$stage/bin/life-os" <<'BIN'
#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
exec /opt/node/bin/node "$root/dist/index.js" "$@"
BIN
chmod 755 "$stage/bin/life-os"
SHA="$sha" NODE_VERSION="$expected_node" STAGE="$stage" node --input-type=module <<'JS'
import fs from 'node:fs';
fs.writeFileSync(`${process.env.STAGE}/release.json`, JSON.stringify({sha:process.env.SHA,node:process.env.NODE_VERSION,platform:'linux',arch:'x64',schemaVersion:1,minSchemaVersion:1,maxSchemaVersion:1,builtAt:new Date().toISOString()},null,2)+'\n');
JS
# Smoke-test the actual production-only package, with no user state or credentials.
LIFE_OS_HOME="$stage/smoke-home" node "$stage/dist/index.js" --help >/dev/null
LIFE_OS_HOME="$stage/smoke-home" node "$stage/dist/index.js" db migrate >/dev/null
LIFE_OS_HOME="$stage/smoke-home" node "$stage/dist/index.js" backup create --output "$stage/smoke-backup" >/dev/null
LIFE_OS_HOME="$stage/smoke-home" node "$stage/dist/index.js" backup verify "$stage/smoke-backup" >/dev/null
rm -rf "$stage/smoke-home" "$stage/smoke-backup"
tar -C "$stage" -czf "$output/life-os.tar.gz" .
(cd "$output" && sha256sum life-os.tar.gz > life-os.tar.gz.sha256)
echo "Packaged $sha into $output/life-os.tar.gz"
