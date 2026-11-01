import { describe, it, expect } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import { ClaudeProvider, StructuredOutputError, apiCompatibleSchema, briefJsonSchema, briefSchema, reviewJsonSchema, reviewSchema, validateStructuredOutput } from "../../src/automation/provider.js";
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
  it("sends API-compatible bounds in descriptions while retaining strict local validation", async () => {
    let sent: any;
    const provider = new ClaudeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-only" }), (async (_url, init) => {
      sent = JSON.parse(init!.body as string);
      return Response.json(response({ content: [{ type: "text", text: JSON.stringify({ ...validBrief, summary: "x".repeat(1201) }) }] }));
    }) as typeof fetch);
    await expect(provider.brief({ day: "2026-11-01", now: "2026-11-01T12:00:00Z", sources: [], coverage: [] }, new AbortController().signal)).rejects.toMatchObject({ message: "CLAUDE_INVALID_STRUCTURED_OUTPUT", issues: [{ path: "$.summary", code: "too_big" }] });
    const schema = sent.output_config.format.schema;
    expect(schema.properties.summary).toMatchObject({ type: "string", description: expect.stringContaining('"maxLength":1200') });
    expect(schema.properties.summary.maxLength).toBeUndefined();
    expect(schema.properties.priorities.maxItems).toBeUndefined();
    expect(schema.properties.priorities.items.properties.sourceIds.minItems).toBe(1);
    expect(schema.properties.priorities.items.properties.sourceIds.items.description).toContain('"maxLength":150');
    expect(sent.system).toContain("one to five exact supplied sourceIds");
  });
  it("reports invalid JSON without retaining parser excerpts", async () => {
    const provider = new ClaudeProvider(loadConfig({ ANTHROPIC_API_KEY: "test-only" }), (async () => Response.json(response({ content: [{ type: "text", text: "private email contents" }] }))) as typeof fetch);
    await expect(provider.review(context, new AbortController().signal)).rejects.toMatchObject({ message: "CLAUDE_INVALID_STRUCTURED_OUTPUT", issues: [{ path: "$", code: "invalid_json" }] });
  });
});

const validBrief = { title: "Today", summary: "Review the synthetic task.", priorities: [{ title: "Review task", detail: "Check the supplied record.", sourceIds: ["task:1"] }], notes: ["Synthetic coverage."] };
type OutputKind = "brief" | "review";
type Path = Array<string | number>;
function fixture(kind: OutputKind): any { return structuredClone(kind === "brief" ? validBrief : value); }
function setField(target: any, path: Path, replacement: unknown) { const last = path.at(-1)!; for (const part of path.slice(0, -1)) target = target[part]; target[last] = replacement; }
const schemas = { brief: { json: briefJsonSchema, zod: briefSchema }, review: { json: reviewJsonSchema, zod: reviewSchema } };
const ajv = new AjvJsonSchemaValidator();
// Validate the serialized draft-07 payload, just as the CLI receives it.
const validators = { brief: ajv.getValidator(JSON.parse(JSON.stringify(briefJsonSchema))), review: ajv.getValidator(JSON.parse(JSON.stringify(reviewJsonSchema))) };
const stringCases: Array<[OutputKind, Path, number, number]> = [
  ["brief", ["title"], 1, 120], ["brief", ["summary"], 1, 1200],
  ["brief", ["priorities", 0, "title"], 1, 160], ["brief", ["priorities", 0, "detail"], 1, 700],
  ["brief", ["priorities", 0, "sourceIds", 0], 1, 150], ["brief", ["notes", 0], 1, 500],
  ["review", ["itemId"], 1, 100], ["review", ["revision"], 64, 64], ["review", ["reason"], 1, 600],
  ["review", ["evidence", 0, "messageId"], 1, 100], ["review", ["evidence", 0, "quote"], 12, 240]
];
describe("Claude schema and validation parity", () => {
  it.each(stringCases)("enforces %s %j string boundaries in the CLI schema and final validator", (kind, path, min, max) => {
    for (const length of [min - 1, min, max, max + 1]) {
      const output = fixture(kind); setField(output, path, "x".repeat(length));
      expect(validators[kind](output).valid).toBe(length >= min && length <= max);
      expect(schemas[kind].zod.safeParse(output).success).toBe(length >= min && length <= max);
    }
  });
  it.each<[OutputKind, Path, number, number]>([
    ["brief", ["priorities"], 0, 5], ["brief", ["notes"], 0, 6],
    ["brief", ["priorities", 0, "sourceIds"], 1, 5], ["review", ["evidence"], 0, 3]
  ])("enforces %s %j array boundaries in both validators", (kind, path, min, max) => {
    const original = fixture(kind); let entries = original; for (const part of path) entries = entries[part];
    for (const length of [0, min, max, max + 1]) {
      const output = fixture(kind); setField(output, path, Array.from({ length }, () => structuredClone(entries[0])));
      expect(validators[kind](output).valid).toBe(length >= min && length <= max);
      expect(schemas[kind].zod.safeParse(output).success).toBe(length >= min && length <= max);
    }
  });
  it("enforces numeric bounds, strict objects and exact enum values", () => {
    for (const confidence of [-0.01, 0, 1, 1.01]) {
      const output = { ...value, confidence };
      expect(validators.review(output).valid).toBe(confidence >= 0 && confidence <= 1);
      expect(reviewSchema.safeParse(output).success).toBe(confidence >= 0 && confidence <= 1);
    }
    for (const output of [{ ...value, category: "injected" }, { ...value, policyVersion: "future" }, { ...value, extra: "private" }, { ...value, evidence: [{ ...value.evidence[0], extra: "private" }] }]) {
      expect(validators.review(output).valid).toBe(false); expect(reviewSchema.safeParse(output).success).toBe(false);
    }
    const extra = { ...validBrief, priorities: [{ ...validBrief.priorities[0], extra: "private" }] };
    expect(validators.brief(extra).valid).toBe(false); expect(briefSchema.safeParse(extra).success).toBe(false);
  });
  it("projects unsupported API constraints without mutating complete CLI schemas", () => {
    const before = JSON.stringify(schemas);
    for (const { json } of Object.values(schemas)) {
      const visit = (node: any) => {
        for (const key of ["minLength", "maxLength", "minimum", "maximum", "maxItems"]) expect(node[key]).toBeUndefined();
        if (node.minItems !== undefined) expect([0, 1]).toContain(node.minItems);
        if (node.type === "object") { expect(node.additionalProperties).toBe(false); for (const child of Object.values(node.properties)) visit(child); }
        if (node.items) visit(node.items);
      };
      visit(apiCompatibleSchema(json));
    }
    expect(JSON.stringify(schemas)).toBe(before);
  });
  it("diagnostics expose only bounded field paths and codes, never values or unknown keys", () => {
    let error: unknown;
    try { validateStructuredOutput(briefSchema, { ...validBrief, summary: "private email body".repeat(80), "private subject": "secret" }); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(StructuredOutputError);
    expect((error as StructuredOutputError).issues).toEqual([{ path: "$.summary", code: "too_big" }, { path: "$", code: "unrecognized_keys" }]);
    expect(JSON.stringify(error)).not.toMatch(/private|secret/);
    const bounded = new StructuredOutputError(Array.from({ length: 100 }, () => ({ path: ["private subject", "notes", 0, ...Array(20).fill("private email")], code: "private message" })));
    expect(bounded.issues).toHaveLength(12);
    expect(JSON.stringify(bounded)).not.toContain("private");
  });
});
