import { google, type docs_v1, type drive_v3, type sheets_v4 } from "googleapis";
import { AuthError, ToolInputError, UpstreamError } from "../../core/errors.js";
import { resolveGoogleClientCreds, type GoogleClientCreds } from "../../core/config.js";
import type { ToolsetContext } from "../../core/toolset.js";
import { createAccountOAuth2, requireScopes } from "../../google/auth.js";
import { GoogleTokenStore, type TokenVariant } from "../../google/token-store.js";
import { DOCUMENTS_READONLY_SCOPE, DRIVE_SCOPE, SPREADSHEETS_SCOPE } from "../../google/scopes.js";

export const DRIVE_REAUTH_CMD = "life-os auth add --services drive";

/** Surface the tools depend on — narrow so tests can inject a fake. */
export interface DriveManagerLike {
  store: GoogleTokenStore;
  withSheets<T>(
    account: string,
    fn: (sheets: sheets_v4.Sheets, email: string) => Promise<T>,
    opts?: { readOnly?: boolean },
  ): Promise<T>;
  withDocs<T>(
    account: string,
    fn: (docs: docs_v1.Docs, email: string) => Promise<T>,
    opts?: { readOnly?: boolean },
  ): Promise<T>;
  /** Docs work needs the Drive client (markdown import/export) and often the
   *  Docs client (structural pre-flight) under one scope gate. */
  withDocsPair<T>(
    account: string,
    fn: (drive: drive_v3.Drive, docs: docs_v1.Docs, email: string) => Promise<T>,
    opts?: { readOnly?: boolean },
  ): Promise<T>;
  withDrive<T>(
    account: string,
    fn: (drive: drive_v3.Drive, email: string) => Promise<T>,
    opts?: { readOnly?: boolean },
  ): Promise<T>;
}

interface Entry {
  sheets: sheets_v4.Sheets;
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
}

/** Which Google service a call needs — drives the scope gate. */
type Service = "sheets" | "drive" | "docs";

const REQUIRED_SCOPES: Record<Service, string[]> = {
  sheets: [SPREADSHEETS_SCOPE],
  drive: [DRIVE_SCOPE],
  // Docs rides on full Drive (create/update via markdown media) plus
  // documents.readonly for the optional structural pre-flight. Both are
  // already in SERVICE_SCOPES.drive, so this needs no re-authorization.
  docs: [DRIVE_SCOPE, DOCUMENTS_READONLY_SCOPE],
};

/**
 * Per-account Sheets/Drive clients, mirroring GmailAccountManager. When an
 * admin-supplied sheets client (client_secret_drive.json) is configured,
 * tokens live in the ".drive" variant — client-bound and disjoint from gmail
 * tokens. One OAuth2Client per account serves both Sheets and Drive.
 */
export class DriveAccountManager implements DriveManagerLike {
  readonly store: GoogleTokenStore;
  private readonly creds: GoogleClientCreds | null;
  private readonly cache = new Map<string, Entry>();

  constructor(private readonly ctx: ToolsetContext) {
    let creds: GoogleClientCreds | null = null;
    try {
      creds = resolveGoogleClientCreds(ctx.config, "drive");
    } catch {
      // No client configured at all — surfaced as AuthError on first use.
    }
    this.creds = creds;
    const variant: TokenVariant = creds?.isSheetsOverride ? ".drive" : "";
    this.store = new GoogleTokenStore(ctx.config, variant);
  }

  evict(email: string): void {
    this.cache.delete(email);
  }

  private getEntry(email: string, service: Service): Entry {
    // Checked before the cache lookup on purpose: a cached entry used to skip
    // its scope gate unless drive was needed, so a narrower token could ride a
    // warm cache into a wider call.
    const cached = this.cache.get(email);
    if (cached) {
      this.checkScopes(email, service);
      return cached;
    }
    if (!this.creds) {
      throw new AuthError(
        `No Google OAuth client configured for sheets. Save a client JSON to ` +
          `${this.ctx.config.driveClientSecretFile} (admin-supplied) or configure the standard client, ` +
          `then run "${DRIVE_REAUTH_CMD}".`,
      );
    }
    this.checkScopes(email, service);
    const { client } = createAccountOAuth2({
      email,
      store: this.store,
      creds: this.creds,
      logger: this.ctx.logger,
      reauthCmd: DRIVE_REAUTH_CMD,
    });
    const entry: Entry = {
      sheets: google.sheets({ version: "v4", auth: client }),
      drive: google.drive({ version: "v3", auth: client }),
      docs: google.docs({ version: "v1", auth: client }),
    };
    this.cache.set(email, entry);
    return entry;
  }

