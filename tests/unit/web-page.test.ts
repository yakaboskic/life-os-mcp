import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORTAL_HTML } from "../../src/web/page.js";

const script = PORTAL_HTML.split("<script>")[1]!.split("</script>")[0]!;
const escapeDeclaration = script.slice(script.indexOf("  const esc ="), script.indexOf("  const timeHM ="));
const markdownFunction = script.slice(script.indexOf("  function inlineMarkdown("), script.indexOf("  function mdToHtml("));
const renderInline = (source: string): string => runInNewContext(
  escapeDeclaration + markdownFunction + "\ninlineMarkdown(source)", { source },
) as string;

describe("dashboard source rendering", () => {
  it("ships a syntactically valid standalone browser script", () => {
    expect(() => new Function(script)).not.toThrow();
  });

  it("preserves Markdown source links without linking the generated markup again", () => {
    const html = renderInline("Read [the original](https://example.com/thread?a=1&b=2) or https://example.com/notes.");
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain("href='https://example.com/thread?a=1&amp;b=2'");
    expect(html).toContain(">the original</a>");
    expect(html).toContain(">https://example.com/notes</a>.");
    expect(html).not.toContain("href='<a");
  });

  it("keeps text and quote-bearing URLs inside their intended HTML contexts", () => {
    const html = renderInline("[Source](https://example.com/'onclick='alert(1)) <img src=x onerror=alert(1)> **<b>text</b>**");
    expect(html).toContain("&#39;onclick=&#39;");
    expect(html).not.toContain("'onclick='");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<b>&lt;b&gt;text&lt;/b&gt;</b>");
    expect(html).not.toContain("<img");
  });

  it("does not turn executable schemes or code spans into links", () => {
    const html = renderInline("[unsafe](javascript:alert(1)) `https://example.com/code` ");
    expect(html).not.toContain("<a ");
    expect(html).toContain("<code>https://example.com/code</code>");
  });

  it("escapes apostrophes used by data attributes and titles", () => {
    const html = runInNewContext(escapeDeclaration + "\nesc(value)", { value: "task' onfocus='bad()" });
    expect(html).toBe("task&#39; onfocus=&#39;bad()");
  });
});
