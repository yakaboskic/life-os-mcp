import { afterEach, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseActionRequest } from "../../src/runtime/actions.js";
import { createPrivateWebBridge } from "../../src/runtime/web-bridge.js";
import { createVercelHandler } from "../../web-app/api/index.js";
import { createWebHandler } from "../../web-app/handler.js";
import { SESSION_COOKIE, signCookie } from "../../web-app/auth.js";
// The standalone production gateway intentionally has no TypeScript dependency.
// @ts-expect-error No declaration file is shipped for the deployment module.
import { createGateway } from "../../deploy/web-gateway/server.mjs";

const servers: Server[] = [];
const token = "synthetic-review-gateway-token-at-least-32-bytes";
const jobToken = "synthetic-job-token-distinct-from-gateway-token";
const owner = "owner@example.com", origin = "https://synthetic-lifeos.vercel.app";
const now = 1_800_000_000, secret = "synthetic-review-session-secret-at-least-32-bytes";
const cookie = `${SESSION_COOKIE}=${signCookie({ kind: "session", sub: "synthetic-owner", email: owner, iat: now, exp: now + 3600 }, secret)}`;
const command = { requestId: "http-review-bulk-request", action: "review.bulkResolve", input: {
  items: [
    { itemId: "synthetic-item-one", revision: "a".repeat(64), category: "NEWSLETTER" },
    { itemId: "synthetic-item-two", revision: "b".repeat(64), category: "ACTION/SOON" },
  ], rememberPreference: false,
} };

async function listen(server: Server) {
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function sendHttp(url: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? "GET", headers: options.headers }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(Buffer.from(chunk))); res.on("error", reject);
      res.on("end", () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on("error", reject); req.end(options.body);
  });
}
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
});

