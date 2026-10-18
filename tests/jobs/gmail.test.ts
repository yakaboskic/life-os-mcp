import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config.js";
import { GmailJobGateway } from "../../src/jobs/gmail.js";
import { CATEGORIES } from "../../src/jobs/types.js";
import type { GmailManagerLike } from "../../src/toolsets/gmail/client.js";

const logger = { info() {}, warn() {}, error() {}, debug() {} };
function manager(gmail: unknown): GmailManagerLike { return { store: { listTokenFiles: () => [], resolveAccount: (account: string) => account }, withClient: async (_account: string, fn: (client: unknown, email: string) => unknown) => fn(gmail, "owner@example.com"), invalidateLabels() {} } as unknown as GmailManagerLike; }
describe("Gmail job gateway", () => {
  it("exhausts and deduplicates message pagination before returning threads", async () => {
    const calls: (string | undefined)[] = [];
    const gmail = { users: { messages: { list: async ({ pageToken }: { pageToken?: string }) => { calls.push(pageToken); return { data: pageToken ? { messages: [{ threadId: "same" }, { threadId: "last" }] } : { messages: [{ threadId: "first" }, { threadId: "same" }], nextPageToken: "page2" } }; } } } };
    const gateway = new GmailJobGateway(loadConfig(), logger, manager(gmail));
    expect(await gateway.listThreads("owner@example.com", "in:inbox", new AbortController().signal)).toEqual(["first", "same", "last"]);
    expect(calls).toEqual([undefined, "page2"]);
  });
  it("recovers a label creation race by re-reading the label list", async () => {
    const labels = [...CATEGORIES, "ACTION/DONE"].filter((name) => name !== "WAITING").map((name) => ({ name, id: `Label_${name}` }));
    let creates = 0;
    const gmail = { users: { labels: { list: async () => ({ data: { labels } }), create: async () => { creates++; labels.push({ name: "WAITING", id: "concurrently-created" }); throw new Error("Already exists"); } } } };
    const gateway = new GmailJobGateway(loadConfig(), logger, manager(gmail));
    expect((await gateway.labels("owner@example.com", true, new AbortController().signal)).WAITING).toBe("concurrently-created");
    expect(creates).toBe(1);
  });
  it("never creates labels while resolving a dry run", async () => {
    let creates = 0;
    const gmail = { users: { labels: { list: async () => ({ data: { labels: [] } }), create: async () => { creates++; throw new Error("Must not run"); } } } };
    const gateway = new GmailJobGateway(loadConfig(), logger, manager(gmail));
    expect(await gateway.labels("owner@example.com", false, new AbortController().signal)).toEqual({}); expect(creates).toBe(0);
  });
});
