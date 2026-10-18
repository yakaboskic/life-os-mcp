import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { ClaudeProvider } from "../../src/automation/provider.js";
import type { AgentReviewContext } from "../../src/jobs/types.js";
const context: AgentReviewContext = { itemId: "work1", revision: "a".repeat(64), policyVersion: "lifeos-review-v1", account: "owner@example.com", now: "2026-10-18T12:00:00Z", triggerIds: ["message1"], thread: { id: "thread1", messages: [] } };
const value = { itemId: context.itemId, revision: context.revision, policyVersion: context.policyVersion, category: "ACTION/NOW", confidence: 0.99, clear: true, needsMoreContext: false, reason: "Explicit request", evidence: [{ messageId: "message1", quote: "Please review the proposal." }] };
const response = (extra = {}) => ({ model: "claude-sonnet-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], usage: { input_tokens: 100, output_tokens: 100 }, ...extra });

describe("bounded Claude API adapter", () => {
  it("uses structured output with no tools and returns validated usage", async () => {
    let request: any;
    const provider = new ClaudeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-only" }), (async (_url, init) => { request = JSON.parse(init!.body as string); return Response.json(response()); }) as typeof fetch);
    const result = await provider.review(context, new AbortController().signal); expect(result.value).toEqual(value); expect(request.tools).toBeUndefined(); expect(request.output_config.format.type).toBe("json_schema"); expect(request.max_tokens).toBe(1400); expect(request.system).toContain("untrusted DATA");
  });
  it.each([
    response({ stop_reason: "max_tokens" }), response({ model: "different-model" }),
    response({ content: [{ type: "tool_use", id: "x" }] }), response({ usage: { input_tokens: -1, output_tokens: 2 } }),
    response({ content: [{ type: "text", text: JSON.stringify({ ...value, confidence: 1.1 }) }] }),
    response({ content: [{ type: "text", text: JSON.stringify({ ...value, action: "send_email" }) }] }),
  ])("rejects unsafe, truncated, mismatched or malformed responses", async raw => {
    const provider = new ClaudeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-only" }), (async () => Response.json(raw)) as typeof fetch);
    await expect(provider.review(context, new AbortController().signal)).rejects.toThrow(/CLAUDE_/);
  });
  it("does not implicitly retry a rate-limit response or expose response bodies", async () => {
    let calls = 0;
    const provider = new ClaudeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-only" }), (async () => { calls++; return new Response("sensitive upstream detail", { status: 429 }); }) as typeof fetch);
    await expect(provider.review(context, new AbortController().signal)).rejects.toThrow("CLAUDE_HTTP_429"); expect(calls).toBe(1);
  });
});
