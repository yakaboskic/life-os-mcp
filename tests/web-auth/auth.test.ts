import { describe, expect, it } from "vitest";
import { FLOW_COOKIE, SESSION_COOKIE, SESSION_SECONDS, flowCookie, newLoginFlow, readWebConfig, signCookie, type Identity, type LoginFlow, type Session } from "../../web-app/auth.js";
import { createWebHandler } from "../../web-app/handler.js";

const OWNER_EMAIL = "owner@example.com";
const NOW = 1_800_000_000;
const env = {
  GOOGLE_WEB_CLIENT_ID: "web-client.apps.googleusercontent.com", GOOGLE_WEB_CLIENT_SECRET: "fake-web-client-secret",
  LIFE_OS_SESSION_SECRET: "session-secret-for-tests-only-32-bytes", LIFE_OS_ALLOWED_EMAIL: OWNER_EMAIL,
  LIFE_OS_PUBLIC_URL: "https://life-os-test.vercel.app", LIFE_OS_GATEWAY_URL: "https://life-os-gateway-123.us-central1.run.app",
  LIFE_OS_GATEWAY_TOKEN: "gateway-secret-for-tests-only-32-bytes",
};
const config = readWebConfig(env);
function request(path: string, options: RequestInit = {}) { return new Request(`${config.publicUrl}${path}`, options); }
function signedSession(patch: Partial<Session> = {}) {
  return `${SESSION_COOKIE}=${signCookie({ kind: "session", sub: "google-owner-subject", email: OWNER_EMAIL, iat: NOW, exp: NOW + SESSION_SECONDS, ...patch }, config.sessionSecret)}`;
}
function identity(flow: LoginFlow, patch: Partial<Identity> = {}): Identity {
  return { sub: "google-owner-subject", email: OWNER_EMAIL, email_verified: true, iss: "https://accounts.google.com", aud: config.clientId, exp: NOW + 3600, iat: NOW, nonce: flow.nonce, hd: "example.com", ...patch };
}
function callback(flow: LoginFlow, suffix = "") {
  return request(`/auth/callback?code=fake-code&state=${flow.state}${suffix}`, { headers: { cookie: flowCookie(flow, config).split(";")[0]! } });
}
describe("private web sessions", () => {
  it("fails closed when setup is incomplete and serves only nonpersonal install assets", async () => {
    const handler = createWebHandler({ env: {} });
    const page = await handler(request("/")); expect(page.status).toBe(503); expect(await page.text()).toContain("Sign-in is not configured yet");
    expect((await handler(request("/api/data"))).status).toBe(503);
    const asset = await handler(request("/manifest.webmanifest")); expect(asset.status).toBe(200); expect(await asset.text()).toContain('"display":"standalone"');
  });
  it("requires one configured owner and normalizes its casing and surrounding whitespace", () => {
    expect(readWebConfig({ ...env, LIFE_OS_ALLOWED_EMAIL: "  Owner@Example.COM  " }).allowedEmail).toBe(OWNER_EMAIL);
    expect(readWebConfig({ ...env, LIFE_OS_ALLOWED_EMAIL: "other@example.com" }).allowedEmail).toBe("other@example.com");
    expect(() => readWebConfig({ ...env, LIFE_OS_SESSION_SECRET: "short" })).toThrow("32 bytes");
  });
  it.each([undefined, "", "  ", "example.com", "@example.com", "*@example.com", "owner@*", "owner@example.com,other@example.com", "owner@example.com;other@example.com", "Owner <owner@example.com>", "owner@example.com\nother@example.com", "owner..name@example.com", "owner.@example.com", "owner@-example.com", "owner@example..com", "owner@localhost", `${"a".repeat(65)}@example.com`, `owner@${"a".repeat(64)}.com`])("fails closed for an absent or invalid owner setting %s", async (allowedEmail) => {
    const settings = { ...env, LIFE_OS_ALLOWED_EMAIL: allowedEmail };
    expect(() => readWebConfig(settings)).toThrow(/LIFE_OS_ALLOWED_EMAIL/);
    let calls = 0;
    const handler = createWebHandler({ env: settings, now: () => NOW, fetch: (async () => { calls++; throw new Error("Unexpected"); }) as typeof fetch });
    expect((await handler(request("/api/data", { headers: { cookie: signedSession() } }))).status).toBe(503);
    expect((await handler(request("/auth/login"))).status).toBe(503);
    expect(calls).toBe(0);
  });
  it("checks signed sessions against the current owner setting on every request", async () => {
    let calls = 0;
    const settings = { ...env };
    const handler = createWebHandler({ env: settings, now: () => NOW, fetch: (async () => { calls++; return Response.json({ tasks: [] }); }) as typeof fetch });
    const originalCookie = signedSession();
    expect((await handler(request("/api/data", { headers: { cookie: originalCookie } }))).status).toBe(200);
    settings.LIFE_OS_ALLOWED_EMAIL = "other@example.com";
    expect((await handler(request("/api/data", { headers: { cookie: originalCookie } }))).status).toBe(401);
    expect(calls).toBe(1);
    expect((await handler(request("/api/data", { headers: { cookie: signedSession({ email: "other@example.com" }) } }))).status).toBe(200);
  });
  it("rejects tampered, expired, future, oversized-duration, duplicate and other-account cookies", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    const valid = signedSession();
    const invalid = [valid.slice(0, -1) + (valid.endsWith("A") ? "B" : "A"), signedSession({ iat: NOW - 10, exp: NOW }), signedSession({ iat: NOW + 60, exp: NOW + 3600 }), signedSession({ exp: NOW + SESSION_SECONDS + 1 }), signedSession({ email: "other@example.com" }), `${valid}; ${valid}`];
    for (const cookie of invalid) expect((await handler(request("/api/data", { headers: { cookie } }))).status).toBe(401);
  });
  it("serves the private Starfleet dashboard only after a valid session with a script hash policy", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    expect(await (await handler(request("/"))).text()).toContain("Sign in with Google");
    const page = await handler(request("/", { headers: { cookie: signedSession() } }));
    const html = await page.text(); expect(html).toContain("/auth/logout"); expect(html).toContain("/api/data");
    expect(page.headers.get("content-security-policy")).toContain("script-src 'sha256-");
    expect(page.headers.get("content-security-policy")).not.toContain("script-src 'unsafe-inline'");
    expect(page.headers.get("cache-control")).toContain("no-store"); expect(page.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  });
  it("rejects a preview or unconfigured host even with a valid production session", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    expect((await handler(new Request("https://different.vercel.app/", { headers: { cookie: signedSession() } }))).status).toBe(421);
  });
});

