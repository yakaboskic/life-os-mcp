import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { mapWithConcurrency, parseMessage } from "../mime.js";
import type { GmailManagerLike } from "../client.js";
import { accountArg } from "./common.js";

const METADATA_HEADERS = ["From", "To", "Cc", "Subject", "Date"];

export function searchTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_search_messages",
      title: "Search Gmail messages",
      description:
        "Searches one account with raw Gmail query syntax and returns message metadata + snippets (never full bodies — " +
        "use gmail_get_message for those). Useful operators: `is:unread`, `in:inbox`, `from:alice@x.com`, `to:me`, " +
        "`subject:invoice`, `label:Work`, `has:attachment`, `newer_than:2d` (prefer over absolute dates), " +
        "`older_than:1m`, `is:starred`, `in:anywhere`. Combine freely, e.g. `in:inbox is:unread newer_than:7d`. " +
        "Returned ids are account-specific.",
      inputSchema: {
        account: accountArg(),
        query: z.string().describe("Gmail search query (raw Gmail syntax, passed through verbatim)."),
        maxResults: z.number().int().min(1).max(100).optional().describe("Max messages to return (default 25, cap 100)."),
        pageToken: z.string().optional().describe("Page token from a previous result to fetch the next page."),
        includeSpamTrash: z.boolean().optional().describe("Also search SPAM and TRASH (default false)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args) =>
        gm().withClient(
          args.account,
          async (gmail) => {
            const list = await gmail.users.messages.list({
              userId: "me",
              q: args.query,
              maxResults: args.maxResults ?? 25,
              pageToken: args.pageToken,
              includeSpamTrash: args.includeSpamTrash ?? false,
            });
            const refs = list.data.messages ?? [];
            const messages = await mapWithConcurrency(refs, 10, async (ref) => {
              const res = await gmail.users.messages.get({
                userId: "me",
                id: ref.id!,
                format: "metadata",
                metadataHeaders: METADATA_HEADERS,
              });
              return parseMessage(res.data);
            });
            return ok({
              messages,
              nextPageToken: list.data.nextPageToken ?? undefined,
              resultSizeEstimate: list.data.resultSizeEstimate ?? undefined,
            });
          },
          { readOnly: true },
        ),
    }),
  ];
}
