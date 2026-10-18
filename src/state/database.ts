import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { LifeOsConfig } from "../core/config.js";
import { ensureDir } from "../core/fsutil.js";
import { assertDatabaseAccess } from "./ownership.js";

export const SCHEMA_VERSION = 1;
const connections = new Map<string, DatabaseSync>();
const depths = new WeakMap<DatabaseSync, number>();
const connectionConfigs = new WeakMap<DatabaseSync, LifeOsConfig>();

/** One connection per application home; synchronous transactions never span await. */
export function openDatabase(config: LifeOsConfig, allowLegacy = false): DatabaseSync {
  const path = resolve(config.home, "life-os.sqlite");
  const cached = connections.get(path);
  assertDatabaseAccess(config, cached);
  if (cached) { connectionConfigs.set(cached, config); return cached; }
  if (!existsSync(path) && !allowLegacy && ["registry.json", "entries.jsonl", "timer.json"].some(f => existsSync(join(config.trackDir, f)))) {
    throw new Error("Legacy tracker files found. Back up this home, then run life-os db migrate. Source files will be preserved.");
  }
  ensureDir(config.home);
  const db = new DatabaseSync(path);
  try { assertDatabaseAccess(config, db); } catch (error) { db.close(); throw error; }
  connectionConfigs.set(db, config);
  chmodSync(path, 0o600);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  const version = Number((db.prepare("PRAGMA user_version").get() as any).user_version);
  if (version > SCHEMA_VERSION) { db.close(); throw new Error(`Database schema ${version} is newer than this release supports.`); }
  transaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_history(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, product_id TEXT REFERENCES products(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED, start TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE INDEX IF NOT EXISTS entries_start ON entries(start);
      CREATE TABLE IF NOT EXISTS active_timer(singleton INTEGER PRIMARY KEY CHECK(singleton=1), task_id TEXT NOT NULL REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED, data TEXT NOT NULL CHECK(json_valid(data)));
      INSERT OR IGNORE INTO settings VALUES('nextTaskNum','1'),('weeklyTargetHours','25');
      PRAGMA user_version=1;
    `);
    db.prepare("INSERT OR IGNORE INTO schema_history VALUES(?,?)").run(SCHEMA_VERSION, new Date().toISOString());
  });
  connections.set(path, db);
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  const config = connectionConfigs.get(db);
  if (config) assertDatabaseAccess(config, db);
  const depth = depths.get(db) ?? 0;
  const savepoint = `lifeos_${depth}`;
  db.exec(depth ? `SAVEPOINT ${savepoint}` : "BEGIN IMMEDIATE");
  depths.set(db, depth + 1);
  try {
    // Recheck after BEGIN IMMEDIATE: another process may have claimed ownership
    // between the initial read and acquisition of the SQLite writer lock.
    if (config) assertDatabaseAccess(config, db);
    const result = fn();
    if (result instanceof Promise) throw new Error("SQLite transaction callback must be synchronous");
    db.exec(depth ? `RELEASE ${savepoint}` : "COMMIT");
    return result;
  } catch (error) {
    if (depth) db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
    else db.exec("ROLLBACK");
    throw error;
  } finally { depths.set(db, depth); }
}

export function closeDatabase(config: LifeOsConfig): void {
  const path = resolve(config.home, "life-os.sqlite");
  connections.get(path)?.close();
  connections.delete(path);
}
