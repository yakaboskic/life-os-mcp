import type { sheets_v4 } from "googleapis";
import { ToolInputError, UpstreamError } from "../../core/errors.js";
import { cellA1, columnLetter, dataRangeA1, headerRangeA1, quoteA1Tab } from "./a1.js";
import { cellStr, headerIndex, matchRows, parseHeaders } from "./table.js";
import type { PreviewStore, PreviewTarget, SheetPreview } from "./previews.js";

/**
 * The team-tracking runbook's write protocol, made structural:
 * headers re-read immediately before constructing a change; columns addressed
 * by header name; exactly-one row match; formula cells untouchable; preview
 * (exact cells, current → proposed) strictly separated from apply; smallest
 * ranges only; reread verification; idempotent re-preview.
 */

export interface TabInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export async function getTabs(sheets: sheets_v4.Sheets, spreadsheetId: string): Promise<{ title: string; tabs: TabInfo[] }> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties(sheetId,title,index,gridProperties(rowCount,columnCount))",
  });
  const tabs = (res.data.sheets ?? []).map((s) => ({
    sheetId: s.properties?.sheetId ?? -1,
    title: s.properties?.title ?? "",
    rowCount: s.properties?.gridProperties?.rowCount ?? 0,
    columnCount: s.properties?.gridProperties?.columnCount ?? 0,
  }));
  return { title: res.data.properties?.title ?? "", tabs };
}

export function findTab(tabs: TabInfo[], tabName: string): TabInfo {
  const needle = tabName.trim().toLowerCase();
  const tab = tabs.find((t) => t.title.trim().toLowerCase() === needle);
  if (!tab) {
    throw new ToolInputError(`No tab named "${tabName}". Tabs: ${tabs.map((t) => t.title).join(", ")}`);
  }
  return tab;
}

export async function readHeaders(sheets: sheets_v4.Sheets, spreadsheetId: string, tab: string): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: headerRangeA1(tab),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const headers = parseHeaders(res.data.values?.[0]);
  if (headers.filter(Boolean).length === 0) {
    throw new ToolInputError(`Tab "${tab}" has an empty header row (row 1) — cannot address columns by name.`);
  }
  return headers;
}

export async function readDataRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tab: string,
  headers: string[],
): Promise<unknown[][]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: dataRangeA1(tab, headers.length - 1, 2),
    valueRenderOption: "FORMATTED_VALUE",
  });
  return res.data.values ?? [];
}

const isFormula = (v: unknown): boolean => typeof v === "string" && v.trim().startsWith("=");

async function batchGetCells(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  ranges: string[],
  render: "FORMULA" | "FORMATTED_VALUE",
): Promise<unknown[]> {
  const res = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges, valueRenderOption: render });
  return (res.data.valueRanges ?? []).map((vr) => vr.values?.[0]?.[0]);
}

export interface UpdatePreviewInput {
  sheets: sheets_v4.Sheets;
  previews: PreviewStore;
  account: string;
  spreadsheetId: string;
  sheetAlias?: string;
  tab: string;
  match: Record<string, string>;
  set: Record<string, string>;
}

export async function buildUpdatePreview(input: UpdatePreviewInput): Promise<
  | { kind: "noop"; message: string }
  | { kind: "preview"; preview: SheetPreview; diff: object[] }
