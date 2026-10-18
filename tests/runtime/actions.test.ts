import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type LifeOsConfig } from "../../src/core/config.js";
import { closeDatabase } from "../../src/state/database.js";
import { TrackerActions, entityRevision } from "../../src/runtime/actions.js";
import { TrackStore } from "../../src/toolsets/track/store.js";

const configs: LifeOsConfig[] = [];
function fixture() {
  const config=loadConfig({LIFE_OS_HOME:mkdtempSync(join(tmpdir(),"lifeos-actions-"))});configs.push(config);
  const actions=new TrackerActions(config),agent=new TrackStore(config);
  let n=0;
  const run=(action:string,input:object,requestId=`request-${++n}`)=>actions.execute({requestId,action,input},"web:owner@example.com");
  return {config,actions,agent,run};
}
afterEach(()=>{vi.useRealTimers();for(const c of configs.splice(0)){closeDatabase(c);rmSync(c.home,{recursive:true,force:true});}});

describe("shared tracker actions",()=>{
  it("creates a project with an exact product link and durable actor-bound idempotency",()=>{
    const {config,actions,agent,run}=fixture();
    const product=agent.addProduct({name:"Synthetic product"});
    const input={name:"  Mission café  ",productId:product.id,goal:"Ship a working demo",notes:"First note\nSecond note"};
    const first=run("project.create",input,"create-project-1");
    expect(first.result).toMatchObject({name:"Mission café",productId:product.id,goal:input.goal,notes:input.notes,id:expect.any(String),created_at:expect.any(String)});
    expect(run("project.create",{...input,name:"Mission café"},"create-project-1")).toEqual(first);
    expect(()=>run("project.create",{...input,name:"Different"},"create-project-1")).toThrow(expect.objectContaining({status:409,code:"REQUEST_CONFLICT"}));
    expect(()=>actions.execute({requestId:"create-project-1",action:"project.create",input},"agent:interactive")).toThrow(expect.objectContaining({status:409,code:"REQUEST_CONFLICT"}));
    expect(agent.loadRegistry().projects).toHaveLength(1);
    closeDatabase(config);
    const restarted=new TrackerActions(config);
    expect(restarted.execute({requestId:"create-project-1",action:"project.create",input},"web:owner@example.com")).toEqual(first);
    expect(restarted.store.loadRegistry().projects).toHaveLength(1);
    expect(restarted.store.db.prepare("SELECT actor FROM action_receipts WHERE request_id=?").get("create-project-1")?.actor).toBe("web:owner@example.com");
  });
  it("creates an unassigned project without inventing a status and accepts bounded optional fields",()=>{
    const {agent,run}=fixture();
    const name="n".repeat(200),goal="g".repeat(2_000),notes="x".repeat(20_000);
    run("project.create",{name,goal,notes});
    const [project]=agent.loadRegistry().projects;
    expect(project).toMatchObject({name,goal,notes});
    expect(project?.productId).toBeUndefined();expect(project?.status).toBeUndefined();
  });
  it("rejects duplicate project names across clients and product groups without recording a receipt",()=>{
    const {actions,agent,run}=fixture();
    const product=agent.addProduct({name:"Other product"});
    agent.addProject({name:"  Existing Project  "});
    const before=agent.loadRegistry();
    for(const name of ["existing project","EXISTING PROJECT"," Existing Project "]) {
      expect(()=>run("project.create",{name,productId:product.id})).toThrow(expect.objectContaining({status:409,code:"PROJECT_EXISTS"}));
    }
    expect(agent.loadRegistry()).toEqual(before);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
  });
  it("requires an exact product ID and lets a corrected request reuse its failed request ID",()=>{
    const {actions,agent,run}=fixture();
    const product=agent.addProduct({name:"Research and Development"});
    for(const productId of ["missing",product.name,product.id.toUpperCase(),"research"]) {
      expect(()=>run("project.create",{name:"Research project",productId},"invalid-product-1")).toThrow(expect.objectContaining({status:404,code:"PRODUCT_MISSING"}));
    }
    expect(agent.loadRegistry().projects).toEqual([]);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
    run("project.create",{name:"Research project",productId:product.id},"invalid-product-1");
    expect(agent.loadRegistry().projects).toMatchObject([{name:"Research project",productId:product.id}]);
  });
  it("rejects invalid project fields without creating a project or receipt",()=>{
    const {actions,agent,run}=fixture();const before=agent.loadRegistry();
    for(const input of [
      {},{name:"  "},{name:"n".repeat(201)},{name:42},
      {name:"Project",goal:"g".repeat(2_001)},{name:"Project",notes:"n".repeat(20_001)},
      {name:"Project",productId:""},{name:"Project",productId:null},{name:"Project",productId:"i".repeat(201)},
      {name:"Project",description:"Unsupported"},{name:"Project",status:"active"},{name:"Project",id:"caller-id"},
    ]) expect(()=>run("project.create",input)).toThrow(expect.objectContaining({status:400,code:"INVALID_ACTION"}));
    expect(agent.loadRegistry()).toEqual(before);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
  });
  it("rolls back project creation and receipt together if storage fails after the insert",()=>{
    const {actions,agent,run}=fixture();const before=agent.loadRegistry();
    const create=actions.store.addProject.bind(actions.store);
    const failure=vi.spyOn(actions.store,"addProject").mockImplementation((...args)=>{create(...args);throw new Error("Storage failed after project insert");});
    expect(()=>run("project.create",{name:"Retry project"},"rollback-project-1")).toThrow("Storage failed");
    expect(agent.loadRegistry()).toEqual(before);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
    failure.mockRestore();
    run("project.create",{name:"Retry project"},"rollback-project-1");
    expect(agent.loadRegistry().projects).toMatchObject([{id:"retry-project",name:"Retry project"}]);
  });
  it("persists receipts across clients and restarts without duplicating writes",()=>{
    const {config,actions,agent,run}=fixture();
    const first=run("task.create",{title:"  First task  "},"create-task-1");
    expect(run("task.create",{title:"First task"},"create-task-1")).toEqual(first);
    expect(agent.loadRegistry().tasks).toHaveLength(1);
    expect(()=>run("task.create",{title:"Another task"},"create-task-1")).toThrow("already used");
    closeDatabase(config);
    const restarted=new TrackerActions(config);
    expect(restarted.execute({requestId:"create-task-1",action:"task.create",input:{title:"First task"}},"web:owner@example.com")).toEqual(first);
    expect(restarted.store.loadRegistry().tasks).toHaveLength(1);
  });
  it("an old tab cannot stop or replace an agent's newer timer, even within the same millisecond",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-18T14:00:00Z"));
    const {agent,run}=fixture();
    const task=agent.addTask({title:"Focus"});
    run("timer.start",{taskId:task.id,expectedTimerRevision:null});
    const old=entityRevision(agent.getTimer());
    agent.cancelTimer();agent.startTimer(task.id);
    expect(entityRevision(agent.getTimer())).not.toBe(old);
    expect(()=>run("timer.stop",{expectedTimerRevision:old})).toThrow("timer changed");
    expect(()=>run("timer.start",{taskId:task.id,expectedTimerRevision:null})).toThrow("timer changed");
    expect(agent.readEntries()).toHaveLength(0);
    const expectedTimerRevision=entityRevision(agent.getTimer());
    run("timer.stop",{expectedTimerRevision},"stop-once-1");
    run("timer.stop",{expectedTimerRevision},"stop-once-1");
    expect(agent.readEntries()).toHaveLength(1);
  });
  it("creates a project task and switches focus exactly once across retries and restarts",()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-18T14:00:00Z"));
    const {config,agent,run}=fixture();
    const project=agent.addProject({name:"Launch"});
    const previous=agent.addTask({title:"Previous task"});agent.startTimer(previous.id);
    vi.setSystemTime(new Date("2026-10-18T14:15:00Z"));
    const input={newTask:{title:"  Draft launch plan  ",projectId:project.id},note:"Plan the milestones",
      expectedTimerRevision:entityRevision(agent.getTimer())};
    const first=run("timer.start",input,"create-and-focus-1");
    const task=agent.loadRegistry().tasks.find(t=>t.title==="Draft launch plan")!;
    expect(task).toMatchObject({projectId:project.id,status:"open"});
    expect(agent.getTimer()).toMatchObject({taskId:task.id,note:input.note});
    expect(agent.readEntries()).toMatchObject([{taskId:previous.id,seconds:900}]);
    expect(run("timer.start",input,"create-and-focus-1")).toEqual(first);
    closeDatabase(config);
    const restarted=new TrackerActions(config);
    expect(restarted.execute({requestId:"create-and-focus-1",action:"timer.start",input},"web:owner@example.com")).toEqual(first);
    expect(restarted.store.loadRegistry().tasks).toHaveLength(2);
    expect(restarted.store.readEntries()).toHaveLength(1);
    expect(restarted.store.getTimer()?.taskId).toBe(task.id);
  });
  it("creates an unassigned focus task when a project is omitted",()=>{
    const {agent,run}=fixture();
    run("timer.start",{newTask:{title:"Think through options"},expectedTimerRevision:null});
    const [task]=agent.loadRegistry().tasks;
    expect(task).toMatchObject({title:"Think through options",status:"open"});
    expect(task?.projectId).toBeUndefined();
    expect(agent.getTimer()?.taskId).toBe(task?.id);
  });
  it("does not create a task or stop focus for stale, ambiguous or invalid create-and-focus inputs",()=>{
    const {actions,agent,run}=fixture();
    const task=agent.addTask({title:"Active"});agent.startTimer(task.id);
    const before=agent.loadRegistry(),timer=agent.getTimer();
    const expectedTimerRevision=entityRevision(timer);
    expect(()=>run("timer.start",{newTask:{title:"Stale"},expectedTimerRevision:null})).toThrow("timer changed");
    expect(()=>run("timer.start",{newTask:{title:"Missing project",projectId:"missing"},expectedTimerRevision})).toThrow("project no longer exists");
    for(const input of [
      {newTask:{title:"  "},expectedTimerRevision},
      {newTask:{title:"x".repeat(501)},expectedTimerRevision},
      {newTask:{title:"Unexpected",notes:"Not a task editor"},expectedTimerRevision},
      {newTask:{title:"Ambiguous"},taskId:task.id,expectedTimerRevision},
      {expectedTimerRevision},
    ]) expect(()=>run("timer.start",input)).toThrow();
    expect(agent.loadRegistry()).toEqual(before);
    expect(agent.getTimer()).toEqual(timer);
    expect(agent.readEntries()).toHaveLength(0);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
  });
  it("rolls back the new task, timer switch and receipt if starting focus fails",()=>{
    const {actions,agent,run}=fixture();
    const previous=agent.addTask({title:"Active"});agent.startTimer(previous.id);
    const before=agent.loadRegistry(),timer=agent.getTimer();
    const start=actions.store.startTimer.bind(actions.store);
    const failure=vi.spyOn(actions.store,"startTimer").mockImplementation((...args)=>{
      start(...args);
      throw new Error("Storage failure after timer switch");
    });
    const input={newTask:{title:"Retry me"},expectedTimerRevision:entityRevision(timer)};
    expect(()=>run("timer.start",input,"rollback-focus-1")).toThrow("Storage failure");
    expect(agent.loadRegistry()).toEqual(before);
    expect(agent.getTimer()).toEqual(timer);
    expect(agent.readEntries()).toHaveLength(0);
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
    failure.mockRestore();
    run("timer.start",input,"rollback-focus-1");
    expect(agent.loadRegistry().tasks).toHaveLength(2);
    expect(agent.readEntries()).toHaveLength(1);
  });
  it("requires current task and timer versions for atomic stop and completion",()=>{
    const {agent,run}=fixture();
    const task=agent.addTask({title:"Finish this"});agent.startTimer(task.id);
    const expectedRevision=entityRevision(task);
    expect(()=>run("task.update",{taskId:task.id,expectedRevision,status:"done"})).toThrow("Stop and complete");
    expect(agent.getTimer()).not.toBeNull();expect(agent.resolveTask(task.id).status).toBe("open");
    run("task.update",{taskId:task.id,expectedRevision,status:"done",expectedTimerRevision:entityRevision(agent.getTimer())});
    expect(agent.getTimer()).toBeNull();expect(agent.readEntries()).toHaveLength(1);
    expect(agent.resolveTask(task.id).status).toBe("done");
    expect(()=>agent.startTimer(task.id)).toThrow("Reopen");
    expect(()=>run("task.update",{taskId:task.id,expectedRevision,title:"Outdated"})).toThrow("task changed");
  });
  it("MCP completion has the same atomic timer behavior and supports unlinking projects",()=>{
    const {agent,run}=fixture();
    const project=agent.addProject({name:"Project"});
    const task=agent.addTask({title:"Task",project:project.id});
    run("task.update",{taskId:task.id,expectedRevision:entityRevision(task),projectId:null});
    expect(agent.resolveTask(task.id).projectId).toBeUndefined();
    agent.startTimer(task.id);agent.updateTask(task.id,{status:"done"});
    expect(agent.getTimer()).toBeNull();expect(agent.readEntries()).toHaveLength(1);
  });
  it("validates strict bounded inputs and explicit-offset time, with no receipt on failure",()=>{
    const {actions,agent,run}=fixture();const task=agent.addTask({title:"Task"});
    expect(()=>run("task.create",{title:"  "})).toThrow();
    expect(()=>agent.updateTask(task.id,{title:" "})).toThrow("1 to 500");
    expect(()=>run("task.create",{title:"Task",shell:"rm"})).toThrow();
    expect(()=>run("time.log",{taskId:task.id,start:"2026-10-18T09:00",end:"2026-10-18T10:00"})).toThrow();
    expect(()=>run("time.log",{taskId:task.id,start:"2026-10-18T11:00:00Z",end:"2026-10-18T10:00:00Z"},"failed-time-1")).toThrow();
    expect(actions.store.db.prepare("SELECT COUNT(*) AS n FROM action_receipts").get()?.n).toBe(0);
    run("time.log",{taskId:task.id,start:"2026-10-18T09:00:00-04:00",end:"2026-10-18T10:00:00-04:00"},"failed-time-1");
    expect(agent.readEntries()[0]).toMatchObject({start:"2026-10-18T13:00:00.000Z",seconds:3600});
  });
  it("refuses to overwrite time edited by another client",()=>{
    const {agent,run}=fixture();const task=agent.addTask({title:"Task"});
    const {entry}=agent.logEntry({task:task.id,durationMinutes:30});
    const expectedRevision=entityRevision(entry);agent.updateEntry(entry.id,{note:"Agent correction"});
    expect(()=>run("time.update",{entryId:entry.id,expectedRevision,note:"Stale edit"})).toThrow("entry changed");
    expect(agent.readEntries()[0]?.note).toBe("Agent correction");
  });
});
