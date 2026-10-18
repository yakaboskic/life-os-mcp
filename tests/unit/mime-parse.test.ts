import { describe, expect, it } from "vitest";
import type { gmail_v1 } from "googleapis";
import { htmlToText, parseMessage } from "../../src/toolsets/gmail/mime.js";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function baseMessage(payload: gmail_v1.Schema$MessagePart): gmail_v1.Schema$Message {
  return {
    id: "m1",
    threadId: "t1",
    internalDate: "1750000000000",
    snippet: "snippet here",
    labelIds: ["INBOX", "UNREAD"],
    payload: {
      ...payload,
      headers: [
        { name: "From", value: "Alice <alice@example.com>" },
        { name: "To", value: "me@example.com" },
        { name: "Subject", value: "Hello there" },
        ...(payload.headers ?? []),
      ],
    },
  };
}

describe("parseMessage", () => {
  it("parses a simple text/plain message", () => {
    const msg = baseMessage({ mimeType: "text/plain", body: { data: b64("plain body text"), size: 15 } });
    const out = parseMessage(msg, { includeBody: true });
    expect(out).toMatchObject({
      id: "m1",
      threadId: "t1",
      from: "Alice <alice@example.com>",
      subject: "Hello there",
      isUnread: true,
      body: "plain body text",
    });
    expect(out.date).toBe(new Date(1750000000000).toISOString());
  });

  it("prefers text/plain inside multipart/alternative", () => {
    const msg = baseMessage({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("the plain version") } },
        { mimeType: "text/html", body: { data: b64("<p>the <b>html</b> version</p>") } },
      ],
    });
    expect(parseMessage(msg, { includeBody: true }).body).toBe("the plain version");
  });

  it("falls back to stripped html when no text/plain exists", () => {
    const msg = baseMessage({
      mimeType: "text/html",
      body: { data: b64("<html><head><style>p{color:red}</style></head><body><p>Hi &amp; welcome</p><br><div>Bye</div></body></html>") },
    });
    const out = parseMessage(msg, { includeBody: true });
    expect(out.body).toContain("Hi & welcome");
    expect(out.body).toContain("Bye");
    expect(out.body).not.toContain("<p>");
    expect(out.body).not.toContain("color:red");
  });

  it("collects attachment metadata from nested multipart/mixed without downloading", () => {
    const msg = baseMessage({
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/plain", body: { data: b64("see attachment") } },
            { mimeType: "text/html", body: { data: b64("<p>see attachment</p>") } },
          ],
        },
        {
          mimeType: "application/pdf",
          filename: "invoice.pdf",
          body: { attachmentId: "att-1", size: 12345 },
        },
      ],
    });
    const out = parseMessage(msg, { includeBody: true });
    expect(out.body).toBe("see attachment");
    expect(out.attachments).toEqual([
      { filename: "invoice.pdf", mimeType: "application/pdf", sizeBytes: 12345, attachmentId: "att-1" },
    ]);
  });

  it("truncates long bodies with an explicit marker", () => {
    const msg = baseMessage({ mimeType: "text/plain", body: { data: b64("x".repeat(9000)) } });
    const out = parseMessage(msg, { includeBody: true, maxBodyChars: 500 });
    expect(out.bodyTruncated).toBe(true);
    expect(out.body).toContain("[truncated at 500 chars");
    expect(out.body!.length).toBeLessThan(700);
  });

  it("omits the body entirely for metadata-only parses (search hydration)", () => {
    const msg = baseMessage({ mimeType: "text/plain", body: { data: b64("body") } });
    const out = parseMessage(msg);
    expect(out.body).toBeUndefined();
    expect(out.subject).toBe("Hello there");
  });
});

describe("htmlToText", () => {
  it("renders list items and drops scripts", () => {
    const text = htmlToText("<script>evil()</script><ul><li>one</li><li>two</li></ul>");
    expect(text).toContain("- one");
    expect(text).toContain("- two");
    expect(text).not.toContain("evil");
  });
});
