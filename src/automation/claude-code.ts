import { request } from "node:http";
import { existsSync } from "node:fs";
import type { LifeOsConfig } from "../core/config.js";
import type { AgentReviewContext, AgentReviewProposal } from "../jobs/types.js";
import { DEFAULT_CLAUDE_MODEL, briefSchema, reviewSchema } from "./provider.js";
import type { AutomationProvider, BriefInput, BriefProposal, ProviderResult } from "./types.js";

/** The daemon exchanges bounded data over a Unix socket; it never reads Claude login credentials. */
export class ClaudeCodeProvider implements AutomationProvider {
  readonly model: string;
  private readonly socketPath: string;
  constructor(config: LifeOsConfig) {
    this.model=config.env.LIFE_OS_CLAUDE_MODEL??DEFAULT_CLAUDE_MODEL;
    this.socketPath=config.env.LIFE_OS_AGENT_SOCKET??"/run/life-os-agent/runner.sock";
  }
  configured(): boolean { return existsSync(this.socketPath); }
  async review(input: AgentReviewContext, signal: AbortSignal): Promise<ProviderResult<AgentReviewProposal>> {
    const result=await this.call("review",input,signal);
    return {...result,value:reviewSchema.parse(result.value)};
  }
  async brief(input: BriefInput, signal: AbortSignal): Promise<ProviderResult<BriefProposal>> {
    const result=await this.call("brief",input,signal);
    return {...result,value:briefSchema.parse(result.value)};
  }
  private call(kind:"review"|"brief",input:unknown,signal:AbortSignal):Promise<ProviderResult<unknown>> {
    const body=JSON.stringify({kind,model:this.model,input});
    if(Buffer.byteLength(body)>128_000) return Promise.reject(new Error("CLAUDE_INPUT_TOO_LARGE"));
    return new Promise((resolve,reject)=>{
      const req=request({socketPath:this.socketPath,path:"/run",method:"POST",headers:{"content-type":"application/json","content-length":Buffer.byteLength(body)},
        signal:AbortSignal.any([signal,AbortSignal.timeout(160_000)])},res=>{
        const chunks:Buffer[]=[];let size=0;
        res.on("data",(chunk:Buffer)=>{size+=chunk.length;if(size>200_000){res.destroy();reject(new Error("CLAUDE_RESPONSE_TOO_LARGE"));}else chunks.push(chunk);});
        res.on("error",()=>reject(new Error("CLAUDE_RUNNER_UNAVAILABLE")));
        res.on("end",()=>{
          try {
            const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if(res.statusCode!==200) throw new Error(typeof value.error==="string"&&/^CLAUDE_[A-Z0-9_]+$/.test(value.error)?value.error:"CLAUDE_RUNNER_FAILED");
            if(value.model!==this.model||![value.inputTokens,value.outputTokens].every(n=>Number.isSafeInteger(n)&&n>=0)) throw new Error("CLAUDE_INVALID_USAGE");
            resolve(value);
          } catch(error){reject(error);}
        });
      });
      req.on("error",()=>reject(new Error(signal.aborted?"CLAUDE_RUNNER_CANCELLED":"CLAUDE_RUNNER_UNAVAILABLE")));
      req.end(body);
    });
  }
}
