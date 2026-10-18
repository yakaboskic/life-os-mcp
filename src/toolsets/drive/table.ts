import { ToolInputError } from "../../core/errors.js";

/** Trimmed cell → string ("" for null/undefined). */
export function cellStr(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Header row → trimmed names (blanks preserved positionally but unaddressable). */
export function parseHeaders(headerRow: unknown[] | undefined): string[] {
  return (headerRow ?? []).map((h) => cellStr(h));
}

/**
 * Resolve a header NAME (never a column letter) to its 0-based column index.
 * Case-insensitive exact match on the trimmed name; a missing header lists
 * what actually exists; a duplicate is ambiguous and blocks.
 */
export function headerIndex(headers: string[], name: string): number {
  const needle = name.trim().toLowerCase();
  const hits = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h !== "" && h.toLowerCase() === needle);
  if (hits.length === 0) {
    throw new ToolInputError(
      `No column named "${name}". Available headers: ${headers.filter(Boolean).join(", ")}`,
    );
  }
  if (hits.length > 1) {
    throw new ToolInputError(
      `Column name "${name}" is ambiguous — it appears ${hits.length} times (columns ${hits.map(({ i }) => i + 1).join(", ")}).`,
    );
  }
  return hits[0]!.i;
}

export interface RowObject {
  rowNumber: number;
  values: Record<string, string>;
}

/** Raw grid rows → header-keyed objects with their 1-based sheet row numbers. */
export function rowsToObjects(headers: string[], rows: unknown[][], firstRowNumber: number): RowObject[] {
  return rows.map((row, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, col) => {
      if (h !== "") values[h] = cellStr(row[col]);
    });
    return { rowNumber: firstRowNumber + i, values };
  });
}

/**
 * Rows whose every `match[header]` equals the cell (trimmed, case-insensitive).
 * Returns matching row numbers.
 */
export function matchRows(
  headers: string[],
  rows: unknown[][],
  firstRowNumber: number,
  match: Record<string, string>,
): number[] {
  const criteria = Object.entries(match).map(([name, value]) => ({
    col: headerIndex(headers, name),
    value: String(value).trim().toLowerCase(),
  }));
  if (criteria.length === 0) throw new ToolInputError("`match` needs at least one header: value pair.");
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (criteria.every((c) => cellStr(row[c.col]).toLowerCase() === c.value)) {
      out.push(firstRowNumber + i);
    }
  });
  return out;
}
