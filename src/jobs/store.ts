import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../state/database.js";
import { CATEGORIES, type Category, type Decision, type JobRun, type MutationPlan, type ReviewItem, type RunMode, type SenderPreference } from "./types.js";
import { JEV_MINIMUM_CONFIDENCE } from "./policy.js";

export type WorkState = "discovered" | "classified" | "applying" | "applied" | "retryable" | "needs_review" | "superseded";
export interface WorkItem {
  id: string; account: string; threadId: string; mode: RunMode; kind: "classify" | "complete" | "supersede";
  key: string; runId: string; createdAt: string; day: string; state: WorkState;
  subject: string; sender: string; triggerIds: string[]; triggerDate: number; revision: string; labelRevision?: string;
  rubricVersion?: string; rubricHash?: string;
  decision?: Decision; plan?: MutationPlan; reason?: string; supersedesTaskId?: string;
}
export interface TaskLink { account: string; threadId: string; taskId: string; workId: string; triggerDate: number; triggerIds: string[]; sender: string; subject: string; active: boolean }

export class JobStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, run_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, started_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_job ON job_runs(state) WHERE state = 'running';
      CREATE TABLE IF NOT EXISTS triage_work (id TEXT PRIMARY KEY, work_key TEXT UNIQUE NOT NULL, account TEXT NOT NULL, mode TEXT NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS triage_pending ON triage_work(account, mode, state);
      CREATE TABLE IF NOT EXISTS triage_reviews (id TEXT PRIMARY KEY REFERENCES triage_work(id), resolved_at TEXT, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS triage_task_links (account TEXT NOT NULL, thread_id TEXT NOT NULL, task_id TEXT NOT NULL, active INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(account,thread_id));
      CREATE TABLE IF NOT EXISTS triage_mutation_attempts (id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES triage_work(id), started_at TEXT NOT NULL, outcome TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS owned_generated_messages (account TEXT NOT NULL, rfc_message_id TEXT NOT NULL, gmail_message_id TEXT, PRIMARY KEY(account,rfc_message_id));
      CREATE TABLE IF NOT EXISTS triage_sender_preferences (id TEXT PRIMARY KEY, account TEXT NOT NULL, sender TEXT NOT NULL, active INTEGER NOT NULL, json TEXT NOT NULL, UNIQUE(account,sender));
    `);
  }
  recoverInterrupted(): void {
    for (const run of this.history(1000).filter((item) => item.state === "running")) this.saveRun({ ...run, state: "interrupted", finishedAt: new Date().toISOString(), errorCode: "DAEMON_RESTARTED" });
  }
  run(id: string): JobRun | undefined { return decode<JobRun>(this.db.prepare("SELECT json FROM job_runs WHERE id=?").get(id)); }
  runByKey(key: string): JobRun | undefined { return decode<JobRun>(this.db.prepare("SELECT json FROM job_runs WHERE run_key=?").get(key)); }
  insertRun(run: JobRun, key: string): void { this.db.prepare("INSERT INTO job_runs VALUES(?,?,?,?,?)").run(run.id, key, run.state, run.startedAt, JSON.stringify(run)); }
  saveRun(run: JobRun): void { this.db.prepare("UPDATE job_runs SET state=?,json=? WHERE id=?").run(run.state, JSON.stringify(run), run.id); }
  history(limit = 20): JobRun[] { return this.db.prepare("SELECT json FROM job_runs ORDER BY started_at DESC, rowid DESC LIMIT ?").all(Math.max(1, Math.min(limit, 1000))).map((row) => decode<JobRun>(row)!); }
  workByKey(key: string): WorkItem | undefined { return decode<WorkItem>(this.db.prepare("SELECT json FROM triage_work WHERE work_key=?").get(key)); }
  work(id: string): WorkItem | undefined { return decode<WorkItem>(this.db.prepare("SELECT json FROM triage_work WHERE id=?").get(id)); }
  insertWork(item: WorkItem): void { this.db.prepare("INSERT INTO triage_work VALUES(?,?,?,?,?,?,?)").run(item.id, item.key, item.account, item.mode, item.state, item.createdAt, JSON.stringify(item)); }
  saveWork(item: WorkItem): void { this.db.prepare("UPDATE triage_work SET state=?,json=? WHERE id=?").run(item.state, JSON.stringify(item), item.id); }
  works(account: string, mode: RunMode): WorkItem[] { return this.db.prepare("SELECT json FROM triage_work WHERE account=? AND mode=? ORDER BY created_at").all(account, mode).map((row) => decode<WorkItem>(row)!); }
  review(item: WorkItem, reason: string): void {
    transaction(this.db, () => {
      item.state = "needs_review"; item.reason = reason; this.saveWork(item);
      const review: ReviewItem = { id: item.id, account: item.account, threadId: item.threadId, subject: item.subject, sender: item.sender, category: item.decision?.category, confidence: item.decision?.confidence, reason, createdAt: new Date().toISOString() };
      this.db.prepare("INSERT INTO triage_reviews VALUES(?,NULL,?) ON CONFLICT(id) DO UPDATE SET resolved_at=NULL,json=excluded.json").run(item.id, JSON.stringify(review));
    });
  }
  reviewItem(id: string): ReviewItem | undefined {
    const review = decode<ReviewItem>(this.db.prepare("SELECT json FROM triage_reviews WHERE id=? AND resolved_at IS NULL").get(id));
    if (!review) return;
    const work = this.work(id);
    const decision = work?.decision;
    // Do not relabel a later human/Claude decision as the original Jev result.
    const classification = typeof decision?.model === "string" && decision.model.startsWith("jev-") && !decision.reviewed && !decision.agentReview && !decision.humanReview && CATEGORIES.includes(decision.category) && Number.isFinite(decision.confidence) && decision.confidence >= 0 && decision.confidence <= 1
      ? { provider: "jev" as const, model: decision.model, category: decision.category, confidence: decision.confidence,
          probabilities: Object.fromEntries(CATEGORIES.flatMap(category => { const value = decision.probabilities?.[category]; return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? [[category, value]] : []; })), minimumConfidence: JEV_MINIMUM_CONFIDENCE }
      : undefined;
    return { ...review, ...(classification ? { classification } : {}), mode: work?.mode, revision: work?.revision, reviewable: work?.mode === "apply" && work.kind === "classify" && work.state === "needs_review" && !work.plan && review.reason === "LOW_CONFIDENCE" && !this.hasAttempt(id) };
  }
  reviews(): ReviewItem[] { return this.db.prepare("SELECT id FROM triage_reviews WHERE resolved_at IS NULL ORDER BY rowid").all().map(row => this.reviewItem(row.id as string)!); }
  hasAttempt(id: string): boolean { return !!this.db.prepare("SELECT 1 FROM triage_mutation_attempts WHERE work_id=? LIMIT 1").get(id); }
  hasHumanIntent(id: string): boolean { return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_human_review_intents'").get() && !!this.db.prepare("SELECT 1 FROM automation_human_review_intents WHERE item_id=?").get(id); }
  acceptHuman(id: string, decision: Decision): ReviewItem {
    return transaction(this.db, () => {
      const item = this.work(id), review = this.reviewItem(id);
      if (!item || !review?.reviewable || !decision.humanReview || item.revision !== decision.humanReview.revision || this.hasAttempt(id)) throw new Error("REVIEW_NOT_RESOLVABLE");
      item.decision = decision; item.state = "classified"; delete item.reason; this.saveWork(item);
      review.category = decision.category; review.resolvedAt = new Date().toISOString();
      this.db.prepare("UPDATE triage_reviews SET resolved_at=?,json=? WHERE id=?").run(review.resolvedAt, JSON.stringify(review), id);
      return review;
    });
  }
  preference(account: string, sender: string): { version: number; preference?: SenderPreference } {
    const row = this.db.prepare("SELECT active,json FROM triage_sender_preferences WHERE account=? AND sender=?").get(account, sender);
    const value = decode<SenderPreference>(row);
    return { version: value?.version ?? 0, ...(row?.active && value ? { preference: value } : {}) };
  }
  preferences(accounts: string[]): SenderPreference[] { return this.db.prepare("SELECT json FROM triage_sender_preferences WHERE active=1 ORDER BY account,sender").all().map(row => decode<SenderPreference>(row)!).filter(item => accounts.includes(item.account)); }
  rememberPreference(account: string, sender: string, category: Category, expectedVersion: number): boolean {
    return transaction(this.db, () => {
      const current = this.preference(account, sender);
      if (current.version !== expectedVersion) return current.preference?.category === category;
      const now = new Date().toISOString(), id = createHash("sha256").update(JSON.stringify([account,sender])).digest("hex");
      const value: SenderPreference = { id, account, sender, category, createdAt: current.preference?.createdAt ?? now, updatedAt: now, version: current.version + 1 };
      this.db.prepare("INSERT INTO triage_sender_preferences VALUES(?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET active=1,json=excluded.json").run(id,account,sender,JSON.stringify(value)); return true;
    });
  }
  forgetPreference(id: string, accounts: string[]): void {
    const row = this.db.prepare("SELECT json FROM triage_sender_preferences WHERE id=? AND active=1").get(id), value = decode<SenderPreference>(row);
    if (!value || !accounts.includes(value.account)) throw new Error("PREFERENCE_NOT_FOUND");
    this.db.prepare("UPDATE triage_sender_preferences SET active=0,json=? WHERE id=?").run(JSON.stringify({ ...value, version: value.version + 1, updatedAt: new Date().toISOString() }), id);
  }
  isOwnedMessage(account: string, id: string, rfcId?: string): boolean { return !!this.db.prepare("SELECT 1 FROM owned_generated_messages WHERE account=? AND (gmail_message_id=? OR rfc_message_id=?)").get(account, id, rfcId ?? ""); }
  acceptAgent(id: string, decision: Decision): ReviewItem {
    return transaction(this.db, () => {
      if (this.hasHumanIntent(id)) throw new Error("REVIEW_HUMAN_PENDING");
      const item = this.work(id); const review = this.reviews().find((entry) => entry.id === id);
      if (!item || !review?.reviewable || !decision.agentReview || item.revision !== decision.agentReview.revision) throw new Error("REVIEW_NOT_RESOLVABLE");
      item.decision = decision; item.state = "classified"; delete item.reason; this.saveWork(item);
      review.category = decision.category; review.confidence = decision.confidence; review.resolvedAt = new Date().toISOString();
      this.db.prepare("UPDATE triage_reviews SET resolved_at=?,json=? WHERE id=?").run(review.resolvedAt, JSON.stringify(review), id);
      return review;
    });
  }
  resolve(id: string, category: Category): ReviewItem {
    return transaction(this.db, () => {
      if (this.hasHumanIntent(id)) throw new Error("REVIEW_HUMAN_PENDING");
      const item = this.work(id);
      const review = decode<ReviewItem>(this.db.prepare("SELECT json FROM triage_reviews WHERE id=? AND resolved_at IS NULL").get(id));
      if (!item || !review || item.kind !== "classify") throw new Error("REVIEW_NOT_RESOLVABLE");
      // A human category decision never authorizes replay of a partially applied mutation.
      if (this.hasAttempt(id) || item.plan && !["MAIL_CHANGED_BEFORE_APPLY"].includes(review.reason)) throw new Error("REVIEW_UNCERTAIN_MUTATION_REQUIRES_RECONCILIATION");
      item.decision = { category, confidence: 1, probabilities: {} as Decision["probabilities"], model: "human", reviewed: true };
      // Explicit review may replace a never-attempted plan. Uncertain writes remain unreplayable.
      delete item.plan; delete item.labelRevision;
      item.state = "classified"; delete item.reason; this.saveWork(item);
      review.category = category; review.resolvedAt = new Date().toISOString();
      this.db.prepare("UPDATE triage_reviews SET resolved_at=?,json=? WHERE id=?").run(review.resolvedAt, JSON.stringify(review), id);
      return review;
    });
  }
  links(account: string): TaskLink[] { return this.db.prepare("SELECT json FROM triage_task_links WHERE account=?").all(account).map((row) => decode<TaskLink>(row)!); }
  saveLink(link: TaskLink): void { this.db.prepare("INSERT INTO triage_task_links VALUES(?,?,?,?,?) ON CONFLICT(account,thread_id) DO UPDATE SET task_id=excluded.task_id,active=excluded.active,json=excluded.json").run(link.account, link.threadId, link.taskId, link.active ? 1 : 0, JSON.stringify(link)); }
  attempt(item: WorkItem): string {
    const id = randomUUID();
    transaction(this.db, () => { item.state = "applying"; this.saveWork(item); this.db.prepare("INSERT INTO triage_mutation_attempts VALUES(?,?,?,?)").run(id, item.id, new Date().toISOString(), "uncertain"); });
    return id;
  }
  attemptOutcome(id: string, outcome: string): void { this.db.prepare("UPDATE triage_mutation_attempts SET outcome=? WHERE id=?").run(outcome, id); }
}
function decode<T>(row: unknown): T | undefined { return row ? JSON.parse((row as { json: string }).json) as T : undefined; }
