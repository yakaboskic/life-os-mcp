import { describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthError, ToolInputError, UpstreamError, toCallToolResult } from "../../src/core/errors.js";
import { loadConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { GmailAccountManager } from "../../src/toolsets/gmail/client.js";
import { GmailStore } from "../../src/toolsets/gmail/store.js";

const silentLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };

describe("toCallToolResult", () => {
  it("passes through actionable error messages with isError", () => {
    const res = toCallToolResult(new ToolInputError("bad input"), silentLogger);
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toBe("bad input");
  });

  it("hides stack traces for unexpected errors but logs them", () => {
    const logger = { ...silentLogger, error: vi.fn() };
    const res = toCallToolResult(new Error("boom"), logger);
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toBe("Unexpected error: boom");
    expect(logger.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GmailAccountManager error mapping, via withClient with fabricated GaxiosError
// shapes thrown from the callback.
// ---------------------------------------------------------------------------

function managerWithAccount(): GmailAccountManager {
  const home = mkdtempSync(join(tmpdir(), "life-os-errors-"));
  const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
  mkdirSync(config.googleDir, { recursive: true });
  writeFileSync(config.clientSecretFile, JSON.stringify({ installed: { client_id: "cid", client_secret: "cs" } }));
  const store = new GmailStore(config);
  const now = new Date().toISOString();
  store.saveTokenFile({
    account: "me@gmail.com",
    refresh_token: "rt",
    scopes: [],
    client_id: "cid",
    created_at: now,
    updated_at: now,
  });
  return new GmailAccountManager({ config, logger: createLogger("error") });
}

function gaxios(status: number, body: unknown, message = "request failed"): Error {
  const err = new Error(message) as any;
  err.response = { status, data: body };
  return err;
}

describe("GmailAccountManager error mapping", () => {
  it("maps invalid_grant to a re-auth AuthError naming the account and the 7-day cause", async () => {
    const mgr = managerWithAccount();
    await expect(
      mgr.withClient("me@gmail.com", async () => {
        throw gaxios(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(AuthError);
      const msg = (err as Error).message;
      expect(msg).toContain("me@gmail.com");
      expect(msg).toContain("7 days");
      expect(msg).toContain("life-os auth add");
      return true;
    });
  });

  it("maps 404 to an account-specific-ids hint", async () => {
    const mgr = managerWithAccount();
    await expect(
      mgr.withClient("me@gmail.com", async () => {
        throw gaxios(404, { error: { message: "Requested entity was not found.", errors: [{ reason: "notFound" }] } });
      }),
    ).rejects.toThrowError(/account-specific/);
  });

  it("passes Gmail's own message through on 400s", async () => {
    const mgr = managerWithAccount();
    await expect(
      mgr.withClient("me@gmail.com", async () => {
        throw gaxios(400, { error: { message: "Invalid query", errors: [{ reason: "invalidArgument" }] } });
      }),
    ).rejects.toThrowError(/Invalid query/);
  });

  it("retries read-only calls once on 429, then surfaces a retryable UpstreamError", async () => {
    const mgr = managerWithAccount();
    const fn = vi.fn(async () => {
      throw gaxios(429, { error: { message: "Rate limited", errors: [{ reason: "rateLimitExceeded" }] } });
    });
    await expect(mgr.withClient("me@gmail.com", fn, { readOnly: true })).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(UpstreamError);
      expect((err as UpstreamError).retryable).toBe(true);
      return true;
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries writes", async () => {
    const mgr = managerWithAccount();
    const fn = vi.fn(async () => {
      throw gaxios(429, { error: { message: "Rate limited", errors: [{ reason: "rateLimitExceeded" }] } });
    });
    await expect(mgr.withClient("me@gmail.com", fn)).rejects.toBeInstanceOf(UpstreamError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws ToolInputError listing accounts for an unknown account", async () => {
    const mgr = managerWithAccount();
    await expect(mgr.withClient("stranger@x.com", async () => "unreachable")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ToolInputError);
      expect((err as Error).message).toContain("me@gmail.com");
      return true;
    });
  });
});
