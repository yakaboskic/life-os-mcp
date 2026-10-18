import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../../src/core/server.js";
import { loadConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { createTrackToolset } from "../../src/toolsets/track/index.js";

// Unlike gmail, the track toolset needs no external API — this integration
// test runs the REAL toolset against a temp LIFE_OS_HOME over a real MCP
// transport.

const text = (res: any) => JSON.parse(res.content[0].text);

describe("track toolset (in-memory transport, real store)", () => {
  let client: Client;

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), "life-os-track-int-"));
    const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
    const server = await buildServer([createTrackToolset()], { config, logger: createLogger("error") });
    client = new Client({ name: "track-test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  it("registers all 17 track_* tools", async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    expect(names).toHaveLength(17);
    for (const name of names) expect(name.startsWith("track_")).toBe(true);
    expect(names).toContain("track_start");
    expect(names).toContain("track_report");
  });

  it("builds the hierarchy: product → project → task", async () => {
    const prod = await client.callTool({
      name: "track_add_product",
      arguments: { name: "NIH branded skill (MCP) gateway", status: "yellow" },
    });
    expect(text(prod).created.id).toBe("nih-branded-skill-mcp-gateway");

    const proj = await client.callTool({
      name: "track_add_project",
      arguments: {
        name: "MCP gateway",
        product: "NIH branded",
        role: "lead",
        goal: "Demonstration of MCP tools improving AI agents",
        deadline: "2026-10-23",
        nextMilestone: "Roadmap/requirements doc",
        nextMilestoneDeadline: "2026-07-31",
      },
    });
    expect(text(proj).created.productId).toBe("nih-branded-skill-mcp-gateway");

    const task = await client.callTool({
      name: "track_add_task",
      arguments: { title: "MCP gateway roadmap/requirements doc", project: "MCP gateway" },
    });
    expect(text(task).created.id).toBe("t1");

    const overview = text(await client.callTool({ name: "track_overview", arguments: {} }));
    expect(overview.products[0].projects[0].tasks[0].id).toBe("t1");
    expect(overview.weeklyTargetHours).toBe(25);
  });

  it("runs the stopwatch: start → status → stop records an entry", async () => {
    const start = text(await client.callTool({ name: "track_start", arguments: { task: "roadmap", note: "drafting" } }));
    expect(start.started.taskId).toBe("t1");
    expect(start.autoStopped).toBeNull();

    const status = text(await client.callTool({ name: "track_status", arguments: {} }));
    expect(status.activeTimer.taskId).toBe("t1");

    await new Promise((r) => setTimeout(r, 15));
    const stop = text(await client.callTool({ name: "track_stop", arguments: {} }));
    expect(stop.recorded.taskId).toBe("t1");
    expect(stop.recorded.note).toBe("drafting");

    const after = text(await client.callTool({ name: "track_status", arguments: {} }));
    expect(after.activeTimer).toBeNull();
  });

  it("logs manual time and reports it with notes for the sync agent", async () => {
    await client.callTool({
      name: "track_log",
      arguments: { task: "t1", durationMinutes: 90, end: "2026-07-21 11:00", note: "outline + dependency list" },
    });
    const report = text(
      await client.callTool({ name: "track_report", arguments: { from: "2026-07-21", to: "2026-07-21" } }),
    );
    expect(report.totalHours).toBe(1.5);
    expect(report.byProject[0].project).toBe("MCP gateway");
    expect(report.byProject[0].product).toBe("NIH branded skill (MCP) gateway");
    expect(report.byProject[0].role).toBe("lead");
    expect(report.byProject[0].tasks[0].notes).toContain("outline + dependency list");
    expect(report.byDay).toEqual([{ date: "2026-07-21", hours: 1.5 }]);
  });

  it("weekly report includes the 25h target math", async () => {
    const report = text(await client.callTool({ name: "track_report", arguments: { range: "this_week" } }));
    expect(report.weeklyTarget.hours).toBe(25);
    expect(report.weeklyTarget.remainingHours).toBeLessThanOrEqual(25);
  });

  it("completes tasks and hides them from the default overview", async () => {
    await client.callTool({ name: "track_update_task", arguments: { task: "t1", status: "done" } });
    const overview = text(await client.callTool({ name: "track_overview", arguments: {} }));
    expect(overview.products[0].projects[0].tasks).toHaveLength(0);
    const withDone = text(await client.callTool({ name: "track_overview", arguments: { includeDone: true } }));
    expect(withDone.products[0].projects[0].tasks[0].status).toBe("done");
  });

  it("returns friendly errors for unknown tasks", async () => {
    const res = await client.callTool({ name: "track_start", arguments: { task: "does not exist" } });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toContain("Unknown task");
  });
});
