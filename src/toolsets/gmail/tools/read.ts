import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { parseMessage } from "../mime.js";
import type { GmailManagerLike } from "../client.js";
import { accountArg } from "./common.js";

export function readTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_get_message",
      title: "Read a Gmail message",
      description:
        "Fetches one message with its decoded plain-text body (HTML is converted to text) and attachment metadata. " +
        "Long bodies are truncated with an explicit marker — re-call with a larger maxBodyChars if you need more.",
      inputSchema: {
        account: accountArg(),
        messageId: z.string().describe("Message id from gmail_search_messages (same account)."),
        maxBodyChars: z.number().int().min(200).max(100000).optional().describe("Body character cap (default 5000)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args) =>
        gm().withClient(
          args.account,
          async (gmail) => {
            const res = await gmail.users.messages.get({ userId: "me", id: args.messageId, format: "full" });
            return ok(parseMessage(res.data, { includeBody: true, maxBodyChars: args.maxBodyChars ?? 5000 }));
          },
          { readOnly: true },
        ),
    }),
    defineTool({
      name: "gmail_get_thread",
      title: "Read a Gmail thread",
      description:
        "Fetches a full conversation thread. All messages return headers + snippet; only the most recent " +
        "maxFullMessages also include decoded bodies (keeps output small on long threads).",
      inputSchema: {
        account: accountArg(),
        threadId: z.string().describe("Thread id from gmail_search_messages or gmail_get_message (same account)."),
        maxFullMessages: z
          .number()
          .int()
          .min(1)
          .max(50)
          .optional()
          .describe("How many of the newest messages include bodies (default 5)."),
        maxBodyChars: z
          .number()
          .int()
          .min(200)
          .max(100000)
          .optional()
          .describe("Body character cap per message (default 2000)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args) =>
        gm().withClient(
          args.account,
          async (gmail) => {
            const res = await gmail.users.threads.get({ userId: "me", id: args.threadId, format: "full" });
            const msgs = res.data.messages ?? [];
            const fullCount = args.maxFullMessages ?? 5;
            const cutoff = Math.max(0, msgs.length - fullCount);
            const messages = msgs.map((m, i) =>
              parseMessage(m, {
                includeBody: i >= cutoff,
                maxBodyChars: args.maxBodyChars ?? 2000,
              }),
            );
            return ok({ threadId: res.data.id, messageCount: msgs.length, messages });
          },
          { readOnly: true },
        ),
    }),
  ];
}
