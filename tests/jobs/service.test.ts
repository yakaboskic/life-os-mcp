import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { closeDatabase, openDatabase } from "../../src/state/database.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { createJobService, easternDay, nextRunAt } from "../../src/jobs/service.js";
import { JobStore } from "../../src/jobs/store.js";
import { AuthError } from "../../src/core/errors.js";
import { CATEGORIES, ACTIVE_CATEGORIES, type Category, type Classifier, type Decision, type MailGateway, type MailMessage, type MailThread, type MutationPlan } from "../../src/jobs/types.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
const account = "owner@example.com";
const folders: ReturnType<typeof loadConfig>[] = [];
const labels = Object.fromEntries([...CATEGORIES, "ACTION/DONE"].map((name) => [name, `Label_${name}`]));
function message(id: string, additions: Partial<MailMessage> = {}): MailMessage {
  return { id, internalDate: Number(id.replace(/\D/g, "")) * 1000 || 1000, labels: ["INBOX", "UNREAD"], from: "Sender <sender@example.com>", to: account, subject: "Please review the proposal", body: "Please review and approve the attached proposal today.", truncated: false, attachments: false, ...additions };
}
function decision(category: Category = "ACTION/NOW", confidence = 0.99): Decision {
  return { category, confidence, model: "jev-1.13.0", probabilities: Object.fromEntries(CATEGORIES.map((item) => [item, item === category ? 1 : 0])) as Decision["probabilities"] };
}
class FakeMail implements MailGateway {
  data = new Map<string, MailThread>();
  mutations: MutationPlan[] = [];
  labelCreates = 0;
  onModify?: (plan: MutationPlan) => void;
  throwAfterWrite = false;
  throwBeforeWrite = false;
  accountList = [account];
  accounts() { return this.accountList; }
  async verify() {}
  async labels(_account: string, create: boolean) { if (create) this.labelCreates++; return labels; }
  async listThreads(_account: string, query: string) {
    return [...this.data.values()].filter((thread) => query.startsWith("in:inbox") ? thread.messages.some((item) => item.labels.includes("INBOX")) : thread.messages.some((item) => !item.labels.includes("STARRED") && ACTIVE_CATEGORIES.some((category) => item.labels.includes(labels[category]!)))).map((thread) => thread.id);
  }
  async thread(_account: string, id: string) { const value = this.data.get(id); if (!value) throw new Error("NOT_FOUND"); return structuredClone(value); }
  async modify(_account: string, plan: MutationPlan) {
    this.mutations.push(structuredClone(plan));
    this.onModify?.(plan);
    if (this.throwBeforeWrite) { this.throwBeforeWrite = false; throw new Error("Simulated disconnected socket"); }
    for (const thread of this.data.values()) for (const item of thread.messages) if (plan.ids.includes(item.id)) item.labels = [...new Set([...item.labels.filter((label) => !plan.remove.includes(label)), ...plan.add])];
    if (this.throwAfterWrite) { this.throwAfterWrite = false; throw new Error("Simulated lost response"); }
  }
  add(id: string, messages = [message("m1")]) { this.data.set(id, { id, messages }); }
}
function fixture(classifier?: Classifier) {
  const config = loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "lifeos-jobs-")), LIFE_OS_TRIAGE_APPLY_ENABLED: "true" });
  folders.push(config);
  const mail = new FakeMail();
  let clock = new Date("2026-10-18T09:53:00Z");
  const dependencies = { gateway: mail, classifier: classifier ?? { classify: async () => decision() }, now: () => clock };
  return { config, mail, dependencies, service: createJobService(config, logger, dependencies), track: new TrackStore(config), tomorrow() { clock = new Date(clock.getTime() + 86400_000); } };
}
afterEach(() => { for (const config of folders.splice(0)) { closeDatabase(config); rmSync(config.home, { recursive: true, force: true }); } });