  private checkScopes(email: string, service: Service): void {
    const token = this.store.getTokenFile(email);
    if (!token) {
      throw new AuthError(`No stored drive authorization for ${email}. Run "${DRIVE_REAUTH_CMD}" and sign in as ${email}.`, email);
    }
    requireScopes(token, REQUIRED_SCOPES[service], DRIVE_REAUTH_CMD);
  }

  async withSheets<T>(
    account: string,
    fn: (sheets: sheets_v4.Sheets, email: string) => Promise<T>,
    opts: { readOnly?: boolean } = {},
  ): Promise<T> {
    return this.run(account, "sheets", (entry, email) => fn(entry.sheets, email), opts);
  }

  async withDrive<T>(
    account: string,
    fn: (drive: drive_v3.Drive, email: string) => Promise<T>,
    opts: { readOnly?: boolean } = {},
  ): Promise<T> {
    return this.run(account, "drive", (entry, email) => fn(entry.drive, email), opts);
  }

  async withDocs<T>(
    account: string,
    fn: (docs: docs_v1.Docs, email: string) => Promise<T>,
    opts: { readOnly?: boolean } = {},
  ): Promise<T> {
    return this.run(account, "docs", (entry, email) => fn(entry.docs, email), opts);
  }

  async withDocsPair<T>(
    account: string,
    fn: (drive: drive_v3.Drive, docs: docs_v1.Docs, email: string) => Promise<T>,
    opts: { readOnly?: boolean } = {},
  ): Promise<T> {
    return this.run(account, "docs", (entry, email) => fn(entry.drive, entry.docs, email), opts);
  }

  private async run<T>(
    account: string,
    service: Service,
    fn: (entry: Entry, email: string) => Promise<T>,
    opts: { readOnly?: boolean },
  ): Promise<T> {
    const email = this.store.resolveAccount(account);
    const entry = this.getEntry(email, service);
    try {
      return await fn(entry, email);
    } catch (err) {
      const mapped = this.mapError(err, email);
      if (opts.readOnly && mapped instanceof UpstreamError && mapped.retryable) {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        try {
          return await fn(entry, email);
        } catch (err2) {
          throw this.mapError(err2, email);
        }
      }
      throw mapped;
    }
  }

  private mapError(err: unknown, email: string): Error {
    if (err instanceof ToolInputError || err instanceof AuthError || err instanceof UpstreamError) return err;

    const e = err as any;
    const status: number | undefined = e?.response?.status ?? e?.status;
    const data = e?.response?.data;
    const topLevelError = typeof data?.error === "string" ? data.error : undefined;
    const apiError = typeof data?.error === "object" ? data.error : undefined;
    const apiStatus: string | undefined = apiError?.status; // e.g. "PERMISSION_DENIED", "RESOURCE_EXHAUSTED"
    const reason: string | undefined = apiError?.errors?.[0]?.reason;
    const apiMessage: string | undefined = apiError?.message ?? data?.error_description;
    const rawMessage: string = e?.message ?? String(err);

    if (topLevelError === "invalid_grant" || rawMessage.includes("invalid_grant") || status === 401) {
      this.evict(email);
      return new AuthError(
        `Google authorization for ${email} (drive service) has expired or been revoked. ` +
          `Run "${DRIVE_REAUTH_CMD}" and sign in as ${email} — the running server picks it up automatically.`,
        email,
      );
    }
    if (status === 429 || apiStatus === "RESOURCE_EXHAUSTED" || (reason && /ratelimit|quota/i.test(reason))) {
      return new UpstreamError(`Google API rate limit hit for ${email}; retry shortly.`, status, true);
    }
    if (status === 403) {
      if (rawMessage.includes("has not been used") || rawMessage.includes("is disabled") || reason === "accessNotConfigured") {
        return new AuthError(
          `A required Google API is disabled in the OAuth client's Cloud project: ${apiMessage ?? rawMessage}`,
        );
      }
      return new AuthError(
        `Permission denied: ${email} cannot access this resource. This is a SHARING problem, not a token problem — ` +
          `ask the owner to share the spreadsheet/folder with ${email} (Editor for writes), then retry.`,
        email,
      );
    }
    if (status === 404) {
      return new UpstreamError(
        `Not found (${apiMessage ?? "spreadsheet/file id"}). Check the registered spreadsheet id and tab name.`,
        404,
      );
    }
    if (status === 400) {
      return new UpstreamError(`Google API rejected the request: ${apiMessage ?? rawMessage}`, 400);
    }
    if (status !== undefined && status >= 500) {
      return new UpstreamError(`Google API server error (${status}); retry shortly.`, status, true);
    }
    if (status !== undefined) {
      return new UpstreamError(`Google API error (${status}): ${apiMessage ?? rawMessage}`, status);
    }
    return err instanceof Error ? err : new Error(rawMessage);
  }
}
