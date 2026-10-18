import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { createDaemon } from "../../src/runtime/daemon.js";
import { easternDay } from "../../src/jobs/service.js";
import type { JobService, JobRun, JobStatus, StartJobInput } from "../../src/jobs/types.js";
import { closeDatabase } from "../../src/state/database.js";

class FakeJobs implements JobService {
  runs: JobRun[] = [];
  calls: StartJobInput[] = [];
  activeRun: JobRun | null = null;
  paused = false;
  private manual?: Promise<JobRun>;
  private finish?: () => void;
  beginManual() {
    const run = this.makeRun(false);
    this.activeRun = run;
    this.manual = new Promise(resolve => { this.finish = () => {
      run.state = "success"; run.finishedAt = new Date().toISOString(); this.runs.unshift(run);
      this.activeRun = null; this.manual = undefined; resolve(run);
    }; });
  }
  finishManual() { this.finish?.(); }
  private makeRun(scheduled: boolean): JobRun { return {
    id: `${scheduled ? "scheduled" : "manual"}-${this.runs.length}`, name: "gmail-triage", mode: "dry-run", scheduled,
    day: easternDay(new Date()), state: "running", startedAt: new Date().toISOString(), accounts: [],
  }; }
  async start(input: StartJobInput) {
    this.calls.push(input);
    if (this.paused) throw new Error("JOBS_DRAINING");
    if (this.manual) return this.manual;
    const previous = this.runs.find(r => r.scheduled && r.day === easternDay(new Date()) && r.mode === input.mode);
    if (previous) return previous;
    const run = this.makeRun(!!input.scheduled);
    run.mode = input.mode; run.state = "success"; run.finishedAt = new Date().toISOString();
    this.runs.unshift(run); return run;
  }
  status(): JobStatus { return {
    activeRun: this.activeRun, lastRun: this.runs[0] ?? null, lastSuccessfulRun: null,
    nextRunAt: new Date().toISOString(), schedule: "05:53 daily", timeZone: "America/New_York",
    accounts: [], reviewCount: 0, paused: this.paused, configuredAccounts: [],
  }; }
  history() { return this.runs; }
  reviews() { return []; }
  resolve(): never { throw new Error("unused"); }
  async drain() { this.paused = true; if (this.manual) await this.manual; }
  resume() { this.paused = false; }
}
const interactive = "interactive-" + "a".repeat(40);
const job = "job-" + "b".repeat(40);
const running: Array<{ app: Awaited<ReturnType<typeof createDaemon>>; config: LifeOsConfig }> = [];
async function start(jobs: FakeJobs, existing?: LifeOsConfig) {
  const config = existing ?? loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "lifeos-queue-")), LIFE_OS_INTERACTIVE_TOKEN: interactive, LIFE_OS_JOB_TOKEN: job });
  const app = await createDaemon(config, createLogger("error"), { toolsets: [], jobs });
  await new Promise<void>(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  running.push({ app, config });
  const request = async (path: string, body?: unknown) => {
    const res = await fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${path.startsWith("/v1/admin/") ? interactive : job}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(res.ok).toBe(true); return res.json() as Promise<any>;
  };
  return { app, config, request, base };
}
afterEach(async () => { for (const { app, config } of running.splice(0)) { await app.close(); closeDatabase(config); } });
const scheduled = { name: "gmail-triage", mode: "dry-run", scheduled: true };

describe("durable scheduled requests", () => {
  it("keeps a due request while draining and runs it once after resume", async () => {
    const jobs = new FakeJobs(), { request } = await start(jobs);
    await request("/v1/admin/drain", {});
    await request("/v1/jobs", scheduled);
    await request("/v1/jobs", scheduled);
    expect((await request("/v1/jobs")).pendingRuns).toHaveLength(1);
    expect(jobs.calls).toHaveLength(0);
    await request("/v1/admin/resume", {});
    await vi.waitFor(async () => expect((await request("/v1/jobs")).pendingRuns).toHaveLength(0));
    expect(jobs.runs).toHaveLength(1);
    expect(jobs.runs[0]?.scheduled).toBe(true);
  });

  it("does not consume scheduled work merely because an existing manual run finishes", async () => {
    const jobs = new FakeJobs(); jobs.beginManual();
    const { request } = await start(jobs);
    await request("/v1/jobs", scheduled);
    expect((await request("/v1/jobs")).pendingRuns).toHaveLength(1);
    expect(jobs.calls).toHaveLength(1);
    jobs.finishManual();
    await vi.waitFor(async () => expect((await request("/v1/jobs")).pendingRuns).toHaveLength(0));
    expect(jobs.calls).toHaveLength(2);
    expect(jobs.runs.map(run => run.scheduled)).toEqual([true, false]);
  });

  it("replays a request that survived a daemon replacement", async () => {
    const first = await start(new FakeJobs());
    await first.request("/v1/admin/drain", {});
    await first.request("/v1/jobs", scheduled);
    await first.app.close(); running.splice(0, 1);
    const replacement = new FakeJobs();
    const second = await start(replacement, first.config);
    await vi.waitFor(async () => expect((await second.request("/v1/jobs")).pendingRuns).toHaveLength(0));
    expect(replacement.runs).toHaveLength(1);
    expect(replacement.runs[0]?.scheduled).toBe(true);
  });

  it("advertises unsupported optional MCP streams with the expected method response", async () => {
    const { base } = await start(new FakeJobs());
    for (const method of ["GET", "DELETE"]) {
      const response = await fetch(base + "/mcp", { method, headers: { authorization: `Bearer ${interactive}` } });
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});
