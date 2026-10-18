import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { LifeOsConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { writeAtomic } from "../core/fsutil.js";
import { openDatabase } from "../state/database.js";
import { TrackStore } from "../toolsets/track/store.js";
import { GmailAccountManager, type GmailManagerLike } from "../toolsets/gmail/client.js";
import { easternDay } from "../jobs/service.js";
import { CATEGORIES, type Category, type JobRun, type JobService } from "../jobs/types.js";
import { ClaudeProvider, REVIEW_MAX_TOKENS, BRIEF_MAX_TOKENS, reviewSchema, briefSchema } from "./provider.js";
import { ClaudeCodeProvider } from "./claude-code.js";
import { GmailBriefDelivery } from "./delivery.js";
import { AutomationStore, digest, type StoredRun } from "./store.js";
import { AUTOMATION_POLICY, type AutomationService, type AutomationSnapshot, type AutomationProvider, type BriefDeliveryGateway, type BriefDelivery, type BriefInput, type BriefSource, type BriefingArtifact, type ProviderResult } from "./types.js";
export type { AutomationService, AutomationSnapshot } from "./types.js";

export interface AutomationDependencies { jobs: JobService; manager?: GmailManagerLike; track?: TrackStore; provider?: AutomationProvider; delivery?: BriefDeliveryGateway; now?: () => Date; deadlineMs?: number }
const runSchema = z.object({ kind: z.enum(["review", "brief", "daily"]) }).strict();
const scheduleSchema = z.object({ enabled: z.boolean().optional(), localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), reviewEnabled: z.boolean().optional(), briefEnabled: z.boolean().optional() }).strict();
const resolveSchema = z.object({ itemId: z.string().min(1).max(100), category: z.enum(CATEGORIES) }).strict();
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const parts = (date: Date) => Object.fromEntries(fmt.formatToParts(date).filter(item => item.type !== "literal").map(item => [item.type, Number(item.value)]));
export function scheduleTime(now: Date, localTime: string, next = true): string {
  const p = parts(now), [hour, minute] = localTime.split(":").map(Number);
  for (let days = 0; days < 3; days++) {
    const target = Date.UTC(p.year!, p.month! - 1, p.day! + days, hour, minute); let candidate = target;
    for (let i = 0; i < 4; i++) { const a = parts(new Date(candidate)); candidate += target - Date.UTC(a.year!, a.month! - 1, a.day!, a.hour!, a.minute!); }
    if (!next || candidate > now.getTime()) return new Date(candidate).toISOString();
  }
  throw new Error("AUTOMATION_SCHEDULE_INVALID");
}
function code(error: unknown): string { return error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message) ? error.message : error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name) ? "AUTOMATION_DEADLINE" : "AUTOMATION_UPSTREAM_FAILURE"; }
const safeText = (text: string) => text.replace(/[<>]/g, "").replace(/\]\(/g, "] (").replace(/[\r\n]+/g, " ").trim();

