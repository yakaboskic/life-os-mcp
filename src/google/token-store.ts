import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ToolInputError } from "../core/errors.js";
import { writeAtomic } from "../core/fsutil.js";
import type { LifeOsConfig, LifeOsConfigFile } from "../core/config.js";

/** One token file per (account, client-variant), keyed by canonical email. */
export interface TokenFile {
  account: string;
  refresh_token: string;
  scopes: string[];
  client_id: string;
  created_at: string;
  updated_at: string;
}

/**
 * Variants exist because two OAuth clients can be in play: the user's own
 * client (gmail etc.) and an admin-supplied client (e.g. an organization-owned
 * sheets client). Tokens are client-bound, so each variant gets its own file:
 * <email>.json (default) vs <email>.drive.json. Same directory, disjoint sets.
 */
export type TokenVariant = "" | ".drive";
const ALL_VARIANTS: TokenVariant[] = ["", ".drive"];

/**
 * File-backed store for Google refresh tokens and account aliases under
 * ~/.life-os/google/. Formerly GmailStore — gmail re-exports it under that
 * name. Aliases stay under the legacy `gmail.aliases` config key (they are
 * Google-account-level, shared by every toolset).
 */
export class GoogleTokenStore {
  constructor(
    private readonly config: LifeOsConfig,
    private readonly variant: TokenVariant = "",
  ) {}

  private tokenPath(email: string): string {
    return join(this.config.tokensDir, `${email.toLowerCase()}${this.variant}.json`);
  }

  private matchesVariant(filename: string): boolean {
    if (!filename.endsWith(".json") || filename.endsWith(".tmp")) return false;
    const base = filename.slice(0, -".json".length);
    const otherSuffixes = ALL_VARIANTS.filter((v) => v !== "" && v !== this.variant);
    if (this.variant === "") return !otherSuffixes.some((s) => base.endsWith(s));
    return base.endsWith(this.variant);
  }

  // ---- token files ----

  listTokenFiles(): TokenFile[] {
    let entries: string[];
    try {
      entries = readdirSync(this.config.tokensDir);
    } catch {
      return [];
    }
    const tokens: TokenFile[] = [];
    for (const entry of entries) {
      if (!this.matchesVariant(entry)) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(this.config.tokensDir, entry), "utf8")) as TokenFile;
        if (parsed.account && parsed.refresh_token) tokens.push(parsed);
      } catch {
        // Skip unreadable/corrupt files; they'll surface via auth list.
      }
    }
    return tokens.sort((a, b) => a.account.localeCompare(b.account));
  }

  getTokenFile(email: string): TokenFile | undefined {
    try {
      return JSON.parse(readFileSync(this.tokenPath(email), "utf8")) as TokenFile;
    } catch {
      return undefined;
    }
  }

  saveTokenFile(token: TokenFile): void {
    writeAtomic(this.tokenPath(token.account), JSON.stringify(token, null, 2));
  }

  /** Persist a rotated refresh token (from OAuth2Client's `tokens` event). */
  saveRefreshToken(email: string, refreshToken: string): void {
    const existing = this.getTokenFile(email);
    if (!existing) return;
    existing.refresh_token = refreshToken;
    existing.updated_at = new Date().toISOString();
    this.saveTokenFile(existing);
  }

  deleteTokenFile(email: string): boolean {
    try {
      rmSync(this.tokenPath(email));
      return true;
    } catch {
      return false;
    }
  }

  // ---- config.json aliases (shared across variants) ----

  readConfigFile(): LifeOsConfigFile {
    try {
      return JSON.parse(readFileSync(this.config.configFile, "utf8")) as LifeOsConfigFile;
    } catch {
      return {};
    }
  }

  private writeConfigFile(file: LifeOsConfigFile): void {
    writeAtomic(this.config.configFile, JSON.stringify(file, null, 2));
  }

  aliases(): Record<string, string> {
    return this.readConfigFile().gmail?.aliases ?? {};
  }

  setAlias(alias: string, email: string): void {
    const clash = this.listTokenFiles().find(
      (t) => t.account.toLowerCase() === alias.toLowerCase() && t.account.toLowerCase() !== email.toLowerCase(),
    );
    if (clash) {
      throw new ToolInputError(`Alias "${alias}" collides with connected account ${clash.account}.`);
    }
    const file = this.readConfigFile();
    file.gmail ??= {};
    file.gmail.aliases ??= {};
    file.gmail.aliases[alias] = email.toLowerCase();
    this.writeConfigFile(file);
  }

  removeAliasesFor(email: string): void {
    const file = this.readConfigFile();
    const aliases = file.gmail?.aliases;
    if (!aliases) return;
    for (const [alias, target] of Object.entries(aliases)) {
      if (target.toLowerCase() === email.toLowerCase()) delete aliases[alias];
    }
    this.writeConfigFile(file);
  }

  // ---- account resolution ----

  /** Human-readable list of valid account identifiers, for error messages. */
  describeAccounts(): string {
    const tokens = this.listTokenFiles();
    if (tokens.length === 0) return "";
    const aliases = this.aliases();
    return tokens
      .map((t) => {
        const names = Object.entries(aliases)
          .filter(([, email]) => email.toLowerCase() === t.account.toLowerCase())
          .map(([alias]) => alias);
        return names.length > 0 ? `${names.join("/")} (${t.account})` : t.account;
      })
      .join(", ");
  }

  /**
   * Resolves an alias or email (case-insensitive) to the canonical account
   * email. Throws ToolInputError listing every valid account on a miss.
   */
  resolveAccount(input: string): string {
    const needle = input.trim().toLowerCase();
    for (const [alias, email] of Object.entries(this.aliases())) {
      if (alias.toLowerCase() === needle) return email.toLowerCase();
    }
    for (const token of this.listTokenFiles()) {
      if (token.account.toLowerCase() === needle) return token.account.toLowerCase();
    }
    const known = this.describeAccounts();
    const hint = this.variant === ".drive" ? 'life-os auth add --services drive' : "life-os auth add";
    throw new ToolInputError(
      known
        ? `Unknown account "${input}". Valid accounts: ${known}. Add one with: ${hint}`
        : `No connected accounts for this service. Run "${hint}" in a terminal to connect one.`,
    );
  }
}
