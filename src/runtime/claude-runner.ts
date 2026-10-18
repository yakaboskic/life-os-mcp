import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { DEFAULT_CLAUDE_MODEL, briefJsonSchema, briefPrompt, briefSchema, reviewJsonSchema, reviewPrompt, reviewSchema } from "../automation/provider.js";
import type { ProviderResult } from "../automation/types.js";

type Kind="review"|"brief";
const requestSchema=z.object({kind:z.enum(["review","brief"]),model:z.string().regex(/^claude-[a-z0-9-]+$/),input:z.unknown()}).strict();
export function claudeArguments(kind:Kind,model:string):string[] {
  return ["--safe-mode","-p","--model",model,"--output-format","json","--json-schema",JSON.stringify(kind==="review"?reviewJsonSchema:briefJsonSchema),
    "--system-prompt",kind==="review"?reviewPrompt():briefPrompt(),"--tools","","--disallowedTools","mcp__*","--strict-mcp-config",
    "--mcp-config",'{"mcpServers":{}}',"--setting-sources","","--settings",'{"disableAllHooks":true}',"--disable-slash-commands",
    "--permission-mode","dontAsk","--no-session-persistence","--max-turns","3","--max-budget-usd","0.35","--effort","low"];
}
/** No inherited provider key, LifeOS token, SSH agent, project settings or shell execution. */
export function claudeEnvironment(home:string):NodeJS.ProcessEnv {
  return {HOME:home,CLAUDE_CONFIG_DIR:join(home,".claude"),PATH:"/opt/node/bin:/usr/local/bin:/usr/bin:/bin",LANG:"C.UTF-8",TZ:"America/New_York",
    DISABLE_AUTOUPDATER:"1",DISABLE_UPDATES:"1",CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:"1",CLAUDE_CODE_DISABLE_AUTO_MEMORY:"1",CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:"1"};
}
function failure(text:string):string {
  if(/not logged in|login required|please.*login|authentication|oauth.*expired|invalid.*token/i.test(text)) return "CLAUDE_LOGIN_REQUIRED";
  if(/usage limit|rate limit|quota|limit reached|out of.*usage|resets at/i.test(text)) return "CLAUDE_QUOTA_EXHAUSTED";
  if(/budget|max.turns|maximum.*turn/i.test(text)) return "CLAUDE_RUN_LIMIT";
  return "CLAUDE_RUNNER_FAILED";
}
export function parseClaudeResult(output:string,kind:Kind,model:string):ProviderResult<unknown> {
  let raw:any;try{raw=JSON.parse(output);}catch{throw new Error("CLAUDE_INVALID_RESPONSE");}
  if(raw.is_error || raw.subtype!=="success") throw new Error(failure(JSON.stringify(raw)));
  let value:unknown;
  try{value=(kind==="review"?reviewSchema:briefSchema).parse(raw.structured_output);}catch{throw new Error("CLAUDE_INVALID_STRUCTURED_OUTPUT");}
  const usage=raw.usage;
  if(!usage||![usage.input_tokens,usage.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error("CLAUDE_INVALID_USAGE");
  const cached=[usage.cache_read_input_tokens??0,usage.cache_creation_input_tokens??0];
  if(!cached.every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error("CLAUDE_INVALID_USAGE");
  return {value,model,inputTokens:usage.input_tokens+cached[0]+cached[1],outputTokens:usage.output_tokens};
}
export interface RunnerOptions { home:string; binary:string; model?:string; timeoutMs?:number; run?:(kind:Kind,input:unknown,signal:AbortSignal)=>Promise<ProviderResult<unknown>> }
export async function runClaude(options:RunnerOptions,kind:Kind,input:unknown,signal:AbortSignal):Promise<ProviderResult<unknown>> {
  if(signal.aborted) throw new Error("CLAUDE_RUNNER_CANCELLED");
  const model=options.model??DEFAULT_CLAUDE_MODEL;
  if(!isAbsolute(options.binary)||!/^claude-[a-z0-9-]+$/.test(model)) throw new Error("CLAUDE_RUNNER_CONFIG_INVALID");
  const content=JSON.stringify(input);if(Buffer.byteLength(content)>120_000) throw new Error("CLAUDE_INPUT_TOO_LARGE");
  return new Promise((resolve,reject)=>{
    const child=spawn(options.binary,claudeArguments(kind,model),{cwd:join(options.home,"work"),env:claudeEnvironment(options.home),stdio:["pipe","pipe","pipe"],shell:false,detached:true});
    let stdout="",stderr="",settled=false,killed=false;
    const kill=()=>{if(killed)return;killed=true;try{if(child.pid)process.kill(-child.pid,"SIGKILL");else child.kill("SIGKILL");}catch{child.kill("SIGKILL");}};
    const finish=(error?:Error,result?:ProviderResult<unknown>)=>{if(settled)return;settled=true;clearTimeout(timeout);signal.removeEventListener("abort",abort);error?reject(error):resolve(result!);};
    const abort=()=>{kill();finish(new Error("CLAUDE_RUNNER_CANCELLED"));};
    const timeout=setTimeout(()=>{kill();finish(new Error("CLAUDE_RUNNER_TIMEOUT"));},options.timeoutMs??150_000);
    child.stdout.on("data",chunk=>{stdout+=chunk.toString();if(Buffer.byteLength(stdout)>200_000){kill();finish(new Error("CLAUDE_RESPONSE_TOO_LARGE"));}});
    child.stderr.on("data",chunk=>{if(stderr.length<16_000)stderr+=chunk.toString().slice(0,16_000-stderr.length);});
    child.on("error",()=>finish(new Error("CLAUDE_RUNNER_UNAVAILABLE")));
    child.stdin.on("error",()=>{ /* close/error event supplies final status without leaking stdin */ });
    child.on("close",exit=>{
      if(settled)return;
      if(exit!==0){finish(new Error(failure(stdout+stderr)));return;}
      try{finish(undefined,parseClaudeResult(stdout,kind,model));}catch(error){finish(error as Error);}
    });
    signal.addEventListener("abort",abort,{once:true});
    if(signal.aborted){abort();return;}
    child.stdin.end(content);
  });
}
export function createClaudeRunner(options:RunnerOptions) {
  let busy=false;
  return createServer(async(req,res)=>{
    res.setHeader("cache-control","no-store");res.setHeader("content-type","application/json");
    if(req.method==="GET"&&req.url==="/health"){res.end(JSON.stringify({ready:true,busy}));return;}
    if(req.method!=="POST"||req.url!=="/run"||req.headers.origin){res.writeHead(404).end();return;}
    if(busy){res.writeHead(409).end(JSON.stringify({error:"CLAUDE_RUNNER_BUSY"}));return;}
    if(req.headers["content-type"]!=="application/json"){res.writeHead(415).end();return;}
    busy=true;
    const controller=new AbortController();res.on("close",()=>{if(!res.writableEnded)controller.abort();});
    try {
      const chunks:Buffer[]=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>128_000)throw new Error("CLAUDE_INPUT_TOO_LARGE");chunks.push(Buffer.from(chunk));}
      let body:z.infer<typeof requestSchema>;try{body=requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));}catch{throw new Error("CLAUDE_REQUEST_INVALID");}
      if(body.model!==(options.model??DEFAULT_CLAUDE_MODEL))throw new Error("CLAUDE_MODEL_MISMATCH");
      const result=await (options.run?options.run(body.kind,body.input,controller.signal):runClaude(options,body.kind,body.input,controller.signal));
      res.end(JSON.stringify(result));
    } catch(error){if(!res.destroyed)res.writeHead(503).end(JSON.stringify({error:error instanceof Error&&/^CLAUDE_[A-Z0-9_]+$/.test(error.message)?error.message:"CLAUDE_RUNNER_FAILED"}));}
    finally{busy=false;}
  });
}
export async function agentRunner():Promise<void> {
  const home=process.env.LIFE_OS_AGENT_HOME??"/var/lib/life-os-agent",socket=process.env.LIFE_OS_AGENT_SOCKET??"/run/life-os-agent/runner.sock";
  const binary=process.env.LIFE_OS_CLAUDE_BIN??"/opt/life-os-agent/claude";
  for(const path of [home,socket,binary])if(!isAbsolute(path))throw new Error("CLAUDE_RUNNER_CONFIG_INVALID");
  mkdirSync(join(home,"work"),{recursive:true,mode:0o700});mkdirSync(join(home,".claude"),{recursive:true,mode:0o700});mkdirSync(dirname(socket),{recursive:true,mode:0o750});
  if(existsSync(socket)){if(!lstatSync(socket).isSocket())throw new Error("CLAUDE_RUNNER_SOCKET_INVALID");unlinkSync(socket);}
  const server=createClaudeRunner({home,binary,model:process.env.LIFE_OS_CLAUDE_MODEL});
  server.requestTimeout=165_000;server.headersTimeout=15_000;
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(socket,()=>{chmodSync(socket,0o660);resolve();});});
  console.error("LifeOS Claude runner ready");
  const stop=()=>{server.close(()=>process.exit(0));server.closeIdleConnections();};
  process.once("SIGTERM",stop);process.once("SIGINT",stop);
}
