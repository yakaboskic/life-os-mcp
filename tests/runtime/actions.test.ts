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
