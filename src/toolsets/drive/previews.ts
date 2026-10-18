import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ToolInputError } from "../../core/errors.js";
import { writeAtomic } from "../../core/fsutil.js";
import type { LifeOsConfig } from "../../core/config.js";

export interface PreviewTarget {
  header: string;
  colIndex: number;
  rowNumber: number;
  a1Range: string;
  /** FORMULA render at preview time — drift baseline + formula detection. */
  before_formula: unknown;
  /** FORMATTED render — what the human sees in the diff. */
  before_formatted: unknown;
  after: string;
}

interface PreviewBase {
  id: string;
  account: string;
  created_at: string;
  status: "pending" | "consumed" | "stale" | "applying";
  consumed_at?: string;
}

export interface SheetPreview extends PreviewBase {
  kind: "sheet";
  op: "update" | "append";
  spreadsheetId: string;
  sheetAlias?: string;
  tab: string;
  /** Stable grid id — survives tab renames between preview and apply. */
  sheetId: number;
  headers: string[];
  targets?: PreviewTarget[];
  append?: {
    searchRange: string;
    rowValues: (string | null)[];
    /** Data-region row count at preview time (drift baseline for appends). */
    tableRowCountAtPreview: number;
  };
}

export interface DocPreview extends PreviewBase {
  kind: "doc";
  op: "replace";
  documentId: string;
  title: string;
  webViewLink?: string;
  /** Drive change counter at preview time — the fast-path drift check. */
  version: string;
  /** Present only when the Docs API is reachable; informational. */
  revisionId?: string;
  /** sha256(normalizeMarkdown(exported)) — the authoritative drift gate. */
  before_sha256: string;
  before_chars: number;
  before_lines: number;
  after_markdown: string;
  after_chars: number;
  after_lines: number;
  added_lines: number;
  removed_lines: number;
  warnings?: string[];
}

export type PreviewFile = SheetPreview | DocPreview;

const TTL_MS = 60 * 60 * 1000; // 1h
/** Doc bodies live in a 0600 file on disk; keep them sane. */
const MAX_DOC_MARKDOWN = 200_000;

/** `Omit` does not distribute over a union — this does. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * Local persistence for pending write previews. Single-use by design: an
 * apply consumes its preview; drift marks it stale; either way a fresh
 * preview is required for any further write.
 */
export class PreviewStore {
  constructor(private readonly config: LifeOsConfig) {}

  private path(id: string): string {
    if (!/^[a-f0-9]{12}$/.test(id)) throw new ToolInputError("Invalid preview ID");
    return join(this.config.drivePreviewsDir, `${id}.json`);
  }

  create<T extends PreviewFile>(preview: DistributiveOmit<T, "id" | "created_at" | "status">): T {
    if (preview.kind === "doc" && preview.after_markdown.length > MAX_DOC_MARKDOWN) {
      throw new ToolInputError(
        `Document body is ${preview.after_markdown.length} characters — the limit is ${MAX_DOC_MARKDOWN}. Split the document.`,
      );
    }
    const full = {
      ...preview,
      id: randomBytes(6).toString("hex"),
      created_at: new Date().toISOString(),
      status: "pending" as const,
    } as unknown as T;
    writeAtomic(this.path(full.id), JSON.stringify(full, null, 2));
    return full;
  }

  /** Loads a preview that is valid to apply; precise errors otherwise. */
  loadPending(id: string): PreviewFile {
    let preview: PreviewFile;
    try {
      preview = JSON.parse(readFileSync(this.path(id), "utf8")) as PreviewFile;
    } catch {
      throw new ToolInputError(`No preview with id "${id}". Create one with drive_sheet_preview_update / drive_sheet_preview_append / drive_doc_preview_replace.`);
    }
    // Previews written before the doc/sheet split carry no `kind`.
    (preview as { kind?: PreviewFile["kind"] }).kind ??= "sheet";
    if (preview.status === "consumed") {
      throw new ToolInputError(
        `Preview ${id} was already applied at ${preview.consumed_at}. Create a fresh preview for any further change.`,
      );
    }
    if (preview.status === "stale") {
      throw new ToolInputError(
        `Preview ${id} was invalidated (${preview.kind === "doc" ? "document" : "sheet"} changed since preview). Create a fresh preview.`,
      );
    }
    if (preview.status === "applying") {
      throw new ToolInputError(`Preview ${id} has an uncertain write outcome. Inspect the remote document before creating another preview; do not retry this write.`);
    }
    if (Date.now() - new Date(preview.created_at).getTime() > TTL_MS) {
      throw new ToolInputError(`Preview ${id} expired (previews live 1 hour). Create a fresh preview.`);
    }
    return preview;
  }

  /** Same gate as loadPending, narrowed — with a redirect on a cross-kind id. */
  loadPendingSheet(id: string): SheetPreview {
    const preview = this.loadPending(id);
    if (preview.kind !== "sheet") {
      throw new ToolInputError(`Preview ${id} is a document preview — apply it with drive_doc_apply.`);
    }
    return preview;
  }

  loadPendingDoc(id: string): DocPreview {
    const preview = this.loadPending(id);
    if (preview.kind !== "doc") {
      throw new ToolInputError(`Preview ${id} is a spreadsheet preview — apply it with drive_sheet_apply.`);
    }
    return preview;
  }

  markConsumed(preview: PreviewFile): void {
    preview.status = "consumed";
    preview.consumed_at = new Date().toISOString();
    writeAtomic(this.path(preview.id), JSON.stringify(preview, null, 2));
  }

  /** Persist before an external write, so a crash or timeout cannot blindly replay it. */
  markApplying(preview: PreviewFile): void {
    this.loadPending(preview.id);
    preview.status = "applying";
    writeAtomic(this.path(preview.id), JSON.stringify(preview, null, 2));
  }

  markStale(preview: PreviewFile): void {
    preview.status = "stale";
    writeAtomic(this.path(preview.id), JSON.stringify(preview, null, 2));
  }

  listPending(): PreviewFile[] {
    let entries: string[];
    try {
      entries = readdirSync(this.config.drivePreviewsDir);
    } catch {
      return [];
    }
    const out: PreviewFile[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const p = JSON.parse(readFileSync(join(this.config.drivePreviewsDir, entry), "utf8")) as PreviewFile;
        (p as { kind?: PreviewFile["kind"] }).kind ??= "sheet";
        if (p.status === "pending" && Date.now() - new Date(p.created_at).getTime() <= TTL_MS) out.push(p);
      } catch {
        // skip corrupt
      }
    }
    return out.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
}
