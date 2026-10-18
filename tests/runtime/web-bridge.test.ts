import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createPrivateWebBridge, type PrivateWebBridgeOptions } from "../../src/runtime/web-bridge.js";

const token = "t".repeat(48), host = "10.53.0.2";
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }))); });
async function listen(server: Server) { servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); return (server.address() as { port: number }).port; }
async function fixture(options: PrivateWebBridgeOptions = {}) { return `http://127.0.0.1:${await listen(createPrivateWebBridge(token, host, 1, options))}`; }
const headers = () => ({ host: `${host}:4749`, authorization: `Bearer ${token}`, "x-life-os-actor": "owner@example.com", "content-type": "application/json" });
const body = JSON.stringify({ requestId: "r1", action: "task.update", input: { id: "t1" } });
// Node fetch replaces Host; raw HTTP lets this fixture exercise the private Host boundary.
function send(url: string, options: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: options.method ?? "GET", headers: options.headers as Record<string, string> }, res => {
      const chunks: Buffer[] = []; res.on("data", chunk => chunks.push(chunk)); res.on("end", () => {
        const headers = new Headers(); for (const [key, value] of Object.entries(res.headers)) if (typeof value === "string") headers.set(key, value);
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers }));
      });
    });
    req.on("error", reject); req.end(options.body as string | undefined);
  });
}

describe("private browser action capability", () => {
  it("calls only the daemon callback with decoded JSON and validated actor", async () => {
    const calls: unknown[] = [];
    const base = await fixture({ executeAction: async (input, actor) => { calls.push({ input, actor }); return { ok: true }; } });
    const result = await send(`${base}/api/actions`, { method: "POST", headers: headers(), body });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ ok: true }); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual([{ input: JSON.parse(body), actor: "owner@example.com" }]);
  });
  it("rejects missing token, wrong host and browser origin before invoking the callback", async () => {
    let calls = 0; const base = await fixture({ executeAction: async () => { calls++; return {}; } });
    for (const changed of [{ authorization: "" }, { host: "public.example.com" }, { origin: "https://life-os.example.com" }]) {
      expect((await send(`${base}/api/actions`, { method: "POST", headers: { ...headers(), ...changed }, body })).status).toBe(401);
    }
    expect(calls).toBe(0);
  });
  it("rejects unknown routes, queries, invalid actors and bodies without side effects", async () => {
    let calls = 0; const base = await fixture({ executeAction: async () => { calls++; return {}; } });
    for (const path of ["/mcp", "/v1/admin/resume", "/api/actions?anything=1", "/api/data"]) expect((await send(base + path, { method: "POST", headers: headers(), body })).status).toBe(404);
    expect((await send(`${base}/api/actions`, { method: "POST", headers: { ...headers(), "x-life-os-actor": "a@example.com,b@example.com" }, body })).status).toBe(400);
    expect((await send(`${base}/api/actions`, { method: "POST", headers: headers(), body: "{" })).status).toBe(400);
    expect((await send(`${base}/api/actions`, { method: "POST", headers: headers(), body: '"' + "x".repeat(65_536) + '"' })).status).toBe(413);
    expect((await send(`${base}/api/actions`, { method: "POST", headers: { ...headers(), "content-type": "text/plain" }, body })).status).toBe(415);
    expect(calls).toBe(0);
  });
  it("fails closed when an older daemon has not enabled its action callback", async () => {
    const base = await fixture(); expect((await send(`${base}/api/actions`, { method: "POST", headers: headers(), body })).status).toBe(503);
  });
  it.each([400, 401, 409, 503])("preserves intentional application status %i", async (status) => {
    const base = await fixture({ executeAction: async () => { throw Object.assign(new Error("ACTION_REJECTED"), { status }); } });
    const result = await send(`${base}/api/actions`, { method: "POST", headers: headers(), body });
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ error: "ACTION_REJECTED" });
  });
  it("hides unexpected callback exceptions", async () => {
    const base = await fixture({ executeAction: async () => { throw new Error("secret filesystem path"); } });
    const result = await send(`${base}/api/actions`, { method: "POST", headers: headers(), body }); expect(result.status).toBe(503); expect(await result.text()).not.toContain("secret");
  });
  it("continues to proxy only safe read routes, including automation", async () => {
    const upstream = createServer((req, res) => { expect(req.method).toBe("GET"); expect(req.url).toBe("/api/automation"); res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ runs: [] })); });
    const webPort = await listen(upstream);
    const base = `http://127.0.0.1:${await listen(createPrivateWebBridge(token, host, webPort))}`;
    const result = await send(`${base}/api/automation`, { headers: headers() }); expect(result.status).toBe(200); expect(await result.json()).toEqual({ runs: [] });
  });
  it.each([true, false])("advertises actions only when this authenticated listener has its callback: %s", async (enabled) => {
    const upstream = createServer((_req, res) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ tasks: [], capabilities: { actions: !enabled, automation: true } })));
    const webPort = await listen(upstream);
    const options = enabled ? { executeAction: async () => ({ ok: true }) } : {};
    const base = `http://127.0.0.1:${await listen(createPrivateWebBridge(token, host, webPort, options))}`;
    const result = await send(`${base}/api/data`, { headers: headers() });
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ tasks: [], capabilities: { actions: enabled, automation: true } });
  });
});
