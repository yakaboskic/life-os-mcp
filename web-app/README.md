# Private LifeOS web app

Vercel hosts a small authentication gateway and the same dashboard/PWA assets used on the VM. Personal data stays on the VM. Each deployment permits one Google account, configured privately through `LIFE_OS_ALLOWED_EMAIL`. The repository contains no default owner. The Google web OAuth client requests `openid email profile`, never Gmail permissions.

Create the Vercel project with Root Directory `web-app`, Node.js 24, and **Include source files outside of the Root Directory in the Build Step** enabled. Use the generated production `https://<project>.vercel.app` origin; no custom domain is required. Set these server environment variables:

| Variable | Value |
| --- | --- |
| `GOOGLE_WEB_CLIENT_ID` | Dedicated Google OAuth **Web application** client ID |
| `GOOGLE_WEB_CLIENT_SECRET` | Web client secret |
| `LIFE_OS_SESSION_SECRET` | Random secret with at least 32 bytes |
| `LIFE_OS_ALLOWED_EMAIL` | Your complete Google account email, for example `owner@example.com` |
| `LIFE_OS_PUBLIC_URL` | Exact HTTPS production origin, without a path |
| `LIFE_OS_GATEWAY_URL` | HTTPS Cloud Run gateway origin ending in `.run.app` |
| `LIFE_OS_GATEWAY_TOKEN` | Random gateway bearer secret with at least 32 bytes |

To deploy your own copy, clone or fork the repository, provision your own VM and Cloud Run gateway, and connect your Vercel project to your repository. Create your own OAuth web client and independent random session and gateway secrets. Store deployment values in Vercel's server environment settings; store the matching gateway token in your gateway's secret configuration. Keep OAuth credentials, account addresses, cloud project identifiers, tokens and live LifeOS data out of committed configuration. Production and any separately enabled preview environment need their own configured origins and secrets.

Register `https://<project>.vercel.app/auth/callback` as the Google OAuth redirect URI. Do not reuse the Gmail Desktop OAuth client. Preview deployments reject authenticated requests unless their exact origin is explicitly configured with its own registered callback; production sessions are host-only.

`LIFE_OS_ALLOWED_EMAIL` is required and accepts one complete email address. Surrounding whitespace is trimmed and casing normalized to lowercase. Domains, wildcards, address lists and malformed addresses are rejected. The verified Google email must match that address exactly; sharing its domain does not grant access, and dots or plus aliases are not rewritten. An absent or invalid owner setting disables login and API access.

Sessions last at most eight hours in an HttpOnly, Secure, SameSite=Lax `__Host-` cookie. Login uses state, nonce and PKCE. ID tokens are signature-verified with Google's published keys and checked for issuer, audience, expiry, nonce and the exact verified email. Each request checks the signed session against the current owner setting, so changing the allowlisted account rejects the previous owner's sessions when that configuration is deployed. Logout is a same-origin POST. Rotate the session secret to revoke all sessions immediately.

Only `GET /api/data`, `/api/triage` and `/api/jobs` are proxied. The gateway token remains in the function; browser cookies, query parameters and authorization headers are never forwarded. The Cloud Run gateway must independently allow only these read-only routes and authenticate the machine token before forwarding to the VM over its private network.

Authenticated HTML, API responses and auth responses use private/no-store headers at the browser and Vercel CDN. The service worker caches only public icons and an offline explanation; tasks, email and dashboard snapshots are never cached for offline use. Missing or invalid configuration fails closed with a setup page.
