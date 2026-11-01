import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { createMimeMessage } from "mimetext";
import type { gmail_v1 } from "googleapis";
import { renderBriefEmailHtml } from "../../src/automation/brief-email.js";
import { GmailBriefDelivery } from "../../src/automation/delivery.js";
import type { BriefingArtifact, BriefDelivery } from "../../src/automation/types.js";
import type { GmailManagerLike } from "../../src/toolsets/gmail/client.js";
const owner = "owner@example.com";
const artifact: BriefingArtifact = { id: "brief-1", day: "2026-10-18", createdAt: "2026-10-18T12:00:00Z", model: "test", markdown: "## 2026-10-18 — Daily brief\n\nReview the proposal.", sourceIds: [], sourceRunIds: [], coverage: [] };
const entry: BriefDelivery = { id: "delivery-1", day: artifact.day, artifactId: artifact.id, account: owner, recipient: owner, messageId: "<lifeos-test@life-os.local>", contentHash: createHash("sha256").update(artifact.markdown).digest("hex"), state: "pending", createdAt: artifact.createdAt };
interface FakeOptions { rewrittenId?: boolean; artifactId?: string; to?: string; from?: string; body?: string; duplicate?: boolean; pagination?: boolean; subject?: string; timestamp?: number; noSent?: boolean; duplicateHeader?: boolean; cc?: string; wrongMetadataId?: boolean; mixedCopies?: boolean; extraPart?: boolean; attachment?: boolean; sizeEstimate?: number; multipart?: boolean; html?: string; customParts?: gmail_v1.Schema$MessagePart[]; rootBody?: gmail_v1.Schema$MessagePartBody }
function fake(options: FakeOptions = {}) {
  const headers = [{ name: "From", value: options.from ?? owner }, { name: "To", value: options.to ?? owner }, { name: "Message-ID", value: options.rewrittenId ? "<server-replaced@mail.gmail.com>" : entry.messageId }, { name: "Subject", value: options.subject ?? `LifeOS daily brief — ${artifact.day}` }, { name: "X-LifeOS-Brief-ID", value: options.artifactId ?? artifact.id }];
  if (options.duplicateHeader) headers.push({ name: "X-LifeOS-Brief-ID", value: "forged-extra" });
  if (options.cc) headers.push({ name: "Cc", value: options.cc });
  const body: gmail_v1.Schema$Message = { id: "sent1", threadId: "thread1", sizeEstimate: options.sizeEstimate ?? 2000, internalDate: String(options.timestamp ?? Date.parse(artifact.createdAt)), labelIds: options.noSent ? ["INBOX"] : ["SENT"], payload: { mimeType: "text/plain", headers, ...(options.extraPart ? { parts: [{ mimeType: "text/html", body: { data: "Zm9yZ2Vk" } }] } : {}), body: { data: Buffer.from(options.body ?? artifact.markdown).toString("base64url"), size: Buffer.byteLength(options.body ?? artifact.markdown), ...(options.attachment ? { attachmentId: "unfetched-attachment" } : {}) } } };
  if (options.multipart) body.payload = { mimeType: "multipart/alternative", headers, body: options.rootBody ?? { size: 0 }, parts: options.customParts ?? [
    mimePart("text/plain", options.body ?? artifact.markdown), mimePart("text/html", options.html ?? renderBriefEmailHtml(artifact.markdown)),
  ] };
  const calls: any[] = [];
  const gmail = { users: { getProfile: async () => ({ data: { emailAddress: owner } }), messages: {
    send: async (arg: any, requestOptions: any) => { calls.push({ arg, options: requestOptions }); return { data: { id: "sent1", threadId: "thread1" } }; },
    list: async (arg: any, requestOptions: any) => { calls.push({ kind: "list", ...arg, options: requestOptions }); const missing = options.rewrittenId && arg.q.includes("rfc822msgid:"); return { data: { messages: options.mixedCopies && !arg.q.includes("rfc822msgid:") ? [{ id: "sent2" }] : missing ? [] : [{ id: "sent1" }, ...(options.duplicate ? [{ id: "sent2" }] : [])], ...(!missing && options.pagination ? { nextPageToken: "more" } : {}) } }; },
    get: async (arg: any, requestOptions: any) => { calls.push({ kind: "get", ...arg, options: requestOptions }); return { data: { ...body, id: options.wrongMetadataId && arg.format === "metadata" ? "wrong-message-id" : arg.id, ...(arg.format === "metadata" ? { payload: { headers } } : {}) } }; },
  } } };
  const manager = { withClient: async (_account: string, fn: any) => fn(gmail, owner) } as GmailManagerLike;
  return { gateway: new GmailBriefDelivery(manager, owner, owner), calls };
}
function mimePart(mimeType: string, text: string): gmail_v1.Schema$MessagePart {
  return { mimeType, body: { data: Buffer.from(text).toString("base64url"), size: Buffer.byteLength(text) } };
}
function legacyRaw(): string {
  const message = createMimeMessage(); message.setSender(owner); message.setTo(owner); message.setSubject(`LifeOS daily brief — ${artifact.day}`);
  message.setHeader("Message-ID", entry.messageId); message.setHeader("X-LifeOS-Brief-ID", artifact.id);
  message.addMessage({ contentType: "text/plain", data: artifact.markdown, charset: "UTF-8" });
  return Buffer.from(message.asRaw()).toString("base64url");
}
function mimeParts(raw: string) {
  const message = Buffer.from(raw, "base64url").toString("utf8"), boundary = message.match(/Content-Type: multipart\/alternative; boundary=([^\r\n]+)/)?.[1];
  if (!boundary) throw new Error("Expected an alternative boundary");
  return message.split("--" + boundary).slice(1, -1).map(part => {
    const [headers, ...body] = part.replace(/^\r?\n/, "").split(/\r?\n\r?\n/);
    expect(headers).toContain("Content-Transfer-Encoding: base64");
    return { type: headers!.match(/Content-Type: ([^;]+)/)![1], text: Buffer.from(body.join("\n\n").trim(), "base64").toString("utf8") };
  });
}
const reconcile = (f: ReturnType<typeof fake>, raw = legacyRaw()) => f.gateway.reconcile(entry, raw, new AbortController().signal);
const multipartRaw = (f: ReturnType<typeof fake>) => f.gateway.prepare(artifact, owner, owner, entry.messageId);
describe("fixed recipient brief delivery", () => {
  it("composes deterministic identity and sends with transport retries disabled", async () => {
    const f = fake(), raw = f.gateway.prepare(artifact, owner, owner, entry.messageId), mime = Buffer.from(raw, "base64url").toString();
    expect(mime).toContain(`Message-ID: ${entry.messageId}`); expect(mime).toContain("Auto-Submitted: auto-generated");
    const parts = mimeParts(raw);
    expect(parts.map(part => part.type)).toEqual(["text/plain", "text/html"]);
    expect(parts[0]!.text).toBe(artifact.markdown); expect(parts[1]!.text).toBe(renderBriefEmailHtml(artifact.markdown));
    expect(mime).toContain(`X-LifeOS-Brief-HTML-SHA256: ${createHash("sha256").update(parts[1]!.text).digest("hex")}`);
    await f.gateway.send(entry, raw, new AbortController().signal); expect(f.calls[0].options.retry).toBe(false);
  });
  it("finds original RFC identity after checking metadata, then verifies the exact body", async () => {
    const f = fake(); expect(await reconcile(f)).toEqual({ id: "sent1", threadId: "thread1" });
    expect(f.calls[0].q).toContain("rfc822msgid:lifeos-test@life-os.local"); expect(f.calls.filter(call => call.kind === "list")).toHaveLength(2);
    expect(f.calls.filter(call => call.kind === "get").map(call => call.format)).toEqual(["metadata", "full"]);
  });
  it("recovers a server-replaced RFC ID using exact artifact, envelope and body identity without sending", async () => {
    const f = fake({ rewrittenId: true }); expect(await reconcile(f)).toEqual({ id: "sent1", threadId: "thread1" });
    const lists = f.calls.filter(call => call.kind === "list"); expect(lists).toHaveLength(2); expect(lists[1].q).toContain('from:"owner@example.com" to:"owner@example.com"'); expect(lists[1].q).toContain('subject:"LifeOS daily brief — 2026-10-18"'); expect(lists[1].q).toContain(`after:${Date.parse(artifact.createdAt) / 1000 - 300} before:${Date.parse(artifact.createdAt) / 1000 + 86400}`);
    expect(f.calls.some(call => call.arg?.requestBody)).toBe(false);
  });
  it.each([
    { artifactId: "forged-artifact" }, { from: "other@example.com" }, { to: "Owner <owner@example.com>, Other <other@example.com>" },
    { to: "other@example.com, Owner <owner@example.com>" }, { subject: "Wrong day" }, { timestamp: Date.parse(artifact.createdAt) + 2 * 86400_000 },
    { to: "other@example.com, <owner@example.com>" },
    { noSent: true }, { duplicateHeader: true }, { cc: "other@example.com" },
  ])("does not fetch bodies for mismatched or ambiguous metadata: %j", async options => {
    const f = fake({ rewrittenId: true, ...options }); expect(await reconcile(f)).toBeNull(); expect(f.calls.some(call => call.format === "full")).toBe(false);
  });
  it("rejects forged body content even when artifact and envelope match", async () => {
    const f = fake({ rewrittenId: true, body: "Forged content copied under the same artifact identifier." }); await expect(reconcile(f)).rejects.toThrow("BRIEF_SENT_IDENTITY_MISMATCH");
  });
  it("rejects metadata for a different message before reading its body", async () => {
    const f = fake({ rewrittenId: true, wrongMetadataId: true }); await expect(reconcile(f)).rejects.toThrow("BRIEF_SENT_IDENTITY_MISMATCH"); expect(f.calls.some(call => call.format === "full")).toBe(false);
  });
  it.each([{ duplicate: true }, { pagination: true }])("holds duplicate or incomplete search results without reading bodies: %j", async options => {
    const f = fake({ rewrittenId: true, ...options }); await expect(reconcile(f)).rejects.toThrow(options.duplicate ? "BRIEF_MULTIPLE_SENT_MATCHES" : "BRIEF_SENT_SEARCH_INCOMPLETE"); expect(f.calls.some(call => call.format === "full")).toBe(false);
  });
  it("accepts the exact encoded-word subject emitted by the MIME writer", async () => {
    const f = fake({ rewrittenId: true, subject: `=?utf-8?B?${Buffer.from(`LifeOS daily brief — ${artifact.day}`).toString("base64")}?=` });
    expect(await reconcile(f)).toEqual({ id: "sent1", threadId: "thread1" });
  });
  it("detects ambiguity across preserved-ID and rewritten-ID search results", async () => {
    const f = fake({ mixedCopies: true }); await expect(reconcile(f)).rejects.toThrow("BRIEF_MULTIPLE_SENT_MATCHES"); expect(f.calls.some(call => call.format === "full")).toBe(false);
  });
  it.each([{ extraPart: true }, { attachment: true }])("rejects extra MIME content rather than hashing only a first text part: %j", async options => {
    const f = fake({ rewrittenId: true, ...options }); await expect(reconcile(f)).rejects.toThrow("BRIEF_SENT_MIME_MISMATCH");
  });
  it("bounds list, metadata and full response sizes and rejects oversized metadata before body fetch", async () => {
    const f = fake({ rewrittenId: true }); await reconcile(f);
    expect(f.calls.find(call => call.kind === "list").options.maxContentLength).toBe(16000);
    expect(f.calls.find(call => call.format === "metadata").options.maxContentLength).toBe(32000);
    expect(f.calls.find(call => call.format === "full").options.maxContentLength).toBe(128000);
    const large = fake({ rewrittenId: true, sizeEstimate: 100000 }); await expect(reconcile(large)).rejects.toThrow("BRIEF_SENT_RESPONSE_TOO_LARGE"); expect(large.calls.some(call => call.format === "full")).toBe(false);
  });
  it("preserves Unicode Markdown exactly in the plain part and renders structure in the HTML alternative", () => {
    const f = fake(), markdown = "## 2026-11-01 — Today's café priorities 🛰️\n\nRead & review.\n\n### Priorities\n1. **Review the résumé** — Make a decision. (task:résumé)\n2. **Plan next week** — Pick a date.\n\n### Notes\n- Waiting for the team.\n\n### Coverage\n- Connected accounts only.";
    const parts = mimeParts(f.gateway.prepare({ ...artifact, markdown }, owner, owner, entry.messageId));
    expect(parts[0]!.text).toBe(markdown);
    const html = parts[1]!.text;
    expect(html).toContain("<h1 "); expect(html).toContain("<h2 "); expect(html).toContain("<ol "); expect(html).toContain("<ul ");
    expect(html).toContain("<strong>Review the résumé</strong>"); expect(html).toContain("café priorities 🛰️"); expect(html).toContain("Read &amp; review.");
    expect(html).not.toContain("**Review"); expect(html).not.toContain("### Priorities");
  });
  it("reconciles both multipart parts after Gmail replaces the RFC ID without resending", async () => {
    const f = fake({ multipart: true, rewrittenId: true });
    expect(await reconcile(f, multipartRaw(f))).toEqual({ id: "sent1", threadId: "thread1" });
    expect(f.calls.some(call => call.arg?.requestBody)).toBe(false);
    expect(f.calls.find(call => call.format === "full").options.maxContentLength).toBe(600000);
  });
  it("keeps the HTML hash pinned to the persisted outbox across future renderer changes", async () => {
    const html = "<!doctype html><html><body><p>Earlier trusted presentation of the same brief.</p></body></html>", f = fake({ multipart: true, html });
    const message = createMimeMessage(); message.setSender(owner); message.setTo(owner); message.setSubject(`LifeOS daily brief — ${artifact.day}`);
    message.setHeader("X-LifeOS-Brief-HTML-SHA256", createHash("sha256").update(html).digest("hex"));
    message.addMessage({ contentType: "text/plain", data: artifact.markdown }); message.addMessage({ contentType: "text/html", data: html });
    expect(await reconcile(f, Buffer.from(message.asRaw()).toString("base64url"))).toEqual({ id: "sent1", threadId: "thread1" });
  });
  it.each([
    { html: "<p>Forged visible content.</p>" }, { body: "Forged canonical content." },
  ])("rejects changes to either multipart body: %j", async options => {
    const f = fake({ multipart: true, ...options }); await expect(reconcile(f, multipartRaw(f))).rejects.toThrow("BRIEF_SENT_IDENTITY_MISMATCH");
  });
  it("requires the stored format: neither a missing HTML part nor HTML added to a legacy send is accepted", async () => {
    const plainOnly = fake(); await expect(reconcile(plainOnly, multipartRaw(plainOnly))).rejects.toThrow("BRIEF_SENT_MIME_MISMATCH");
    const multipart = fake({ multipart: true }); await expect(reconcile(multipart)).rejects.toThrow("BRIEF_SENT_MIME_MISMATCH");
  });
  it.each([
    [mimePart("text/plain", artifact.markdown), mimePart("text/html", renderBriefEmailHtml(artifact.markdown)), mimePart("text/html", "Forged extra")],
    [mimePart("text/plain", artifact.markdown), mimePart("text/plain", artifact.markdown)],
    [mimePart("text/plain", artifact.markdown), { ...mimePart("text/html", renderBriefEmailHtml(artifact.markdown)), filename: "brief.html" }],
    [mimePart("text/plain", artifact.markdown), { ...mimePart("text/html", renderBriefEmailHtml(artifact.markdown)), parts: [mimePart("text/plain", "Ignored")] }],
    [mimePart("text/plain", artifact.markdown), { mimeType: "text/html", body: { attachmentId: "ignored", size: 1 } }],
    [mimePart("text/plain", artifact.markdown), { mimeType: "text/html", body: { data: "_w", size: 1 } }],
    [mimePart("text/plain", artifact.markdown), { mimeType: "text/html", body: { data: "YQ", size: 2 } }],
  ])("rejects multipart extras, duplicates, attachments, nesting and invalid decoded bodies", async (...customParts) => {
    const f = fake({ multipart: true, customParts }); await expect(reconcile(f, multipartRaw(f))).rejects.toThrow("BRIEF_SENT_MIME_MISMATCH");
  });
  it("rejects hidden root body data and oversized multipart messages before fetching their bodies", async () => {
    const f = fake({ multipart: true, rootBody: { data: "YQ", size: 1 } }); await expect(reconcile(f, multipartRaw(f))).rejects.toThrow("BRIEF_SENT_MIME_MISMATCH");
    const large = fake({ multipart: true, sizeEstimate: 512001 }); await expect(reconcile(large, multipartRaw(large))).rejects.toThrow("BRIEF_SENT_RESPONSE_TOO_LARGE"); expect(large.calls.some(call => call.format === "full")).toBe(false);
  });
  it("rejects oversized generated text rather than sending a brief it cannot reconcile", () => {
    const f = fake(); expect(() => f.gateway.prepare({ ...artifact, markdown: "é".repeat(32001) }, owner, owner, entry.messageId)).toThrow("BRIEF_BODY_TOO_LARGE");
    expect(() => f.gateway.prepare({ ...artifact, markdown: "&".repeat(64000) }, owner, owner, entry.messageId)).toThrow("BRIEF_BODY_TOO_LARGE");
  });
  it("rejects arbitrary recipients even if a caller changes an outbox object", async () => {
    const f = fake(); await expect(f.gateway.send({ ...entry, recipient: "other@example.com" }, "raw", new AbortController().signal)).rejects.toThrow("BRIEF_DELIVERY_ACCOUNT_MISMATCH"); expect(f.calls).toHaveLength(0);
  });
});
