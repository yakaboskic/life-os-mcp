import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { ToolInputError } from "../../../core/errors.js";
import type { GmailManagerLike } from "../client.js";
import { accountArg } from "./common.js";

const BATCH_MODIFY_LIMIT = 1000;

export function labelTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_list_labels",
      title: "List Gmail labels",
      description:
        "Lists all labels in an account: system labels (INBOX, UNREAD, STARRED, IMPORTANT, SPAM, TRASH, SENT, DRAFT, " +
        "CATEGORY_*) and user labels. Use these with gmail_modify_messages and label: search queries.",
      inputSchema: { account: accountArg() },
      annotations: { readOnlyHint: true },
      handler: async (args) =>
        gm().withClient(
          args.account,
          async (gmail) => {
            const res = await gmail.users.labels.list({ userId: "me" });
            const labels = (res.data.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type }));
            return ok({ labels });
          },
          { readOnly: true },
        ),
    }),
    defineTool({
      name: "gmail_create_label",
      title: "Create a Gmail label",
      description:
        'Creates a user label. Nest with "/" (e.g. "AI/Triaged"). Fails if the label already exists.',
      inputSchema: {
        account: accountArg(),
        name: z.string().min(1).describe('Label name, e.g. "Receipts" or "AI/Triaged".'),
      },
      annotations: { idempotentHint: false },
      handler: async (args) =>
        gm().withClient(args.account, async (gmail, email) => {
          const res = await gmail.users.labels.create({
            userId: "me",
            requestBody: { name: args.name, labelListVisibility: "labelShow", messageListVisibility: "show" },
          });
          gm().invalidateLabels(email);
          return ok({ id: res.data.id, name: res.data.name });
        }),
    }),
    defineTool({
      name: "gmail_modify_messages",
      title: "Add/remove labels on messages (archive, mark read, star…)",
      description:
        "Batch add/remove labels on up to thousands of messages. This is the triage workhorse — common recipes: " +
        "archive = removeLabels [\"INBOX\"]; mark read = removeLabels [\"UNREAD\"]; mark unread = addLabels [\"UNREAD\"]; " +
        "star = addLabels [\"STARRED\"]; file under a label = addLabels [\"MyLabel\"]. " +
        "Labels may be given as names or ids; at least one of addLabels/removeLabels is required.",
      inputSchema: {
        account: accountArg(),
        messageIds: z.array(z.string()).min(1).describe("Message ids from gmail_search_messages (same account)."),
        addLabels: z.array(z.string()).optional().describe("Label names or ids to add."),
        removeLabels: z.array(z.string()).optional().describe("Label names or ids to remove."),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
      handler: async (args) => {
        const add = args.addLabels ?? [];
        const remove = args.removeLabels ?? [];
        if (add.length === 0 && remove.length === 0) {
          throw new ToolInputError("Provide at least one of addLabels or removeLabels.");
        }
        return gm().withClient(args.account, async (gmail, email) => {
          const addLabelIds = add.length > 0 ? await gm().resolveLabelIds(gmail, email, add) : undefined;
          const removeLabelIds = remove.length > 0 ? await gm().resolveLabelIds(gmail, email, remove) : undefined;
          let modified = 0;
          for (let i = 0; i < args.messageIds.length; i += BATCH_MODIFY_LIMIT) {
            const ids = args.messageIds.slice(i, i + BATCH_MODIFY_LIMIT);
            await gmail.users.messages.batchModify({
              userId: "me",
              requestBody: { ids, addLabelIds, removeLabelIds },
            });
            modified += ids.length;
          }
          return ok({ modified, addedLabelIds: addLabelIds ?? [], removedLabelIds: removeLabelIds ?? [] });
        });
      },
    }),
  ];
}
