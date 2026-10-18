import type { JobRun, ReviewItem, AgentReviewContext, AgentReviewProposal } from "../jobs/types.js";

export const AUTOMATION_POLICY = "lifeos-review-v1";
export type AutomationKind = "review" | "brief" | "daily";
export interface AutomationSchedule { enabled: boolean; localTime: string; timeZone: "America/New_York"; reviewEnabled: boolean; briefEnabled: boolean; nextRunAt: string }
export interface AutomationRun {
  id: string; kind: AutomationKind; day: string; state: "queued" | "running" | "retry_wait" | "succeeded" | "partial" | "failed";
  createdAt: string; startedAt?: string; finishedAt?: string; nextAttemptAt?: string; attempts: number; actor: string;
  stage: "review" | "brief" | "done"; reviewed: number; applied: number; held: number; failed: number; errorCode?: string;
  sourceRunId?: string; claim?: string;
}
export interface BriefingArtifact { id: string; day: string; createdAt: string; model: string; markdown: string; sourceRunIds: string[]; sourceIds: string[]; coverage: string[] }
export interface BriefDelivery {
  id: string; day: string; artifactId: string; account: string; recipient: string; messageId: string;
  contentHash: string; state: "pending" | "sending" | "sent" | "uncertain" | "failed"; createdAt: string; attemptedAt?: string; sentAt?: string;
  gmailMessageId?: string; gmailThreadId?: string; errorCode?: string;
  reconcileAttempts?: number; nextReconcileAt?: string;
}
export interface AutomationSnapshot {
  configured: boolean; model: string; paused: boolean; activeCount: number; reviews: ReviewItem[]; runs: AutomationRun[];
  schedule: AutomationSchedule; briefing: BriefingArtifact | null; deliveries: BriefDelivery[];
  usage: { day: string; calls: number; inputTokens: number; outputTokens: number; maxCalls: number; maxInputTokens: number; maxOutputTokens: number };
  recentDecisions?: AutomationReviewDecision[];
}
export interface AutomationReviewDecision { id: string; account: string; category: string | null; state: "held" | "accepted" | "applied"; model: string; reason: string; createdAt: string }
export interface BriefSource { id: string; kind: "task" | "project" | "product" | "triage" | "review" | "focus" | "time"; title: string; details: string }
export interface BriefInput { day: string; now: string; sources: BriefSource[]; coverage: string[] }
export interface BriefProposal { title: string; summary: string; priorities: Array<{ title: string; detail: string; sourceIds: string[] }>; notes: string[] }
export interface ProviderResult<T> { value: T; model: string; inputTokens: number; outputTokens: number }
export interface AutomationProvider {
  readonly model: string; configured(): boolean;
  review(context: AgentReviewContext, signal: AbortSignal): Promise<ProviderResult<AgentReviewProposal>>;
  brief(input: BriefInput, signal: AbortSignal): Promise<ProviderResult<BriefProposal>>;
}
export interface BriefDeliveryGateway {
  prepare(artifact: BriefingArtifact, account: string, recipient: string, messageId: string): string;
  send(delivery: BriefDelivery, raw: string, signal: AbortSignal): Promise<{ id: string; threadId?: string }>;
  reconcile(delivery: BriefDelivery, raw: string, signal: AbortSignal): Promise<{ id: string; threadId?: string } | null>;
}
export interface AutomationService {
  snapshot(): AutomationSnapshot;
  command(action: "automation.run" | "automation.schedule" | "review.resolve", input: unknown, requestId: string, actor: string): Promise<AutomationSnapshot>;
  tick(): Promise<void>; afterTriage(run: JobRun): void; drain(): Promise<void>; resume(): void; readonly activeCount: number;
}
