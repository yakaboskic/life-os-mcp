import { createHash } from "node:crypto";
import { PORTAL_HTML } from "../src/web/page.js";
import { PWA_ASSETS } from "../src/web/pwa.js";
import { FLOW_COOKIE, SESSION_COOKIE, clearFlowCookie, clearSessionCookie, cookies, flowCookie, loginUrl, newLoginFlow, readLoginFlow, readSession, readWebConfig, sessionCookie, validateIdentity, verifyGoogleIdToken, type Identity, type WebConfig } from "./auth.js";

export interface WebDependencies { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number; verifyIdToken?: (token: string, audience: string) => Promise<Identity> }
const API_PATHS = new Set(["/api/data", "/api/triage", "/api/jobs"]);
const PRIVATE_HTML = PORTAL_HTML.replace("</body>", '<form method="post" action="/auth/logout" style="position:fixed;right:20px;bottom:10px;z-index:100"><button type="submit" style="color:#8da9b5;background:#101c25;border:1px solid #3b6474;padding:6px 12px;cursor:pointer">Sign out</button></form></body>');
const SCRIPT_HASHES = [...PRIVATE_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => `'sha256-${createHash("sha256").update(match[1]!).digest("base64")}'`).join(" ");
const CSP = `default-src 'none'; script-src ${SCRIPT_HASHES || "'none'"}; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
function response(body: string | Buffer, status = 200, type = "text/html; charset=utf-8", extra: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), { status, headers: { "content-type": type, "cache-control": "private, no-store, max-age=0", "cdn-cache-control": "no-store", "vercel-cdn-cache-control": "no-store", "pragma": "no-cache", "expires": "0", "vary": "Cookie", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "content-security-policy": CSP, "strict-transport-security": "max-age=31536000; includeSubDomains", ...extra } });
}
function json(body: unknown, status: number): Response { return response(JSON.stringify(body), status, "application/json; charset=utf-8"); }
function redirect(location: string): Response { return response("", 303, "text/plain", { location }); }
function escape(text: string): string { return text.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[value]!); }
function loginPage(message = "Your private operations console.", enabled = true): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#050a0f"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png"><title>LifeOS · Access</title><style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050a0f;color:#e2f4f4;font:16px/1.6 system-ui,sans-serif;padding:28px}main{width:min(100%,460px);border:1px solid #3b6474;border-top:3px solid #71e1ed;padding:32px;background:#101c25}.eyebrow{font-size:11px;letter-spacing:.2em;color:#e7b16b}h1{font-size:32px;letter-spacing:.05em;font-weight:500}p{color:#8da9b5}a{display:inline-block;background:#71e1ed;color:#050a0f;text-decoration:none;padding:12px 20px;margin-top:12px}a:focus-visible{outline:2px solid #e7b16b;outline-offset:5px}</style></head><body><main><span class="eyebrow">PERSONAL SYSTEMS · SECURE ACCESS</span><h1>LifeOS</h1><p>${escape(message)}</p>${enabled ? '<a href="/auth/login">Sign in with Google</a>' : '<p>Sign-in is not configured yet. The dashboard will stay private until setup is complete.</p>'}</main></body></html>`;
}
async function limitedJson(upstream: Response): Promise<unknown> {
  if (!upstream.headers.get("content-type")?.toLowerCase().includes("application/json")) throw new Error("INVALID_GATEWAY_RESPONSE");
  if (Number(upstream.headers.get("content-length")) > 5_000_000) throw new Error("GATEWAY_RESPONSE_TOO_LARGE");
  const reader = upstream.body?.getReader(); if (!reader) throw new Error("INVALID_GATEWAY_RESPONSE");
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 5_000_000) throw new Error("GATEWAY_RESPONSE_TOO_LARGE"); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createWebHandler(dependencies: WebDependencies = {}): (request: Request) => Promise<Response> {
  const env = dependencies.env ?? process.env;
  const requestUpstream = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => Math.floor(Date.now() / 1000));
  const verifyIdToken = dependencies.verifyIdToken ?? verifyGoogleIdToken;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const asset = PWA_ASSETS[url.pathname];
    // These assets contain no account data and can install before sign-in.
    if (asset && request.method === "GET" && !url.search) return response(asset.body, 200, asset.contentType, url.pathname === "/service-worker.js" ? { "service-worker-allowed": "/" } : {});
    let config: WebConfig;
    try { config = readWebConfig(env); }
    catch { return API_PATHS.has(url.pathname) ? json({ error: "Sign-in is not configured" }, 503) : response(loginPage("LifeOS setup is in progress.", false), 503); }
    if (url.origin !== config.publicUrl) return response("Use the configured LifeOS address.", 421, "text/plain; charset=utf-8");
    if (url.pathname === "/auth/login" && request.method === "GET") {
      const flow = newLoginFlow(now());
      const result = redirect(loginUrl(config, flow)); result.headers.append("set-cookie", flowCookie(flow, config)); return result;
    }
    const jar = cookies(request.headers.get("cookie"));
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const failure = () => { const result = response(loginPage("Sign-in could not be verified. Use your allowlisted Google account and try again."), 403); result.headers.append("set-cookie", clearFlowCookie()); result.headers.append("set-cookie", clearSessionCookie()); return result; };
      const flow = readLoginFlow(jar.get(FLOW_COOKIE), config, now());
      const code = url.searchParams.get("code");
      if (!flow || url.searchParams.getAll("state").length !== 1 || url.searchParams.get("state") !== flow.state || url.searchParams.getAll("code").length !== 1 || !code || code.length > 4096 || url.searchParams.has("error")) return failure();
      try {
        const tokenResponse = await requestUpstream("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: `${config.publicUrl}/auth/callback`, code_verifier: flow.verifier }), signal: AbortSignal.timeout(15_000), redirect: "error" });
        if (!tokenResponse.ok) return failure();
        const tokens = await limitedJson(tokenResponse) as { id_token?: unknown };
        if (typeof tokens.id_token !== "string") return failure();
        const identity = await verifyIdToken(tokens.id_token, config.clientId);
        validateIdentity(identity, config, flow, now());
        const result = redirect("/"); result.headers.append("set-cookie", clearFlowCookie()); result.headers.append("set-cookie", sessionCookie(identity, config, now())); return result;
      } catch { return failure(); }
    }
    const session = readSession(jar.get(SESSION_COOKIE), config, now());
    if (url.pathname === "/auth/logout") {
      if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
      if (request.headers.get("origin") !== config.publicUrl || request.headers.get("sec-fetch-site") === "cross-site") return json({ error: "Invalid request origin" }, 403);
      const result = redirect("/"); result.headers.append("set-cookie", clearSessionCookie()); result.headers.append("set-cookie", clearFlowCookie()); result.headers.set("clear-site-data", '"cache", "storage"'); return result;
    }
    if (!session) return API_PATHS.has(url.pathname) ? json({ error: "Sign in required", loginUrl: "/auth/login" }, 401) : response(loginPage(), 200);
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    if (url.pathname === "/" && !url.search) return response(PRIVATE_HTML);
    if (API_PATHS.has(url.pathname) && !url.search) {
      if (request.headers.get("sec-fetch-site") === "cross-site" || (request.headers.has("origin") && request.headers.get("origin") !== config.publicUrl)) return json({ error: "Invalid request origin" }, 403);
      try {
        const upstream = await requestUpstream(`${config.gatewayUrl}${url.pathname}`, { method: "GET", headers: { authorization: `Bearer ${config.gatewayToken}`, accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
        if (!upstream.ok) return json({ error: "LifeOS is temporarily unavailable" }, 502);
        return json(await limitedJson(upstream), 200);
      } catch { return json({ error: "LifeOS is temporarily unavailable" }, 502); }
    }
    return json({ error: "Not found" }, 404);
  };
}