describe("Gmail durable jobs", () => {
  it("dry runs never create labels, mutate Gmail, or create local tasks; apply has a separate journal", async () => {
    const f = fixture(); f.mail.add("thread1");
    expect((await f.service.start({ mode: "dry-run", scheduled: true })).state).toBe("success");
    expect(f.mail.labelCreates).toBe(0); expect(f.mail.mutations).toHaveLength(0); expect(f.track.loadRegistry().tasks).toHaveLength(0);
    const apply = await f.service.start({ mode: "apply", scheduled: true });
    expect(apply.state).toBe("success"); expect(f.mail.mutations).toHaveLength(1); expect(f.track.loadRegistry().tasks).toHaveLength(1);
    expect(await f.service.start({ mode: "apply", scheduled: true })).toEqual(apply);
  });
  it("reports a bounded shadow decision sample and category evidence without email bodies", async () => {
    const f = fixture(); f.mail.add("thread1", [message("m1", { body: "Private message body, never in the report." })]);
    await f.service.start({ mode: "dry-run" });
    const report = readFileSync(join(f.config.triageLogDir, "email.md"), "utf8");
    expect(report).toContain("## 2026-10-18 — dry-run");
    expect(report).toContain("Shadow mode made no Gmail or task changes");
    expect(report).toContain("ACTION/NOW: 1 decisions; 1 meet the confidence threshold");
    expect(report).toContain("confidence 0.990"); expect(report).toContain("### Decision sample (1 of 1)");
    expect(report).not.toContain("Private message body"); expect(report).not.toContain("| Account |");
  });
  it("reconciles a lost Gmail write response without a duplicate mutation or task", async () => {
    const f = fixture(); f.mail.add("thread1"); f.mail.throwAfterWrite = true;
    const first = await f.service.start({ mode: "apply" });
    expect(first.accounts[0]?.failed).toBe(1); expect(f.track.loadRegistry().tasks).toHaveLength(0);
    const restarted = createJobService(f.config, logger, f.dependencies);
    await restarted.start({ mode: "apply", retryRunId: first.id });
    expect(f.mail.mutations).toHaveLength(1); expect(f.track.loadRegistry().tasks).toHaveLength(1);
    await restarted.start({ mode: "apply" }); expect(f.track.loadRegistry().tasks).toHaveLength(1);
  });
  it("holds an uncertain mutation even when labels are unchanged, since a user may have undone it", async () => {
    const f = fixture(); f.mail.add("thread1"); f.mail.throwBeforeWrite = true;
    await f.service.start({ mode: "apply" }); await f.service.start({ mode: "apply" });
    expect(f.mail.mutations).toHaveLength(1); expect(f.service.reviews()[0]?.reason).toBe("UNCERTAIN_GMAIL_MUTATION");
    expect(() => f.service.resolve(f.service.reviews()[0]!.id, "ACTION/NOW")).toThrow(/UNCERTAIN/);
  });
  it("holds a decision if new mail arrives during classification", async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ classify: async () => { f.mail.data.get("thread1")!.messages.push(message("m2")); return decision(); } });
    f.mail.add("thread1"); await f.service.start({ mode: "apply" });
    expect(f.mail.mutations).toHaveLength(0); expect(f.service.reviews()[0]?.reason).toBe("MAIL_CHANGED_BEFORE_APPLY");
  });
  it("mutates captured message ids only when mail arrives during the write", async () => {
    const f = fixture(); f.mail.add("thread1");
    f.mail.onModify = () => { f.mail.data.get("thread1")!.messages.push(message("m2")); };
    await f.service.start({ mode: "apply" });
    expect(f.mail.mutations[0]?.ids).toEqual(["m1"]);
    expect(f.mail.data.get("thread1")!.messages[1]?.labels).toContain("INBOX");
  });
  it("ignores UNREAD and unrelated labels when validating a planned mutation", async () => {
    let f: ReturnType<typeof fixture>;
    f = fixture({ classify: async () => { f.mail.data.get("thread1")!.messages[0]!.labels = ["INBOX", "Label_personal"]; return decision(); } });
    f.mail.add("thread1"); await f.service.start({ mode: "apply" });
    expect(f.mail.mutations).toHaveLength(1); expect(f.mail.data.get("thread1")!.messages[0]!.labels).toContain("Label_personal");
  });
  it("keeps low-confidence messages untouched and applies a reviewed category on a later run", async () => {
    const f = fixture({ classify: async () => decision("NEWSLETTER", 0.4) }); f.mail.add("thread1");
    await f.service.start({ mode: "apply" }); expect(f.mail.mutations).toHaveLength(0);
    const review = f.service.reviews()[0]!; f.service.resolve(review.id, "ACTION/SOON");
    await f.service.start({ mode: "apply" }); expect(f.mail.mutations).toHaveLength(1); expect(f.track.loadRegistry().tasks[0]?.title).toContain("ACTION/SOON");
  });
  it("does not complete a partly starred thread returned by Gmail's message-level search", async () => {
    const f = fixture();
    f.mail.add("thread1", [message("m1", { labels: [labels["ACTION/NOW"]!, "STARRED"] }), message("m2", { labels: [labels["ACTION/NOW"]!] })]);
    await f.service.start({ mode: "apply" }); expect(f.mail.mutations).toHaveLength(0);
  });
  it("completes unstarred archived actions and closes only the linked task", async () => {
    const f = fixture(); f.mail.add("thread1"); await f.service.start({ mode: "apply" });
    const manual = f.track.addTask({ title: "Unrelated action" });
    f.mail.data.get("thread1")!.messages[0]!.labels = [labels["ACTION/NOW"]!];
    await f.service.start({ mode: "apply" });
    expect(f.mail.data.get("thread1")!.messages[0]!.labels).toContain(labels["ACTION/DONE"]!);
    expect(f.track.loadRegistry().tasks.find((task) => task.id !== manual.id)?.status).toBe("done");
    expect(f.track.resolveTask(manual.id).status).toBe("open");
  });
  it("transfers an older same-subject task without losing user edits or clearing old stars", async () => {
    const f = fixture(); f.mail.add("old"); await f.service.start({ mode: "apply" });
    const task = f.track.loadRegistry().tasks[0]!; f.track.updateTask(task.id, { title: "My edited title", notes: "My private notes" });
    f.mail.add("new", [message("m2", { subject: "Re: Please review the proposal" })]);
    await f.service.start({ mode: "apply" });
    expect(f.track.loadRegistry().tasks).toHaveLength(1); expect(f.track.resolveTask(task.id).title).toBe("My edited title");
    expect(f.mail.data.get("old")!.messages[0]!.labels).toContain("STARRED");
    expect(f.mail.data.get("old")!.messages[0]!.labels).not.toContain(labels["ACTION/NOW"]!);
    // Even a later manual unstar on the old thread cannot close the newer task.
    f.mail.data.get("old")!.messages[0]!.labels = [labels["ACTION/NOW"]!];
    await f.service.start({ mode: "apply" }); expect(f.track.resolveTask(task.id).status).toBe("open");
  });
  it("does not close a replied task when newer inbound mail remains unresolved", async () => {
    const f = fixture(); f.mail.add("thread1"); await f.service.start({ mode: "apply" });
    f.mail.data.get("thread1")!.messages.push(message("m2", { labels: ["SENT"], from: account }), message("m3"));
    await f.service.start({ mode: "apply" }); expect(f.track.loadRegistry().tasks).toHaveLength(1); expect(f.track.loadRegistry().tasks[0]?.status).toBe("open");
  });
  it("keeps held work from starving later inbox threads", async () => {
    const f = fixture({ classify: async (input) => decision("ACTION/NOW", input.thread.id === "held" ? 0.2 : 0.99) });
    f.mail.add("held"); await f.service.start({ mode: "apply" });
    f.mail.add("later", [message("m2")]); await f.service.start({ mode: "apply" });
    expect(f.track.loadRegistry().tasks).toHaveLength(1); expect(f.mail.mutations[0]?.ids).toEqual(["m2"]);
  });
  it("enforces the 100 new threads per account and local day budget across manual runs", async () => {
    const f = fixture(); for (let i = 1; i <= 103; i++) f.mail.add(`thread${i}`, [message(`m${i}`, { subject: `Unique ${i}` })]);
    await f.service.start({ mode: "dry-run" }); await f.service.start({ mode: "dry-run" });
    expect(new JobStore(openDatabase(f.config)).works(account, "dry-run")).toHaveLength(100);
    f.tomorrow(); await f.service.start({ mode: "dry-run" });
    expect(new JobStore(openDatabase(f.config)).works(account, "dry-run")).toHaveLength(103);
  });
  it("drains active work and refuses new jobs until resumed", async () => {
    const f = fixture(); await f.service.drain(); await expect(f.service.start({ mode: "dry-run" })).rejects.toThrow("JOBS_DRAINING");
    f.service.resume(); expect((await f.service.start({ mode: "dry-run" })).state).toBe("success");
  });
  it("isolates a revoked account while processing another account", async () => {
    const f = fixture();
    f.mail.accountList = ["revoked@example.com", account]; f.mail.add("thread1");
    f.mail.verify = async (...args: unknown[]) => { if (args[0] === "revoked@example.com") throw new AuthError("Revoked"); };
    const run = await f.service.start({ mode: "dry-run" });
    expect(run.accounts[0]?.state).toBe("auth_blocked"); expect(run.accounts[1]?.processed).toBe(1);
  });
  it("rejects apply until explicitly enabled after shadow evaluation", async () => {
    const f = fixture(); delete f.config.env.LIFE_OS_TRIAGE_APPLY_ENABLED;
    await expect(f.service.start({ mode: "apply" })).rejects.toThrow("TRIAGE_APPLY_DISABLED");
    expect(f.mail.labelCreates).toBe(0);
  });
  it("retains relevant user changes made after a low-confidence review was queued", async () => {
    const f = fixture({ classify: async () => decision("NEWSLETTER", 0.4) }); f.mail.add("thread1");
    await f.service.start({ mode: "apply" });
    f.mail.data.get("thread1")!.messages[0]!.labels.push("STARRED");
    // A retry alone is never authorization to overwrite the user's new star.
    await f.service.start({ mode: "apply" }); expect(f.mail.mutations).toHaveLength(0);
    expect(f.mail.data.get("thread1")!.messages[0]!.labels).toContain("STARRED");
  });
  it("backfills legacy tasks only from exact account bindings and rejects conflicting accounts", async () => {
    const f = fixture(); const project = f.track.addProject({ name: "Email" });
    f.mail.add("exact", [message("m1", { labels: [labels["ACTION/NOW"]!, "STARRED"] })]);
    f.mail.add("mention", [message("m2", { labels: [labels["ACTION/NOW"]!, "STARRED"] })]);
    f.mail.add("conflict", [message("m3", { labels: [labels["ACTION/NOW"]!, "STARRED"] })]);
    f.track.addTask({ title: "Valid legacy task", project: project.id, notes: `Account: ${account}\nhttps://mail.google.com/mail/u/0/#all/exact` });
    f.track.addTask({ title: "Unbound mention", project: project.id, notes: `Ask ${account} about https://mail.google.com/mail/u/0/#all/mention` });
    f.track.addTask({ title: "Conflicting binding", project: project.id, notes: `Account: ${account}\nhttps://mail.google.com/mail/u/?authuser=other@example.com#all/conflict` });
    await f.service.start({ mode: "apply" });
    expect(new JobStore(openDatabase(f.config)).links(account).map((item) => item.threadId)).toEqual(["exact"]);
  });
});

describe("Eastern schedule", () => {
  it("runs at 05:53 local time across both daylight saving transitions", () => {
    expect(nextRunAt(new Date("2026-03-07T11:00:00Z"))).toBe("2026-03-08T09:53:00.000Z");
    expect(nextRunAt(new Date("2026-10-31T11:00:00Z"))).toBe("2026-11-01T10:53:00.000Z");
    expect(easternDay(new Date("2026-10-18T01:00:00Z"))).toBe("2026-10-17");
  });
});