> {
  const { sheets, spreadsheetId } = input;
  for (const [header, value] of Object.entries(input.set)) {
    if (value.trim().startsWith("=")) {
      throw new ToolInputError(
        `Refusing to write a formula to "${header}" (value starts with "="). Writing formulas is not supported; ` +
          `to store a literal leading "=", prefix it with an apostrophe.`,
      );
    }
  }

  const { tabs } = await getTabs(sheets, spreadsheetId);
  const tabInfo = findTab(tabs, input.tab);
  const headers = await readHeaders(sheets, spreadsheetId, tabInfo.title);
  const rows = await readDataRows(sheets, spreadsheetId, tabInfo.title, headers);

  const rowNumbers = matchRows(headers, rows, 2, input.match);
  if (rowNumbers.length === 0) {
    throw new ToolInputError(
      `No row in "${tabInfo.title}" matches ${JSON.stringify(input.match)}. Use drive_sheet_find_rows or drive_sheet_read to locate the row.`,
    );
  }
  if (rowNumbers.length > 1) {
    throw new ToolInputError(
      `${rowNumbers.length} rows match ${JSON.stringify(input.match)} (rows ${rowNumbers.join(", ")}). ` +
        `Add more match fields until exactly one row matches — a write must target exactly one row.`,
    );
  }
  const rowNumber = rowNumbers[0]!;

  const setEntries = Object.entries(input.set).map(([header, after]) => ({
    header,
    colIndex: headerIndex(headers, header),
    after,
  }));
  const ranges = setEntries.map((s) => cellA1(tabInfo.title, rowNumber, s.colIndex));
  const [formulaVals, formattedVals] = await Promise.all([
    batchGetCells(sheets, spreadsheetId, ranges, "FORMULA"),
    batchGetCells(sheets, spreadsheetId, ranges, "FORMATTED_VALUE"),
  ]);

  const targets: PreviewTarget[] = [];
  setEntries.forEach((s, i) => {
    if (isFormula(formulaVals[i])) {
      throw new ToolInputError(
        `Cell ${ranges[i]} ("${s.header}") contains a formula (${formulaVals[i]}) — it is a generated field; refusing to modify it.`,
      );
    }
    if (cellStr(formattedVals[i]) === s.after.trim()) return; // no-op
    targets.push({
      header: s.header,
      colIndex: s.colIndex,
      rowNumber,
      a1Range: ranges[i]!,
      before_formula: formulaVals[i] ?? null,
      before_formatted: formattedVals[i] ?? null,
      after: s.after,
    });
  });

  if (targets.length === 0) {
    return { kind: "noop", message: `Nothing to change — row ${rowNumber} in "${tabInfo.title}" already has these values.` };
  }

  const preview = input.previews.create<SheetPreview>({
    kind: "sheet",
    op: "update",
    account: input.account,
    spreadsheetId,
    sheetAlias: input.sheetAlias,
    tab: tabInfo.title,
    sheetId: tabInfo.sheetId,
    headers,
    targets,
  });
  const diff = targets.map((t) => ({
    cell: t.a1Range,
    header: t.header,
    row: t.rowNumber,
    current: t.before_formatted ?? "(empty)",
    proposed: t.after,
  }));
  return { kind: "preview", preview, diff };
}

export interface AppendPreviewInput {
  sheets: sheets_v4.Sheets;
  previews: PreviewStore;
  account: string;
  spreadsheetId: string;
  sheetAlias?: string;
  tab: string;
  values: Record<string, string>;
}

export async function buildAppendPreview(input: AppendPreviewInput): Promise<{ preview: SheetPreview; row: object }> {
  for (const [header, value] of Object.entries(input.values)) {
    if (value.trim().startsWith("=")) {
      throw new ToolInputError(`Refusing to write a formula to "${header}" (value starts with "=").`);
    }
  }
  const { sheets, spreadsheetId } = input;
  const { tabs } = await getTabs(sheets, spreadsheetId);
  const tabInfo = findTab(tabs, input.tab);
  const headers = await readHeaders(sheets, spreadsheetId, tabInfo.title);

  const rowValues: (string | null)[] = headers.map(() => null);
  for (const [header, value] of Object.entries(input.values)) {
    rowValues[headerIndex(headers, header)] = value;
  }

  const dataNow = await readDataRows(sheets, spreadsheetId, tabInfo.title, headers);
  const preview = input.previews.create<SheetPreview>({
    kind: "sheet",
    op: "append",
    account: input.account,
    spreadsheetId,
    sheetAlias: input.sheetAlias,
    tab: tabInfo.title,
    sheetId: tabInfo.sheetId,
    headers,
    append: {
      searchRange: dataRangeA1(tabInfo.title, headers.length - 1, 1),
      rowValues,
      tableRowCountAtPreview: dataNow.length + 1, // + header row
    },
  });
  const row: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (h && rowValues[i] !== null) row[h] = rowValues[i]!;
  });
  return { preview, row };
}

export interface ApplyResult {
  op: "update" | "append";
  tab: string;
  tabRenamedTo?: string;
  verification: object[];
  appendedRange?: string;
}

