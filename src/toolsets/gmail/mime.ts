import { createMimeMessage } from "mimetext";
import type { gmail_v1 } from "googleapis";
import type { AttachmentMeta, MessageSummary } from "./types.js";

// ---------------------------------------------------------------------------
// Composing (RFC 2822 via mimetext, behind our own wrapper so a future library
// swap touches only this file)
// ---------------------------------------------------------------------------

export interface ComposeOptions {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  textBody: string;
  /** Original message's Message-ID header value, e.g. "<abc@mail.gmail.com>" */
  inReplyTo?: string;
  /** Original References + original Message-ID, space-separated */
  references?: string;
}

/** Returns the base64url-encoded RFC 2822 message for Gmail's `raw` field. */
export function composeEmail(opts: ComposeOptions): string {
  const msg = createMimeMessage();
  msg.setSender({ addr: opts.from });
  msg.setTo(opts.to);
  if (opts.cc && opts.cc.length > 0) msg.setCc(opts.cc);
  if (opts.bcc && opts.bcc.length > 0) msg.setBcc(opts.bcc);
  msg.setSubject(opts.subject);
  if (opts.inReplyTo) msg.setHeader("In-Reply-To", opts.inReplyTo);
  if (opts.references) msg.setHeader("References", opts.references);
  msg.addMessage({ contentType: "text/plain", data: opts.textBody, charset: "UTF-8" });
  return Buffer.from(msg.asRaw(), "utf8").toString("base64url");
}

/** "Re: X" idempotently — never "Re: Re: X". */
export function replySubject(originalSubject: string | undefined): string {
  const subject = originalSubject?.trim() ?? "";
  if (/^re:/i.test(subject)) return subject;
  return subject ? `Re: ${subject}` : "Re:";
}

/** New References header = original References + original Message-ID. */
export function buildReferences(origReferences: string | undefined, origMessageId: string | undefined): string | undefined {
  const parts = [origReferences?.trim(), origMessageId?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

// ---------------------------------------------------------------------------
// Parsing Gmail payloads
// ---------------------------------------------------------------------------

export function getHeader(headers: gmail_v1.Schema$MessagePartHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? undefined;
}

function decodeBody(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64url").toString("utf8");
}

/** Minimal HTML→text for triage: good enough to read, not a renderer. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface WalkResult {
  text?: string;
  html?: string;
  attachments: AttachmentMeta[];
}

/**
 * Depth-first walk of the MIME tree. Inside multipart/alternative the
 * text/plain child wins; html is kept as fallback. Any part with a filename is
 * attachment metadata (bodies are never downloaded in v1).
 */
function walkParts(part: gmail_v1.Schema$MessagePart | undefined, acc: WalkResult): void {
  if (!part) return;
  const mimeType = part.mimeType ?? "";

  if (part.filename) {
    acc.attachments.push({
      filename: part.filename,
      mimeType,
      sizeBytes: part.body?.size ?? 0,
      attachmentId: part.body?.attachmentId ?? undefined,
    });
    return;
  }
  if (part.parts && part.parts.length > 0) {
    for (const child of part.parts) walkParts(child, acc);
    return;
  }
  if (mimeType === "text/plain" && acc.text === undefined) {
    acc.text = decodeBody(part.body?.data);
  } else if (mimeType === "text/html" && acc.html === undefined) {
    acc.html = decodeBody(part.body?.data);
  }
}

export interface ParseOptions {
  /** Include the decoded body (get_message/get_thread); search hydration omits it. */
  includeBody?: boolean;
  maxBodyChars?: number;
}

export function parseMessage(msg: gmail_v1.Schema$Message, opts: ParseOptions = {}): MessageSummary {
  const headers = msg.payload?.headers;
  const labelIds = msg.labelIds ?? [];
  const summary: MessageSummary = {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : undefined,
    from: getHeader(headers, "From"),
    to: getHeader(headers, "To"),
    cc: getHeader(headers, "Cc"),
    subject: getHeader(headers, "Subject"),
    snippet: msg.snippet ?? undefined,
    labelIds,
    isUnread: labelIds.includes("UNREAD"),
  };

  if (opts.includeBody) {
    const acc: WalkResult = { attachments: [] };
    walkParts(msg.payload, acc);
    let body = acc.text !== undefined && acc.text !== "" ? acc.text : acc.html ? htmlToText(acc.html) : "";
    const max = opts.maxBodyChars ?? 5000;
    if (body.length > max) {
      summary.bodyTruncated = true;
      body = `${body.slice(0, max)}\n… [truncated at ${max} chars — re-fetch with a larger maxBodyChars to see more]`;
    }
    summary.body = body;
    if (acc.attachments.length > 0) summary.attachments = acc.attachments;
  }

  return summary;
}

/** Small bounded-concurrency map for metadata hydration after search. */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