describe("Google web OAuth", () => {
  it("uses PKCE, state, nonce and identity-only scopes and ignores redirect destinations", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    const result = await handler(request("/auth/login?next=https://attacker.example"));
    expect(result.status).toBe(303);
    const location = new URL(result.headers.get("location")!);
    expect(location.origin).toBe("https://accounts.google.com"); expect(location.searchParams.get("redirect_uri")).toBe(`${config.publicUrl}/auth/callback`);
    expect(location.searchParams.get("scope")).toBe("openid email profile"); expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("state")!.length).toBeGreaterThanOrEqual(43); expect(location.searchParams.get("nonce")!.length).toBeGreaterThanOrEqual(43);
    expect(result.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax"); expect(result.headers.get("set-cookie")).toContain(FLOW_COOKIE);
  });
  it("rejects absent, mismatched, duplicated or expired state before contacting Google", async () => {
    let calls = 0; const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => { calls++; throw new Error("Unexpected"); }) as typeof fetch });
    const flow = newLoginFlow(NOW);
    expect((await handler(request(`/auth/callback?code=x&state=${flow.state}`))).status).toBe(403);
    expect((await handler(callback(flow, "&state=duplicate"))).status).toBe(403);
    expect((await handler(request("/auth/callback?code=x&state=wrong", { headers: { cookie: flowCookie(flow, config).split(";")[0]! } }))).status).toBe(403);
    const expired = { ...flow, iat: NOW - 1000, exp: NOW - 1 };
    expect((await handler(callback(expired))).status).toBe(403);
    expect(calls).toBe(0);
  });
  it.each([
    { email: "other@example.com" }, { email: "owner@elsewhere.test" }, { email_verified: false },
    { iss: "https://attacker.example" }, { aud: "other-client" }, { nonce: "wrong-nonce" }, { exp: NOW - 1 },
  ])("rejects an invalid verified identity claim %o", async (patch) => {
    const flow = newLoginFlow(NOW);
    const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => Response.json({ id_token: "fake" })) as typeof fetch, verifyIdToken: async () => identity(flow, patch) });
    const result = await handler(callback(flow)); expect(result.status).toBe(403);
    expect(result.headers.getSetCookie().find((value) => value.startsWith(SESSION_COOKIE))).toContain("Max-Age=0");
  });
  it("exchanges the authorization code server-side and issues a bounded host-only session", async () => {
    const flow = newLoginFlow(NOW); let exchangeBody: URLSearchParams | undefined;
    const handler = createWebHandler({ env, now: () => NOW, fetch: (async (url, options) => { expect(String(url)).toBe("https://oauth2.googleapis.com/token"); exchangeBody = options!.body as URLSearchParams; return Response.json({ id_token: "fake", access_token: "must-never-reach-browser" }); }) as typeof fetch, verifyIdToken: async () => identity(flow) });
    const result = await handler(callback(flow, "&next=https://attacker.example"));
    expect(result.status).toBe(303); expect(result.headers.get("location")).toBe("/");
    expect(exchangeBody?.get("code_verifier")).toBe(flow.verifier); expect(exchangeBody?.get("client_secret")).toBe(config.clientSecret);
    const session = result.headers.getSetCookie().find((value) => value.startsWith(SESSION_COOKIE))!;
    expect(session).toContain(`Max-Age=${SESSION_SECONDS}`); expect(session).not.toContain("Domain="); expect(session).not.toContain("must-never");
    expect(result.headers.getSetCookie().find((value) => value.startsWith(FLOW_COOKIE))).toContain("Max-Age=0");
  });
});

