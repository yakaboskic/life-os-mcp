import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";

export function machineToken(env:NodeJS.ProcessEnv, kind:"INTERACTIVE"|"JOB"):string {
  const token = env[`LIFE_OS_${kind}_TOKEN_FILE`] ? readFileSync(env[`LIFE_OS_${kind}_TOKEN_FILE`]!,"utf8").trim() : env[`LIFE_OS_${kind}_TOKEN`]?.trim();
  if (!token || token.length < 32) throw new Error(`Configure LIFE_OS_${kind}_TOKEN_FILE with a random token of at least 32 characters.`);
  return token;
}
export function equalToken(actual:string,expected:string):boolean {
  const a=Buffer.from(actual), b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function safeHost(req:IncomingMessage):boolean {
  const host=req.headers.host;
  return !!host && /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host);
}
export function safeBrowserRequest(req:IncomingMessage):boolean {
  if (!safeHost(req)) return false;
  if (req.headers["sec-fetch-site"]==="cross-site") return false;
  return !req.headers.origin || req.headers.origin===`http://${req.headers.host}`;
}
export async function jsonBody(req:IncomingMessage):Promise<any> {
  if (!String(req.headers["content-type"]??"").startsWith("application/json")) throw Object.assign(new Error("Expected application/json"),{status:415});
  const chunks:Buffer[]=[]; let bytes=0;
  for await (const chunk of req) { bytes+=chunk.length; if(bytes>1024*1024) throw Object.assign(new Error("Body exceeds 1 MiB"),{status:413}); chunks.push(Buffer.from(chunk)); }
  try {return JSON.parse(Buffer.concat(chunks).toString("utf8"));} catch {throw Object.assign(new Error("Invalid JSON"),{status:400});}
}
