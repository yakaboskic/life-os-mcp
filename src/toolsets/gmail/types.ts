// TokenFile moved to src/google/token-store.ts (shared); re-exported for existing imports.
export type { TokenFile } from "../../google/token-store.js";

export interface AccountInfo {
  email: string;
  aliases: string[];
  scopes: string[];
  connected_at: string;
  updated_at: string;
}

export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attachmentId?: string;
}

export interface MessageSummary {
  id: string;
  threadId: string;
  date?: string;
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  snippet?: string;
  labelIds: string[];
  isUnread: boolean;
  body?: string;
  bodyTruncated?: boolean;
  attachments?: AttachmentMeta[];
}

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
