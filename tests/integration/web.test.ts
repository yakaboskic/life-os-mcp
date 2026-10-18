import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { loadConfig } from "../../src/core/config.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { createWebServer } from "../../src/web/server.js";

describe("web portal", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), "life-os-web-"));
    const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
    const store = new TrackStore(config);
    store.addProduct({ name: "NIH branded skill (MCP) gateway", status: "yellow" });
    store.addProject({ name: "MCP gateway", product: "NIH branded", role: "lead" });
    store.addTask({ title: "Roadmap doc", project: "MCP gateway" });
    store.logEntry({ task: "t1", durationMinutes: 90, end: "2026-07-22 11:00", note: "outline" });

    mkdirSync(config.triageLogDir, { recursive: true });
    writeFileSync(join(config.triageLogDir, "email.md"), "# Email triage log\n\n## 2026-08-04\n\n- **Work account**: inbox empty\n");

    server = createWebServer(config);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    server.closeAllConnections();
  });

  it("serves the self-contained portal page", async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Life OS</title>");
    expect(html).toContain("read-only");
    expect(html).not.toMatch(/src="https?:\/\//); // no external requests
    for (const view of ["view-time", "view-tasks", "view-triage"]) expect(html).toContain(view);
  });

  it("serves the tracker snapshot as JSON", async () => {
    const res = await fetch(`${base}/api/data`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.weeklyTargetHours).toBe(25);
    expect(data.products[0].name).toBe("NIH branded skill (MCP) gateway");
    expect(data.projects[0].role).toBe("lead");
    expect(data.tasks[0].id).toBe("t1");
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].seconds).toBe(90 * 60);
    expect(data.entries[0].note).toBe("outline");
    expect(data.activeTimer).toBeNull();
  });

  it("serves triage reports as JSON", async () => {
    const res = await fetch(`${base}/api/triage`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(data.reports).toHaveLength(1);
    expect(data.reports[0].name).toBe("email");
    expect(data.reports[0].content).toContain("inbox empty");
    expect(data.reports[0].modified).toBeTruthy();
  });

  it("is read-only: non-GET methods are rejected", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      const res = await fetch(`${base}/api/data`, { method });
      expect(res.status).toBe(405);
    }
  });

  it("404s unknown paths", async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });
});
