import type { docs_v1, drive_v3 } from "googleapis";
import { ToolInputError, UpstreamError } from "../../core/errors.js";
import { DOC_MIME, MARKDOWN_MIME, PLAINTEXT_MIME } from "./docref.js";
import type { DocPreview, PreviewStore } from "./previews.js";
import { countLines, lineDiff, normalizeMarkdown, sha256, summarizeDiff, type DiffSummary } from "./textdiff.js";

/**
 * Google Docs read/write on top of the DRIVE API, not the Docs API.
 *
 * `files.export(…, "text/markdown")` gives a document as Markdown, and
 * `files.create`/`files.update` with markdown media converts Markdown back into
 * native Docs formatting (real heading styles, bullets and tables). That buys
 * three things over Docs-API batchUpdate: no markdown→styling translator, no
 * dependency on the Docs API being enabled, and one representation shared by
 * read, write and diff — which is what makes a preview diff legible enough to
 * approve.
 *
 * The trade is no server-side `requiredRevisionId` CAS, so drift is caught the
 * same way the sheets engine catches it: re-read and compare before writing.
 */

const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;

export interface DocMeta {
  documentId: string;
  title: string;
  mimeType: string;
  version: string;
  modifiedTime: string;
  parents: string[];
  webViewLink: string;
}

export async function getDocMeta(drive: drive_v3.Drive, documentId: string): Promise<DocMeta> {
  const res = await drive.files.get({
    fileId: documentId,
    fields: "id,name,mimeType,version,modifiedTime,parents,webViewLink",
    supportsAllDrives: true,
  });
  const d = res.data;
  if (d.mimeType !== DOC_MIME) {
    throw new ToolInputError(
      `"${d.name ?? documentId}" is a ${d.mimeType}, not a Google Doc.` +
        (d.mimeType === "application/vnd.google-apps.spreadsheet" ? " Use the drive_sheet_* tools." : ""),
    );
  }
  return {
    documentId: d.id!,
    title: d.name ?? "(untitled)",
    mimeType: d.mimeType,
    version: String(d.version ?? ""),
    modifiedTime: d.modifiedTime ?? "",
    parents: d.parents ?? [],
    webViewLink: d.webViewLink ?? `https://docs.google.com/document/d/${d.id}/edit`,
  };
}

/** Export a doc's body. Falls back to plain text if Markdown export is refused. */
export async function exportDoc(
  drive: drive_v3.Drive,
  documentId: string,
  format: "markdown" | "text" = "markdown",
): Promise<{ content: string; format: "markdown" | "text" }> {
  const wanted = format === "markdown" ? MARKDOWN_MIME : PLAINTEXT_MIME;
  try {
    const res = await drive.files.export({ fileId: documentId, mimeType: wanted }, { responseType: "text" });
    return { content: String(res.data ?? ""), format };
  } catch (err) {
    if (format === "markdown") {
      const res = await drive.files.export({ fileId: documentId, mimeType: PLAINTEXT_MIME }, { responseType: "text" });
      return { content: String(res.data ?? ""), format: "text" };
    }
    throw err;
  }
}

export async function writeDocBody(
  drive: drive_v3.Drive,
  documentId: string,
  markdown: string,
): Promise<{ version: string }> {
  const res = await drive.files.update({
    fileId: documentId,
    media: { mimeType: MARKDOWN_MIME, body: markdown },
    fields: "id,version",
    supportsAllDrives: true,
  });
  return { version: String(res.data.version ?? "") };
}

/** Create, place and populate in a single Drive call. */
export async function createDoc(
  drive: drive_v3.Drive,
  opts: { name: string; folderId: string; markdown?: string },
): Promise<{ documentId: string; webViewLink: string; version: string }> {
  const res = await drive.files.create({
    requestBody: { name: opts.name, mimeType: DOC_MIME, parents: [opts.folderId] },
    ...(opts.markdown !== undefined ? { media: { mimeType: MARKDOWN_MIME, body: opts.markdown } } : {}),
    fields: "id,name,webViewLink,version",
    supportsAllDrives: true,
  });
  if (!res.data.id) throw new UpstreamError("Drive created no document id.");
  return {
    documentId: res.data.id,
    webViewLink: res.data.webViewLink ?? `https://docs.google.com/document/d/${res.data.id}/edit`,
    version: String(res.data.version ?? ""),
  };
}

export async function findByName(
  drive: drive_v3.Drive,
  folderId: string,
  name: string,
): Promise<{ id: string; name: string }[]> {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${esc(folderId)}' in parents and name = '${esc(name)}' and mimeType = '${DOC_MIME}' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 10,
    ...ALL_DRIVES,
  });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name ?? "" }));
}

/**
 * Best-effort structural check. A Markdown replace can only carry what Markdown
 * expresses, so images and positioned objects are silently dropped — worth
 * warning about. Requires the Docs API; degrades to a note if unavailable.
 */
