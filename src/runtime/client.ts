import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { machineToken } from "./security.js";

export function backendUrl(env:NodeJS.ProcessEnv=process.env):string {
  const url=new URL(env.LIFE_OS_BACKEND_URL ?? "http://127.0.0.1:4748");
  if (url.protocol!=="https:" && !(url.protocol==="http:" && ["127.0.0.1","localhost","[::1]"].includes(url.hostname))) throw new Error("Backend requires HTTPS or a loopback SSH tunnel");
  if(url.username||url.password) throw new Error("Credentials belong in a token file, not the URL");
  return url.origin;
}
export async function requestBackend(path:string,opts:{method?:string;body?:unknown;job?:boolean;env?:NodeJS.ProcessEnv}={}) {
  const env=opts.env??process.env;
  const response=await fetch(`${backendUrl(env)}${path}`, {method:opts.method??"GET",redirect:"error",signal:AbortSignal.timeout(60_000),
    headers:{authorization:`Bearer ${machineToken(env,opts.job?"JOB":"INTERACTIVE")}`,"content-type":"application/json"},
    ...(opts.body===undefined?{}:{body:JSON.stringify(opts.body)})});
  const body=await response.json() as any;
  if(!response.ok) throw new Error(body.error??`LifeOS backend returned ${response.status}`);
  return body;
}

/** Byte-protocol bridge. It never opens local data and never starts a second application writer. */
export async function bridgeStdio(url:string,env:NodeJS.ProcessEnv=process.env):Promise<void> {
  const transport=new StreamableHTTPClientTransport(new URL(`${backendUrl({...env,LIFE_OS_BACKEND_URL:url})}/mcp`),{
    requestInit:{headers:{authorization:`Bearer ${machineToken(env,"INTERACTIVE")}`}},
  });
  const stdio=new StdioServerTransport();
  transport.onmessage=message=>{void stdio.send(message);};
  stdio.onmessage=message=>{void transport.send(message).catch(error=>{
    console.error("LifeOS backend disconnected:",error.message); process.exitCode=1; void stdio.close();
  });};
  transport.onerror=error=>console.error("LifeOS backend:",error.message);
  stdio.onclose=()=>{void transport.close();};
  // A read-only probe makes an unavailable server fail before an agent waits indefinitely.
  await requestBackend("/readyz",{env:{...env,LIFE_OS_BACKEND_URL:url}});
  await transport.start(); await stdio.start();
}

export async function callRemoteTool(name:string,args:Record<string,unknown>,env=process.env) {
  const client=new Client({name:"life-os-cli",version:"0.2.0"});
  const transport=new StreamableHTTPClientTransport(new URL(`${backendUrl(env)}/mcp`),{requestInit:{headers:{authorization:`Bearer ${machineToken(env,"INTERACTIVE")}`}}});
  try {await client.connect(transport); return await client.callTool({name,arguments:args});}
  finally {await client.close();}
}
