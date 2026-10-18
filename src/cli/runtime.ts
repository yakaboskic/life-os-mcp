import { requestBackend } from "../runtime/client.js";
import { randomUUID } from "node:crypto";

export async function daemon():Promise<void> {
  const { loadConfig } = await import("../core/config.js");
  const { createLogger } = await import("../core/logger.js");
  const { createDaemon } = await import("../runtime/daemon.js");
  const { createPrivateWebBridge } = await import("../runtime/web-bridge.js");
  const { readFileSync } = await import("node:fs");
  process.env.TZ ??= "America/New_York";
  const config=loadConfig(),logger=createLogger();
  const app=await createDaemon(config,logger);
  const listen=(server:typeof app.server,port:number)=>new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  await listen(app.server,Number(config.env.LIFE_OS_API_PORT??4748));
  try {await listen(app.web,Number(config.env.LIFE_OS_WEB_PORT??4747));} catch(error){await app.close();throw error;}
  let bridge:ReturnType<typeof createPrivateWebBridge>|undefined;
  if(config.env.LIFE_OS_PRIVATE_WEB_HOST) {
    const token=readFileSync(config.env.LIFE_OS_GATEWAY_TOKEN_FILE!,"utf8").trim();
    bridge=createPrivateWebBridge(token,config.env.LIFE_OS_PRIVATE_WEB_HOST,Number(config.env.LIFE_OS_WEB_PORT??4747),{executeAction:app.executeAction});
    await new Promise<void>((resolve,reject)=>{bridge!.once("error",reject);bridge!.listen(4749,config.env.LIFE_OS_PRIVATE_WEB_HOST,resolve);});
  }
  logger.info("LifeOS daemon ready",{apiPort:config.env.LIFE_OS_API_PORT??4748,webPort:config.env.LIFE_OS_WEB_PORT??4747});
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;bridge?.close();void app.close().then(()=>process.exit(0));};
  process.on("SIGTERM",stop);process.on("SIGINT",stop);
}

export async function jobsCommand(subcommand:string|undefined,args:string[],options:{mode?:string;wait?:boolean;scheduled?:boolean}) {
  const job=!!(process.env.LIFE_OS_JOB_TOKEN || process.env.LIFE_OS_JOB_TOKEN_FILE);
  if(subcommand==="status") {console.log(JSON.stringify(await requestBackend("/v1/jobs",{job}),null,2));return;}
  if(subcommand!=="run"&&subcommand!=="retry") throw new Error("Usage: life-os jobs run gmail-triage --mode dry-run|apply --wait, jobs status, or jobs retry <run-id>");
  if(subcommand==="run" && args[0]!=="gmail-triage") throw new Error("Only gmail-triage is configured");
  let mode=options.mode??"dry-run";
  if(subcommand==="retry") {
    const state=await requestBackend("/v1/jobs",{job});
    const previous=state.runs.find((r:any)=>r.id===args[0]);
    if(!previous) throw new Error("Run not found in recent history");
    mode=previous.mode;
  }
  if(!["apply","dry-run"].includes(mode)) throw new Error("Mode must be dry-run or apply");
  const result=await requestBackend("/v1/jobs",{job,method:"POST",body:{name:"gmail-triage",mode,scheduled:options.scheduled===true,retryRunId:subcommand==="retry"?args[0]:undefined}});
  if(!options.wait) {console.log(JSON.stringify(result,null,2));return;}
  const id=result.activeRun?.id??result.lastRun?.id;
  if(!id&&!result.pending) throw new Error("Daemon did not accept the job");
  const deadline=Date.now()+96*60_000;
  while(Date.now()<deadline) {
    const state=await requestBackend("/v1/jobs",{job});
    const run=result.pending ? state.runs.find((r:any)=>r.scheduled&&r.day>=result.pending.day&&r.mode===mode) : state.runs.find((r:any)=>r.id===id);
    if(run && run.state!=="running") {
      console.log(JSON.stringify(run,null,2));
      if(run.state==="failed"||run.state==="interrupted"||run.accounts.some((a:any)=>a.failed>0)) process.exitCode=1;
      return;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  throw new Error("Job wait timed out; inspect jobs status before retrying");
}

export async function automationCommand(subcommand:string|undefined,args:string[],options:{time?:string;enable?:boolean;disable?:boolean;requestId?:string}) {
  if(subcommand==="status") {console.log(JSON.stringify(await requestBackend("/v1/automation"),null,2));return;}
  let action:string,input:Record<string,unknown>;
  if(subcommand==="run" && ["review","brief","daily"].includes(args[0]??"")) {
    action="automation.run";input={kind:args[0]};
  } else if(subcommand==="schedule") {
    if(options.enable && options.disable) throw new Error("Choose --enable or --disable, not both.");
    if(!options.time && !options.enable && !options.disable) throw new Error("Use --time HH:MM (Eastern), --enable or --disable.");
    action="automation.schedule";input={...(options.time?{localTime:options.time}:{}),...(options.enable?{enabled:true}:{}),...(options.disable?{enabled:false}:{})};
  } else throw new Error("Usage: life-os automation status | run review|brief|daily | schedule --time HH:MM --enable|--disable");
  // Keep this ID to retry exactly the same command if the response is lost.
  const requestId=options.requestId??randomUUID();
  console.error(`LifeOS request ID: ${requestId}`);
  console.log(JSON.stringify(await requestBackend("/v1/actions",{method:"POST",body:{requestId,action,input}}),null,2));
}
