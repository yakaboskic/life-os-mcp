import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { closeDatabase, openDatabase } from "../../src/state/database.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { createJobService } from "../../src/jobs/service.js";
import { JobStore } from "../../src/jobs/store.js";
import { CLAUDE_REVIEW_POLICY, UNCERTAIN_LABEL } from "../../src/jobs/policy.js";
import { CATEGORIES, type Category, type Decision, type MailGateway, type MailMessage, type MailThread, type MutationPlan, type AgentReviewProposal } from "../../src/jobs/types.js";
const account="owner@example.com", logger={info(){},warn(){},error(){},debug(){}};
const labels=Object.fromEntries([...CATEGORIES,"ACTION/DONE",UNCERTAIN_LABEL].map(name=>[name,`Label_${name}`]));
const configs:ReturnType<typeof loadConfig>[]=[];
function message(id:string, overrides:Partial<MailMessage>={}):MailMessage { return {id,internalDate:1000,labels:["INBOX","UNREAD","STARRED","Label_personal"],from:"Sender <sender@example.com>",to:account,subject:`Request ${id}`,body:"Please review this proposal today.",truncated:false,attachments:false,...overrides}; }
class Mail implements MailGateway {
  data=new Map<string,MailThread>(); mutations:MutationPlan[]=[]; creates=0; reads=0; lists=0; accountsList=[account];
  beforeRead?:()=>void|Promise<void>; duringWrite?:()=>void; failWrite?:"before"|"after"; failPostRead=false;
  accounts(){return this.accountsList;} async verify(){} async labels(_account:string,create:boolean){if(create)this.creates++;return labels;}
  async listThreads(_account:string,query:string){this.lists++;return query.startsWith("in:inbox")?[...this.data.values()].filter(t=>t.messages.some(m=>m.labels.includes("INBOX"))).map(t=>t.id):[];}
  async thread(_account:string,id:string){this.reads++;await this.beforeRead?.();if(this.failPostRead&&this.mutations.length){this.failPostRead=false;throw Error("Synthetic read failed");}return structuredClone(this.data.get(id)!);}
  async modify(_account:string,plan:MutationPlan){this.mutations.push(structuredClone(plan));this.duringWrite?.();const fail=this.failWrite;this.failWrite=undefined;if(fail==="before")throw Error("Synthetic connection failed");for(const t of this.data.values())for(const m of t.messages)if(plan.ids.includes(m.id))m.labels=[...new Set([...m.labels.filter(label=>!plan.remove.includes(label)),...plan.add])];if(fail==="after")throw Error("Synthetic response lost");}
  add(id="a", messages=[message("m1")]){this.data.set(id,{id,messages});}
}
function fixture(){
  const config=loadConfig({LIFE_OS_HOME:mkdtempSync(join(tmpdir(),"lifeos-uncertain-")),LIFE_OS_TRIAGE_APPLY_ENABLED:"true"});configs.push(config);
  const mail=new Mail();let calls=0, confidence=.4,clock=Date.parse("2026-11-01T12:00:00Z");
  const deps={gateway:mail,now:()=>new Date(clock),classifier:{classify:async():Promise<Decision>=>{calls++;return {category:"NEWSLETTER",confidence,model:"jev-1.13.0",probabilities:Object.fromEntries(CATEGORIES.map(c=>[c,c==="NEWSLETTER"?1:0])) as Decision["probabilities"]};}}};
  let jobs=createJobService(config,logger,deps);const store=new JobStore(openDatabase(config));
  return {config,mail,store,get jobs(){return jobs;},calls:()=>calls,advanceTime(){clock+=60_000;},setConfidence(value:number){confidence=value;},restart(){jobs=createJobService(config,logger,deps);},async held(overrides:Partial<MailMessage>={}){mail.add("a",[message("m1",overrides)]);await jobs.start({mode:"apply"});mail.reads=0;mail.lists=0;mail.creates=0;return jobs.reviews()[0]!;}};
}
afterEach(()=>{for(const config of configs.splice(0)){closeDatabase(config);rmSync(config.home,{recursive:true,force:true});}});
const signal=()=>new AbortController().signal;
async function proposal(f:ReturnType<typeof fixture>,id:string, additions:Partial<AgentReviewProposal>={}):Promise<AgentReviewProposal>{const context=await f.jobs.reviewContext!(id,signal());return {itemId:id,revision:context.revision,policyVersion:context.policyVersion,category:"ACTION/SOON",clear:false,confidence:.2,needsMoreContext:false,reason:"Best-fitting personal request",evidence:[{messageId:"m1",quote:"Please review this proposal today."}],...additions};}

