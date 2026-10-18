import { google, type gmail_v1 } from "googleapis";
import { AuthError, ToolInputError, UpstreamError } from "../../core/errors.js";
import { resolveGoogleClientCreds } from "../../core/config.js";
import type { ToolsetContext } from "../../core/toolset.js";
import { createAccountOAuth2 } from "../../google/auth.js";
import { GmailStore } from "./store.js";

/** Surface the tools depend on — kept narrow so tests can inject a fake. */
export interface GmailManagerLike {
  store: GmailStore;
  withClient<T>(
    account: string,
    fn: (gmail: gmail_v1.Gmail, email: string) => Promise<T>,
    opts?: { readOnly?: boolean },
  ): Promise<T>;
  resolveLabelIds(gmail: gmail_v1.Gmail, email: string, tokens: string[]): Promise<string[]>;
  /** Drop the cached label list for an account (after creating a label). */
  invalidateLabels(email: string): void;
}

const RETRYABLE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded"]);

interface LabelCacheEntry {
  at: number;
  byLowerName: Map<string, string>;
  ids: Set<string>;
  names: string[];
}

/**
 * Per-account Gmail clients. Auth is strictly per-instance
 * (google.gmail({auth})) — never google.options({auth}), which is global and
 * would break multi-account. Rotated refresh tokens are persisted from the
 * OAuth2Client `tokens` event; a dead refresh token (invalid_grant) evicts the
 * cache entry so a `life-os auth add` re-auth is picked up by the running
 * server without a restart.
 */
export class GmailAccountManager implements GmailManagerLike {
  readonly store: GmailStore;
  private readonly cache = new Map<string, gmail_v1.Gmail>();
  private readonly labelCache = new Map<string, LabelCacheEntry>();
  private static readonly LABEL_TTL_MS = 60_000;

  constructor(private readonly ctx: ToolsetContext) {
    this.store = new GmailStore(ctx.config);
  }

  evict(email: string): void {
    this.cache.delete(email);
    this.labelCache.delete(email);
  }

  invalidateLabels(email: string): void {
    this.labelCache.delete(email);
  }

  private getClient(email: string): gmail_v1.Gmail {
    const cached = this.cache.get(email);
    if (cached) return cached;

    const creds = (() => {
      try {
        return resolveGoogleClientCreds(this.ctx.config);
      } catch (err) {
        throw new AuthError((err as Error).message);
      }
    })();
    const { client } = createAccountOAuth2({
      email,
      store: this.store,
      creds,
      logger: this.ctx.logger,
      reauthCmd: "life-os auth add",
    });

    const gmail = google.gmail({ version: "v1", auth: client });
    this.cache.set(email, gmail);
    return gmail;
  }

  /**
   * Resolve the account (alias/email), run `fn` with an authorized client, and
   * map failures to actionable errors. Reads (`opts.readOnly`) are retried once
   * on rate-limit/5xx with jitter; writes are NEVER auto-retried (a duplicate
   * send is worse than a failed call).
   */
  async withClient<T>(
    account: string,
    fn: (gmail: gmail_v1.Gmail, email: string) => Promise<T>,
    opts: { readOnly?: boolean } = {},
  ): Promise<T> {
    const email = this.store.resolveAccount(account);
    const gmail = this.getClient(email);
    try {
      return await fn(gmail, email);
    } catch (err) {
      const mapped = this.mapError(err, email);
      if (opts.readOnly && mapped instanceof UpstreamError && mapped.retryable) {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
        try {
          return await fn(gmail, email);
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
    const topLevelError = typeof data?.error === "string" ? data.error : undefined; // token endpoint shape
    const apiError = typeof data?.error === "object" ? data.error : undefined; // Gmail API shape
    const reason: string | undefined = apiError?.errors?.[0]?.reason;
    const apiMessage: string | undefined = apiError?.message ?? data?.error_description;
    const rawMessage: string = e?.message ?? String(err);

    if (topLevelError === "invalid_grant" || rawMessage.includes("invalid_grant") || status === 401) {
      this.evict(email);
      return new AuthError(
        `Gmail authorization for ${email} has expired or been revoked. ` +
          `Google OAuth apps in Testing mode expire refresh tokens after 7 days (a password change also revokes them). ` +
          `Fix: run "life-os auth add" in a terminal and sign in as ${email} — the running server will pick it up automatically.`,
        email,
      );
    }
    if (status === 403 && reason === "insufficientPermissions") {
      return new AuthError(
        `The token for ${email} lacks the gmail.modify scope (the consent checkbox may have been left unchecked). ` +
          `Run "life-os auth add", sign in as ${email}, and make sure the Gmail permission is checked.`,
        email,
      );
    }
    if (status === 429 || (status === 403 && reason && RETRYABLE_REASONS.has(reason))) {
      return new UpstreamError(`Gmail rate limit hit for ${email}; retry shortly.`, status, true);
    }
    if (status === 404) {
      return new UpstreamError(
        `Not found (${apiMessage ?? "message/thread/draft id"}). Ids are account-specific — ` +
          `make sure the id came from a search in this same account (${email}).`,
        404,
      );
    }
    if (status === 400) {
      return new UpstreamError(`Gmail rejected the request: ${apiMessage ?? rawMessage}`, 400);
    }
    if (status !== undefined && status >= 500) {
      return new UpstreamError(`Gmail API server error (${status}); retry shortly.`, status, true);
    }
    if (status !== undefined) {
      return new UpstreamError(`Gmail API error (${status}): ${apiMessage ?? rawMessage}`, status);
    }
    return err instanceof Error ? err : new Error(rawMessage);
  }

  /**
   * Resolve label names OR ids to ids (system label ids equal their names,
   * e.g. INBOX/UNREAD/STARRED; user labels look like Label_123). Cached 60s per
   * account, because an invalid id fails an entire batchModify call.
   */
  async resolveLabelIds(gmail: gmail_v1.Gmail, email: string, tokens: string[]): Promise<string[]> {
    let entry = this.labelCache.get(email);
    if (!entry || Date.now() - entry.at > GmailAccountManager.LABEL_TTL_MS) {
      const res = await gmail.users.labels.list({ userId: "me" });
      const labels = res.data.labels ?? [];
      entry = {
        at: Date.now(),
        byLowerName: new Map(labels.filter((l) => l.name && l.id).map((l) => [l.name!.toLowerCase(), l.id!])),
        ids: new Set(labels.map((l) => l.id!).filter(Boolean)),
        names: labels.map((l) => l.name!).filter(Boolean).sort(),
      };
      this.labelCache.set(email, entry);
    }
    return tokens.map((token) => {
      if (entry!.ids.has(token)) return token;
      const byName = entry!.byLowerName.get(token.toLowerCase());
      if (byName) return byName;
      throw new ToolInputError(
        `Unknown label "${token}" in ${email}. Available labels: ${entry!.names.join(", ")}. ` +
          `Create new ones with gmail_create_label.`,
      );
    });
  }
}
