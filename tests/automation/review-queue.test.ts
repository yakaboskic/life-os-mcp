import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { closeDatabase, openDatabase } from "../../src/state/database.js";
import { TrackStore } from "../../src/toolsets/track/store.js";
import { createJobService } from "../../src/jobs/service.js";
import { JobStore } from "../../src/jobs/store.js";
import { CATEGORIES, type Category, type Decision, type MailGateway, type MailMessage, type MailThread, type MutationPlan, type ReviewItem } from "../../src/jobs/types.js";
import { createAutomationService } from "../../src/automation/service.js";
import { AutomationStore } from "../../src/automation/store.js";
import type { AutomationProvider, BriefDeliveryGateway } from "../../src/automation/types.js";
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const account = "owner@example.com", sender = "sender@example.com";
const labels = Object.fromEntries([...CATEGORIES, "ACTION/DONE"].map(name => [name, `Label_${name}`]));
const configs: ReturnType<typeof loadConfig>[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function decision(category: Category = "NEWSLETTER", confidence = 0.4): Decision { return { category,confidence,model:"jev-1.13.0",probabilities:Object.fromEntries(CATEGORIES.map(c => [c,c === category ? 1 : 0])) as Decision["probabilities"] }; }
class FakeMail implements MailGateway {
  data = new Map<string, MailThread>(); mutations: MutationPlan[] = []; accountList = [account];
  onRead?: (id:string) => void | Promise<void>; failWrite: "before"|"after"|undefined;
  accounts() { return this.accountList; }
  async verify() {}
  async labels() { return labels; }
  async listThreads(_account:string,query:string) { return query.startsWith("in:inbox") ? [...this.data.values()].filter(t => t.messages.some(m => m.labels.includes("INBOX"))).map(t => t.id) : []; }
  async thread(_account:string,id:string) { await this.onRead?.(id); return structuredClone(this.data.get(id)!); }
  async modify(_account:string,plan:MutationPlan) {
    this.mutations.push(structuredClone(plan)); const failure = this.failWrite; this.failWrite = undefined;
    if (failure === "before") throw Error("Socket disconnected");
    for (const t of this.data.values()) for (const m of t.messages) if (plan.ids.includes(m.id)) m.labels = [...new Set([...m.labels.filter(label => !plan.remove.includes(label)),...plan.add])];
    if (failure === "after") throw Error("Response lost");
  }
  add(id:string,overrides:Partial<MailMessage> = {}) {
    this.data.set(id,{id,messages:[{id:`message-${id}`,internalDate:1000,labels:["INBOX","UNREAD"],from:`Sender <${sender}>`,to:account,subject:`Proposal ${id}`,body:"Please review this proposal today.",truncated:false,attachments:false,...overrides}]});
  }
}
function fixture() {
  const config = loadConfig({ LIFE_OS_HOME:mkdtempSync(join(tmpdir(),"lifeos-human-review-")), LIFE_OS_TRIAGE_APPLY_ENABLED:"true" }); configs.push(config);
  const mail = new FakeMail(); let clock = new Date("2026-11-01T13:00:00Z"), reviewCalls = 0;
  const classifier = { classify:async () => decision() };
  const jobDeps = { gateway:mail,classifier,now:() => clock };
  const jobs = createJobService(config,logger,jobDeps), db = openDatabase(config), store = new JobStore(db);
  const provider:AutomationProvider = { model:"claude-sonnet-5-5",configured:() => true,review:async context => {
    reviewCalls++; return {value:{itemId:context.itemId,revision:context.revision,policyVersion:context.policyVersion,category:"ACTION/NOW",clear:true,confidence:0.99,needsMoreContext:false,reason:"Direct request",evidence:[{messageId:context.triggerIds[0]!,quote:"Please review this proposal today."}]},model:"claude-sonnet-5-5",inputTokens:50,outputTokens:50};
  },brief:async () => { throw Error("Unexpected brief"); } };
  const delivery:BriefDeliveryGateway = { prepare:() => "",send:async () => { throw Error("Unexpected send"); },reconcile:async () => null };
  const deps = {jobs,provider,delivery,now:() => clock}; const service = createAutomationService(config,logger,deps);
  return {config,mail,jobs,store,service,deps,provider,classifier,jobDeps,db,counts:() => reviewCalls,advance() { clock = new Date(clock.getTime()+180_000); },
    async seed(ids:string[] = ["a"]) { ids.forEach(id => mail.add(id)); await jobs.start({mode:"apply"}); return jobs.reviews(); },
    async bulk(items:ReviewItem[],requestId="human-001",category:Category="FYI/READ",rememberPreference=false) { return service.command("review.bulkResolve",{items:items.map(item => ({itemId:item.id,revision:item.revision!,category})),rememberPreference},requestId,"owner@example.com"); }
  };
}
afterEach(() => { for (const config of configs.splice(0)) { closeDatabase(config); rmSync(config.home,{recursive:true,force:true}); } });

describe("human review queue",() => {
  it("pages the complete configured apply queue beyond 200 using stable bounded cursors",async () => {
    const f = fixture(); const [initial] = await f.seed(); const template = f.store.work(initial!.id)!;
    for (let n = 0; n < 224; n++) { const item = {...template,id:`extra-${String(n).padStart(3,"0")}`,key:`extra-${n}`,threadId:`extra-${n}`,subject:`Newsletter ${n}`}; f.store.insertWork(item); f.store.review(item,"LOW_CONFIDENCE"); }
    for (const [id,mode,owner] of [["dry","dry-run",account],["other","apply","other@example.com"]] as const) { const item = {...template,id,key:id,mode,account:owner}; f.store.insertWork(item); f.store.review(item,"LOW_CONFIDENCE"); }
    let page = f.service.reviewQueue!({limit:50}); const seen:string[] = [];
    expect(page.total).toBe(225); expect(page.accounts).toEqual([account]); expect(page.counts.awaitingAgent).toBe(225);
    do { seen.push(...page.items.map(item => item.id)); if (!page.nextCursor) break; page = f.service.reviewQueue!({limit:50,cursor:page.nextCursor}); } while (true);
    expect(new Set(seen).size).toBe(225); expect(seen).not.toContain("dry");
    const first = f.service.reviewQueue!({limit:50}); f.db.prepare("UPDATE triage_reviews SET resolved_at='removed' WHERE id=?").run(first.items[0]!.id);
    expect(f.service.reviewQueue!({limit:50,cursor:first.nextCursor!}).items.map(i => i.id)).toEqual(seen.slice(50,100));
    expect(f.service.reviewQueue!({search:"Newsletter 22",category:"NEWSLETTER"}).total).toBe(5);
    expect(() => f.service.reviewQueue!({search:"changed",cursor:first.nextCursor!})).toThrow("REVIEW_CURSOR_INVALID");
    expect(() => f.service.reviewQueue!({limit:51})).toThrow("REVIEW_QUERY_INVALID");
    expect(() => f.service.reviewQueue!({account:"other@example.com"})).toThrow("REVIEW_ACCOUNT_NOT_CONFIGURED");
  });
  it("persists mixed-item receipts and applies only valid selections, with exact retry deduplication",async () => {
    const f = fixture(); const items = await f.seed(["a","b","c"]); const [valid,stale,incomplete] = items;
    f.store.review(f.store.work(incomplete!.id)!,"INSUFFICIENT_OR_TRUNCATED_CONTEXT");
    const input = {items:[{itemId:valid!.id,revision:valid!.revision!,category:"ACTION/SOON"},{itemId:stale!.id,revision:"0".repeat(64),category:"NEWSLETTER"},{itemId:incomplete!.id,revision:incomplete!.revision!,category:"NEWSLETTER"},{itemId:"unknown",revision:"0".repeat(64),category:"NEWSLETTER"}]};
    const first = await f.service.command("review.bulkResolve",input,"mixed-001",account);
    expect(first.reviewReceipt?.items.map(i => i.status)).toEqual(["queued","rejected","rejected","rejected"]);
    expect(f.service.reviewQueue!({bucket:"queued"}).items).toHaveLength(1);
    const restarted = createAutomationService(f.config,logger,f.deps); await restarted.tick();
    const second = await restarted.command("review.bulkResolve",input,"mixed-001",account);
    expect(second.reviewReceipt).toEqual(first.reviewReceipt); expect(second.reviewCommand?.items[0]?.status).toBe("applied");
    expect(f.mail.mutations).toHaveLength(1); expect(f.mail.mutations[0]?.ids).toEqual(["message-a"]); expect(f.mail.data.get("a")!.messages[0]!.labels).toContain("UNREAD");
    expect(new TrackStore(f.config).loadRegistry().tasks).toHaveLength(1); expect(f.counts()).toBe(0); expect(f.jobs.senderPreferences!()).toEqual([]);
    await expect(restarted.command("review.bulkResolve",{...input,rememberPreference:true},"mixed-001",account)).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("rejects malformed batches atomically and protects queued intents from legacy resolution",async () => {
    const f = fixture(), [item] = await f.seed(); const selected = {itemId:item!.id,revision:item!.revision!,category:"FYI/READ"};
    for (const input of [{items:[selected,selected]},{items:[{...selected,sender:"forged@example.com"}]},{items:[selected],unexpected:true},{items:Array.from({length:51},(_,i) => ({...selected,itemId:`id${i}`}))}]) {
      await expect(f.service.command("review.bulkResolve",input,"invalid-001",account)).rejects.toThrow();
    }
    expect(f.db.prepare("SELECT count(*) AS n FROM automation_commands").get()!.n).toBe(0);
    await f.bulk([item!]); expect(() => f.jobs.resolve(item!.id,"NEWSLETTER")).toThrow("REVIEW_HUMAN_PENDING");
    const duplicate = await f.bulk([item!],"human-002"); expect(duplicate.reviewReceipt?.items[0]?.code).toBe("REVIEW_ALREADY_QUEUED");
  });
  it("lets a queued human decision preempt Claude already in flight without applying its competing category",async () => {
    const f = fixture(), [item] = await f.seed(), entered = deferred(), release = deferred(), review = f.provider.review;
    f.provider.review = async (...args) => { entered.resolve(); await release.promise; return review(...args); };
    await f.service.command("automation.run",{kind:"review"},"agent-001",account); const active = f.service.tick(); await entered.promise;
    await f.bulk([item!],"human-001","NEWSLETTER"); release.resolve(); await active;
    expect(f.mail.mutations).toHaveLength(0); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(1); expect(f.mail.mutations[0]?.add).toEqual([labels.NEWSLETTER]);
    expect(new AutomationStore(f.db).decisions()).toHaveLength(0);
  });
  it("also preempts Claude during its final evidence fetch, inside the atomic acceptance guard",async () => {
    const f = fixture(), [item] = await f.seed(), entered = deferred(), release = deferred(); let reads = 0;
    f.mail.onRead = async () => { if (++reads === 2) { entered.resolve(); await release.promise; } };
    await f.service.command("automation.run",{kind:"review"},"agent-001",account); const active = f.service.tick(); await entered.promise;
    await f.bulk([item!],"human-001","NEWSLETTER"); release.resolve(); await active; f.mail.onRead = undefined;
    expect(f.mail.mutations).toHaveLength(0); await f.service.tick(); expect(f.mail.mutations[0]?.add).toEqual([labels.NEWSLETTER]);
  });
  it.each(["new-message","relevant-label"])("holds a human decision when %s changes after selection",async change => {
    const f = fixture(), [item] = await f.seed(); await f.bulk([item!]);
    if (change === "new-message") f.mail.data.get("a")!.messages.push({...f.mail.data.get("a")!.messages[0]!,id:"new",internalDate:2000});
    else f.mail.data.get("a")!.messages[0]!.labels.push("STARRED");
    await f.service.tick(); expect(f.mail.mutations).toHaveLength(0);
    expect(f.service.snapshot().reviewCommands?.[0]?.items[0]).toMatchObject({status:"stale",code:"REVIEW_EVIDENCE_CHANGED"});
    expect((await f.service.reviewDetail!(item!.id)).changed).toBe(true);
  });
  it.each(["before","after"] as const)("reconciles an ambiguous write (%s response) across restart without a second attempt",async failure => {
    const f = fixture(), [item] = await f.seed(); f.mail.failWrite = failure; await f.bulk([item!],"human-001","ACTION/NOW"); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(1); const restarted = createAutomationService(f.config,logger,f.deps); f.advance(); await restarted.tick();
    expect(f.mail.mutations).toHaveLength(1);
    expect(restarted.snapshot().reviewCommands?.[0]?.items[0]?.status).toBe(failure === "after" ? "applied" : "held");
    expect(new TrackStore(f.config).loadRegistry().tasks).toHaveLength(failure === "after" ? 1 : 0);
    if (failure === "before") { const work = f.store.work(item!.id)!; delete work.plan; f.store.review(work,"LOW_CONFIDENCE"); expect(f.store.reviewItem(item!.id)?.reviewable).toBe(false); expect(() => f.jobs.resolve(item!.id,"NEWSLETTER")).toThrow("REVIEW_UNCERTAIN_MUTATION"); }
  });
  it("recovers a durable acceptance before apply and fences an older worker after restart",async () => {
    const f = fixture(), [item] = await f.seed(), entered = deferred(), release = deferred(); await f.bulk([item!]);
    f.mail.onRead = async () => { entered.resolve(); await release.promise; };
    const running = f.service.tick(); await entered.promise; const restarted = createAutomationService(f.config,logger,f.deps); release.resolve(); await running; f.mail.onRead = undefined;
    expect(f.mail.mutations).toHaveLength(0); await restarted.tick(); expect(f.mail.mutations).toHaveLength(1);
  });
  it("bounds incomplete-context detail reads and concurrent inspection without permitting apply",async () => {
    const f = fixture(); f.mail.add("a",{body:"x".repeat(70_000),truncated:true}); await f.jobs.start({mode:"apply"}); const item = f.jobs.reviews()[0]!;
    const detail = await f.service.reviewDetail!(item.id); expect(detail.messages.reduce((n,m) => n+m.body.length,0)).toBe(60_000); expect(detail.truncated).toBe(true); expect(detail.item.reviewable).toBe(false);
    const release = deferred(); let reads = 0; const entered = deferred(); f.mail.onRead = async () => { if (++reads === 2) entered.resolve(); await release.promise; };
    const one = f.service.reviewDetail!(item.id), two = f.service.reviewDetail!(item.id); await entered.promise;
    await expect(f.service.reviewDetail!(item.id)).rejects.toThrow("REVIEW_BUSY"); release.resolve(); await Promise.all([one,two]); expect(f.mail.mutations).toHaveLength(0);
  });
});

describe("explicit sender preferences",() => {
  it("saves only explicitly requested exact single-sender preferences after successful application",async () => {
    const f = fixture(), items = await f.seed(["a","b"]);
    f.mail.add("ambiguous",{from:"other@example.com, Sender <sender@example.com>"}); await f.jobs.start({mode:"apply"}); const ambiguous = f.jobs.reviews().find(i => i.threadId === "ambiguous")!;
    await f.bulk([items[0]!],"human-001","NEWSLETTER",true); await f.service.tick();
    expect(f.jobs.senderPreferences!()).toMatchObject([{account,sender,category:"NEWSLETTER"}]);
    await f.bulk([ambiguous],"human-002","ACTION/NOW",true); await f.service.tick();
    expect(f.jobs.senderPreferences!()).toHaveLength(1); expect(f.service.snapshot().reviewCommands?.[0]?.items[0]?.preferenceSaved).toBe(false);
    expect(f.store.preference("other@example.com",sender).preference).toBeUndefined();
  });
  it("never resurrects a preference forgotten after a remember command was queued",async () => {
    const f = fixture(), [item] = await f.seed(); f.store.rememberPreference(account,sender,"NEWSLETTER",0); const preference = f.jobs.senderPreferences!()[0]!;
    await f.bulk([item!],"human-001","FYI/READ",true);
    await f.service.command("review.forgetPreference",{preferenceId:preference.id},"forget-001",account); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(1); expect(f.jobs.senderPreferences!()).toEqual([]);
    expect(f.service.snapshot().reviewCommands?.[0]?.items[0]).toMatchObject({status:"applied",preferenceSaved:false});
  });
  it("keeps the first explicit category when one batch contains conflicting choices for the same sender",async () => {
    const f = fixture(), items = await f.seed(["a","b"]);
    await f.service.command("review.bulkResolve",{items:items.map((item,i) => ({itemId:item.id,revision:item.revision!,category:i ? "NEWSLETTER" : "FYI/READ"})),rememberPreference:true},"human-001",account); await f.service.tick();
    expect(f.jobs.senderPreferences!()[0]?.category).toBe("FYI/READ"); expect(f.service.snapshot().reviewCommands?.[0]?.items.map(i => i.preferenceSaved)).toEqual([true,false]);
  });
  it("checks a forgotten preference again after the final awaited Gmail read before any mutation",async () => {
    const f = fixture(); f.store.rememberPreference(account,sender,"NEWSLETTER",0); const preference = f.jobs.senderPreferences!()[0]!;
    f.classifier.classify = async () => decision("NEWSLETTER",0.99); f.mail.add("a"); let reads = 0;
    f.mail.onRead = () => { if (++reads === 2) f.jobs.forgetSenderPreference!(preference.id); };
    await f.jobs.start({mode:"apply"}); expect(f.mail.mutations).toHaveLength(0); expect(f.jobs.reviews()[0]?.reason).toBe("REVIEW_PREFERENCE_CHANGED");
    expect(f.db.prepare("SELECT count(*) AS n FROM triage_mutation_attempts").get()!.n).toBe(0);
  });
  it("does not accept Claude output using a preference forgotten while the model was running",async () => {
    const f = fixture(), [item] = await f.seed(); f.store.rememberPreference(account,sender,"NEWSLETTER",0); const preference = f.jobs.senderPreferences!()[0]!;
    const original = f.provider.review; f.provider.review = async (...args) => { const result = await original(...args); f.jobs.forgetSenderPreference!(preference.id); return result; };
    await f.service.command("automation.run",{kind:"review"},"agent-001",account); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(0); expect(f.store.work(item!.id)?.state).toBe("needs_review");
    expect(f.service.reviewQueue!({}).items[0]?.agentReview?.reason).toBe("REVIEW_PREFERENCE_CHANGED");
  });
});

describe("read-only classification diagnostics",() => {
  it("distinguishes recorded Jev confidence from category probabilities throughout queue, detail and snapshot",async () => {
    const f = fixture();
    // Realistic nine-way provider calibration: winning probability .90 yields
    // approximately .89 recorded confidence, so the existing .90 gate still holds.
    f.classifier.classify = async () => ({...decision("NEWSLETTER",0.89),probabilities:Object.fromEntries(CATEGORIES.map(category => [category,category === "NEWSLETTER" ? 0.90 : 0.0125])) as Decision["probabilities"]});
    const [item] = await f.seed();
    const before = f.db.prepare("SELECT json FROM triage_work WHERE id=?").get(item!.id)!.json;
    const expected = {provider:"jev",model:"jev-1.13.0",category:"NEWSLETTER",confidence:0.89,probabilities:{NEWSLETTER:0.90},minimumConfidence:0.90};
    expect(f.service.reviewQueue!({}).items[0]?.classification).toMatchObject(expected);
    expect(f.service.snapshot().reviews[0]?.classification).toMatchObject(expected);
    expect((await f.service.reviewDetail!(item!.id)).item.classification).toMatchObject(expected);
    expect(f.db.prepare("SELECT json FROM triage_work WHERE id=?").get(item!.id)!.json).toBe(before);
    expect(f.mail.mutations).toHaveLength(0); expect(f.counts()).toBe(0);
  });
  it("leaves historical Claude scores and flags unrecorded rather than inferring them",async () => {
    const f = fixture(), [item] = await f.seed(), store = new AutomationStore(f.db);
    store.saveReview(store.reviewKey(item!.id,item!.revision!,"lifeos-review-v1"),{id:item!.id,account,category:null,revision:item!.revision!,policyVersion:"lifeos-review-v1",state:"held",model:"claude-sonnet-5-5",reason:"Ambiguous earlier request",createdAt:"2026-10-20T12:00:00Z"});
    const summary = f.service.reviewQueue!({}).items[0]?.agentReview;
    expect(summary).toMatchObject({category:null,source:"claude",minimumConfidence:0.95,reason:"Ambiguous earlier request"});
    for (const key of ["confidence","clear","needsMoreContext","gateReason"]) expect(summary).not.toHaveProperty(key);
    expect((await f.service.reviewDetail!(item!.id)).item.agentReview).toEqual(summary);
    expect(f.service.snapshot().reviews[0]?.agentReview).toEqual(summary);
  });
  it("never attributes later human or Claude decisions to Jev and filters unsafe probability keys",async () => {
    const f = fixture(), [item] = await f.seed(), work = f.store.work(item!.id)!;
    work.decision!.probabilities = {...work.decision!.probabilities,"ACTION/NOW":NaN,"ACTION/SOON":2,unknown:0.5} as Decision["probabilities"]; f.store.saveWork(work);
    const probabilities = f.jobs.reviews()[0]!.classification!.probabilities;
    expect(probabilities).not.toHaveProperty("ACTION/NOW"); expect(probabilities).not.toHaveProperty("ACTION/SOON"); expect(probabilities).not.toHaveProperty("unknown"); expect(Object.keys(probabilities).length).toBeLessThanOrEqual(9);
    for (const model of ["human","claude-sonnet-5-5"]) { work.decision = {...decision(),model,confidence:1}; f.store.saveWork(work); expect(f.jobs.reviews()[0]).not.toHaveProperty("classification"); }
    delete work.decision; f.store.saveWork(work); expect(f.jobs.reviews()[0]).not.toHaveProperty("classification");
  });
  it.each([
    {confidence:0.94,clear:true,needsMoreContext:false,category:"ACTION/NOW" as const,gateReason:"below_threshold"},
    {confidence:0.99,clear:false,needsMoreContext:false,category:"ACTION/NOW" as const,gateReason:"not_clear"},
    {confidence:0.99,clear:true,needsMoreContext:true,category:"ACTION/NOW" as const,gateReason:"needs_context"},
    {confidence:0.99,clear:true,needsMoreContext:false,category:null,gateReason:"no_category"},
  ])("records a new Claude hold caused by $gateReason without applying or inventing uncertainty",async flags => {
    const f = fixture(); await f.seed(); const review = f.provider.review;
    f.provider.review = async (...args) => { const result = await review(...args); const {gateReason:_reason,...values} = flags; return {...result,value:{...result.value,...values}}; };
    await f.service.command("automation.run",{kind:"review"},"agent-diag-001",account); await f.service.tick();
    expect(f.service.reviewQueue!({}).items[0]?.agentReview).toMatchObject({...flags,source:"claude",minimumConfidence:0.95});
    expect(new AutomationStore(f.db).decisions()[0]).toMatchObject(flags);
    expect(f.mail.mutations).toHaveLength(0); expect(f.counts()).toBe(1);
  });
  it("reports policy failures separately without claiming that Claude produced a score",async () => {
    const f = fixture(), [item] = await f.seed(); f.mail.data.get("a")!.messages[0]!.labels.push("STARRED");
    await f.service.command("automation.run",{kind:"review"},"agent-diag-001",account); await f.service.tick();
    const review = f.service.reviewQueue!({}).items[0]?.agentReview;
    expect(review).toMatchObject({source:"policy",model:"policy",gateReason:"policy_error",reason:"REVIEW_EVIDENCE_CHANGED",minimumConfidence:0.95});
    expect(review).not.toHaveProperty("confidence"); expect(review).not.toHaveProperty("clear"); expect(review).not.toHaveProperty("needsMoreContext");
    expect(f.store.work(item!.id)?.state).toBe("needs_review"); expect(f.counts()).toBe(0); expect(f.mail.mutations).toHaveLength(0);
  });
  it("identifies a post-acceptance Gmail precondition hold as policy while retaining the original model score",async () => {
    const f = fixture(), [item] = await f.seed(); let reads = 0;
    f.mail.onRead = () => { if (++reads === 3) f.mail.data.get("a")!.messages[0]!.labels.push("STARRED"); };
    await f.service.command("automation.run",{kind:"review"},"agent-diag-001",account); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(0); expect(f.store.work(item!.id)?.state).toBe("needs_review");
    expect(new AutomationStore(f.db).decisions()[0]).toMatchObject({state:"held",model:"claude-sonnet-5-5",confidence:0.99,gateReason:"policy_error"});
    expect(f.service.reviewQueue!({}).items[0]?.agentReview).toMatchObject({source:"policy",model:"claude-sonnet-5-5",confidence:0.99,clear:true,needsMoreContext:false,gateReason:"policy_error",reason:"Evidence changed or mutation needs reconciliation."});
  });
  it.each([0.899,0.9])("keeps the existing Jev threshold unchanged at confidence %s",async confidence => {
    const f = fixture(); f.classifier.classify = async () => decision("NEWSLETTER",confidence); await f.seed();
    expect(f.mail.mutations).toHaveLength(confidence < 0.9 ? 0 : 1);
  });
  it("accepts Claude at exactly the existing .95 gate and persists its recorded flags",async () => {
    const f = fixture(); await f.seed(); const review = f.provider.review;
    f.provider.review = async (...args) => { const result = await review(...args); result.value.confidence = 0.95; return result; };
    await f.service.command("automation.run",{kind:"review"},"agent-diag-001",account); await f.service.tick();
    expect(f.mail.mutations).toHaveLength(1);
    expect(new AutomationStore(f.db).decisions()[0]).toMatchObject({state:"applied",confidence:0.95,clear:true,needsMoreContext:false,gateReason:"accepted"});
  });
});