async function harness(mode: "raw" | "preparsed" = "raw", callbackError?: { status: number; code: string }) {
  const hops = { vercel: [] as string[], gateway: [] as string[], loopback: [] as string[] };
  const calls: Array<{ body: unknown; actor: string }> = [];
  const loopback = await listen(createServer((req, res) => {
    hops.loopback.push(req.url!);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ synthetic: true, path: req.url }));
  }));
  const privateBase = await listen(createPrivateWebBridge(token, "10.53.0.2", Number(new URL(loopback).port), {
    executeAction: async (body, actor) => {
      const parsed = parseActionRequest(body);
      calls.push({ body: parsed, actor });
      if (callbackError) throw Object.assign(new Error("Review evidence changed"), callbackError);
      return { ok: true, requestId: parsed.requestId, result: { reviewReceipt: { id: parsed.requestId, itemCount: 2 } } };
    },
  }));
  const gatewayBase = await listen(createGateway({ token, upstream: "http://10.53.0.2:4749", fetchImpl: async (url: URL, options: RequestInit) => {
    const path = url.pathname + url.search; hops.gateway.push(path);
    return sendHttp(privateBase + path, { method: options.method, body: options.body as string | undefined,
      headers: { ...(options.headers as Record<string, string>), host: "10.53.0.2:4749" } });
  } }));
  const adapter = createVercelHandler(createWebHandler({ now: () => now, env: {
    GOOGLE_WEB_CLIENT_ID: "synthetic.apps.googleusercontent.com", GOOGLE_WEB_CLIENT_SECRET: "synthetic-only",
    LIFE_OS_SESSION_SECRET: secret, LIFE_OS_ALLOWED_EMAIL: owner, LIFE_OS_PUBLIC_URL: origin,
    LIFE_OS_GATEWAY_URL: "https://synthetic-gateway.run.app", LIFE_OS_GATEWAY_TOKEN: token,
  }, fetch: (async (url, options) => {
    const parsed = new URL(String(url)), path = parsed.pathname + parsed.search; hops.vercel.push(path);
    return fetch(gatewayBase + path, options);
  }) as typeof fetch }));
  const browserBase = await listen(createServer(async (req, res) => {
    if (mode === "preparsed" && req.method === "POST") {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      Object.defineProperty(req, "body", { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
    }
    await adapter(req, res);
  }));
  const browser = (path: string, options: { body?: unknown; headers?: Record<string, string> } = {}) => sendHttp(browserBase + path, {
    method: options.body === undefined ? "GET" : "POST", body: options.body === undefined ? undefined : JSON.stringify(options.body),
    headers: { host: new URL(origin).host, cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", ...options.headers },
  });
  return { browser, gatewayBase, privateBase, hops, calls };
}

describe("human review through the complete authenticated HTTP chain", () => {
  it("preserves every bounded list filter and cursor through all four HTTP hops", async () => {
    const h = await harness();
    const query = new URLSearchParams({ bucket: "needsDecision", search: "Café / launch + follow-up", account: "team+synthetic@example.com",
      category: "ACTION/SOON", limit: "50", cursor: "opaque-cursor_123" });
    const path = `/api/reviews?${query}`;
    const response = await h.browser(path);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ synthetic: true, path });
    expect(h.hops).toEqual({ vercel: [path], gateway: [path], loopback: [path] });
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(h.calls).toEqual([]);
  });

  it("fetches detail only after a valid owner session, never from a job token alone", async () => {
    const h = await harness(), path = "/api/review?itemId=synthetic-item-one";
    const rejectedHeaders: Array<Record<string, string>> = [{ cookie: "" }, { cookie: `${SESSION_COOKIE}=invalid` }, { cookie: "", authorization: `Bearer ${jobToken}` }];
    for (const headers of rejectedHeaders) {
      expect((await h.browser(path, { headers })).status).toBe(401);
    }
    expect(h.hops).toEqual({ vercel: [], gateway: [], loopback: [] });
    const response = await h.browser(path); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synthetic: true, path });
    expect(h.hops.loopback).toEqual([path]); expect(h.calls).toEqual([]);
  });

  it.each(["raw", "preparsed"] as const)("passes bulk JSON and the authenticated actor exactly once through a %s platform request", async mode => {
    const h = await harness(mode);
    const response = await h.browser("/api/actions", { body: command, headers: {
      "x-life-os-actor": "spoofed@example.com", authorization: `Bearer ${jobToken}`,
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, requestId: command.requestId, result: { reviewReceipt: { itemCount: 2 } } });
    expect(h.calls).toEqual([{ body: command, actor: owner }]);
    expect(h.hops).toEqual({ vercel: ["/api/actions"], gateway: ["/api/actions"], loopback: [] });
  });

  it("rejects cross-site reads and bulk decisions before proxying private data or actions", async () => {
    const h = await harness();
    const rejectedHeaders: Array<Record<string, string>> = [{ origin: "https://unrelated.example" }, { "sec-fetch-site": "cross-site" }];
    for (const headers of rejectedHeaders) {
      expect((await h.browser("/api/reviews?bucket=all", { headers })).status).toBe(403);
      expect((await h.browser("/api/review?itemId=synthetic-item-one", { headers })).status).toBe(403);
      expect((await h.browser("/api/actions", { body: command, headers })).status).toBe(403);
    }
    expect(h.hops).toEqual({ vercel: [], gateway: [], loopback: [] }); expect(h.calls).toEqual([]);
  });

  it("cannot use a job credential at either gateway boundary or smuggle non-allowlisted queries", async () => {
    const h = await harness();
    for (const base of [h.gatewayBase, h.privateBase]) {
      expect((await sendHttp(base + "/api/review?itemId=synthetic-item-one", { headers: { host: "10.53.0.2:4749", authorization: `Bearer ${jobToken}` } })).status).toBe(401);
      expect((await sendHttp(base + "/api/actions", { method: "POST", body: JSON.stringify(command), headers: {
        host: "10.53.0.2:4749", authorization: `Bearer ${jobToken}`, "x-life-os-actor": owner, "content-type": "application/json",
      } })).status).toBe(401);
    }
    for (const path of ["/api/reviews?limit=51", "/api/reviews?bucket=all&bucket=needsDecision", "/api/review?itemId=one&itemId=two", "/api/reviews?url=https%3A%2F%2Funrelated.example", "/api/review"]) {
      expect((await h.browser(path)).status).toBe(404);
    }
    expect(h.hops).toEqual({ vercel: [], gateway: [], loopback: [] }); expect(h.calls).toEqual([]);
  });

  it("preserves an intentional stale-review conflict without retrying the callback", async () => {
    const h = await harness("raw", { status: 409, code: "REVIEW_EVIDENCE_CHANGED" });
    const response = await h.browser("/api/actions", { body: command });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "REVIEW_EVIDENCE_CHANGED" });
    expect(h.calls).toEqual([{ body: command, actor: owner }]); expect(h.hops.loopback).toEqual([]);
  });
});
