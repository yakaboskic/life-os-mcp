# LifeOS production operations

LifeOS production state lives on the persistent disk mounted at `/var/lib/life-os` on `life-os` in your GCP project in `us-central1-a`. The laptop is a development machine and remote client. There is no bidirectional file synchronization. Never copy a running SQLite database and WAL independently or point development tests at the production home directory.

## Components and trust boundaries

| Component | Location | Access |
|---|---|---|
| Authoritative backend, SQLite, OAuth tokens | `e2-small`, Ubuntu 24.04 | Backend `127.0.0.1:4748`, distinct interactive/job bearer credentials |
| Starfleet dashboard | Same backend release | `127.0.0.1:4747`, SSH tunnel |
| Scheduled Gmail worker | Daemon, triggered by systemd | Daily 05:53 `America/New_York`, 45-minute job deadline |
| Application releases | `/opt/life-os/releases/<sha>-<run>-<attempt>` | Root owned; application executes as `lifeos` |
| Application state | Separate `life-os-data` disk | No auto-delete; mount by UUID; service requires mount |
| Release artifacts | Private GCS release bucket | GitHub upload only; VM read only |
| Backups | Private GCS backup bucket | VM create only; hourly retained 2 days, daily 30 days |
| Operational alerts | Cloud Monitoring `global` metrics | Independent of Gmail authentication and VM lifecycle |
| Optional private web bridge | Cloud Run, Direct VPC | HTTPS bearer gateway, four read routes and bounded action endpoint to VM private port 4749 |
| Private PWA | Vercel | Google sign-in; exact allowlist the single `LIFE_OS_ALLOWED_EMAIL` address; gateway secret stays server-side |

The VM has an external IPv4 address for outbound Gmail/Jev traffic. It has no public application listener. Its dedicated VPC accepts SSH only from IAP's `35.235.240.0/20` range. The optional web bridge adds port 4749 only from the dedicated `10.53.0.0/24` subnet, never the internet. IAP and OS Login protect SSH.

Node is pinned in `deploy/node-version` and used on the GitHub Linux runner and VM. SQLite uses Node's built-in implementation, so releases do not depend on rebuilding a native addon on the VM. Changes to bootstrap scripts or privileged helpers require an explicit infrastructure update; normal application deployments never execute release-provided code as root.

## Initial infrastructure and bootstrap

Authenticate `gcloud` and `gh` as an account authorized to administer this project/repository. Copy `.env.example` to `.env`, set mode `0600`, and fill in your own project, repository, alert address, and web settings. The file is ignored by Git and Vercel uploads. Run from the repository:

```sh
set -a
source .env
set +a
scripts/gcp-provision.sh
```

The script creates dedicated LifeOS resources, a WIF provider restricted by numeric repository/owner IDs, `main`, the production environment and named deployment workflows. It stores deployment identifiers as secrets in the production GitHub environment, enables the repository deployment flag, and configures Cloud Monitoring. No Gmail timer is enabled. It verifies ownership before reusing existing dedicated resources. The script outputs the deployment service account's OS Login username (`sa_<unique-id>`).

Copy the reviewed `deploy/` directory to the VM through IAP and run:

```sh
gcloud compute scp --recurse deploy life-os:life-os-bootstrap \
  --project "$LIFE_OS_PROJECT" --zone us-central1-a --tunnel-through-iap
gcloud compute ssh life-os --project "$LIFE_OS_PROJECT" --zone us-central1-a \
  --tunnel-through-iap
sudo env LIFE_OS_PROJECT=YOUR_PROJECT_ID LIFE_OS_DEPLOY_OS_USER=sa_REPLACE_WITH_OUTPUT \
  bash life-os-bootstrap/bootstrap-vm.sh
```

Bootstrap installs the pinned official Node distribution after checksum verification, mounts the dedicated disk, creates `lifeos`, installs fixed root-owned service/deployment helpers, and generates distinct machine credentials. It preserves existing tokens and runtime configuration. It attempts to fetch the Jev secret; a missing secret does not prevent infrastructure setup. Production Gmail apply stays disabled.

