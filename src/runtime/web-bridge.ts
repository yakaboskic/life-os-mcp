import { createServer } from "node:http";
import { equalToken } from "./security.js";

/** Separate read-only listener on the VM's private interface, never the public interface. */
export function createPrivateWebBridge(token:string,privateHost:string,webPort:number) {
  if(token.length<32 || !/^10\.53\.0\.\d+$/.test(privateHost)) throw new Error("Private web bridge requires a dedicated token and LifeOS VPC address");
  const allowed=new Set(["/api/data","/api/triage","/api/jobs"]);
  return createServer(async(req,res)=>{
    res.setHeader("cache-control","private, no-store");
    if(req.headers.origin || req.headers.host!==`${privateHost}:4749` || !equalToken(req.headers.authorization??"",`Bearer ${token}`)) {res.writeHead(403).end();return;}
    if(req.method!=="GET" || !allowed.has(req.url??"")) {res.writeHead(404).end();return;}
    try {
      const upstream=await fetch(`http://127.0.0.1:${webPort}${req.url}`,{redirect:"error",signal:AbortSignal.timeout(15_000)});
      if(!upstream.ok) {res.writeHead(502).end();return;}
      const data=await upstream.text();
      res.writeHead(200,{"content-type":"application/json","x-content-type-options":"nosniff"}).end(data);
    } catch {res.writeHead(503).end(JSON.stringify({error:"LifeOS unavailable"}));}
  });
}
