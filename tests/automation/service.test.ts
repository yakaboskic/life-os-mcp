import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { closeDatabase, openDatabase } from "../../src/state/database.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { createAutomationService } from "../../src/automation/service.js";
import { AutomationStore, LIMITS } from "../../src/automation/store.js";
import type { AutomationProvider, BriefDeliveryGateway, BriefProposal } from "../../src/automation/types.js";
import type { AgentReviewContext, AgentReviewProposal, JobRun, JobService, ReviewItem } from "../../src/jobs/types.js";
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const owner = "owner@example.com", revision = "a".repeat(64);
const dirs: ReturnType<typeof loadConfig>[] = [];
const run = (id = "triage1"): JobRun => ({ id, name: "gmail-triage", mode: "apply", scheduled: true, day: "2026-10-18", state: "partial", startedAt: "2026-10-18T09:53:00Z", finishedAt: "2026-10-18T10:00:00Z", accounts: [{ account: owner, state: "partial", processed: 1, held: 1, failed: 0, completed: 0 }] });
const context = (id: string): AgentReviewContext => ({ itemId: id, revision, policyVersion: "lifeos-review-v1", account: owner, now: "2026-10-18T10:10:00Z", triggerIds: ["m1"], thread: { id: "thread1", messages: [{ id: "m1", internalDate: 1, labels: ["INBOX"], from: "sender@example.com", to: owner, subject: "Action", body: "Please review the proposal today.", truncated: false, attachments: false }] } });
function fixture() {
  const config = loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "lifeos-automation-")), LIFE_OS_BRIEF_ACCOUNT: owner, LIFE_OS_BRIEF_RECIPIENT: owner }); dirs.push(config);
  let now = new Date("2026-10-18T11:10:00Z"), paused = false;
  const reviews: ReviewItem[] = [{ id: "work1", account: owner, threadId: "thread1", subject: "Action", sender: "sender@example.com", reason: "LOW_CONFIDENCE", createdAt: now.toISOString(), mode: "apply", revision, reviewable: true }];
  const states = new Map<string, string>([["work1", "needs_review"]]); const applied: string[][] = [], decisions: AgentReviewProposal[] = [];
  const jobs: JobService = {
    start: async () => { throw Error("Unexpected inbox discovery"); }, status: () => ({ activeRun: null, lastRun: run(), lastSuccessfulRun: null, nextRunAt: "", schedule: "", timeZone: "America/New_York", accounts: [], reviewCount: reviews.length, paused, configuredAccounts: [owner] }), history: () => [run()], reviews: () => reviews,
    resolve: (id, category) => { const item = reviews.find(item => item.id === id)!; item.category = category; states.set(id, "classified"); reviews.splice(reviews.indexOf(item), 1); return item; }, drain: async () => { paused = true; }, resume: () => { paused = false; },
    reviewContext: async id => context(id), acceptAgentReview: async proposal => { decisions.push(proposal); states.set(proposal.itemId, "classified"); const item = reviews.find(item => item.id === proposal.itemId)!; reviews.splice(reviews.indexOf(item), 1); return item; },
    applyReviewed: async ids => { applied.push(ids); ids.forEach(id => states.set(id, "applied")); return { ...run(), state: "success", accounts: [{ ...run().accounts[0]!, processed: ids.length, held: 0 }] }; }, readyReviewIds: () => [...states].filter(([, value]) => value === "classified").map(([id]) => id), reviewedWorkState: id => states.get(id),
  };
  let reviewCalls = 0, briefCalls = 0, sends = 0, reconciles = 0, lost = false, found = true, clear = true;
  const provider: AutomationProvider = { model: "claude-sonnet-5-5", configured: () => true, review: async input => { reviewCalls++; return { value: { itemId: input.itemId, revision: input.revision, policyVersion: input.policyVersion, category: clear ? "ACTION/NOW" : null, clear, confidence: clear ? 0.99 : 0.6, needsMoreContext: !clear, reason: "Direct request", evidence: [{ messageId: "m1", quote: "Please review the proposal today." }] }, model: "claude-sonnet-5-5", inputTokens: 100, outputTokens: 50 }; }, brief: async input => { briefCalls++; const value: BriefProposal = { title: "Daily priorities", summary: "Review the current requests.", priorities: [{ title: "Review triage", detail: "Review held messages.", sourceIds: [input.sources.find(item => item.kind === "triage")!.id] }], notes: [] }; return { value, model: "claude-sonnet-5-5", inputTokens: 120, outputTokens: 80 }; } };
  const delivery: BriefDeliveryGateway = { prepare: artifact => artifact.markdown, send: async () => { sends++; if (lost) throw Error("Lost response"); return { id: "sent1", threadId: "sentthread1" }; }, reconcile: async () => { reconciles++; return found ? { id: "sent1" } : null; } };
  const deps = { jobs, provider, delivery, now: () => now }; const service = createAutomationService(config, logger, deps);
  return { config, service, deps, provider, jobs, reviews, applied, decisions, states, counts: () => ({ reviewCalls, briefCalls, sends, reconciles }), lost(value = true) { lost = value; }, found(value: boolean) { found = value; }, clear(value: boolean) { clear = value; }, advance(ms: number) { now = new Date(now.getTime() + ms); } };
}
afterEach(() => { for (const config of dirs.splice(0)) { closeDatabase(config); rmSync(config.home, { recursive: true, force: true }); } });

