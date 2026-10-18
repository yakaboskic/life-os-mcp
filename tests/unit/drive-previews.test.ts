import { describe, expect, it } from "vitest";
import { mkdtempSync, statSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.js";
import { writeAtomic } from "../../src/core/fsutil.js";
import { PreviewStore, type PreviewFile } from "../../src/toolsets/drive/previews.js";
import { ToolInputError } from "../../src/core/errors.js";

function freshStore(): { store: PreviewStore; dir: string } {
  const home = mkdtempSync(join(tmpdir(), "life-os-previews-"));
  const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
  return { store: new PreviewStore(config), dir: config.drivePreviewsDir };
}

const base = {
  kind: "sheet" as const,
  op: "update" as const,
  account: "op@x.com",
  spreadsheetId: "s",
  tab: "T",
  sheetId: 1000,
  headers: ["A"],
  targets: [],
};

describe("PreviewStore", () => {
  it("creates pending previews with 0600 perms and lists them", () => {
    const { store, dir } = freshStore();
    const p = store.create(base);
    expect(p.status).toBe("pending");
    if (process.platform !== "win32") {
      const mode = statSync(join(dir, `${p.id}.json`)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect(store.listPending().map((x) => x.id)).toEqual([p.id]);
  });

  it("is single-use: consumed previews refuse re-apply", () => {
    const { store } = freshStore();
    const p = store.create(base);
    store.markConsumed(store.loadPending(p.id));
    expect(() => store.loadPending(p.id)).toThrowError(/already applied/);
    expect(store.listPending()).toHaveLength(0);
  });

  it("stale previews refuse apply with fresh-preview guidance", () => {
    const { store } = freshStore();
    const p = store.create(base);
    store.markStale(store.loadPending(p.id));
    expect(() => store.loadPending(p.id)).toThrowError(/invalidated/);
  });

  it("expires previews after the 1h TTL", () => {
    const { store, dir } = freshStore();
    const p = store.create(base);
    const old: PreviewFile = { ...p, created_at: new Date(Date.now() - 2 * 3600_000).toISOString() };
    writeAtomic(join(dir, `${p.id}.json`), JSON.stringify(old));
    expect(() => store.loadPending(p.id)).toThrowError(/expired/);
    expect(store.listPending()).toHaveLength(0);
  });

  it("errors clearly for unknown ids", () => {
    const { store } = freshStore();
    expect(() => store.loadPending("deadbeef")).toThrowError(ToolInputError);
  });

  it("ignores corrupt preview files when listing", () => {
    const { store, dir } = freshStore();
    store.create(base);
    writeAtomic(join(dir, "corrupt.json"), "{not json");
    expect(store.listPending()).toHaveLength(1);
    expect(readdirSync(dir).length).toBe(2);
  });
});
