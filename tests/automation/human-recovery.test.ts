import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { closeDatabase, openDatabase } from "../../src/state/database.js";
import { createJobService } from "../../src/jobs/service.js";
import { CATEGORIES, ACTIVE_CATEGORIES, type Decision, type MailGateway, type MailThread, type MutationPlan, type Category } from "../../src/jobs/types.js";
import { createAutomationService } from "../../src/automation/service.js";
import type { AutomationProvider } from "../../src/automation/types.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const account = "owner@example.com", actor = "owner@example.com";
const folders: LifeOsConfig[] = [];
const labels = Object.fromEntries([...CATEGORIES, "ACTION/DONE"].map(name => [name, `Label_${name}`]));
class SyntheticMail implements MailGateway {
  data = new Map<string, MailThread>();
  attempts: MutationPlan[] = [];
  failOn?: { id: string; when: "before" | "after" };
  accounts() { return [account]; }
  async verify() {}
  async labels() { return labels; }
  async listThreads(_account: string, query: string) {
    return [...this.data.values()].filter(thread => query.startsWith("in:inbox")
      ? thread.messages.some(message => message.labels.includes("INBOX"))
      : thread.messages.some(message => !message.labels.includes("STARRED") && ACTIVE_CATEGORIES.some(category => message.labels.includes(labels[category]!))))
      .map(thread => thread.id);
  }
  async thread(_account: string, id: string) {
    const thread = this.data.get(id); if (!thread) throw Error("SYNTHETIC_THREAD_MISSING");
    return structuredClone(thread);
  }
  async modify(_account: string, plan: MutationPlan) {
    this.attempts.push(structuredClone(plan));
    const failure = this.failOn && plan.ids.includes(this.failOn.id) ? this.failOn : undefined;
    if (failure) this.failOn = undefined;
    if (failure?.when === "before") throw Error("Synthetic connection lost before acknowledgement");
    for (const thread of this.data.values()) for (const message of thread.messages) if (plan.ids.includes(message.id)) {
      message.labels = [...new Set([...message.labels.filter(label => !plan.remove.includes(label)), ...plan.add])];
    }
    if (failure?.when === "after") throw Error("Synthetic response lost after write");
  }
}
async function fixture(count = 3) {
  const config = loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "lifeos-human-recovery-")), LIFE_OS_TRIAGE_APPLY_ENABLED: "true" });
  folders.push(config);
  const mail = new SyntheticMail();
  for (let index = 1; index <= count; index++) mail.data.set(`thread${index}`, { id: `thread${index}`, messages: [{
    id: `m${index}`, internalDate: 1000 * index, labels: ["INBOX", "UNREAD"], from: `Synthetic sender <sender${index}@example.com>`,
    to: account, subject: `Synthetic request ${index}`, body: `Please review synthetic request number ${index} today.`, truncated: false, attachments: false,
  }] });
  let now = new Date("2026-11-01T15:00:00Z");
  const decision: Decision = { category: "NEWSLETTER", confidence: 0.4, model: "synthetic-classifier", probabilities: Object.fromEntries(CATEGORIES.map(category => [category, category === "NEWSLETTER" ? 1 : 0])) as Decision["probabilities"] };
  const jobDependencies = { gateway: mail, classifier: { classify: async () => structuredClone(decision) }, now: () => now };
  const provider: AutomationProvider = { model: "synthetic-never-called", configured: () => true,
    review: async () => { throw Error("Human decisions must not invoke a model"); }, brief: async () => { throw Error("Human decisions must not send a brief"); } };
  let jobs = createJobService(config, logger, jobDependencies);
  await jobs.start({ mode: "apply" });
  let service = createAutomationService(config, logger, { jobs, provider, now: () => now });
  const selected = jobs.reviews().sort((a, b) => a.threadId.localeCompare(b.threadId));
  const input = (indices: number[], category: Category = "NEWSLETTER", rememberPreference = false) => ({
    items: indices.map(index => ({ itemId: selected[index]!.id, revision: selected[index]!.revision!, category })), rememberPreference,
  });
  return { config, mail, selected, input, get jobs() { return jobs; }, get service() { return service; },
    advance(ms = 61_000) { now = new Date(now.getTime() + ms); },
    restart(close = true) {
      if (close) closeDatabase(config);
      jobs = createJobService(config, logger, jobDependencies);
      service = createAutomationService(config, logger, { jobs, provider, now: () => now });
    },
  };
}
afterEach(() => { for (const config of folders.splice(0)) { closeDatabase(config); rmSync(config.home, { recursive: true, force: true }); } });

