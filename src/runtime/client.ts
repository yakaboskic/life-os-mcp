import { Transform } from "node:stream";
import { machineToken } from "./security.js";

export function backendUrl(env:NodeJS.ProcessEnv=process.env):string {
  const url=new URL(env.LIFE_OS_BACKEND_URL ?? "http://127.0.0.1:4748");
  if (url.protocol!=="https:" && !(url.protocol==="http:" && ["127.0.0.1","localhost","[::1]"].includes(url.hostname))) throw new Error("Backend requires HTTPS or a loopback SSH tunnel");
  if(url.username||url.password) throw new Error("Credentials belong in a token file, not the URL");
  return url.origin;
}
export async function requestBackend(path:string,opts:{method?:string;body?:unknown;job?:boolean;env?:NodeJS.ProcessEnv;signal?:AbortSignal}={}) {
  const env=opts.env??process.env;
  const timeout=AbortSignal.timeout(60_000);
  const response=await fetch(`${backendUrl(env)}${path}`, {method:opts.method??"GET",redirect:"error",signal:opts.signal?AbortSignal.any([timeout,opts.signal]):timeout,
    headers:{authorization:`Bearer ${machineToken(env,opts.job?"JOB":"INTERACTIVE")}`,"content-type":"application/json"},
    ...(opts.body===undefined?{}:{body:JSON.stringify(opts.body)})});
  const body=await response.json() as any;
  if(!response.ok) throw new Error(body.error??`LifeOS backend returned ${response.status}`);
  return body;
}

/** Byte-protocol bridge. It never opens local data and never starts a second application writer. */
export async function bridgeStdio(url:string,env:NodeJS.ProcessEnv=process.env):Promise<void> {
  const [{StreamableHTTPClientTransport},{StdioServerTransport}]=await Promise.all([
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),import("@modelcontextprotocol/sdk/server/stdio.js"),
  ]);
  const transport=new StreamableHTTPClientTransport(new URL(`${backendUrl({...env,LIFE_OS_BACKEND_URL:url})}/mcp`),{
    requestInit:{headers:{authorization:`Bearer ${machineToken(env,"INTERACTIVE")}`}},
  });
  const abort=new AbortController();
  // Bound the SDK's newline buffer before parsing. A disconnected/misbehaving
  // client must not retain unlimited input while waiting for the shared daemon.
  let lineBytes=0;
  const input=new Transform({transform(chunk:Buffer,_encoding,callback){
    let start=0;
    while(start<chunk.length){
      const newline=chunk.indexOf(10,start),end=newline<0?chunk.length:newline;
      lineBytes+=end-start;
      if(lineBytes>1024*1024){callback(new Error("MCP request exceeds 1 MiB"));return;}
      if(newline<0) break;
      lineBytes=0;start=newline+1;
    }
    callback(null,chunk);
  }});
  const stdio=new StdioServerTransport(input);
  let stopped=false,pending=0,pendingBytes=0,outputBytes=0;
  let resolveClosed!:()=>void;
  const closed=new Promise<void>(resolve=>{resolveClosed=resolve;});
  const stop=async(error?:Error)=>{
    if(stopped) return;
    stopped=true;
    if(error){console.error("LifeOS bridge closed:",error.message);process.exitCode=1;}
    // This function owns the stdio CLI process. Aborted HTTP/stdio writes can
    // retain native request handles even after destroy/unref (notably fd 1).
    // Allow cleanup and stderr to flush, then bound shutdown if handles remain.
    setTimeout(()=>process.exit(),250).unref();
    abort.abort();
    process.stdin.unpipe(input);input.destroy();process.stdin.destroy();
    await Promise.allSettled([transport.close(),stdio.close()]);
    // Once the connection is closed there is no consumer to wait for. Release
    // a full output pipe too, otherwise its queued writes can keep Node alive.
    process.stdout.destroy();
    // Node protects fd 1 from destroy(); a pipe still needs unref so a stalled
    // reader cannot keep this closed bridge alive through pending writes.
    process.stdout.unref?.();
    process.stdin.off("end",onEnd);process.stdin.off("close",onEnd);process.stdin.off("error",onError);
    process.stdout.off("close",onEnd);
    // Keep the output error listener until process exit: an already-buffered
    // write may report EPIPE after close has completed.
    process.off("SIGINT",onInterrupt);process.off("SIGTERM",onTerminate);process.off("SIGHUP",onHangup);
    resolveClosed();
  };
  const onEnd=()=>{void stop();};
  const onError=(error:Error)=>{void stop(error);};
  const onInterrupt=()=>{process.exitCode=130;void stop();};
  const onTerminate=()=>{process.exitCode=143;void stop();};
  const onHangup=()=>{process.exitCode=129;void stop();};
  process.stdin.once("end",onEnd);process.stdin.once("close",onEnd);process.stdin.once("error",onError);
  process.stdout.once("close",onEnd);process.stdout.on("error",onError);
  process.once("SIGINT",onInterrupt);process.once("SIGTERM",onTerminate);process.once("SIGHUP",onHangup);
  input.on("error",onError);stdio.onerror=onError;transport.onerror=onError;
  stdio.onclose=onEnd;transport.onclose=onEnd;
  transport.onmessage=message=>{
    if(stopped) return;
    const bytes=Buffer.byteLength(JSON.stringify(message));
    outputBytes+=bytes;
    if(outputBytes>8*1024*1024){void stop(new Error("Agent is not reading MCP responses"));return;}
    void stdio.send(message).catch(onError).finally(()=>{outputBytes-=bytes;});
  };
  // Listen before the readiness probe, so EOF also cancels a hung startup.
  // Calls wait for readiness and are never retried automatically after failure.
  const ready=requestBackend("/readyz",{env:{...env,LIFE_OS_BACKEND_URL:url},signal:abort.signal}).then(async()=>{
    if(!stopped) await transport.start();
  });
  void ready.catch(error=>{if(!stopped) onError(error);});
  stdio.onmessage=message=>{
    if(stopped) return;
    const bytes=Buffer.byteLength(JSON.stringify(message));
    pending++;pendingBytes+=bytes;
    if(pending>32||pendingBytes>4*1024*1024){void stop(new Error("Too many pending MCP requests"));return;}
    void ready.then(async()=>{if(!stopped) await transport.send(message);})
      .catch(error=>{if(!stopped) onError(error);}).finally(()=>{pending--;pendingBytes-=bytes;});
  };
  try {
    await stdio.start();
    if(process.stdin.destroyed||process.stdin.readableEnded||process.stdout.destroyed) void stop();
    else process.stdin.pipe(input);
    await closed;
  } catch(error){await stop(error instanceof Error?error:new Error(String(error)));}
}

export async function callRemoteTool(name:string,args:Record<string,unknown>,env=process.env) {
  const [{Client},{StreamableHTTPClientTransport}]=await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
  ]);
  const client=new Client({name:"life-os-cli",version:"0.2.0"});
  const transport=new StreamableHTTPClientTransport(new URL(`${backendUrl(env)}/mcp`),{requestInit:{headers:{authorization:`Bearer ${machineToken(env,"INTERACTIVE")}`}}});
  try {await client.connect(transport); return await client.callTool({name,arguments:args});}
  finally {await client.close();}
}
