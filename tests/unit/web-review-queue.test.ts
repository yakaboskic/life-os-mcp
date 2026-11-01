import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORTAL_HTML } from "../../src/web/page.js";

const script = PORTAL_HTML.split("<script>")[1]!.split("</script>")[0]!;
const esc = script.slice(script.indexOf("  const esc ="), script.indexOf("  const timeHM ="));
const fields = script.slice(script.indexOf("  const field ="), script.indexOf("  function taskOptions("));
const diagnostics = script.slice(script.indexOf("  function reviewPercent("), script.indexOf("  function decisionHistory("));
const functions = script.slice(script.indexOf("  // ---- paged email review workspace ----"), script.indexOf("  // ---- tab routing ----"));
const categories = ["ACTION/NOW", "ACTION/SOON", "WAITING", "CALENDAR", "FINANCE/RECEIPT", "LEGAL/COMPLIANCE", "FYI/READ", "NEWSLETTER", "SPAM/SUSPECT"];
const item = (id = "one", extra = {}) => ({ id, revision: "a".repeat(64), reviewable: true, bucket: "needsDecision", subject: "Review synthetic proposal", sender: "sender@example.com", account: "owner@example.com", threadId: "thread1", ...extra });
const page = (items = [item()], extra = {}) => ({ items, total: 500, limit: 50, nextCursor: "next-page", counts: { total: 500, awaitingAgent: 300, needsDecision: 150, needsContext: 49, queued: 1 }, accounts: ["owner@example.com"], preferences: [], pendingCommands: [], ...extra });
function harness(request: (url: string, init: RequestInit) => Promise<Response> = async () => Response.json(page())) {
  const nodes = new Map<string, any>();
  const $ = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, value: "", innerHTML: "", textContent: "", hidden: false, disabled: false, checked: false, dataset: {}, values: new Map(),
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, contains: () => false, querySelectorAll: () => [], focus() {}, reset() { this.values = new Map(); },
    });
    return nodes.get(id);
  };
  const api = runInNewContext(`${esc}${fields}
    let actionEditor = null, actionBusy = false, automationAvailable = true, dataAvailable = true, authExpired = false, permitted = true;
    let tab = 'triage';
    const data = { capabilities: { actions: true, reviewQueue: true } }, automation = { paused: false };
    const canAct = () => permitted && dataAvailable && !authExpired && !actionBusy;
    const currentTab = () => tab;
    const openActionEditor = options => actionEditor = options;
    ${diagnostics}
    ${functions}
    ({ reviewWorkspace, reviewActionable, reviewQueueQuery, stableReviewSelection, bulkReviewInput, reviewCategoryEffect, reviewConversationHtml,
       refreshReviewQueue, searchReviewQueue, changeReviewPage, selectReviewItem, openBulkReviewEditor, reviewCanWrite, renderReviewCommands,
       reviewHoldText, reviewSuggestions, reviewDiagnostics, reviewRationale,
       editor: () => actionEditor, setTab: value => tab = value, setPermission: value => permitted = value, expired: () => authExpired });`, {
    $, REVIEW_CATEGORIES: categories, fetch: request, URLSearchParams, AbortController, AbortSignal,
    FormData: class { constructor(private node: any) {} get(name: string) { return this.node.values.get(name); } },
    document: { querySelectorAll: () => [], activeElement: null },
    count: (value: number) => value || 0, jobTime: () => "Nov 1", jobStatus: (value: string) => value || "", jobBadge: (value: string) => value || "", actionErrorMessage: (_code: string, fallback: string) => fallback, refreshActionControls() {},
  });
  return { ...api, $ };
}

