# life-os-mcp

A **Life OS MCP server** — an extensible toolkit of [MCP](https://modelcontextprotocol.io) toolsets that AI agents use to manage your life. Toolsets are plug-in domains behind one server.

Production runtime uses Node 24, SQLite, systemd, and a private GCP VM. Pushes to `main` run verification; configured installations deploy the exact tested artifact. See [the operations runbook](docs/gcp-operations.md) for provisioning, migration, backups, rollback, and the daily Jev Gmail worker.

The Starfleet dashboard is an installable PWA. Its [Vercel web gateway](web-app/README.md) supports Google sign-in restricted to the configured owner; the VM retains all live data. SSH access and browser access use separate credentials.

The authenticated dashboard can create projects; search projects when creating or editing tasks; start, switch and stop focus sessions; complete tasks; and log or correct time. Browser and MCP actions share the same transactional tracker. Version checks prevent stale edits, and durable request receipts make retries safe. See the [project and task POST examples](web-app/README.md#creating-projects-and-tasks). The standalone `life-os web` command remains read-only.

Optional VM automations review held Gmail classifications and produce a daily brief in the dashboard and the operator's configured inbox. Initial classification stays with Jev; Claude reviews only eligible uncertain classifications. Configure a native Claude Code login in the dedicated runner account, or choose the separately billed Claude API provider. Named jobs have durable state, bounded usage, recovery and delivery reconciliation; the agent never receives Gmail credentials or arbitrary send authority.

```sh
life-os automation status
life-os automation run review
life-os automation run brief
life-os automation schedule --time 07:00 --enable
```

These commands connect to the authoritative daemon using its interactive credential. Agents can use `lifeos_snapshot`, `lifeos_action` and `lifeos_automations` through MCP. The daily workflow follows scheduled Gmail triage; the configured Eastern time is a fallback trigger if triage did not enqueue it. Pause with `life-os automation schedule --disable`. A brief already saved for the day is reused and is not emailed a second time on rerun. See [operations](docs/gcp-operations.md) for deployment and native Claude sign-in.

## Deploy your own instance

The repository contains reusable application code and deployment templates. Each installation supplies its own Google OAuth clients, Jev key, GCP project, Vercel project, and exact sign-in address. Copy [.env.example](.env.example) to a private `.env` with mode `0600`; never commit credentials, tokens, or live data.

Production deployment settings live in the repository’s GitHub `production` environment secrets. Provisioning enables `LIFE_OS_DEPLOY_ENABLED`; a new fork runs tests with deployment disabled. GCP workload identity is restricted to the configured repository ID, owner, main branch, and named workflows, so a fork cannot deploy into the maintainer’s cloud account. No service-account key is committed or stored in GitHub.

Vercel holds its server-side login credentials and owner allowlist; Secret Manager holds runtime secrets. Source releases exclude local state, OAuth files, `.env`, and private seed data. Follow the [operations runbook](docs/gcp-operations.md) and [web setup](web-app/README.md) for your own deployment.

Shipping toolsets:

- **`gmail`** — agents triage your inbox and respond on your behalf across **multiple Gmail accounts**: search, read, label/archive, draft, send (threaded replies included).
- **`track`** — personal **time tracking** with a products → projects → tasks hierarchy, a one-at-a-time stopwatch, manual logging, and report tools built for agents that sync your hours into an external team tracker.
- **`drive`** — **Google Sheets and Google Docs under a strict preview→apply write protocol** (plus Drive file/folder lookups and a named-folder registry). Docs read and write as Markdown, so headings, bullets and tables survive a round trip and a preview is a plain line diff; creating a document is a single call, while replacing an existing one is preview→apply. For sheets: columns addressed by header name only, exactly-one-row matching, formula/generated cells untouchable, single-use previews with drift detection, smallest-range writes, reread verification. Built to satisfy a team-tracker write-access runbook.

## How it works

- You supply your **own Google Cloud OAuth client** (Desktop app type) with your Gmail addresses added as **test users** — full `gmail.modify` access, no app verification needed. Setup: [docs/google-cloud-setup.md](docs/google-cloud-setup.md).
- `life-os auth add` runs a browser OAuth flow per account and stores a refresh token under `~/.life-os/` (0600 perms, keyed by canonical email).
- `life-os serve` runs the MCP server on stdio. Every `gmail_*` tool takes an `account` argument (email or alias) — there is no default account, so an agent can never silently act in the wrong inbox.
- Sending is deliberately split: `gmail_create_draft` for review-first workflows, `gmail_send_message`/`gmail_send_draft` when you've allowed sending. Your MCP client's per-tool permission prompts are the safety layer — you can allowlist drafting while keeping sends behind approval.
- Permanent deletion is impossible by design: the requested OAuth scope (`gmail.modify`) doesn't allow it. `gmail_trash_message` is recoverable for ~30 days.

## Quick start

```bash
# 1. One-time Google Cloud setup (OAuth client + test users)
#    → follow docs/google-cloud-setup.md, save the client JSON to ~/.life-os/google/client_secret.json

# 2. Build
npm install && npm run build

# 3. Connect your accounts (repeat per account)
node dist/index.js auth add --alias personal
node dist/index.js auth add --alias work
node dist/index.js auth list --verify

# 4. Register with Claude Code
claude mcp add life-os -- node "$(pwd)/dist/index.js" serve
```

Then ask your agent things like *“triage my personal inbox: archive newsletters, star anything that needs a reply, and draft responses”*.

> Optional: `npm link` puts a `life-os` command on your PATH, so the register line becomes `claude mcp add life-os -- life-os serve`.

## Gmail tools

| Tool | What it does |
|---|---|
| `gmail_list_accounts` | Connected accounts + aliases |
| `gmail_search_messages` | Raw Gmail query syntax (`is:unread newer_than:2d …`), metadata + snippets |
| `gmail_get_message` / `gmail_get_thread` | Decoded plain-text bodies (HTML converted), attachment metadata |
| `gmail_list_labels` / `gmail_create_label` | Label management |
| `gmail_modify_messages` | Batch triage: archive (`-INBOX`), mark read (`-UNREAD`), star, apply labels |
| `gmail_trash_message` | Move to Trash (recoverable) |
| `gmail_create_draft` / `gmail_list_drafts` | Draft new mail or threaded replies |
| `gmail_send_message` / `gmail_send_draft` | Send immediately (threaded replies set In-Reply-To/References properly) |

## Time tracking (`track` toolset)

Tracker data lives in SQLite under `LIFE_OS_HOME/life-os.sqlite`. Run `life-os db migrate` once to validate and import existing JSON/JSONL files; originals remain untouched. In production, the VM daemon owns the database and clients connect through SSH/IAP. One stopwatch runs at a time; starting a new task auto-stops (and records) the previous one. Entries attribute to the local calendar day they started; weeks run Mon–Sun with a 25h tracked-work target.

**MCP tools (16):** `track_status` / `track_start` / `track_stop` / `track_cancel` (stopwatch) · `track_log` / `track_list_entries` / `track_edit_entry` / `track_delete_entry` (entries) · `track_report` / `track_overview` (rollups for you and for sync agents) · `track_add_task` / `track_update_task` / `track_add_project` / `track_update_project` / `track_add_product` / `track_update_product` (hierarchy).

**Terminal stopwatch** (no agent needed):

```bash
life-os track tasks                      # open tasks with ids
life-os track start t3 --note "drafting" # or a name fragment: `track start roadmap`
life-os track status
life-os track stop --note "outline done"
life-os track report this-week           # hours by project vs the 25h target
```

**Read-only web portal:**

```bash
life-os web            # → http://127.0.0.1:4747
```

A self-contained local dashboard (no cloud, no external requests, GET-only, bound to 127.0.0.1): live stopwatch tile, today/this-week totals with the 25h target meter, hours-by-day bars, this week by project, the full portfolio tree, and recent entries grouped by day. Auto-refreshes every 15s; the running timer ticks live.

**Sync-agent workflow:** an agent calls `track_report` (`range: this_week`) and gets total hours, per-product/project/task breakdowns with your work-session notes, and the weekly-target math — everything needed to draft Person-log entries and Weekly-commitment updates in an external tracker (AppSheet/Google Sheets/etc.). `track_overview` gives it the full hierarchy with roles, goals, and milestone deadlines.

Seed your own hierarchy conversationally (`track_add_product` → `track_add_project` → `track_add_task`) or write a local seed script. Personal seed data belongs outside version control.

## ⚠️ The 7-day token gotcha

While your OAuth consent screen is in **Testing** mode, Google expires refresh tokens after **7 days** — each account's tools will start returning a clear re-auth error. Fixes:

1. re-run `life-os auth add` for that account (~30 seconds; the running server picks it up without a restart), or
2. publish the consent screen to **Production**, then reconnect expired accounts — this removes Testing's seven-day expiry. Personal-use apps can qualify for a verification exemption; account security changes can still invalidate tokens. Details in [docs/google-cloud-setup.md](docs/google-cloud-setup.md#the-7-day-refresh-token-expiry).

## CLI

```
life-os serve [--toolsets gmail,...]          Run the MCP server on stdio (default)
life-os auth add [--alias <name>]             Connect a Gmail account (browser flow)
life-os auth list [--verify]                  List accounts; --verify checks tokens live
life-os auth alias <name> <account>           Nickname a connected account (no re-auth)
life-os auth remove <account> [--no-revoke]   Disconnect (revokes with Google by default)
```

Environment: `LIFE_OS_HOME` (data dir, default `~/.life-os`), `LIFE_OS_TOOLSETS` (filter), `LIFE_OS_LOG_LEVEL` (stderr logging), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (instead of the JSON file).

## Extending Life OS

A toolset is one module implementing the contract in [src/core/toolset.ts](src/core/toolset.ts):

```ts
export interface Toolset {
  name: string;                 // tools must be named `${name}_*`
  description: string;
  tools: ToolDefinition[];      // zod schemas + handlers
  init?(ctx): Promise<void>;
  instructions?(ctx): Promise<string | null>;
}
```

Drop it in `src/toolsets/<name>/` and add one entry to `allToolsets()` in [src/core/registry.ts](src/core/registry.ts) — errors, registration, filtering, and logging come for free.

## Development

```bash
npm run dev          # run from source (tsx)
npm run typecheck    # tsc
npm test             # vitest (unit + in-memory MCP integration tests)
npm run build        # tsup → dist/
node scripts/smoke.mjs                   # spawn the built server over stdio and poke it
npx @modelcontextprotocol/inspector node dist/index.js serve   # interactive tool UI
```

## Security notes

- Refresh tokens live in `~/.life-os/google/tokens/*.json` (0600, atomic writes); nothing secret is ever stored in the repo.
- The server never opens a browser or handles OAuth itself — interactive auth is CLI-only.
- Agents see decoded email content by necessity; logs (stderr) never include message bodies or tokens.
