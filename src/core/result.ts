import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Success result. Objects are serialized as JSON (1-space indent: readable, token-lean). */
export function ok(value: unknown): CallToolResult {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}
