import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "tsup";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import buildOptions from "../../tsup.config.js";

const exec = promisify(execFile);
const project = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "lifeos-cli-imports-"));
const localData = join(temporary, "forbidden-local-data");
const preload = join(temporary, "guard.mjs");
const entry = join(temporary, "dist", "index.js");
const token = "synthetic-bridge-test-" + "x".repeat(32);
const env = {
  PATH: dirname(process.execPath), HOME: join(temporary, "empty-home"),
  LIFE_OS_HOME: localData, LIFE_OS_INTERACTIVE_TOKEN: token,
};
let base = "";
const calls: Array<{ name: string; arguments: unknown }> = [];

// A synthetic remote MCP endpoint. No daemon, local tracker, Google clients, or real data.
const backend = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return; }
  res.setHeader("content-type", "application/json");
  if (req.method === "GET" && req.url === "/readyz") { res.end('{"ready":true}'); return; }
  if (req.method === "GET" && req.url === "/v1/jobs") { res.end('{"runs":[]}'); return; }
  if (req.method === "GET" && req.url === "/v1/automation") { res.end('{"runs":[],"configured":false}'); return; }
  if (req.method !== "POST" || req.url !== "/mcp") { res.writeHead(405).end(); return; }
  let raw = "";
  for await (const chunk of req) raw += chunk.toString();
  const message = JSON.parse(raw);
  if (message.id === undefined) { res.writeHead(202).end(); return; }
  let result: unknown;
  if (message.method === "initialize") {
    result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } };
  } else if (message.method === "tools/list") {
    result = { tools: [{ name: "track_status", inputSchema: { type: "object" } }] };
  } else if (message.method === "tools/call") {
    calls.push(message.params);
    result = { content: [{ type: "text", text: "synthetic remote result" }] };
  } else {
    res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Unknown method" } })); return;
  }
  res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
});

beforeAll(async () => {
  // Use the production config, including ESM splitting: source-only mocks would miss
  // an eager Google/storage import accidentally hoisted into a shared build chunk.
  symlinkSync(join(project, "node_modules"), join(temporary, "node_modules"), "dir");
  writeFileSync(join(temporary, "package.json"), '{"type":"module"}');
  await build({ ...buildOptions, config: false, outDir: join(temporary, "dist"), silent: true });
  writeFileSync(join(temporary, "loader.mjs"), `
export async function resolve(specifier, context, next) {
  if (/^(googleapis|google-auth-library)(\\/|$)/.test(specifier) || specifier === 'node:sqlite') {
    throw new Error('FORBIDDEN_HEAVY_IMPORT: ' + specifier);
  }
  return next(specifier, context);
}
`);
  writeFileSync(preload, `
import { register, syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
register(new URL('./loader.mjs', import.meta.url));
function guard(path) {
  if (path instanceof URL) path = fileURLToPath(path);
  if (Buffer.isBuffer(path)) path = path.toString();
  const home = process.env.LIFE_OS_HOME;
  if (typeof path === 'string' && (path === home || path.startsWith(home + '/'))) {
    throw new Error('FORBIDDEN_LOCAL_STORAGE_ACCESS');
  }
}
for (const api of [fs, fsp]) {
  for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'stat', 'statSync', 'lstat', 'lstatSync', 'access', 'accessSync', 'existsSync', 'mkdir', 'mkdirSync', 'readdir', 'readdirSync', 'writeFile', 'writeFileSync']) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name];
    api[name] = function(path, ...args) { guard(path); return original.call(this, path, ...args); };
  }
}
syncBuiltinESMExports();
`);
  await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
}, 30_000);

afterAll(async () => {
  backend.closeAllConnections();
  await new Promise<void>(resolve => backend.close(() => resolve()));
  rmSync(temporary, { recursive: true, force: true });
});

async function command(args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const result = await exec(process.execPath, ["--import", preload, entry, ...args], {
    env: { ...env, ...extraEnv }, timeout: 8_000, maxBuffer: 100_000,
  });
  expect(result.stderr).not.toMatch(/FORBIDDEN_/);
  expect(existsSync(localData)).toBe(false);
  return result;
}

describe("bundled command import isolation", () => {
  it.each([["--help"], ["help"]])("prints help without loading local application dependencies: %s", async (...args) => {
    expect((await command(args)).stdout).toContain("Remote stdio bridge");
  });

  it.each(["flag", "environment"])("serves remote MCP over stdio without Google or local storage (%s)", async source => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", preload, entry, "serve", ...(source === "flag" ? ["--connect", base] : [])],
      env: { ...env, ...(source === "environment" ? { LIFE_OS_BACKEND_URL: base } : {}) }, stderr: "pipe",
    });
    let stderr = "";
    transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
    const client = new Client({ name: "import-isolation", version: "1" });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(["track_status"]);
      expect(await client.callTool({ name: "track_status", arguments: {} })).toMatchObject({ content: [{ text: "synthetic remote result" }] });
      expect(stderr).not.toMatch(/FORBIDDEN_/);
      expect(existsSync(localData)).toBe(false);
    } finally { await client.close(); }
  }, 15_000);

  it("routes remote tracker arguments without importing the local tracker", async () => {
    expect((await command(["track", "start", "Synthetic", "task", "--note", "test", "--connect", base])).stdout).toContain("synthetic remote result");
    expect(calls.at(-1)).toEqual({ name: "track_start", arguments: { task: "Synthetic task", note: "test" } });
    await command(["track", "report", "this-week"], { LIFE_OS_BACKEND_URL: base });
    expect(calls.at(-1)).toEqual({ name: "track_report", arguments: { range: "this_week" } });
  });

  it("loads remote jobs and automation status without loading the daemon", async () => {
    expect(JSON.parse((await command(["jobs", "status", "--connect", base])).stdout)).toEqual({ runs: [] });
    expect(JSON.parse((await command(["automation", "status"], { LIFE_OS_BACKEND_URL: base })).stdout)).toEqual({ runs: [], configured: false });
  });

  it("starts the isolated agent runner without Google clients or LifeOS storage", async () => {
    const socket = join(temporary, "agent.sock");
    const child = spawn(process.execPath, ["--import", preload, entry, "agent-runner"], {
      env: { ...env, LIFE_OS_AGENT_HOME: join(temporary, "agent-home"), LIFE_OS_AGENT_SOCKET: socket, LIFE_OS_CLAUDE_BIN: join(temporary, "unused-claude") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    const closed = new Promise<number | null>(resolve => child.once("close", resolve));
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Runner did not start: " + stderr)), 5_000);
        child.stderr.on("data", chunk => {
          stderr += chunk.toString();
          if (stderr.includes("LifeOS Claude runner ready")) { clearTimeout(timeout); resolve(); }
        });
        child.once("error", error => { clearTimeout(timeout); reject(error); });
        child.once("exit", () => { clearTimeout(timeout); reject(new Error("Runner exited: " + stderr)); });
      });
      const health = await new Promise<string>((resolve, reject) => {
        const req = request({ socketPath: socket, path: "/health" }, res => {
          let body = ""; res.on("data", chunk => { body += chunk.toString(); }); res.on("end", () => resolve(body));
        });
        req.on("error", reject); req.end();
      });
      expect(JSON.parse(health)).toEqual({ ready: true, busy: false });
      expect(stderr).not.toMatch(/FORBIDDEN_/);
      expect(existsSync(localData)).toBe(false);
    } finally { child.kill("SIGTERM"); await closed; }
  }, 10_000);
});
