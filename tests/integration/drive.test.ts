import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { docs_v1, drive_v3, sheets_v4 } from "googleapis";
import { buildServer } from "../../src/core/server.js";
import { loadConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { createDriveToolset } from "../../src/toolsets/drive/index.js";
import type { DriveManagerLike } from "../../src/toolsets/drive/client.js";
import { GoogleTokenStore } from "../../src/google/token-store.js";
import { FakeSpreadsheet, type FakeCell } from "../helpers/fake-spreadsheet.js";

const text = (res: any) => JSON.parse(res.content[0].text);
const SPREADSHEET_ID = "fake1234567890abcdefghijklmnop";

class FakeManager implements DriveManagerLike {
  constructor(
    readonly store: GoogleTokenStore,
    private readonly sheets: sheets_v4.Sheets,
  ) {}
  async withSheets<T>(account: string, fn: (s: sheets_v4.Sheets, email: string) => Promise<T>): Promise<T> {
    return fn(this.sheets, this.store.resolveAccount(account));
  }
  async withDrive<T>(_account: string, _fn: (d: drive_v3.Drive, email: string) => Promise<T>): Promise<T> {
    throw new Error("drive not faked");
  }
  async withDocs<T>(_account: string, _fn: (d: docs_v1.Docs, email: string) => Promise<T>): Promise<T> {
    throw new Error("docs not faked");
  }
  async withDocsPair<T>(
    _account: string,
    _fn: (drive: drive_v3.Drive, docs: docs_v1.Docs, email: string) => Promise<T>,
  ): Promise<T> {
    throw new Error("docs not faked");
  }
}

describe("drive toolset (in-memory transport, stateful fake spreadsheet)", () => {
  let client: Client;
  let fake: FakeSpreadsheet;

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), "life-os-sheets-int-"));
    const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
    const store = new GoogleTokenStore(config);
    const now = new Date().toISOString();
    store.saveTokenFile({
      account: "operator@example.com",
      refresh_token: "rt",
      scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"],
      client_id: "cid",
      created_at: now,
      updated_at: now,
    });

    const grid: FakeCell[][] = [
      ["Person", "Week", "Hours", "Total"],
      ["Owner", "W1", "3", { f: "=C2*1", v: "3" }],
      ["Colleague", "W1", "5", { f: "=C3*1", v: "5" }],
      ["Owner", "W2", "2", { f: "=C4*1", v: "2" }],
    ];
    fake = new FakeSpreadsheet("Team_tracking", new Map([
      ["Person logs", grid],
      ["Analytical library'", [["Item", "Status"], ["roadmap doc", "open"]]],
    ]));

    const toolset = createDriveToolset({ manager: new FakeManager(store, fake.asSheets()) });
    const server = await buildServer([toolset], { config, logger: createLogger("error") });
    client = new Client({ name: "sheets-test", version: "0.0.0" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
  });

  it("registers every drive_* tool", async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name);
    // Name set, not a count: adding a tool should fail loudly and legibly.
    expect(new Set(names)).toEqual(
      new Set([
        "drive_list_sheets",
        "drive_register_sheet",
        "drive_sheet_overview",
        "drive_sheet_read",
        "drive_sheet_find_rows",
        "drive_sheet_preview_update",
        "drive_sheet_preview_append",
        "drive_sheet_apply",
        "drive_list_previews",
        "drive_register_folder",
        "drive_get_file",
        "drive_list_folder",
        "drive_doc_read",
        "drive_doc_create",
        "drive_doc_preview_replace",
        "drive_doc_apply",
      ]),
    );
    for (const n of names) expect(n.startsWith("drive_")).toBe(true);
    expect(res.tools.find((t) => t.name === "drive_sheet_apply")!.annotations?.destructiveHint).toBe(true);
    expect(res.tools.find((t) => t.name === "drive_sheet_preview_update")!.annotations?.destructiveHint).toBe(false);
    expect(res.tools.find((t) => t.name === "drive_doc_apply")!.annotations?.destructiveHint).toBe(true);
    expect(res.tools.find((t) => t.name === "drive_doc_preview_replace")!.annotations?.destructiveHint).toBe(false);
  });

  it("registers a spreadsheet and reads it (incl. an apostrophe tab name)", async () => {
    const reg = text(
      await client.callTool({
        name: "drive_register_sheet",
        arguments: { alias: "tracker", spreadsheetId: SPREADSHEET_ID, account: "operator@example.com", note: "test tracker" },
      }),
    );
    expect(reg.title).toBe("Team_tracking");
    expect(reg.tabs).toContain("Analytical library'");

    const overview = text(await client.callTool({ name: "drive_sheet_overview", arguments: { sheet: "tracker" } }));
    expect(overview.tabs[0].headers).toEqual(["Person", "Week", "Hours", "Total"]);

    const read = text(
      await client.callTool({ name: "drive_sheet_read", arguments: { sheet: "tracker", tab: "Analytical library'" } }),
    );
    expect(read.rows[0]).toMatchObject({ rowNumber: 2, Item: "roadmap doc", Status: "open" });

    const found = text(
      await client.callTool({
        name: "drive_sheet_find_rows",
        arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner" } },
      }),
    );
    expect(found.matches).toBe(2);
    expect(found.rows.map((r: any) => r.rowNumber)).toEqual([2, 4]);
  });

  it("refuses ambiguous and empty matches for updates", async () => {
    const ambiguous = await client.callTool({
      name: "drive_sheet_preview_update",
      arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner" }, set: { Hours: "9" } },
    });
    expect(ambiguous.isError).toBe(true);
    expect((ambiguous.content as any)[0].text).toContain("2 rows match");

    const none = await client.callTool({
      name: "drive_sheet_preview_update",
      arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Nobody" }, set: { Hours: "9" } },
    });
    expect(none.isError).toBe(true);
    expect((none.content as any)[0].text).toContain("No row");
  });

  it("blocks formula (generated) targets and formula-injection values", async () => {
    const formulaTarget = await client.callTool({
      name: "drive_sheet_preview_update",
      arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner", Week: "W1" }, set: { Total: "99" } },
    });
    expect(formulaTarget.isError).toBe(true);
    expect((formulaTarget.content as any)[0].text).toContain("generated field");

    const injection = await client.callTool({
      name: "drive_sheet_preview_update",
      arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner", Week: "W1" }, set: { Hours: "=1+1" } },
    });
    expect(injection.isError).toBe(true);
    expect((injection.content as any)[0].text).toContain('starts with "="');
  });

  it("runs the full preview → apply → verify → idempotent re-preview cycle", async () => {
    const preview = text(
      await client.callTool({
        name: "drive_sheet_preview_update",
        arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner", Week: "W1" }, set: { Hours: "4.5" } },
      }),
    );
    expect(preview.previewId).toBeTruthy();
    expect(preview.diff).toEqual([
      { cell: "'Person logs'!C2", header: "Hours", row: 2, current: "3", proposed: "4.5" },
    ]);

    const listed = text(await client.callTool({ name: "drive_list_previews", arguments: {} }));
    expect(listed.previews.some((p: any) => p.previewId === preview.previewId)).toBe(true);

    const applied = text(await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: preview.previewId } }));
    expect(applied.applied).toBe(true);
    expect(applied.verification).toEqual([
      { cell: "'Person logs'!C2", header: "Hours", before: "3", wrote: "4.5", nowReads: "4.5" },
    ]);

    // single-use
    const again = await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: preview.previewId } });
    expect(again.isError).toBe(true);
    expect((again.content as any)[0].text).toContain("already applied");

    // idempotence: same change now previews as a no-op
    const repreview = text(
      await client.callTool({
        name: "drive_sheet_preview_update",
        arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner", Week: "W1" }, set: { Hours: "4.5" } },
      }),
    );
    expect(repreview.nothingToChange).toBe(true);
  });

  it("blocks an apply when the sheet drifted after the preview", async () => {
    const preview = text(
      await client.callTool({
        name: "drive_sheet_preview_update",
        arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Colleague", Week: "W1" }, set: { Hours: "6" } },
      }),
    );
    // someone else edits the cell between preview and apply
    fake.tabs.get("Person logs")![2]![2] = "7";

    const blocked = await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: preview.previewId } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain("changed since the preview");
    expect((blocked.content as any)[0].text).toContain("Nothing was written");
    expect(fake.tabs.get("Person logs")![2]![2]).toBe("7"); // untouched

    const retry = await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: preview.previewId } });
    expect((retry.content as any)[0].text).toContain("invalidated");
  });

  it("appends a row via preview → apply, with growth-drift protection", async () => {
    const preview = text(
      await client.callTool({
        name: "drive_sheet_preview_append",
        arguments: { sheet: "tracker", tab: "Person logs", values: { Person: "Owner", Week: "W3", Hours: "2.5" } },
      }),
    );
    expect(preview.newRow).toEqual({ Person: "Owner", Week: "W3", Hours: "2.5" });

    const applied = text(await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: preview.previewId } }));
    expect(applied.op).toBe("append");
    expect(applied.appendedRange).toContain("A5");
    expect(fake.tabs.get("Person logs")![4]).toEqual(["Owner", "W3", "2.5", ""]);

    // growth drift: preview, then table grows before apply
    const p2 = text(
      await client.callTool({
        name: "drive_sheet_preview_append",
        arguments: { sheet: "tracker", tab: "Person logs", values: { Person: "Owner", Week: "W4", Hours: "1" } },
      }),
    );
    fake.tabs.get("Person logs")!.push(["Colleague", "W3", "8", ""]);
    const blocked = await client.callTool({ name: "drive_sheet_apply", arguments: { previewId: p2.previewId } });
    expect(blocked.isError).toBe(true);
    expect((blocked.content as any)[0].text).toContain("grew/shrank");
  });

  it("gives helpful errors for unknown sheets and unknown headers", async () => {
    const unknown = await client.callTool({ name: "drive_sheet_overview", arguments: { sheet: "nope" } });
    expect(unknown.isError).toBe(true);
    expect((unknown.content as any)[0].text).toContain("Registered sheets: tracker");

    const badHeader = await client.callTool({
      name: "drive_sheet_preview_update",
      arguments: { sheet: "tracker", tab: "Person logs", match: { Person: "Owner", Week: "W2" }, set: { Hrs: "1" } },
    });
    expect(badHeader.isError).toBe(true);
    expect((badHeader.content as any)[0].text).toContain("Available headers: Person, Week, Hours, Total");
  });
});
