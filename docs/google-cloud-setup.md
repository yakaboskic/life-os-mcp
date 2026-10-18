# Google Cloud setup for the Gmail toolset

> **Also using the `drive` toolset?** Enable the **Google Sheets API, Google Drive API, and Google Docs API** in its project. A granted scope with its API disabled fails with `SERVICE_DISABLED`. If an administrator supplied a separate OAuth client, save it as `~/.life-os/google/client_secret_drive.json` (chmod 600); `life-os auth add --services drive` uses it automatically. Its token lifetime follows that client's publishing status and organization policies; a separate client alone does not remove expiry.

One-time setup (~10 minutes). You create your **own** OAuth client so Life OS talks to Gmail as *your* app — no third party ever sees your tokens.

> Google has been renaming these console screens ("OAuth consent screen" is now under **Google Auth Platform** in newer consoles). Both namings are given below.

## 1. Create a project and enable the Gmail API

1. Go to [console.cloud.google.com](https://console.cloud.google.com) and create a project (e.g. `life-os`).
2. **APIs & Services → Library** → search **Gmail API** → **Enable**.

## 2. Configure the consent screen and add test users

1. **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding/Audience**).
2. User type / audience: **External**. Fill in the app name (`Life OS`) and your email; skip optional branding.
3. Scopes: you can skip adding scopes here — the CLI requests `gmail.modify` at sign-in time.
4. **Test users** (Audience section): add **every Gmail address you plan to connect**. Accounts not listed here cannot complete sign-in while the app is in Testing mode.
5. Leave publishing status as **Testing** for now (see the 7-day note below).

## 3. Create the OAuth client (Desktop app)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Name it anything.
3. **Download JSON** and save it as:

   ```bash
   mkdir -p ~/.life-os/google
   mv ~/Downloads/client_secret_*.json ~/.life-os/google/client_secret.json
   chmod 600 ~/.life-os/google/client_secret.json
   ```

   (Alternatively, export `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` instead of keeping the file.)

## 4. Connect accounts

```bash
node dist/index.js auth add --alias personal
```

A browser opens: pick the account → Google shows an *“unverified app / you're a test user”* interstitial (expected — it's your own app) → **make sure the Gmail checkbox is checked** on the consent screen (Google's granular consent lets you decline it; the CLI verifies and will ask you to redo it if unchecked) → "Connected ✔".

Repeat per account. Check with:

```bash
node dist/index.js auth list --verify
```

## The 7-day refresh token expiry

**While the consent screen is in Testing mode, Google expires refresh tokens after 7 days** (the exemption only covers basic profile scopes — Gmail scopes don't qualify). Symptom: every tool for an account starts returning:

> Gmail authorization for … has expired or been revoked. … run "life-os auth add" …

Two ways to handle it:

| Option | How | Trade-off |
|---|---|---|
| **(a) Re-auth weekly** | Re-run `life-os auth add` per account when prompted. On the authoritative VM, stop the daemon during credential maintenance and restart afterward. | Weekly manual intervention; unsuitable for unattended operation. |
| **(b) Publish to Production** | Google Auth Platform → Audience → **Publish app**, then reconnect expired accounts. | Removes Testing's seven-day expiry. Personal-use apps can qualify for a verification exemption and show an unverified-app warning. Workspace administrators may still block access. |

Production refresh tokens are not guaranteed to last forever: revocation, six months of disuse, Gmail password changes, granted time limits, or organization policies can invalidate them. Google currently limits each account/client pair to 100 live refresh tokens; minting more invalidates the oldest. LifeOS stores refresh tokens privately and refreshes access tokens automatically during normal work. See Google's [token lifetime documentation](https://developers.google.com/identity/protocols/oauth2/) and [verification exemptions](https://support.google.com/cloud/answer/13464323?hl=en).

If publishing is blocked by incomplete Branding, complete the app name, support email, and developer contact, plus real public homepage and policy links. A deployed LifeOS web app serves `/about`, `/privacy`, and `/terms` without exposing dashboard data. Use those URLs on your own deployment and complete Google's domain ownership checks if requested. See the current [Branding requirements](https://support.google.com/cloud/answer/15549049?hl=en). Publishing the OAuth app does not remove LifeOS's own exact-email sign-in restriction.

For a public source repository, each person deploying LifeOS should create their own OAuth clients and cloud resources. Publishing the code does not share the maintainer's OAuth client, credentials, or data with other deployments. A shared hosted service for unrelated users has different verification requirements.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Error 403: access_denied` during sign-in | The account isn't in **Test users** — add it (step 2.4). |
| `No Google OAuth client configured` | `client_secret.json` missing/misplaced, and env vars unset (step 3). |
| `the Gmail permission was NOT granted` | The Gmail checkbox was unchecked on the consent screen — re-run and check it. |
| `authorization … expired or been revoked` | The 7-day expiry (above), a password change, or manual revocation — re-run `auth add`. |
| `token … issued to a different OAuth client` | You swapped `client_secret.json`; tokens are client-bound — re-run `auth add`. |
| Tools not showing up in your MCP client | Check the client's server logs; the server logs to stderr only. `node scripts/smoke.mjs` verifies the stdio transport independently. |
| Rate limit errors | Gmail allows ~250 quota units/sec/user; reads retry once automatically — just retry the call shortly. |

## Notes on behavior

- **Signatures**: the Gmail API does **not** append your configured signature — the agent must include any sign-off in the body.
- **Sending identity**: mail is sent as the authenticated account's primary address.
- **Scope**: only `gmail.modify` is requested — everything the tools need, but *not* permanent deletion (`messages.delete` requires the full mail scope, which Life OS never asks for).