export async function structuralWarnings(docs: docs_v1.Docs, documentId: string): Promise<string[]> {
  try {
    const res = await docs.documents.get({
      documentId,
      fields: "inlineObjects,positionedObjects,revisionId",
    });
    const warnings: string[] = [];
    const inline = Object.keys(res.data.inlineObjects ?? {}).length;
    const positioned = Object.keys(res.data.positionedObjects ?? {}).length;
    if (inline > 0) warnings.push(`${inline} inline image(s)/object(s) will be LOST — Markdown cannot carry them.`);
    if (positioned > 0) warnings.push(`${positioned} positioned object(s) will be LOST.`);
    return warnings;
  } catch {
    return ["structural pre-flight unavailable (Docs API not reachable) — image/style loss could not be checked."];
  }
}

export async function docRevisionId(docs: docs_v1.Docs, documentId: string): Promise<string | undefined> {
  try {
    const res = await docs.documents.get({ documentId, fields: "revisionId" });
    return res.data.revisionId ?? undefined;
  } catch {
    return undefined;
  }
}

export type ReplacePreviewResult =
  | { kind: "noop"; documentId: string; title: string; message: string }
  | {
      kind: "preview";
      preview: DocPreview;
      diff: DiffSummary;
      warnings: string[];
      before: { chars: number; lines: number };
      after: { chars: number; lines: number };
    };

export async function buildReplacePreview(input: {
  drive: drive_v3.Drive;
  docs: docs_v1.Docs;
  previews: PreviewStore;
  account: string;
  documentId: string;
  markdown: string;
}): Promise<ReplacePreviewResult> {
  const meta = await getDocMeta(input.drive, input.documentId);
  const { content } = await exportDoc(input.drive, input.documentId, "markdown");

  const beforeNorm = normalizeMarkdown(content);
  const afterNorm = normalizeMarkdown(input.markdown);

  if (beforeNorm === afterNorm) {
    return {
      kind: "noop",
      documentId: meta.documentId,
      title: meta.title,
      message: "The document already has this exact content — nothing to change.",
    };
  }

  const warnings = await structuralWarnings(input.docs, input.documentId);
  const diff = summarizeDiff(lineDiff(beforeNorm, afterNorm));

  const preview = input.previews.create<DocPreview>({
    kind: "doc",
    op: "replace",
    account: input.account,
    documentId: meta.documentId,
    title: meta.title,
    webViewLink: meta.webViewLink,
    version: meta.version,
    revisionId: await docRevisionId(input.docs, input.documentId),
    before_sha256: sha256(beforeNorm),
    before_chars: content.length,
    before_lines: countLines(beforeNorm),
    after_markdown: input.markdown,
    after_chars: input.markdown.length,
    after_lines: countLines(afterNorm),
    added_lines: diff.addedLines,
    removed_lines: diff.removedLines,
    warnings,
  });

  return {
    kind: "preview",
    preview,
    diff,
    warnings,
    before: { chars: content.length, lines: countLines(beforeNorm) },
    after: { chars: input.markdown.length, lines: countLines(afterNorm) },
  };
}

export interface DocApplyResult {
  applied: true;
  documentId: string;
  title: string;
  webViewLink?: string;
  before: { chars: number; lines: number };
  wrote: { chars: number; lines: number };
  nowReads: { chars: number; lines: number };
  roundTripIdentical: boolean;
  firstLines: string[];
  note: string;
}

export async function applyDocPreview(
  drive: drive_v3.Drive,
  docs: docs_v1.Docs,
  previews: PreviewStore,
  previewId: string,
): Promise<DocApplyResult> {
  const preview = previews.loadPendingDoc(previewId);
  const meta = await getDocMeta(drive, preview.documentId);

  // Tier 1: the Drive change counter. Unchanged means nobody touched it.
  if (meta.version !== preview.version) {
    // Tier 2: version moved, but content may not have (opening a doc, resolving
    // a comment and metadata edits all bump it). Compare the content itself.
    const { content } = await exportDoc(drive, preview.documentId, "markdown");
    const nowNorm = normalizeMarkdown(content);
    if (sha256(nowNorm) !== preview.before_sha256) {
      previews.markStale(preview);
      const drift = lineDiff(normalizeMarkdown(preview.after_markdown), nowNorm);
      throw new ToolInputError(
        `The document "${meta.title}" changed since the preview (${drift.added + drift.removed} lines differ). ` +
          `Nothing was written. Create a fresh preview with drive_doc_preview_replace.`,
      );
    }
  }

  previews.markApplying(preview);
  await writeDocBody(drive, preview.documentId, preview.after_markdown);
  previews.markConsumed(preview);

  const after = await exportDoc(drive, preview.documentId, "markdown");
  const afterNorm = normalizeMarkdown(after.content);
  const intendedNorm = normalizeMarkdown(preview.after_markdown);

  return {
    applied: true,
    documentId: preview.documentId,
    title: meta.title,
    webViewLink: preview.webViewLink,
    before: { chars: preview.before_chars, lines: preview.before_lines },
    wrote: { chars: preview.after_chars, lines: preview.after_lines },
    nowReads: { chars: after.content.length, lines: countLines(afterNorm) },
    roundTripIdentical: afterNorm === intendedNorm,
    firstLines: afterNorm.split("\n").slice(0, 5),
    note:
      "Google normalizes Markdown on import, so a re-read can differ cosmetically from what was sent. " +
      "roundTripIdentical:false does not mean the write failed — compare firstLines.",
  };
}
