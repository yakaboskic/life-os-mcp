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
}
export interface ClassificationInput { account: string; now: string; timeZone: string; thread: MailThread }
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
export interface ReviewItem {
  id: string; account: string; threadId: string; subject: string; sender: string;
  category?: Category; confidence?: number; reason: string; createdAt: string; resolvedAt?: string;
  mode?: RunMode; revision?: string; reviewable?: boolean;
  agentReview?: { category: Category | null; reason: string; model: string; createdAt: string };
}
export interface AgentReviewContext { itemId: string; revision: string; policyVersion: string; account: string; now: string; thread: MailThread; triggerIds: string[]; proposedCategory?: Category }
export interface AgentReviewProposal { itemId: string; revision: string; policyVersion: string; category: Category | null; clear: boolean; confidence: number; needsMoreContext: boolean; reason: string; evidence: Array<{ messageId: string; quote: string }> }
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
  acceptAgentReview?(proposal: AgentReviewProposal, model: string, signal: AbortSignal): Promise<ReviewItem>;
  applyReviewed?(ids: string[], signal?: AbortSignal): Promise<JobRun>;
  readyReviewIds?(): string[];
  reviewedWorkState?(id: string): string | undefined;
}
