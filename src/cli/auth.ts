import { google } from "googleapis";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { openDatabase, transaction } from "../state/database.js";
import { OAuth2Client } from "google-auth-library";
import { loadConfig, resolveGoogleClientCreds, type GoogleClientCreds, type LifeOsConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { GoogleTokenStore, type TokenVariant } from "../google/token-store.js";
import { runLoopbackOAuth } from "../google/oauth.js";
import { SERVICE_SCOPES, scopesForServices, servicesFromScopes } from "../google/scopes.js";

// These commands are interactive (run from a terminal, never under MCP), so
// plain console.log to stdout is correct here.

/** VM credentials/config are changed only while the owning daemon is stopped. */
function authoritativeMutation<T>(config: LifeOsConfig, action: () => T): T {
  if (!existsSync(join(config.home, ".vm-authoritative"))) return action();
  const maintenance = { ...config, env: { ...config.env, LIFE_OS_ACCESS_MODE: "migrate" } };
  const db = openDatabase(maintenance);
  // Recheck ownership under the writer lock before changing token/config files.
  return transaction(db, action);
}

function parseServices(input?: string): string[] {
  const services = (input ?? "gmail").split(",").map((s) => s.trim()).filter(Boolean);
  for (const s of services) {
    if (!SERVICE_SCOPES[s]) throw new Error(`Unknown service "${s}". Known services: ${Object.keys(SERVICE_SCOPES).join(", ")}`);
  }
  return services;
}

/** Which client + token-variant a given service set uses. */
function credsForServices(config: LifeOsConfig, services: string[]): { creds: GoogleClientCreds; variant: TokenVariant } {
  if (services.includes("drive")) {
    const creds = resolveGoogleClientCreds(config, "drive");
    if (creds.isSheetsOverride) {
      if (services.length > 1) {
        throw new Error(
          "drive uses a separate OAuth client on this machine (client_secret_drive.json), so it can't be " +
            'combined with other services in one sign-in. Run "life-os auth add --services drive" and ' +
            '"life-os auth add --services gmail" separately.',
        );
      }
      return { creds, variant: ".drive" };
    }
  }
  return { creds: resolveGoogleClientCreds(config), variant: "" };
}

async function resolveEmail(client: OAuth2Client): Promise<string> {
  const res = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = res.data.email?.toLowerCase();
  if (!email) throw new Error("Could not determine the account's email address from the userinfo endpoint.");
  return email;
}

export async function authAdd(opts: {
  alias?: string;
  services?: string;
  loginHint?: string;
  chromeProfile?: string;
  noBrowser?: boolean;
  callbackPort?: number;
}): Promise<void> {
  const config = loadConfig();
  authoritativeMutation(config, () => {});
  const logger = createLogger();
  const services = parseServices(opts.services);
  const { creds, variant } = credsForServices(config, services);
  const store = new GoogleTokenStore(config, variant);
  const requested = scopesForServices(services);

  const { tokens, client } = await runLoopbackOAuth({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    scopes: requested,
    logger,
    loginHint: opts.loginHint,
    chromeProfile: opts.chromeProfile,
    noBrowser: opts.noBrowser,
    callbackPort: opts.callbackPort,
  });

  const granted = (tokens.scope ?? "").split(/\s+/).filter(Boolean);
  for (const service of services) {
    const missing = SERVICE_SCOPES[service]!.filter((s) => !granted.includes(s));
    if (missing.length > 0) {
      throw new Error(
        `Google sign-in completed, but the ${service} permission(s) were NOT granted ` +
          `(${missing.map((m) => m.replace("https://www.googleapis.com/auth/", "")).join(", ")}). ` +
          `On the consent screen every checkbox must be checked. Run the command again.`,
      );
    }
  }
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Re-run the command — if it persists, remove the app's access " +
        "at https://myaccount.google.com/permissions and try again.",
    );
  }

  const email = await resolveEmail(client);
  if (opts.loginHint && email !== opts.loginHint.toLowerCase()) {
    throw new Error(
      `Signed in as ${email}, but this re-auth was intended for ${opts.loginHint}. ` +
        `Nothing was saved — run it again and pick the right account in the browser.`,
    );
  }
  const refreshToken = tokens.refresh_token;
  const existing = store.getTokenFile(email);
  const now = new Date().toISOString();
  authoritativeMutation(config, () => {
    store.saveTokenFile({
      account: email,
      refresh_token: refreshToken,
      scopes: [...new Set([...(existing?.scopes ?? []), ...granted])],
      client_id: creds.clientId,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });
    if (opts.alias) store.setAlias(opts.alias, email);
  });

  const serviceTag = services.join("+");
  console.log(
    `\n✔ Connected ${email} for ${serviceTag}${opts.alias ? ` (alias: ${opts.alias})` : ""}${existing ? " (re-authorized)" : ""}`,
  );
  if (creds.isSheetsOverride) {
    console.log(
      "\nThis sign-in used the admin-supplied drive client (client_secret_drive.json). Token lifetime follows " +
        "that project's policy — typically no 7-day Testing expiry.",
    );
  } else {
    console.log(
      "\nNote: while your OAuth consent screen is in Testing mode, Google expires this authorization after 7 days —\n" +
        're-run this command for the account when that happens (the running server picks it up without a restart).\n' +
        "To stop the weekly expiry, publish the consent screen to Production (see docs/google-cloud-setup.md).",
    );
  }
}

