import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import type { GmailManagerLike } from "../client.js";
import { accountArg } from "./common.js";

export function trashTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_trash_message",
      title: "Move a message to Trash",
      description:
        "Moves one message to Trash (Gmail auto-deletes trashed mail after ~30 days; the user can restore it until then). " +
        "Permanent deletion is intentionally not available — the server's OAuth scope does not allow it. " +
        "For routine triage prefer archiving via gmail_modify_messages (removeLabels [\"INBOX\"]).",
      inputSchema: {
        account: accountArg(),
        messageId: z.string().describe("Message id from gmail_search_messages (same account)."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) =>
        gm().withClient(args.account, async (gmail) => {
          const res = await gmail.users.messages.trash({ userId: "me", id: args.messageId });
          return ok({ trashed: res.data.id, threadId: res.data.threadId, note: "Recoverable from Trash for ~30 days." });
        }),
    }),
  ];
}
