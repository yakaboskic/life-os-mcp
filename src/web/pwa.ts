/** Installable, private LifeOS shell. No personal API response enters a cache. */
export interface PwaAsset { contentType: string; body: string | Buffer }

export const ICON_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" fill=\"#050a0f\"/><path d=\"M150 142H342Q370 142 370 170V342H342V178Q342 170 334 170H150Z\" fill=\"#e7b16b\"/><path d=\"M142 190H180V332H306V370H142Z\" fill=\"#71e1ed\"/><rect x=\"218\" y=\"222\" width=\"88\" height=\"24\" fill=\"#e2f4f4\"/><rect x=\"218\" y=\"272\" width=\"62\" height=\"12\" fill=\"#3b6474\"/></svg>";
const ICONS: Record<number, Buffer> = {
  180: Buffer.from("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", "base64"),
  192: Buffer.from("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", "base64"),
  512: Buffer.from("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", "base64"),
};

export const WEB_MANIFEST = {
  id: "/",
  name: "LifeOS",
  short_name: "LifeOS",
  description: "Your private LifeOS operations console",
  lang: "en",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#050a0f",
  theme_color: "#050a0f",
  icons: [
    { src: "/icons/life-os-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "/icons/life-os-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
  ],
};

export const OFFLINE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#050a0f"><title>LifeOS · Offline</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050a0f;color:#e2f4f4;font:16px/1.6 system-ui,sans-serif;padding:32px}main{max-width:440px;border-left:3px solid #e7b16b;padding:8px 0 8px 24px}h1{font-size:26px;font-weight:500;line-height:1.3}p{color:#8da9b5}a{display:inline-block;padding:9px 18px;color:#050a0f;background:#71e1ed;text-decoration:none;margin-top:12px}a:focus-visible{outline:2px solid #e7b16b;outline-offset:4px}
</style></head><body><main><img src="/icons/life-os-192.png" width="64" height="64" alt="LifeOS"><h1>Connect to LifeOS</h1><p>LifeOS is unavailable. Reconnect to the internet, then try again. Your private tasks and email reports are not stored offline.</p><a href="/">Try again</a></main></body></html>`;

export const SERVICE_WORKER = `
"use strict";
const CACHE = "life-os-static-v1";
const STATIC = ["/offline.html", "/icons/life-os.svg", "/icons/life-os-192.png", "/icons/life-os-512.png", "/icons/apple-touch-icon.png"];
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const path of STATIC) {
      const response = await fetch(new Request(path, {cache: "reload", credentials: "omit"}));
      const expectedType = path.endsWith(".html") ? "text/html" : path.endsWith(".svg") ? "image/svg+xml" : "image/png";
      if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes(expectedType)) throw new Error("Static asset unavailable");
      await cache.put(path, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("life-os-static-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Navigations always use the network; authenticated HTML is never persisted.
  if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(fetch(request).catch(async () => (await caches.match("/offline.html")) || Response.error()));
    return;
  }
  // Exact paths only. APIs, auth callbacks, arbitrary assets and queries bypass caching.
  if (url.search || !STATIC.includes(url.pathname)) return;
  event.respondWith(caches.match(url.pathname).then((cached) => cached || fetch(request)));
});
`;

export const PWA_ASSETS: Readonly<Record<string, PwaAsset>> = Object.freeze({
  "/manifest.webmanifest": { contentType: "application/manifest+json; charset=utf-8", body: JSON.stringify(WEB_MANIFEST) },
  "/service-worker.js": { contentType: "text/javascript; charset=utf-8", body: SERVICE_WORKER },
  "/offline.html": { contentType: "text/html; charset=utf-8", body: OFFLINE_HTML },
  "/icons/life-os.svg": { contentType: "image/svg+xml", body: ICON_SVG },
  "/icons/life-os-192.png": { contentType: "image/png", body: ICONS[192]! },
  "/icons/life-os-512.png": { contentType: "image/png", body: ICONS[512]! },
  "/icons/apple-touch-icon.png": { contentType: "image/png", body: ICONS[180]! },
});
