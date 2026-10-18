import { createHash } from "node:crypto";
import { createMimeMessage } from "mimetext";
import type { GmailManagerLike } from "../toolsets/gmail/client.js";
import { getHeader, parseMessage } from "../toolsets/gmail/mime.js";
import type { BriefDelivery, BriefDeliveryGateway, BriefingArtifact } from "./types.js";

const address = (value: string) => (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase();
const plain = (value: string) => value.replace(/\r\n/g, "\n").trim();
export class GmailBriefDelivery implements BriefDeliveryGateway {
  constructor(private readonly manager: GmailManagerLike, private readonly account: string, private readonly recipient: string) {}
  prepare(artifact: BriefingArtifact, account: string, recipient: string, messageId: string): string {
    const msg = createMimeMessage(); msg.setSender({ addr: account }); msg.setTo([recipient]); msg.setSubject(`LifeOS daily brief — ${artifact.day}`);
    msg.setHeader("Message-ID", messageId); msg.setHeader("Date", new Date(artifact.createdAt).toUTCString());
    msg.setHeader("Auto-Submitted", "auto-generated"); msg.setHeader("X-LifeOS-Brief-ID", artifact.id);
    msg.addMessage({ contentType: "text/plain", data: artifact.markdown, charset: "UTF-8" });
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
    return this.manager.withClient(delivery.account, async gmail => {
      const list = await gmail.users.messages.list({ userId: "me", q: `in:sent rfc822msgid:${delivery.messageId.replace(/[<>]/g, "")}`, maxResults: 10 }, { signal, timeout: 30_000 });
      if (list.data.nextPageToken || (list.data.messages?.length ?? 0) > 1) throw new Error("BRIEF_MULTIPLE_SENT_MATCHES");
      if (!list.data.messages?.length) return null;
      const id = list.data.messages[0]!.id!;
      const result = await gmail.users.messages.get({ userId: "me", id, format: "full" }, { signal, timeout: 30_000 });
      const headers = result.data.payload?.headers; const parsed = parseMessage(result.data, { includeBody: true, maxBodyChars: 40_000 });
      // Compare the exact fixed envelope and generated content; Gmail adds transport headers to the raw MIME.
      if (getHeader(headers, "Message-ID") !== delivery.messageId || address(parsed.from ?? "") !== delivery.account || address(parsed.to ?? "") !== delivery.recipient || parsed.subject !== `LifeOS daily brief — ${delivery.day}` || parsed.bodyTruncated || !result.data.labelIds?.includes("SENT") || createHash("sha256").update(plain(parsed.body ?? "")).digest("hex") !== delivery.contentHash) throw new Error("BRIEF_SENT_IDENTITY_MISMATCH");
      return { id, threadId: result.data.threadId ?? undefined };
    }, { readOnly: true });
  }
}
