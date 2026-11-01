import { describe, expect, it, vi } from "vitest";
import { JevClassifier, parseDecision } from "../../src/jobs/jev.js";
import { CATEGORIES } from "../../src/jobs/types.js";

function response() { return { model: "jev-1.13.0", answers: { category: { type: "choice", choice: "FYI/READ", confidence: 0.97, probabilities: Object.fromEntries(CATEGORIES.map((category) => [category, category === "FYI/READ" ? 1 : 0])) } }, usage: { input_tokens: 123 } }; }
const input = { account: "test@example.com", now: "2026-11-01T10:53:00Z", timeZone: "America/New_York", thread: { id: "thread", messages: [] } };
describe("Jev typed classifier", () => {
  it("validates the exact category distribution, confidence and highest probability choice", () => {
    expect(parseDecision(response()).category).toBe("FYI/READ");
    const bad = response(); bad.answers.category.probabilities["ACTION/NOW"] = 0.5;
    expect(() => parseDecision(bad)).toThrow("JEV_INVALID_RESPONSE");
    const unsupported = response(); unsupported.answers.category.choice = "ACTION/DONE";
    expect(() => parseDecision(unsupported)).toThrow("JEV_INVALID_RESPONSE");
  });
  it("uses only the pinned official endpoint and model with a structured choice question", async () => {
    let captured: { url?: string; options?: RequestInit } = {};
    const client = new JevClassifier(() => "fake-test-key", (async (url, options) => { captured = { url: String(url), options }; return Response.json(response()); }) as typeof fetch);
    await client.classify({ account: "test@example.com", now: new Date().toISOString(), timeZone: "America/New_York", thread: { id: "thread", messages: [] } }, new AbortController().signal);
    expect(captured.url).toBe("https://api.typesafe.ai/v1/systemone");
    const body = JSON.parse(captured.options!.body as string);
    expect(body.model).toBe("jev-1.13.0"); expect(body.questions.category.type).toBe("choice"); expect(Object.keys(body.questions.category.criteria)).toEqual(CATEGORIES);
  });
  it("does not retry invalid authentication or hide a missing key", async () => {
    let requests = 0;
    const input = { account: "test@example.com", now: new Date().toISOString(), timeZone: "America/New_York", thread: { id: "thread", messages: [] } };
    const client = new JevClassifier(() => "fake", (async () => { requests++; return new Response("", { status: 401 }); }) as typeof fetch);
    await expect(client.classify(input, new AbortController().signal)).rejects.toThrow("JEV_HTTP_401"); expect(requests).toBe(1);
    await expect(new JevClassifier(() => undefined).classify(input, new AbortController().signal)).rejects.toThrow("JEV_KEY_MISSING");
  });
  it("recovers malformed JSON and an invalid decision with bounded classification-only retries", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("not JSON")).mockResolvedValueOnce(Response.json({ model: "jev-1.13.0" })).mockResolvedValueOnce(Response.json(response()));
    const result = await new JevClassifier(() => "fake", request).classify(input, new AbortController().signal);
    expect(result.category).toBe("FYI/READ"); expect(request).toHaveBeenCalledTimes(3);
    expect(new Set(request.mock.calls.map(([, options]) => options.body)).size).toBe(1);
  });
  it("fails closed after three malformed successful responses without accepting invalid probabilities", async () => {
    const bad = response(); bad.answers.category.probabilities["ACTION/NOW"] = 0.5;
    const request = vi.fn(async () => Response.json(bad));
    await expect(new JevClassifier(() => "fake", request).classify(input, new AbortController().signal)).rejects.toThrow("JEV_INVALID_RESPONSE");
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("shares the four-attempt ceiling with transient HTTP failures", async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "0" } })).mockResolvedValueOnce(new Response("", { status: 503, headers: { "retry-after": "0" } })).mockImplementation(async () => Response.json({}));
    await expect(new JevClassifier(() => "fake", request).classify(input, new AbortController().signal)).rejects.toThrow("JEV_INVALID_RESPONSE");
    expect(request).toHaveBeenCalledTimes(4);
  });
  it("does not retry a pinned model mismatch and honors cancellation during malformed backoff", async () => {
    const wrong = { ...response(), model: "unexpected-model" }, request = vi.fn(async () => Response.json(wrong));
    await expect(new JevClassifier(() => "fake", request).classify(input, new AbortController().signal)).rejects.toThrow("JEV_MODEL_MISMATCH");
    expect(request).toHaveBeenCalledTimes(1);
    const controller = new AbortController(), malformed = vi.fn(async () => Response.json({}));
    const pending = new JevClassifier(() => "fake", malformed).classify(input, controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow(); expect(malformed).toHaveBeenCalledTimes(1);
  });
});
