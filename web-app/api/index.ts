import type { IncomingMessage, ServerResponse } from "node:http";
import { createWebHandler } from "../handler.js";

type PlatformRequest = IncomingMessage & { body?: unknown };

/** Preserve Vercel's parsed body or raw Node bytes without reading before auth/CSRF checks. */
function requestBody(request: PlatformRequest, headers: Headers): ReadableStream<Uint8Array> {
  let initialized = false;
  let iterator: AsyncIterator<unknown> | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!initialized) {
          initialized = true;
          // Prefer the wire bytes so whitespace/duplicate keys still count
          // against the handler's limit. Vercel restores its buffered body via
          // read(), even though the original request already reports ended.
          if (!request.readableEnded && !request.destroyed) {
            // Preserve the response socket if the handler cancels an oversized body.
            iterator = request.iterator({ destroyOnReturn: false });
          } else {
            const restored = request.read();
            if (restored !== null) {
              controller.enqueue(new Uint8Array(Buffer.isBuffer(restored) ? restored : Buffer.from(String(restored))));
              controller.close(); return;
            }
            // Fallback for platforms that expose only a parsed body. Malformed
            // lazy getters fail here, after auth, and become the handler's 400.
            const parsed = request.body;
            if (parsed !== undefined) {
              let body: Uint8Array;
              if (Buffer.isBuffer(parsed)) body = new Uint8Array(parsed);
              else {
                // JSON strings are parsed scalars, not raw serialized actions.
                const isJson = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json";
                const text = typeof parsed === "string" && !isJson ? parsed : JSON.stringify(parsed);
                if (text === undefined) throw new Error("Invalid request body");
                body = new TextEncoder().encode(text);
              }
              controller.enqueue(body); controller.close(); return;
            }
            controller.close(); return;
          }
        }
        const next = await iterator!.next();
        if (next.done) controller.close();
        else controller.enqueue(new Uint8Array(Buffer.isBuffer(next.value) ? next.value : Buffer.from(String(next.value))));
      } catch (error) { controller.error(error); }
    },
    async cancel() { await iterator?.return?.(); },
  }, { highWaterMark: 0 });
}

export function createVercelHandler(handler: (request: Request) => Promise<Response> = createWebHandler()) {
  return async function lifeOsWeb(request: PlatformRequest, response: ServerResponse): Promise<void> {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
      else if (value !== undefined) headers.set(key, value);
    }
    try {
      // Vercel terminates HTTPS. Host is checked against the configured public URL by the handler.
      const host = request.headers.host ?? "invalid.local", method = request.method ?? "GET";
      const init: RequestInit & { duplex?: "half" } = { method, headers };
      if (method !== "GET" && method !== "HEAD") { init.body = requestBody(request, headers); init.duplex = "half"; }
      const result = await handler(new Request(`https://${host}${request.url ?? "/"}`, init));
      response.statusCode = result.status;
      for (const [key, value] of result.headers) if (key !== "set-cookie") response.setHeader(key, value);
      const cookies = result.headers.getSetCookie(); if (cookies.length) response.setHeader("set-cookie", cookies);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      response.statusCode = 500; response.setHeader("cache-control", "private, no-store"); response.setHeader("content-type", "text/plain; charset=utf-8"); response.end("LifeOS is temporarily unavailable.");
    }
  };
}

export default createVercelHandler();
