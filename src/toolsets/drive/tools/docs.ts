import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { ToolInputError } from "../../../core/errors.js";
import type { ToolsetContext } from "../../../core/toolset.js";
import type { DriveManagerLike } from "../client.js";
import { FolderRegistry, parseDocId, resolveDriveAccount } from "../docref.js";
import { PreviewStore } from "../previews.js";
import { applyDocPreview, buildReplacePreview, createDoc, exportDoc, findByName, getDocMeta } from "../docs.js";
import { countLines, normalizeMarkdown } from "../textdiff.js";

const READ_CHAR_CAP = 60_000;

/**
 * Google Docs tools. Reads and writes go through Markdown, so the agent sees
 * the same representation it edits and the preview diff is a plain line diff.
 *
 * Creating is a single call (nothing can be lost); EDITING an existing document
 * is preview→apply, because a body replace is the most destructive operation in
 * this server — one bad call silently discards a document.
 */
export function docTools(gm: () => DriveManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "drive_doc_read",
      title: "Read a Google Doc (read-only)",
      description:
        "Reads a Google Doc as Markdown (headings, bullets and tables preserved). Accepts a document id or a docs.google.com URL.",
      inputSchema: {
        doc: z.string().describe("Google Doc id or a docs.google.com URL."),
        account: z.string().optional().describe("Google account. Defaults to the only Drive-authorized account."),
        format: z.enum(["markdown", "text"]).optional().describe("markdown (default) or plain text."),
        maxChars: z.number().int().min(500).max(200_000).optional().describe(`Truncate the body (default ${READ_CHAR_CAP}).`),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx: ToolsetContext) => {
        const documentId = parseDocId(args.doc);
        const account = resolveDriveAccount(gm().store, args.account);
        return gm().withDocsPair(account, async (drive) => {
          const meta = await getDocMeta(drive, documentId);
          const { content, format } = await exportDoc(drive, documentId, args.format ?? "markdown");
          const cap = args.maxChars ?? READ_CHAR_CAP;
          const truncated = content.length > cap;
          return ok({
            documentId: meta.documentId,
            title: meta.title,
            webViewLink: meta.webViewLink,
            parents: meta.parents,
            modifiedTime: meta.modifiedTime,
            version: meta.version,
            format,
            chars: content.length,
            lines: countLines(content),
            ...(truncated ? { truncated: true, shownChars: cap } : {}),
            content: truncated ? content.slice(0, cap) : content,
          });
        });
      },
    }),

    defineTool({
      name: "drive_doc_create",
      title: "Create a Google Doc in a folder",
      description:
        "Creates a NEW Google Doc in a Drive folder, optionally with a Markdown body (# headings, - bullets, **bold**, | tables |). " +
        "It never modifies an existing document — use drive_doc_preview_replace for that. " +
        "Refuses a name already present in the folder unless allowDuplicateName is set.",
      inputSchema: {
        name: z.string().min(1).describe("Document title."),
        folder: z.string().describe("Registered folder alias, or a raw Drive folder id."),
        markdown: z.string().optional().describe("Initial body as Markdown. Omit for an empty document."),
        account: z.string().optional().describe("Google account. Defaults to the only Drive-authorized account."),
        allowDuplicateName: z.boolean().optional().describe("Allow a second document with a name already in the folder."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
      handler: async (args, ctx: ToolsetContext) => {
        const reg = new FolderRegistry(ctx.config);
        const resolved = reg.resolve(args.folder, args.account);
        const account = resolveDriveAccount(gm().store, resolved.account);
        return gm().withDocsPair(account, async (drive) => {
          if (!args.allowDuplicateName) {
            const clash = await findByName(drive, resolved.folderId, args.name);
            if (clash.length > 0) {
              throw new ToolInputError(
                `"${args.name}" already exists in that folder (${clash[0]!.id}). ` +
                  `Edit it with drive_doc_preview_replace, or pass allowDuplicateName:true to create a second one.`,
              );
            }
          }
          const created = await createDoc(drive, {
            name: args.name,
            folderId: resolved.folderId,
            markdown: args.markdown,
          });
          return ok({
            created: true,
            documentId: created.documentId,
            title: args.name,
            folder: resolved.alias ?? resolved.folderId,
            webViewLink: created.webViewLink,
            chars: args.markdown?.length ?? 0,
          });
        });
      },
    }),

    defineTool({
      name: "drive_doc_preview_replace",
      title: "Preview replacing a Google Doc's body",
      description:
        "Stages a full-body replace of an existing Google Doc from Markdown and returns a line diff. NOTHING is written — " +
        "call drive_doc_apply with the previewId only after the user has approved that exact diff. " +
        "A Markdown replace rewrites the WHOLE body: images, colors and custom styles are LOST and anchored comments are orphaned.",
      inputSchema: {
        doc: z.string().describe("Google Doc id or a docs.google.com URL."),
        markdown: z.string().describe("The COMPLETE new body as Markdown. This REPLACES the document — it is not an append."),
        account: z.string().optional().describe("Google account. Defaults to the only Drive-authorized account."),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
      handler: async (args, ctx: ToolsetContext) => {
        const documentId = parseDocId(args.doc);
        const account = resolveDriveAccount(gm().store, args.account);
        const previews = new PreviewStore(ctx.config);
        return gm().withDocsPair(account, async (drive, docs) => {
          const result = await buildReplacePreview({
            drive,
            docs,
            previews,
            account,
            documentId,
            markdown: args.markdown,
          });
          if (result.kind === "noop") {
            return ok({ nothingToChange: true, documentId: result.documentId, title: result.title, message: result.message });
          }
          return ok({
            previewId: result.preview.id,
            doc: {
              documentId: result.preview.documentId,
              title: result.preview.title,
              webViewLink: result.preview.webViewLink,
            },
            diff: result.diff,
            before: result.before,
            after: result.after,
            warnings: result.warnings,
            expires: "1 hour",
            note: "Nothing has been written. After the user approves this exact diff, call drive_doc_apply with previewId.",
          });
        });
      },
    }),

    defineTool({
      name: "drive_doc_apply",
      title: "Apply a pending Google Doc replace",
      description:
        "Applies ONE pending document preview after re-verifying the document has not changed since the preview. " +
        "Previews are single-use. Only call this after the user has approved the specific preview diff.",
      inputSchema: {
        previewId: z.string().describe("The previewId returned by drive_doc_preview_replace."),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: async (args, ctx: ToolsetContext) => {
        const previews = new PreviewStore(ctx.config);
        const pending = previews.loadPendingDoc(args.previewId);
        return gm().withDocsPair(pending.account, async (drive, docs) =>
          ok(await applyDocPreview(drive, docs, previews, args.previewId)),
        );
      },
    }),
  ];
}

/** Exported for the toolset instructions string. */
export function registeredFolderSummary(ctx: ToolsetContext): string {
  const folders = new FolderRegistry(ctx.config).all();
  const names = Object.entries(folders).map(([alias, f]) => (f.note ? `${alias} (${f.note})` : alias));
  return names.length > 0 ? names.join(", ") : "none registered yet";
}

export { normalizeMarkdown };
