#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
# Validate unit directives/dependencies while replacing only executables that
# are intentionally absent on a build runner with its known-existing /bin/true.
python3 - "$repo/deploy/systemd" "$stage" <<'PY'
from pathlib import Path
import re,sys
for path in Path(sys.argv[1]).iterdir():
 text=path.read_text()
 text=re.sub(r'^ExecStart=\S+', 'ExecStart=/usr/bin/true',text,flags=re.MULTILINE)
 (Path(sys.argv[2])/path.name).write_text(text)
PY
systemd-analyze verify "$stage"/*