describe("read-only backend proxy and logout", () => {
  it("sends only the machine token to a fixed gateway and never caches or exposes it", async () => {
    let sent: RequestInit | undefined;
    const handler = createWebHandler({ env, now: () => NOW, fetch: (async (url, options) => { expect(String(url)).toBe(`${config.gatewayUrl}/api/data`); sent = options; return Response.json({ tasks: [{ title: "Private task" }] }, { headers: { "cache-control": "public, max-age=600", "set-cookie": "evil=1" } }); }) as typeof fetch });
    const result = await handler(request("/api/data", { headers: { cookie: signedSession(), authorization: "Bearer browser-token", origin: config.publicUrl } }));
    expect(result.status).toBe(200); expect((sent!.headers as Record<string, string>).authorization).toBe(`Bearer ${config.gatewayToken}`); expect((sent!.headers as Record<string, string>).cookie).toBeUndefined();
    expect(result.headers.get("set-cookie")).toBeNull(); expect(result.headers.get("cache-control")).toContain("no-store"); expect(result.headers.get("vercel-cdn-cache-control")).toBe("no-store");
    expect(await result.text()).not.toContain(config.gatewayToken);
  });
  it("rejects write methods, unknown routes, query forwarding and cross-site requests without calling the gateway", async () => {
    let calls = 0; const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
    for (const [path, method, status] of [["/api/data", "POST", 405], ["/api/data?url=https://attacker.example", "GET", 404], ["/v1/jobs", "GET", 404]] as const) expect((await handler(request(path, { method, headers: { cookie: signedSession() } }))).status).toBe(status);
    expect((await handler(request("/api/data", { headers: { cookie: signedSession(), origin: "https://attacker.example" } }))).status).toBe(403);
    expect(calls).toBe(0);
  });
  it("rejects gateway redirects, errors and non-JSON responses without forwarding body details", async () => {
    for (const upstream of [new Response("secret traceback", { status: 500 }), new Response("<h1>Not JSON</h1>", { headers: { "content-type": "text/html" } }), Response.redirect("https://attacker.example")]) {
      const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => upstream) as typeof fetch });
      const result = await handler(request("/api/data", { headers: { cookie: signedSession() } })); expect(result.status).toBe(502); expect(await result.text()).not.toContain("secret traceback");
    }
  });
  it("requires same-origin POST logout and clears both cookies and browser storage", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    expect((await handler(request("/auth/logout"))).status).toBe(405);
    expect((await handler(request("/auth/logout", { method: "POST", headers: { origin: "https://attacker.example" } }))).status).toBe(403);
    const result = await handler(request("/auth/logout", { method: "POST", headers: { origin: config.publicUrl, cookie: signedSession() } }));
    expect(result.status).toBe(303); expect(result.headers.getSetCookie()).toHaveLength(2); expect(result.headers.getSetCookie().every((value) => value.includes("Max-Age=0"))).toBe(true);
    expect(result.headers.get("clear-site-data")).toContain('"storage"');
  });
});

