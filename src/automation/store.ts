import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { transaction } from "../state/database.js";
import type { AutomationKind, AutomationRun, AutomationSchedule, AutomationReviewDecision, BriefDelivery, BriefingArtifact } from "./types.js";

export interface ReviewRecord extends AutomationReviewDecision { revision: string; policyVersion: string }
export interface StoredRun extends AutomationRun { approvedIds?: string[] }
export const LIMITS = { maxCalls: 24, maxInputTokens: 500_000, maxOutputTokens: 40_000 };
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const decode = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { json: string }).json) as T : undefined;

export class AutomationStore {
  constructor(readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS automation_settings (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_runs (id TEXT PRIMARY KEY, run_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_running_automation ON automation_runs(state) WHERE state='running';
      CREATE TABLE IF NOT EXISTS automation_commands (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_review_decisions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_briefings (id TEXT PRIMARY KEY, day TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_outbox (id TEXT PRIMARY KEY, delivery_key TEXT UNIQUE NOT NULL, state TEXT NOT NULL, created_at TEXT NOT NULL, json TEXT NOT NULL, raw TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS owned_generated_messages (account TEXT NOT NULL, rfc_message_id TEXT NOT NULL, gmail_message_id TEXT, PRIMARY KEY(account,rfc_message_id));
    `);
  }
  recover(now: string): void {
    for (const run of this.runs(1000).filter(item => item.state === "running")) { run.state = "queued"; run.errorCode = "DAEMON_RESTARTED"; delete run.claim; this.saveRun(run); }
    for (const entry of this.deliveries(1000).filter(item => item.state === "sending")) { entry.state = "uncertain"; entry.errorCode = "SEND_INTERRUPTED"; this.saveDelivery(entry); }
  }
  settings(): Omit<AutomationSchedule, "nextRunAt"> { return decode(this.db.prepare("SELECT json FROM automation_settings WHERE id=1").get()) ?? { enabled: false, localTime: "07:00", timeZone: "America/New_York", reviewEnabled: true, briefEnabled: true }; }
  setSettings(value: Omit<AutomationSchedule, "nextRunAt">): void { this.db.prepare("INSERT INTO automation_settings VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(JSON.stringify(value)); }
  command(id: string, payload: unknown, now: string, apply: () => void): void {
    transaction(this.db, () => {
      const hash = digest(payload); const prior = this.db.prepare("SELECT payload_hash FROM automation_commands WHERE id=?").get(id);
      if (prior) { if (prior.payload_hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT"); return; }
      apply(); this.db.prepare("INSERT INTO automation_commands VALUES(?,?,?)").run(id, hash, now);
    });
  }
  enqueue(key: string, kind: AutomationKind, day: string, now: string, actor: string, sourceRunId?: string, approvedIds?: string[]): StoredRun {
    const prior = decode<StoredRun>(this.db.prepare("SELECT json FROM automation_runs WHERE run_key=?").get(key)); if (prior) return prior;
    if (Number(this.db.prepare("SELECT count(*) AS n FROM automation_runs WHERE state IN ('queued','retry_wait')").get()!.n) >= 50) throw new Error("AUTOMATION_QUEUE_FULL");
    const run: StoredRun = { id: randomUUID(), kind, day, state: "queued", createdAt: now, attempts: 0, actor, stage: kind === "brief" ? "brief" : "review", reviewed: 0, applied: 0, held: 0, failed: 0, sourceRunId, approvedIds };
    this.db.prepare("INSERT INTO automation_runs VALUES(?,?,?,?,?)").run(run.id, key, run.state, now, JSON.stringify(run)); return run;
  }
  runs(limit = 30): StoredRun[] { return this.db.prepare("SELECT json FROM automation_runs ORDER BY created_at DESC,rowid DESC LIMIT ?").all(limit).map(row => decode<StoredRun>(row)!); }
  saveRun(run: StoredRun): void { this.db.prepare("UPDATE automation_runs SET state=?,json=? WHERE id=?").run(run.state, JSON.stringify(run), run.id); }
  claim(now: string): StoredRun | undefined {
    return transaction(this.db, () => {
      const run = this.db.prepare("SELECT json FROM automation_runs WHERE state IN ('queued','retry_wait') ORDER BY created_at,rowid").all().map(row => decode<StoredRun>(row)!).find(item => !item.nextAttemptAt || item.nextAttemptAt <= now);
      if (!run) return;
      run.state = "running"; run.claim = randomUUID(); run.startedAt ??= now; run.attempts++; delete run.nextAttemptAt; this.saveRun(run); return run;
    });
  }
  fenced(run: StoredRun): boolean { const current = decode<StoredRun>(this.db.prepare("SELECT json FROM automation_runs WHERE id=?").get(run.id)); return current?.state === "running" && current.claim === run.claim; }
  reviewKey(id: string, revision: string, policy: string): string { return digest([id, revision, policy]); }
  reviewRecord(key: string): ReviewRecord | undefined { return decode(this.db.prepare("SELECT json FROM automation_review_decisions WHERE id=?").get(key)); }
  saveReview(key: string, record: ReviewRecord): void { this.db.prepare("INSERT INTO automation_review_decisions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(key, JSON.stringify(record)); }
  accepted(): ReviewRecord[] { return this.db.prepare("SELECT json FROM automation_review_decisions").all().map(row => decode<ReviewRecord>(row)!).filter(item => item.state === "accepted"); }
  decisions(limit = 200): ReviewRecord[] { return this.db.prepare("SELECT json FROM automation_review_decisions ORDER BY rowid DESC LIMIT ?").all(limit).map(row => decode<ReviewRecord>(row)!); }
  briefing(day?: string): BriefingArtifact | undefined { return decode(day ? this.db.prepare("SELECT json FROM automation_briefings WHERE day=?").get(day) : this.db.prepare("SELECT json FROM automation_briefings ORDER BY day DESC LIMIT 1").get()); }
  saveBriefing(brief: BriefingArtifact): void { this.db.prepare("INSERT INTO automation_briefings VALUES(?,?,?,?)").run(brief.id, brief.day, brief.createdAt, JSON.stringify(brief)); }
  deliveries(limit = 30): BriefDelivery[] { return this.db.prepare("SELECT json FROM automation_outbox ORDER BY created_at DESC,rowid DESC LIMIT ?").all(limit).map(row => decode<BriefDelivery>(row)!); }
  outbox(day: string, recipient: string): BriefDelivery | undefined { return decode(this.db.prepare("SELECT json FROM automation_outbox WHERE delivery_key=?").get(`${day}:${recipient}`)); }
  createDelivery(entry: BriefDelivery, raw: string): void {
    transaction(this.db, () => {
      this.db.prepare("INSERT INTO automation_outbox VALUES(?,?,?,?,?,?)").run(entry.id, `${entry.day}:${entry.recipient}`, entry.state, entry.createdAt, JSON.stringify(entry), raw);
      this.db.prepare("INSERT INTO owned_generated_messages VALUES(?,?,NULL)").run(entry.account, entry.messageId);
    });
  }
  raw(entry: BriefDelivery): string { return this.db.prepare("SELECT raw FROM automation_outbox WHERE id=?").get(entry.id)!.raw as string; }
  saveDelivery(entry: BriefDelivery): void { transaction(this.db, () => {
    this.db.prepare("UPDATE automation_outbox SET state=?,json=? WHERE id=?").run(entry.state, JSON.stringify(entry), entry.id);
    if (entry.gmailMessageId) this.db.prepare("UPDATE owned_generated_messages SET gmail_message_id=? WHERE account=? AND rfc_message_id=?").run(entry.gmailMessageId, entry.account, entry.messageId);
  }); }
  usage(day: string) { const row = this.db.prepare("SELECT * FROM automation_usage WHERE day=?").get(day); return { day, calls: Number(row?.calls ?? 0), inputTokens: Number(row?.input_tokens ?? 0), outputTokens: Number(row?.output_tokens ?? 0), ...LIMITS }; }
  reserve(day: string, input: number, output: number): void {
    transaction(this.db, () => {
      const usage = this.usage(day);
      if (usage.calls >= LIMITS.maxCalls || usage.inputTokens + input > LIMITS.maxInputTokens || usage.outputTokens + output > LIMITS.maxOutputTokens) throw new Error("DAILY_MODEL_BUDGET_EXHAUSTED");
      this.db.prepare("INSERT INTO automation_usage VALUES(?,?,?,?) ON CONFLICT(day) DO UPDATE SET calls=excluded.calls,input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens").run(day, usage.calls + 1, usage.inputTokens + input, usage.outputTokens + output);
    });
  }
  settle(day: string, reservedInput: number, reservedOutput: number, input: number, output: number): void {
    // Failed/ambiguous API attempts retain their entire reservation. Successful usage can release unused capacity.
    this.db.prepare("UPDATE automation_usage SET input_tokens=input_tokens-?+?,output_tokens=output_tokens-?+? WHERE day=?").run(reservedInput, input, reservedOutput, output, day);
  }
}
