import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { OAuth2Client } from "google-auth-library";

export const SESSION_COOKIE = "__Host-lifeos_session";
export const FLOW_COOKIE = "__Host-lifeos_oauth";
export const SESSION_SECONDS = 8 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
export interface WebConfig { clientId: string; clientSecret: string; sessionSecret: string; allowedEmail: string; publicUrl: string; gatewayUrl: string; gatewayToken: string }
export interface Identity { sub: string; email: string; email_verified: boolean; iss: string; aud: string; exp: number; iat: number; nonce?: string; hd?: string }
export interface Session { kind: "session"; sub: string; email: string; iat: number; exp: number }
export interface LoginFlow { kind: "oauth"; state: string; nonce: string; verifier: string; iat: number; exp: number }

function required(env: NodeJS.ProcessEnv, key: string): string { const value = env[key]?.trim(); if (!value) throw new Error(`Missing ${key}`); return value; }
function allowedEmail(env: NodeJS.ProcessEnv): string {
  const email = required(env, "LIFE_OS_ALLOWED_EMAIL").toLowerCase();
  const [local, domain] = email.split("@");
  // A single Google account address, never a domain, pattern or address list.
  if (email.length > 254 || !local || local.length > 64 || local.endsWith(".") || local.includes("..") || !domain || domain.split(".").some((label) => label.length > 63) || !/^[a-z0-9][a-z0-9._+-]*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)) throw new Error("LIFE_OS_ALLOWED_EMAIL must be one valid email address");
  return email;
}
export function readWebConfig(env: NodeJS.ProcessEnv): WebConfig {
  const config: WebConfig = { clientId: required(env, "GOOGLE_WEB_CLIENT_ID"), clientSecret: required(env, "GOOGLE_WEB_CLIENT_SECRET"), sessionSecret: required(env, "LIFE_OS_SESSION_SECRET"), allowedEmail: allowedEmail(env), publicUrl: required(env, "LIFE_OS_PUBLIC_URL"), gatewayUrl: required(env, "LIFE_OS_GATEWAY_URL"), gatewayToken: required(env, "LIFE_OS_GATEWAY_TOKEN") };
  if (Buffer.byteLength(config.sessionSecret) < 32 || Buffer.byteLength(config.gatewayToken) < 32) throw new Error("Session and gateway secrets must each contain at least 32 bytes");
  const publicUrl = new URL(config.publicUrl);
  const gatewayUrl = new URL(config.gatewayUrl);
  if (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash || publicUrl.port) throw new Error("LIFE_OS_PUBLIC_URL must be an HTTPS origin");
  if (gatewayUrl.protocol !== "https:" || !gatewayUrl.hostname.endsWith(".run.app") || gatewayUrl.username || gatewayUrl.password || gatewayUrl.pathname !== "/" || gatewayUrl.search || gatewayUrl.hash || gatewayUrl.port) throw new Error("LIFE_OS_GATEWAY_URL must be an HTTPS Cloud Run origin");
  config.publicUrl = publicUrl.origin; config.gatewayUrl = gatewayUrl.origin;
  return config;
}
function mac(encoded: string, secret: string): string { return createHmac("sha256", secret).update(encoded).digest("base64url"); }
export function signCookie(payload: Session | LoginFlow, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${mac(encoded, secret)}`;
}
function constantEqual(a: string, b: string): boolean { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
function readSigned(cookie: string | undefined, secret: string): unknown {
  if (!cookie || cookie.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cookie)) return undefined;
  const [encoded, signature] = cookie.split(".");
  if (!encoded || !signature || !constantEqual(signature, mac(encoded, secret))) return undefined;
  try { return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return undefined; }
}
export function cookies(header: string | null): Map<string, string> {
  const output = new Map<string, string>();
  if (!header || header.length > 16_384) return output;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("="); if (index < 1) continue;
    const name = pair.slice(0, index).trim(); const value = pair.slice(index + 1).trim();
    if (output.has(name)) output.set(name, ""); else output.set(name, value);
  }
  return output;
}
function fresh(value: { iat?: unknown; exp?: unknown }, now: number, maxSeconds: number): boolean {
  return typeof value.iat === "number" && Number.isInteger(value.iat) && typeof value.exp === "number" && Number.isInteger(value.exp) && value.iat <= now + 30 && value.exp > now && value.exp > value.iat && value.exp - value.iat <= maxSeconds;
}
export function readSession(value: string | undefined, config: WebConfig, now: number): Session | undefined {
  const session = readSigned(value, config.sessionSecret) as Partial<Session> | undefined;
  if (!session || session.kind !== "session" || !fresh(session, now, SESSION_SECONDS) || typeof session.sub !== "string" || !session.sub || session.email !== config.allowedEmail) return undefined;
  return session as Session;
}
export function readLoginFlow(value: string | undefined, config: WebConfig, now: number): LoginFlow | undefined {
  const flow = readSigned(value, config.sessionSecret) as Partial<LoginFlow> | undefined;
  if (!flow || flow.kind !== "oauth" || !fresh(flow, now, FLOW_SECONDS) || ![flow.state, flow.nonce, flow.verifier].every((item) => typeof item === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(item))) return undefined;
  return flow as LoginFlow;
}
export function newLoginFlow(now: number): LoginFlow {
  return { kind: "oauth", state: randomBytes(32).toString("base64url"), nonce: randomBytes(32).toString("base64url"), verifier: randomBytes(48).toString("base64url"), iat: now, exp: now + FLOW_SECONDS };
}
export function loginUrl(config: WebConfig, flow: LoginFlow): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.publicUrl}/auth/callback`, response_type: "code", scope: "openid email profile", state: flow.state, nonce: flow.nonce, code_challenge: createHash("sha256").update(flow.verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account", login_hint: config.allowedEmail }).toString();
  return url.toString();
}
export function validateIdentity(identity: Identity, config: WebConfig, flow: LoginFlow, now: number): void {
  if (!["accounts.google.com", "https://accounts.google.com"].includes(identity.iss) || identity.aud !== config.clientId || identity.email !== config.allowedEmail || identity.email_verified !== true || typeof identity.sub !== "string" || !identity.sub || !Number.isFinite(identity.exp) || identity.exp <= now || !Number.isFinite(identity.iat) || identity.iat > now + 30 || typeof identity.nonce !== "string" || !constantEqual(identity.nonce, flow.nonce)) throw new Error("GOOGLE_IDENTITY_REJECTED");
}
export async function verifyGoogleIdToken(token: string, audience: string): Promise<Identity> {
  const ticket = await new OAuth2Client(audience).verifyIdToken({ idToken: token, audience });
  const payload = ticket.getPayload(); if (!payload) throw new Error("GOOGLE_IDENTITY_REJECTED");
  return payload as Identity;
}
export function cookie(name: string, value: string, maxAge: number): string { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
export function sessionCookie(identity: Identity, config: WebConfig, now: number): string { return cookie(SESSION_COOKIE, signCookie({ kind: "session", sub: identity.sub, email: identity.email, iat: now, exp: now + SESSION_SECONDS }, config.sessionSecret), SESSION_SECONDS); }
export function flowCookie(flow: LoginFlow, config: WebConfig): string { return cookie(FLOW_COOKIE, signCookie(flow, config.sessionSecret), FLOW_SECONDS); }
export const clearFlowCookie = () => cookie(FLOW_COOKIE, "", 0);
export const clearSessionCookie = () => cookie(SESSION_COOKIE, "", 0);
