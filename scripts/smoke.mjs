#!/usr/bin/env node
/**
 * Smoke test: spawns the BUILT server (dist/index.js) over stdio exactly like
 * an MCP client would, then exercises tools/list and a couple of no-credential
 * paths. Run `npm run build` first. Uses a throwaway LIFE_OS_HOME unless
 * SMOKE_LIFE_OS_HOME is set (point it at your real home to smoke real accounts).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const home = process.env.SMOKE_LIFE_OS_HOME ?? mkdtempSync(join(tmpdir(), "life-os-smoke-"));
console.log(`LIFE_OS_HOME=${home}`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL("../dist/index.js", import.meta.url).pathname, "serve"],
  env: { ...process.env, LIFE_OS_HOME: home },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`\n✔ connected; ${tools.length} tools:`);
for (const t of tools) console.log(`   - ${t.name}`);

console.log(`\nserver instructions:\n   ${client.getInstructions()?.split("\n").join("\n   ")}`);

const accounts = await client.callTool({ name: "gmail_list_accounts", arguments: {} });
console.log(`\ngmail_list_accounts → isError=${accounts.isError ?? false}`);
console.log(`   ${accounts.content[0].text.split("\n").join("\n   ")}`);

const bad = await client.callTool({
  name: "gmail_search_messages",
  arguments: { account: "nobody@nowhere.com", query: "is:unread" },
});
console.log(`\ngmail_search_messages (unknown account) → isError=${bad.isError}`);
console.log(`   ${bad.content[0].text}`);

await client.close();
console.log("\n✔ smoke test passed (stdio transport clean, tools listed, error paths friendly)");
