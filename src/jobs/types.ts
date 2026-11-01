export const CATEGORIES = ["ACTION/NOW", "ACTION/SOON", "WAITING", "CALENDAR", "FINANCE/RECEIPT", "LEGAL/COMPLIANCE", "FYI/READ", "NEWSLETTER", "SPAM/SUSPECT"] as const;
export type Category = (typeof CATEGORIES)[number];
export const ACTIVE_CATEGORIES: Category[] = ["ACTION/NOW", "ACTION/SOON", "WAITING", "LEGAL/COMPLIANCE"];
export const RUBRIC_VERSION = "gmail-triage-v1";
export const TIME_ZONE = "America/New_York";
export type RunMode = "dry-run" | "apply";
export interface MailMessage {
  id: string; internalDate: number; labels: string[]; from: string; to: string; subject: string;
  body: string; truncated: boolean; attachments: boolean;
  rfcMessageId?: string;
}
export interface MailThread { id: string; messages: MailMessage[] }
export interface CapturedMessage { id: string; internalDate: number; labels: string[] }
export interface MutationPlan {
  ids: string[]; add: string[]; remove: string[]; before: CapturedMessage[];
  allMessageIds: string[];
}
export interface Decision {
  category: Category; confidence: number; probabilities: Record<Category, number>;
  model: string; inputTokens?: number; reviewed?: boolean;
  agentReview?: { policyVersion: string; revision: string; reason: string; evidence: Array<{ messageId: string; quote: string }>; actor: "claude" };
  humanReview?: { requestId: string; actor: string; revision: string; sender?: string; preferenceVersion?: number };
  preferenceEvidence?: { sender: string; version: number };
}
export interface SenderPreference { id: string; account: string; sender: string; category: Category; createdAt: string; updatedAt: string; version: number }
export interface ClassificationInput { account: string; now: string; timeZone: string; thread: MailThread; senderPreference?: SenderPreference }
export interface Classifier { classify(input: ClassificationInput, signal: AbortSignal): Promise<Decision> }
export interface MailGateway {
  accounts(): string[];
  verify(account: string, signal: AbortSignal): Promise<void>;
  labels(account: string, create: boolean, signal: AbortSignal): Promise<Record<string, string>>;
  listThreads(account: string, query: string, signal: AbortSignal): Promise<string[]>;
  thread(account: string, id: string, signal: AbortSignal): Promise<MailThread>;
  modify(account: string, plan: MutationPlan, signal: AbortSignal): Promise<void>;
}
export interface AccountResult { account: string; alias?: string; state: "running" | "success" | "partial" | "auth_blocked" | "failed"; processed: number; held: number; failed: number; completed: number; lastSucceededAt?: string; errorCode?: string }
export interface JobRun {
  id: string; name: "gmail-triage"; mode: RunMode; scheduled: boolean; day: string;
  state: "running" | "success" | "partial" | "failed" | "interrupted";
  startedAt: string; finishedAt?: string; accounts: AccountResult[]; errorCode?: string;
  reviewedIds?: string[];
}
export type ReviewGateReason = "accepted" | "not_clear" | "needs_context" | "no_category" | "below_threshold" | "policy_error";
export interface ReviewDecisionDiagnostics { confidence?: number; clear?: boolean; needsMoreContext?: boolean; gateReason?: ReviewGateReason }
export interface ClassificationDiagnostics { provider: "jev"; model: string; category: Category; confidence: number; probabilities: Partial<Record<Category, number>>; minimumConfidence: number }
export interface AgentReviewSummary extends ReviewDecisionDiagnostics { category: Category | null; reason: string; model: string; createdAt: string; source: "claude" | "policy"; minimumConfidence: number }
export interface ReviewItem {
  id: string; account: string; threadId: string; subject: string; sender: string;
  category?: Category; confidence?: number; reason: string; createdAt: string; resolvedAt?: string;
  mode?: RunMode; revision?: string; reviewable?: boolean;
  classification?: ClassificationDiagnostics;
  agentReview?: AgentReviewSummary;
}
export interface AgentReviewContext { itemId: string; revision: string; policyVersion: string; account: string; now: string; thread: MailThread; triggerIds: string[]; proposedCategory?: Category; senderPreference?: SenderPreference; preferenceEvidence?: { sender: string; version: number } }
export interface AgentReviewProposal { itemId: string; revision: string; policyVersion: string; category: Category | null; clear: boolean; confidence: number; needsMoreContext: boolean; reason: string; evidence: Array<{ messageId: string; quote: string }>; preferenceEvidence?: { sender: string; version: number } }
export interface ReviewInspection { item: ReviewItem; messages: MailMessage[]; truncated: boolean; capturedRevision: string; currentRevision: string; changed: boolean; blockedReason?: string }
export interface HumanReviewInput { itemId: string; revision: string; category: Category; requestId: string; actor: string; preferenceEvidence?: { sender: string; version: number } }
export interface HumanReviewState { state: string; reason?: string; account: string; category: Category; revision: string; sender?: string; preferenceVersion?: number }
export interface JobStatus {
  activeRun: JobRun | null; lastRun: JobRun | null; lastSuccessfulRun: JobRun | null;
  nextRunAt: string; schedule: string; timeZone: string; accounts: AccountResult[];
  reviewCount: number; paused: boolean; configuredAccounts: string[];
}
export interface StartJobInput { mode: RunMode; scheduled?: boolean; retryRunId?: string; reviewedIds?: string[]; signal?: AbortSignal }
export interface JobService {
  start(input: StartJobInput): Promise<JobRun>; status(): JobStatus; history(limit?: number): JobRun[];
  reviews(): ReviewItem[]; resolve(itemId: string, category: Category): ReviewItem;
  drain(): Promise<void>; resume(): void;
  reviewContext?(itemId: string, signal: AbortSignal): Promise<AgentReviewContext>;
  acceptAgentReview?(proposal: AgentReviewProposal, model: string, signal: AbortSignal, guard?: () => void): Promise<ReviewItem>;
  applyReviewed?(ids: string[], signal?: AbortSignal): Promise<JobRun>;
  readyReviewIds?(): string[];
  reviewedWorkState?(id: string): string | undefined;
  inspectReview?(itemId: string, signal: AbortSignal): Promise<ReviewInspection>;
  acceptHumanReview?(input: HumanReviewInput, signal: AbortSignal, guard?: () => void): Promise<ReviewItem>;
  humanReviewState?(itemId: string, requestId: string): HumanReviewState | undefined;
  holdHumanReview?(itemId: string, requestId: string): void;
  rememberHumanPreference?(itemId: string, requestId: string): boolean;
  senderPreferences?(): SenderPreference[];
  forgetSenderPreference?(id: string): void;
  reviewPreferenceVersion?(itemId: string): { sender: string; version: number } | undefined;
}
