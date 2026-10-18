import { describe, expect, it } from "vitest";
import { buildReferences, composeEmail, replySubject } from "../../src/toolsets/gmail/mime.js";

function decodeRaw(raw: string): string {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("composeEmail", () => {
  it("produces base64url RFC 2822 with recipients, subject, and body", () => {
    const raw = composeEmail({
      from: "me@example.com",
      to: ["alice@example.com", "bob@example.com"],
      cc: ["carol@example.com"],
      subject: "Quarterly report",
      textBody: "Hi all,\n\nAttached is the report.\n",
    });
    expect(raw).not.toMatch(/[+/=]/); // base64url alphabet only
    const mime = decodeRaw(raw);
    expect(mime).toContain("From: <me@example.com>");
    expect(mime).toContain("alice@example.com");
    expect(mime).toContain("bob@example.com");
    expect(mime).toMatch(/^Cc: .*carol@example\.com.*$/m);
    // mimetext encodes every subject as an RFC 2047 encoded-word; decode and verify
    const encodedWord = mime.match(/^Subject: =\?utf-8\?B\?(.+)\?=$/m);
    expect(encodedWord, "expected RFC 2047 encoded subject").toBeTruthy();
    expect(Buffer.from(encodedWord![1]!, "base64").toString("utf8")).toBe("Quarterly report");
    expect(mime).toContain("Attached is the report.");
    expect(mime).toMatch(/Content-Type: text\/plain/i);
  });

  it("encodes non-ASCII subjects as RFC 2047 encoded-words", () => {
    const mime = decodeRaw(
      composeEmail({ from: "me@example.com", to: ["a@b.c"], subject: "Réunion 🚀 démain", textBody: "x" }),
    );
    expect(mime).toMatch(/Subject: =\?utf-8\?/i);
    expect(mime).not.toContain("Subject: Réunion");
  });

  it("sets threading headers for replies", () => {
    const mime = decodeRaw(
      composeEmail({
        from: "me@example.com",
        to: ["a@b.c"],
        subject: "Re: hello",
        textBody: "reply",
        inReplyTo: "<orig-123@mail.gmail.com>",
        references: "<root-1@mail.gmail.com> <orig-123@mail.gmail.com>",
      }),
    );
    expect(mime).toContain("In-Reply-To: <orig-123@mail.gmail.com>");
    expect(mime).toContain("References: <root-1@mail.gmail.com> <orig-123@mail.gmail.com>");
  });
});

describe("replySubject", () => {
  it('prefixes "Re: " exactly once', () => {
    expect(replySubject("Hello")).toBe("Re: Hello");
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
    expect(replySubject("RE: Hello")).toBe("RE: Hello");
    expect(replySubject("re: Hello")).toBe("re: Hello");
    expect(replySubject(undefined)).toBe("Re:");
  });
});

describe("buildReferences", () => {
  it("appends the original Message-ID to existing References", () => {
    expect(buildReferences("<a@x> <b@x>", "<c@x>")).toBe("<a@x> <b@x> <c@x>");
    expect(buildReferences(undefined, "<c@x>")).toBe("<c@x>");
    expect(buildReferences("<a@x>", undefined)).toBe("<a@x>");
    expect(buildReferences(undefined, undefined)).toBeUndefined();
  });
});
