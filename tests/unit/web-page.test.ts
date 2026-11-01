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
  it("shows a successful scheduled triage even when uncertain mail was held", () => {
    const declaration = script.slice(script.indexOf("  const successful ="), script.indexOf("  const count ="));
    const run = { scheduled: true, mode: "apply", status: "partial", finishedAt: "2026-11-01T10:55:00Z", accounts: [{ status: "partial", failed: 0 }] };
    const check = (value: unknown) => runInNewContext(declaration + "\nBoolean(successful(run))", { run: value });
    expect(check(run)).toBe(true);
    expect(check({ ...run, scheduled: false })).toBe(false);
    expect(check({ ...run, mode: "dry-run" })).toBe(false);
    expect(check({ ...run, accounts: [{ status: "partial", failed: 1 }] })).toBe(false);
    expect(check({ ...run, accounts: [{ status: "auth_blocked", failed: 0 }] })).toBe(false);
  });

  it("shows full backlog counts when the displayed review list is bounded", () => {
    const elements = new Map<string, { hidden: boolean; innerHTML: string; querySelector: () => null }>();
    const $ = (id: string) => { if (!elements.has(id)) elements.set(id, { hidden: false, innerHTML: "", querySelector: () => null }); return elements.get(id)!; };
    const render = script.slice(script.indexOf("  function renderAutomation()"), script.indexOf("  async function refreshAutomation()"));
    runInNewContext(escapeDeclaration + render + "\nrenderAutomation()", {
      $, data: { capabilities: { automation: true } }, automationAvailable: true,
      automation: { configured: true, schedule: { enabled: true, localTime: "07:00" }, reviews: [{ id: "one", subject: "Held message" }],
        backlog: { total: 781, awaitingAgent: 500, needsDecision: 151, needsContext: 130 } },
      count: (value: number) => value || 0, jobBadge: (value: string) => value, jobTime: () => "", jobStatus: () => "", decisionHistory: () => "", refreshActionControls() {},
    });
    const html = $("review-queue").innerHTML;
    expect(html).toContain("781 held"); expect(html).toContain("Showing 1 of 781");
    expect(html).toContain("500 awaiting Claude review"); expect(html).toContain("151 unresolved"); expect(html).toContain("130 incomplete context");
  });
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
