import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { GmailBriefDelivery } from "../../src/automation/delivery.js";
import type { BriefingArtifact, BriefDelivery } from "../../src/automation/types.js";
import type { GmailManagerLike } from "../../src/toolsets/gmail/client.js";
const owner = "owner@example.com";
const artifact: BriefingArtifact = { id: "brief-1", day: "2026-10-18", createdAt: "2026-10-18T12:00:00Z", model: "test", markdown: "## 2026-10-18 — Daily brief\n\nReview the proposal.", sourceIds: [], sourceRunIds: [], coverage: [] };
const entry: BriefDelivery = { id: "delivery-1", day: artifact.day, artifactId: artifact.id, account: owner, recipient: owner, messageId: "<lifeos-test@life-os.local>", contentHash: createHash("sha256").update(artifact.markdown).digest("hex"), state: "pending", createdAt: artifact.createdAt };
function fake(overrides: Record<string, unknown> = {}) {
  const body = { id: "sent1", threadId: "thread1", labelIds: ["SENT"], payload: { mimeType: "text/plain", headers: [{ name: "From", value: owner }, { name: "To", value: owner }, { name: "Message-ID", value: entry.messageId }, { name: "Subject", value: `LifeOS daily brief — ${artifact.day}` }], body: { data: Buffer.from(artifact.markdown).toString("base64url") } }, ...overrides };
  const calls: any[] = [];
  const gmail = { users: { getProfile: async () => ({ data: { emailAddress: owner } }), messages: { send: async (arg: any, options: any) => { calls.push({ arg, options }); return { data: { id: "sent1", threadId: "thread1" } }; }, list: async (arg: any) => { calls.push(arg); return { data: { messages: [{ id: "sent1" }] } }; }, get: async () => ({ data: body }) } } };
  const manager = { withClient: async (_account: string, fn: any) => fn(gmail, owner) } as GmailManagerLike;
  return { gateway: new GmailBriefDelivery(manager, owner, owner), calls };
}
describe("fixed recipient brief delivery", () => {
  it("composes deterministic identity and sends with transport retries disabled", async () => {
    const f = fake(), raw = f.gateway.prepare(artifact, owner, owner, entry.messageId), mime = Buffer.from(raw, "base64url").toString();
    expect(mime).toContain(`Message-ID: ${entry.messageId}`); expect(mime).toContain("Auto-Submitted: auto-generated");
    await f.gateway.send(entry, raw, new AbortController().signal); expect(f.calls[0].options.retry).toBe(false);
  });
  it("finds exact Sent identity and rejects same RFC identity with altered body", async () => {
    const f = fake(), raw = f.gateway.prepare(artifact, owner, owner, entry.messageId); expect(await f.gateway.reconcile(entry, raw, new AbortController().signal)).toEqual({ id: "sent1", threadId: "thread1" }); expect(f.calls[0].q).toContain("rfc822msgid:lifeos-test@life-os.local");
    const changed = fake({ payload: { headers: [], body: {} } }); await expect(changed.gateway.reconcile(entry, raw, new AbortController().signal)).rejects.toThrow("BRIEF_SENT_IDENTITY_MISMATCH");
  });
  it("rejects arbitrary recipients even if a caller changes an outbox object", async () => {
    const f = fake(); await expect(f.gateway.send({ ...entry, recipient: "other@example.com" }, "raw", new AbortController().signal)).rejects.toThrow("BRIEF_DELIVERY_ACCOUNT_MISMATCH"); expect(f.calls).toHaveLength(0);
  });
});
