import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { ToolInputError } from "../../src/core/errors.js";
import { parseWhen, resolveRange, startOfLocalWeek } from "../../src/toolsets/track/time.js";

function freshStore(): TrackStore {
  const home = mkdtempSync(join(tmpdir(), "life-os-track-"));
  return new TrackStore(loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv));
}

describe("time parsing", () => {
  it("parses local dates, local datetimes, and ISO instants", () => {
    const localMidnight = parseWhen("2026-07-22");
    expect(localMidnight.getHours()).toBe(0);
    expect(localMidnight.getDate()).toBe(22);
    const localAfternoon = parseWhen("2026-07-22 14:30");
    expect(localAfternoon.getHours()).toBe(14);
    expect(parseWhen("2026-07-22T12:00:00Z").toISOString()).toBe("2026-07-22T12:00:00.000Z");
    expect(() => parseWhen("not a time")).toThrowError(ToolInputError);
  });

  it("resolves week ranges starting Monday", () => {
    const wed = new Date(2026, 6, 22, 15, 0); // Wed Jul 22 2026 local
    const r = resolveRange({ range: "this_week" }, wed);
    expect(r.from.getDay()).toBe(1); // Monday
    expect(r.isFullWeek).toBe(true);
    expect(startOfLocalWeek(wed).getDate()).toBe(20);
  });

  it("treats bare `to` dates as inclusive", () => {
    const r = resolveRange({ from: "2026-07-01", to: "2026-07-02" });
    expect(r.to.getTime() - r.from.getTime()).toBe(2 * 24 * 3600 * 1000);
  });
});

describe("TrackStore registry", () => {
  let store: TrackStore;
  beforeEach(() => {
    store = freshStore();
  });

  it("creates products, projects, tasks with slugs and sequential task ids", () => {
    const product = store.addProduct({ name: "NIH branded skill (MCP) gateway", status: "yellow" });
    expect(product.id).toBe("nih-branded-skill-mcp-gateway");
    const project = store.addProject({ name: "MCP gateway", product: "nih-branded", role: "lead" });
    expect(project.productId).toBe(product.id);
    const t1 = store.addTask({ title: "Roadmap doc", project: "MCP gateway" });
    const t2 = store.addTask({ title: "Standalone thing" });
    expect(t1.id).toBe("t1");
    expect(t2.id).toBe("t2");
    expect(t2.projectId).toBeUndefined();
  });

  it("resolves by id, exact name, and unique substring; errors helpfully otherwise", () => {
    store.addTask({ title: "MCP gateway roadmap doc" });
    store.addTask({ title: "Benchmarking project plan" });
    expect(store.resolveTask("t1").title).toBe("MCP gateway roadmap doc");
    expect(store.resolveTask("benchmarking project plan").id).toBe("t2");
    expect(store.resolveTask("roadmap").id).toBe("t1");
    expect(() => store.resolveTask("plan doc")).toThrowError(/Unknown task/);
    store.addTask({ title: "Another roadmap item" });
    expect(() => store.resolveTask("roadmap")).toThrowError(/matches multiple/);
  });

  it("dedupes slugs and rejects duplicate names", () => {
    store.addProduct({ name: "Thing" });
    expect(() => store.addProduct({ name: "thing" })).toThrowError(/already exists/);
    const p2 = store.addProject({ name: "Thing" }); // separate namespace: fine
    expect(p2.id).toBe("thing");
  });

  it("completes and reopens tasks", () => {
    store.addTask({ title: "Do it" });
    const done = store.updateTask("t1", { status: "done" });
    expect(done.status).toBe("done");
    expect(done.done_at).toBeTruthy();
    const reopened = store.updateTask("t1", { status: "open" });
    expect(reopened.done_at).toBeUndefined();
  });
});

describe("TrackStore timer + entries", () => {
  let store: TrackStore;
  beforeEach(() => {
    store = freshStore();
    store.addTask({ title: "Task A" });
    store.addTask({ title: "Task B" });
  });

  it("runs one stopwatch at a time, auto-stopping the previous", async () => {
    store.startTimer("Task A", "first");
    expect(store.getTimer()?.taskId).toBe("t1");
    await new Promise((r) => setTimeout(r, 15));
    const { stopped, timer } = store.startTimer("Task B");
    expect(stopped?.taskId).toBe("t1");
    expect(stopped?.note).toBe("first");
    expect(stopped!.seconds).toBeGreaterThanOrEqual(0);
    expect(timer.taskId).toBe("t2");
    const entry = store.stopTimer("done with B");
    expect(entry.taskId).toBe("t2");
    expect(entry.note).toBe("done with B");
    expect(store.getTimer()).toBeNull();
    expect(store.readEntries()).toHaveLength(2);
  });

  it("rejects starting the same task twice and stopping with no timer", () => {
    store.startTimer("t1");
    expect(() => store.startTimer("t1")).toThrowError(/already running/);
    store.cancelTimer();
    expect(() => store.stopTimer()).toThrowError(/No stopwatch/);
    expect(store.readEntries()).toHaveLength(0); // cancel recorded nothing
  });

  it("logs manual entries via start+end and via duration anchors", () => {
    const a = store.logEntry({ task: "t1", start: "2026-07-21 09:00", end: "2026-07-21 10:30", note: "morning" });
    expect(a.entry.seconds).toBe(90 * 60);
    const b = store.logEntry({ task: "t1", durationMinutes: 45, start: "2026-07-21 11:00" });
    expect(new Date(b.entry.end).getTime() - new Date(b.entry.start).getTime()).toBe(45 * 60_000);
    const c = store.logEntry({ task: "t2", durationMinutes: 30 }); // ends now
    expect(c.entry.seconds).toBe(30 * 60);
    expect(() => store.logEntry({ task: "t1", start: "2026-07-21 10:00", end: "2026-07-21 09:00" })).toThrowError(
      /end must be after/,
    );
    expect(() => store.logEntry({ task: "t1" })).toThrowError(/Provide start\+end/);
  });

  it("edits and deletes entries, recomputing duration", () => {
    const { entry } = store.logEntry({ task: "t1", start: "2026-07-21 09:00", end: "2026-07-21 10:00" });
    const edited = store.updateEntry(entry.id, { end: "2026-07-21 11:00", task: "t2", note: "moved" });
    expect(edited.seconds).toBe(2 * 3600);
    expect(edited.taskId).toBe("t2");
    store.deleteEntry(entry.id);
    expect(store.readEntries()).toHaveLength(0);
    expect(() => store.deleteEntry("e-nope")).toThrowError(/No time entry/);
  });

  it("filters entries by range, task, and project", () => {
    store.addProject({ name: "Proj X" });
    store.updateTask("t1", { project: "Proj X" });
    store.logEntry({ task: "t1", start: "2026-07-20 09:00", end: "2026-07-20 10:00" });
    store.logEntry({ task: "t2", start: "2026-07-21 09:00", end: "2026-07-21 11:00" });
    const day = store.listEntries({ from: parseWhen("2026-07-20"), to: parseWhen("2026-07-21") });
    expect(day).toHaveLength(1);
    expect(store.listEntries({ project: "Proj X" })).toHaveLength(1);
    expect(store.listEntries({ task: "t2" })[0]!.seconds).toBe(2 * 3600);
  });
});
