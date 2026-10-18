import { backup, DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, chmodSync, lstatSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import type { LifeOsConfig } from "../core/config.js";
import { openDatabase, SCHEMA_VERSION } from "./database.js";
import { writeAtomic } from "../core/fsutil.js";

function files(root:string, sub=""):string[] {
  const path=join(root,sub);
  if (!existsSync(path)) return [];
  if (lstatSync(path).isSymbolicLink()) throw new Error(`Backup refuses symbolic link: ${sub}`);
  return lstatSync(path).isDirectory() ? readdirSync(path).flatMap(n=>files(root,join(sub,n))) : [sub];
}
const sha = (path:string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export async function createBackup(config:LifeOsConfig, output:string) {
  output=resolve(output);
  if (existsSync(output) && readdirSync(output).length) throw new Error("Backup output must be empty");
  mkdirSync(output,{recursive:true,mode:0o700});
  await backup(openDatabase(config),join(output,"life-os.sqlite"));
  const snapshot=new DatabaseSync(join(output,"life-os.sqlite"));
  try {
    if(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='runtime_owner'").get()) snapshot.exec("DELETE FROM runtime_owner");
    snapshot.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE");
  } finally {snapshot.close();}
  chmodSync(join(output,"life-os.sqlite"),0o600);
  // Credentials are included only in this private backup, never in release artifacts.
  for (const name of ["config.json","google","drive","triage-log","jobs.json"]) {
    for (const file of files(config.home,name)) {
      const dest=join(output,file); mkdirSync(dirname(dest),{recursive:true,mode:0o700});
      copyFileSync(join(config.home,file),dest); chmodSync(dest,0o600);
    }
  }
  const checksums=Object.fromEntries(files(output).map(f=>[f,sha(join(output,f))]));
  const manifest={createdAt:new Date().toISOString(),schemaVersion:SCHEMA_VERSION,release:config.env.LIFE_OS_RELEASE_SHA??"development",checksums};
  writeAtomic(join(output,"manifest.json"),JSON.stringify(manifest,null,2));
  verifyBackup(output);
  return {output,...manifest};
}

export function verifyBackup(directory:string) {
  const root=resolve(directory);
  const manifest=JSON.parse(readFileSync(join(root,"manifest.json"),"utf8"));
  if (!manifest.checksums?.["life-os.sqlite"] || manifest.schemaVersion>SCHEMA_VERSION) throw new Error("Unsupported/incomplete backup manifest");
  for (const [file,hash] of Object.entries(manifest.checksums)) {
    const path=resolve(root,file);
    if (relative(root,path).startsWith("..") || path===root || lstatSync(path).isSymbolicLink() || sha(path)!==hash) throw new Error(`Backup checksum/path mismatch: ${file}`);
  }
  const db=new DatabaseSync(join(root,"life-os.sqlite"),{readOnly:true});
  try {
    if (db.prepare("PRAGMA integrity_check").get()!.integrity_check!=="ok" || db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Backup database integrity check failed");
  } finally {db.close();}
  return {ok:true,createdAt:manifest.createdAt,schemaVersion:manifest.schemaVersion};
}
