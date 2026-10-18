#!/usr/bin/env bash
# Called only from the protected main production job, after fresh OIDC auth.
set -euo pipefail
: "${GCP_PROJECT:?}" "${GCP_ZONE:?}" "${GCP_INSTANCE:?}" "${GCP_RELEASE_BUCKET:?}"
: "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
run="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
mode=${1:-deploy}
if [[ $mode == rollback ]]; then
  : "${ROLLBACK_SHA:?}" "${ROLLBACK_RUN:?}"
  sha=$ROLLBACK_SHA
  [[ $sha =~ ^[0-9a-f]{40}$ && $ROLLBACK_RUN =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]] || exit 2
  command="sudo /usr/local/sbin/lifeos-deploy rollback $sha $run $ROLLBACK_RUN"
else
  : "${GITHUB_SHA:?}"
  sha=$GITHUB_SHA
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || exit 2
  (cd release && sha256sum --check life-os.tar.gz.sha256)
  checksum=$(awk '{print $1}' release/life-os.tar.gz.sha256)
  [[ $checksum =~ ^[0-9a-f]{64}$ ]] || exit 2
  python3 scripts/release-upload.py release/life-os.tar.gz "$GCP_RELEASE_BUCKET" "$sha" "$run"
  command="sudo /usr/local/sbin/lifeos-deploy submit $sha $run $checksum"
fi
ssh_vm() {
  gcloud compute ssh "$GCP_INSTANCE" --project "$GCP_PROJECT" --zone "$GCP_ZONE" \
    --tunnel-through-iap --quiet --ssh-key-expire-after=2h --command "$1"
}
# The auth action creates a URL-based external-account file. Refreshing from it
# obtains a NEW GitHub OIDC token instead of reusing a five-minute subject token.
refresh_auth() {
  if [[ -n ${GOOGLE_GHA_CREDS_PATH:-} ]]; then
    gcloud auth login --cred-file="$GOOGLE_GHA_CREDS_PATH" --brief --quiet >/dev/null 2>&1
  fi
}
refresh_auth
ssh_vm "$command"
# Deployment is a detached systemd unit: losing this runner does not abort it.
deadline=$((SECONDS+3300))
while (( SECONDS < deadline )); do
  sleep 30
  refresh_auth
  result=$(ssh_vm "sudo /usr/local/sbin/lifeos-deploy status $sha $run")
  state=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["status"])' <<<"$result")
  echo "VM deployment: $state"
  case "$state" in
    succeeded) exit 0;;
    superseded) echo 'A newer verified deployment already reached the VM.'; exit 0;;
    failed*) echo 'Deployment failed. Read the detached VM unit journal.' >&2; exit 1;;
  esac
done
echo 'Runner stopped waiting; inspect the still-supervised VM deployment before retrying.' >&2
exit 1
