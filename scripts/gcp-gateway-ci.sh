#!/usr/bin/env bash
# One-time, administrator-run CI permissions. Does not deploy an application.
set -euo pipefail
: "${LIFE_OS_PROJECT:?}" "${LIFE_OS_GITHUB_REPO:?}"
project=$LIFE_OS_PROJECT
region=${LIFE_OS_GATEWAY_REGION:-us-central1}
service=${LIFE_OS_GATEWAY_SERVICE:-life-os-web-gateway}
repository=${LIFE_OS_GATEWAY_REPOSITORY:-life-os-gateway}
deployer="life-os-deploy@$project.iam.gserviceaccount.com"
runtime="life-os-web-gateway@$project.iam.gserviceaccount.com"
[[ $project =~ ^[a-z][a-z0-9-]+$ && $region =~ ^[a-z]+-[a-z]+[0-9]+$ && $service =~ ^[a-z][a-z0-9-]+$ && $repository =~ ^[a-z][a-z0-9-]+$ ]] || exit 2
cloud() { gcloud --project "$project" "$@"; }
# Operate only on the already-provisioned LifeOS service and its dedicated identity.
cloud run services describe "$service" --region "$region" --format=json | python3 -c 'import json,sys;s=json.load(sys.stdin);assert s["spec"]["template"]["spec"]["serviceAccountName"]==sys.argv[1];assert s["metadata"].get("labels",{}).get("app")=="life-os"' "$runtime"
if ! cloud artifacts repositories describe "$repository" --location "$region" >/dev/null 2>&1; then
  cloud artifacts repositories create "$repository" --location "$region" --repository-format=docker --immutable-tags \
    --description 'Dedicated verified LifeOS gateway images' --labels app=life-os --quiet
fi
cloud artifacts repositories describe "$repository" --location "$region" --format=json | python3 -c 'import json,sys;r=json.load(sys.stdin);assert r["format"]=="DOCKER" and r.get("labels",{}).get("app")=="life-os" and r.get("dockerConfig",{}).get("immutableTags")==True'
cloud artifacts repositories add-iam-policy-binding "$repository" --location "$region" --member "serviceAccount:$deployer" --role roles/artifactregistry.writer --quiet >/dev/null
cloud run services add-iam-policy-binding "$service" --region "$region" --member "serviceAccount:$deployer" --role roles/run.developer --quiet >/dev/null
cloud iam service-accounts add-iam-policy-binding "$runtime" --member "serviceAccount:$deployer" --role roles/iam.serviceAccountUser --quiet >/dev/null
for pair in "GCP_GATEWAY_REGION=$region" "GCP_GATEWAY_SERVICE=$service" "GCP_GATEWAY_REPOSITORY=$repository"; do
  name=${pair%%=*};value=${pair#*=}
  printf '%s' "$value" | gh secret set "$name" --repo "$LIFE_OS_GITHUB_REPO" --env production
 done
# Operator enables this only after installing the reviewed root helper and pinning
# LIFE_OS_GATEWAY_ORIGIN in /etc/life-os/deploy.env. No secret-read role is needed by CI.
echo 'Gateway CI roles and private configuration ready. Install the reviewed helpers and pinned service origin, then enable LIFE_OS_GATEWAY_DEPLOY_ENABLED=true.'
