import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { GmailBriefDelivery } from "../../src/automation/delivery.js";
import type { BriefingArtifact, BriefDelivery } from "../../src/automation/types.js";
import type { GmailManagerLike } from "../../src/toolsets/gmail/client.js";
const owner = "owner@example.com";
const artifact: BriefingArtifact = { id: "brief-1", day: "2026-10-18", createdAt: "2026-10-18T12:00:00Z", model: "test", markdown: "## 2026-10-18 — Daily brief\n\nReview the proposal.", sourceIds: [], sourceRunIds: [], coverage: [] };
const entry: BriefDelivery = { id: "delivery-1", day: artifact.day, artifactId: artifact.id, account: owner, recipient: owner, messageId: "<lifeos-test@life-os.local>", contentHash: createHash("sha256").update(artifact.markdown).digest("hex"), state: "pending", createdAt: artifact.createdAt };
interface FakeOptions { rewrittenId?: boolean; artifactId?: string; to?: string; from?: string; body?: string; duplicate?: boolean; pagination?: boolean; subject?: string; timestamp?: number; noSent?: boolean; duplicateHeader?: boolean; cc?: string; wrongMetadataId?: boolean; mixedCopies?: boolean; extraPart?: boolean; attachment?: boolean; sizeEstimate?: number }
function fake(options: FakeOptions = {}) {
  const headers = [{ name: "From", value: options.from ?? owner }, { name: "To", value: options.to ?? owner }, { name: "Message-ID", value: options.rewrittenId ? "<server-replaced@mail.gmail.com>" : entry.messageId }, { name: "Subject", value: options.subject ?? `LifeOS daily brief — ${artifact.day}` }, { name: "X-LifeOS-Brief-ID", value: options.artifactId ?? artifact.id }];
  if (options.duplicateHeader) headers.push({ name: "X-LifeOS-Brief-ID", value: "forged-extra" });
  if (options.cc) headers.push({ name: "Cc", value: options.cc });
  const body = { id: "sent1", threadId: "thread1", sizeEstimate: options.sizeEstimate ?? 2000, internalDate: String(options.timestamp ?? Date.parse(artifact.createdAt)), labelIds: options.noSent ? ["INBOX"] : ["SENT"], payload: { mimeType: "text/plain", headers, ...(options.extraPart ? { parts: [{ mimeType: "text/html", body: { data: "Zm9yZ2Vk" } }] } : {}), body: { data: Buffer.from(options.body ?? artifact.markdown).toString("base64url"), size: Buffer.byteLength(options.body ?? artifact.markdown), ...(options.attachment ? { attachmentId: "unfetched-attachment" } : {}) } } };
  const calls: any[] = [];
  const gmail = { users: { getProfile: async () => ({ data: { emailAddress: owner } }), messages: {
    send: async (arg: any, requestOptions: any) => { calls.push({ arg, options: requestOptions }); return { data: { id: "sent1", threadId: "thread1" } }; },
    list: async (arg: any, requestOptions: any) => { calls.push({ kind: "list", ...arg, options: requestOptions }); const missing = options.rewrittenId && arg.q.includes("rfc822msgid:"); return { data: { messages: options.mixedCopies && !arg.q.includes("rfc822msgid:") ? [{ id: "sent2" }] : missing ? [] : [{ id: "sent1" }, ...(options.duplicate ? [{ id: "sent2" }] : [])], ...(!missing && options.pagination ? { nextPageToken: "more" } : {}) } }; },
    get: async (arg: any, requestOptions: any) => { calls.push({ kind: "get", ...arg, options: requestOptions }); return { data: { ...body, id: options.wrongMetadataId && arg.format === "metadata" ? "wrong-message-id" : arg.id, ...(arg.format === "metadata" ? { payload: { headers } } : {}) } }; },
  } } };
  const manager = { withClient: async (_account: string, fn: any) => fn(gmail, owner) } as GmailManagerLike;
  return { gateway: new GmailBriefDelivery(manager, owner, owner), calls };
}
const reconcile = (f: ReturnType<typeof fake>) => f.gateway.reconcile(entry, f.gateway.prepare(artifact, owner, owner, entry.messageId), new AbortController().signal);
describe("fixed recipient brief delivery", () => {
  it("composes deterministic identity and sends with transport retries disabled", async () => {
    const f = fake(), raw = f.gateway.prepare(artifact, owner, owner, entry.messageId), mime = Buffer.from(raw, "base64url").toString();
    expect(mime).toContain(`Message-ID: ${entry.messageId}`); expect(mime).toContain("Auto-Submitted: auto-generated");
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
  it("rejects arbitrary recipients even if a caller changes an outbox object", async () => {
    const f = fake(); await expect(f.gateway.send({ ...entry, recipient: "other@example.com" }, "raw", new AbortController().signal)).rejects.toThrow("BRIEF_DELIVERY_ACCOUNT_MISMATCH"); expect(f.calls).toHaveLength(0);
  });
});