describe("paged email review workspace", () => {
  it("shows the recorded confidence gate separately from the top three category probabilities", async () => {
    const held = item("score", { reason: "LOW_CONFIDENCE", classification: { provider: "jev", model: "jev-test", category: "NEWSLETTER", confidence: 0.7621, minimumConfidence: 0.9, probabilities: { "FYI/READ": 0.4, NEWSLETTER: 0.55, CALENDAR: 0.04, WAITING: 0.01, UNKNOWN: 1, "ACTION/NOW": -1, "ACTION/SOON": NaN } } });
    const api = harness(async () => Response.json(page([held]))); await api.refreshReviewQueue();
    expect(api.$("review-results").innerHTML).toContain("Jev confidence 76.21%; automatic filing currently requires at least 90%.");
    const html = api.reviewDiagnostics(held);
    expect(html).toContain("Model: jev-test");
    expect(html).toContain("Jev returned scores, not a written explanation.");
    expect(html).toContain("Confidence summarizes the category probabilities and is separate from the selected category’s probability.");
    const table = html.split("<tbody>")[1]!.split("</tbody>")[0]!;
    expect(table.match(/<tr>/g)).toHaveLength(3);
    expect(table.indexOf("NEWSLETTER")).toBeLessThan(table.indexOf("FYI/READ"));
    expect(table.indexOf("FYI/READ")).toBeLessThan(table.indexOf("CALENDAR"));
    expect(table).toContain("55%"); expect(table).toContain("40%"); expect(table).not.toContain("76.21%");
    expect(table).not.toMatch(/UNKNOWN|WAITING|ACTION|NaN/);
  });

  it("keeps Jev and Claude suggestions separate when Claude returned no clear category", () => {
    const api = harness(), held = item("null-category", { category: "NEWSLETTER", classification: { category: "NEWSLETTER" }, agentReview: { source: "claude", category: null, model: "claude-test", reason: "The next owner action is unclear." } });
    const html = api.reviewSuggestions(held);
    expect(html).toContain("Jev suggested: NEWSLETTER"); expect(html).toContain("Claude proposal: No clear category");
    expect(html).not.toContain("Claude proposal: NEWSLETTER");
    expect(api.reviewSuggestions(item())).toContain("No Claude review recorded for this version");
  });

  it("shows saved Claude confidence and flags without inventing values for historical reviews", () => {
    const api = harness();
    const current = api.reviewRationale({ source: "claude", category: "ACTION/SOON", model: "claude-test", reason: "A reply may still be needed.", confidence: 0.91, minimumConfidence: 0.95, clear: true, needsMoreContext: false, gateReason: "below_threshold" });
    expect(current).toContain("Recorded confidence: 91%; automatic review currently requires at least 95%.");
    expect(current).toContain("Clear category: yes. More context requested: no.");
    expect(current).toContain("Claude confidence did not meet the automatic-review requirement.");
    const old = api.reviewRationale({ source: "claude", category: null, model: "claude-test", reason: "The answer is missing.", minimumConfidence: 0.95 });
    expect(old).toContain("Confidence was not recorded for this review.");
    expect(old).toContain("checks were not recorded for this review.");
    expect(old).not.toContain("Recorded confidence:"); expect(old).not.toContain("More context requested: yes");
    expect(api.reviewDiagnostics(item("missing", { reason: "LOW_CONFIDENCE", confidence: 0.8 }))).toContain("No original Jev classification details are available");
  });

  it("labels policy checks honestly instead of presenting their codes as Claude explanations", () => {
    const api = harness();
    for (const review of [{ source: "policy", model: "policy", reason: "REVIEW_INVALID_EVIDENCE" }, { model: "policy", reason: "REVIEW_INVALID_EVIDENCE" }]) {
      const html = api.reviewRationale(review);
      expect(html).toContain("Review blocked by policy"); expect(html).toContain("supporting-message evidence checks");
      expect(html).not.toContain("REVIEW_INVALID_EVIDENCE"); expect(html).not.toContain("<h3>Claude review"); expect(html).not.toContain("Recorded confidence");
    }
    const context = api.reviewDiagnostics(item("context", { reason: "INSUFFICIENT_OR_TRUNCATED_CONTEXT" }));
    expect(context).toContain("Message text is missing, truncated, or exceeds the review limit.");
    expect(context).toContain("The context check stopped classification before Jev produced a result.");
    expect(context).not.toContain("Jev suggested");
  });

  it("escapes diagnostic data and keeps values just below the threshold visibly below it", () => {
    const api = harness(), classification = { provider: "jev", model: '<img src=x onerror="bad()">', category: "NEWSLETTER", confidence: 0.8999999, minimumConfidence: 0.9, probabilities: { NEWSLETTER: 1 } };
    const html = api.reviewDiagnostics(item("edge", { reason: "LOW_CONFIDENCE", classification }));
    expect(html).toContain("Jev confidence &lt;90%; automatic filing currently requires at least 90%.");
    expect(html).not.toContain("<img"); expect(html).toContain("&lt;img");
    const rationale = api.reviewRationale({ source: "claude", category: null, model: "claude-test", reason: '<script>bad()</script><svg onload="bad()">', confidence: 0, clear: false, needsMoreContext: true, gateReason: "needs_context", minimumConfidence: 0.95 });
    expect(rationale).not.toMatch(/<(?:script|svg)\b/); expect(rationale).toContain("Recorded confidence: 0%");
    expect(rationale).toContain("Claude requested more context.");
  });

  it("sends full-queue filters and an opaque cursor to the server", () => {
    const api = harness();
    const query = new URLSearchParams(api.reviewQueueQuery({ bucket: "needsDecision", search: "sender+tag@example.com & proposal", account: "owner@example.com", category: "ACTION/NOW" }, "opaque/+cursor="));
    expect(Object.fromEntries(query)).toEqual({ bucket: "needsDecision", limit: "50", search: "sender+tag@example.com & proposal", account: "owner@example.com", category: "ACTION/NOW", cursor: "opaque/+cursor=" });
  });

  it("retains only actionable selections whose revisions remain identical on the page", () => {
    const api = harness(), selected = new Map(["stable", "changed", "gone", "blocked", "queued"].map(id => [id, item(id)]));
    const current = [item("stable", { subject: "Updated metadata" }), item("changed", { revision: "b".repeat(64) }), item("blocked", { reviewable: false }), item("queued", { bucket: "queued" })];
    const result = api.stableReviewSelection(selected, current);
    expect([...result.keys()]).toEqual(["stable"]); expect(result.get("stable").subject).toBe("Updated metadata");
    expect(selected.size).toBe(5);
  });

  it("requires an explicit category and creates one bounded per-item action payload", () => {
    const api = harness(), chosen = [item("one"), item("two")];
    expect(api.bulkReviewInput(chosen, "NEWSLETTER", false)).toEqual({ items: chosen.map(row => ({ itemId: row.id, revision: row.revision, category: "NEWSLETTER" })), rememberPreference: false });
    expect(api.bulkReviewInput(chosen, "ACTION/NOW", true).rememberPreference).toBe(true);
    for (const [rows, category] of [[[], "NEWSLETTER"], [chosen, ""], [[chosen[0], chosen[0]], "NEWSLETTER"], [[item("blocked", { reviewable: false })], "NEWSLETTER"], [Array.from({ length: 51 }, (_, i) => item(String(i))), "NEWSLETTER"]] as const) expect(() => api.bulkReviewInput(rows, category, false)).toThrow();
  });

  it("shows category effects accurately without preselecting a suggested category or remembering by default", async () => {
    const api = harness(); await api.refreshReviewQueue(); api.selectReviewItem("one", true); api.openBulkReviewEditor();
    const editor = api.editor();
    expect(editor.action).toBe("review.bulkResolve");
    expect(editor.fields).toContain('<option value="" selected disabled>Choose a category</option>');
    expect(editor.fields).toContain('type="checkbox" name="rememberPreference">');
    expect(editor.fields).toContain('</ul><div class="form-field">');
    expect(editor.fields).toContain('future email classifications and reviews');
    expect(editor.fields).not.toContain('name="rememberPreference" checked');
    expect(api.reviewCategoryEffect("ACTION/NOW", 2)).toContain("archive the reviewed messages");
    expect(api.reviewCategoryEffect("ACTION/NOW", 2)).toContain("Star these messages");
    expect(api.reviewCategoryEffect("ACTION/NOW", 2)).toContain("LifeOS follow-up task");
    expect(api.reviewCategoryEffect("NEWSLETTER", 2)).not.toContain("Star these messages");
    expect(api.reviewCategoryEffect("SPAM/SUSPECT", 2)).toContain("does not report spam");
    expect(editor.input(new Map([["category", "NEWSLETTER"]]))).toMatchObject({ rememberPreference: false });
    api.reviewWorkspace.snapshot.items[0].revision = "b".repeat(64);
    expect(() => editor.input(new Map([["category", "NEWSLETTER"]]))).toThrow(/changed/);
  });

  it("applies only the newest response and disables writes after failed refresh or expired auth", async () => {
    const pending: Array<(response: Response) => void> = [];
    const api = harness(() => new Promise(resolve => pending.push(resolve)));
    const first = api.refreshReviewQueue(), second = api.refreshReviewQueue();
    pending[1]!(Response.json(page([item("new")]))); await second;
    pending[0]!(Response.json(page([item("old")]))); await first;
    expect(api.reviewWorkspace.snapshot.items[0].id).toBe("new"); expect(api.reviewCanWrite()).toBe(true);
    const expired = api.refreshReviewQueue(); pending[2]!(new Response("unauthorized", { status: 401 })); await expired;
    expect(api.expired()).toBe(true); expect(api.reviewCanWrite()).toBe(false);
    expect(api.$("review-queue-status").textContent).toContain("Sign in");
  });

  it("preserves filter drafts on refresh and clears selection when changing pages or submitted filters", async () => {
    const urls: string[] = [];
    const api = harness(async url => { urls.push(url); return Response.json(page()); }); await api.refreshReviewQueue();
    api.$("review-search").value = "unfinished search";
    api.$("review-account").value = "owner@example.com";
    api.selectReviewItem("one", true); await api.refreshReviewQueue();
    expect(api.reviewWorkspace.selected.size).toBe(1); expect(api.$("review-search").value).toBe("unfinished search"); expect(api.$("review-account").value).toBe("owner@example.com");
    api.changeReviewPage(1); await Promise.resolve(); await Promise.resolve();
    expect(api.reviewWorkspace.selected.size).toBe(0); expect(api.reviewWorkspace.page).toBe(1); expect(urls.at(-1)).toContain("cursor=next-page");
    await api.refreshReviewQueue(); api.selectReviewItem("one", true);
    api.$("review-search-form").values = new Map([["search", "science@example.com"], ["bucket", "needsDecision"], ["account", "owner@example.com"]]);
    api.searchReviewQueue(); await Promise.resolve(); await Promise.resolve();
    expect(api.reviewWorkspace.page).toBe(0); expect(api.reviewWorkspace.selected.size).toBe(0); expect(urls.at(-1)).toContain("search=science%40example.com"); expect(urls.at(-1)).not.toContain("cursor=");
  });

  it("does not fetch the review queue outside Triage or accept more than50 rows", async () => {
    let calls = 0; const api = harness(async () => { calls++; return Response.json(page(Array.from({ length: 51 }, (_, i) => item(String(i))))); });
    api.setTab("today"); await api.refreshReviewQueue(); expect(calls).toBe(0);
    api.setTab("triage"); await api.refreshReviewQueue(); expect(api.reviewWorkspace.available).toBe(false); expect(api.reviewCanWrite()).toBe(false);
  });

  it("renders email bodies as escaped plaintext and cannot activate embedded HTML or external assets", () => {
    const api = harness(), html = api.reviewConversationHtml({ item: item(), messages: [{ from: '<img src="https://example.com/pixel">', to: "owner@example.com", subject: "<script>bad()</script>", body: '<svg onload="bad()">\nhttps://example.com/pixel\n[Click](javascript:bad())', attachments: true }], changed: false });
    expect(html).toContain('&lt;svg onload=&quot;bad()&quot;&gt;'); expect(html).not.toMatch(/<(?:img|svg|script)\b/);
    expect(html).toContain('class="review-message-body"'); expect(html.match(/<a /g)).toHaveLength(1); expect(html).toContain("https://mail.google.com/");
    expect(api.reviewConversationHtml({ item: item(), messages: [], changed: true })).not.toContain("data-review-detail-apply");
  });

  it("shows durable per-item outcomes and clears submitted selections without treating queued items as applied", async () => {
    const api = harness(); await api.refreshReviewQueue(); api.selectReviewItem("one", true); api.openBulkReviewEditor();
    const command = { requestId: "request-one", state: "queued", items: [{ itemId: "one", status: "queued" }, { itemId: "two", status: "stale", code: "REVIEW_REVISION_MISMATCH" }] };
    const message = api.editor().onSuccess({ reviewCommand: command, reviewReceipt: { items: [{ itemId: "one", status: "queued" }, { itemId: "two", status: "rejected" }] } });
    expect(api.reviewWorkspace.selected.size).toBe(0); expect(message).toContain("1 queued"); expect(message).toContain("1 rejected");
    api.renderReviewCommands([command]); const html = api.$("review-command-progress").innerHTML;
    expect(html).toContain("1 queued · 1 stale"); expect(html).toContain("Conversation changed; inspect it again"); expect(html).not.toContain("REVIEW_REVISION_MISMATCH");
    expect(html).toContain('data-review-inspect="two"');
  });
});
