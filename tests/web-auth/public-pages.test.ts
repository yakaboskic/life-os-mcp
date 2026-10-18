import { describe, expect, it } from "vitest";
import { createWebHandler } from "../../web-app/handler.js";

const origin = "https://life-os-test.vercel.app";
const paths = ["/about", "/privacy", "/terms"];

describe("public LifeOS information pages", () => {
  it.each(paths)("serves %s without authentication or configured credentials", async (path) => {
    let calls = 0;
    const handler = createWebHandler({ env: {}, fetch: (async () => { calls++; throw new Error("Unexpected upstream request"); }) as typeof fetch });
    const response = await handler(new Request(`${origin}${path}`));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("set-cookie")).toBeNull();
    for (const destination of paths) expect(html).toContain(`href="${destination}"`);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("/api/data");
    expect(calls).toBe(0);
  });

  it("does not expose config, cookies or reflected query strings through public pages", async () => {
    const secret = "private-deployment-secret-never-public";
    const handler = createWebHandler({ env: { LIFE_OS_GATEWAY_TOKEN: secret, LIFE_OS_ALLOWED_EMAIL: "private-owner@example.com" } });
    for (const path of paths) {
      const response = await handler(new Request(`${origin}${path}?account=${secret}`, { headers: { cookie: `session=${secret}` } }));
      const html = await response.text();
      expect(response.status).toBe(200);
      expect(html).not.toContain(secret);
      expect(html).not.toContain("private-owner@example.com");
    }
    expect((await handler(new Request(`${origin}/api/data`))).status).toBe(503);
    expect((await handler(new Request(`${origin}/api/triage`))).status).toBe(503);
    expect((await handler(new Request(`${origin}/api/jobs`))).status).toBe(503);
  });

  it.each(paths)("supports HEAD and rejects writes to %s", async (path) => {
    const handler = createWebHandler({ env: {} });
    const head = await handler(new Request(`${origin}${path}`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const method of ["POST", "PUT", "DELETE"]) {
      const response = await handler(new Request(`${origin}${path}`, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
    }
  });

  it("links public disclosures from the setup/sign-in page and describes the actual data flow", async () => {
    const handler = createWebHandler({ env: {} });
    const login = await (await handler(new Request(origin))).text();
    for (const path of paths) expect(login).toContain(`href="${path}"`);
    const privacy = await (await handler(new Request(`${origin}/privacy`))).text();
    expect(privacy).toContain("TypeSafe/Jev");
    expect(privacy).toContain("bounded conversation text");
    expect(privacy).toContain("openid email profile");
    expect(privacy).toContain("at most eight hours");
    expect(privacy).toContain("Limited Use");
    expect(privacy).toContain("Revoking access does not erase data already stored");
    expect(privacy).toContain("no universal retention period");
  });

  it("redirects only public pages to configured branding without forwarding request data", async () => {
    const handler = createWebHandler({ env: { LIFE_OS_BRANDING_URL: "https://www.example.com/life-os/" } });
    for (const path of paths) {
      for (const method of ["GET", "HEAD"]) {
        const response = await handler(new Request(`${origin}${path}?next=https://untrusted.example`, { method, headers: { cookie: "private=secret" } }));
        expect(response.status).toBe(308);
        expect(response.headers.get("location")).toBe(`https://www.example.com/life-os${path === "/about" ? "" : path}`);
        expect(response.headers.get("cache-control")).toContain("no-store");
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await response.text()).toBe("");
      }
      expect((await handler(new Request(`${origin}${path}`, { method: "POST" }))).status).toBe(405);
    }
    for (const path of ["/api/data", "/api/triage", "/api/jobs", "/auth/login"]) {
      const response = await handler(new Request(`${origin}${path}`));
      expect(response.status).toBe(503);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each(["not-a-url", "http://www.example.com/life-os", "//www.example.com/life-os", "https://owner:secret@example.com/life-os", "https://www.example.com/life-os?secret=value", "https://www.example.com/life-os#secret"])("rejects invalid branding configuration without reflecting it: %s", async (base) => {
    const handler = createWebHandler({ env: { LIFE_OS_BRANDING_URL: base } });
    const response = await handler(new Request(`${origin}/privacy`));
    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("Public information is temporarily unavailable.");
  });
});
