#!/usr/bin/env bash
# Provision only dedicated LifeOS resources. No workload is deployed by this script.
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
: "${LIFE_OS_PROJECT:?Set LIFE_OS_PROJECT to your Google Cloud project ID}"
: "${LIFE_OS_ZONE:=us-central1-a}"
: "${LIFE_OS_REGION:=us-central1}"
: "${LIFE_OS_INSTANCE:=life-os}"
: "${LIFE_OS_RELEASE_BUCKET:=${LIFE_OS_PROJECT}-life-os-releases}"
: "${LIFE_OS_BACKUP_BUCKET:=${LIFE_OS_PROJECT}-life-os-backups}"
: "${LIFE_OS_REPOSITORY:?Set LIFE_OS_REPOSITORY to owner/repository}"
[[ $LIFE_OS_PROJECT =~ ^[a-z][a-z0-9-]+$ && $LIFE_OS_INSTANCE == life-os && $LIFE_OS_ZONE == us-central1-a && $LIFE_OS_REGION == us-central1 ]] || { echo 'Unexpected target; review the script before changing deployment region/name' >&2; exit 2; }
project=$LIFE_OS_PROJECT
zone=$LIFE_OS_ZONE
region=$LIFE_OS_REGION
runtime="life-os-runtime@$project.iam.gserviceaccount.com"
deployer="life-os-deploy@$project.iam.gserviceaccount.com"
cloud() { gcloud --project "$project" "$@"; }
project_number=$(cloud projects describe "$project" --format='value(projectNumber)')
[[ $project_number =~ ^[0-9]+$ ]] || exit 1
repo_metadata=$(gh api "repos/$LIFE_OS_REPOSITORY")
repository_id=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["id"])' <<<"$repo_metadata")
owner_id=$(python3 -c 'import json,sys;print(json.load(sys.stdin)["owner"]["id"])' <<<"$repo_metadata")
cloud services enable compute.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iap.googleapis.com secretmanager.googleapis.com monitoring.googleapis.com logging.googleapis.com storage.googleapis.com
for sa in life-os-runtime life-os-deploy; do
  if ! cloud iam service-accounts describe "$sa@$project.iam.gserviceaccount.com" >/dev/null 2>&1; then
    cloud iam service-accounts create "$sa" --display-name "$sa" --description 'Dedicated LifeOS identity'
  fi
done
# Existing resources must carry our ownership marker; never adopt shared resources.
if cloud compute networks describe life-os --format=json >/tmp/life-os-network.json 2>/dev/null; then
  python3 -c 'import json;assert json.load(open("/tmp/life-os-network.json"))["description"]=="Managed by life-os-mcp"'
else
  cloud compute networks create life-os --subnet-mode=custom --bgp-routing-mode=regional --description 'Managed by life-os-mcp'
fi
if ! cloud compute networks subnets describe life-os --region "$region" >/dev/null 2>&1; then
  cloud compute networks subnets create life-os --network life-os --region "$region" --range 10.53.0.0/24 --enable-private-ip-google-access --description 'Managed by life-os-mcp'
fi
cloud compute networks subnets describe life-os --region "$region" --format=json | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("description")=="Managed by life-os-mcp" and x["network"].endswith("/networks/life-os")'
if ! cloud compute firewall-rules describe life-os-iap-ssh >/dev/null 2>&1; then
  cloud compute firewall-rules create life-os-iap-ssh --network life-os --direction INGRESS --action ALLOW --rules tcp:22 --source-ranges 35.235.240.0/20 --target-service-accounts "$runtime" --description 'Managed by life-os-mcp'
fi
cloud compute firewall-rules describe life-os-iap-ssh --format=json | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("description")=="Managed by life-os-mcp" and x["sourceRanges"]==["35.235.240.0/20"] and x["allowed"]==[{"IPProtocol":"tcp","ports":["22"]}]'
if ! cloud compute disks describe life-os-data --zone "$zone" >/dev/null 2>&1; then
  cloud compute disks create life-os-data --zone "$zone" --size 20GB --type pd-balanced --labels app=life-os,role=state
fi
cloud compute disks describe life-os-data --zone "$zone" --format=json | python3 -c 'import json,sys;assert json.load(sys.stdin).get("labels",{}).get("app")=="life-os"'
if ! cloud compute instances describe life-os --zone "$zone" >/dev/null 2>&1; then
  cloud compute instances create life-os --zone "$zone" --machine-type e2-small \
    --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
    --boot-disk-size 20GB --boot-disk-type pd-balanced \
    --disk name=life-os-data,device-name=life-os-data,mode=rw,boot=no,auto-delete=no \
    --network-interface network=life-os,subnet=life-os \
    --service-account "$runtime" --scopes cloud-platform \
    --metadata enable-oslogin=TRUE,block-project-ssh-keys=TRUE \
    --labels app=life-os --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --maintenance-policy MIGRATE --provisioning-model STANDARD --deletion-protection
fi
cloud compute instances describe life-os --zone "$zone" --format=json | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("labels",{}).get("app")=="life-os";assert any(d.get("deviceName")=="life-os-data" and not d.get("autoDelete") for d in x["disks"])'
for bucket in "$LIFE_OS_RELEASE_BUCKET" "$LIFE_OS_BACKUP_BUCKET"; do
  if ! cloud storage buckets describe "gs://$bucket" >/dev/null 2>&1; then
    cloud storage buckets create "gs://$bucket" --location "$region" --uniform-bucket-level-access --public-access-prevention
    cloud storage buckets update "gs://$bucket" --update-labels app=life-os
  fi
  cloud storage buckets describe "gs://$bucket" --format=json | python3 -c 'import json,sys;x=json.load(sys.stdin);assert x.get("labels",{}).get("app")=="life-os"'
