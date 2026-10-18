import { describe, expect, it, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { gmail_v1 } from "googleapis";
import { buildServer } from "../../src/core/server.js";
import { loadConfig } from "../../src/core/config.js";
import { createLogger } from "../../src/core/logger.js";
import { createGmailToolset } from "../../src/toolsets/gmail/index.js";
import { GmailStore } from "../../src/toolsets/gmail/store.js";
import type { GmailManagerLike } from "../../src/toolsets/gmail/client.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** Stubbed gmail_v1.Gmail covering the calls the tools make. */
const stubGmail = {
  users: {
    messages: {
      list: async () => ({ data: { messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 } }),
      get: async (params: { id: string; format?: string }) => ({
        data: {
          id: params.id,
          threadId: "t1",
          internalDate: "1750000000000",
          snippet: "Lunch tomorrow?",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "Alice <alice@example.com>" },
              { name: "To", value: "me@gmail.com" },
              { name: "Subject", value: "Lunch" },
            ],
            body: params.format === "full" ? { data: b64("Want to grab lunch tomorrow?") } : undefined,
          },
        },
      }),
    },
  },
} as unknown as gmail_v1.Gmail;

class FakeManager implements GmailManagerLike {
  constructor(readonly store: GmailStore) {}
  async withClient<T>(account: string, fn: (gmail: gmail_v1.Gmail, email: string) => Promise<T>): Promise<T> {
    const email = this.store.resolveAccount(account);
    return fn(stubGmail, email);
  }
  async resolveLabelIds(_g: gmail_v1.Gmail, _e: string, tokens: string[]): Promise<string[]> {
    return tokens;
  }
  invalidateLabels(): void {}
}

describe("life-os MCP server (in-memory transport)", () => {
  let client: Client;

  beforeAll(async () => {
    const home = mkdtempSync(join(tmpdir(), "life-os-int-"));
    const config = loadConfig({ LIFE_OS_HOME: home } as NodeJS.ProcessEnv);
    const store = new GmailStore(config);
    const now = new Date().toISOString();
    store.saveTokenFile({
      account: "me@gmail.com",
      refresh_token: "rt",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      client_id: "cid",
      created_at: now,
      updated_at: now,
    });
    store.setAlias("personal", "me@gmail.com");

    const toolset = createGmailToolset({ manager: new FakeManager(store) });
    const server = await buildServer([toolset], { config, logger: createLogger("error") });

    client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  it("lists all 12 gmail tools with schemas and annotations", async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "gmail_create_draft",
      "gmail_create_label",
      "gmail_get_message",
      "gmail_get_thread",
      "gmail_list_accounts",
      "gmail_list_drafts",
      "gmail_list_labels",
      "gmail_modify_messages",
      "gmail_search_messages",
      "gmail_send_draft",
      "gmail_send_message",
      "gmail_trash_message",
    ]);
    const search = res.tools.find((t) => t.name === "gmail_search_messages")!;
    expect(search.inputSchema.properties).toHaveProperty("account");
    expect(search.inputSchema.properties).toHaveProperty("query");
    expect(search.annotations?.readOnlyHint).toBe(true);
    const send = res.tools.find((t) => t.name === "gmail_send_message")!;
    expect(send.annotations?.readOnlyHint).toBeFalsy();
  });

  it("surfaces connected accounts through server instructions", () => {
    expect(client.getInstructions()).toContain("personal (me@gmail.com)");
  });

  it("lists accounts with aliases", async () => {
    const res = await client.callTool({ name: "gmail_list_accounts", arguments: {} });
    const payload = JSON.parse((res.content as any)[0].text);
    expect(payload.accounts).toHaveLength(1);
    expect(payload.accounts[0].email).toBe("me@gmail.com");
    expect(payload.accounts[0].aliases).toEqual(["personal"]);
  });

  it("searches by alias and returns hydrated metadata without bodies", async () => {
    const res = await client.callTool({
      name: "gmail_search_messages",
      arguments: { account: "personal", query: "is:unread" },
    });
    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content as any)[0].text);
    expect(payload.messages).toHaveLength(1);
    expect(payload.messages[0]).toMatchObject({
      id: "m1",
      subject: "Lunch",
      isUnread: true,
    });
    expect(payload.messages[0].body).toBeUndefined();
  });

  it("fetches a full message body via gmail_get_message", async () => {
    const res = await client.callTool({
      name: "gmail_get_message",
      arguments: { account: "me@gmail.com", messageId: "m1" },
    });
    const payload = JSON.parse((res.content as any)[0].text);
    expect(payload.body).toBe("Want to grab lunch tomorrow?");
  });

  it("returns isError with the account list for an unknown account", async () => {
    const res = await client.callTool({
      name: "gmail_search_messages",
      arguments: { account: "wrong@nope.com", query: "is:unread" },
    });
    expect(res.isError).toBe(true);
    const text = (res.content as any)[0].text as string;
    expect(text).toContain('Unknown account "wrong@nope.com"');
    expect(text).toContain("personal (me@gmail.com)");
    expect(text).not.toContain("    at "); // no stack trace leaks
  });

  it("rejects gmail_modify_messages with neither addLabels nor removeLabels", async () => {
    const res = await client.callTool({
      name: "gmail_modify_messages",
      arguments: { account: "personal", messageIds: ["m1"] },
    });
    expect(res.isError).toBe(true);
    expect((res.content as any)[0].text).toContain("at least one");
  });
});