export async function applyPreview(
  sheets: sheets_v4.Sheets,
  previews: PreviewStore,
  previewId: string,
): Promise<ApplyResult> {
  const preview = previews.loadPendingSheet(previewId);
  const { spreadsheetId } = preview;

  // Re-resolve the tab by its stable gid: renames are fine (and reported); deletion blocks.
  const { tabs } = await getTabs(sheets, spreadsheetId);
  const tabNow = tabs.find((t) => t.sheetId === preview.sheetId);
  if (!tabNow) {
    previews.markStale(preview);
    throw new UpstreamError(`The tab "${preview.tab}" no longer exists in this spreadsheet. Nothing was written.`, 404);
  }
  const renamed = tabNow.title !== preview.tab ? tabNow.title : undefined;
  const tabTitle = tabNow.title;

  // Header drift check.
  const headersNow = await readHeaders(sheets, spreadsheetId, tabTitle);
  if (JSON.stringify(headersNow) !== JSON.stringify(preview.headers)) {
    previews.markStale(preview);
    throw new ToolInputError(
      `The header row of "${tabTitle}" changed since the preview. Nothing was written. Create a fresh preview.`,
    );
  }

  if (preview.op === "update") {
    const targets = preview.targets!;
    // Rebuild target ranges against the CURRENT tab title (rename-safe).
    const ranges = targets.map((t) => cellA1(tabTitle, t.rowNumber, t.colIndex));
    const currentFormula = await batchGetCells(sheets, spreadsheetId, ranges, "FORMULA");
    const drift = targets
      .map((t, i) => ({ t, i, now: currentFormula[i] }))
      .filter(({ t, now }) => JSON.stringify(now ?? null) !== JSON.stringify(t.before_formula ?? null));
    if (drift.length > 0) {
      previews.markStale(preview);
      const detail = drift
        .map(({ t, now }) => `${t.a1Range} is now ${JSON.stringify(now ?? "(empty)")}, preview captured ${JSON.stringify(t.before_formatted ?? "(empty)")}`)
        .join("; ");
      throw new ToolInputError(`Sheet changed since the preview (${detail}). Nothing was written. Create a fresh preview.`);
    }

    previews.markApplying(preview);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: targets.map((t, i) => ({ range: ranges[i]!, values: [[t.after]] })),
        includeValuesInResponse: true,
        responseValueRenderOption: "UNFORMATTED_VALUE",
      },
    });
    previews.markConsumed(preview);

    const nowReads = await batchGetCells(sheets, spreadsheetId, ranges, "FORMATTED_VALUE");
    return {
      op: "update",
      tab: tabTitle,
      tabRenamedTo: renamed,
      verification: targets.map((t, i) => ({
        cell: ranges[i],
        header: t.header,
        before: t.before_formatted ?? "(empty)",
        wrote: t.after,
        nowReads: nowReads[i] ?? "(empty)",
      })),
    };
  }

  // append
  const ap = preview.append!;
  const dataNow = await readDataRows(sheets, spreadsheetId, tabTitle, headersNow);
  if (dataNow.length + 1 !== ap.tableRowCountAtPreview) {
    previews.markStale(preview);
    throw new ToolInputError(
      `The table in "${tabTitle}" grew/shrank since the preview (${ap.tableRowCountAtPreview - 1} data rows then, ` +
        `${dataNow.length} now). Nothing was written. Create a fresh preview to avoid duplicate or misplaced rows.`,
    );
  }
  previews.markApplying(preview);
  const res = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: dataRangeA1(tabTitle, preview.headers.length - 1, 1),
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: true,
    responseValueRenderOption: "UNFORMATTED_VALUE",
    requestBody: { values: [preview.append!.rowValues] },
  });
  previews.markConsumed(preview);

  const updatedRange = res.data.updates?.updatedRange ?? `${quoteA1Tab(tabTitle)}!(unknown)`;
  let nowReads: unknown[][] = [];
  if (res.data.updates?.updatedRange) {
    const reread = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: res.data.updates.updatedRange,
      valueRenderOption: "FORMATTED_VALUE",
    });
    nowReads = (reread.data.values ?? []) as unknown[][];
  }
  const written: Record<string, unknown> = {};
  preview.headers.forEach((h, i) => {
    if (h && (ap.rowValues[i] !== null || nowReads[0]?.[i] !== undefined)) {
      written[h] = nowReads[0]?.[i] ?? ap.rowValues[i];
    }
  });
  return {
    op: "append",
    tab: tabTitle,
    tabRenamedTo: renamed,
    appendedRange: updatedRange,
    verification: [written],
  };
}

export { columnLetter };
