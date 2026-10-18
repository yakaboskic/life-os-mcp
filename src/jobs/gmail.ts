import type { LifeOsConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import { GmailAccountManager, type GmailManagerLike } from "../toolsets/gmail/client.js";
import { getHeader, parseMessage } from "../toolsets/gmail/mime.js";
import { CATEGORIES, type MailGateway, type MailThread, type MutationPlan } from "./types.js";

export class GmailJobGateway implements MailGateway {
  private readonly manager: GmailManagerLike;
  constructor(private readonly config: LifeOsConfig, logger: Logger, manager?: GmailManagerLike) {
    this.manager = manager ?? new GmailAccountManager({ config, logger });
  }
  accounts(): string[] {
    const configured = this.config.env.LIFE_OS_GMAIL_ACCOUNTS?.split(",").map((item) => item.trim()).filter(Boolean);
    if (configured?.length) return [...new Set(configured.map((account) => this.manager.store.resolveAccount(account)))];
    return this.manager.store.listTokenFiles().filter((token) => token.scopes?.includes("https://www.googleapis.com/auth/gmail.modify")).map((token) => token.account.toLowerCase());
  }
  async verify(account: string, signal: AbortSignal): Promise<void> {
    await this.manager.withClient(account, async (gmail, email) => {
      const result = await gmail.users.getProfile({ userId: "me" }, { signal, timeout: 30_000 });
      if (result.data.emailAddress?.toLowerCase() !== email.toLowerCase()) throw new Error("GMAIL_ACCOUNT_MISMATCH");
    }, { readOnly: true });
  }
  async labels(account: string, create: boolean, signal: AbortSignal): Promise<Record<string, string>> {
    return this.manager.withClient(account, async (gmail, email) => {
      const list = async () => (await gmail.users.labels.list({ userId: "me" }, { signal, timeout: 30_000 })).data.labels ?? [];
      let labels = await list();
      const result: Record<string, string> = Object.fromEntries(labels.filter((label) => label.id && label.name).map((label) => [label.name!, label.id!]));
      if (!create) return result;
      for (const name of [...CATEGORIES, "ACTION/DONE"]) {
        if (result[name]) continue;
        signal.throwIfAborted();
        try {
          const added = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } }, { signal, timeout: 30_000 });
          if (!added.data.id) throw new Error("GMAIL_LABEL_ID_MISSING");
          result[name] = added.data.id;
        } catch (error) {
          // A concurrent interactive label creation or a lost response may already have created it.
          labels = await list();
          const found = labels.find((label) => label.name === name && label.id);
          if (!found) throw error;
          result[name] = found.id!;
        }
      }
      this.manager.invalidateLabels(email);
      return result;
    });
  }
  async listThreads(account: string, query: string, signal: AbortSignal): Promise<string[]> {
    return this.manager.withClient(account, async (gmail) => {
      const ids = new Set<string>();
      const pages = new Set<string>();
      let pageToken: string | undefined;
      do {
        signal.throwIfAborted();
        const response = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 500, pageToken }, { signal, timeout: 30_000 });
        for (const message of response.data.messages ?? []) if (message.threadId) ids.add(message.threadId);
        pageToken = response.data.nextPageToken ?? undefined;
        if (pageToken && pages.has(pageToken)) throw new Error("GMAIL_PAGINATION_LOOP");
        if (pageToken) pages.add(pageToken);
      } while (pageToken);
      return [...ids];
    }, { readOnly: true });
  }
  async thread(account: string, id: string, signal: AbortSignal): Promise<MailThread> {
    return this.manager.withClient(account, async (gmail) => {
      const result = await gmail.users.threads.get({ userId: "me", id, format: "full" }, { signal, timeout: 30_000 });
      return { id, messages: (result.data.messages ?? []).map((message) => {
        const parsed = parseMessage(message, { includeBody: true, maxBodyChars: 12_000 });
        if (!message.id || !message.internalDate || !Number.isFinite(Number(message.internalDate))) throw new Error("GMAIL_INVALID_MESSAGE");
        return { id: message.id, internalDate: Number(message.internalDate), labels: [...(message.labelIds ?? [])].sort(), from: parsed.from ?? "", to: parsed.to ?? "", subject: parsed.subject ?? "", body: parsed.body ?? "", truncated: !!parsed.bodyTruncated, attachments: !!parsed.attachments?.length, rfcMessageId: getHeader(message.payload?.headers, "Message-ID") };
      }).sort((a, b) => a.internalDate - b.internalDate || a.id.localeCompare(b.id)) };
    }, { readOnly: true });
  }
  async modify(account: string, plan: MutationPlan, signal: AbortSignal): Promise<void> {
    // Never thread.modify: a new message arriving during the write must remain in the inbox.
    if (plan.ids.length === 0 || plan.ids.length > 1000) throw new Error("GMAIL_UNSAFE_BATCH_SIZE");
    await this.manager.withClient(account, async (gmail) => {
      await gmail.users.messages.batchModify({ userId: "me", requestBody: { ids: plan.ids, addLabelIds: plan.add, removeLabelIds: plan.remove } }, { signal, timeout: 30_000 });
    });
  }
}
