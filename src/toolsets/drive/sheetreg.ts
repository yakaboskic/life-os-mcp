import { readFileSync } from "node:fs";
import { ToolInputError } from "../../core/errors.js";
import { writeAtomic } from "../../core/fsutil.js";
import type { LifeOsConfig, LifeOsConfigFile, RegisteredSheet } from "../../core/config.js";

const RAW_ID_RE = /^[A-Za-z0-9_-]{25,}$/;

/** Named-spreadsheet registry stored in ~/.life-os/config.json under sheets.registered. */
export class SheetRegistry {
  constructor(private readonly config: LifeOsConfig) {}

  private read(): LifeOsConfigFile {
    try {
      return JSON.parse(readFileSync(this.config.configFile, "utf8")) as LifeOsConfigFile;
    } catch {
      return {};
    }
  }

  all(): Record<string, RegisteredSheet> {
    return this.read().drive?.registered ?? {};
  }

  register(alias: string, entry: RegisteredSheet): void {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(alias)) {
      throw new ToolInputError(`Alias "${alias}" must be alphanumeric/dashes (e.g. "team-tracking").`);
    }
    if (RAW_ID_RE.test(alias)) {
      throw new ToolInputError(`Alias "${alias}" looks like a raw spreadsheet id — pick a short human name.`);
    }
    const file = this.read();
    file.drive ??= {};
    file.drive.registered ??= {};
    file.drive.registered[alias] = entry;
    writeAtomic(this.config.configFile, JSON.stringify(file, null, 2));
  }

  /**
   * Resolves the `sheet` tool argument: registered alias (supplies default
   * account) or raw spreadsheet id (requires explicit `account`).
   */
  resolve(sheetArg: string, accountArg?: string): { spreadsheetId: string; account: string; alias?: string } {
    const registered = this.all();
    const hit = Object.entries(registered).find(([alias]) => alias.toLowerCase() === sheetArg.trim().toLowerCase());
    if (hit) {
      const [alias, entry] = hit;
      return { spreadsheetId: entry.spreadsheetId, account: accountArg ?? entry.account, alias };
    }
    if (RAW_ID_RE.test(sheetArg.trim())) {
      if (!accountArg) {
        throw new ToolInputError(
          `"${sheetArg}" looks like a raw spreadsheet id — pass \`account\` too, or register it first with drive_register_sheet.`,
        );
      }
      return { spreadsheetId: sheetArg.trim(), account: accountArg };
    }
    const known = Object.keys(registered);
    throw new ToolInputError(
      known.length > 0
        ? `Unknown sheet "${sheetArg}". Registered sheets: ${known.join(", ")}. (Or pass a raw spreadsheet id plus account.)`
        : `No sheets registered yet. Register one with drive_register_sheet, or pass a raw spreadsheet id plus account.`,
    );
  }
}
