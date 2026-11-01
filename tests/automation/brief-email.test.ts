import { describe, expect, it } from "vitest";
import { renderBriefEmailHtml } from "../../src/automation/brief-email.js";

describe("readable brief email HTML", () => {
  it("renders the controlled brief grammar and keeps paragraph/list boundaries intact", () => {
    const html = renderBriefEmailHtml("## Daily priorities\n\nFirst paragraph\ncontinued here.\n\n### Priorities\n1. **First action** — Detail.\n2. **Second action** — More detail.\n\n### Notes\n- Note one\n- Note two\n\nClosing paragraph.");
    expect(html).toContain("First paragraph continued here."); expect(html).toContain("<strong>First action</strong>");
    expect(html.match(/<ol /g)).toHaveLength(1); expect(html.match(/<ul /g)).toHaveLength(1); expect(html.match(/<li /g)).toHaveLength(4);
    expect(html.indexOf("</ol>")).toBeLessThan(html.indexOf(">Notes</h2>"));
    expect(html.indexOf("</ul>")).toBeLessThan(html.indexOf("Closing paragraph."));
    expect(html).toContain('name="viewport"'); expect(html).toContain("max-width:640px");
  });
  it("escapes all source content, including markup inside emphasis, without activating links or remote assets", () => {
    const html = renderBriefEmailHtml('## <script>alert("x")</script>\n\n**<img src=x onerror=bad()>** & [click](javascript:bad())\n\n- [remote](https://example.com/track)\n- "quotes" and \'apostrophes\'');
    expect(html).toContain("&lt;script&gt;"); expect(html).toContain("<strong>&lt;img src=x onerror=bad()&gt;</strong>");
    expect(html).toContain("&amp;"); expect(html).toContain("&quot;quotes&quot;"); expect(html).toContain("&#39;apostrophes&#39;");
    expect(html).not.toMatch(/<(?:script|img|a|iframe|link)\b/i); expect(html).not.toMatch(/<[^>]+\s(?:src|href|onerror)=/i);
  });
  it("uses a stable rendering for equivalent newline and outer-whitespace representations", () => {
    expect(renderBriefEmailHtml("\r\n## Title\r\n\r\nSummary.\r\n")).toBe(renderBriefEmailHtml("## Title\n\nSummary."));
  });
});
