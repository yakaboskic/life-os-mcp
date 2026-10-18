import { loadConfig } from "../core/config.js";
import { createLogger } from "../core/logger.js";
import { createDaemon } from "../runtime/daemon.js";
import { requestBackend } from "../runtime/client.js";
import { readFileSync } from "node:fs";
import { createPrivateWebBridge } from "../runtime/web-bridge.js";

export async function daemon():Promise<void> {
  process.env.TZ ??= "America/New_York";
  const config=loadConfig(),logger=createLogger();
  const app=await createDaemon(config,logger);
  const listen=(server:typeof app.server,port:number)=>new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolve);});
  await listen(app.server,Number(config.env.LIFE_OS_API_PORT??4748));
  try {await listen(app.web,Number(config.env.LIFE_OS_WEB_PORT??4747));} catch(error){await app.close();throw error;}
  let bridge:ReturnType<typeof createPrivateWebBridge>|undefined;
  if(config.env.LIFE_OS_PRIVATE_WEB_HOST) {
    const token=readFileSync(config.env.LIFE_OS_GATEWAY_TOKEN_FILE!,"utf8").trim();
    bridge=createPrivateWebBridge(token,config.env.LIFE_OS_PRIVATE_WEB_HOST,Number(config.env.LIFE_OS_WEB_PORT??4747));
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
