import type { IncomingMessage, ServerResponse } from "node:http";
import { createWebHandler } from "../handler.js";

const handler = createWebHandler();
export default async function lifeOsWeb(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  try {
    // Vercel terminates HTTPS. Host is checked against the configured public URL by the handler.
    const host = request.headers.host ?? "invalid.local";
    const result = await handler(new Request(`https://${host}${request.url ?? "/"}`, { method: request.method ?? "GET", headers }));
    response.statusCode = result.status;
    for (const [key, value] of result.headers) if (key !== "set-cookie") response.setHeader(key, value);
    const cookies = result.headers.getSetCookie(); if (cookies.length) response.setHeader("set-cookie", cookies);
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch {
    response.statusCode = 500; response.setHeader("cache-control", "private, no-store"); response.setHeader("content-type", "text/plain; charset=utf-8"); response.end("LifeOS is temporarily unavailable.");
  }
}
