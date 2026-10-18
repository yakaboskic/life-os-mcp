import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../state/database.js";
import type { Category, Decision, JobRun, MutationPlan, ReviewItem, RunMode } from "./types.js";

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
  reviews(): ReviewItem[] { return this.db.prepare("SELECT json FROM triage_reviews WHERE resolved_at IS NULL ORDER BY rowid").all().map((row) => decode<ReviewItem>(row)!); }
  resolve(id: string, category: Category): ReviewItem {
    return transaction(this.db, () => {
      const item = this.work(id);
      const review = decode<ReviewItem>(this.db.prepare("SELECT json FROM triage_reviews WHERE id=? AND resolved_at IS NULL").get(id));
      if (!item || !review || item.kind !== "classify") throw new Error("REVIEW_NOT_RESOLVABLE");
      // A human category decision never authorizes replay of a partially applied mutation.
      if (item.plan && !["MAIL_CHANGED_BEFORE_APPLY"].includes(review.reason)) throw new Error("REVIEW_UNCERTAIN_MUTATION_REQUIRES_RECONCILIATION");
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
