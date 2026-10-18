import { createServer, type IncomingMessage } from "node:http";
import { equalToken } from "./security.js";

export interface PrivateWebBridgeOptions {
  executeAction?: (body: unknown, actor: string) => Promise<unknown>;
}
const MAX_ACTION_BYTES = 64 * 1024;
const RELAY_STATUSES = new Set([200, 201, 202, 400, 401, 403, 404, 409, 413, 415, 429, 503]);
function fail(message: string, status: number): Error & { status: number } { return Object.assign(new Error(message), { status }); }
function actionBody(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"] ?? "") || req.headers["content-encoding"]) return Promise.reject(fail("Expected application/json", 415));
  const declared = req.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_ACTION_BYTES)) return Promise.reject(fail("Action exceeds 64 KiB", 413));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let bytes = 0, finished = false;
    const finish = (error?: Error, value?: unknown) => { if (finished) return; finished = true; clearTimeout(timer); if (error) reject(error); else resolve(value); };
    const timer = setTimeout(() => finish(fail("Request timed out", 400)), 10_000);
    req.on("data", (chunk: Buffer) => { if (finished) return; bytes += chunk.length; if (bytes > MAX_ACTION_BYTES) { finish(fail("Action exceeds 64 KiB", 413)); return; } chunks.push(chunk); });
    req.on("end", () => { if (finished) return; try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { finish(fail("Invalid JSON", 400)); } });
    req.on("error", () => finish(fail("Invalid request", 400)));
    req.on("aborted", () => finish(fail("Invalid request", 400)));
  });
}

/** Dedicated private gateway capability. Writes call the authoritative daemon, never an unauthenticated local HTTP route. */
export function createPrivateWebBridge(token: string, privateHost: string, webPort: number, options: PrivateWebBridgeOptions = {}) {
  if (token.length < 32 || !/^10\.53\.0\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(privateHost)) throw new Error("Private web bridge requires a dedicated token and LifeOS VPC address");
  const allowed = new Set(["/api/data", "/api/triage", "/api/jobs", "/api/automation"]);
  const server = createServer(async (req, res) => {
    const reply = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).end(JSON.stringify(value));
    };
    if (req.headers.origin || req.headers.host !== `${privateHost}:4749` || !equalToken(req.headers.authorization ?? "", `Bearer ${token}`)) { reply(401, { error: "Unauthorized" }); return; }
    const isAction = req.method === "POST" && req.url === "/api/actions";
    if (!isAction && (req.method !== "GET" || !allowed.has(req.url ?? "") || req.headers["transfer-encoding"] || Number(req.headers["content-length"] ?? 0) !== 0)) { reply(404, { error: "Not found" }); return; }
    if (isAction) {
      const actor = req.headers["x-life-os-actor"];
      if (typeof actor !== "string" || actor.length > 254 || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9.-]+\.[a-z0-9-]+$/.test(actor)) { reply(400, { error: "Invalid action actor" }); return; }
      if (!options.executeAction) { reply(503, { error: "Interactive actions are not available on this release" }); return; }
      try { reply(200, await options.executeAction(await actionBody(req), actor)); }
      catch (error) {
        req.resume();
        const status = (error as { status?: number }).status;
        const known = typeof status === "number" && RELAY_STATUSES.has(status) && status >= 400;
        const code = (error as { code?: unknown }).code;
        const safeCode = known && error instanceof Error && typeof code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : undefined;
        reply(known ? status : 503, { error: known && error instanceof Error ? error.message : "LifeOS unavailable", ...(safeCode ? { code: safeCode } : {}) });
      }
      return;
    }
    try {
      const upstream = await fetch(`http://127.0.0.1:${webPort}${req.url}`, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!RELAY_STATUSES.has(upstream.status) || !upstream.headers.get("content-type")?.startsWith("application/json")) { await upstream.body?.cancel(); reply(502, { error: "LifeOS unavailable" }); return; }
      const reader = upstream.body?.getReader(); if (!reader) throw new Error("Missing response");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 5 * 1024 * 1024) throw new Error("Response limit"); chunks.push(value); } }
      finally { await reader.cancel(); }
      const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (req.url === "/api/data" && upstream.status === 200) {
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid snapshot");
        const capabilities = data.capabilities && typeof data.capabilities === "object" && !Array.isArray(data.capabilities) ? data.capabilities : {};
        // The loopback dashboard stays read-only. Only this authenticated path
        // has the authoritative callback needed to advertise interactive actions.
        const actions = typeof options.executeAction === "function";
        data.capabilities = { ...capabilities, actions, projectCreate: actions };
      }
      reply(upstream.status, data);
    } catch { reply(503, { error: "LifeOS unavailable" }); }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 5_000; server.maxHeadersCount = 32;
  return server;
}
