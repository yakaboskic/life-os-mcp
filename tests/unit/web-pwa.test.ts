import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { OFFLINE_HTML, PWA_ASSETS, SERVICE_WORKER, WEB_MANIFEST } from "../../src/web/pwa.js";

type Handler = (event: any) => void;
function worker(options: { offline?: boolean; redirected?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const cached: string[] = [];
  const offline = new Response(OFFLINE_HTML);
  const context = {
    self: {
      location: { origin: "https://lifeos.example" },
      addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    },
    URL, Response,
    Request: class { constructor(public url: string) {} },
    caches: {
      open: async () => ({ put: async (path: string) => { cached.push(path); } }),
      keys: async () => [], delete: async () => true,
      match: async (path: string) => path === "/offline.html" ? offline : undefined,
    },
    fetch: async (request: { url: string }) => {
      if (options.offline) throw new Error("offline");
      const asset = PWA_ASSETS[new URL(request.url, "https://lifeos.example").pathname]!;
      return {
        ok: true, redirected: options.redirected ?? false,
        headers: new Headers({ "content-type": asset?.contentType ?? "text/html" }),
      };
    },
  };
  runInNewContext(SERVICE_WORKER, context);
  return { handlers, cached, offline };
}

describe("installable private web app", () => {
  it("provides a standalone manifest and real PNG icons at advertised sizes", () => {
    expect(WEB_MANIFEST.display).toBe("standalone");
    expect(WEB_MANIFEST.start_url).toBe("/");
    for (const icon of WEB_MANIFEST.icons) {
      const body = PWA_ASSETS[icon.src]!.body as Buffer;
      expect(body.subarray(1, 4).toString()).toBe("PNG");
      expect(`${body.readUInt32BE(16)}x${body.readUInt32BE(20)}`).toBe(icon.sizes);
    }
    const apple = PWA_ASSETS["/icons/apple-touch-icon.png"]!.body as Buffer;
    expect(apple.readUInt32BE(16)).toBe(180);
  });

  it("pre-caches only static icons and the generic offline page", async () => {
    const sw = worker();
    let complete: Promise<void> | undefined;
    sw.handlers.get("install")!({ waitUntil: (promise: Promise<void>) => { complete = promise; } });
    await complete;
    expect(sw.cached).toContain("/offline.html");
    expect(sw.cached.every((path) => path === "/offline.html" || path.startsWith("/icons/"))).toBe(true);
    expect(sw.cached).not.toContain("/");
  });

  it("does not cache a sign-in redirect returned instead of a static asset", async () => {
    const sw = worker({ redirected: true });
    let complete: Promise<void> | undefined;
    sw.handlers.get("install")!({ waitUntil: (promise: Promise<void>) => { complete = promise; } });
    await expect(complete).rejects.toThrow("Static asset unavailable");
    expect(sw.cached).toEqual([]);
  });

  it("leaves APIs, authentication, writes, and foreign origins entirely on the network", () => {
    const sw = worker();
    for (const [path, mode, method] of [
      ["/api/data", "cors", "GET"], ["/api/triage", "cors", "GET"],
      ["/api/jobs", "cors", "GET"], ["/v1/triage/reviews", "cors", "GET"],
      ["/auth/callback", "navigate", "GET"], ["/mcp", "cors", "POST"],
      ["/icons/life-os-192.png?secret=never", "cors", "GET"],
      ["https://other.example/icons/life-os-192.png", "cors", "GET"],
    ]) {
      let intercepted = false;
      sw.handlers.get("fetch")!({ request: { url: new URL(path!, "https://lifeos.example").href, mode, method }, respondWith: () => { intercepted = true; } });
      expect(intercepted, `${method} ${path}`).toBe(false);
    }
    expect(sw.cached).toEqual([]);
  });

  it("shows a generic offline screen for unavailable app navigation", async () => {
    const sw = worker({ offline: true });
    let response: Promise<Response> | undefined;
    sw.handlers.get("fetch")!({
      request: { url: "https://lifeos.example/", mode: "navigate", method: "GET" },
      respondWith: (promise: Promise<Response>) => { response = promise; },
    });
    expect(await response).toBe(sw.offline);
    expect(sw.cached).toEqual([]);
  });
});
