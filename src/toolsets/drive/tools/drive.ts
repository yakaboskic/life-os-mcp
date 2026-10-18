import { z } from "zod";
import { defineTool, type ToolDefinition } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { ToolInputError } from "../../../core/errors.js";
import type { ToolsetContext } from "../../../core/toolset.js";
import type { DriveManagerLike } from "../client.js";
import { FOLDER_MIME, FolderRegistry } from "../docref.js";

const FILE_FIELDS = "id,name,mimeType,modifiedTime,owners(emailAddress),webViewLink,parents";

/**
 * Drive lookups (metadata + folder listing) and the named-folder registry.
 * Drive itself is only read here — the one Drive write in the server is
 * document creation/replacement in tools/docs.ts, which is gated by the same
 * preview→apply protocol as sheets.
 */
export function driveTools(gm: () => DriveManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "drive_register_folder",
      title: "Register a Drive folder under a short alias",
      description:
        "Validates a Drive folder and stores it under a short alias so drive_doc_create and drive_list_folder can use the name instead of the id.",
      inputSchema: {
        alias: z.string().describe('Short name, e.g. "mcp-gateway".'),
        folderId: z.string().describe("Drive folder id."),
        account: z.string().describe("Google account (email or alias) with drive authorization."),
        note: z.string().optional().describe("What this folder is for."),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
      handler: async (args, ctx: ToolsetContext) =>
        gm().withDrive(
          args.account,
          async (drive, email) => {
            const res = await drive.files.get({
              fileId: args.folderId,
              fields: "id,name,mimeType",
              supportsAllDrives: true,
            });
            if (res.data.mimeType !== FOLDER_MIME) {
              throw new ToolInputError(`"${res.data.name ?? args.folderId}" is a ${res.data.mimeType}, not a folder.`);
            }
            const children = await drive.files.list({
              q: `'${args.folderId.replace(/'/g, "\\'")}' in parents and trashed=false`,
              fields: "files(id)",
              pageSize: 100,
              includeItemsFromAllDrives: true,
              supportsAllDrives: true,
            });
            new FolderRegistry(ctx.config).register(args.alias, {
              folderId: args.folderId,
              account: email,
              ...(args.note ? { note: args.note } : {}),
            });
            return ok({
              registered: args.alias,
              folderId: args.folderId,
              name: res.data.name,
              account: email,
              children: (children.data.files ?? []).length,
            });
          },
          { readOnly: true },
        ),
    }),
    defineTool({
      name: "drive_get_file",
      title: "Get Drive file/folder metadata (read-only)",
      description: "Reads one Drive item's metadata by id: name, type, modified time, owner, link, parents.",
      inputSchema: {
        fileId: z.string().describe("Drive file or folder id."),
        account: z.string().describe("Google account (email or alias) with sheets authorization."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, _ctx) =>
        gm().withDrive(
          args.account,
          async (drive) => {
            const res = await drive.files.get({ fileId: args.fileId, fields: FILE_FIELDS, supportsAllDrives: true });
            return ok(res.data);
          },
          { readOnly: true },
        ),
    }),
    defineTool({
      name: "drive_list_folder",
      title: "List a Drive folder (read-only)",
      description: "Lists the direct children of a Drive folder (name, type, modified time, link).",
      inputSchema: {
        folderId: z.string().describe("Drive folder id, or a registered folder alias."),
        account: z.string().describe("Google account (email or alias) with sheets authorization."),
        pageToken: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, _ctx) =>
        gm().withDrive(
          args.account,
          async (drive) => {
            const res = await drive.files.list({
              q: `'${args.folderId.replace(/'/g, "\\'")}' in parents and trashed=false`,
              fields: `nextPageToken, files(${FILE_FIELDS})`,
              pageSize: 50,
              pageToken: args.pageToken,
              includeItemsFromAllDrives: true,
              supportsAllDrives: true,
            });
            return ok({ files: res.data.files ?? [], nextPageToken: res.data.nextPageToken ?? undefined });
          },
          { readOnly: true },
        ),
    }),
  ];
}
