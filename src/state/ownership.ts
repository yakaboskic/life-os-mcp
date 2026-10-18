import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { LifeOsConfig } from "../core/config.js";
import { openDatabase, transaction } from "./database.js";

interface RuntimeOwner {
  pid: number;
  token: string;
  boot_id: string | null;
  start_signature: string | null;
}

const ownedTokens = new Map<string, string>();
const thisProcessFallback = `process-${process.pid}-${Math.floor(Date.now() - process.uptime() * 1000)}`;
const homeKey = (config: LifeOsConfig) => resolve(config.home);

function readOptional(path: string): string | null {
  try { return readFileSync(path, "utf8").trim(); } catch { return null; }
}

function startSignature(pid: number): string | null {
  // /proc stat's comm field can contain spaces and parentheses. Field 22 is
  // the start tick; count from the final ')' instead of splitting the name.
  const stat = readOptional(`/proc/${pid}/stat`);
  if (stat) {
    const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
    if (fields[19] && /^\d+$/.test(fields[19])) return `linux-start-${fields[19]}`;
  }
  return pid === process.pid ? thisProcessFallback : null;
}

function ownerAlive(owner: RuntimeOwner): boolean {
  if (!Number.isInteger(owner.pid) || owner.pid < 1) return false;
  const boot = readOptional("/proc/sys/kernel/random/boot_id");
  if (boot && owner.boot_id && boot !== owner.boot_id) return false;
  try { process.kill(owner.pid, 0); }
  catch (error) {
    // Permission denied means the process may still be alive; never steal it.
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
  }
  const start = startSignature(owner.pid);
  if (start && owner.start_signature && start.startsWith("linux-start-") === owner.start_signature.startsWith("linux-start-") && start !== owner.start_signature) return false;
  return true;
}

function readOwner(db: DatabaseSync): RuntimeOwner | undefined {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_owner'").get()) return undefined;
  return db.prepare("SELECT pid, token, boot_id, start_signature FROM runtime_owner WHERE singleton=1").get() as unknown as RuntimeOwner | undefined;
}

/** Checked on every open, including cached connections, and before transactions. */
export function assertDatabaseAccess(config: LifeOsConfig, db?: DatabaseSync): void {
  const mode = config.env.LIFE_OS_ACCESS_MODE;
  if (existsSync(join(config.home, ".vm-authoritative")) && !["daemon", "backup", "migrate"].includes(mode ?? "")) {
    throw new Error("This is the authoritative VM home. Connect to the LifeOS daemon; direct local access is disabled.");
  }
  if (!db) return;
  const owner = readOwner(db);
  if (!owner || !ownerAlive(owner)) return;
  if (mode === "backup") return;
  if (mode === "daemon" && ownedTokens.get(homeKey(config)) === owner.token && owner.pid === process.pid) return;
  if (mode === "migrate") throw new Error("Stop the owning LifeOS daemon before migrating this database.");
  throw new Error("A LifeOS daemon already owns this home. Connect to it instead of starting another writer.");
}

/**
 * A durable, exclusive claim before job recovery or any service initialization.
 * No time-based lease: a slow Gmail call cannot let a second daemon steal it.
 */
export function acquireDaemonOwnership(config: LifeOsConfig): () => void {
  if (config.env.LIFE_OS_ACCESS_MODE !== "daemon") throw new Error("Daemon ownership requires daemon access mode.");
  const db = openDatabase(config);
  const token = randomUUID();
  transaction(db, () => {
    db.exec(`CREATE TABLE IF NOT EXISTS runtime_owner (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1),
      pid INTEGER NOT NULL,
      token TEXT NOT NULL,
      boot_id TEXT,
      start_signature TEXT,
      acquired_at TEXT NOT NULL
    )`);
    const previous = readOwner(db);
    if (previous && ownerAlive(previous)) throw new Error("A LifeOS daemon already owns this home.");
    db.prepare("INSERT OR REPLACE INTO runtime_owner VALUES(1,?,?,?,?,?)").run(
      process.pid, token, readOptional("/proc/sys/kernel/random/boot_id"), startSignature(process.pid), new Date().toISOString(),
    );
  });
  ownedTokens.set(homeKey(config), token);
  let released = false;
  return () => {
    if (released) return;
    // A conditional DELETE is atomic and cannot remove a replacement owner's row.
    db.prepare("DELETE FROM runtime_owner WHERE singleton=1 AND token=?").run(token);
    released = true;
    if (ownedTokens.get(homeKey(config)) === token) ownedTokens.delete(homeKey(config));
  };
}
