import { createServer, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { LifeOsConfig } from "../core/config.js";
import type { Logger } from "../core/logger.js";
import type { Toolset } from "../core/toolset.js";
import { buildServer, prepareToolsets } from "../core/server.js";
import { selectToolsets } from "../core/registry.js";
import { openDatabase, SCHEMA_VERSION } from "../state/database.js";
import { createWebServer } from "../web/server.js";
import { machineToken, equalToken, safeHost, jsonBody } from "./security.js";
import { createJobService, easternDay } from "../jobs/service.js";
import { GmailAccountManager } from "../toolsets/gmail/client.js";
import { GmailJobGateway } from "../jobs/gmail.js";
import { createGmailToolset } from "../toolsets/gmail/index.js";
import { createTrackToolset } from "../toolsets/track/index.js";
import { createDriveToolset } from "../toolsets/drive/index.js";
import { acquireDaemonOwnership } from "../state/ownership.js";
import { TrackerActions, actionEnvelope, parseActionRequest, withRevision, ActionError } from "./actions.js";
import { ToolInputError } from "../core/errors.js";
import { ok } from "../core/result.js";
import { createAutomationService } from "../automation/service.js";
import type { AutomationService } from "../automation/types.js";
import { ZodError } from "zod";

function reply(res:ServerResponse,status:number,value:unknown) {
  res.writeHead(status,{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}).end(JSON.stringify(value));
}

interface DaemonOptions { toolsets?:Toolset[]; jobs?:ReturnType<typeof createJobService>; automation?:AutomationService }
export async function createDaemon(config:LifeOsConfig,logger:Logger,options:DaemonOptions={}) {
  config.env.LIFE_OS_ACCESS_MODE="daemon";
  const release=acquireDaemonOwnership(config);
  try {
    const app=await buildDaemon(config,logger,options);
    return {...app,async close(){try {await app.close();} finally {release();}}};
  } catch(error) {release();throw error;}
}

async function buildDaemon(config:LifeOsConfig,logger:Logger,options:DaemonOptions) {
  const interactive=machineToken(config.env,"INTERACTIVE"),jobToken=machineToken(config.env,"JOB");
  if(equalToken(interactive,jobToken)) throw new Error("Interactive and job credentials must differ");
  const db=openDatabase(config);
  const manager=new GmailAccountManager({config,logger});
  const jobs=options.jobs??createJobService(config,logger,{gateway:new GmailJobGateway(config,logger,manager)});
  const actions=new TrackerActions(config);
  const automation=options.automation??createAutomationService(config,logger,{jobs,manager,track:actions.store});
  const dispatchAction=async(raw:unknown,actor:string)=>{
    const request=parseActionRequest(raw);
    try {
      if(["automation.run","automation.schedule","review.resolve"].includes(request.action)) {
        const result=await automation.command(request.action as "automation.run"|"automation.schedule"|"review.resolve",request.input,request.requestId,actor);
        // Run on the next event-loop turn, after the command's receipt is durable.
        setImmediate(()=>{if(!draining) void automation.tick().catch(()=>logger.warn("Automation tick failed"));});
        return {ok:true,requestId:request.requestId,result};
      }
      return actions.execute(request,actor);
    } catch(error) {
      if(error instanceof ToolInputError) throw new ActionError(error.message);
      if(error instanceof ZodError) throw new ActionError("Check the action fields and try again.");
      if(error instanceof Error) {
        const conflicts=new Set(["AUTOMATION_BUSY","IDEMPOTENCY_CONFLICT","REVIEW_NOT_ELIGIBLE","REVIEW_STALE_CONTEXT","JOBS_BUSY"]);
        if(conflicts.has(error.message)) throw new ActionError(error.message,409,error.message);
        if(["AUTOMATION_NOT_CONFIGURED","AUTOMATION_DRAINING"].includes(error.message)) throw new ActionError(error.message,503,error.message);
        if(["AUTOMATION_INVALID_REQUEST","AUTOMATION_INVALID_ACTION"].includes(error.message)) throw new ActionError(error.message,400,error.message);
      }
      throw error;
    }
  };
  const runtimeTools:Toolset={name:"lifeos",description:"Shared dashboard actions and durable automations",tools:[
    {name:"lifeos_snapshot",description:"Read tasks, projects, entries and the current timer with revisions for safe shared browser/agent edits.",inputSchema:{},annotations:{readOnlyHint:true},handler:async()=>{
      const store=actions.store,timer=store.getTimer();
      return ok({...store.loadRegistry(),tasks:store.loadRegistry().tasks.map(withRevision),activeTimer:timer?withRevision(timer):null,
        entries:store.listEntries({from:new Date(Date.now()-90*86400000)}).map(withRevision)});
    }},
    {name:"lifeos_automations",description:"Read automation schedules, runs, held Gmail reviews and the daily brief delivery state.",inputSchema:{},annotations:{readOnlyHint:true},handler:async()=>ok(automation.snapshot())},
    {name:"lifeos_action",description:"Execute an allowed dashboard action or queue a named automation. Use a unique requestId and reuse the same payload/ID only after uncertain transport failure. Read lifeos_snapshot for expectedRevision and expectedTimerRevision. project.create accepts name (1–200 characters), optional exact productId, goal (up to 2000 characters), and notes (up to 20000 characters); project names must be unique without regard to case. automation.run accepts kind review, brief or daily. automation.schedule accepts enabled, localTime (HH:MM Eastern fallback), reviewEnabled and briefEnabled. review.resolve accepts itemId and category; only resolve as an explicit human decision.",
      inputSchema:actionEnvelope.shape,annotations:{idempotentHint:true},handler:async(args)=>ok(await dispatchAction(args,"agent:interactive"))},
  ]};
  const toolsets=[...(options.toolsets??selectToolsets(config.toolsetFilter,[createGmailToolset({manager}),createTrackToolset(),createDriveToolset()])),runtimeTools];
  const ctx={config,logger};
  const instructions=await prepareToolsets(toolsets,ctx);
  let draining=existsSync(join(config.home,".deployment-paused")),activeRequests=0;
  if(draining) {void jobs.drain();void automation.drain();}
  db.exec("CREATE TABLE IF NOT EXISTS pending_jobs(id TEXT PRIMARY KEY, mode TEXT NOT NULL, day TEXT NOT NULL, created_at TEXT NOT NULL)");
  const pendingRuns=()=>db.prepare("SELECT * FROM pending_jobs ORDER BY created_at").all();
  let replaying=false;
  const replay=async()=>{
    if(draining||replaying||automation.activeCount>0) return;
    replaying=true;
    try {
      for(const pending of pendingRuns()) {
        if(draining||automation.activeCount>0) break;
        // start records the run before network access; leave queued until a durable terminal result exists.
        let result=await jobs.start({mode:String(pending.mode) as "apply"|"dry-run",scheduled:true});
        if(!result.scheduled) result=await jobs.start({mode:String(pending.mode) as "apply"|"dry-run",scheduled:true});
        automation.afterTriage(result);
        db.prepare("DELETE FROM pending_jobs WHERE id=?").run(String(pending.id));
      }
    } catch {logger.warn("Queued Gmail activation remains pending");}
    finally {replaying=false;}
  };
  const jobStatus=()=>({...jobs.status(),runs:jobs.history(),pendingRuns:pendingRuns()});
  // Serializes interactive writes (especially preview/apply) across every MCP connection.
  let writes:Promise<unknown>=Promise.resolve();
  const executeAction=async(raw:unknown,actor:string)=>{
    if(draining) throw new ActionError("LifeOS is updating. Try again shortly.",503,"DEPLOYMENT_DRAIN");
    activeRequests++;
    try {
      const result=writes.then(()=>dispatchAction(raw,actor));
      writes=result.catch(()=>{});
      return await result;
    } finally {activeRequests--;}
  };
  const sharedToolsets=toolsets.map(ts=>({...ts,tools:ts.tools.map(tool=>({...tool,handler:async(args:any)=>{
    if(draining) throw new Error("LifeOS is draining for deployment; retry after it is ready");
    activeRequests++;
    const run=()=>tool.handler(args,ctx);
    try {
      if(tool.annotations?.readOnlyHint) return await run();
      const result=writes.then(run,run); writes=result.catch(()=>{}); return await result;
    } finally {activeRequests--;}
  }}))}));
  const status=()=>({ok:true,release:config.env.LIFE_OS_RELEASE_SHA??"development",schemaVersion:SCHEMA_VERSION,draining,
    activeRequests,activeJobs:(jobs.status().activeRun?1:0)+automation.activeCount});
  const server=createServer(async(req,res)=>{
    try {
      if(!safeHost(req)||req.headers.origin) {reply(res,403,{error:"Invalid machine request origin or host"});return;}
      const token=(req.headers.authorization??"").replace(/^Bearer /,"");
      const role=equalToken(token,interactive)?"interactive":equalToken(token,jobToken)?"job":null;
      if(!role){reply(res,401,{error:"Bearer credential required"});return;}
      const path=new URL(req.url??"/","http://localhost").pathname;
      if(req.method==="GET" && (path==="/healthz"||path==="/readyz")) {
        db.prepare("SELECT 1").get(); reply(res,200,status());return;
      }
      if(req.method==="GET" && ["/v1/jobs","/v1/jobs/status"].includes(path)) {reply(res,200,jobStatus());return;}
      if(req.method==="POST" && path==="/v1/jobs") {
        const body=await jsonBody(req);
        if(body.name!=="gmail-triage" || !["dry-run","apply"].includes(body.mode) || (body.retryRunId!==undefined && typeof body.retryRunId!=="string")) {reply(res,400,{error:"Expected gmail-triage and mode dry-run|apply"});return;}
        if(body.mode==="apply" && config.env.LIFE_OS_TRIAGE_APPLY_ENABLED!=="true") {reply(res,409,{error:"TRIAGE_APPLY_DISABLED"});return;}
        if(body.scheduled===true) {
          const day=easternDay(new Date()),id=`gmail-triage:${body.mode}:${day}`;
          db.prepare("INSERT OR IGNORE INTO pending_jobs VALUES(?,?,?,?)").run(id,body.mode,day,new Date().toISOString());
          void replay();
          reply(res,202,{...jobStatus(),pending:{id,day,mode:body.mode}});return;
        }
        if(draining){reply(res,503,{error:"Deployment in progress; retry the manual job"});return;}
        if(automation.activeCount>0){reply(res,409,{error:"Automation is running; retry after it finishes"});return;}
        // start() checkpoints synchronously before its first network await; caller polls durable status.
        let rejected:unknown;
        void jobs.start({mode:body.mode,scheduled:body.scheduled===true,retryRunId:body.retryRunId}).then(run=>automation.afterTriage(run)).catch(error=>{rejected=error;logger.error(`Job failed: ${error instanceof Error?error.name:"unknown"}`);}).finally(()=>{void replay();});
        await Promise.resolve();
        if(rejected) throw Object.assign(rejected,{status:409});
        reply(res,202,jobs.status());return;
      }
      if(role!=="interactive"){reply(res,403,{error:"Job credential cannot access interactive operations"});return;}
      if(req.method==="POST" && path==="/v1/admin/drain") {draining=true;void jobs.drain();void automation.drain();reply(res,202,status());return;}
      if(req.method==="POST" && path==="/v1/admin/resume") {draining=false;jobs.resume();automation.resume();void replay();reply(res,200,status());return;}
      if(req.method==="GET" && path==="/v1/automation") {reply(res,200,automation.snapshot());return;}
      if(req.method==="POST" && path==="/v1/actions") {reply(res,200,await executeAction(await jsonBody(req),"agent:interactive"));return;}
      if(req.method==="GET" && path==="/v1/triage/reviews") {reply(res,200,{items:jobs.reviews()});return;}
      if(req.method==="POST" && path.startsWith("/v1/triage/reviews/")) {
        if(draining){reply(res,503,{error:"Deployment in progress"});return;}
        const body=await jsonBody(req); reply(res,200,jobs.resolve(decodeURIComponent(path.slice("/v1/triage/reviews/".length)),body.category));return;
      }
      if(path==="/mcp" && ["GET","DELETE"].includes(req.method??"")) {
        res.writeHead(405,{allow:"POST","cache-control":"no-store"}).end();return;
      }
      if(path==="/mcp" && req.method==="POST") {
        const body=await jsonBody(req);
        const mcp=await buildServer(sharedToolsets,ctx,instructions);
        const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
        res.on("close",()=>{void transport.close();void mcp.close();});
        await mcp.connect(transport);await transport.handleRequest(req,res,body);return;
      }
      reply(res,404,{error:"Route not found"});
    } catch(error) {
      if(!res.headersSent) reply(res,(error as any).status??400,{error:error instanceof Error?error.message:"Request failed"});
    }
  });
  server.requestTimeout=65_000;server.headersTimeout=15_000;
  const web=createWebServer(config,()=>({status:jobs.status(),runs:jobs.history()}),{actions:false,automationSnapshot:()=>automation.snapshot()});
  const interval=setInterval(()=>{if(!draining){void replay();void automation.tick().catch(()=>logger.warn("Automation tick failed"));}},30_000);
  interval.unref();
  void replay();
  return {server,web,jobs,automation,executeAction,status,async close(){draining=true;clearInterval(interval);await Promise.all([jobs.drain(),automation.drain()]);await writes;await Promise.all([server,web].map(s=>new Promise<void>(r=>{s.close(()=>r());s.closeIdleConnections();})));}};
}