describe("authenticated browser actions", () => {
  const body = JSON.stringify({ requestId: "request-1", action: "task.update", input: { id: "t1", status: "done" } });
  const headers = () => ({ cookie: signedSession(), origin: config.publicUrl, "sec-fetch-site": "same-origin", "content-type": "application/json" });
  it("overwrites spoofed actor and credentials and preserves a conflict response", async () => {
    let calls = 0;
    const handler = createWebHandler({ env, now: () => NOW, fetch: (async (url, options) => {
      calls++; expect(String(url)).toBe(`${config.gatewayUrl}/api/actions`); expect(options?.method).toBe("POST"); expect(options?.body).toBe(body);
      expect(options?.headers).toEqual({ authorization: `Bearer ${config.gatewayToken}`, accept: "application/json", "content-type": "application/json", "x-life-os-actor": OWNER_EMAIL });
      return Response.json({ error: "REVISION_CONFLICT" }, { status: 409, headers: { "set-cookie": "not-forwarded=1" } });
    }) as typeof fetch });
    const result = await handler(request("/api/actions", { method: "POST", headers: { ...headers(), "x-life-os-actor": "attacker@example.com", authorization: "Bearer browser" }, body }));
    expect(result.status).toBe(409); expect(await result.json()).toEqual({ error: "REVISION_CONFLICT" }); expect(result.headers.get("set-cookie")).toBeNull(); expect(result.headers.get("cache-control")).toContain("no-store"); expect(calls).toBe(1);
  });
  it.each([{}, { origin: config.publicUrl }, { origin: "https://attacker.example", "sec-fetch-site": "same-origin" }, { origin: config.publicUrl, "sec-fetch-site": "same-site" }, { origin: config.publicUrl, "sec-fetch-site": "cross-site" }, { origin: config.publicUrl, "sec-fetch-site": "none" }])("rejects incomplete or cross-origin write context %o", async (context) => {
    let calls = 0; const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
    const result = await handler(request("/api/actions", { method: "POST", headers: { cookie: signedSession(), "content-type": "application/json", ...context }, body }));
    expect(result.status).toBe(403); expect(calls).toBe(0);
  });
  it("requires a valid session before accepting an action or exposing automation", async () => {
    const handler = createWebHandler({ env, now: () => NOW });
    expect((await handler(request("/api/actions", { method: "POST", headers: { ...headers(), cookie: "" }, body }))).status).toBe(401);
    expect((await handler(request("/api/automation"))).status).toBe(401);
  });
  it.each([
    { body: "{", status: 400 },
    { body: '"' + "a".repeat(65_536) + '"', status: 413 },
    { body: "{}", type: "text/plain", status: 415 },
    { body: "{}", type: "application/json-patch+json", status: 415 },
    { body: "{}", encoding: "gzip", status: 415 },
  ])("rejects malformed, oversized and incorrectly typed actions: $status", async (input) => {
    let calls = 0; const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => { calls++; return Response.json({}); }) as typeof fetch });
    const extra = { ...headers(), "content-type": input.type ?? "application/json", ...(input.encoding ? { "content-encoding": input.encoding } : {}) };
    expect((await handler(request("/api/actions", { method: "POST", headers: extra, body: input.body }))).status).toBe(input.status); expect(calls).toBe(0);
  });
  it.each([200, 202, 400, 401, 409, 503])("preserves bounded JSON response status %i", async (status) => {
    const handler = createWebHandler({ env, now: () => NOW, fetch: (async () => Response.json({ status }, { status })) as typeof fetch });
    const result = await handler(request("/api/actions", { method: "POST", headers: headers(), body }));
    expect(result.status).toBe(status); expect(await result.json()).toEqual({ status });
  });
  it("reads automation but never turns GET actions or query aliases into writes", async () => {
    let calls = 0; const handler = createWebHandler({ env, now: () => NOW, fetch: (async (url, options) => { calls++; expect(String(url)).toBe(`${config.gatewayUrl}/api/automation`); expect(options?.method).toBe("GET"); return Response.json({ runs: [] }); }) as typeof fetch });
    expect((await handler(request("/api/automation", { headers: headers() }))).status).toBe(200);
    expect((await handler(request("/api/actions", { headers: headers() }))).status).toBe(405);
    expect((await handler(request("/api/actions?x=1", { method: "POST", headers: headers(), body }))).status).toBe(404);
    expect(calls).toBe(1);
  });
});
