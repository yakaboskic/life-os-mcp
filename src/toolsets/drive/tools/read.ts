import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { ToolInputError } from "../../../core/errors.js";
import { SheetRegistry } from "../sheetreg.js";
import { getTabs, findTab, readHeaders, readDataRows } from "../engine.js";
import { matchRows, rowsToObjects } from "../table.js";
import type { DriveManagerLike } from "../client.js";

const CELL_CHAR_CAP = 500;

const sheetArg = () =>
  z.string().describe("Registered sheet alias (see drive_list_sheets) or a raw spreadsheet id (then `account` is required).");
const accountArg = () =>
  z.string().optional().describe("Google account (email or alias). Defaults to the registered sheet's account.");

function capCells(values: Record<string, string>): { values: Record<string, string>; truncated: boolean } {
  let truncated = false;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v.length > CELL_CHAR_CAP) {
      out[k] = v.slice(0, CELL_CHAR_CAP) + "…[truncated]";
      truncated = true;
    } else out[k] = v;
  }
  return { values: out, truncated };
}

export function readTools(gm: () => DriveManagerLike): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "drive_list_sheets",
      title: "List registered spreadsheets",
      description: "Lists spreadsheets registered by alias (with their default account and notes).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async (_args, ctx) => {
        const registered = new SheetRegistry(ctx.config).all();
        const list = Object.entries(registered).map(([alias, e]) => ({
          alias,
          spreadsheetId: e.spreadsheetId,
          account: e.account,
          note: e.note,
          drive: e.drive,
        }));
        return ok({
          sheets: list,
          hint: list.length === 0 ? "Register one with drive_register_sheet." : undefined,
        });
      },
    }),
    defineTool({
      name: "drive_register_sheet",
      title: "Register a spreadsheet under an alias",
      description:
        "Registers a spreadsheet so tools can refer to it by a short alias with a default account. " +
        "Validates access by reading the spreadsheet's metadata and echoes its title and tabs.",
      inputSchema: {
        alias: z.string().describe('Short name, e.g. "team-tracking".'),
        spreadsheetId: z.string().describe("The spreadsheet id from its URL."),
        account: z.string().describe("Google account (email or alias) whose authorization will be used."),
        note: z.string().optional(),
        driveRootFolderId: z.string().optional().describe("Optional related Drive folder id (documentation only)."),
        proposedProductsFolderId: z.string().optional(),
      },
      handler: async (args, ctx) => {
        return gm().withSheets(
          args.account,
          async (sheets, email) => {
            const { title, tabs } = await getTabs(sheets, args.spreadsheetId);
            new SheetRegistry(ctx.config).register(args.alias, {
              spreadsheetId: args.spreadsheetId,
              account: email,
              note: args.note,
              drive:
                args.driveRootFolderId || args.proposedProductsFolderId
                  ? { rootFolderId: args.driveRootFolderId, proposedProductsFolderId: args.proposedProductsFolderId }
                  : undefined,
            });
            return ok({
              registered: args.alias,
              title,
              account: email,
              tabs: tabs.map((t) => t.title),
            });
          },
          { readOnly: true },
        );
      },
    }),
    defineTool({
      name: "drive_sheet_overview",
      title: "Spreadsheet overview (tabs + headers)",
      description:
        "Title, tabs (with size), and each tab's header row. Start here — every other tool addresses columns by these header names.",
      inputSchema: { sheet: sheetArg(), account: accountArg() },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const ref = new SheetRegistry(ctx.config).resolve(args.sheet, args.account);
        return gm().withSheets(
          ref.account,
          async (sheets) => {
            const { title, tabs } = await getTabs(sheets, ref.spreadsheetId);
            const withHeaders = [];
            for (const tab of tabs.slice(0, 12)) {
              let headers: string[] = [];
              try {
                headers = await readHeaders(sheets, ref.spreadsheetId, tab.title);
              } catch {
                // empty tab
              }
              withHeaders.push({ tab: tab.title, rows: tab.rowCount, columns: tab.columnCount, headers: headers.filter(Boolean) });
            }
            return ok({ title, spreadsheetId: ref.spreadsheetId, tabs: withHeaders });
          },
          { readOnly: true },
        );
      },
    }),
    defineTool({
      name: "drive_sheet_read",
      title: "Read rows from a tab",
      description:
        "Reads data rows as header-keyed objects with their sheet row numbers (needed by drive_sheet_preview_update matching). " +
        "Row 1 is always the header row; data starts at row 2.",
      inputSchema: {
        sheet: sheetArg(),
        tab: z.string().describe("Tab name (see drive_sheet_overview)."),
        account: accountArg(),
        startRow: z.number().int().min(2).optional().describe("First data row to return (default 2)."),
        limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const ref = new SheetRegistry(ctx.config).resolve(args.sheet, args.account);
        return gm().withSheets(
          ref.account,
          async (sheets) => {
            const { tabs } = await getTabs(sheets, ref.spreadsheetId);
            const tab = findTab(tabs, args.tab);
            const headers = await readHeaders(sheets, ref.spreadsheetId, tab.title);
            const rows = await readDataRows(sheets, ref.spreadsheetId, tab.title, headers);
            const start = args.startRow ?? 2;
            const limit = args.limit ?? 50;
            const slice = rows.slice(start - 2, start - 2 + limit);
            let anyTruncated = false;
            const objects = rowsToObjects(headers, slice, start).map((r) => {
              const { values, truncated } = capCells(r.values);
              anyTruncated ||= truncated;
              return { rowNumber: r.rowNumber, ...values };
            });
            return ok({
              tab: tab.title,
              totalDataRows: rows.length,
              returned: objects.length,
              startRow: start,
              cellsTruncated: anyTruncated || undefined,
              rows: objects,
            });
          },
          { readOnly: true },
        );
      },
    }),
    defineTool({
      name: "drive_sheet_find_rows",
      title: "Find rows by header values",
      description:
        "Finds rows where every given header: value pair matches (trimmed, case-insensitive). " +
        "Use before drive_sheet_preview_update to confirm a match resolves to exactly one row.",
      inputSchema: {
        sheet: sheetArg(),
        tab: z.string().describe("Tab name."),
        match: z.record(z.string()).describe('Header-name → value pairs, e.g. {"Person": "Owner", "Week": "2026-07-27"}.'),
        account: accountArg(),
        limit: z.number().int().min(1).max(100).optional().describe("Max rows returned (default 20)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        if (Object.keys(args.match).length === 0) throw new ToolInputError("`match` needs at least one header: value pair.");
        const ref = new SheetRegistry(ctx.config).resolve(args.sheet, args.account);
        return gm().withSheets(
          ref.account,
          async (sheets) => {
            const { tabs } = await getTabs(sheets, ref.spreadsheetId);
            const tab = findTab(tabs, args.tab);
            const headers = await readHeaders(sheets, ref.spreadsheetId, tab.title);
            const rows = await readDataRows(sheets, ref.spreadsheetId, tab.title, headers);
            const rowNumbers = matchRows(headers, rows, 2, args.match);
            const limit = args.limit ?? 20;
            const objects = rowsToObjects(
              headers,
              rowNumbers.slice(0, limit).map((n) => rows[n - 2]!),
              0,
            ).map((r, i) => ({ rowNumber: rowNumbers[i]!, ...capCells(r.values).values }));
            return ok({ tab: tab.title, matches: rowNumbers.length, rows: objects });
          },
          { readOnly: true },
        );
      },
    }),
  ];
}
