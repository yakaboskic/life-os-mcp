#!/usr/bin/env bash
# Existing-service rollout only. Initial IAM/network/secret setup is separate.
set -euo pipefail
: "${GCP_PROJECT:?}" "${GCP_ZONE:?}" "${GCP_INSTANCE:?}"
: "${GCP_GATEWAY_REGION:?}" "${GCP_GATEWAY_SERVICE:?}" "${GCP_GATEWAY_REPOSITORY:?}"
: "${GITHUB_SHA:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
sha=$GITHUB_SHA
run="$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
[[ $sha =~ ^[a-f0-9]{40}$ && $run =~ ^[1-9][0-9]{0,17}-[1-9][0-9]{0,5}$ ]] || exit 2
[[ $GCP_PROJECT =~ ^[a-z][a-z0-9-]+$ && $GCP_GATEWAY_REGION =~ ^[a-z]+-[a-z]+[0-9]+$ && $GCP_GATEWAY_SERVICE =~ ^[a-z][a-z0-9-]{0,35}$ && $GCP_GATEWAY_REPOSITORY =~ ^[a-z][a-z0-9-]+$ ]] || exit 2
cloud() { gcloud --project "$GCP_PROJECT" "$@"; }
refresh_auth() {
  if [[ -n ${GOOGLE_GHA_CREDS_PATH:-} ]]; then gcloud auth login --cred-file="$GOOGLE_GHA_CREDS_PATH" --brief --quiet >/dev/null 2>&1; fi
}
smoke() {
  refresh_auth
  cloud compute ssh "$GCP_INSTANCE" --zone "$GCP_ZONE" --tunnel-through-iap --quiet --ssh-key-expire-after=2h \
    --command "sudo /usr/local/sbin/lifeos-deploy web-smoke $sha $run $1"
}
refresh_auth
work=$(mktemp -d)
# Private temporary Docker auth config contains only the gcloud credential-helper reference.
export DOCKER_CONFIG="$work/docker"
mkdir -m 700 "$DOCKER_CONFIG"
previous=""
traffic_changed=0
success=0
cleanup() {
  code=$?
  trap - EXIT
  if (( traffic_changed == 1 && success == 0 )) && [[ -n $previous ]]; then
    refresh_auth
    cloud run services update-traffic "$GCP_GATEWAY_SERVICE" --region "$GCP_GATEWAY_REGION" --to-revisions "$previous=100" --quiet || echo 'Gateway rollback failed; inspect Cloud Run traffic.' >&2
  fi
  rm -rf "$work"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
(cd release && sha256sum --check gateway-image.tar.gz.sha256)
docker load --input release/gateway-image.tar.gz
image="life-os-web-gateway:$sha"
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$sha" ]] || { echo 'Gateway artifact release mismatch' >&2; exit 1; }
[[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]] || exit 1
registry="$GCP_GATEWAY_REGION-docker.pkg.dev"
remote="$registry/$GCP_PROJECT/$GCP_GATEWAY_REPOSITORY/gateway"
cloud auth configure-docker "$registry" --quiet >/dev/null
docker tag "$image" "$remote:$sha-$run"
docker push "$remote:$sha-$run"
digest=$(cloud artifacts docker images describe "$remote:$sha-$run" --format='value(image_summary.digest)')
[[ $digest =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'Missing immutable gateway digest' >&2; exit 1; }
cloud run services describe "$GCP_GATEWAY_SERVICE" --region "$GCP_GATEWAY_REGION" --format=json >"$work/service.json"
# Refuse split traffic: rollback must preserve a single known production revision.
previous=$(python3 - "$work/service.json" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]));live=[x for x in s['status']['traffic'] if x.get('percent',0)]
assert len(live)==1 and live[0]['percent']==100
print(live[0]['revisionName'])
PY
)
# Preserve identity, secrets, VPC, ingress, scale and concurrency. Never grant public IAM in CI.
revision="$GCP_GATEWAY_SERVICE-r$run"
refresh_auth
cloud run services update "$GCP_GATEWAY_SERVICE" --region "$GCP_GATEWAY_REGION" --image "$remote@$digest" \
  --update-env-vars "LIFE_OS_RELEASE_SHA=$sha" --revision-suffix "r$run" --no-traffic --tag "r-$run" --quiet
cloud run revisions describe "$revision" --region "$GCP_GATEWAY_REGION" --format=json >"$work/revision.json"
python3 - "$work/revision.json" "$digest" "$sha" <<'PY'
import json,sys
r=json.load(open(sys.argv[1]));assert r['status']['imageDigest'].endswith('@'+sys.argv[2]) or r['status']['imageDigest']==sys.argv[2]
assert any(x['type']=='Ready' and x['status']=='True' for x in r['status']['conditions'])
assert any(x['name']=='LIFE_OS_RELEASE_SHA' and x.get('value')==sys.argv[3] for x in r['spec']['containers'][0]['env'])
PY
smoke candidate
traffic_changed=1
cloud run services update-traffic "$GCP_GATEWAY_SERVICE" --region "$GCP_GATEWAY_REGION" --to-revisions "$revision=100" --quiet
smoke production
success=1
# Remove only this rollout's temporary tag after the stable endpoint passes.
cloud run services update-traffic "$GCP_GATEWAY_SERVICE" --region "$GCP_GATEWAY_REGION" --remove-tags "r-$run" --quiet
printf 'Gateway release %s deployed as %s\n' "$sha" "$revision"