describe("durable Uncertain filing",()=>{
  it("archives captured mail while preserving review eligibility, read state, stars and unrelated labels",async()=>{
    const f=fixture(),item=await f.held(),before=f.store.work(item.id)!;
    expect(item.uncertainFiling).toEqual({state:"pending",label:"Uncertain"});
    const lastSuccess=f.jobs.history(1)[0]!.accounts[0]!.lastSucceededAt;f.advanceTime();
    expect(await f.jobs.fileUncertain!([item.id])).toEqual({filed:1,failed:0});
    expect(f.jobs.history(1)[0]!.accounts[0]!.lastSucceededAt).toBe(lastSuccess);expect(f.jobs.history(1)[0]!.scheduled).toBe(false);
    expect(readFileSync(join(f.config.triageLogDir,"email.md"),"utf8")).toContain("Operation: Uncertain filing");
    const current=f.mail.data.get("a")!.messages[0]!;expect(current.labels).toEqual(expect.arrayContaining([labels.Uncertain,"UNREAD","STARRED","Label_personal"]));expect(current.labels).not.toContain("INBOX");
    const after=f.store.work(item.id)!;expect(after.revision).toBe(before.revision);expect(after.labelRevision).not.toBe(before.labelRevision);expect(after.decision).toEqual(before.decision);expect(after.reason).toBe("LOW_CONFIDENCE");
    expect(f.jobs.reviews()[0]).toMatchObject({reviewable:true,uncertainFiling:{state:"filed",label:"Uncertain"}});
    expect((await f.jobs.reviewContext!(item.id,signal())).policyVersion).toBe(CLAUDE_REVIEW_POLICY);expect(f.calls()).toBe(1);expect(f.mail.lists).toBe(0);
    expect(new TrackStore(f.config).loadRegistry().tasks).toHaveLength(0);
    expect(openDatabase(f.config).prepare("SELECT count(*) AS n FROM triage_mutation_attempts").get()!.n).toBe(0);
    await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations).toHaveLength(1);
    await f.jobs.acceptAgentReview!(await proposal(f,item.id),"claude-sonnet-5-5",signal());await f.jobs.applyReviewed!([item.id]);
    expect(f.mail.mutations).toHaveLength(2);expect(current.labels).toContain(labels["ACTION/SOON"]);expect(current.labels).not.toContain(labels.Uncertain);expect(current.labels).toContain("UNREAD");expect(new TrackStore(f.config).loadRegistry().tasks).toHaveLength(1);
  });
  it("parks incomplete-context mail without a model call or granting classification eligibility",async()=>{
    const f=fixture(),item=await f.held({body:"",truncated:true});expect(f.calls()).toBe(0);
    expect(await f.jobs.fileUncertain!([item.id])).toEqual({filed:1,failed:0});
    expect(f.jobs.reviews()[0]).toMatchObject({reason:"INSUFFICIENT_OR_TRUNCATED_CONTEXT",reviewable:false,uncertainFiling:{state:"filed"}});
    await expect(f.jobs.reviewContext!(item.id,signal())).rejects.toThrow("REVIEW_NOT_ELIGIBLE");expect(f.calls()).toBe(0);
  });
  it("blocks changed labels or newly arrived mail before the final captured-message write",async()=>{
    const f=fixture(),item=await f.held(),before=f.store.work(item.id)!.labelRevision;
    f.mail.beforeRead=()=>{if(f.mail.reads===2)f.mail.data.get("a")!.messages.push(message("m2",{internalDate:2000}));};
    expect(await f.jobs.fileUncertain!([item.id])).toEqual({filed:0,failed:1});expect(f.mail.mutations).toHaveLength(0);
    expect(f.store.work(item.id)!.labelRevision).toBe(before);expect(f.jobs.reviews()[0]?.uncertainFiling).toMatchObject({state:"blocked",reason:"UNCERTAIN_EVIDENCE_CHANGED"});
    const reads=f.mail.reads;await f.jobs.fileUncertain!([item.id]);expect(f.mail.reads).toBe(reads);
  });
  it("never archives new arrivals during a write or adopts their state as the original review evidence",async()=>{
    const f=fixture(),item=await f.held(),before=f.store.work(item.id)!.labelRevision;
    f.mail.duringWrite=()=>f.mail.data.get("a")!.messages.push(message("m2",{internalDate:2000}));
    await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations[0]?.ids).toEqual(["m1"]);
    expect(f.mail.data.get("a")!.messages[1]!.labels).toContain("INBOX");expect(f.store.work(item.id)!.labelRevision).toBe(before);
    expect(f.jobs.reviews()[0]).toMatchObject({reviewable:false,uncertainFiling:{state:"blocked",reason:"UNCERTAIN_PARKING_REQUIRES_RECONCILIATION"}});
  });
  it("does not absorb an unrelated message label edit during the write",async()=>{
    const f=fixture();f.mail.add("a",[message("m1"),message("sent",{labels:["SENT"],internalDate:900})]);await f.jobs.start({mode:"apply"});const item=f.jobs.reviews()[0]!;
    f.mail.duringWrite=()=>f.mail.data.get("a")!.messages[1]!.labels.push("STARRED");await f.jobs.fileUncertain!([item.id]);
    expect(f.jobs.reviews()[0]?.uncertainFiling?.state).toBe("blocked");expect(f.mail.data.get("a")!.messages[1]!.labels).toContain("STARRED");
  });
  it.each(["before","after"] as const)("reconciles an ambiguous %s write once across restart without retrying the mutation",async fail=>{
    const f=fixture(),item=await f.held();f.mail.failWrite=fail;await f.jobs.fileUncertain!([item.id]);
    expect(f.jobs.reviews()[0]).toMatchObject({reviewable:false,uncertainFiling:{state:"pending",reason:"UNCERTAIN_PARKING_PENDING_RECONCILIATION"}});
    await expect(f.jobs.reviewContext!(item.id,signal())).rejects.toThrow("REVIEW_NOT_ELIGIBLE");expect(()=>f.jobs.resolve(item.id,"NEWSLETTER")).toThrow("REVIEW_UNCERTAIN_MUTATION");
    f.restart();await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations).toHaveLength(1);
    expect(f.jobs.reviews()[0]).toMatchObject({reviewable:fail==="after",uncertainFiling:{state:fail==="after"?"filed":"blocked"}});
    await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations).toHaveLength(1);
  });
  it("recovers acknowledgement before the postcondition checkpoint without another write",async()=>{
    const f=fixture(),item=await f.held();f.mail.failPostRead=true;await f.jobs.fileUncertain!([item.id]);
    expect(f.store.uncertainFiling(item.id)).toMatchObject({state:"pending",acknowledged:true});f.restart();
    expect(await f.jobs.fileUncertain!([item.id])).toEqual({filed:1,failed:0});expect(f.mail.mutations).toHaveLength(1);
  });
  it("lets a queued human intent win even when it arrives during the final Gmail read",async()=>{
    const f=fixture(),item=await f.held(),db=openDatabase(f.config);db.exec("CREATE TABLE automation_human_review_intents(item_id TEXT PRIMARY KEY, command_id TEXT NOT NULL)");
    f.mail.beforeRead=()=>{if(f.mail.reads===2)db.prepare("INSERT INTO automation_human_review_intents VALUES(?,?)").run(item.id,"human-command");};
    await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations).toHaveLength(0);expect(f.store.uncertainFiling(item.id)?.attemptedAt).toBeUndefined();expect(f.jobs.reviews()[0]?.reviewable).toBe(true);
  });
  it("blocks an obsolete held snapshot when newer work already classified its thread",async()=>{
    const f=fixture(),item=await f.held();f.mail.data.get("a")!.messages.push(message("m2",{internalDate:2000}));f.setConfidence(.99);await f.jobs.start({mode:"apply"});const count=f.mail.mutations.length;
    await f.jobs.fileUncertain!([item.id]);expect(f.mail.mutations).toHaveLength(count);expect(f.jobs.reviews()[0]?.uncertainFiling).toMatchObject({state:"blocked",reason:"UNCERTAIN_REVIEW_SUPERSEDED"});
  });
  it("does not create labels for dry-run, unknown or unconfigured work and bounds selected IDs",async()=>{
    const f=fixture();f.mail.add();await f.jobs.start({mode:"dry-run"});const shadow=f.jobs.reviews()[0]!;expect(f.mail.creates).toBe(0);
    expect(await f.jobs.fileUncertain!([shadow.id,"unknown"])).toEqual({filed:0,failed:2});expect(f.mail.creates).toBe(0);expect(f.mail.mutations).toHaveLength(0);
    await f.jobs.start({mode:"apply"});const item=f.jobs.reviews().find(i=>i.mode==="apply")!;f.mail.accountsList=[];f.mail.creates=0;
    expect(await f.jobs.fileUncertain!([item.id])).toEqual({filed:0,failed:1});expect(f.mail.creates).toBe(0);
    await expect(f.jobs.fileUncertain!(Array.from({length:101},(_,i)=>String(i)))).rejects.toThrow("INVALID_UNCERTAIN_IDS");
  });
  it("does not coalesce a scheduled triage request into an active parking batch",async()=>{
    const f=fixture(),item=await f.held();let release!:()=>void, entered!:()=>void;const started=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
    f.mail.beforeRead=async()=>{entered();await gate;};const parking=f.jobs.fileUncertain!([item.id]);await started;
    await expect(f.jobs.start({mode:"apply",scheduled:true})).rejects.toThrow("JOB_ALREADY_RUNNING");
    release();await parking;f.mail.beforeRead=undefined;f.mail.add("new",[message("new-message",{internalDate:2000})]);
    const daily=await f.jobs.start({mode:"apply",scheduled:true});expect(daily.scheduled).toBe(true);expect(daily.uncertainIds).toBeUndefined();expect(f.jobs.reviews().some(i=>i.threadId==="new")).toBe(true);expect(f.mail.lists).toBeGreaterThan(0);
  });
  it("respects manual removal of Uncertain before a later final classification",async()=>{
    const f=fixture(),item=await f.held();await f.jobs.fileUncertain!([item.id]);f.mail.data.get("a")!.messages[0]!.labels=f.mail.data.get("a")!.messages[0]!.labels.filter(label=>label!==labels.Uncertain);
    await expect(f.jobs.reviewContext!(item.id,signal())).rejects.toThrow("REVIEW_EVIDENCE_CHANGED");expect(f.mail.mutations).toHaveLength(1);
  });
});

describe("best-fit agent acceptance",()=>{
  it.each([0,.4,.94])("accepts grounded best-fit confidence %s without requiring clear=true or Jev's gate",async confidence=>{
    const f=fixture(),item=await f.held();const value=await proposal(f,item.id,{confidence});expect(value.policyVersion).toBe("best-fit-v2");
    await f.jobs.acceptAgentReview!(value,"claude-sonnet-5-5",signal());await f.jobs.applyReviewed!([item.id]);expect(f.mail.mutations).toHaveLength(1);expect(f.store.work(item.id)?.decision?.confidence).toBe(confidence);
  });
  it.each([{confidence:-.1},{confidence:NaN},{confidence:1.1},{needsMoreContext:true},{category:null},{policyVersion:"lifeos-review-v1"}])("rejects invalid or unresolved proposal %j",async change=>{
    const f=fixture(),item=await f.held();await expect(f.jobs.acceptAgentReview!(await proposal(f,item.id,change),"claude-sonnet-5-5",signal())).rejects.toThrow("REVIEW_NOT_CLEAR");expect(f.mail.mutations).toHaveLength(0);
  });
});
