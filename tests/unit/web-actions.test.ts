import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORTAL_HTML } from "../../src/web/page.js";

const script = PORTAL_HTML.split("<script>")[1]!.split("</script>")[0]!;
const functions = script.slice(script.indexOf("  function localInputValue("), script.indexOf("  function actionFeedback("));
function harness() {
  let nextId = 0;
  return runInNewContext(`
    const pad = n => String(n).padStart(2, '0');
    const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    ${functions}
    ({ actionRequest, localInputValue, timeInputToIso, actionErrorMessage });
  `, { Date, crypto: { randomUUID: () => `request-${++nextId}` } });
}

describe("dashboard action requests", () => {
  it("reuses the full request envelope only when action and input are unchanged", () => {
    const { actionRequest } = harness();
    const first = actionRequest(null, "time.log", { taskId: "t1", start: "2026-10-18T12:00:00Z" });
    const retry = actionRequest(first, "time.log", { taskId: "t1", start: "2026-10-18T12:00:00Z" });
    expect(retry).toBe(first);
    expect(actionRequest(first, "time.log", { taskId: "t2", start: "2026-10-18T12:00:00Z" }).body.requestId).not.toBe(first.body.requestId);
    expect(actionRequest(first, "timer.start", first.body.input).body.requestId).not.toBe(first.body.requestId);
  });

  it("sends explicit instants for local date/time inputs, including seconds", () => {
    const { localInputValue, timeInputToIso } = harness();
    const instant = new Date(2026, 9, 18, 9, 30, 42);
    expect(localInputValue(instant)).toBe("2026-10-18T09:30:42");
    expect(timeInputToIso("2026-10-18T09:30:42")).toBe(instant.toISOString());
    expect(timeInputToIso("2026-10-18T09:30")).toBe(new Date(2026, 9, 18, 9, 30).toISOString());
  });

  it("rejects missing, invalid and silently normalized calendar dates", () => {
    const { timeInputToIso } = harness();
    for (const value of ["", "nonsense", "2026-02-30T09:30"]) expect(() => timeInputToIso(value)).toThrow();
  });

  it("turns worker sign-in, quota and timeout codes into actionable messages", () => {
    const { actionErrorMessage } = harness();
    expect(actionErrorMessage("CLAUDE_LOGIN_REQUIRED")).toContain("Sign in to Claude Code on the VM");
    expect(actionErrorMessage("CLAUDE_QUOTA_EXHAUSTED")).toContain("allowance to reset");
    expect(actionErrorMessage("CLAUDE_RUNNER_TIMEOUT")).toContain("timed out");
    expect(actionErrorMessage("NEW_INTERNAL_CODE", "NEW_INTERNAL_CODE")).not.toContain("NEW_INTERNAL_CODE");
    expect(actionErrorMessage("TASK_CHANGED", "Task changed on another device")).toBe("Task changed on another device");
  });

  it("gives form controls explicit labels and escapes draft values", () => {
    const esc = script.slice(script.indexOf("  const esc ="), script.indexOf("  const timeHM ="));
    const fields = script.slice(script.indexOf("  const field ="), script.indexOf("  function taskOptions("));
    const html = runInNewContext(`${esc}${fields}\nfield('Title', inputControl('title', value));`, { value: '\" autofocus onfocus=\"bad()' });
    expect(html).toContain('for="action-field-title"');
    expect(html).toContain('id="action-field-title"');
    expect(html).toContain('value="&quot; autofocus onfocus=&quot;bad()"');
    expect(html).not.toContain('value="" autofocus');
  });

  it("escapes optional review rationale and limits the recent decision disclosure", () => {
    const esc = script.slice(script.indexOf("  const esc ="), script.indexOf("  const timeHM ="));
    const review = script.slice(script.indexOf("  function reviewRationale("), script.indexOf("  function renderAutomation("));
    const { reviewRationale, decisionHistory } = runInNewContext(`${esc}${review}\n({ reviewRationale, decisionHistory });`, {
      jobTime: () => "Oct 18, 09:00",
      jobStatus: (value: string) => value,
    });
    const decision = { category: null, reason: '<img src=x onerror="bad()">', model: 'claude-"test', account: "owner@example.com", state: "held" };
    expect(reviewRationale(undefined)).toBe("");
    const rationale = reviewRationale(decision);
    expect(rationale).toContain("No clear category");
    expect(rationale).toContain("This is a proposal");
    expect(rationale).toContain("&lt;img src=x onerror=&quot;bad()&quot;&gt;");
    expect(rationale).not.toContain("<img");
    expect(decisionHistory(undefined, false)).toBe("");
    const history = decisionHistory(Array.from({ length: 25 }, () => decision), true);
    expect(history).toContain('class="decision-history" open');
    expect(history.match(/owner@example.com/g)).toHaveLength(20);
    expect(history).not.toContain("<img");
  });
});
