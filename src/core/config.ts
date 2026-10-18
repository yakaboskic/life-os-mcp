import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

export interface LifeOsConfig {
  /** Root data directory (default ~/.life-os, override with LIFE_OS_HOME). */
  home: string;
  configFile: string;
  googleDir: string;
  clientSecretFile: string;
  tokensDir: string;
  /** Time-tracking data (registry.json, entries.jsonl, timer.json). */
  trackDir: string;
  /** Agent triage reports (email.md, slack.md, briefing.md) shown in the web portal. */
  triageLogDir: string;
  /** Sheets toolset data. */
  driveDir: string;
  drivePreviewsDir: string;
  /** Optional separate OAuth client for the sheets service (e.g. an admin-supplied one). */
  driveClientSecretFile: string;
  /** Toolset filter from LIFE_OS_TOOLSETS (comma-separated). CLI --toolsets overrides. */
  toolsetFilter?: string[];
  env: NodeJS.ProcessEnv;
}

export interface RegisteredSheet {
  spreadsheetId: string;
  account: string;
  note?: string;
  drive?: {
    rootFolderId?: string;
    proposedProductsFolderId?: string;
  };
}

/** Named Drive folder — the target for drive_doc_create. */
export interface RegisteredFolder {
  folderId: string;
  account: string;
  note?: string;
}

export interface LifeOsConfigFile {
  /** Legacy key name — these aliases are Google-account-level, shared by all Google toolsets. */
  gmail?: {
    aliases?: Record<string, string>;
  };
  drive?: {
    /** Path override for the sheets OAuth client JSON. */
    clientSecretFile?: string;
    registered?: Record<string, RegisteredSheet>;
    folders?: Record<string, RegisteredFolder>;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): LifeOsConfig {
  const home = env.LIFE_OS_HOME ?? join(homedir(), ".life-os");
  const googleDir = join(home, "google");
  const filter = env.LIFE_OS_TOOLSETS?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    home,
    configFile: join(home, "config.json"),
    googleDir,
    clientSecretFile: join(googleDir, "client_secret.json"),
    tokensDir: join(googleDir, "tokens"),
    trackDir: join(home, "track"),
    triageLogDir: join(home, "triage-log"),
    driveDir: join(home, "drive"),
    drivePreviewsDir: join(home, "drive", "previews"),
    driveClientSecretFile: join(googleDir, "client_secret_drive.json"),
    toolsetFilter: filter && filter.length > 0 ? filter : undefined,
    env,
  };
}

export interface GoogleClientCreds {
  clientId: string;
  clientSecret: string;
  source: "env" | "file";
  /** True when this came from a sheets-specific client (separate token variant). */
  isSheetsOverride?: boolean;
}

function parseClientSecretFile(path: string): { clientId: string; clientSecret: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path} is missing or not valid JSON: ${(err as Error).message}`);
  }
  const obj = raw as Record<string, any>;
  const inner = obj.installed ?? obj.web ?? obj;
  if (typeof inner.client_id !== "string" || typeof inner.client_secret !== "string") {
    throw new Error(
      `${path} does not contain client_id/client_secret. ` +
        `Download the OAuth client JSON for a "Desktop app" client from Google Cloud Console.`,
    );
  }
  return { clientId: inner.client_id, clientSecret: inner.client_secret };
}

/**
 * Resolve the Google OAuth client to use.
 *
 * Default service: GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET env vars, then
 * ~/.life-os/google/client_secret.json (raw downloaded `{"installed": {...}}`
 * shape or flat `{client_id, client_secret}`).
 *
 * service="drive": an admin-supplied client may be in play (e.g. the
 * organization-owned team-tracking client). Order: LIFE_OS_DRIVE_CLIENT_JSON env
 * path → config.json sheets.clientSecretFile → ~/.life-os/google/
 * client_secret_drive.json if present → fall back to the default client.
 * Tokens minted by an override client are stored as a separate variant
 * (<email>.drive.json) because tokens are client-bound.
 */
export function resolveGoogleClientCreds(config: LifeOsConfig, service?: "drive"): GoogleClientCreds {
  if (service === "drive") {
    const overridePath =
      config.env.LIFE_OS_DRIVE_CLIENT_JSON ??
      readConfigFileQuiet(config).drive?.clientSecretFile ??
      (existsSync(config.driveClientSecretFile) ? config.driveClientSecretFile : undefined);
    if (overridePath) {
      return { ...parseClientSecretFile(overridePath), source: "file", isSheetsOverride: true };
    }
  }
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = config.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
    return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, source: "env" };
  }
  if (!existsSync(config.clientSecretFile)) {
    throw new Error(
      `No Google OAuth client configured. Either set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, ` +
        `or save your downloaded OAuth client JSON (Desktop app type) to ${config.clientSecretFile}. ` +
        `See docs/google-cloud-setup.md for the walkthrough.`,
    );
  }
  return { ...parseClientSecretFile(config.clientSecretFile), source: "file" };
}

function readConfigFileQuiet(config: LifeOsConfig): LifeOsConfigFile {
  try {
    return JSON.parse(readFileSync(config.configFile, "utf8")) as LifeOsConfigFile;
  } catch {
    return {};
  }
}
