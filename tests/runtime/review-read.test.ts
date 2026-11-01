import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadConfig } from "../../src/core/config.js";
import { createWebServer, type WebFeatures } from "../../src/web/server.js";

const servers: Server[] = [], homes: string[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
async function fixture(features: WebFeatures = {}) {
  const home = mkdtempSync(join(tmpdir(), "lifeos-review-read-")); homes.push(home);
  const server = createWebServer(loadConfig({ LIFE_OS_HOME: home }), undefined, features); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("authoritative review read boundary", () => {
  it("advertises only a complete review workspace and fails closed on older backends", async () => {
    const base = await fixture({ reviewQueue: () => ({ items: [] }) });
    expect((await (await fetch(base + "/api/data")).json() as any).capabilities.reviewQueue).toBeUndefined();
    expect((await fetch(base + "/api/reviews")).status).toBe(503);
  });

  it("parses bounded filters, propagates an abort signal, and serves previews without caching", async () => {
    const queries: unknown[] = [], details: string[] = [];
    const base = await fixture({ reviewQueue: query => { queries.push(query); return { items: [], total: 0 }; },
      reviewDetail: async (itemId, signal) => { expect(signal.aborted).toBe(false); details.push(itemId); return { messages: [{ bodyText: "synthetic plain text" }] }; } });
    const response = await fetch(base + "/api/reviews?bucket=needsDecision&search=Launch%20review&limit=25");
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(queries).toEqual([{ bucket: "needsDecision", search: "Launch review", limit: 25 }]);
    const detail = await fetch(base + "/api/review?itemId=synthetic-one");
    expect(detail.status).toBe(200); expect(detail.headers.get("cache-control")).toContain("no-store");
    expect(await detail.json()).toEqual({ messages: [{ bodyText: "synthetic plain text" }] }); expect(details).toEqual(["synthetic-one"]);
  });

  it("rejects invalid queries and writes before calling review services", async () => {
    let calls = 0;
    const base = await fixture({ reviewQueue: () => { calls++; return {}; }, reviewDetail: async () => { calls++; return {}; } });
    for (const path of ["/api/reviews?limit=51", "/api/reviews?limit=1&limit=2", "/api/reviews?unknown=yes", "/api/review", "/api/review?itemId=one&account=other"]) {
      expect((await fetch(base + path)).status).toBe(400);
    }
    expect((await fetch(base + "/api/reviews", { method: "POST", body: "{}" })).status).toBe(405);
    expect(calls).toBe(0);
  });

  it.each([
    ["REVIEW_CURSOR_INVALID", 400], ["REVIEW_ACCOUNT_NOT_CONFIGURED", 400], ["REVIEW_NOT_FOUND", 404],
    ["REVIEW_BUSY", 503], ["REVIEW_STALE_CONTEXT", 409],
  ])("preserves actionable error %s without converting it into success", async (code, status) => {
    const base = await fixture({ reviewQueue: () => { throw new Error(String(code)); }, reviewDetail: async () => ({}) });
    const response = await fetch(base + "/api/reviews"); expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code, code });
  });

  it("conceals unexpected upstream error content", async () => {
    const base = await fixture({ reviewQueue: () => ({}), reviewDetail: async () => { throw new Error("private upstream request with credential"); } });
    const response = await fetch(base + "/api/review?itemId=synthetic-one"); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "REVIEW_UNAVAILABLE", code: "REVIEW_UNAVAILABLE" });
  });
});
