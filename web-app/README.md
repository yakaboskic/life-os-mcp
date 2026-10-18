# Private LifeOS web app

Vercel hosts a small authentication gateway and the same dashboard/PWA assets used on the VM. The VM owns live data; the web gateway handles dashboard responses in transit, and the Gmail worker sends classification inputs to TypeSafe/Jev. Each deployment permits one Google account, configured privately through `LIFE_OS_ALLOWED_EMAIL`. The repository contains no default owner. The Google web OAuth client requests `openid email profile`, never Gmail permissions.

Create the Vercel project with Root Directory `web-app`, Node.js 24, and **Include source files outside of the Root Directory in the Build Step** enabled. Use a stable production HTTPS origin you control, such as the generated `https://<project>.vercel.app` address; Google branding requirements may require additional domain verification or a custom domain. Set these server environment variables:

| Variable | Value |
| --- | --- |
| `GOOGLE_WEB_CLIENT_ID` | Dedicated Google OAuth **Web application** client ID |
| `GOOGLE_WEB_CLIENT_SECRET` | Web client secret |
| `LIFE_OS_SESSION_SECRET` | Random secret with at least 32 bytes |
| `LIFE_OS_ALLOWED_EMAIL` | Your complete Google account email, for example `owner@example.com` |
| `LIFE_OS_PUBLIC_URL` | Exact HTTPS production origin, without a path |
| `LIFE_OS_BRANDING_URL` | Optional public product homepage on your own website, e.g. `https://www.example.com/life-os` |
| `LIFE_OS_BRANDING_APP` | Optional app identifier for shared policies, e.g. `lifeos` |
| `LIFE_OS_GATEWAY_URL` | HTTPS Cloud Run gateway origin ending in `.run.app` |
| `LIFE_OS_GATEWAY_TOKEN` | Random gateway bearer secret with at least 32 bytes |

To deploy your own copy, clone or fork the repository, provision your own VM and Cloud Run gateway, and connect your Vercel project to your repository. Create your own OAuth web client and independent random session and gateway secrets. Store deployment values in Vercel's server environment settings; store the matching gateway token in your gateway's secret configuration. Keep OAuth credentials, account addresses, cloud project identifiers, tokens and live LifeOS data out of committed configuration. Production and any separately enabled preview environment need their own configured origins and secrets.

Register `https://<project>.vercel.app/auth/callback` as the Google OAuth redirect URI. Do not reuse the Gmail Desktop OAuth client. Preview deployments reject authenticated requests unless their exact origin is explicitly configured with its own registered callback; production sessions are host-only.

The app provides public, static branding pages without requiring login or working credentials. Set the Google Auth Platform Branding links to your deployment's exact URLs:

| Branding field | Example URL |
| --- | --- |
| Application home page | `https://<project>.vercel.app/about` |
| Privacy policy | `https://<project>.vercel.app/privacy` |
| Terms of service | `https://<project>.vercel.app/terms` |

These pages contain no account data or deployment secrets and link from the sign-in page. Keep their disclosures accurate for your installation, especially classification providers, data use and retention. Supply your monitored support contact in the Google consent configuration. Google's [branding requirements](https://support.google.com/cloud/answer/15549049) also require the homepage on a verified domain you own; complete any domain verification or custom-domain setup Google requires before publishing. The pages do not bypass Google verification.

To host the public pages on a separate company or personal website, publish a product homepage and its `/privacy` and `/terms` child pages there. Set `LIFE_OS_BRANDING_URL` privately in Vercel to that homepage's HTTPS URL. LifeOS's `/about`, `/privacy` and `/terms` routes then redirect to those canonical pages without forwarding query strings, cookies or account data. Use the canonical website URLs directly in Google Branding. The setting must not contain credentials, a query string or a fragment. Leave it unset to serve the built-in pages. This does not change `LIFE_OS_PUBLIC_URL`, the OAuth callback, or private dashboard access.

For a company-wide policy site with an app selector, set the branding URL to the company origin and set `LIFE_OS_BRANDING_APP=lifeos`. Policy links will open `/privacy?app=lifeos` and `/terms?app=lifeos`; the About link still opens the company homepage. The selector is optional and must start with a lowercase letter, followed by lowercase letters, digits or hyphens, up to 64 characters total. The selected app must exist on your policy site. Incoming request parameters never override this server setting.