done
lifecycle=$(mktemp)
trap 'rm -f "$lifecycle" /tmp/life-os-network.json' EXIT
cat >"$lifecycle" <<'JSON'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":2,"matchesPrefix":["hourly/"]}},{"action":{"type":"Delete"},"condition":{"age":30,"matchesPrefix":["daily/"]}}]}
JSON
cloud storage buckets update "gs://$LIFE_OS_BACKUP_BUCKET" --lifecycle-file "$lifecycle"
cloud storage buckets add-iam-policy-binding "gs://$LIFE_OS_RELEASE_BUCKET" --member "serviceAccount:$runtime" --role roles/storage.objectViewer
cloud storage buckets add-iam-policy-binding "gs://$LIFE_OS_RELEASE_BUCKET" --member "serviceAccount:$deployer" --role roles/storage.objectCreator
cloud storage buckets add-iam-policy-binding "gs://$LIFE_OS_BACKUP_BUCKET" --member "serviceAccount:$runtime" --role roles/storage.objectCreator
cloud projects add-iam-policy-binding "$project" --member "serviceAccount:$runtime" --role roles/monitoring.metricWriter --condition=None >/dev/null
cloud projects add-iam-policy-binding "$project" --member "serviceAccount:$runtime" --role roles/logging.logWriter --condition=None >/dev/null
if ! cloud secrets describe life-os-typesafe-api-key >/dev/null 2>&1; then
  cloud secrets create life-os-typesafe-api-key --replication-policy automatic --labels app=life-os
fi
cloud secrets add-iam-policy-binding life-os-typesafe-api-key --member "serviceAccount:$runtime" --role roles/secretmanager.secretAccessor >/dev/null
if ! cloud iam workload-identity-pools describe life-os-github --location global >/dev/null 2>&1; then
  cloud iam workload-identity-pools create life-os-github --location global --display-name 'LifeOS GitHub deployments'
fi
condition="assertion.repository_id == '$repository_id' && assertion.repository_owner_id == '$owner_id' && assertion.ref == 'refs/heads/main' && assertion.environment == 'production' && assertion.workflow_ref in ['$LIFE_OS_REPOSITORY/.github/workflows/ci-deploy.yml@refs/heads/main', '$LIFE_OS_REPOSITORY/.github/workflows/rollback.yml@refs/heads/main']"
provider_args=(--location global --workload-identity-pool life-os-github --issuer-uri https://token.actions.githubusercontent.com --attribute-mapping 'google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref' --attribute-condition "$condition")
if cloud iam workload-identity-pools providers describe github --workload-identity-pool life-os-github --location global >/dev/null 2>&1; then
  cloud iam workload-identity-pools providers update-oidc github "${provider_args[@]}"
else
  cloud iam workload-identity-pools providers create-oidc github "${provider_args[@]}" --display-name 'LifeOS main production only'
fi
cloud iam service-accounts add-iam-policy-binding "$deployer" --role roles/iam.workloadIdentityUser --member "principalSet://iam.googleapis.com/projects/$project_number/locations/global/workloadIdentityPools/life-os-github/attribute.repository_id/$repository_id" >/dev/null
cloud iam service-accounts add-iam-policy-binding "$runtime" --role roles/iam.serviceAccountUser --member "serviceAccount:$deployer" >/dev/null
cloud compute instances add-iam-policy-binding life-os --zone "$zone" --member "serviceAccount:$deployer" --role roles/compute.osLogin >/dev/null
if cloud iam roles describe lifeOsDeployRead >/dev/null 2>&1; then
  cloud iam roles update lifeOsDeployRead --permissions compute.instances.get,compute.instances.list,compute.projects.get
else
  cloud iam roles create lifeOsDeployRead --title 'LifeOS deploy instance discovery' --permissions compute.instances.get,compute.instances.list,compute.projects.get --stage GA
fi
cloud projects add-iam-policy-binding "$project" --member "serviceAccount:$deployer" --role "projects/$project/roles/lifeOsDeployRead" --condition=None >/dev/null
LIFE_OS_PROJECT="$project" LIFE_OS_ZONE="$zone" LIFE_OS_MEMBER="serviceAccount:$deployer" python3 "$repo/scripts/gcp-iap-policy.py"
# The production environment deliberately has no manual approval gate.
gh api --method PUT "repos/$LIFE_OS_REPOSITORY/environments/production" >/dev/null
for pair in "GCP_PROJECT=$project" "GCP_ZONE=$zone" "GCP_INSTANCE=life-os" "GCP_RELEASE_BUCKET=$LIFE_OS_RELEASE_BUCKET" "GCP_DEPLOY_SERVICE_ACCOUNT=$deployer" "GCP_WORKLOAD_IDENTITY_PROVIDER=projects/$project_number/locations/global/workloadIdentityPools/life-os-github/providers/github"; do
  gh secret set "${pair%%=*}" --repo "$LIFE_OS_REPOSITORY" --env production --body "${pair#*=}"
done
gh variable set LIFE_OS_DEPLOY_ENABLED --repo "$LIFE_OS_REPOSITORY" --body true
if [[ -n ${LIFE_OS_ALERT_EMAIL:-} ]]; then
  LIFE_OS_PROJECT="$project" python3 "$repo/scripts/gcp-monitoring.py"
fi
sa_id=$(cloud iam service-accounts describe "$deployer" --format='value(uniqueId)')
printf '\nProvisioned LifeOS infrastructure. Bootstrap OS Login deploy username: sa_%s\n' "$sa_id"
printf 'IAP access: gcloud compute ssh life-os --project %s --zone %s --tunnel-through-iap\n' "$project" "$zone"
echo 'No Gmail schedule has been enabled. Complete bootstrap, release deployment, and the migration runbook.'