Add a Jev API key to Secret Manager using a secure local file or an interactive secret entry mechanism. The owner's local, gitignored `.env` may be used for initial secret entry with mode `0600`; never include it in a release or commit. Do not put a key in a shell command, GitHub variable, or chat. The secret ID is `life-os-typesafe-api-key`; the VM runtime service account alone receives accessor permission. On the VM, write the retrieved secret directly to `/etc/life-os/typesafe.key`, owner `root:lifeos`, mode `0640`, and restart the backend. Bootstrap can be rerun to retrieve a newly available key without rotating existing machine credentials.

## Application delivery

Every pull request runs Linux Node24 installation, type checking, tests, production build, gateway tests, operational syntax/unit checks, and release packaging. Once provisioning sets `LIFE_OS_DEPLOY_ENABLED=true`, every successful push to `main` deploys the artifact produced by that same workflow. Forks and clones start with deployment disabled. No normal manual approval gate is required.

Release packaging uses an explicit allowlist: `dist`, production dependencies, package manifests, executable wrapper, and release metadata. Source credentials, live data, personal graph exports, GitHub WIF files, and working-directory miscellany are excluded. The package is smoke-tested with an empty temporary home after development dependencies have been removed.

The deploy job uses short-lived GitHub OIDC credentials. It uploads a run-specific immutable object using an object-create precondition, then requests a detached systemd deployment on the VM. The runner polls status and refreshes WIF credentials; disconnecting it does not stop VM activation.

The root-owned helper:

1. Locks deployment and rejects older run IDs after a newer verified request has begun.
2. Downloads the exact SHA/run artifact, checks SHA-256, constrains archive extraction, and validates runtime/schema metadata.
3. Drains active jobs and interactive requests, retaining a 46-minute drain window for the 45-minute worker deadline.
4. Creates and verifies a consistent predeployment backup.
5. Places the deployment pause marker, stops the daemon, and runs migrations as `lifeos`.
6. Atomically switches the current release, restarts, verifies readiness and exact commit SHA, checks the dashboard and read-only MCP protocol, then resumes jobs.
7. On failure, resumes the prior binary only when schema compatible. It never restores old live data automatically after Gmail effects.

The deployed release is recorded in `/etc/life-os/release.env`; durable status and successful release records are in `/var/lib/life-os-deploy`. Application releases are retained for manual rollback; periodically remove old releases only after confirming they are not current or needed for rollback. Do not delete the persistent state disk to clean releases.

Useful commands:

```sh
sudo systemctl status life-os
sudo journalctl -u life-os --since today
sudo journalctl -u life-os-deploy-RUN-ATTEMPT
sudo /usr/local/sbin/lifeos-deploy status FULL_SHA RUN-ATTEMPT
```

The GitHub **Roll back LifeOS application** workflow takes a full commit SHA and a previously successful deployment's run/attempt. The VM verifies that release exists and supports the current schema. Rollback changes application binaries only, while preserving OAuth tokens, live database state, Gmail history and the schedule.

## Gmail migration and cutover

1. Disable overlapping laptop Gmail/combined triage jobs before production mutation. Do not silently remove unrelated Drive or team-tracker workflows; their migration is separate.
2. Stop local LifeOS writers. Make a local backup and retain source files unchanged. Copy the Google OAuth client JSON, account token files, configuration and tracker source files into the VM home over IAP. Preserve permissions: directory `0700`, private files `0600`, owner `lifeos`.
3. Run `life-os db migrate` as `lifeos` with `LIFE_OS_HOME=/var/lib/life-os`. Compare the import report and manifest with source products/projects/tasks, entry count/time totals and active timer. Malformed or ambiguous source data must be resolved before cutover.
4. Verify each direct LifeOS Gmail account using its original OAuth client. Organization-managed accounts are excluded until direct OAuth works. Service account ADC does not replace Gmail user OAuth.
5. If OAuth needs renewal, use the no-browser flow with a fixed loopback callback port forwarded through IAP. Keep the callback on loopback. Confirm the OAuth consent app's publishing state; testing-mode refresh tokens for external apps may expire after seven days.
6. Run `life-os jobs run gmail-triage --mode dry-run --wait`. Review the report, low-confidence items, category distribution and account failures. Jev must use the pinned rubric/model and valid response schema. Shadow classification does not apply Gmail changes.
7. Set `LIFE_OS_TRIAGE_APPLY_ENABLED=true` and `LIFE_OS_TRIAGE_MODE=apply` in `/etc/life-os/runtime.env`, restart `life-os`, and run one attended apply pass. Verify captured-message label changes, preserved unread state/stars, durable task links and held messages.
8. Enable the schedule only after these checks:

```sh
sudo systemctl enable --now life-os-triage.timer
systemctl list-timers life-os-triage.timer
systemd-analyze calendar '*-*-* 05:53:00 America/New_York'
```

The persistent timer performs one catch-up trigger after downtime. The daemon deduplicates scheduled work by Eastern date and mode. Held/error work and uncertain mutations remain durable for reconciliation. An uncertain write is not safe to replay blindly.

Runtime commands that call the backend need its machine token file. Prefer `sudo systemd-run --wait --pipe --uid=lifeos --property=EnvironmentFile=/etc/life-os/runtime.env /opt/life-os/current/bin/life-os ...` for administrator-triggered jobs; it loads the same protected configuration as the service. The scheduler has only job capability. Interactive tools and review resolution require the separate interactive token.

## Laptop and agent access

For the dashboard:

```sh
gcloud compute ssh life-os --project "$LIFE_OS_PROJECT" --zone us-central1-a \
  --tunnel-through-iap -- -N -L 4747:127.0.0.1:4747
```

Open `http://localhost:4747`. For MCP, run the thin `life-os serve --connect http://127.0.0.1:4748` bridge on the VM through an SSH command without a TTY. Load the interactive token from its protected file and keep logs on stderr. The bridge reaches the shared daemon; it must not start an independent production writer. An owner can alternatively tunnel 4748 and keep a protected copy of the interactive machine token on the laptop. Remote failure must not silently fall back to local production data.

`scripts/mcp-remote.sh` provides that SSH bridge. Configure the agent's stdio MCP command as `/bin/bash` with the absolute path to this script as its only argument. It requires an authenticated `gcloud` account with IAP/SSH access; set `LIFE_OS_GCLOUD` to the CLI's absolute path when the desktop application's PATH does not include it. Set `LIFE_OS_PROJECT` to the target project; `LIFE_OS_ZONE` and `LIFE_OS_VM` optionally override the deployment defaults. No application token or Google refresh token is copied to the laptop. Restart the MCP connection after changing the agent configuration.

Each remote connection loads only the MCP transport; Google clients, local toolsets, and SQLite are loaded only by commands that need them. Jobs and automation CLI commands also use the lightweight HTTP client. Bundled CLI tests guard against importing these heavy modules or accessing local LifeOS data in remote mode.

The bridge cancels backend work and exits on input EOF, broken output, or termination signals, including during its initial readiness check. Valid idle connections stay open. Per connection, requests are limited to 1 MiB per frame and 32 pending messages / 4 MiB of pending input; blocked output is limited to an 8 MiB backlog. Exceeding a limit closes the connection with an error on stderr. Requests are never automatically replayed after an uncertain failure; inspect their state before repeating a write.

An existing connection keeps its loaded code after a deployment. For a memory-related bridge update, reconnect agents after the new release is ready. An attended refresh should capture exact old bridge PIDs and process start times, wait for `/readyz` to report no active requests or jobs, terminate only those bridge processes, and verify readiness between batches. Do not terminate SSH daemons or the shared application. On a small VM, compare aggregate bridge RSS/PSS and `/proc/meminfo`'s `MemAvailable`, and check for new kernel OOM kills; avoid starting a large benchmark alongside live agents. The Claude runner follows the daemon restart and retains its separate login home.

## Private web bridge and iPhone PWA

After the VM private listener is implemented and configured:

```sh
scripts/gcp-web-gateway.sh
```

This creates a dedicated Cloud Run runtime identity, separate build identity, and `life-os-web-gateway-token` secret, then deploys the dependency-free gateway with a pinned official Node image. The runtime identity can read that single secret. The gateway validates the secret, rejects browser origins and unrecognized routes, limits request/response size and time, follows no redirects, and forwards only `GET /api/data`, `/api/triage`, `/api/jobs`, `/api/automation` plus `POST /api/actions` to the VM private IP on 4749. Actions are bounded to 64 KiB of JSON; Vercel requires the authenticated session, exact Origin and same-origin Fetch Metadata and derives the actor itself. The VM invokes the authoritative daemon callback, never an unauthenticated local write route. It scales to zero, with a maximum of one instance.

Install the same gateway secret into the VM private listener and the **server-side** Vercel environment. Set the Vercel backend URL to the script's HTTPS service URL. Never expose this secret in public environment variables or browser JavaScript. The Vercel app must authenticate Google sign-in and enforce the exact allowlisted account before making any gateway request. Its responses must be `no-store`; the PWA service worker must never cache private API data or login responses. Home-screen installation does not replace authentication.

A Cloud Run URL without the bearer secret must return an authorization error. A bearer-authenticated request to `/mcp`, `/v1/jobs`, any nonallowlisted write route, or an action without a valid actor/JSON body must fail. Test Google sign-in as the allowlisted account and rejection of another account before considering web rollout complete.

## Gateway deployment from GitHub

Run `scripts/gcp-gateway-ci.sh` once as an infrastructure administrator with `LIFE_OS_PROJECT` and `LIFE_OS_GITHUB_REPO`. It creates a dedicated immutable-tag Artifact Registry repository. The existing OIDC deployer receives Writer on that repository, Run Developer on the existing gateway service, and Service Account User on its runtime identity. It gains no secret-read permission or project-wide build/admin role. Deployment identifiers are saved only in GitHub's production environment secrets.

Install the reviewed `deploy/lifeos-deploy` and `deploy/web-smoke.py` as root-owned `/usr/local/sbin/lifeos-deploy` and `/usr/local/lib/life-os/web-smoke.py`. Add the gateway's exact legacy `https://SERVICE-HASH-REGION.a.run.app` origin as `LIFE_OS_GATEWAY_ORIGIN` in root-only `/etc/life-os/deploy.env`; use the service URL returned by Cloud Run, not an arbitrary caller-provided URL. Then set the repository variable `LIFE_OS_GATEWAY_DEPLOY_ENABLED=true`.

CI builds the gateway image in the verified job, stores its checksum and exact image alongside the application artifact, and deploys the VM first. A superseded VM run cannot deploy an older gateway. The gateway stage loads that exact Linux image, pushes it under an immutable run-specific tag, deploys its digest with zero production traffic, and checks a temporary tagged revision through the VM's root-owned GET-only smoke helper. The helper verifies exact VM/gateway release identities and all four authenticated read routes without printing personal responses or credentials. Production traffic changes only after these checks. A failed post-switch check restores the previous revision; it never rolls back live VM data. Existing secrets, identity, VPC and scaling configuration are preserved.

Vercel's Git deployment remains independent. Dashboard controls must use server-reported capabilities and display temporary unavailable/conflict responses safely during mixed-version rollout. The VM remains compatible with the prior read-only bridge; gateway failure leaves the new VM running and restores the prior gateway. The manual VM rollback workflow changes VM binaries only; use an attended Cloud Run traffic rollback if the bridge also needs reverting.

## Isolated Claude Code subscription runner

The optional runner uses the owner's native Claude Code login, separate from Gmail OAuth and Jev. It is installed explicitly by `sudo bash deploy/install-claude-runner.sh`. The script downloads the pinned official Linux binary, verifies the repository-pinned SHA-256, checks required flags as an unprivileged user, and creates `lifeos-agent` with private home `/var/lib/life-os-agent`. It does not start a login or restart LifeOS. Binary versions/checksums are maintained in `deploy/claude-version` and `deploy/claude-linux-x64.sha256`; upgrades are reviewed infrastructure changes, not runtime self-updates.

