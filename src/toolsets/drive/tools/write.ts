import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { SheetRegistry } from "../sheetreg.js";
import { PreviewStore } from "../previews.js";
import { applyPreview, buildAppendPreview, buildUpdatePreview } from "../engine.js";
import type { DriveManagerLike } from "../client.js";

const sheetArg = () =>
  z.string().describe("Registered sheet alias or raw spreadsheet id (then `account` is required).");
const accountArg = () =>
  z.string().optional().describe("Google account (email or alias). Defaults to the registered sheet's account.");

export function writeTools(gm: () => DriveManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "drive_sheet_preview_update",
      title: "Preview a cell update (writes nothing)",
      description:
        "Stage the smallest possible update to EXACTLY ONE row: `match` (header: value pairs) must resolve to a single " +
        "row, `set` gives the new values by header name. Returns a previewId plus an exact current → proposed diff. " +
        "NOTHING is written; formula (generated) cells are refused; matching zero or multiple rows is refused. " +
        "Show the diff to the user, then call drive_sheet_apply with the previewId once they approve.",
      inputSchema: {
        sheet: sheetArg(),
        tab: z.string().describe("Tab name."),
        match: z.record(z.string()).describe("Header: value pairs that identify exactly one row."),
        set: z.record(z.string()).describe("Header: newValue pairs to write (values as strings; dates as YYYY-MM-DD)."),
        account: accountArg(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
      handler: async (args, ctx) => {
        const ref = new SheetRegistry(ctx.config).resolve(args.sheet, args.account);
        return gm().withSheets(ref.account, async (sheets, email) => {
          const result = await buildUpdatePreview({
            sheets,
            previews: new PreviewStore(ctx.config),
            account: email,
            spreadsheetId: ref.spreadsheetId,
            sheetAlias: ref.alias,
            tab: args.tab,
            match: args.match,
            set: args.set,
          });
          if (result.kind === "noop") return ok({ nothingToChange: true, message: result.message });
          return ok({
            previewId: result.preview.id,
            tab: result.preview.tab,
            diff: result.diff,
            expires: "1 hour",
            note: "Nothing has been written. After the user approves this exact diff, call drive_sheet_apply with previewId.",
          });
        });
      },
    }),
    defineTool({
      name: "drive_sheet_preview_append",
      title: "Preview a new row (writes nothing)",
      description:
        "Stage appending one row to the end of a tab's table, values keyed by header name (unsupplied columns stay " +
        "blank). Returns a previewId and the exact row that would be added. NOTHING is written until drive_sheet_apply.",
      inputSchema: {
        sheet: sheetArg(),
        tab: z.string().describe("Tab name."),
        values: z.record(z.string()).describe("Header: value pairs for the new row."),
        account: accountArg(),
      },
      annotations: { destructiveHint: false, idempotentHint: false },
      handler: async (args, ctx) => {
        const ref = new SheetRegistry(ctx.config).resolve(args.sheet, args.account);
        return gm().withSheets(ref.account, async (sheets, email) => {
          const { preview, row } = await buildAppendPreview({
            sheets,
            previews: new PreviewStore(ctx.config),
            account: email,
            spreadsheetId: ref.spreadsheetId,
            sheetAlias: ref.alias,
            tab: args.tab,
            values: args.values,
          });
          return ok({
            previewId: preview.id,
            tab: preview.tab,
            newRow: row,
            expires: "1 hour",
            note: "Nothing has been written. After the user approves, call drive_sheet_apply with previewId.",
          });
        });
      },
    }),
    defineTool({
      name: "drive_sheet_apply",
      title: "Apply a previously previewed write",
      description:
        "Applies ONE pending preview (from drive_sheet_preview_update / drive_sheet_preview_append) after re-verifying the sheet " +
        "hasn't changed since the preview — any drift blocks the write and requires a fresh preview. Writes the " +
        "smallest possible ranges, rereads them, and returns before/after verification. Previews are single-use. " +
        "Only call this after the user has approved the specific preview diff.",
      inputSchema: {
        previewId: z.string().describe("The previewId returned by a preview tool."),
      },
      annotations: { destructiveHint: true, idempotentHint: false },
      handler: async (args, ctx) => {
        const previews = new PreviewStore(ctx.config);
        const pending = previews.loadPendingSheet(args.previewId);
        return gm().withSheets(pending.account, async (sheets) => {
          const result = await applyPreview(sheets, previews, args.previewId);
          return ok({
            applied: true,
            op: result.op,
            tab: result.tab,
            tabRenamedTo: result.tabRenamedTo,
            appendedRange: result.appendedRange,
            verification: result.verification,
            note: "Verified by rereading the written cells. Re-running the same preview would now report nothing to change.",
          });
        });
      },
    }),
    defineTool({
      name: "drive_list_previews",
      title: "List pending previews",
      description: "Lists unexpired, unapplied previews (useful to recover a lost previewId or audit staged writes).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async (_args, ctx: ToolsetContext) => {
        const pending = new PreviewStore(ctx.config).listPending();
        return ok({
          previews: pending.map((p) =>
            p.kind === "doc"
              ? {
                  previewId: p.id,
                  kind: "doc" as const,
                  op: p.op,
                  doc: p.title,
                  created_at: p.created_at,
                  summary: `replace body: +${p.added_lines}/-${p.removed_lines} lines (${p.before_chars} → ${p.after_chars} chars)`,
                }
              : {
                  previewId: p.id,
                  kind: "sheet" as const,
                  op: p.op,
                  sheet: p.sheetAlias ?? p.spreadsheetId,
                  tab: p.tab,
                  created_at: p.created_at,
                  summary:
                    p.op === "update"
                      ? p.targets!.map((t) => `${t.a1Range} "${t.header}": ${t.before_formatted ?? "(empty)"} → ${t.after}`)
                      : `append 1 row (${p.append!.rowValues.filter((v) => v !== null).length} cells)`,
                },
          ),
        });
      },
    }),
  ];
}
