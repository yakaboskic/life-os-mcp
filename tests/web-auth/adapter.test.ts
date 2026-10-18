import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import { createVercelHandler } from "../../web-app/api/index.js";
import { createWebHandler } from "../../web-app/handler.js";
import { readWebConfig, SESSION_COOKIE, SESSION_SECONDS, signCookie } from "../../web-app/auth.js";

const now = 1_800_000_000;
const env = {
  GOOGLE_WEB_CLIENT_ID: "synthetic.apps.googleusercontent.com", GOOGLE_WEB_CLIENT_SECRET: "synthetic-client-secret",
  LIFE_OS_SESSION_SECRET: "synthetic-session-secret-at-least-32-bytes", LIFE_OS_ALLOWED_EMAIL: "owner@example.com",
  LIFE_OS_PUBLIC_URL: "https://lifeos-test.vercel.app", LIFE_OS_GATEWAY_URL: "https://synthetic-123.us-central1.run.app",
  LIFE_OS_GATEWAY_TOKEN: "synthetic-gateway-token-at-least-32-bytes",
};
const config = readWebConfig(env);
const cookie = `${SESSION_COOKIE}=${signCookie({ kind: "session", sub: "synthetic-owner", email: config.allowedEmail, iat: now, exp: now + SESSION_SECONDS }, config.sessionSecret)}`;
const action = { requestId: "synthetic-action-1", action: "timer.start", input: { newTask: { title: "Synthetic café task" }, expectedTimerRevision: null } };
const actionText = JSON.stringify(action);
const headers = { host: new URL(config.publicUrl).host, cookie, origin: config.publicUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" };
const servers: Server[] = [];
type BodyMode = "raw" | "json" | "buffer" | "text" | "throws" | "restored";

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
});

async function fixture(mode: BodyMode = "raw") {
  let parsedReads = 0;
  const forwarded: Array<{ url: string; options: RequestInit }> = [];
  const handler = createVercelHandler(createWebHandler({ env, now: () => now, fetch: (async (url, options) => {
    forwarded.push({ url: String(url), options: options! });
    // The downstream action boundary expects an object. A parsed JSON string
    // containing an action must never be promoted into that action by the adapter.
    if (options?.method === "POST" && (typeof JSON.parse(String(options.body)) !== "object" || JSON.parse(String(options.body)) === null)) return Response.json({ error: "INVALID_ACTION" }, { status: 400 });
    return Response.json({ accepted: true, requestId: options?.body ? JSON.parse(String(options.body)).requestId : undefined });
  }) as typeof fetch }));
  const server = createServer(async (req, res) => {
    if (mode !== "raw") {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (mode === "restored") {
        // Mirror @vercel/node restoreBody: readableEnded stays true, while
        // read()/data/end are served by a buffered PassThrough. iterator()
        // alone would see the original ended request and miss these bytes.
        const replay = new PassThrough(), originalOn = req.on.bind(req);
        req.read = replay.read.bind(replay);
        req.on = req.addListener = ((event: string | symbol, listener: (...args: any[]) => void) => {
          if (event === "data" || event === "end") replay.on(event, listener); else originalOn(event, listener);
          return req;
        }) as IncomingMessage["on"];
        replay.end(bytes);
      }
      // Match Vercel: runtime has consumed the stream, and req.body is a lazy getter.
      Object.defineProperty(req, "body", { get() {
        parsedReads++;
        if (mode === "throws") throw new Error("Synthetic malformed platform JSON");
        if (mode === "buffer") return bytes;
        if (mode === "text") return bytes.toString("utf8");
        return JSON.parse(bytes.toString("utf8"));
      } });
    }
    await handler(req, res);
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  async function send(options: { method?: string; path?: string; headers?: Record<string, string>; chunks?: Array<string | Buffer> } = {}) {
    return new Promise<{ status: number; headers: IncomingMessage["headers"]; body: string }>((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port: (server.address() as AddressInfo).port, path: options.path ?? "/api/actions", method: options.method ?? "POST", headers: { ...headers, ...options.headers } }, res => {
        const chunks: Buffer[] = [];
        res.on("data", chunk => chunks.push(Buffer.from(chunk)));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      });
      req.on("error", reject);
      for (const chunk of options.chunks ?? [actionText]) req.write(chunk);
      req.end();
    });
  }
  return { send, forwarded, get parsedReads() { return parsedReads; } };
}

