import { mkdirSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

/** Atomic replacement; callers must still serialize read/modify/write operations. */
export function writeAtomic(path: string, data: string, mode: number = 0o600): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, data, { mode, flag: "wx" });
    renameSync(tmp, path);
  } finally {
    rmSync(tmp, { force: true });
  }
}
