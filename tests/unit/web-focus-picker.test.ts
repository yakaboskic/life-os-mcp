import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORTAL_HTML } from "../../src/web/page.js";

const script = PORTAL_HTML.split("<script>")[1]!.split("</script>")[0]!;
const functions = script.slice(script.indexOf("  function focusCatalog("), script.indexOf("  function renderFocusPicker("));
const { focusCatalog, focusSearch, focusStartInput } = runInNewContext(`${functions}\n({ focusCatalog, focusSearch, focusStartInput });`);
const snapshot = {
  products: [{ id: "space", name: "Flight Systems" }],
  projects: [{ id: "science", name: "Lunar Research", productId: "space" }, { id: "empty", name: "Launch Planning", productId: "space" }],
  tasks: [
    { id: "t1", title: "Review results", projectId: "science", status: "open" },
    { id: "t10", title: "Review results", status: "open" },
    { id: "t2", title: "Résumé draft", status: "open" },
    { id: "done", title: "Finished experiment", projectId: "science", status: "done" },
    { id: "running", title: "Current experiment", projectId: "science", status: "open" },
  ],
};

describe("searchable focus picker", () => {
  it("searches task IDs, project and product context while excluding completed/current tasks", () => {
    const catalog = focusCatalog(snapshot, "running");
    expect(catalog.filter((row: any) => row.kind === "task").map((row: any) => row.id)).toEqual(["t1", "t10", "t2"]);
    expect(focusSearch(catalog, "t1").rows[0].id).toBe("t1");
    expect(focusSearch(catalog, "lunar results").rows.map((row: any) => row.id)).toEqual(["t1"]);
    expect(focusSearch(catalog, "science").rows.map((row: any) => row.id)).toEqual(["science", "t1"]);
    expect(focusSearch(catalog, "FLIGHT systems").rows.map((row: any) => row.id).sort()).toEqual(["empty", "science", "t1"]);
    expect(focusSearch(catalog, "space").rows.map((row: any) => row.id).sort()).toEqual(["empty", "science", "t1"]);
    expect(focusSearch(catalog, "resume").rows[0].id).toBe("t2");
  });

  it("keeps empty projects selectable and gives duplicate task names distinct context", () => {
    const catalog = focusCatalog(snapshot, "running");
    expect(catalog.find((row: any) => row.id === "empty")).toMatchObject({ kind: "project", openTasks: 0, context: "Flight Systems › Launch Planning" });
    expect(catalog.find((row: any) => row.id === "t1").context).toBe("Flight Systems › Lunar Research");
    expect(catalog.find((row: any) => row.id === "t10").context).toBe("No project");
    expect(focusSearch(catalog, "nothing matches")).toEqual({ rows: [], total: 0 });
  });

  it("bounds visible results without hiding how many matches exist", () => {
    const catalog = focusCatalog({ ...snapshot, tasks: Array.from({ length: 75 }, (_, index) => ({ id: `t${index}`, title: `Task ${index}`, status: "open" })) }, null);
    const result = focusSearch(catalog, "task");
    expect(result.total).toBe(75);
    expect(result.rows).toHaveLength(40);
  });

  it("requires a deliberate choice and sends exactly one task target", () => {
    expect(() => focusStartInput(null, "Title", "", null)).toThrow("Choose a task");
    expect(focusStartInput({ kind: "task", id: "t1" }, "ignored draft", "Session note", "timer-revision")).toEqual({ taskId: "t1", note: "Session note", expectedTimerRevision: "timer-revision" });
    expect(focusStartInput({ kind: "project", id: "empty" }, "  Plan launch  ", "Session note", null)).toEqual({ newTask: { title: "Plan launch", projectId: "empty" }, note: "Session note", expectedTimerRevision: null });
    expect(focusStartInput({ kind: "new" }, "Personal activity", "", null)).toEqual({ newTask: { title: "Personal activity" }, note: "", expectedTimerRevision: null });
    for (const title of ["   ", "x".repeat(501)]) expect(() => focusStartInput({ kind: "new" }, title, "", null)).toThrow("1 to 500");
  });
});