describe("Vercel Node adapter body forwarding", () => {
  it("forwards raw chunked JSON through the real adapter and authenticated handler", async () => {
    const app = await fixture();
    const result = await app.send({ chunks: [actionText.slice(0, 17), actionText.slice(17, 80), actionText.slice(80)] });
    expect(result.status).toBe(200); expect(JSON.parse(result.body)).toEqual({ accepted: true, requestId: action.requestId });
    expect(app.forwarded).toHaveLength(1);
    expect(app.forwarded[0]).toMatchObject({ url: `${config.gatewayUrl}/api/actions`, options: { method: "POST", body: actionText, headers: { authorization: `Bearer ${config.gatewayToken}`, "x-life-os-actor": config.allowedEmail } } });
    expect(result.headers["cache-control"]).toContain("no-store");
  });

  it.each(["json", "buffer"] as const)("preserves action identity after Vercel consumes the stream (%s)", async mode => {
    const app = await fixture(mode);
    const result = await app.send({ chunks: ["  " + JSON.stringify(action, null, 2) + "\n"] });
    expect(result.status).toBe(200); expect(app.parsedReads).toBe(1);
    expect(JSON.parse(String(app.forwarded[0]!.options.body))).toEqual(action);
  });

  it("prefers Vercel's restored wire bytes over its lazy parsed helper", async () => {
    const app = await fixture("restored"), text = "  " + JSON.stringify(action, null, 2) + "\n";
    const result = await app.send({ chunks: [text] });
    expect(result.status).toBe(200); expect(app.parsedReads).toBe(0);
    expect(app.forwarded[0]!.options.body).toBe(text);
  });

  it.each([
    { name: "whitespace", text: " ".repeat(70_000) + actionText },
    { name: "duplicate keys", text: '{"discarded":"' + "x".repeat(70_000) + '","discarded":""}' },
  ])("counts restored $name toward the wire-byte limit", async ({ text }) => {
    const app = await fixture("restored");
    expect(JSON.stringify(JSON.parse(text)).length).toBeLessThan(65_536);
    const result = await app.send({ chunks: [text] });
    expect(result.status).toBe(413); expect(JSON.parse(result.body).error).toBe("Action exceeds 64 KiB");
    expect(app.parsedReads).toBe(0); expect(app.forwarded).toEqual([]);
  });

  it.each(["application/json", "application/json ; charset=utf-8", "application/json; charset=UTF-8"])("does not reinterpret a parsed JSON string as an action object (%s)", async contentType => {
    const app = await fixture("json");
    const result = await app.send({ headers: { "content-type": contentType }, chunks: [JSON.stringify(actionText)] });
    expect(result.status).toBe(400);
    expect(JSON.parse(String(app.forwarded[0]!.options.body))).toBe(actionText);
  });

  it.each<{ headers: Record<string, string>; status: number }>([
    { headers: { cookie: "" }, status: 401 },
    { headers: { origin: "https://attacker.example" }, status: 403 },
    { headers: { "sec-fetch-site": "cross-site" }, status: 403 },
    { headers: { "content-type": "text/plain" }, status: 415 },
    { headers: { "content-encoding": "gzip" }, status: 415 },
    { headers: { "content-length": "70000" }, status: 413 },
  ])("rejects invalid context before accessing the platform parser: $status", async ({ status, headers: overrides }) => {
    const app = await fixture("throws");
    // The declared-size case uses a fully delivered body so the fixture's
    // simulated Vercel buffering finishes before entering the application.
    const chunks = overrides["content-length"] ? ["x".repeat(70_000)] : ["{"];
    const result = await app.send({ headers: overrides, chunks });
    expect(result.status).toBe(status); expect(app.parsedReads).toBe(0); expect(app.forwarded).toEqual([]);
  });

  it.each(["raw", "json", "restored"] as const)("returns a bounded JSON 400 for malformed input (%s)", async mode => {
    const app = await fixture(mode), result = await app.send({ chunks: ["{"] });
    expect(result.status).toBe(400); expect(JSON.parse(result.body)).toEqual({ error: "Invalid JSON" }); expect(app.forwarded).toEqual([]);
  });

  it("rejects a missing body without invoking the gateway", async () => {
    const app = await fixture(), result = await app.send({ chunks: [] });
    expect(result.status).toBe(400); expect(JSON.parse(result.body).error).toBe("Invalid JSON"); expect(app.forwarded).toEqual([]);
  });

  it.each(["raw", "json", "buffer", "restored"] as const)("enforces actual UTF-8 bytes without destroying the response socket (%s)", async mode => {
    const app = await fixture(mode), payload = JSON.stringify({ ...action, input: { title: "é".repeat(40_000) } });
    expect(payload.length).toBeLessThan(65_536); expect(Buffer.byteLength(payload)).toBeGreaterThan(65_536);
    const result = await app.send({ chunks: [payload.slice(0, 30_000), payload.slice(30_000)] });
    expect(result.status).toBe(413); expect(JSON.parse(result.body)).toEqual({ error: "Action exceeds 64 KiB" }); expect(app.forwarded).toEqual([]);
  });

  it("does not consume a parser for GET/HEAD and preserves logout cookies", async () => {
    const app = await fixture("throws");
    expect((await app.send({ method: "GET", path: "/api/data", chunks: [] })).status).toBe(200);
    const head = await app.send({ method: "HEAD", path: "/privacy", chunks: [] });
    expect(head.status).toBe(200); expect(head.body).toBe("");
    const logout = await app.send({ path: "/auth/logout", chunks: [] });
    expect(logout.status).toBe(303); expect(logout.headers.location).toBe("/"); expect(logout.headers["set-cookie"]).toHaveLength(2);
    expect(app.parsedReads).toBe(0);
  });
});