describe("human review crash windows with real SQLite and a synthetic Gmail gateway", () => {
  it("recovers a durable human acceptance when the old worker never checkpoints its accepted item status", async () => {
    const f = await fixture(), payload = f.input([0], "ACTION/SOON");
    const receipt = await f.service.command("review.bulkResolve", payload, "human-accept-crash-001", actor);
    const originalAccept = f.jobs.acceptHumanReview!.bind(f.jobs);
    let reached!: () => void, release!: () => void;
    const accepted = new Promise<void>(resolve => { reached = resolve; });
    const continueOldWorker = new Promise<void>(resolve => { release = resolve; });
    f.jobs.acceptHumanReview = async (...args) => {
      const result = await originalAccept(...args);
      reached(); await continueOldWorker; return result;
    };
    const oldService = f.service, running = oldService.tick(); await accepted;
    expect(f.jobs.humanReviewState?.(f.selected[0]!.id, "human-accept-crash-001")?.state).toBe("classified");
    expect(oldService.snapshot().reviewCommands?.[0]?.items[0]?.status).toBe("queued");
    expect(f.mail.attempts).toHaveLength(0);
    // Recover on the same database while the old in-flight completion still exists.
    // The replacement claims a new fence; the delayed worker must not checkpoint.
    f.restart(false); release(); await running;
    expect(f.service.snapshot().reviewCommands?.[0]?.items[0]?.status).toBe("queued");
    await f.service.tick();
    const recovered = await f.service.command("review.bulkResolve", payload, "human-accept-crash-001", actor);
    expect(recovered.reviewReceipt).toEqual(receipt.reviewReceipt);
    expect(recovered.reviewCommand).toMatchObject({ state: "completed", items: [{ status: "applied", category: "ACTION/SOON" }] });
    expect(f.mail.attempts.map(plan => plan.ids)).toEqual([["m1"]]);
    expect(f.mail.data.get("thread1")!.messages[0]!.labels).toContain(labels["ACTION/SOON"]);
    expect(f.mail.data.get("thread2")!.messages[0]!.labels).toContain("INBOX");
    await f.service.tick(); expect(f.mail.attempts).toHaveLength(1);
  });

  it("recovers acknowledged Gmail writes before command progress is saved without sending another mutation", async () => {
    const f = await fixture(), payload = f.input([0, 1], "NEWSLETTER", true);
    const receipt = await f.service.command("review.bulkResolve", payload, "human-applied-crash-001", actor);
    const originalApply = f.jobs.applyReviewed!.bind(f.jobs);
    let reached!: () => void, release!: () => void;
    const acknowledged = new Promise<void>(resolve => { reached = resolve; });
    const continueOldWorker = new Promise<void>(resolve => { release = resolve; });
    f.jobs.applyReviewed = async (...args) => {
      const result = await originalApply(...args);
      reached(); await continueOldWorker; return result;
    };
    const oldService = f.service, running = oldService.tick(); await acknowledged;
    expect(f.mail.attempts.map(plan => plan.ids)).toEqual([["m1"], ["m2"]]);
    expect(oldService.snapshot().reviewCommands?.[0]?.items.map(item => item.status)).toEqual(["accepted", "accepted"]);
    expect(f.jobs.senderPreferences?.()).toEqual([]);
    for (const item of f.selected.slice(0, 2)) expect(f.jobs.humanReviewState?.(item.id, "human-applied-crash-001")?.state).toBe("applied");
    f.restart(false); release(); await running;
    expect(f.service.snapshot().reviewCommands?.[0]?.items.map(item => item.status)).toEqual(["accepted", "accepted"]);
    await f.service.tick();
    const recovered = await f.service.command("review.bulkResolve", payload, "human-applied-crash-001", actor);
    expect(recovered.reviewReceipt).toEqual(receipt.reviewReceipt);
    expect(recovered.reviewCommand).toMatchObject({ state: "completed", items: [{ status: "applied", preferenceSaved: true }, { status: "applied", preferenceSaved: true }] });
    expect(f.mail.attempts).toHaveLength(2);
    expect(openDatabase(f.config).prepare("SELECT count(*) AS count FROM triage_mutation_attempts WHERE outcome='acknowledged'").get()?.count).toBe(2);
    expect(f.jobs.senderPreferences?.().map(value => value.sender)).toEqual(["sender1@example.com", "sender2@example.com"]);
    expect(f.mail.data.get("thread3")!.messages[0]!.labels).toContain("INBOX");
    await f.service.tick(); expect(f.mail.attempts).toHaveLength(2);
  });
});
