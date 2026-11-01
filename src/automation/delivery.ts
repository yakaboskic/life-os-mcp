import { createHash } from "node:crypto";
import { createMimeMessage } from "mimetext";
import { renderBriefEmailHtml } from "./brief-email.js";
import type { gmail_v1 } from "googleapis";
import type { GmailManagerLike } from "../toolsets/gmail/client.js";
import { getHeader } from "../toolsets/gmail/mime.js";
import type { BriefDelivery, BriefDeliveryGateway, BriefingArtifact } from "./types.js";

// Require exactly one mailbox. Extracting the first <address> would accept extra recipients.
const address = (value: string) => { const match = value.trim().match(/^(?:[^<>,;]*<([^<>]+)>|([^<>,;\s]+))$/); return (match?.[1] ?? match?.[2] ?? "").trim().toLowerCase(); };
const plain = (value: string) => value.replace(/\r\n/g, "\n").trim();
const HTML_HASH_HEADER = "X-LifeOS-Brief-HTML-SHA256";
const MAX_PLAIN_BYTES = 64_000, MAX_HTML_BYTES = 256_000;
const hash = (value: string): string => createHash("sha256").update(plain(value)).digest("hex");
function storedHtmlHash(raw: string): string | undefined {
  // This is the immutable outbox MIME we prepared, never a header supplied by Gmail.
  // Pinning the HTML hash here also permits reconciliation after a renderer update.
  const headers = Buffer.from(raw, "base64url").toString("utf8").split(/\r?\n\r?\n/, 1)[0] ?? "";
  const values = headers.split(/\r?\n/).filter(line => line.toLowerCase().startsWith(HTML_HASH_HEADER.toLowerCase() + ":"));
  if (!values.length) return undefined;
  const value = values[0]!.slice(HTML_HASH_HEADER.length + 1).trim();
  if (values.length !== 1 || !/^[a-f0-9]{64}$/.test(value)) throw new Error("BRIEF_STORED_MIME_INVALID");
  return value;
}
function decodedPart(part: gmail_v1.Schema$MessagePart | undefined, type: string, limit: number): string {
  const body = part?.body;
  if (part?.mimeType !== type || part.filename || part.parts?.length || body?.attachmentId || typeof body?.data !== "string" || !/^[A-Za-z0-9_-]*={0,2}$/.test(body.data) || body.data.length > Math.ceil(limit / 3) * 4 || !Number.isSafeInteger(body.size) || body.size! < 0 || body.size! > limit) throw new Error("BRIEF_SENT_MIME_MISMATCH");
  const decoded = Buffer.from(body.data, "base64url");
  if (decoded.byteLength !== body.size) throw new Error("BRIEF_SENT_MIME_MISMATCH");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(decoded); }
  catch { throw new Error("BRIEF_SENT_MIME_MISMATCH"); }
}
const IDENTITY_HEADERS = ["Message-ID", "From", "To", "Cc", "Bcc", "Subject", "X-LifeOS-Brief-ID"];
const queryValue = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export class GmailBriefDelivery implements BriefDeliveryGateway {
  constructor(private readonly manager: GmailManagerLike, private readonly account: string, private readonly recipient: string) {}
  prepare(artifact: BriefingArtifact, account: string, recipient: string, messageId: string): string {
    if (Buffer.byteLength(artifact.markdown) > MAX_PLAIN_BYTES) throw new Error("BRIEF_BODY_TOO_LARGE");
    const html = renderBriefEmailHtml(artifact.markdown);
    if (Buffer.byteLength(html) > MAX_HTML_BYTES) throw new Error("BRIEF_BODY_TOO_LARGE");
    const msg = createMimeMessage(); msg.setSender({ addr: account }); msg.setTo([recipient]); msg.setSubject(`LifeOS daily brief — ${artifact.day}`);
    msg.setHeader("Message-ID", messageId); msg.setHeader("Date", new Date(artifact.createdAt).toUTCString());
    msg.setHeader("Auto-Submitted", "auto-generated"); msg.setHeader("X-LifeOS-Brief-ID", artifact.id);
    msg.setHeader(HTML_HASH_HEADER, hash(html));
    // MIMEText accepts already-encoded data; base64 keeps Unicode and long lines intact.
    const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
    msg.addMessage({ contentType: "text/plain", data: encoded(artifact.markdown), charset: "UTF-8", encoding: "base64" });
    msg.addMessage({ contentType: "text/html", data: encoded(html), charset: "UTF-8", encoding: "base64" });
    return Buffer.from(msg.asRaw(), "utf8").toString("base64url");
  }
  async send(delivery: BriefDelivery, raw: string, signal: AbortSignal): Promise<{ id: string; threadId?: string }> {
    return this.manager.withClient(delivery.account, async (gmail, email) => {
      if (email !== delivery.account || delivery.account !== this.account || delivery.recipient !== this.recipient || email !== delivery.recipient) throw new Error("BRIEF_DELIVERY_ACCOUNT_MISMATCH");
      const profile = await gmail.users.getProfile({ userId: "me" }, { signal, timeout: 30_000 });
      if (profile.data.emailAddress?.toLowerCase() !== email) throw new Error("BRIEF_DELIVERY_ACCOUNT_MISMATCH");
      const result = await gmail.users.messages.send({ userId: "me", requestBody: { raw } }, { signal, timeout: 30_000, retry: false });
      if (!result.data.id) throw new Error("BRIEF_SEND_RESPONSE_MISSING_ID");
      return { id: result.data.id, threadId: result.data.threadId ?? undefined };
    });
  }
  async reconcile(delivery: BriefDelivery, raw: string, signal: AbortSignal): Promise<{ id: string; threadId?: string } | null> {
    return this.manager.withClient(delivery.account, async (gmail, email) => {
      if (email !== delivery.account || delivery.account !== this.account || delivery.recipient !== this.recipient || email !== delivery.recipient) throw new Error("BRIEF_DELIVERY_ACCOUNT_MISMATCH");
      const expectedHtmlHash = storedHtmlHash(raw);
      const attempted = Date.parse(delivery.attemptedAt ?? delivery.createdAt);
      if (!Number.isFinite(attempted)) throw new Error("BRIEF_DELIVERY_TIME_INVALID");
      const after = Math.floor(attempted / 1000) - 300, before = Math.floor(attempted / 1000) + 24 * 60 * 60;
      const subject = `LifeOS daily brief — ${delivery.day}`;
      const subjectMatches = (value: string | undefined): boolean => {
        if (value?.trim() === subject) return true;
        // Our MIME writer emits one RFC 2047 UTF-8/base64 encoded-word. Gmail can
        // preserve it in API headers; accept that exact encoding as well as decoded text.
        const encoded = value?.trim().match(/^=\?utf-8\?b\?([A-Za-z0-9+/]*={0,2})\?=$/i);
        return encoded?.[1] === Buffer.from(subject, "utf8").toString("base64");
      };
      const identityMatches = (message: gmail_v1.Schema$Message): boolean => {
        const headers = message.payload?.headers;
        // Ambiguous duplicate headers do not establish a fixed envelope or artifact identity.
        if (["From", "To", "Subject", "X-LifeOS-Brief-ID"].some(name => headers?.filter(header => header.name?.toLowerCase() === name.toLowerCase()).length !== 1)) return false;
        if (["Cc", "Bcc"].some(name => headers?.some(header => header.name?.toLowerCase() === name.toLowerCase() && header.value?.trim()))) return false;
        const timestamp = Number(message.internalDate);
        return !!message.id && !!message.labelIds?.includes("SENT") && Number.isFinite(timestamp) && timestamp > after * 1000 && timestamp < before * 1000
          && getHeader(headers, "X-LifeOS-Brief-ID") === delivery.artifactId
          && address(getHeader(headers, "From") ?? "") === delivery.account
          && address(getHeader(headers, "To") ?? "") === delivery.recipient
          && subjectMatches(getHeader(headers, "Subject"));
      };
      const metadataCache = new Map<string, gmail_v1.Schema$Message>();
      const candidates = async (query: string, requireOriginalId: boolean): Promise<gmail_v1.Schema$Message[]> => {
        const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 20, fields: "messages(id),nextPageToken" }, { signal, timeout: 30_000, maxContentLength: 16_000 });
        if (list.data.nextPageToken || (list.data.messages?.length ?? 0) > 20) throw new Error("BRIEF_SENT_SEARCH_INCOMPLETE");
        const matches: gmail_v1.Schema$Message[] = [];
        for (const message of list.data.messages ?? []) {
          signal.throwIfAborted();
          if (!message.id) throw new Error("BRIEF_SENT_SEARCH_INCOMPLETE");
          let metadata = metadataCache.get(message.id);
          if (!metadata) {
            metadata = (await gmail.users.messages.get({ userId: "me", id: message.id, format: "metadata", metadataHeaders: IDENTITY_HEADERS, fields: "id,threadId,internalDate,labelIds,sizeEstimate,payload(headers)" }, { signal, timeout: 30_000, maxContentLength: 32_000 })).data;
            if (metadata.id !== message.id) throw new Error("BRIEF_SENT_IDENTITY_MISMATCH");
            metadataCache.set(message.id, metadata);
          }
          if (identityMatches(metadata) && (!requireOriginalId || getHeader(metadata.payload?.headers, "Message-ID") === delivery.messageId)) matches.push(metadata);
        }
        if (matches.length > 1) throw new Error("BRIEF_MULTIPLE_SENT_MATCHES");
        return matches;
      };
      const original = await candidates(`in:sent rfc822msgid:${delivery.messageId.replace(/[<>]/g, "")}`, true);
      // Gmail may replace the RFC Message-ID. A fixed artifact header plus envelope and body
      // establishes delivery identity; the broad query itself never authorizes a match or resend.
      const envelope = await candidates(`in:sent from:${queryValue(delivery.account)} to:${queryValue(delivery.recipient)} subject:${queryValue(subject)} after:${after} before:${before}`, false);
      const matches = [...new Map([...original, ...envelope].map(message => [message.id, message])).values()];
      if (matches.length > 1) throw new Error("BRIEF_MULTIPLE_SENT_MATCHES");
      if (!matches.length) return null;
      const id = matches[0]!.id!;
      const maxMessageBytes = expectedHtmlHash ? 512_000 : 96_000;
      if (!Number.isSafeInteger(matches[0]!.sizeEstimate) || matches[0]!.sizeEstimate! < 0 || matches[0]!.sizeEstimate! > maxMessageBytes) throw new Error("BRIEF_SENT_RESPONSE_TOO_LARGE");
      const result = await gmail.users.messages.get({ userId: "me", id, format: "full" }, { signal, timeout: 30_000, maxContentLength: expectedHtmlHash ? 600_000 : 128_000 });
      const payload = result.data.payload;
      let text: string;
      if (!expectedHtmlHash && payload?.mimeType === "text/plain") {
        // Existing outbox records and Sent mail keep their original plain-only format.
        text = decodedPart(payload, "text/plain", MAX_PLAIN_BYTES);
      } else {
        // Only our exact alternative shape is allowed; no ignored MIME parts or attachments.
        if (!expectedHtmlHash || payload?.mimeType !== "multipart/alternative" || payload.filename || payload.body?.attachmentId || payload.body?.data || (payload.body?.size ?? 0) !== 0 || payload.parts?.length !== 2) throw new Error("BRIEF_SENT_MIME_MISMATCH");
        const textParts = payload.parts.filter(part => part.mimeType === "text/plain"), htmlParts = payload.parts.filter(part => part.mimeType === "text/html");
        if (textParts.length !== 1 || htmlParts.length !== 1) throw new Error("BRIEF_SENT_MIME_MISMATCH");
        text = decodedPart(textParts[0], "text/plain", MAX_PLAIN_BYTES);
        const html = decodedPart(htmlParts[0], "text/html", MAX_HTML_BYTES);
        if (hash(html) !== expectedHtmlHash) throw new Error("BRIEF_SENT_IDENTITY_MISMATCH");
      }
      if (!identityMatches(result.data) || result.data.id !== id || hash(text) !== delivery.contentHash) throw new Error("BRIEF_SENT_IDENTITY_MISMATCH");
      return { id, threadId: result.data.threadId ?? undefined };
    }, { readOnly: true });
  }
}