`LIFE_OS_ALLOWED_EMAIL` is required and accepts one complete email address. Surrounding whitespace is trimmed and casing normalized to lowercase. Domains, wildcards, address lists and malformed addresses are rejected. The verified Google email must match that address exactly; sharing its domain does not grant access, and dots or plus aliases are not rewritten. An absent or invalid owner setting disables login and API access.

Sessions last at most eight hours in an HttpOnly, Secure, SameSite=Lax `__Host-` cookie. Login uses state, nonce and PKCE. ID tokens are signature-verified with Google's published keys and checked for issuer, audience, expiry, nonce and the exact verified email. Each request checks the signed session against the current owner setting, so changing the allowlisted account rejects the previous owner's sessions when that configuration is deployed. Logout is a same-origin POST. Rotate the session secret to revoke all sessions immediately.

The proxy permits only `GET /api/data`, `/api/triage`, `/api/jobs`, `/api/automation`, and `POST /api/actions`. Actions use JSON `{requestId, action, input}`, limited to 64 KiB. The function requires a valid owner session, an exact `Origin`, and `Sec-Fetch-Site: same-origin` before forwarding any action. It derives `x-life-os-actor` from the verified session email and ignores a browser-supplied actor. Browser cookies, query parameters and authorization headers are never forwarded; the gateway bearer stays server-side.

Cloud Run and the VM independently enforce the route/method allowlists, body bounds and actor format. The VM passes actions to the authoritative daemon callback; the local dashboard has no unauthenticated write endpoint. The daemon validates the operation and input, deduplicates request IDs, checks expected revisions and records the actor. Conflicts and unavailable services preserve their HTTP status through both proxy layers; the UI must retain the user's input and show the error instead of assuming success. Agent work is queued asynchronously and read through status endpoints. Review suggestions require explicit approval; no arbitrary command, MCP endpoint or backend administrator token is exposed.

The VM and gateway deploy sequentially through GitHub, while Vercel deploys independently from the same repository. New UI controls use backend capabilities so an older VM stays usable during rollout. See the [operations runbook](../docs/gcp-operations.md#gateway-deployment-from-github) for enabling the gateway's verified-image deployment stage.

Authenticated HTML, API responses and auth responses use private/no-store headers at the browser and Vercel CDN. The service worker caches only public icons and an offline explanation; tasks, email and dashboard snapshots are never cached for offline use. Missing or invalid configuration fails closed with a setup page.

## Creating projects and tasks

Choose **New project** in Projects to create a project with a name, optional product, goal and notes. In **New task** or **Edit task**, search by project name, ID, or product name, then select a result. **No project** leaves the task unassigned. Search text itself never becomes a project ID.

The authenticated `POST /api/actions` endpoint accepts a `project.create` command:

```json
{
  "requestId": "project-create-unique-id",
  "action": "project.create",
  "input": {
    "name": "Launch planning",
    "productId": "existing-product-id",
    "goal": "Prepare the next release",
    "notes": "Coordinate the release checklist"
  }
}
```

Only `name` is required; it is trimmed and must contain 1–200 characters. `productId` must be an exact existing product ID, `goal` permits up to 2,000 characters, and `notes` up to 20,000. Unknown input fields are rejected. A successful response is HTTP 200 with `ok: true`, the matching `requestId`, and the created project in `result`. Use `result.id` when creating a task:

```json
{
  "requestId": "task-create-unique-id",
  "action": "task.create",
  "input": {
    "title": "Prepare release checklist",
    "projectId": "launch-planning"
  }
}
```

From JavaScript on the signed-in LifeOS page, send either command with `fetch('/api/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(command) })`. The browser supplies the session cookie and same-origin headers. Generate a fresh `requestId` with `crypto.randomUUID()` for each new command; retain the same ID and payload when retrying an uncertain response. Case-insensitive duplicate project names return HTTP 409 (`PROJECT_EXISTS`); an unknown product returns HTTP 404 (`PRODUCT_MISSING`). Neither creates a project.

Connected agents can pass the same command object to `lifeos_action`, using `lifeos_snapshot` to discover product and project IDs. The public web endpoint requires a signed-in browser session; agent credentials stay on the existing private MCP connection.
