#!/usr/bin/env bash
# Provision/deploy the private, readonly VM-to-Vercel bridge. Run after gcp-provision.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${LIFE_OS_PROJECT:?Set LIFE_OS_PROJECT to your Google Cloud project ID}"
project=$LIFE_OS_PROJECT
region=us-central1
zone=us-central1-a
cloud() { gcloud --project "$project" "$@"; }
cloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
runtime="life-os-web-gateway@$project.iam.gserviceaccount.com"
builder="life-os-web-build@$project.iam.gserviceaccount.com"
for name in life-os-web-gateway life-os-web-build; do
  if ! cloud iam service-accounts describe "$name@$project.iam.gserviceaccount.com" >/dev/null 2>&1; then
    cloud iam service-accounts create "$name" --display-name "$name" --description 'Dedicated LifeOS readonly web bridge'
  fi
done
secret=life-os-web-gateway-token
if ! cloud secrets describe "$secret" >/dev/null 2>&1; then
  cloud secrets create "$secret" --replication-policy automatic --labels app=life-os
fi
if [[ -z $(cloud secrets versions list "$secret" --filter='state=ENABLED' --limit=1 --format='value(name)') ]]; then
  python3 -c 'import secrets;print(secrets.token_urlsafe(48))' | cloud secrets versions add "$secret" --data-file=- >/dev/null
fi
cloud secrets add-iam-policy-binding "$secret" --member "serviceAccount:$runtime" --role roles/secretmanager.secretAccessor >/dev/null
cloud secrets add-iam-policy-binding "$secret" --member "serviceAccount:life-os-runtime@$project.iam.gserviceaccount.com" --role roles/secretmanager.secretAccessor >/dev/null
# Build identity is separate from the runtime identity; the latter can read only
# its one bridge secret and has no Gmail, MCP, storage, or deployment permission.
cloud projects add-iam-policy-binding "$project" --member "serviceAccount:$builder" --role roles/run.builder --condition=None >/dev/null
# Cloud Build must read the uploaded source archive. Bind this permission to
# the one source bucket rather than adding another project-wide storage role.
source_bucket="run-sources-$project-$region"
if ! cloud storage buckets describe "gs://$source_bucket" >/dev/null 2>&1; then
  cloud storage buckets create "gs://$source_bucket" --location "$region" --uniform-bucket-level-access --public-access-prevention
fi
cloud storage buckets add-iam-policy-binding "gs://$source_bucket" --member "serviceAccount:$builder" --role roles/storage.objectViewer >/dev/null
# Restrict VM ingress to this dedicated subnet, not the internet or other VPCs.
if ! cloud compute firewall-rules describe life-os-web-gateway >/dev/null 2>&1; then
  cloud compute firewall-rules create life-os-web-gateway --network life-os --direction INGRESS --action ALLOW --rules tcp:4749 --source-ranges 10.53.0.0/24 --target-service-accounts "life-os-runtime@$project.iam.gserviceaccount.com" --description 'Managed by life-os-mcp readonly web bridge'
fi
cloud compute firewall-rules describe life-os-web-gateway --format=json | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("description")=="Managed by life-os-mcp readonly web bridge" and x["sourceRanges"]==["10.53.0.0/24"] and x["allowed"]==[{"IPProtocol":"tcp","ports":["4749"]}]'
private_ip=$(cloud compute instances describe life-os --zone "$zone" --format='value(networkInterfaces[0].networkIP)')
[[ $private_ip =~ ^10\.53\.0\.[0-9]+$ ]] || { echo 'Unexpected VM private address' >&2; exit 1; }
# A Dockerfile is used, so the deployed dependency-free container is identical
# to the locally tested source and its pinned official Node image.
cloud run deploy life-os-web-gateway --source "$repo/deploy/web-gateway" \
  --region "$region" --service-account "$runtime" \
  --build-service-account "projects/$project/serviceAccounts/$builder" \
  --network life-os --subnet life-os --vpc-egress private-ranges-only \
  --allow-unauthenticated --ingress all --port 8080 \
  --cpu 1 --memory 256Mi --concurrency 8 --min 0 --max 1 --timeout 20s \
  --cpu-throttling --no-cpu-boost \
  --set-env-vars "LIFE_OS_VM_ORIGIN=http://$private_ip:4749" \
  --set-secrets "LIFE_OS_GATEWAY_TOKEN=$secret:latest" --labels app=life-os --quiet
url=$(cloud run services describe life-os-web-gateway --region "$region" --format='value(status.url)')
printf 'Readonly HTTPS gateway: %s\n' "$url"
printf 'VM private listener: http://%s:4749\n' "$private_ip"
echo 'Install the shared secret on the VM and Vercel server environment. Never expose it in browser code or NEXT_PUBLIC variables.'
