import { describe, expect, it } from "vitest";
import { JevClassifier, parseDecision } from "../../src/jobs/jev.js";
import { CATEGORIES } from "../../src/jobs/types.js";

function response() { return { model: "jev-1.13.0", answers: { category: { type: "choice", choice: "FYI/READ", confidence: 0.97, probabilities: Object.fromEntries(CATEGORIES.map((category) => [category, category === "FYI/READ" ? 1 : 0])) } }, usage: { input_tokens: 123 } }; }
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
});
