import { createHash } from "node:crypto";

/**
 * Markdown normalization + line diffing for the Docs preview→apply protocol.
 *
 * Pure functions, no I/O — everything here is unit-testable without Google.
 *
 * Normalization is load-bearing, not cosmetic: Google rewrites Markdown on
 * import (it pads list items with trailing spaces, inserts table alignment
 * rows, and re-wraps emphasis), so a byte comparison of "what we sent" against
 * "what we read back" always reports differences even when the document is
 * exactly what we asked for. Every equality check, drift check and diff in the
 * Docs path runs on the normalized form.
 */

/** Collapse the differences Google's Markdown import introduces. */
export function normalizeMarkdown(md: string): string {
  const lines = md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) =>
      line
        .replace(/[ \t]+$/, "") // Google pads list items with two trailing spaces
        .replace(/^(\s*)[*+](\s+)/, "$1-$2") // unify bullet markers
        .replace(/^\s*\|[\s:|-]+\|\s*$/, (row) => {
          // Table separator rows come back re-spaced and alignment-annotated
          // ("| :---- | :---- |" for "|---|---|"). Rebuild canonically.
          const cols = row.trim().slice(1, -1).split("|").length;
          return `|${" --- |".repeat(cols)}`;
        }),
    );

  // Collapse runs of 3+ blank lines to exactly one blank line.
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      if (blanks > 1) continue;
    } else {
      blanks = 0;
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1]!.trim() === "") out.pop();
  return out.join("\n") + "\n";
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export interface DiffHunk {
  op: "+" | "-";
  line: number;
  text: string;
}

export interface LineDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
}

/**
 * Plain LCS line diff. Deliberately dependency-free — the server ships four
 * runtime deps and a diff library is not worth a fifth for this.
 */
export function lineDiff(before: string, after: string): LineDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;

  // LCS length table. Roadmap docs are a few hundred lines; O(n*m) is fine.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const hunks: DiffHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      hunks.push({ op: "-", line: i + 1, text: a[i]! });
      i += 1;
    } else {
      hunks.push({ op: "+", line: j + 1, text: b[j]! });
      j += 1;
    }
  }
  while (i < n) {
    hunks.push({ op: "-", line: i + 1, text: a[i]! });
    i += 1;
  }
  while (j < m) {
    hunks.push({ op: "+", line: j + 1, text: b[j]! });
    j += 1;
  }

  return {
    hunks,
    added: hunks.filter((h) => h.op === "+").length,
    removed: hunks.filter((h) => h.op === "-").length,
  };
}

export interface DiffSummary {
  addedLines: number;
  removedLines: number;
  hunks: string[];
  truncated?: boolean;
  moreChangedLines?: number;
}

/** Render a diff for human review, capped so a full rewrite stays readable. */
export function summarizeDiff(diff: LineDiff, cap = 200): DiffSummary {
  const shown = diff.hunks.slice(0, cap);
  const summary: DiffSummary = {
    addedLines: diff.added,
    removedLines: diff.removed,
    hunks: shown.map((h) => `${h.op}${h.line} ${h.text}`),
  };
  if (diff.hunks.length > cap) {
    summary.truncated = true;
    summary.moreChangedLines = diff.hunks.length - cap;
  }
  return summary;
}

export function countLines(s: string): number {
  if (s === "") return 0;
  return s.split("\n").length;
}