export async function authList(opts: { verify?: boolean }): Promise<void> {
  const config = loadConfig();
  const variants: { variant: TokenVariant; label: string }[] = [
    { variant: "", label: "" },
    { variant: ".drive", label: "  [sheets client]" },
  ];
  let any = false;
  for (const { variant, label } of variants) {
    const store = new GoogleTokenStore(config, variant);
    const aliases = store.aliases();
    for (const token of store.listTokenFiles()) {
      any = true;
      const names = Object.entries(aliases)
        .filter(([, email]) => email.toLowerCase() === token.account.toLowerCase())
        .map(([alias]) => alias);
      const services = servicesFromScopes(token.scopes);
      let status = "";
      if (opts.verify) {
        status = await verifyToken(config, variant, token.account).then(
          () => "  [OK]",
          (err) => `  [FAILED: ${(err as Error).message}]`,
        );
      }
      console.log(
        `${token.account}${names.length > 0 ? `  (alias: ${names.join(", ")})` : ""}  services: ${services.join(",") || "?"}${label}  updated ${token.updated_at}${status}`,
      );
    }
  }
  if (!any) console.log('No accounts connected. Run "life-os auth add" to connect one.');
}

/** Proves the refresh token still works by minting an access token. */
async function verifyToken(config: LifeOsConfig, variant: TokenVariant, email: string): Promise<void> {
  const store = new GoogleTokenStore(config, variant);
  const token = store.getTokenFile(email);
  if (!token) throw new Error("token file missing");
  const creds = variant === ".drive" ? resolveGoogleClientCreds(config, "drive") : resolveGoogleClientCreds(config);
  const client = new OAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret });
  client.setCredentials({ refresh_token: token.refresh_token });
  try {
    await client.getAccessToken();
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    throw new Error(msg.includes("invalid_grant") ? "authorization expired/revoked — re-run: life-os auth add" : msg);
  }
}

export async function authAlias(opts: { alias: string; account: string }): Promise<void> {
  const config = loadConfig();
  const email = authoritativeMutation(config, () => {
    const store = new GoogleTokenStore(config);
    const account = resolveInAnyVariant(config, opts.account);
    store.setAlias(opts.alias, account);
    return account;
  });
  console.log(`✔ ${opts.alias} → ${email}`);
}

function resolveInAnyVariant(config: LifeOsConfig, account: string): string {
  try {
    return new GoogleTokenStore(config).resolveAccount(account);
  } catch (defaultErr) {
    try {
      return new GoogleTokenStore(config, ".drive").resolveAccount(account);
    } catch {
      throw defaultErr;
    }
  }
}

export async function authRemove(opts: { account: string; revoke: boolean }): Promise<void> {
  const config = loadConfig();
  authoritativeMutation(config, () => {});
  const email = resolveInAnyVariant(config, opts.account);

  for (const variant of ["", ".drive"] as TokenVariant[]) {
    const store = new GoogleTokenStore(config, variant);
    const token = store.getTokenFile(email);
    if (!token) continue;
    if (opts.revoke) {
      try {
        const creds = variant === ".drive" ? resolveGoogleClientCreds(config, "drive") : resolveGoogleClientCreds(config);
        const client = new OAuth2Client({ clientId: creds.clientId, clientSecret: creds.clientSecret });
        await client.revokeToken(token.refresh_token);
        console.log(`Revoked Google authorization for ${email}${variant ? " (sheets client)" : ""}.`);
      } catch (err) {
        console.log(`Could not revoke with Google (removing locally anyway): ${(err as Error).message}`);
      }
    }
    authoritativeMutation(config, () => store.deleteTokenFile(email));
  }
  authoritativeMutation(config, () => new GoogleTokenStore(config).removeAliasesFor(email));
  console.log(`✔ Removed ${email}.`);
}
