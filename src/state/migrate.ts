import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { LifeOsConfig } from "../core/config.js";
import { openDatabase, transaction, SCHEMA_VERSION } from "./database.js";
import { TrackStore } from "../toolsets/track/store.js";

const date = z.string().refine(v => Number.isFinite(Date.parse(v)), "Invalid date");
const base = z.object({ id: z.string().min(1), created_at: date }).passthrough();
const product = base.extend({ name: z.string().min(1) });
const project = product.extend({ productId: z.string().optional() });
const task = base.extend({ title: z.string().min(1), projectId: z.string().optional(), status: z.enum(["open", "done"]), notes: z.string().optional() });
const registrySchema = z.object({ products:z.array(product), projects:z.array(project), tasks:z.array(task), nextTaskNum:z.number().int().positive(), weeklyTargetHours:z.number().nonnegative() }).passthrough();
const entrySchema = z.object({ id:z.string().min(1), taskId:z.string().min(1), start:date, end:date, seconds:z.number().nonnegative(), note:z.string().optional() }).passthrough().refine(e => Date.parse(e.end) >= Date.parse(e.start) && Math.abs(e.seconds - Math.round((Date.parse(e.end)-Date.parse(e.start))/1000)) <= 1, "Entry duration differs from its timestamps");
const timerSchema = z.object({ taskId:z.string().min(1), start:date, note:z.string().optional() }).passthrough();

/** Explicit, one-time legacy import. Parse everything before opening or modifying the destination. */
export function migrateDatabase(config: LifeOsConfig) {
  const names = ["registry.json", "entries.jsonl", "timer.json"];
  const sources = names.filter(n => existsSync(join(config.trackDir,n))).map(name => ({name, text:readFileSync(join(config.trackDir,name),"utf8")}));
  const regSource = sources.find(s => s.name === "registry.json");
  if (sources.length && !regSource) throw new Error("Legacy entries/timer exist without registry.json; import stopped.");
  const registry = regSource ? registrySchema.parse(JSON.parse(regSource.text)) : null;
  const entries = (sources.find(s => s.name === "entries.jsonl")?.text ?? "").split("\n").flatMap((line,i) => {
    if (!line.trim()) return [];
    try { return [entrySchema.parse(JSON.parse(line))]; }
    catch { throw new Error(`Invalid entries.jsonl record at line ${i+1}; nothing imported.`); }
  });
  const timerSource = sources.find(s => s.name === "timer.json");
  const timer = timerSource ? timerSchema.nullable().parse(JSON.parse(timerSource.text)) : null;
  for (const items of [registry?.products ?? [],registry?.projects ?? [],registry?.tasks ?? [],entries]) {
    if (new Set(items.map(i=>i.id)).size !== items.length) throw new Error("Duplicate IDs in legacy data; import stopped.");
  }
  if (registry && registry.tasks.some(t=> /^t\d+$/.test(t.id) && Number(t.id.slice(1)) >= registry.nextTaskNum)) throw new Error("Legacy task counter would reuse an existing task ID.");
  if (registry) {
    const products=new Set(registry.products.map(p=>p.id)),projects=new Set(registry.projects.map(p=>p.id)),tasks=new Set(registry.tasks.map(t=>t.id));
    if(registry.projects.some(p=>p.productId&&!products.has(p.productId)) || registry.tasks.some(t=>t.projectId&&!projects.has(t.projectId)) || entries.some(e=>!tasks.has(e.taskId)) || (timer&&!tasks.has(timer.taskId))) throw new Error("Legacy data has broken references; nothing imported.");
  }
  const fingerprints = Object.fromEntries(sources.map(s=>[s.name,createHash("sha256").update(s.text).digest("hex")]));
  const db = openDatabase(config, true);
  return transaction(db, () => {
    const imported = db.prepare("SELECT value FROM settings WHERE key='legacyImport'").get();
    if (imported) {
      const previous = JSON.parse(String(imported.value));
      // Restored SQLite backups retain this import manifest, but intentionally
      // omit the legacy tracker files. Their absence does not request a reimport.
      // If any source remains, require the complete original fingerprint set.
      if (sources.length && JSON.stringify(previous.sources) !== JSON.stringify(fingerprints)) throw new Error("Legacy source changed since import; refusing an ambiguous repeat import.");
      return { ...previous, alreadyImported:true };
    }
    if (!registry) return {schemaVersion:SCHEMA_VERSION, imported:false};
    if (Number(db.prepare("SELECT count(*) AS n FROM tasks").get()!.n) || Number(db.prepare("SELECT count(*) AS n FROM products").get()!.n) || Number(db.prepare("SELECT count(*) AS n FROM projects").get()!.n)) throw new Error("Destination tracker is not empty; import stopped.");
    const store = new TrackStore(config);
    store.saveRegistry(registry);
    for (const e of entries) db.prepare("INSERT INTO entries VALUES(?,?,?,?)").run(e.id,e.taskId,e.start,JSON.stringify(e));
    if (timer) db.prepare("INSERT INTO active_timer VALUES(1,?,?)").run(timer.taskId,JSON.stringify(timer));
    const manifest = { schemaVersion:SCHEMA_VERSION, importedAt:new Date().toISOString(), sources:fingerprints,
      counts:{products:registry.products.length,projects:registry.projects.length,tasks:registry.tasks.length,entries:entries.length},
      totalSeconds:entries.reduce((n,e)=>n+e.seconds,0), activeTimer:timer };
    if (JSON.stringify(store.loadRegistry()) !== JSON.stringify({products:registry.products,projects:registry.projects,tasks:registry.tasks,nextTaskNum:registry.nextTaskNum,weeklyTargetHours:registry.weeklyTargetHours})) throw new Error("Registry verification failed");
    db.prepare("INSERT INTO settings VALUES('legacyImport',?)").run(JSON.stringify(manifest));
    return manifest;
  });
}
