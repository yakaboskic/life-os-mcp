import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server, type ServerResponse } from "node:http";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";

const token = "synthetic-bridge-token-" + "x".repeat(40);
const entry = `import {bridgeStdio} from ${JSON.stringify(pathToFileURL(join(process.cwd(), "src/runtime/client.ts")).href)}; try { await bridgeStdio(process.env.LIFE_OS_BACKEND_URL, process.env); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
type Exit = { code: number | null; signal: NodeJS.Signals | null };
interface BridgeChild { child: ChildProcessWithoutNullStreams; frames: any[]; stderr: string; invalidLines: string[]; exit?: Exit; exited: Promise<Exit>; home: string }
interface RequestRecord { path: string; method: string; authorization?: string; body?: any; response: ServerResponse; closed: boolean }
const children: BridgeChild[] = [], servers: Server[] = [], roots: string[] = [];
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until<T>(read: () => T | undefined | false, message: string, timeout = 4000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) { const result = read(); if (result !== undefined && result !== false) return result; if (Date.now() >= deadline) throw new Error(message); await delay(10); }
}
function json(res: ServerResponse, value: unknown, status = 200) { res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value)); }
async function backend(options: { hangReady?: boolean; readyStatus?: number; failMcp?: number } = {}) {
  const requests: RequestRecord[] = [];
  const server = createServer(async (req, res) => {
    const record: RequestRecord = { path: req.url ?? "", method: req.method ?? "", authorization: req.headers.authorization, response: res, closed: false };
    requests.push(record); res.on("close", () => { record.closed = true; });
    if (record.path === "/readyz") { if (!options.hangReady) json(res, { ok: options.readyStatus === undefined, error: "Synthetic unavailable backend" }, options.readyStatus ?? 200); return; }
    if (record.path !== "/mcp") { res.writeHead(404).end(); return; }
    if (req.method === "GET") { res.writeHead(405, { allow: "POST" }).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    record.body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (options.failMcp) { json(res, { error: "Synthetic transport failure" }, options.failMcp); return; }
    const { id, method, params } = record.body;
    if (id === undefined) { res.writeHead(202).end(); return; }
    if (params?.arguments?.hang) return;
    if (method === "initialize") json(res, { jsonrpc: "2.0", id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "synthetic-lifeos", version: "1" } } });
    else if (method === "tools/list") json(res, { jsonrpc: "2.0", id, result: { tools: [{ name: "echo", description: "Synthetic echo", inputSchema: { type: "object" } }] } });
    else if (method === "tools/call" && params.name === "fail") json(res, { jsonrpc: "2.0", id, error: { code: -32602, message: "Synthetic tool error" } });
    else if (method === "tools/call") json(res, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: params.arguments?.large ? "x".repeat(1024 * 1024) : JSON.stringify(params.arguments) }] } });
    else json(res, { jsonrpc: "2.0", id, result: {} });
  });
  servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { requests, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
function bridge(url: string): BridgeChild {
  const root = mkdtempSync(join(tmpdir(), "lifeos-bridge-test-")); roots.push(root); const home = join(root, "must-not-create");
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", entry], {
    cwd: process.cwd(), env: { ...process.env, LIFE_OS_BACKEND_URL: url, LIFE_OS_HOME: home, LIFE_OS_INTERACTIVE_TOKEN: token, LIFE_OS_INTERACTIVE_TOKEN_FILE: "", NODE_NO_WARNINGS: "1" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const result = { child, frames: [], stderr: "", invalidLines: [], home } as unknown as BridgeChild;
  result.exited = new Promise<Exit>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => { result.exit = { code, signal }; resolve(result.exit); }); });
  let pending = "";
  child.stdout.setEncoding("utf8"); child.stdout.on("data", chunk => { pending += chunk; for (;;) { const end = pending.indexOf("\n"); if (end < 0) break; const line = pending.slice(0, end); pending = pending.slice(end + 1); try { result.frames.push(JSON.parse(line)); } catch { result.invalidLines.push(line); } } });
  child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { result.stderr += chunk; });
  child.stdin.on("error", () => { /* A controlled failure may close before an attempted fixture write. */ });
  children.push(result); return result;
}
function send(target: BridgeChild, message: unknown) { target.child.stdin.write(JSON.stringify(message) + "\n"); }
async function response(target: BridgeChild, id: string | number) { return until(() => target.frames.find(frame => frame.id === id), `Missing MCP response ${id}; stderr=${target.stderr}`); }
async function initialize(target: BridgeChild) {
  send(target, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "synthetic-agent", version: "1" } } });
  const result = await response(target, 1); expect(result.result.serverInfo.name).toBe("synthetic-lifeos");
  send(target, { jsonrpc: "2.0", method: "notifications/initialized" });
}
async function exited(target: BridgeChild) {
  try { return await until(() => target.exit, "Bridge did not exit", 2500); }
  catch { throw new Error(`Bridge did not exit; stderr=${target.stderr}`); }
}

afterEach(async () => {
  for (const target of children.splice(0)) {
    target.child.stdin.destroy();
    if (!target.exit) target.child.kill("SIGTERM");
    await Promise.race([target.exited.catch(() => {}), delay(500)]);
    if (!target.exit) target.child.kill("SIGKILL");
    await target.exited.catch(() => {});
    target.child.stdout.destroy(); target.child.stderr.destroy();
  }
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); })));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("remote stdio bridge lifecycle", () => {
  it("forwards MCP requests and errors, tolerates unsupported SSE, and preserves a valid idle connection", async () => {
    const upstream = await backend(), target = bridge(upstream.url);
    await initialize(target);
    send(target, { jsonrpc: "2.0", id: "tools", method: "tools/list" }); expect((await response(target, "tools")).result.tools[0].name).toBe("echo");
    send(target, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fail", arguments: {} } }); expect((await response(target, 3)).error.message).toBe("Synthetic tool error");
    await until(() => upstream.requests.find(request => request.path === "/mcp" && request.method === "GET"), "SDK did not attempt optional SSE");
    await delay(250); expect(target.exit).toBeUndefined();
    send(target, { jsonrpc: "2.0", id: "after-idle", method: "tools/call", params: { name: "echo", arguments: { note: "still connected" } } }); expect((await response(target, "after-idle")).result.content[0].text).toContain("still connected");
    expect(upstream.requests.every(request => request.authorization === `Bearer ${token}`)).toBe(true);
    expect(target.invalidLines).toEqual([]); expect(existsSync(target.home)).toBe(false);
    target.child.stdin.end(); expect(await exited(target)).toEqual({ code: 0, signal: null });
  });

  it("exits on immediate EOF without starting a local data store", async () => {
    const upstream = await backend({ hangReady: true }), target = bridge(upstream.url);
    target.child.stdin.end(); expect(await exited(target)).toEqual({ code: 0, signal: null });
    expect(upstream.requests.filter(request => request.path === "/mcp")).toHaveLength(0); expect(existsSync(target.home)).toBe(false);
  });

  it("aborts a hung readiness probe when stdin ends", async () => {
    const upstream = await backend({ hangReady: true }), target = bridge(upstream.url);
    const request = await until(() => upstream.requests.find(request => request.path === "/readyz"), "Readiness probe did not start");
    target.child.stdin.end(); expect(await exited(target)).toEqual({ code: 0, signal: null });
    await until(() => request.closed, "Readiness connection remained open after EOF"); expect(target.frames).toEqual([]);
  });

  it("aborts an in-flight MCP request on EOF without replaying it", async () => {
    const upstream = await backend(), target = bridge(upstream.url); await initialize(target);
    send(target, { jsonrpc: "2.0", id: "hanging", method: "tools/call", params: { name: "echo", arguments: { hang: true } } });
    const request = await until(() => upstream.requests.find(request => request.body?.id === "hanging"), "MCP request did not start");
    target.child.stdin.end(); expect(await exited(target)).toEqual({ code: 0, signal: null }); await until(() => request.closed, "MCP connection remained open after EOF");
    expect(upstream.requests.filter(request => request.body?.id === "hanging")).toHaveLength(1);
  });

  it("terminates a broken output pipe even while the input pipe remains open", async () => {
    const upstream = await backend(), target = bridge(upstream.url); await initialize(target);
    send(target, { jsonrpc: "2.0", id: "broken-output", method: "tools/call", params: { name: "echo", arguments: { hang: true } } });
    const request = await until(() => upstream.requests.find(request => request.body?.id === "broken-output"), "MCP request did not start");
    expect(target.child.stdin.writableEnded).toBe(false);
    target.child.stdout.destroy(); await delay(25); json(request.response, { jsonrpc: "2.0", id: "broken-output", result: { content: [{ type: "text", text: "Synthetic response" }] } });
    const result = await exited(target); expect(result.signal).toBeNull(); expect(result.code).not.toBe(0);
  });

  it("fails closed on backend HTTP errors without writing local data or protocol noise", async () => {
    const upstream = await backend({ failMcp: 503 }), target = bridge(upstream.url);
    send(target, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect((await exited(target)).code).not.toBe(0); expect(existsSync(target.home)).toBe(false); expect(target.invalidLines).toEqual([]);
    expect(upstream.requests.filter(request => request.path === "/mcp" && request.method === "POST")).toHaveLength(1);
  });

  it("fails a rejected readiness probe without starting local data or sending MCP requests", async () => {
    const upstream = await backend({ readyStatus: 401 }), target = bridge(upstream.url);
    expect((await exited(target)).code).not.toBe(0); expect(target.frames).toEqual([]); expect(existsSync(target.home)).toBe(false);
    expect(upstream.requests.filter(request => request.path === "/mcp")).toHaveLength(0);
  });

  it("bounds an unterminated input frame while readiness is stalled", async () => {
    const upstream = await backend({ hangReady: true }), target = bridge(upstream.url);
    const request = await until(() => upstream.requests.find(request => request.path === "/readyz"), "Readiness probe did not start");
    target.child.stdin.write("x".repeat(1024 * 1024 + 1));
    expect((await exited(target)).code).not.toBe(0); expect(target.stderr).toContain("exceeds 1 MiB");
    await until(() => request.closed, "Oversized frame left readiness connected");
    expect(upstream.requests.filter(request => request.path === "/mcp")).toHaveLength(0);
  });

  it("bounds queued requests before readiness and aborts the pending probe", async () => {
    const upstream = await backend({ hangReady: true }), target = bridge(upstream.url);
    const request = await until(() => upstream.requests.find(request => request.path === "/readyz"), "Readiness probe did not start");
    for (let id = 0; id < 33; id++) send(target, { jsonrpc: "2.0", id, method: "tools/list" });
    expect((await exited(target)).code).not.toBe(0); expect(target.stderr).toContain("Too many pending MCP requests");
    await until(() => request.closed, "Request flood left readiness connected");
    expect(upstream.requests.filter(request => request.path === "/mcp")).toHaveLength(0);
  });

  it("bounds a flood of in-flight requests without replaying any call", async () => {
    const upstream = await backend(), target = bridge(upstream.url); await initialize(target);
    send(target, { jsonrpc: "2.0", id: "ready", method: "tools/list" }); await response(target, "ready");
    for (let id = 100; id < 132; id++) send(target, { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: { hang: true } } });
    await until(() => upstream.requests.filter(request => request.body?.id >= 100).length === 32, "Calls did not all reach the upstream server");
    send(target, { jsonrpc: "2.0", id: 132, method: "tools/call", params: { name: "echo", arguments: { hang: true } } });
    expect((await exited(target)).code).not.toBe(0); expect(target.stderr).toContain("Too many pending MCP requests");
    const sent = upstream.requests.filter(request => request.body?.id >= 100);
    expect(sent).toHaveLength(32);
    expect(new Set(sent.map(request => request.body.id)).size).toBe(sent.length);
    await until(() => sent.every(request => request.closed), "Request flood left MCP connections open");
  });

  it("exits when a connected client stops reading a growing response backlog", async () => {
    const upstream = await backend(), target = bridge(upstream.url); await initialize(target);
    target.child.stdout.pause();
    for (let id = 200; id < 212; id++) send(target, { jsonrpc: "2.0", id, method: "tools/call", params: { name: "echo", arguments: { large: true } } });
    expect((await exited(target)).code).not.toBe(0); expect(target.stderr).toContain("not reading MCP responses");
  });

  it.each(["SIGTERM", "SIGINT", "SIGHUP"] as const)("cleans up in-flight work on %s", async signal => {
    const upstream = await backend({ hangReady: true }), target = bridge(upstream.url);
    const request = await until(() => upstream.requests.find(request => request.path === "/readyz"), "Readiness probe did not start");
    target.child.kill(signal); await exited(target); await until(() => request.closed, "Signal left the HTTP request open"); expect(target.invalidLines).toEqual([]);
  });
});
