import type { sheets_v4 } from "googleapis";

/**
 * Stateful in-memory Google Sheets fake covering the calls the sheets engine
 * makes. Cells are either primitives (value) or `{ f, v }` (formula + its
 * rendered value): FORMULA render returns `f ?? value`, FORMATTED returns `v ?? value`.
 */
export type FakeCell = string | number | null | { f: string; v: string };

export class FakeSpreadsheet {
  constructor(
    public title: string,
    public tabs: Map<string, FakeCell[][]>,
  ) {}

  private colToIndex(letters: string): number {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n; // 1-based
  }

  private parseRange(range: string): { tab: string; grid: FakeCell[][]; r1: number; c1: number; r2: number; c2: number } {
    const m = range.match(/^'((?:[^']|'')*)'!(.+)$/) ?? range.match(/^([^!']+)!(.+)$/);
    if (!m) throw new Error(`fake: cannot parse range ${range}`);
    const tab = m[1]!.replace(/''/g, "'");
    const grid = this.tabs.get(tab);
    if (!grid) throw Object.assign(new Error("not found"), { response: { status: 404, data: { error: { message: `tab ${tab}` } } } });
    const ref = m[2]!;
    const lastRow = grid.length;
    const width = Math.max(...grid.map((r) => r.length), 1);
    const rm = ref.match(/^([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/);
    if (!rm) throw new Error(`fake: bad ref ${ref}`);
    const [, c1s, r1s, c2s, r2s] = rm;
    const hasSecond = ref.includes(":");
    const c1 = c1s ? this.colToIndex(c1s) : 1;
    const r1 = r1s ? parseInt(r1s, 10) : 1;
    const c2 = hasSecond ? (c2s ? this.colToIndex(c2s) : width) : c1;
    const r2 = hasSecond ? (r2s ? parseInt(r2s, 10) : lastRow) : r1;
    return { tab, grid, r1, c1, r2, c2 };
  }

  private render(cell: FakeCell | undefined, mode: "FORMULA" | "FORMATTED_VALUE" | "UNFORMATTED_VALUE"): unknown {
    if (cell === undefined || cell === null) return undefined;
    if (typeof cell === "object") return mode === "FORMULA" ? cell.f : cell.v;
    return cell;
  }

  private getValues(range: string, mode: "FORMULA" | "FORMATTED_VALUE" | "UNFORMATTED_VALUE"): unknown[][] {
    const { grid, r1, c1, r2, c2 } = this.parseRange(range);
    const out: unknown[][] = [];
    for (let r = r1; r <= Math.min(r2, grid.length); r++) {
      const row: unknown[] = [];
      for (let c = c1; c <= c2; c++) row.push(this.render(grid[r - 1]?.[c - 1], mode));
      out.push(row);
    }
    while (out.length > 0 && out[out.length - 1]!.every((v) => v === undefined || v === "")) out.pop();
    return out;
  }

  /** Cast to sheets_v4.Sheets for injection into the engine/tools. */
  asSheets(): sheets_v4.Sheets {
    const self = this;
    return {
      spreadsheets: {
        get: async (_params: any) => ({
          data: {
            properties: { title: self.title },
            sheets: [...self.tabs.entries()].map(([title, grid], i) => ({
              properties: {
                sheetId: 1000 + i,
                title,
                gridProperties: { rowCount: grid.length, columnCount: Math.max(...grid.map((r) => r.length), 1) },
              },
            })),
          },
        }),
        values: {
          get: async (params: any) => ({
            data: { values: self.getValues(params.range, params.valueRenderOption ?? "FORMATTED_VALUE") },
          }),
          batchGet: async (params: any) => ({
            data: {
              valueRanges: (params.ranges as string[]).map((range) => ({
                values: self.getValues(range, params.valueRenderOption ?? "FORMATTED_VALUE"),
              })),
            },
          }),
          batchUpdate: async (params: any) => {
            for (const vr of params.requestBody.data) {
              const { grid, r1, c1 } = self.parseRange(vr.range);
              vr.values.forEach((row: unknown[], dr: number) => {
                row.forEach((value, dc) => {
                  grid[r1 - 1 + dr] ??= [];
                  grid[r1 - 1 + dr]![c1 - 1 + dc] = value as FakeCell;
                });
              });
            }
            return { data: { totalUpdatedCells: 1 } };
          },
          append: async (params: any) => {
            const { tab, grid, c2 } = self.parseRange(params.range);
            const lastDataRow = grid.length;
            const rowIndex = lastDataRow; // 0-based insert position = after last row
            const values: unknown[] = params.requestBody.values[0];
            grid[rowIndex] = values.map((v) => (v === null ? "" : (v as FakeCell)));
            const colLetter = (n: number) => {
              let s = "";
              while (n > 0) {
                const r = (n - 1) % 26;
                s = String.fromCharCode(65 + r) + s;
                n = Math.floor((n - 1) / 26);
              }
              return s;
            };
            const rowNumber = rowIndex + 1;
            const updatedRange = `'${tab.replace(/'/g, "''")}'!A${rowNumber}:${colLetter(c2)}${rowNumber}`;
            return { data: { updates: { updatedRange, updatedRows: 1 } } };
          },
        },
      },
    } as unknown as sheets_v4.Sheets;
  }
}