export function createAutomationService(config: LifeOsConfig, logger: Logger, dependencies: AutomationDependencies): AutomationService { return new DurableAutomationService(config, logger, dependencies); }
class DurableAutomationService implements AutomationService {
  private readonly store: AutomationStore; private readonly provider: AutomationProvider; private readonly delivery: BriefDeliveryGateway; private readonly track: TrackStore;
  private readonly jobs: JobService; private readonly now: () => Date; private running: Promise<void> | null = null; private paused = false;
  private controller: AbortController | null = null;
  private readonly account: string; private readonly recipient: string;
  constructor(private readonly config: LifeOsConfig, private readonly logger: Logger, private readonly deps: AutomationDependencies) {
    this.store = new AutomationStore(openDatabase(config)); this.store.recover(new Date().toISOString()); this.jobs = deps.jobs;
    this.provider = deps.provider ?? (config.env.LIFE_OS_AGENT_PROVIDER === "claude-code" ? new ClaudeCodeProvider(config) : new ClaudeProvider(config)); this.track = deps.track ?? new TrackStore(config); this.now = deps.now ?? (() => new Date());
    this.account = (config.env.LIFE_OS_BRIEF_ACCOUNT ?? "").toLowerCase(); this.recipient = (config.env.LIFE_OS_BRIEF_RECIPIENT ?? "").toLowerCase();
    this.delivery = deps.delivery ?? new GmailBriefDelivery(deps.manager ?? new GmailAccountManager({ config, logger }), this.account, this.recipient);
    if (!this.store.db.prepare("SELECT 1 FROM automation_settings WHERE id=1").get()) this.store.setSettings({ ...this.store.settings(), enabled: config.env.LIFE_OS_AUTOMATION_ENABLED === "true" });
  }
  get activeCount(): number { return this.running ? 1 : 0; }
  private mailConfigured(): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.account) && this.account === this.recipient && this.jobs.status().configuredAccounts.includes(this.account); }
  snapshot(): AutomationSnapshot {
    const settings = this.store.settings(); const accounts = this.jobs.status().configuredAccounts;
    const reviews = this.jobs.reviews().filter(item => item.mode === "apply" && accounts.includes(item.account)).slice(0, 200).map(item => {
      const record = item.revision ? this.store.reviewRecord(this.store.reviewKey(item.id, item.revision, AUTOMATION_POLICY)) : undefined;
      return { ...item, ...(record ? { agentReview: { category: (record.category ?? null) as Category | null, reason: record.reason, model: record.model, createdAt: record.createdAt } } : {}) };
    });
    return { configured: this.provider.configured() && this.mailConfigured(), model: this.provider.model, paused: this.paused, activeCount: this.activeCount, reviews, runs: this.store.runs(), schedule: { ...settings, nextRunAt: scheduleTime(this.now(), settings.localTime) }, briefing: this.store.briefing() ?? null, deliveries: this.store.deliveries(), usage: this.store.usage(easternDay(this.now())), recentDecisions: this.store.decisions().filter(item => accounts.includes(item.account)).slice(0, 20) };
  }
  async command(action: "automation.run" | "automation.schedule" | "review.resolve", input: unknown, requestId: string, actor: string): Promise<AutomationSnapshot> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId) || !actor || actor.length > 320) throw new Error("AUTOMATION_INVALID_REQUEST");
    if (this.paused) throw new Error("AUTOMATION_DRAINING");
    const now = this.now().toISOString(), day = easternDay(this.now());
    this.store.command(requestId, { action, input, actor }, now, () => {
      if (action === "automation.run") {
        const value = runSchema.parse(input);
        if (!this.provider.configured() || value.kind !== "review" && !this.mailConfigured()) throw new Error("AUTOMATION_NOT_CONFIGURED");
        this.store.enqueue(`manual:${requestId}`, value.kind, day, now, actor);
      } else if (action === "automation.schedule") {
        const value = scheduleSchema.parse(input);
        if (value.enabled && (!this.provider.configured() || !this.mailConfigured())) throw new Error("AUTOMATION_NOT_CONFIGURED");
        this.store.setSettings({ ...this.store.settings(), ...value });
      } else if (action === "review.resolve") {
        const value = resolveSchema.parse(input);
        if (this.activeCount || this.jobs.status().activeRun) throw new Error("AUTOMATION_BUSY");
        const review = this.snapshot().reviews.find(item => item.id === value.itemId);
        if (!review || !review.reviewable) throw new Error("REVIEW_NOT_ELIGIBLE");
        this.jobs.resolve(value.itemId, value.category);
        this.store.enqueue(`human:${requestId}`, "review", day, now, actor, undefined, [value.itemId]);
      } else throw new Error("AUTOMATION_INVALID_ACTION");
    });
    return this.snapshot();
  }
  afterTriage(run: JobRun): void {
    const settings = this.store.settings();
    if (!settings.enabled || !run.scheduled || run.mode !== "apply" || run.state === "running") return;
    this.store.enqueue(`daily:${run.day}`, "daily", run.day, this.now().toISOString(), "schedule:after-triage", run.id);
  }
  tick(): Promise<void> {
    if (this.paused || this.running || this.jobs.status().activeRun || this.jobs.status().paused) return this.running ?? Promise.resolve();
    const settings = this.store.settings(), now = this.now();
    if (settings.enabled && now.toISOString() >= scheduleTime(now, settings.localTime, false)) this.store.enqueue(`daily:${easternDay(now)}`, "daily", easternDay(now), now.toISOString(), "schedule:fallback");
    const uncertain = this.mailConfigured() ? this.store.deliveries(100).find(entry => entry.state === "uncertain" && (entry.reconcileAttempts ?? 0) < 12 && (!entry.nextReconcileAt || entry.nextReconcileAt <= now.toISOString())) : undefined;
    if (uncertain) this.store.enqueue(`reconcile:${uncertain.id}:${uncertain.reconcileAttempts ?? 0}`, "brief", uncertain.day, now.toISOString(), "delivery:reconcile");
    const run = this.store.claim(now.toISOString()); if (!run) return Promise.resolve();
    this.controller = new AbortController();
    this.running = this.execute(run, this.controller.signal).finally(() => { this.running = null; this.controller = null; }); return this.running;
  }
  async drain(): Promise<void> { this.paused = true; this.controller?.abort(); if (this.running) await this.running; }
  resume(): void { this.paused = false; }
  private assertClaim(run: StoredRun): void { if (!this.store.fenced(run)) throw new Error("AUTOMATION_STALE_CLAIM"); }
  private async execute(run: StoredRun, cancelled: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(this.deps.deadlineMs ?? 12 * 60_000)]);
    try {
      const settings = this.store.settings();
      if (run.stage === "review") {
        if (run.kind !== "daily" || settings.reviewEnabled) await this.review(run, signal);
        run.stage = run.kind === "review" ? "done" : "brief"; this.store.saveRun(run);
      }
      if (run.stage === "brief") {
        if (run.kind !== "daily" || settings.briefEnabled) await this.brief(run, signal);
        run.stage = "done"; this.store.saveRun(run);
      }
      this.assertClaim(run); run.state = run.held || run.failed ? "partial" : "succeeded"; run.finishedAt = this.now().toISOString(); delete run.errorCode;
    } catch (error) {
      if (!this.store.fenced(run)) return;
      const errorCode = code(error); run.errorCode = errorCode;
      if (cancelled.aborted) { run.state = "queued"; run.errorCode = "AUTOMATION_DRAINED"; return; }
      const retryable = /^(CLAUDE_HTTP_(429|5\d\d)|CLAUDE_RUNNER_(UNAVAILABLE|BUSY)|AUTOMATION_UPSTREAM_FAILURE|AUTOMATION_DEADLINE|JOBS_BUSY|JOB_ALREADY_RUNNING)$/.test(errorCode);
      run.state = retryable && run.attempts < 3 ? "retry_wait" : "failed";
      if (run.state === "retry_wait") run.nextAttemptAt = new Date(this.now().getTime() + run.attempts * 60_000).toISOString(); else run.finishedAt = this.now().toISOString();
      this.logger.warn("automation run stopped", { runId: run.id, errorCode });
    } finally { if (this.store.fenced(run)) { delete run.claim; this.store.saveRun(run); } }
  }
  private async model<T>(run: StoredRun, input: unknown, output: number, call: () => Promise<ProviderResult<T>>): Promise<ProviderResult<T>> {
    this.assertClaim(run); const day = easternDay(this.now());
    // UTF-8 byte count plus system/schema overhead is a conservative input-token reservation.
    const reserved = Buffer.byteLength(JSON.stringify(input)) + 8000; this.store.reserve(day, reserved, output);
    const result = await call(); this.assertClaim(run);
    if (![result.inputTokens, result.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("CLAUDE_INVALID_USAGE");
    this.store.settle(day, reserved, output, result.inputTokens, result.outputTokens); return result;
  }
  private async review(run: StoredRun, signal: AbortSignal): Promise<void> {
    if (!this.jobs.reviewContext || !this.jobs.acceptAgentReview || !this.jobs.applyReviewed) throw new Error("REVIEW_SERVICE_UNAVAILABLE");
    const manual = !!run.approvedIds?.length;
    const approved = new Set([...(run.approvedIds ?? []), ...(this.jobs.readyReviewIds?.() ?? []), ...this.store.accepted().map(record => record.id)]);
    if (!manual) {
      if (!this.provider.configured()) throw new Error("CLAUDE_KEY_MISSING");
      const accounts = this.jobs.status().configuredAccounts;
      const candidates = this.jobs.reviews().filter(item => item.mode === "apply" && accounts.includes(item.account) && item.reviewable && !this.store.reviewRecord(this.store.reviewKey(item.id, item.revision!, AUTOMATION_POLICY))).slice(0, 20);
      for (const item of candidates) {
        signal.throwIfAborted();
        const key = this.store.reviewKey(item.id, item.revision!, AUTOMATION_POLICY); if (this.store.reviewRecord(key)) continue;
        try {
          const usage = this.store.usage(easternDay(this.now()));
          if (usage.calls >= usage.maxCalls - 1 || usage.inputTokens > usage.maxInputTokens - 160_000 || usage.outputTokens > usage.maxOutputTokens - BRIEF_MAX_TOKENS - REVIEW_MAX_TOKENS) { run.held++; break; }
          const context = await this.jobs.reviewContext(item.id, signal);
          const result = await this.model(run, context, REVIEW_MAX_TOKENS, () => this.provider.review(context, signal));
          const proposal = reviewSchema.parse(result.value);
          if (proposal.itemId !== context.itemId || proposal.revision !== context.revision || proposal.policyVersion !== context.policyVersion) throw new Error("REVIEW_IDENTITY_MISMATCH");
          let accepted = false;
          if (proposal.clear && !proposal.needsMoreContext && proposal.category && proposal.confidence >= 0.95) {
            await this.jobs.acceptAgentReview(proposal, result.model, signal); accepted = true; approved.add(item.id);
          }
          this.store.saveReview(key, { id: item.id, account: context.account, category: proposal.category, revision: context.revision, policyVersion: AUTOMATION_POLICY, state: accepted ? "accepted" : "held", model: result.model, reason: safeText(proposal.reason), createdAt: this.now().toISOString() });
          run.reviewed++; if (!accepted) run.held++; this.store.saveRun(run);
        } catch (error) {
          const errorCode = code(error);
          if (errorCode === "AUTOMATION_STALE_CLAIM" || errorCode.startsWith("CLAUDE_") || errorCode === "DAILY_MODEL_BUDGET_EXHAUSTED" || signal.aborted || errorCode === "AUTOMATION_UPSTREAM_FAILURE") throw error;
          this.store.saveReview(key, { id: item.id, account: item.account, category: null, revision: item.revision!, policyVersion: AUTOMATION_POLICY, state: "held", model: "policy", reason: errorCode, createdAt: this.now().toISOString() });
          run.held++; run.failed++; this.store.saveRun(run);
        }
      }
    }
    if (approved.size) {
      this.assertClaim(run); const result = await this.jobs.applyReviewed([...approved].slice(0, 100), signal);
      run.applied += result.accounts.reduce((sum, account) => sum + account.processed, 0); run.failed += result.accounts.reduce((sum, account) => sum + account.failed, 0);
      for (const record of this.store.accepted().filter(item => approved.has(item.id))) {
        const state = this.jobs.reviewedWorkState?.(record.id);
        if (state === "applied" || !this.jobs.reviewedWorkState && result.state === "success") this.store.saveReview(this.store.reviewKey(record.id, record.revision, record.policyVersion), { ...record, state: "applied" });
        else if (["needs_review", "superseded"].includes(state ?? "")) this.store.saveReview(this.store.reviewKey(record.id, record.revision, record.policyVersion), { ...record, state: "held", reason: "Evidence changed or mutation needs reconciliation." });
      }
      delete run.approvedIds; this.store.saveRun(run);
    }
  }
  private sources(run: StoredRun): BriefInput {
    const registry = this.track.loadRegistry(); const sources: BriefSource[] = [];
    const now = this.now().getTime(), since = now - 7 * 24 * 60 * 60_000;
    const timer = this.track.getTimer(), timerStart = timer ? Date.parse(timer.start) : NaN;
    if (timer && Number.isFinite(timerStart) && timerStart <= now) sources.push({ id: "focus:active", kind: "focus", title: `Current focus: ${registry.tasks.find(task => task.id === timer.taskId)?.title.slice(0, 200) ?? timer.taskId}`, details: JSON.stringify({ taskId: timer.taskId, startedAt: timer.start, elapsedMinutes: Math.floor((now - timerStart) / 60_000), timeZone: "America/New_York", note: timer.note?.slice(0, 300) }) });
    const focus = new Map<string, number>();
    for (const entry of this.track.readEntries()) {
      const start = Date.parse(entry.start), end = Date.parse(entry.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now || end <= since || start > now) continue;
      focus.set(entry.taskId, (focus.get(entry.taskId) ?? 0) + (end - Math.max(start, since)) / 60_000);
    }
    for (const [taskId, minutes] of [...focus].sort((a, b) => b[1] - a[1]).slice(0, 8)) sources.push({ id: `time:${taskId}`, kind: "time", title: registry.tasks.find(task => task.id === taskId)?.title.slice(0, 200) ?? taskId, details: JSON.stringify({ completedMinutes: Math.round(minutes), window: "preceding 168 hours", through: this.now().toISOString(), timeZone: "America/New_York" }) });
    for (const task of registry.tasks.filter(item => item.status === "open").slice(0, 150)) sources.push({ id: `task:${task.id}`, kind: "task", title: task.title.slice(0, 300), details: `Project: ${task.projectId ?? "none"}. ${(task.notes ?? "").slice(0, 600)}` });
    for (const project of registry.projects.slice(0, 50)) sources.push({ id: `project:${project.id}`, kind: "project", title: project.name.slice(0, 200), details: JSON.stringify({ deadline: project.deadline, milestone: project.nextMilestone, milestoneDeadline: project.nextMilestoneDeadline, lastCheckIn: project.lastCheckIn, status: project.status, role: project.role, goal: project.goal?.slice(0, 250) }) });
    for (const product of registry.products.slice(0, 30)) sources.push({ id: `product:${product.id}`, kind: "product", title: product.name.slice(0, 200), details: JSON.stringify({ deadline: product.deadline, lastCheckIn: product.lastCheckIn, status: product.status, goal: product.goal?.slice(0, 250) }) });
    const recent = this.jobs.history(10).filter(item => item.mode === "apply").slice(0, 3);
    for (const item of recent) sources.push({ id: `triage:${item.id}`, kind: "triage", title: `${item.day}: ${item.state}`, details: JSON.stringify({ completedAt: item.finishedAt, accounts: item.accounts }) });
    for (const review of this.snapshot().reviews.slice(0, 25)) sources.push({ id: `review:${review.id}`, kind: "review", title: review.subject.slice(0, 200), details: `Held for review (${review.reason}). Account: ${review.account}. No action has been taken.` });
    const accountSet = this.jobs.status().configuredAccounts;
    const heldCount = this.jobs.reviews().filter(item => item.mode === "apply" && accountSet.includes(item.account)).length;
    const coverage = [`Scheduled Gmail accounts: ${accountSet.join(", ") || "none"}.`, `Held Gmail items: ${heldCount}.`, "Slack and desktop-only Gmail connections are not included in this workflow.", "Uses current tracker records and completed triage summaries; no independent full-inbox scan."];
    if (!recent.some(item => item.day === run.day)) coverage.push("No completed apply-mode Gmail triage for this day; briefing may be incomplete.");
    if (registry.tasks.filter(item => item.status === "open").length > 150) coverage.push("Tracker source list truncated to 150 open tasks.");
    // Bound input deterministically; reveal truncation rather than silently imply complete coverage.
    while (Buffer.byteLength(JSON.stringify(sources)) > 70_000) { sources.pop(); if (!coverage.includes("Some source records omitted due to the briefing input limit.")) coverage.push("Some source records omitted due to the briefing input limit."); }
    return { day: run.day, now: this.now().toISOString(), sources, coverage };
  }
  private async brief(run: StoredRun, signal: AbortSignal): Promise<void> {
    if (!this.mailConfigured()) throw new Error("BRIEF_DELIVERY_NOT_CONFIGURED");
    let artifact = this.store.briefing(run.day);
    if (!artifact) {
      const input = this.sources(run), result = await this.model(run, input, BRIEF_MAX_TOKENS, () => this.provider.brief(input, signal));
      const proposal = briefSchema.parse(result.value); const ids = new Set(input.sources.map(item => item.id));
      if (proposal.priorities.some(item => item.sourceIds.some(id => !ids.has(id)))) throw new Error("BRIEF_INVALID_SOURCE");
      const lines = [`## ${run.day} — ${safeText(proposal.title)}`, "", safeText(proposal.summary), "", "### Priorities", ...proposal.priorities.map((item, index) => `${index + 1}. **${safeText(item.title)}** — ${safeText(item.detail)} (${item.sourceIds.join(", ")})`), "", "### Notes", ...proposal.notes.map(note => `- ${safeText(note)}`), "", "### Coverage", ...input.coverage.map(note => `- ${safeText(note)}`)];
      artifact = { id: randomUUID(), day: run.day, createdAt: this.now().toISOString(), model: result.model, markdown: lines.join("\n"), sourceRunIds: input.sources.filter(item => item.kind === "triage").map(item => item.id.slice(7)), sourceIds: [...ids], coverage: input.coverage };
      this.store.saveBriefing(artifact);
    }
    this.projectBrief(artifact); this.assertClaim(run);
    let entry = this.store.outbox(run.day, this.recipient);
    if (!entry) {
      const messageId = `<lifeos-${digest([run.day, this.account, this.recipient])}@life-os.local>`;
      entry = { id: randomUUID(), day: run.day, artifactId: artifact.id, account: this.account, recipient: this.recipient, messageId, contentHash: createHash("sha256").update(artifact.markdown.replace(/\r\n/g, "\n").trim()).digest("hex"), state: "pending", createdAt: this.now().toISOString() };
      this.store.createDelivery(entry, this.delivery.prepare(artifact, this.account, this.recipient, messageId));
    }
    if (entry.state === "sent" || entry.state === "failed") return;
    const raw = this.store.raw(entry);
    if (["sending", "uncertain"].includes(entry.state)) {
      await this.reconcile(entry, raw, signal); if ((entry as BriefDelivery).state !== "sent") run.held++; return;
    }
    entry.state = "sending"; entry.attemptedAt = this.now().toISOString(); this.store.saveDelivery(entry);
    try {
      const sent = await this.delivery.send(entry, raw, signal); this.assertClaim(run);
      entry.state = "sent"; entry.gmailMessageId = sent.id; entry.gmailThreadId = sent.threadId; entry.sentAt = this.now().toISOString(); this.store.saveDelivery(entry);
    } catch {
      // A timeout may mean Gmail accepted the message. Persist uncertainty before reconciliation and never resend automatically.
      entry.state = "uncertain"; entry.errorCode = "BRIEF_SEND_UNCERTAIN"; this.store.saveDelivery(entry);
      await this.reconcile(entry, raw, signal); if ((entry as BriefDelivery).state !== "sent") run.held++;
    }
  }
  private async reconcile(entry: BriefDelivery, raw: string, signal: AbortSignal): Promise<void> {
    entry.reconcileAttempts = (entry.reconcileAttempts ?? 0) + 1;
    entry.nextReconcileAt = new Date(this.now().getTime() + 15 * 60_000).toISOString(); this.store.saveDelivery(entry);
    try { const found = await this.delivery.reconcile(entry, raw, signal); if (found) { entry.state = "sent"; entry.gmailMessageId = found.id; entry.gmailThreadId = found.threadId; entry.sentAt = this.now().toISOString(); delete entry.errorCode; this.store.saveDelivery(entry); } } catch { entry.state = "uncertain"; entry.errorCode = "BRIEF_RECONCILIATION_PENDING"; this.store.saveDelivery(entry); }
  }
  private projectBrief(artifact: BriefingArtifact): void {
    if (this.store.briefing()?.id !== artifact.id) return; // Reconcile old deliveries without replacing today's dashboard projection.
    let previous = ""; try { previous = readFileSync(join(this.config.triageLogDir, "briefing.md"), "utf8"); } catch { /* first brief */ }
    const sections = previous.split(/(?=^## \d{4}-\d{2}-\d{2})/m).filter(section => /^## \d{4}-\d{2}-\d{2}/.test(section) && !section.startsWith(`## ${artifact.day}`)).slice(0, 13);
    writeAtomic(join(this.config.triageLogDir, "briefing.md"), [artifact.markdown, ...sections].join("\n\n").slice(0, 450_000));
  }
}
