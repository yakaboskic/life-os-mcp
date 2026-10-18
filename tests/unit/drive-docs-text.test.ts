import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countLines, lineDiff, normalizeMarkdown, sha256, summarizeDiff } from "../../src/toolsets/drive/textdiff.js";
import { FolderRegistry, parseDocId } from "../../src/toolsets/drive/docref.js";
import { loadConfig } from "../../src/core/config.js";

describe("normalizeMarkdown", () => {
  it("absorbs the rewrites Google's markdown import makes", () => {
    // Observed live: list items come back with two trailing spaces and tables
    // gain an alignment row. Without normalization every round trip looks dirty.
    const sent = "# H\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n";
    const returned = "# H\n\n- a  \n- b\n\n| x | y |\n| :---- | :---- |\n| 1 | 2 |\n";
    expect(normalizeMarkdown(returned)).toBe(normalizeMarkdown(sent));
  });

  it("unifies bullet markers and collapses blank runs", () => {
    expect(normalizeMarkdown("* a\n+ b\n")).toBe("- a\n- b\n");
    expect(normalizeMarkdown("a\n\n\n\n\nb\n")).toBe("a\n\nb\n");
  });

  it("is idempotent and ends with exactly one newline", () => {
    const once = normalizeMarkdown("# H\n\n- a  \n\n\n");
    expect(normalizeMarkdown(once)).toBe(once);
    expect(once.endsWith("\n")).toBe(true);
    expect(once.endsWith("\n\n")).toBe(false);
  });

  it("gives normalization-equivalent inputs the same hash", () => {
    expect(sha256(normalizeMarkdown("- a  \n"))).toBe(sha256(normalizeMarkdown("* a\n")));
  });
});

describe("lineDiff", () => {
  it("reports only what actually changed", () => {
    const d = lineDiff("a\nb\nc\n", "a\nB\nc\n");
    expect(d.added).toBe(1);
    expect(d.removed).toBe(1);
    expect(d.hunks.map((h) => h.text)).toEqual(["b", "B"]);
  });

  it("handles pure insertion and pure deletion", () => {
    expect(lineDiff("a\n", "a\nb\n")).toMatchObject({ added: 1, removed: 0 });
    expect(lineDiff("a\nb\n", "a\n")).toMatchObject({ added: 0, removed: 1 });
  });

  it("is empty for identical input", () => {
    expect(lineDiff("x\ny\n", "x\ny\n").hunks).toHaveLength(0);
  });

  it("caps the rendered diff but still reports the true totals", () => {
    const before = Array.from({ length: 50 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 50 }, (_, i) => `new ${i}`).join("\n");
    const s = summarizeDiff(lineDiff(before, after), 10);
    expect(s.hunks).toHaveLength(10);
    expect(s.truncated).toBe(true);
    expect(s.addedLines).toBe(50);
    expect(s.moreChangedLines).toBe(90);
  });
});

describe("countLines", () => {
  it("counts an empty body as zero", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("a\nb")).toBe(2);
  });
});

describe("parseDocId", () => {
  it("accepts a raw id and every URL shape agents actually paste", () => {
    const id = "1sUZvzjKXzlLgGzE-9xggHmOGUSobFRvPPszraDhIWdk";
    expect(parseDocId(id)).toBe(id);
    expect(parseDocId(`https://docs.google.com/document/d/${id}/edit`)).toBe(id);
    expect(parseDocId(`https://docs.google.com/document/d/${id}/edit?usp=drivesdk`)).toBe(id);
  });

  it("rejects garbage with an actionable message", () => {
    expect(() => parseDocId("not a doc")).toThrow(/not a Google Doc id or URL/);
  });
});

describe("FolderRegistry", () => {
  const freshConfig = () => loadConfig({ LIFE_OS_HOME: mkdtempSync(join(tmpdir(), "life-os-folders-")) } as NodeJS.ProcessEnv);

  it("registers and resolves an alias, carrying the account", () => {
    const config = freshConfig();
    const reg = new FolderRegistry(config);
    reg.register("mcp-gateway", { folderId: "1ckI_folder", account: "op@x.com", note: "MCP Gateway" });
    expect(reg.resolve("mcp-gateway")).toMatchObject({ folderId: "1ckI_folder", account: "op@x.com", alias: "mcp-gateway" });
    expect(reg.resolve("MCP-GATEWAY").folderId).toBe("1ckI_folder");
  });

  it("passes a raw folder id through, and names known aliases when it can't resolve", () => {
    const config = freshConfig();
    const reg = new FolderRegistry(config);
    reg.register("known", { folderId: "1aaaaaaaaaaaaaaaaaaaaaaaaaaaaa", account: "op@x.com" });
    expect(reg.resolve("1bbbbbbbbbbbbbbbbbbbbbbbbbbbbb").folderId).toBe("1bbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(() => reg.resolve("nope")).toThrow(/Registered folders: known/);
  });

  it("rejects an alias that is really an id", () => {
    const config = freshConfig();
    expect(() =>
      new FolderRegistry(config).register("1ckI_clkWVX11z-1faVNLZUQHlV8mTa6O", { folderId: "x", account: "a@b.c" }),
    ).toThrow(/looks like a raw folder id/);
  });

  it("does not clobber a config file that already has sheets in it", () => {
    const config = freshConfig();
    writeFileSync(config.configFile, JSON.stringify({ drive: { registered: { tracker: { spreadsheetId: "s", account: "a@b.c" } } } }));
    new FolderRegistry(config).register("folder", { folderId: "f", account: "a@b.c" });
    const after = JSON.parse(require("node:fs").readFileSync(config.configFile, "utf8"));
    expect(after.drive.registered.tracker.spreadsheetId).toBe("s");
    expect(after.drive.folders.folder.folderId).toBe("f");
  });
});
