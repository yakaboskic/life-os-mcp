import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.js";
import { GmailStore } from "../../src/toolsets/gmail/store.js";
import { ToolInputError } from "../../src/core/errors.js";
import type { TokenFile } from "../../src/toolsets/gmail/types.js";

function freshStore(): { store: GmailStore; home: string } {
  const home = mkdtempSync(join(tmpdir(), "life-os-test-"));
  const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
  return { store: new GmailStore(config), home };
}

function token(email: string): TokenFile {
  const now = new Date().toISOString();
  return {
    account: email,
    refresh_token: `rt-${email}`,
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    client_id: "client-1",
    created_at: now,
    updated_at: now,
  };
}

describe("GmailStore", () => {
  let store: GmailStore;
  let home: string;

  beforeEach(() => {
    ({ store, home } = freshStore());
  });

  it("saves and reads token files keyed by lowercase email", () => {
    store.saveTokenFile(token("owner@example.com"));
    expect(store.getTokenFile("owner@example.com")?.refresh_token).toBe("rt-owner@example.com");
    expect(store.getTokenFile("OWNER@EXAMPLE.COM")?.account).toBe("owner@example.com");
    expect(store.listTokenFiles()).toHaveLength(1);
  });

  it.skipIf(process.platform === "win32")("writes token files with 0600 perms", () => {
    store.saveTokenFile(token("a@b.co"));
    const mode = statSync(join(home, "google", "tokens", "a@b.co.json")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("persists rotated refresh tokens and bumps updated_at", async () => {
    const t = token("a@b.co");
    store.saveTokenFile(t);
    await new Promise((r) => setTimeout(r, 5));
    store.saveRefreshToken("a@b.co", "rt-new");
    const after = store.getTokenFile("a@b.co")!;
    expect(after.refresh_token).toBe("rt-new");
    expect(after.updated_at >= t.updated_at).toBe(true);
    expect(after.created_at).toBe(t.created_at);
  });

  it("resolves aliases and emails case-insensitively", () => {
    store.saveTokenFile(token("personal.owner@example.com"));
    store.setAlias("personal", "personal.owner@example.com");
    expect(store.resolveAccount("personal")).toBe("personal.owner@example.com");
    expect(store.resolveAccount("PERSONAL")).toBe("personal.owner@example.com");
    expect(store.resolveAccount("Personal.Owner@Example.com")).toBe("personal.owner@example.com");
  });

  it("throws ToolInputError listing valid accounts on unknown input", () => {
    store.saveTokenFile(token("a@gmail.com"));
    store.saveTokenFile(token("b@gmail.com"));
    store.setAlias("work", "b@gmail.com");
    try {
      store.resolveAccount("nobody");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ToolInputError);
      const msg = (err as Error).message;
      expect(msg).toContain('Unknown account "nobody"');
      expect(msg).toContain("a@gmail.com");
      expect(msg).toContain("work (b@gmail.com)");
      expect(msg).toContain("life-os auth add");
    }
  });

  it("gives a distinct message when no accounts exist at all", () => {
    expect(() => store.resolveAccount("anyone")).toThrowError(/No connected accounts for this service/);
  });

  it("rejects an alias that collides with a different account's email", () => {
    store.saveTokenFile(token("a@gmail.com"));
    store.saveTokenFile(token("b@gmail.com"));
    expect(() => store.setAlias("a@gmail.com", "b@gmail.com")).toThrowError(/collides/);
  });

  it("removes aliases when an account is removed", () => {
    store.saveTokenFile(token("a@gmail.com"));
    store.setAlias("me", "a@gmail.com");
    store.deleteTokenFile("a@gmail.com");
    store.removeAliasesFor("a@gmail.com");
    expect(store.aliases()).toEqual({});
    expect(store.listTokenFiles()).toHaveLength(0);
  });
});
