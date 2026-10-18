import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { openDatabase, closeDatabase } from "../../src/state/database.js";
import { acquireDaemonOwnership } from "../../src/state/ownership.js";
import { TrackStore } from "../../src/toolsets/track/store.js";

const configs: LifeOsConfig[] = [];
function config(mode?: string, home = mkdtempSync(join(tmpdir(), "lifeos-owner-"))) {
  const value = loadConfig({ LIFE_OS_HOME: home, ...(mode ? { LIFE_OS_ACCESS_MODE: mode } : {}) });
  configs.push(value); return value;
}
afterEach(() => { for (const c of configs.splice(0)) closeDatabase(c); });

describe("authoritative database ownership", () => {
  it("rejects a second daemon even in the same process and allows ownership after release", () => {
    const c = config("daemon");
    const release = acquireDaemonOwnership(c);
    try { expect(() => acquireDaemonOwnership(c)).toThrow("already owns"); }
    finally { release(); }
    const next = acquireDaemonOwnership(c); next(); next();
  });

  it("enforces production access mode even when the SQLite connection is already cached", () => {
    const c = config();
    openDatabase(c);
    writeFileSync(join(c.home, ".vm-authoritative"), "");
    expect(() => openDatabase(c)).toThrow("authoritative VM home");
    expect(() => new TrackStore(c)).toThrow("authoritative VM home");
    expect(() => openDatabase(config("migrate", c.home))).not.toThrow();
  });

  it("permits backup access but blocks migration and another local writer while owned", () => {
    const c = config("daemon");
    const release = acquireDaemonOwnership(c);
    try {
      expect(() => openDatabase(config(undefined, c.home))).toThrow("already owns");
      expect(() => openDatabase(config("migrate", c.home))).toThrow("Stop the owning");
      expect(() => openDatabase(config("backup", c.home))).not.toThrow();
      expect(new TrackStore(c).addTask({ title: "Daemon operation" }).id).toBe("t1");
    } finally { release(); }
  });

  it("does not steal a live PID but recovers ownership after process death", () => {
    const c = config("daemon");
    const release = acquireDaemonOwnership(c);
    release();
    const db = openDatabase(c);
    db.prepare("INSERT INTO runtime_owner VALUES(1,?,?,?,?,?)").run(process.pid, "other-live-owner", null, null, new Date().toISOString());
    expect(() => acquireDaemonOwnership(c)).toThrow("already owns");
    db.prepare("UPDATE runtime_owner SET pid=?").run(2_147_483_647);
    const recovered = acquireDaemonOwnership(c); recovered();
  });

  it("releases only its own random ownership token", () => {
    const c = config("daemon");
    const release = acquireDaemonOwnership(c);
    const direct = new DatabaseSync(join(c.home, "life-os.sqlite"));
    try {
      direct.prepare("UPDATE runtime_owner SET token=?").run("replacement-owner");
      release();
      expect(direct.prepare("SELECT token FROM runtime_owner").get()?.token).toBe("replacement-owner");
    } finally { direct.close(); }
  });

  it("does not create an empty database over unmigrated legacy data", () => {
    const c = config("daemon");
    // Track directory is intentionally created without an SQLite destination.
    mkdirSync(c.trackDir);
    writeFileSync(join(c.trackDir, "registry.json"), "{}");
    expect(() => acquireDaemonOwnership(c)).toThrow("db migrate");
  });
  it("blocks a pre-existing writer in another process and recovers after its daemon dies", async () => {
    const c = config();
    const existingStore = new TrackStore(c);
    existingStore.addTask({ title: "Before daemon" });
    const moduleUrl = (path: string) => JSON.stringify(pathToFileURL(join(process.cwd(), path)).href);
    const script = `
      import { loadConfig } from ${moduleUrl("src/core/config.ts")};
      import { acquireDaemonOwnership } from ${moduleUrl("src/state/ownership.ts")};
      const c = loadConfig({ LIFE_OS_HOME: ${JSON.stringify(c.home)}, LIFE_OS_ACCESS_MODE: "daemon" });
      acquireDaemonOwnership(c);
      process.send({ ready: true });
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let errors = "";
    child.stderr?.on("data", chunk => { errors += String(chunk); });
    const exited = once(child, "exit");
    try {
      await Promise.race([
        once(child, "message"),
        exited.then(() => { throw new Error(`Daemon child exited before claiming ownership: ${errors}`); }),
      ]);
      expect(() => existingStore.addTask({ title: "Must not write" })).toThrow("already owns");
      child.kill("SIGKILL");
      await exited;
      const release = acquireDaemonOwnership(config("daemon", c.home));
      release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
  });

});
