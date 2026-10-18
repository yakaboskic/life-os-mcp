import { describe,it,expect } from "vitest";
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/core/config.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { transaction,openDatabase } from "../../src/state/database.js";
import { migrateDatabase } from "../../src/state/migrate.js";
import { createBackup,verifyBackup } from "../../src/state/backup.js";
const config=()=>loadConfig({LIFE_OS_HOME:mkdtempSync(join(tmpdir(),"lifeos-state-"))});
const legacy={products:[],projects:[],tasks:[{id:"t7",title:"Preserve me",created_at:"2026-01-01T00:00:00Z",status:"open"}],nextTaskNum:8,weeklyTargetHours:30};
describe("authoritative SQLite state",()=>{
  it("imports only explicitly, preserves sources, counters, timestamps and timer",()=>{
    const c=config();mkdirSync(c.trackDir);const source=JSON.stringify(legacy);writeFileSync(join(c.trackDir,"registry.json"),source);
    writeFileSync(join(c.trackDir,"timer.json"),JSON.stringify({taskId:"t7",start:"2026-10-18T11:00:00Z"}));
    expect(()=>new TrackStore(c)).toThrow("db migrate");
    const result=migrateDatabase(c);expect(result).toHaveProperty("counts.tasks",1);
    const store=new TrackStore(c);expect(store.addTask({title:"Next"}).id).toBe("t8");expect(store.getTimer()?.taskId).toBe("t7");
    expect(readFileSync(join(c.trackDir,"registry.json"),"utf8")).toBe(source);
    expect(migrateDatabase(c)).toHaveProperty("alreadyImported",true);
    writeFileSync(join(c.trackDir,"registry.json"),JSON.stringify({...legacy,nextTaskNum:9}));
    expect(()=>migrateDatabase(c)).toThrow("ambiguous");
  });
  it("refuses corrupt lines and dangling references before creating a database",()=>{
    const c=config();mkdirSync(c.trackDir);writeFileSync(join(c.trackDir,"registry.json"),JSON.stringify(legacy));
    writeFileSync(join(c.trackDir,"entries.jsonl"),"not-json\n");expect(()=>migrateDatabase(c)).toThrow("line 1");expect(existsSync(join(c.home,"life-os.sqlite"))).toBe(false);
    writeFileSync(join(c.trackDir,"entries.jsonl"),JSON.stringify({id:"e1",taskId:"unknown",start:"2026-01-01T00:00:00Z",end:"2026-01-01T00:01:00Z",seconds:60}));
    expect(()=>migrateDatabase(c)).toThrow("broken references");
  });
  it("rolls back nested task/timer changes together",()=>{
    const c=config(),a=new TrackStore(c),b=new TrackStore(c);a.addTask({title:"First"});a.startTimer("t1");
    expect(()=>transaction(openDatabase(c),()=>{b.addTask({title:"Second"});b.startTimer("t2");throw new Error("fail");})).toThrow("fail");
    expect(a.getTimer()?.taskId).toBe("t1");expect(a.readEntries()).toHaveLength(0);expect(a.addTask({title:"Next"}).id).toBe("t2");
  });
  it("creates a consistent verified backup and detects tampering",async()=>{
    const c=config(),store=new TrackStore(c);store.addTask({title:"Backup me"});store.logEntry({task:"t1",durationMinutes:15});
    const output=join(mkdtempSync(join(tmpdir(),"lifeos-backup-")),"snapshot");await createBackup(c,output);
    expect(verifyBackup(output).ok).toBe(true);const restored=new TrackStore(loadConfig({LIFE_OS_HOME:output}));expect(restored.readEntries()[0]?.seconds).toBe(900);
    writeFileSync(join(output,"life-os.sqlite"),"corrupt");expect(()=>verifyBackup(output)).toThrow("checksum");
  });
  it("migrates a restored imported backup without legacy files while preserving live state",async()=>{
    const c=config();mkdirSync(c.trackDir);
    const registry={...legacy,
      products:[{id:"product",name:"Product",created_at:"2026-01-01T00:00:00Z"}],
      projects:[{id:"project",name:"Project",productId:"product",created_at:"2026-01-01T00:00:00Z"}],
      tasks:[{...legacy.tasks[0]!,projectId:"project"}],
    };
    const entry={id:"legacy-entry",taskId:"t7",start:"2026-01-01T00:00:00Z",end:"2026-01-01T00:10:00Z",seconds:600};
    const timer={taskId:"t7",start:"2026-10-18T11:00:00Z"};
    writeFileSync(join(c.trackDir,"registry.json"),JSON.stringify(registry));
    writeFileSync(join(c.trackDir,"entries.jsonl"),JSON.stringify(entry)+"\n");
    writeFileSync(join(c.trackDir,"timer.json"),JSON.stringify(timer));
    const imported=migrateDatabase(c);
    const live=new TrackStore(c);live.addTask({title:"Created after import",project:"project"});
    const before=live.loadRegistry();
    const output=join(mkdtempSync(join(tmpdir(),"lifeos-import-backup-")),"snapshot");
    await createBackup(c,output);expect(verifyBackup(output).ok).toBe(true);
    const restoredConfig=loadConfig({LIFE_OS_HOME:output,LIFE_OS_ACCESS_MODE:"migrate"});
    expect(existsSync(join(restoredConfig.trackDir,"registry.json"))).toBe(false);
    writeFileSync(join(output,".vm-authoritative"),"");
    expect(migrateDatabase(restoredConfig)).toEqual({...imported,alreadyImported:true});
    const restored=new TrackStore(restoredConfig);
    expect(restored.loadRegistry()).toEqual(before);
    expect(restored.readEntries()).toEqual([entry]);
    expect(restored.getTimer()).toEqual(timer);
    expect(migrateDatabase(restoredConfig)).toHaveProperty("counts",{products:1,projects:1,tasks:1,entries:1});
    expect(restored.loadRegistry().tasks).toHaveLength(2);
    expect(restored.addTask({title:"After restore"}).id).toBe("t9");

    // A partial reappearance of legacy sources still fails the fingerprint gate.
    mkdirSync(restoredConfig.trackDir);
    writeFileSync(join(restoredConfig.trackDir,"registry.json"),JSON.stringify(registry));
    expect(()=>migrateDatabase(restoredConfig)).toThrow("ambiguous repeat import");
    expect(restored.loadRegistry().tasks).toHaveLength(3);
  });

});
