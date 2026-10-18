import { z } from "zod";
import type { gmail_v1 } from "googleapis";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { ToolInputError } from "../../../core/errors.js";
import { buildReferences, composeEmail, getHeader, mapWithConcurrency, parseMessage, replySubject } from "../mime.js";
import type { GmailManagerLike } from "../client.js";
import { accountArg } from "./common.js";

const composeArgs = () => ({
  account: accountArg(),
  to: z.array(z.string()).optional().describe("Recipient email addresses. Required unless replying (then defaults to the original sender)."),
  cc: z.array(z.string()).optional().describe("Cc addresses."),
  bcc: z.array(z.string()).optional().describe("Bcc addresses."),
  subject: z.string().optional().describe('Subject. Required unless replying (then defaults to "Re: <original>").'),
  body: z
    .string()
    .describe("Plain-text body. Note: Gmail does NOT auto-append the account's signature — include any sign-off yourself."),
  replyToMessageId: z
    .string()
    .optional()
    .describe(
      "To reply in-thread, pass the id of the message being replied to (same account). " +
        "Sets In-Reply-To/References and threads correctly in all mail clients.",
    ),
});

interface OutgoingArgs {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  replyToMessageId?: string;
}

/** Builds the base64url raw message (+ threadId when replying). */
async function buildOutgoing(
  gmail: gmail_v1.Gmail,
  fromEmail: string,
  args: OutgoingArgs,
): Promise<{ raw: string; threadId?: string }> {
  if (args.replyToMessageId) {
    const orig = await gmail.users.messages.get({
      userId: "me",
      id: args.replyToMessageId,
      format: "metadata",
      metadataHeaders: ["Message-ID", "References", "Subject", "From", "Reply-To", "To", "Cc"],
    });
    const headers = orig.data.payload?.headers;
    const origMessageId = getHeader(headers, "Message-ID");
    const to =
      args.to && args.to.length > 0
        ? args.to
        : [getHeader(headers, "Reply-To") ?? getHeader(headers, "From")].filter((v): v is string => Boolean(v));
    if (to.length === 0) {
      throw new ToolInputError("Could not determine a recipient from the original message; pass `to` explicitly.");
    }
    const raw = composeEmail({
      from: fromEmail,
      to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject ?? replySubject(getHeader(headers, "Subject")),
      textBody: args.body,
      inReplyTo: origMessageId,
      references: buildReferences(getHeader(headers, "References"), origMessageId),
    });
    return { raw, threadId: orig.data.threadId ?? undefined };
  }

  if (!args.to || args.to.length === 0) {
    throw new ToolInputError("`to` is required when not replying (no replyToMessageId given).");
  }
  if (args.subject === undefined) {
    throw new ToolInputError("`subject` is required when not replying (no replyToMessageId given).");
  }
  const raw = composeEmail({
    from: fromEmail,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    textBody: args.body,
  });
  return { raw };
}

export function composeTools(gm: () => GmailManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "gmail_create_draft",
      title: "Create a Gmail draft",
      description:
        "Creates a draft (new message, or an in-thread reply via replyToMessageId) WITHOUT sending it. " +
        "The user can review it in Gmail, or it can be sent later with gmail_send_draft. " +
        "Prefer drafting over sending when the user hasn't explicitly asked to send.",
      inputSchema: composeArgs(),
      annotations: { destructiveHint: false, idempotentHint: false },
      handler: async (args) =>
        gm().withClient(args.account, async (gmail, email) => {
          const { raw, threadId } = await buildOutgoing(gmail, email, args);
          const res = await gmail.users.drafts.create({
            userId: "me",
            requestBody: { message: { raw, threadId } },
          });
          return ok({
            draftId: res.data.id,
            messageId: res.data.message?.id,
            threadId: res.data.message?.threadId ?? threadId,
          });
        }),
    }),
    defineTool({
      name: "gmail_list_drafts",
      title: "List Gmail drafts",
      description:
        "Lists drafts with their draftId (needed by gmail_send_draft — note that searching `in:draft` returns " +
        "message ids, NOT draft ids, so use this tool to find a draft to send).",
      inputSchema: {
        account: accountArg(),
        maxResults: z.number().int().min(1).max(100).optional().describe("Max drafts to return (default 20)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args) =>
        gm().withClient(
          args.account,
          async (gmail) => {
            const list = await gmail.users.drafts.list({ userId: "me", maxResults: args.maxResults ?? 20 });
            const drafts = list.data.drafts ?? [];
            const hydrated = await mapWithConcurrency(drafts, 5, async (d) => {
              const msgId = d.message?.id;
              if (!msgId) return { draftId: d.id };
              const res = await gmail.users.messages.get({
                userId: "me",
                id: msgId,
                format: "metadata",
                metadataHeaders: ["To", "Cc", "Subject", "Date"],
              });
              const meta = parseMessage(res.data);
              return {
                draftId: d.id,
                messageId: msgId,
                threadId: meta.threadId,
                to: meta.to,
                cc: meta.cc,
                subject: meta.subject,
                date: meta.date,
                snippet: meta.snippet,
              };
            });
            return ok({ drafts: hydrated });
          },
          { readOnly: true },
        ),
    }),
    defineTool({
      name: "gmail_send_message",
      title: "Send a Gmail message",
      description:
        "Composes and SENDS an email immediately (new message, or an in-thread reply via replyToMessageId). " +
        "This is irreversible and goes out under the user's name — only use it when the user has clearly asked to send. " +
        "When unsure, use gmail_create_draft instead. Never retry a send that returned an error you can't interpret; " +
        "check with gmail_search_messages (in:sent) first to avoid duplicates.",
      inputSchema: composeArgs(),
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      handler: async (args) =>
        gm().withClient(args.account, async (gmail, email) => {
          const { raw, threadId } = await buildOutgoing(gmail, email, args);
          const res = await gmail.users.messages.send({
            userId: "me",
            requestBody: { raw, threadId },
          });
          return ok({ sent: true, id: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds });
        }),
    }),
    defineTool({
      name: "gmail_send_draft",
      title: "Send an existing Gmail draft",
      description:
        "Sends a draft previously created with gmail_create_draft (or found via gmail_list_drafts). Irreversible — " +
        "only use when the user has clearly asked to send.",
      inputSchema: {
        account: accountArg(),
        draftId: z.string().describe("Draft id from gmail_create_draft or gmail_list_drafts (NOT a message id)."),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      handler: async (args) =>
        gm().withClient(args.account, async (gmail) => {
          const res = await gmail.users.drafts.send({ userId: "me", requestBody: { id: args.draftId } });
          return ok({ sent: true, id: res.data.id, threadId: res.data.threadId, labelIds: res.data.labelIds });
        }),
    }),
  ];
}