The owner signs in directly over their own SSH terminal:

```sh
sudo -u lifeos-agent -H env CLAUDE_CONFIG_DIR=/var/lib/life-os-agent/.claude \
  DISABLE_AUTOUPDATER=1 DISABLE_UPDATES=1 /opt/claude-code/current/claude auth login
```

Do not copy a laptop credential file, place tokens in chat, or set an API key to substitute for this login. The runner service intentionally does not load `/etc/life-os/runtime.env`. Only the Unix socket group `lifeos-agent-client` is shared with the daemon. The runner cannot access `/var/lib/life-os` or `/etc/life-os`, and its service blocks the GCP metadata addresses and LifeOS TCP listeners. The root-owned binary runs with customizations/tools/MCP disabled by the application. It returns validated proposals; the authoritative daemon controls state changes.

On the existing 2 GB VM, the service uses one execution at a time with `MemoryHigh=750M`, `MemoryMax=900M`, no swap, and a CPU quota. This is an explicitly constrained deployment below Claude Code's documented 4 GB requirement: representative authenticated runs and memory monitoring are required before relying on unattended execution. Memory exhaustion must fail the agent job without killing the LifeOS daemon. Subscription availability/rate limits remain external dependencies; they must appear as explicit job errors and must not silently switch to paid API billing.

`life-os-agent.service` follows backend stop/restart through `PartOf` and is started through the backend's weak `Wants` dependency. A failed or unauthenticated runner does not prevent the dashboard or Gmail worker from starting. The daemon's deployment drain must include active agent jobs before its service stops. Runner login material is separate from the current LifeOS backup scope; recovery requires another native sign-in.

## Backups, restoration and alerts

Hourly backup uses SQLite's consistent backup mechanism, includes protected config/OAuth files, verifies checksums, uploads to private GCS, and records local success only after upload completes. At midnight UTC the same verified archive is also uploaded under the daily prefix. The VM can create backup objects but cannot read, overwrite or delete old objects. The owner performs restores.

Restore procedure:

1. Stop scheduled jobs and writers. Identify the last known-good archive and its SHA-256 companion using the owner identity.
2. Download to a separate empty directory and verify the external archive checksum before extraction.
3. Extract into that directory and run `life-os backup verify <snapshot-directory>`.
4. Test opening the restored database and compare schema/release, row counts, OAuth file presence and import metadata. Do not connect a restored test copy to Gmail in apply mode.
5. Replace production state only through an attended restore with the daemon stopped and a fresh backup of current state. Restore matching Google client/token files, set ownership/modes, restart the compatible release and reconcile uncertain Gmail operations before reenabling the timer.

The operating targets are RPO one hour and RTO two hours; they are targets until a timed restore drill succeeds. A live copy of only the SQLite file does not constitute a backup.

Metrics are emitted every five minutes with resource type `global`, so host shutdown/deletion does not suppress metric-absence alerts. Cloud Monitoring alerts on 15-minute missing heartbeat, backend failure, backups over two hours old, account auth failures and scheduled apply work overdue after 06:53 Eastern. Shadow results do not satisfy scheduled production success. Verify the owner notification channel and test alert delivery independently of Gmail before cutover.

## Required rollout evidence

Do not report production readiness from passing unit tests alone. Record evidence for: successful exact-SHA deployment; authenticated MCP and dashboard reads; unauthorized/job-role denial; source-to-SQLite reconciliation; direct account OAuth verification; shadow review; attended apply; next Eastern timer; off-host backup and separate-directory restore; delivered alert; and private PWA login/route rejection if web access is enabled.

Exercise deployment failure paths with a controlled environment: corrupt archive, incompatible schema, failed readiness, two rapid pushes with an older completion, deployment during an active job, and runner/SSH disconnect. Confirm live tokens/data survive and the daily schedule remains unchanged. Local syntax tests cannot substitute for these cloud acceptance checks.
