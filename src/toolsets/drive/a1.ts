/** A1-notation helpers. Tab names are ALWAYS quoted (always valid, never guessy). */

/** `Analytical library'` → `'Analytical library'''` — internal apostrophes double. */
export function quoteA1Tab(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

/** 0 → A, 25 → Z, 26 → AA (bijective base-26). */
export function columnLetter(index0: number): string {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Single cell, e.g. cellA1("Person logs", 7, 2) → `'Person logs'!C7`. */
export function cellA1(tab: string, rowNumber: number, colIndex0: number): string {
  return `${quoteA1Tab(tab)}!${columnLetter(colIndex0)}${rowNumber}`;
}

/** Full-width data range, open-ended rows: `'Tab'!A2:H` (or bounded when endRow given). */
export function dataRangeA1(tab: string, lastColIndex0: number, startRow: number, endRow?: number): string {
  return `${quoteA1Tab(tab)}!A${startRow}:${columnLetter(lastColIndex0)}${endRow ?? ""}`;
}

/** Header row range: `'Tab'!1:1`. */
export function headerRangeA1(tab: string): string {
  return `${quoteA1Tab(tab)}!1:1`;
}
