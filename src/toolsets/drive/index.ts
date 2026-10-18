import type { Toolset } from "../../core/toolset.js";
import { DriveAccountManager, type DriveManagerLike } from "./client.js";
import { SheetRegistry } from "./sheetreg.js";
import { readTools } from "./tools/read.js";
import { writeTools } from "./tools/write.js";
import { driveTools } from "./tools/drive.js";
import { docTools } from "./tools/docs.js";
import { FolderRegistry } from "./docref.js";

export interface DriveToolsetDeps {
  /** Injectable for tests; production uses a real DriveAccountManager. */
  manager?: DriveManagerLike;
}

export function createDriveToolset(deps: DriveToolsetDeps = {}): Toolset {
  let manager: DriveManagerLike | undefined = deps.manager;
  const gm = (): DriveManagerLike => {
    if (!manager) throw new Error("drive toolset used before init()");
    return manager;
  };

  return {
    name: "drive",
    description: "Google Sheets and Google Docs under a strict preview→apply write protocol; Drive folder lookups and document creation.",
    init: async (ctx) => {
      manager ??= new DriveAccountManager(ctx);
      const registered = Object.keys(new SheetRegistry(ctx.config).all());
      const folders = Object.keys(new FolderRegistry(ctx.config).all());
      ctx.logger.info(
        (registered.length > 0
          ? `drive: ${registered.length} sheet(s) registered (${registered.join(", ")})`
          : "drive: no spreadsheets registered yet") +
          (folders.length > 0 ? `; ${folders.length} folder(s) (${folders.join(", ")})` : ""),
      );
    },
    instructions: async (ctx) => {
      const registered = Object.entries(new SheetRegistry(ctx.config).all());
      const names = registered.map(([alias, e]) => `${alias} (${e.note ?? e.spreadsheetId})`).join(", ");
      const folderNames = Object.entries(new FolderRegistry(ctx.config).all())
        .map(([alias, f]) => `${alias} (${f.note ?? f.folderId})`)
        .join(", ");
      return (
        (registered.length > 0
          ? `Registered spreadsheets: ${names}. `
          : `No spreadsheets registered yet — use drive_register_sheet. `) +
        `Columns are ALWAYS addressed by header name, never letters. The write protocol is strict: ` +
        `drive_sheet_preview_update/append stage a change and return a diff; NEVER call drive_sheet_apply until the user has ` +
        `seen and approved that exact diff. Formula (generated) cells cannot be written. If an apply reports drift, ` +
        `re-read and build a fresh preview. ` +
        (folderNames.length > 0
          ? `Registered Drive folders: ${folderNames}. `
          : `No Drive folders registered yet — use drive_register_folder. `) +
        `Docs: drive_doc_read returns a document as Markdown; drive_doc_create makes a NEW document in a folder. ` +
        `EDITING an existing document is preview→apply and replaces the WHOLE body: drive_doc_preview_replace returns a ` +
        `line diff, and drive_doc_apply must NOT be called until the user has approved that exact diff. A Markdown replace ` +
        `loses images, colors and custom styles and orphans anchored comments — say so before proposing a replace on a ` +
        `document life-os did not create.`
      );
    },
    tools: [...readTools(gm), ...writeTools(gm), ...driveTools(gm), ...docTools(gm)],
  };
}
