import { readFileSync } from "node:fs";
import { ToolInputError } from "../../core/errors.js";
import { writeAtomic } from "../../core/fsutil.js";
import type { LifeOsConfig, LifeOsConfigFile, RegisteredFolder } from "../../core/config.js";
import type { GoogleTokenStore } from "../../google/token-store.js";

export const DOC_MIME = "application/vnd.google-apps.document";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const MARKDOWN_MIME = "text/markdown";
export const PLAINTEXT_MIME = "text/plain";

const RAW_ID_RE = /^[A-Za-z0-9_-]{25,}$/;

/**
 * Accepts a raw Drive id or any docs.google.com URL. Agents paste URLs far more
 * often than ids, and rejecting them costs a whole round trip to explain.
 */
export function parseDocId(input: string): string {
  const s = input.trim();
  const url = s.match(/\/document\/d\/([A-Za-z0-9_-]+)/) ?? s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (url) return url[1]!;
  if (RAW_ID_RE.test(s)) return s;
  throw new ToolInputError(
    `"${input}" is not a Google Doc id or URL. Pass either the id (e.g. 1sUZvzjKXzlLgGzE-…) ` +
      `or the full https://docs.google.com/document/d/<id>/edit link.`,
  );
}

/** Named-folder registry stored in ~/.life-os/config.json under drive.folders. */
export class FolderRegistry {
  constructor(private readonly config: LifeOsConfig) {}

  private read(): LifeOsConfigFile {
    try {
      return JSON.parse(readFileSync(this.config.configFile, "utf8")) as LifeOsConfigFile;
    } catch {
      return {};
    }
  }

  all(): Record<string, RegisteredFolder> {
    return this.read().drive?.folders ?? {};
  }

  register(alias: string, entry: RegisteredFolder): void {
    if (RAW_ID_RE.test(alias)) {
      throw new ToolInputError(`Alias "${alias}" looks like a raw folder id — pick a short human name.`);
    }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(alias)) {
      throw new ToolInputError(`Alias "${alias}" must be alphanumeric/dashes (e.g. "mcp-gateway").`);
    }
    const file = this.read();
    file.drive ??= {};
    file.drive.folders ??= {};
    file.drive.folders[alias] = entry;
    writeAtomic(this.config.configFile, JSON.stringify(file, null, 2));
  }

  /** Registered alias (supplies default account) or raw folder id (needs explicit account). */
  resolve(folderArg: string, accountArg?: string): { folderId: string; account?: string; alias?: string } {
    const registered = this.all();
    const hit = Object.entries(registered).find(([alias]) => alias.toLowerCase() === folderArg.trim().toLowerCase());
    if (hit) {
      const [alias, entry] = hit;
      return { folderId: entry.folderId, account: accountArg ?? entry.account, alias };
    }
    if (RAW_ID_RE.test(folderArg.trim())) {
      return { folderId: folderArg.trim(), account: accountArg };
    }
    const known = Object.keys(registered);
    throw new ToolInputError(
      known.length > 0
        ? `Unknown folder "${folderArg}". Registered folders: ${known.join(", ")}. (Or pass a raw folder id.)`
        : `No folders registered yet. Register one with drive_register_folder, or pass a raw folder id.`,
    );
  }
}

/**
 * When exactly one account holds Drive scopes, `account` can be omitted
 * on every Docs tool. Multiple accounts require an explicit choice.
 */
export function resolveDriveAccount(store: GoogleTokenStore, account?: string): string {
  if (account) return store.resolveAccount(account);
  const tokens = store.listTokenFiles();
  if (tokens.length === 1) return tokens[0]!.account;
  if (tokens.length === 0) {
    throw new ToolInputError(
      `No Drive-authorized account found. Run "life-os auth add --services drive" and sign in.`,
    );
  }
  throw new ToolInputError(
    `Multiple Drive-authorized accounts (${tokens.map((t) => t.account).join(", ")}) — pass \`account\`.`,
  );
}