describe("durable automation", () => {
  it("is disabled by default and deduplicates commands with payload conflicts rejected", async () => {
    const f = fixture(); expect(f.service.snapshot().schedule.enabled).toBe(false); await f.service.tick(); expect(f.counts().reviewCalls).toBe(0);
    await f.service.command("automation.run", { kind: "review" }, "request-001", "owner"); await f.service.command("automation.run", { kind: "review" }, "request-001", "owner");
    expect(f.service.snapshot().runs).toHaveLength(1); await expect(f.service.command("automation.run", { kind: "brief" }, "request-001", "owner")).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    await f.service.tick(); expect(f.decisions).toHaveLength(1); expect(f.applied).toEqual([["work1"]]); expect(f.service.snapshot().runs[0]?.state).toBe("succeeded");
  });
  it("keeps ambiguous reviews held and does not repeatedly spend on the same evidence", async () => {
    const f = fixture(); f.clear(false);
    for (const id of ["request-001", "request-002"]) { await f.service.command("automation.run", { kind: "review" }, id, "owner"); await f.service.tick(); }
    expect(f.counts().reviewCalls).toBe(1); expect(f.applied).toHaveLength(0); expect(f.reviews).toHaveLength(1);
  });
  it("manual human review queues only its accepted work, without a model call", async () => {
    const f = fixture(); await f.service.command("review.resolve", { itemId: "work1", category: "ACTION/SOON" }, "request-001", "owner"); await f.service.tick();
    expect(f.applied).toEqual([["work1"]]); expect(f.counts().reviewCalls).toBe(0);
  });
  it("deduplicates daily triggers, publishes dashboard first and sends exactly one attempt per day", async () => {
    const f = fixture(); await f.service.command("automation.schedule", { enabled: true }, "schedule-001", "owner");
    f.service.afterTriage(run()); f.service.afterTriage(run()); await f.service.tick();
    expect(f.service.snapshot().runs).toHaveLength(1); expect(f.counts()).toMatchObject({ sends: 1, reviewCalls: 1, briefCalls: 1 });
    const markdown = readFileSync(join(f.config.triageLogDir, "briefing.md"), "utf8"); expect(markdown).toContain("## 2026-10-18");
    await f.service.command("automation.run", { kind: "brief" }, "request-002", "owner"); await f.service.tick(); expect(f.counts().sends).toBe(1); expect(f.counts().briefCalls).toBe(1);
  });
  it("reconciles a lost send response and never blindly re-sends an uncertain delivery after restart", async () => {
    const f = fixture(); f.lost(); f.found(false); await f.service.command("automation.run", { kind: "brief" }, "request-001", "owner"); await f.service.tick();
    expect(f.service.snapshot().deliveries[0]?.state).toBe("uncertain"); expect(f.service.snapshot().briefing).not.toBeNull();
    const restarted = createAutomationService(f.config, logger, f.deps); await restarted.command("automation.run", { kind: "brief" }, "request-002", "owner"); await restarted.tick();
    expect(f.counts().sends).toBe(1); expect(restarted.snapshot().deliveries[0]?.state).toBe("uncertain");
    f.found(true); await restarted.command("automation.run", { kind: "brief" }, "request-003", "owner"); await restarted.tick(); expect(restarted.snapshot().deliveries[0]?.state).toBe("sent"); expect(f.counts().sends).toBe(1);
  });
  it("recovers claimed work and rejects stale worker output with fencing", async () => {
    const f = fixture(); let release!: () => void; const original = f.provider.review;
    f.provider.review = async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return original(...args); };
    await f.service.command("automation.run", { kind: "review" }, "request-001", "owner"); const first = f.service.tick(); await Promise.resolve(); await Promise.resolve();
    const restarted = createAutomationService(f.config, logger, f.deps); release(); await first; expect(f.applied).toHaveLength(0); expect(f.decisions).toHaveLength(0);
    f.provider.review = original; await restarted.tick(); expect(f.applied).toEqual([["work1"]]);
  });
  it("drain blocks new commands and waits for in-flight execution", async () => {
    const f = fixture(); await f.service.drain(); await expect(f.service.command("automation.run", { kind: "review" }, "request-001", "owner")).rejects.toThrow("AUTOMATION_DRAINING");
    f.service.resume(); await f.service.command("automation.run", { kind: "review" }, "request-001", "owner"); await f.service.tick(); expect(f.applied).toHaveLength(1);
  });
  it("aborts an active provider on drain and resumes its durable work", async () => {
    const f = fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; }); const original = f.provider.review;
    f.provider.review = async (_context, signal) => { entered(); await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("CLAUDE_RUNNER_CANCELLED")), { once: true })); throw Error("unreachable"); };
    await f.service.command("automation.run", { kind: "review" }, "request-001", "owner"); const running = f.service.tick(); await started; await f.service.drain(); await running;
    expect(f.service.snapshot().runs[0]?.state).toBe("queued"); expect(f.applied).toHaveLength(0);
    f.provider.review = original; f.service.resume(); await f.service.tick(); expect(f.applied).toHaveLength(1);
  });
  it("automatically reconciles an uncertain delivery later without another send", async () => {
    const f = fixture(); f.lost(); f.found(false); await f.service.command("automation.run", { kind: "brief" }, "request-001", "owner"); await f.service.tick();
    f.found(true); f.advance(15 * 60_000); await f.service.tick(); expect(f.service.snapshot().deliveries[0]?.state).toBe("sent"); expect(f.counts().sends).toBe(1);
  });
  it("preserves settings across restart and backs off transient model failures", async () => {
    const f = fixture(); await f.service.command("automation.schedule", { localTime: "08:15", reviewEnabled: false }, "schedule-001", "owner");
    const restarted = createAutomationService(f.config, logger, f.deps); expect(restarted.snapshot().schedule.localTime).toBe("08:15"); expect(restarted.snapshot().schedule.reviewEnabled).toBe(false);
    f.provider.review = async () => { throw Error("CLAUDE_HTTP_429"); }; await restarted.command("automation.run", { kind: "review" }, "request-001", "owner"); await restarted.tick();
    expect(restarted.snapshot().runs[0]?.state).toBe("retry_wait"); const usage = restarted.snapshot().usage; expect(usage.calls).toBe(1); expect(usage.inputTokens).toBeGreaterThan(8000);
    await restarted.tick(); expect(restarted.snapshot().usage.calls).toBe(1); f.advance(60_000); await restarted.tick(); expect(restarted.snapshot().usage.calls).toBe(2);
  });
  it("daily model reservations cannot exceed durable caps", () => {
    const f = fixture(), store = new AutomationStore(openDatabase(f.config)); store.reserve("2026-10-18", LIMITS.maxInputTokens, 1);
    expect(() => store.reserve("2026-10-18", 1, 1)).toThrow("DAILY_MODEL_BUDGET_EXHAUSTED");
  });
  it("includes bounded recent focus and excludes future time entries", async () => {
    const f = fixture(), track = new TrackStore(f.config), task = track.addTask({ title: "Research" });
    track.logEntry({ task: task.id, start: "2026-10-18T09:00:00Z", end: "2026-10-18T09:45:00Z" });
    track.logEntry({ task: task.id, start: "2026-10-19T09:00:00Z", end: "2026-10-19T10:00:00Z" });
    track.db.prepare("INSERT INTO active_timer VALUES(1,?,?)").run(task.id, JSON.stringify({ taskId: task.id, start: "2026-10-18T11:00:00Z" }));
    let sources: any[] = []; const original = f.provider.brief;
    f.provider.brief = async (...args) => { sources = args[0].sources; return original(...args); };
    await f.service.command("automation.run", { kind: "brief" }, "request-001", "owner"); await f.service.tick();
    expect(JSON.parse(sources.find(item => item.id === `time:${task.id}`).details).completedMinutes).toBe(45);
    expect(JSON.parse(sources.find(item => item.id === "focus:active").details)).toMatchObject({ elapsedMinutes: 10, timeZone: "America/New_York" });
  });
  it("rejects fabricated briefing source references without publishing or sending", async () => {
    const f = fixture(); f.provider.brief = async () => ({ value: { title: "Fake", summary: "Fake", priorities: [{ title: "Fake", detail: "Fake", sourceIds: ["task:invented"] }], notes: [] }, model: f.provider.model, inputTokens: 10, outputTokens: 10 });
    await f.service.command("automation.run", { kind: "brief" }, "request-001", "owner"); await f.service.tick(); expect(f.service.snapshot().runs[0]?.errorCode).toBe("BRIEF_INVALID_SOURCE"); expect(f.service.snapshot().briefing).toBeNull(); expect(f.counts().sends).toBe(0);
  });
});
