import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LifeOsConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { AuthError } from "../core/errors.js";
import { writeAtomic } from "../core/fsutil.js";
import { openDatabase, transaction } from "../state/database.js";
import { TrackStore } from "../toolsets/track/store.js";
import { GmailJobGateway } from "./gmail.js";
import { CATEGORY_CRITERIA, JevClassifier } from "./jev.js";
import { JobStore, type WorkItem } from "./store.js";
import { ACTIVE_CATEGORIES, CATEGORIES, RUBRIC_VERSION, TIME_ZONE, type AgentReviewContext, type AgentReviewProposal, type AccountResult, type Category, type Classifier, type JobRun, type JobService, type JobStatus, type MailGateway, type MailMessage, type MailThread, type MutationPlan, type ReviewItem, type StartJobInput } from "./types.js";

export type { JobService, JobRun, JobStatus, ReviewItem, StartJobInput } from "./types.js";
export interface JobDependencies { gateway?: MailGateway; classifier?: Classifier; now?: () => Date; deadlineMs?: number }
const STAR_CATEGORIES = new Set<Category>(ACTIVE_CATEGORIES);
const ACTION_CATEGORIES = new Set<Category>(["ACTION/NOW", "ACTION/SOON"]);
const RUBRIC_HASH = hash([RUBRIC_VERSION, CATEGORY_CRITERIA]);
const TERMINAL_WORK = new Set(["applied", "needs_review", "superseded"]);
const partsFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function easternParts(date: Date): Record<string, number> { return Object.fromEntries(partsFormatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])); }
export function easternDay(date: Date): string { const p = easternParts(date); return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`; }
export function nextRunAt(now: Date): string {
  const parts = easternParts(now);
  for (let days = 0; days < 3; days++) {
    const localTarget = Date.UTC(parts.year!, parts.month! - 1, parts.day! + days, 5, 53);
    let candidate = localTarget;
    for (let i = 0; i < 3; i++) {
      const actual = easternParts(new Date(candidate));
      candidate += localTarget - Date.UTC(actual.year!, actual.month! - 1, actual.day!, actual.hour!, actual.minute!);
    }
    if (candidate > now.getTime()) return new Date(candidate).toISOString();
  }
  throw new Error("SCHEDULE_TIME_INVALID");
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function normalizeSubject(subject: string): string { return subject.replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/gi, "").replace(/\s+/g, " ").trim().toLowerCase(); }
function senderAddress(from: string): string { return (from.match(/<([^<>]+)>/)?.[1] ?? from).trim().toLowerCase(); }
function eligible(thread: MailThread): MailMessage[] { return thread.messages.filter((message) => !message.labels.includes("DRAFT")); }
function incoming(message: MailMessage): boolean { return !message.labels.includes("SENT") && !message.labels.includes("DRAFT"); }
function newer(a: Pick<MailMessage, "id" | "internalDate">, b: Pick<MailMessage, "id" | "internalDate">): boolean { return a.internalDate > b.internalDate || a.internalDate === b.internalDate && a.id > b.id; }
function revision(thread: MailThread): string { return hash(eligible(thread).map(({ id, internalDate, from, to, subject, body }) => ({ id, internalDate, from, to, subject, body }))); }
function relevantLabels(labels: string[], names: Record<string, string>): string[] {
  const relevant = new Set(["INBOX", "STARRED", "SPAM", "TRASH", "SENT", "DRAFT", ...[...CATEGORIES, "ACTION/DONE"].map((name) => names[name]).filter((id): id is string => !!id)]);
  return labels.filter((label) => relevant.has(label)).sort();
}
function sameLabels(a: string[], b: string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
function errorCode(error: unknown): string {
  if (error instanceof AuthError) return "GMAIL_AUTH_BLOCKED";
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)) return error.message;
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) return "RUN_DEADLINE";
  return "UPSTREAM_FAILURE";
}

export function createJobService(config: LifeOsConfig, logger: Logger, dependencies: JobDependencies = {}): JobService {
  return new GmailTriageService(config, logger, dependencies);
}

class GmailTriageService implements JobService {
  private readonly store: JobStore;
  private readonly track: TrackStore;
  private readonly gateway: MailGateway;
  private readonly classifier: Classifier;
  private readonly now: () => Date;
  private readonly deadlineMs: number;
  private active: JobRun | null = null;
  private running: Promise<JobRun> | null = null;
  private paused = false;

  constructor(private readonly config: LifeOsConfig, private readonly logger: Logger, dependencies: JobDependencies) {
    this.store = new JobStore(openDatabase(config));
    this.store.recoverInterrupted();
    this.track = new TrackStore(config);
    this.gateway = dependencies.gateway ?? new GmailJobGateway(config, logger);
    this.classifier = dependencies.classifier ?? new JevClassifier(() => {
      if (config.env.TYPESAFE_API_KEY) return config.env.TYPESAFE_API_KEY;
      const path = config.env.TYPESAFE_API_KEY_FILE;
      return path ? readFileSync(path, "utf8").trim() : undefined;
    });
    this.now = dependencies.now ?? (() => new Date());
    this.deadlineMs = dependencies.deadlineMs ?? 45 * 60_000;
  }
  history(limit?: number): JobRun[] { return this.store.history(limit); }
  reviews(): ReviewItem[] { return this.store.reviews(); }
  resolve(id: string, category: Category): ReviewItem {
    if (!CATEGORIES.includes(category)) throw new Error("INVALID_CATEGORY");
    if (this.active || this.paused) throw new Error("JOBS_BUSY");
    return this.store.resolve(id, category);
  }
  private async readThread(account: string, id: string, signal: AbortSignal): Promise<MailThread> {
    const thread = await this.gateway.thread(account, id, signal);
    return { ...thread, messages: thread.messages.filter(message => !this.store.isOwnedMessage(account, message.id, message.rfcMessageId)) };
  }
  async reviewContext(id: string, signal: AbortSignal): Promise<AgentReviewContext> {
    if (this.active || this.paused) throw new Error("JOBS_BUSY");
    const work = this.store.work(id); const review = this.reviews().find(item => item.id === id);
    if (!work || !review?.reviewable || !this.gateway.accounts().includes(work.account)) throw new Error("REVIEW_NOT_ELIGIBLE");
    await this.gateway.verify(work.account, signal);
    const labels = await this.gateway.labels(work.account, false, signal);
    const thread = await this.readThread(work.account, work.threadId, signal);
    if (revision(thread) !== work.revision || work.labelRevision !== hash(thread.messages.map(message => [message.id, relevantLabels(message.labels, labels)]))) throw new Error("REVIEW_EVIDENCE_CHANGED");
    const messages = eligible(thread);
    if (!messages.length || messages.length > 50 || messages.some(message => message.truncated) || messages.reduce((sum, message) => sum + message.body.length, 0) > 60_000 || messages.filter(incoming).some(message => !message.body.trim())) throw new Error("REVIEW_INCOMPLETE_CONTEXT");
    return { itemId: id, revision: work.revision, policyVersion: "lifeos-review-v1", account: work.account, now: this.now().toISOString(), thread, triggerIds: work.triggerIds, proposedCategory: work.decision?.category };
  }
  async acceptAgentReview(proposal: AgentReviewProposal, model: string, signal: AbortSignal): Promise<ReviewItem> {
    const context = await this.reviewContext(proposal.itemId, signal);
    if (proposal.revision !== context.revision || proposal.policyVersion !== context.policyVersion || !proposal.clear || proposal.needsMoreContext || !Number.isFinite(proposal.confidence) || proposal.confidence < 0.95 || proposal.confidence > 1 || !proposal.category || !CATEGORIES.includes(proposal.category)) throw new Error("REVIEW_NOT_CLEAR");
    if (!proposal.reason.trim() || proposal.reason.length > 600 || proposal.evidence.length < 1 || proposal.evidence.length > 3 || !model.startsWith("claude-")) throw new Error("REVIEW_INVALID_EVIDENCE");
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    if (!proposal.evidence.some(evidence => context.triggerIds.includes(evidence.messageId)) || proposal.evidence.some(evidence => {
      const message = context.thread.messages.find(item => item.id === evidence.messageId && incoming(item));
      return !message || evidence.quote.length < 12 || evidence.quote.length > 240 || !normalize(message.body).includes(normalize(evidence.quote));
    })) throw new Error("REVIEW_INVALID_EVIDENCE");
    if (this.active || this.paused) throw new Error("JOBS_BUSY");
    return this.store.acceptAgent(proposal.itemId, { category: proposal.category, confidence: proposal.confidence, probabilities: {} as Record<Category, number>, model, agentReview: { policyVersion: proposal.policyVersion, revision: proposal.revision, reason: proposal.reason, evidence: proposal.evidence, actor: "claude" } });
  }
  applyReviewed(ids: string[], signal?: AbortSignal): Promise<JobRun> {
    if (!ids.length || ids.length > 100 || ids.some(id => typeof id !== "string")) return Promise.reject(new Error("INVALID_REVIEW_IDS"));
    return this.start({ mode: "apply", reviewedIds: [...new Set(ids)], signal });
  }
  readyReviewIds(): string[] { return this.gateway.accounts().flatMap(account => this.store.works(account, "apply").filter(work => work.kind === "classify" && (work.decision?.reviewed || work.decision?.agentReview) && ["classified", "applying"].includes(work.state)).map(work => work.id)); }
  reviewedWorkState(id: string): string | undefined { return this.store.work(id)?.state; }
  status(): JobStatus {
    const history = this.store.history(1000);
    return { activeRun: this.active, lastRun: history[0] ?? null, lastSuccessfulRun: history.find((run) => run.state === "success" && run.mode === "apply") ?? null, nextRunAt: nextRunAt(this.now()), schedule: "05:53 daily", timeZone: TIME_ZONE, accounts: (this.active ?? history[0])?.accounts ?? [], reviewCount: this.reviews().length, paused: this.paused, configuredAccounts: this.gateway.accounts() };
  }
  async drain(): Promise<void> { this.paused = true; if (this.running) await this.running; }
  resume(): void { this.paused = false; }
  start(input: StartJobInput): Promise<JobRun> {
    if (!["apply", "dry-run"].includes(input.mode)) return Promise.reject(new Error("INVALID_RUN_MODE"));
    if (input.mode === "apply" && this.config.env.LIFE_OS_TRIAGE_APPLY_ENABLED !== "true") return Promise.reject(new Error("TRIAGE_APPLY_DISABLED"));
    if (this.paused) return Promise.reject(new Error("JOBS_DRAINING"));
    if (this.running && input.reviewedIds) return Promise.reject(new Error("JOB_ALREADY_RUNNING"));
    if (this.running) return this.active?.mode === input.mode ? this.running : Promise.reject(new Error("JOB_ALREADY_RUNNING"));
    const now = this.now();
    const day = easternDay(now);
    const key = input.scheduled ? `gmail-triage:${input.mode}:${day}` : randomUUID();
    let run = input.retryRunId ? this.store.run(input.retryRunId) : this.store.runByKey(key);
    if (input.retryRunId && (!run || run.mode !== input.mode)) return Promise.reject(new Error("RETRY_RUN_NOT_FOUND"));
    if (run?.state === "success" && !input.retryRunId) return Promise.resolve(run);
    if (run) {
      run.state = "running"; delete run.finishedAt; delete run.errorCode; run.accounts = []; this.store.saveRun(run);
    } else {
      run = { id: randomUUID(), name: "gmail-triage", mode: input.mode, scheduled: !!input.scheduled, day, state: "running", startedAt: now.toISOString(), accounts: [], ...(input.reviewedIds ? { reviewedIds: input.reviewedIds } : {}) };
      this.store.insertRun(run, key);
    }
    this.active = run;
    this.running = this.execute(run, run.reviewedIds, input.signal).finally(() => { this.active = null; this.running = null; });
    return this.running;
  }
  private async execute(run: JobRun, reviewedIds?: string[], externalSignal?: AbortSignal): Promise<JobRun> {
    const deadline = AbortSignal.timeout(this.deadlineMs);
    const signal = externalSignal ? AbortSignal.any([deadline, externalSignal]) : deadline;
    try {
      const accounts = this.gateway.accounts().filter(account => !reviewedIds || reviewedIds.some(id => this.store.work(id)?.account === account));
      if (!accounts.length) throw new Error("NO_GMAIL_ACCOUNTS");
      for (const account of accounts) {
        signal.throwIfAborted();
        let aliases: Record<string, string> = {};
        try { aliases = JSON.parse(readFileSync(this.config.configFile, "utf8")).gmail?.aliases ?? {}; } catch { /* optional */ }
        const prior = this.store.history(1000).filter(item => item.mode === "apply").flatMap((item) => item.accounts).find((item) => item.account === account && item.lastSucceededAt);
        const result: AccountResult = { account, alias: Object.entries(aliases).find(([, email]) => email === account)?.[0], state: "running", processed: 0, held: 0, failed: 0, completed: 0, lastSucceededAt: prior?.lastSucceededAt };
        run.accounts.push(result); this.store.saveRun(run);
        try {
          await this.gateway.verify(account, signal);
          const labels = await this.gateway.labels(account, run.mode === "apply", signal);
          if (reviewedIds) {
            for (const id of reviewedIds) {
              const work = this.store.work(id);
              if (work?.account === account && work.mode === "apply" && work.kind === "classify" && (work.decision?.reviewed || work.decision?.agentReview) && ["classified", "applying"].includes(work.state)) await this.process(work, labels, result, signal, undefined, false);
            }
          } else await this.account(run, result, labels, signal);
          result.held = this.store.reviews().filter((item) => item.account === account && this.store.work(item.id)?.mode === run.mode).length;
          result.state = result.failed || result.held ? "partial" : "success";
          if (run.mode === "apply" && result.failed === 0) result.lastSucceededAt = this.now().toISOString();
        } catch (error) {
          result.state = error instanceof AuthError ? "auth_blocked" : "failed";
          result.errorCode = errorCode(error); result.failed++;
          this.logger.warn("gmail-triage account failed", { runId: run.id, account, errorCode: result.errorCode });
        }
        this.store.saveRun(run);
      }
      run.state = run.accounts.every((account) => account.state === "success") ? "success" : run.accounts.every((account) => ["failed", "auth_blocked"].includes(account.state)) ? "failed" : "partial";
    } catch (error) { run.state = "failed"; run.errorCode = errorCode(error); }
    finally {
      run.finishedAt = this.now().toISOString(); this.store.saveRun(run);
      try { this.report(run); } catch { this.logger.error("gmail-triage report write failed", { runId: run.id }); }
    }
    return run;
  }
  private async account(run: JobRun, result: AccountResult, labels: Record<string, string>, signal: AbortSignal): Promise<void> {
    if (run.mode === "apply") await this.backfillLegacyLinks(result.account, signal);
    // Finish durable decisions first. This includes local finalization after a lost write response.
    const pending = this.store.works(result.account, run.mode).filter((item) => !TERMINAL_WORK.has(item.state));
    const resumable = [...pending.filter((item) => ["applying", "classified"].includes(item.state)), ...pending.filter((item) => ["retryable", "discovered"].includes(item.state)).slice(0, 10)];
    for (const work of resumable) {
      signal.throwIfAborted();
      await this.process(work, labels, result, signal);
    }
    if (run.mode === "apply") {
      // A crash after primary finalization must not permanently skip sibling cleanup.
      for (const link of this.store.links(result.account).filter((item) => item.active)) {
        const current = this.store.work(link.workId);
        if (current?.state === "applied" && current.kind === "classify") await this.supersedeOlder(current, labels, result, signal);
      }
      await this.closeRepliedTasks(result.account, signal);
      await this.completionSweep(run, result, labels, signal);
    }
    // Exhaust pagination before any mutation, so archiving cannot shift page boundaries.
    const ids = await this.gateway.listThreads(result.account, "in:inbox -in:spam -in:trash", signal);
    let accepted = this.store.works(result.account, run.mode).filter((item) => item.day === run.day && item.kind === "classify").length;
    for (const threadId of ids) {
      signal.throwIfAborted();
      if (accepted >= 100) break;
      try {
        const thread = await this.readThread(result.account, threadId, signal);
        const triggers = eligible(thread).filter((message) => incoming(message) && message.labels.includes("INBOX"));
        if (!triggers.length) continue;
        const latest = triggers.at(-1)!;
        const contentRevision = revision(thread);
        const key = hash([result.account, threadId, triggers.map((message) => message.id), contentRevision, RUBRIC_VERSION, RUBRIC_HASH, run.mode]);
        if (this.store.workByKey(key)) continue; // Held/error work cannot consume today's fresh budget again.
        const work: WorkItem = { id: randomUUID(), account: result.account, threadId, mode: run.mode, kind: "classify", key, runId: run.id, createdAt: this.now().toISOString(), day: run.day, state: "discovered", subject: latest.subject, sender: senderAddress(latest.from), triggerIds: triggers.map((message) => message.id), triggerDate: latest.internalDate, revision: contentRevision, labelRevision: hash(thread.messages.map((message) => [message.id, relevantLabels(message.labels, labels)])) };
        work.rubricVersion = RUBRIC_VERSION; work.rubricHash = RUBRIC_HASH;
        this.store.insertWork(work); accepted++;
        await this.process(work, labels, result, signal, thread);
      } catch (error) {
        if (error instanceof AuthError || signal.aborted) throw error;
        result.failed++; this.logger.warn("gmail-triage discovery failed", { runId: run.id, account: result.account, threadId, errorCode: errorCode(error) });
      }
    }
  }
  private async process(work: WorkItem, labels: Record<string, string>, result: AccountResult, signal: AbortSignal, loaded?: MailThread, followups = true): Promise<void> {
    try {
      let thread = loaded ?? await this.readThread(work.account, work.threadId, signal);
      if (work.plan && work.state === "applying") {
        if (this.applied(work.plan, thread, labels)) { this.finalize(work); result.processed++; return; }
        // Even unchanged labels can reflect a user undoing a successful write. Never blindly replay.
        this.store.review(work, "UNCERTAIN_GMAIL_MUTATION"); result.held++; return;
      }
      if (revision(thread) !== work.revision) { work.state = "superseded"; work.reason = "NEW_MESSAGE_OR_CONTENT"; this.store.saveWork(work); return; }
      if (work.labelRevision && work.labelRevision !== hash(thread.messages.map((message) => [message.id, relevantLabels(message.labels, labels)]))) { this.store.review(work, "MAIL_CHANGED_SINCE_DISCOVERY"); result.held++; return; }
      if (work.kind === "classify") {
        if (!work.decision) {
          const messages = eligible(thread);
          if (messages.length > 50 || messages.some((message) => message.truncated) || messages.reduce((sum, message) => sum + message.body.length, 0) > 60_000 || messages.filter(incoming).some((message) => !message.body.trim())) {
            this.store.review(work, "INSUFFICIENT_OR_TRUNCATED_CONTEXT"); result.held++; return;
          }
          work.decision = await this.classifier.classify({ account: work.account, now: this.now().toISOString(), timeZone: TIME_ZONE, thread }, signal);
          work.state = "classified"; this.store.saveWork(work);
        }
        if (work.decision.confidence < 0.9) { this.store.review(work, "LOW_CONFIDENCE"); result.held++; return; }
        if (work.mode === "dry-run") { work.state = "applied"; this.store.saveWork(work); result.processed++; return; }
        // Persist relevant preconditions before re-fetching. Unrelated labels and UNREAD do not matter.
        work.plan ??= this.plan(thread, labels, work.decision.category);
      }
      if (!work.plan) throw new Error("MUTATION_PLAN_MISSING");
      this.store.saveWork(work);
      thread = await this.readThread(work.account, work.threadId, signal);
      if (!this.unchanged(work.plan, thread, labels) || revision(thread) !== work.revision) {
        this.store.review(work, "MAIL_CHANGED_BEFORE_APPLY"); result.held++; return;
      }
      const attempt = this.store.attempt(work);
      try {
        signal.throwIfAborted();
        await this.gateway.modify(work.account, work.plan, signal);
        this.store.attemptOutcome(attempt, "acknowledged");
      } catch (error) {
        // Leave applying durable. Reconciliation on next run decides whether Gmail committed it.
        this.store.attemptOutcome(attempt, "uncertain"); throw error;
      }
      const after = await this.readThread(work.account, work.threadId, signal);
      if (!this.applied(work.plan, after, labels)) { this.store.review(work, "GMAIL_POSTCONDITION_CHANGED"); result.held++; return; }
      this.finalize(work); result.processed++; if (work.kind === "complete") result.completed++;
      if (followups && work.kind === "classify" && work.decision && ACTION_CATEGORIES.has(work.decision.category)) await this.supersedeOlder(work, labels, result, signal);
    } catch (error) {
      if (!["applying", "applied", "needs_review"].includes(work.state)) { work.state = "retryable"; work.reason = errorCode(error); this.store.saveWork(work); }
      if (error instanceof AuthError || signal.aborted) throw error;
      result.failed++;
      this.logger.warn("gmail-triage item failed", { workId: work.id, account: work.account, errorCode: errorCode(error) });
    }
  }
  private plan(thread: MailThread, labels: Record<string, string>, category: Category | "ACTION/DONE"): MutationPlan {
    const messages = eligible(thread);
    const selected = labels[category];
    if (!selected) throw new Error("GMAIL_LABEL_MISSING");
    return { ids: messages.map((message) => message.id), allMessageIds: thread.messages.map((message) => message.id).sort(), before: messages.map((message) => ({ id: message.id, internalDate: message.internalDate, labels: relevantLabels(message.labels, labels) })), add: [selected, ...(STAR_CATEGORIES.has(category as Category) ? ["STARRED"] : [])], remove: ["INBOX", ...[...CATEGORIES, "ACTION/DONE"].filter((name) => name !== category).map((name) => labels[name]).filter((id): id is string => !!id)] };
  }
  private unchanged(plan: MutationPlan, thread: MailThread, labels: Record<string, string>): boolean {
    return sameLabels(plan.allMessageIds, thread.messages.map((message) => message.id)) && plan.before.every((before) => { const message = thread.messages.find((item) => item.id === before.id); return message && message.internalDate === before.internalDate && sameLabels(before.labels, relevantLabels(message.labels, labels)); });
  }
  private applied(plan: MutationPlan, thread: MailThread, labels: Record<string, string>): boolean {
    // New arrivals are allowed after a captured-message write; they remain untouched in INBOX.
    return plan.before.every((before) => {
      const message = thread.messages.find((item) => item.id === before.id);
      const expected = [...new Set([...before.labels.filter((label) => !plan.remove.includes(label)), ...plan.add])];
      return !!message && sameLabels(expected, relevantLabels(message.labels, labels));
    });
  }
  private finalize(work: WorkItem): void {
    transaction(this.store.db, () => {
      if (work.mode === "apply") {
        const link = this.store.links(work.account).find((item) => item.threadId === work.threadId);
        if (work.kind === "complete") {
          if (link?.active && link.triggerDate <= work.triggerDate) { this.track.updateTask(link.taskId, { status: "done" }); this.store.saveLink({ ...link, active: false }); }
        } else if (work.kind === "classify" && work.decision && ACTION_CATEGORIES.has(work.decision.category)) {
          // Preserve titles/notes the user has edited. A new request after a closed task gets a new id.
          const siblings = this.store.links(work.account).filter((item) => item.active && item.threadId !== work.threadId && item.sender === work.sender && item.subject === normalizeSubject(work.subject) && item.triggerDate < work.triggerDate);
          const existingLink = link?.active ? link : siblings.at(-1);
          let task = existingLink ? this.track.loadRegistry().tasks.find((item) => item.id === existingLink.taskId && item.status === "open") : undefined;
          if (!task) {
            const project = this.track.loadRegistry().projects.find((item) => item.name.toLowerCase() === "email") ?? this.track.addProject({ name: "Email" });
            task = this.track.addTask({ title: `Email: [${work.decision.category}] ${work.subject || "Email follow-up"}`, project: project.id, notes: `Account: ${work.account}\nSender: ${work.sender}\nGmail: https://mail.google.com/mail/u/?authuser=${encodeURIComponent(work.account)}#all/${work.threadId}` });
          }
          // Transfer the task before external sibling cleanup: an old unstar must not close the new request.
          for (const sibling of siblings) this.store.saveLink({ ...sibling, active: false });
          this.store.saveLink({ account: work.account, threadId: work.threadId, taskId: task.id, workId: work.id, triggerDate: work.triggerDate, triggerIds: work.triggerIds, sender: work.sender, subject: normalizeSubject(work.subject), active: true });
        } else if (work.kind === "supersede" && link?.active) { this.store.saveLink({ ...link, active: false }); }
      }
      work.state = "applied"; delete work.reason; this.store.saveWork(work);
    });
  }
  private async completionSweep(run: JobRun, result: AccountResult, labels: Record<string, string>, signal: AbortSignal): Promise<void> {
    const query = `{${ACTIVE_CATEGORIES.map((category) => `label:${category}`).join(" ")}} -is:starred -in:spam -in:trash`;
    const ids = await this.gateway.listThreads(result.account, query, signal);
    for (const id of ids) {
      signal.throwIfAborted();
      const thread = await this.readThread(result.account, id, signal);
      const messages = eligible(thread);
      // Gmail search is message-level. Recheck every message, including stars on a different message.
      if (!messages.length || messages.some((message) => message.labels.includes("STARRED") || (incoming(message) && message.labels.includes("INBOX"))) || !messages.some((message) => ACTIVE_CATEGORIES.some((category) => message.labels.includes(labels[category] ?? "")))) continue;
      const key = hash(["complete", result.account, id, revision(thread), messages.map((message) => relevantLabels(message.labels, labels))]);
      if (this.store.workByKey(key)) continue;
      const latest = messages.at(-1)!;
      const work: WorkItem = { id: randomUUID(), account: result.account, threadId: id, mode: "apply", kind: "complete", key, runId: run.id, createdAt: this.now().toISOString(), day: run.day, state: "classified", subject: latest.subject, sender: senderAddress(latest.from), triggerIds: messages.map((message) => message.id), triggerDate: latest.internalDate, revision: revision(thread), plan: this.plan(thread, labels, "ACTION/DONE") };
      this.store.insertWork(work); await this.process(work, labels, result, signal, thread);
    }
  }
  private async closeRepliedTasks(account: string, signal: AbortSignal): Promise<void> {
    for (const link of this.store.links(account).filter((item) => item.active)) {
      const thread = await this.readThread(account, link.threadId, signal);
      const trigger = { internalDate: link.triggerDate, id: [...link.triggerIds].sort().at(-1) ?? "" };
      const sent = eligible(thread).filter((message) => message.labels.includes("SENT") && newer(message, trigger)).at(-1);
      if (!sent || eligible(thread).some((message) => incoming(message) && newer(message, sent))) continue;
      transaction(this.store.db, () => { this.track.updateTask(link.taskId, { status: "done" }); this.store.saveLink({ ...link, active: false }); });
    }
  }
  private async backfillLegacyLinks(account: string, signal: AbortSignal): Promise<void> {
    const registry = this.track.loadRegistry();
    const emailProjects = new Set(registry.projects.filter((project) => project.name.toLowerCase() === "email").map((project) => project.id));
    const existing = this.store.links(account);
    const candidates = registry.tasks.filter((task) => task.status === "open" && task.projectId && emailProjects.has(task.projectId)).flatMap((task) => {
      const links = [...(task.notes ?? "").matchAll(/https:\/\/mail\.google\.com\/[^\s]+#(?:all|inbox)\/([a-zA-Z0-9_-]+)/g)];
      if (links.length !== 1) return [];
      const accountLines = [...(task.notes ?? "").matchAll(/^Account:\s*([^\s]+)\s*$/gm)].map((match) => match[1]!.toLowerCase());
      const authusers = new URL(links[0]![0]).searchParams.getAll("authuser").map((value) => value.toLowerCase());
      const boundAccounts = [...accountLines, ...authusers];
      // Account mentions in prose and numeric Gmail /u/ indexes are not trustworthy bindings.
      if (!boundAccounts.length || boundAccounts.some((value) => value !== account.toLowerCase())) return [];
      return [{ task, threadId: links[0]![1]! }];
    });
    for (const candidate of candidates) {
      if (existing.some((link) => link.threadId === candidate.threadId || link.taskId === candidate.task.id) || candidates.filter((item) => item.threadId === candidate.threadId).length !== 1) continue;
      signal.throwIfAborted();
      const thread = await this.readThread(account, candidate.threadId, signal);
      const inbound = eligible(thread).filter(incoming);
      const latest = inbound.at(-1);
      if (!latest) continue;
      const link = { account, threadId: candidate.threadId, taskId: candidate.task.id, workId: `legacy:${candidate.task.id}`, triggerDate: latest.internalDate, triggerIds: [latest.id], sender: senderAddress(latest.from), subject: normalizeSubject(latest.subject), active: true };
      this.store.saveLink(link); existing.push(link);
    }
  }
  private async supersedeOlder(current: WorkItem, labels: Record<string, string>, result: AccountResult, signal: AbortSignal): Promise<void> {
    const links = this.store.links(current.account).filter((link) => link.threadId !== current.threadId && link.sender === current.sender && link.subject === normalizeSubject(current.subject) && link.triggerDate < current.triggerDate);
    for (const link of links) {
      const thread = await this.readThread(current.account, link.threadId, signal);
      if (eligible(thread).some((message) => incoming(message) && message.internalDate > current.triggerDate)) continue;
      const key = hash(["supersede", link.workId, current.id]);
      if (this.store.workByKey(key)) continue;
      const remove = [labels["ACTION/NOW"], labels["ACTION/SOON"]].filter((id): id is string => !!id);
      const messages = eligible(thread);
      const plan: MutationPlan = { ids: messages.map((message) => message.id), allMessageIds: thread.messages.map((message) => message.id).sort(), before: messages.map((message) => ({ id: message.id, internalDate: message.internalDate, labels: relevantLabels(message.labels, labels) })), add: [], remove };
      const work: WorkItem = { id: randomUUID(), account: current.account, threadId: link.threadId, mode: "apply", kind: "supersede", key, runId: current.runId, createdAt: this.now().toISOString(), day: current.day, state: "classified", subject: current.subject, sender: current.sender, triggerIds: link.triggerIds, triggerDate: link.triggerDate, revision: revision(thread), plan };
      this.store.insertWork(work); await this.process(work, labels, result, signal, thread);
    }
  }
  private report(run: JobRun): void {
    const decisions = run.accounts.flatMap((account) => this.store.works(account.account, run.mode)).filter((work) => work.runId === run.id && work.kind === "classify");
    const categories = CATEGORIES.map((category) => ({ category, items: decisions.filter((work) => work.decision?.category === category) })).filter((group) => group.items.length);
    const sample = [...new Map([...categories.map((group) => group.items[0]!), ...decisions].map((work) => [work.id, work])).values()].slice(0, 20);
    const text = (value: string) => value.replace(/[\r\n`]/g, " ").slice(0, 120);
    const models = [...new Set(decisions.flatMap((work) => work.decision ? [work.decision.model] : []))];
    const lines = [`## ${run.day} — ${run.mode}`, ``, `Run: ${run.id}`, `Finished: ${run.finishedAt}`, `Mode: ${run.mode}`, `State: ${run.state}`, `Schedule: daily 05:53 ${TIME_ZONE}`, ``, ...run.accounts.map((account) => `- ${account.account}: ${account.state}; ${account.processed} processed, ${account.held} held, ${account.failed} failed, ${account.completed} completed${account.errorCode ? ` (${account.errorCode})` : ""}.`), ``, `### Classification evidence`, ``, `Rubric: ${RUBRIC_VERSION}. Automatic application requires confidence of at least 0.90.`, ...(run.mode === "dry-run" ? [`Shadow mode made no Gmail or task changes.`] : []), ``, ...categories.map(({ category, items }) => `- ${category}: ${items.length} decisions; ${items.filter((work) => work.decision!.confidence >= 0.9).length} meet the confidence threshold.`), ``, `### Decision sample (${sample.length} of ${decisions.length})`, ``, ...sample.map((work) => `- \`${work.decision?.category ?? "NEEDS REVIEW"}\` · confidence ${work.decision?.confidence.toFixed(3) ?? "unavailable"} · \`${text(work.subject || "No subject")}\` · ${work.state}${work.reason ? ` (${work.reason})` : ""} · [Open email](https://mail.google.com/mail/u/?authuser=${encodeURIComponent(work.account)}#all/${encodeURIComponent(work.threadId)})`), ``, `Pending reviews: ${this.reviews().length}`, ``, `Held mail remains in its current Gmail state. Review using life-os triage review list.`, ``];
    lines.splice(lines.indexOf("### Classification evidence") + 2, 0, `Validated models: ${models.join(", ") || "none yet"}.`);
    const path=join(this.config.triageLogDir,"email.md");
    let prior="";try {prior=readFileSync(path,"utf8").replace(/^# [^\n]*\n/,"").trim();} catch {}
    const retained=prior.split(/(?=^## )/m).filter(section=>section.trim()&&!section.includes(`Run: ${run.id}`)).slice(0,29).join("\n\n").slice(0,400_000);
    writeAtomic(path,"# Gmail triage\n\n"+lines.join("\n")+"\n"+retained);
  }
}
