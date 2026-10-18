import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { claudeArguments, claudeEnvironment, createClaudeRunner, parseClaudeResult, runClaude } from "../../src/runtime/claude-runner.js";
import { DEFAULT_CLAUDE_MODEL } from "../../src/automation/provider.js";

const brief={title:"Today",summary:"Two tasks need attention.",priorities:[],notes:[]};
const envelope={subtype:"success",is_error:false,structured_output:brief,usage:{input_tokens:120,output_tokens:30,cache_read_input_tokens:20,cache_creation_input_tokens:10}};
describe("isolated Claude Code runner",()=>{
  it("keeps native subscription auth while disabling tools and customizations",()=>{
    const args=claudeArguments("brief",DEFAULT_CLAUDE_MODEL);
    expect(args).toContain("--safe-mode");expect(args).not.toContain("--bare");expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args[args.indexOf("--tools")+1]).toBe("");
    expect(args[args.indexOf("--mcp-config")+1]).toBe('{"mcpServers":{}}');
    expect(args).toContain("--strict-mcp-config");expect(args).toContain("--no-session-persistence");
    const env=claudeEnvironment("/private/runner");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();expect(env.LIFE_OS_INTERACTIVE_TOKEN).toBeUndefined();
    expect(env.SSH_AUTH_SOCK).toBeUndefined();expect(env.CLAUDE_CONFIG_DIR).toBe("/private/runner/.claude");
  });
  it("validates structured output and accounts for cached subscription tokens",()=>{
    expect(parseClaudeResult(JSON.stringify(envelope),"brief",DEFAULT_CLAUDE_MODEL)).toMatchObject({value:brief,inputTokens:150,outputTokens:30});
    expect(()=>parseClaudeResult(JSON.stringify({...envelope,structured_output:{...brief,execute:"anything"}}),"brief",DEFAULT_CLAUDE_MODEL)).toThrow("STRUCTURED_OUTPUT");
    expect(()=>parseClaudeResult(JSON.stringify({...envelope,usage:{input_tokens:-1,output_tokens:0}}),"brief",DEFAULT_CLAUDE_MODEL)).toThrow("INVALID_USAGE");
    expect(()=>parseClaudeResult(JSON.stringify({is_error:true,result:"Not logged in. Please run login."}),"brief",DEFAULT_CLAUDE_MODEL)).toThrow("LOGIN_REQUIRED");
    expect(()=>parseClaudeResult(JSON.stringify({is_error:true,result:"Usage limit reached; resets at 5pm"}),"brief",DEFAULT_CLAUDE_MODEL)).toThrow("QUOTA_EXHAUSTED");
  });
  it("runs a child without a shell, delivers data on stdin, and stops hung children",async()=>{
    const home=mkdtempSync(join(tmpdir(),"lifeos-runner-"));mkdirSync(join(home,"work"));
    const binary=join(home,"fake-claude");
    try {
      writeFileSync(binary,`#!${process.execPath}\nlet input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{if(JSON.parse(input).secret!=='synthetic')process.exit(2);process.stdout.write(${JSON.stringify(JSON.stringify(envelope))});});\n`,{mode:0o700});
      expect((await runClaude({home,binary},"brief",{secret:"synthetic"},new AbortController().signal)).value).toEqual(brief);
      writeFileSync(binary,`#!${process.execPath}\nprocess.stdin.resume();setInterval(()=>{},1000);\n`,{mode:0o700});
      await expect(runClaude({home,binary,timeoutMs:50},"brief",{},new AbortController().signal)).rejects.toThrow("TIMEOUT");
    } finally {rmSync(home,{recursive:true,force:true});}
  });
  it("rejects an already-cancelled request before spawning a missing executable",async()=>{
    const controller=new AbortController();controller.abort();
    await expect(runClaude({home:"/tmp",binary:"/nonexistent/lifeos-test-claude"},"brief",{},controller.signal)).rejects.toThrow("CLAUDE_RUNNER_CANCELLED");
  });
  it("admits only one bounded named job and rejects model overrides",async()=>{
    let complete:()=>void=()=>{};
    const running=new Promise<void>(r=>{complete=r;});
    const server=createClaudeRunner({home:"/tmp",binary:"/tmp/unused",run:async()=>{await running;return{value:brief,model:DEFAULT_CLAUDE_MODEL,inputTokens:1,outputTokens:1};}});
    await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
    const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send=(body:unknown)=>fetch(base+"/run",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    try {
      const first=send({kind:"brief",model:DEFAULT_CLAUDE_MODEL,input:{}});
      for(let i=0;i<100;i++){if((await(await fetch(base+"/health")).json() as any).busy)break;await new Promise(r=>setTimeout(r,1));}
      expect((await send({kind:"review",model:DEFAULT_CLAUDE_MODEL,input:{}})).status).toBe(409);
      complete();expect((await first).status).toBe(200);
      const invalid=await send({kind:"shell",model:DEFAULT_CLAUDE_MODEL,input:{}});expect(invalid.status).not.toBe(200);
      expect((await(await send({kind:"brief",model:"claude-other",input:{}})).json() as any).error).toBe("CLAUDE_MODEL_MISMATCH");
      expect((await fetch(base+"/run",{method:"POST",headers:{"content-type":"application/json",origin:"https://evil.example"},body:"{}"})).status).toBe(404);
    } finally {complete();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  });
});
