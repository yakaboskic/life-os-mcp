import { it,expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { createDaemon } from "../../src/runtime/daemon.js";
import { createTrackToolset } from "../../src/toolsets/track/index.js";
it("shares tracker state across remote clients and enforces machine capabilities and drain",async()=>{
  const interactive="interactive-"+"a".repeat(40),job="job-"+"b".repeat(40);
  const c=loadConfig({LIFE_OS_HOME:mkdtempSync(join(tmpdir(),"lifeos-daemon-")),LIFE_OS_INTERACTIVE_TOKEN:interactive,LIFE_OS_JOB_TOKEN:job});
  const app=await createDaemon(c,createLogger("error"),{toolsets:[createTrackToolset()]});
  await new Promise<void>(r=>app.server.listen(0,"127.0.0.1",r));
  await new Promise<void>(r=>app.web.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const webBase=`http://127.0.0.1:${(app.web.address() as AddressInfo).port}`;
  const clients:Client[]=[];
  try {
    expect((await fetch(base+"/readyz")).status).toBe(401);
    expect((await fetch(base+"/readyz",{headers:{authorization:`Bearer ${interactive}`,origin:"https://evil.example"}})).status).toBe(403);
    expect((await fetch(base+"/mcp",{method:"POST",headers:{authorization:`Bearer ${job}`}})).status).toBe(403);
    for(let n=0;n<2;n++) {const client=new Client({name:"test",version:"1"});clients.push(client);await client.connect(new StreamableHTTPClientTransport(new URL(base+"/mcp"),{requestInit:{headers:{authorization:`Bearer ${interactive}`}}}));}
    const added=await clients[0]!.callTool({name:"track_add_task",arguments:{title:"Shared remote task"}});expect(added.isError).toBeFalsy();
    const list=await clients[1]!.callTool({name:"track_overview",arguments:{}});expect(JSON.stringify(list)).toContain("Shared remote task");
    const snapshot=await(await fetch(webBase+"/api/data")).json() as any;
    expect(snapshot.capabilities).toEqual({actions:false,automation:true});
    const headers={authorization:`Bearer ${interactive}`,"content-type":"application/json"};
    const start={requestId:"cross-client-start",action:"timer.start",input:{taskId:snapshot.tasks[0].id,expectedTimerRevision:null}};
    expect((await fetch(base+"/v1/actions",{method:"POST",headers,body:JSON.stringify(start)})).status).toBe(200);
    const focus=await clients[1]!.callTool({name:"lifeos_snapshot",arguments:{}});
    expect(JSON.stringify(focus)).toContain("activeTimer");
    const active=await(await fetch(webBase+"/api/data")).json() as any;
    expect(active.activeTimer.taskId).toBe(snapshot.tasks[0].id);
    expect((await fetch(webBase+"/api/actions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(start)})).status).toBe(405);
    expect((await fetch(base+"/v1/actions",{method:"POST",headers:{...headers,authorization:`Bearer ${job}`},body:JSON.stringify(start)})).status).toBe(403);
    await clients[0]!.callTool({name:"track_cancel",arguments:{}});
    const stale=await fetch(base+"/v1/actions",{method:"POST",headers,body:JSON.stringify({requestId:"cross-client-stale",action:"timer.stop",input:{expectedTimerRevision:active.activeTimer.revision}})});
    expect(stale.status).toBe(409);
    const denied=await fetch(base+"/v1/jobs",{method:"POST",headers:{authorization:`Bearer ${job}`,"content-type":"application/json"},body:JSON.stringify({name:"gmail-triage",mode:"apply"})});expect(denied.status).toBe(409);
    await fetch(base+"/v1/admin/drain",{method:"POST",headers:{authorization:`Bearer ${interactive}`}});
    const blocked=await clients[0]!.callTool({name:"track_add_task",arguments:{title:"Blocked"}});expect(blocked.isError).toBe(true);
    expect((await fetch(base+"/v1/actions",{method:"POST",headers,body:JSON.stringify(start)})).status).toBe(503);
    const ready=await fetch(base+"/readyz",{headers:{authorization:`Bearer ${interactive}`}});expect(await ready.json()).toMatchObject({draining:true,activeJobs:0,activeRequests:0});
  } finally {for(const client of clients) await client.close();await app.close();}
});
