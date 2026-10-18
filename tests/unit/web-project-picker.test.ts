import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PORTAL_HTML } from "../../src/web/page.js";

const script = PORTAL_HTML.split("<script>")[1]!.split("</script>")[0]!;
const esc = script.slice(script.indexOf("  const esc ="), script.indexOf("  const timeHM ="));
const search = script.slice(script.indexOf("  function focusSearch("), script.indexOf("  function focusStartInput("));
const functions = script.slice(script.indexOf("  function projectCatalog("), script.indexOf("  function openTaskEditor("));
const snapshot = {
  products: [{ id: "mission", name: "Flight Systems" }, { id: "lab", name: "Science Lab" }],
  projects: [
    { id: "science", name: "Lunar Research", productId: "mission" },
    { id: "launch", name: "Launch Planning", productId: "mission" },
    { id: "duplicate", name: "Lunar Research", productId: "lab" },
    { id: "resume", name: "Résumé draft" },
  ],
};
function harness() {
  const nodes = new Map<string, any>();
  const $ = (id: string) => {
    if (!nodes.has(id)) nodes.set(id, { value: "", innerHTML: "", textContent: "", hidden: false, attributes: new Map(), focused: false, scrolled: false,
      setAttribute(key: string, value: string) { this.attributes.set(key, value); }, removeAttribute(key: string) { this.attributes.delete(key); },
      focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
    });
    return nodes.get(id);
  };
  const api = runInNewContext(`${esc}${search}${functions}
    let permitted = true;
    const canAct = () => permitted;
    const actionEditor = { uncertain: false, project: { catalog: projectCatalog(snapshot), selected: null, query: '', rows: [], activeIndex: -1, open: false } };
    renderProjectPicker();
    ({ projectCatalog, focusSearch, taskEditorInput, projectCreateInput, renderProjectPicker, projectPickerKey, selectProjectOption,
      picker: actionEditor.project, freeze: () => actionEditor.uncertain = true, disable: () => permitted = false });`, { snapshot, $ });
  return { ...api, $ };
}
function key(api: ReturnType<typeof harness>, value: string) {
  const event = { key: value, target: { name: "projectSearch" }, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  api.projectPickerKey(event); return event;
}
const form = (values: Record<string, string | undefined>) => new Map(Object.entries(values));

describe("project creation and searchable task assignment", () => {
  it("searches exact IDs, names and product context with distinct duplicate-name breadcrumbs", () => {
    const { projectCatalog, focusSearch } = harness(), catalog = projectCatalog(snapshot);
    expect(focusSearch(catalog, "science").rows[0].id).toBe("science");
    expect(focusSearch(catalog, "flight lunar").rows.map((row: any) => row.id)).toEqual(["science"]);
    expect(focusSearch(catalog, "mission").rows.map((row: any) => row.id)).toEqual(["launch", "science"]);
    expect(focusSearch(catalog, "resume").rows[0].id).toBe("resume");
    expect(catalog.find((row: any) => row.id === "science").context).toBe("Flight Systems · science");
    expect(catalog.find((row: any) => row.id === "duplicate").context).toBe("Science Lab · duplicate");
    expect(catalog.find((row: any) => row.id === "resume").context).toBe("Independent project · resume");
  });

  it("submits only the selected project ID, preserving it during an unrelated search and clearing it explicitly", () => {
    const api = harness(), selected = api.picker.catalog.find((row: any) => row.id === "science");
    api.picker.selected = selected; api.picker.query = "does not exist"; api.picker.open = true; api.renderProjectPicker();
    expect(api.picker.selected).toBe(selected);
    expect(api.$("project-selection").innerHTML).toContain("Lunar Research");
    expect(api.$("project-search-status").textContent).toContain("No matching projects");
    const draft = form({ title: "  Review results  ", notes: "Keep this note", projectSearch: "does not exist", projectId: "unselected-id" });
    expect(api.taskEditorInput(draft, null, selected)).toEqual({ title: "Review results", projectId: "science", notes: "Keep this note" });
    api.selectProjectOption(api.picker.rows.length - 1);
    expect(api.taskEditorInput(draft, { id: "t1", revision: "revision" }, api.picker.selected)).toEqual({ taskId: "t1", expectedRevision: "revision", title: "Review results", projectId: null, notes: "Keep this note" });
    expect(api.taskEditorInput(draft, null, null)).not.toHaveProperty("projectId");
  });

  it("moves the active option with arrow keys and selects with Enter without submitting the form", () => {
    const api = harness(); api.picker.query = "mission"; api.renderProjectPicker();
    expect(key(api, "ArrowDown").prevented).toBe(true);
    expect(api.picker.selected).toBeNull();
    expect(api.$("action-field-projectSearch").attributes.get("aria-activedescendant")).toBe("project-option-0");
    key(api, "ArrowDown"); expect(api.picker.activeIndex).toBe(1);
    key(api, "ArrowUp"); expect(api.picker.activeIndex).toBe(0);
    expect(key(api, "Enter").prevented).toBe(true);
    expect(api.picker.selected.id).toBe("launch"); expect(api.picker.open).toBe(false);
    expect(api.$("action-field-notes").focused).toBe(true);
    expect(api.$("action-field-projectSearch").attributes.get("aria-expanded")).toBe("false");
    expect(api.$("action-field-projectSearch").attributes.has("aria-activedescendant")).toBe(false);
  });

  it("supports explicit No project via keyboard and closes results on Escape/Tab without discarding selection", () => {
    const api = harness(); api.picker.selected = api.picker.catalog[0]; api.renderProjectPicker();
    key(api, "ArrowDown"); const escape = key(api, "Escape");
    expect(escape.prevented).toBe(true); expect(escape.stopped).toBe(true); expect(api.picker.selected.id).toBe("science");
    key(api, "ArrowDown"); expect(key(api, "Tab").prevented).toBe(false); expect(api.picker.open).toBe(false);
    key(api, "End"); key(api, "Enter"); expect(api.picker.selected).toBeNull();
    expect(api.$("project-selection").innerHTML).toContain("This task will not belong to a project.");
  });

  it("does not let keyboard or click selection mutate an uncertain or disabled request", () => {
    for (const freeze of ["freeze", "disable"]) {
      const api = harness(); api.picker.selected = api.picker.catalog[0]; const before = api.picker.selected;
      api[freeze](); key(api, "ArrowDown"); api.selectProjectOption(api.picker.rows.length - 1);
      expect(api.picker.selected).toBe(before); expect(api.picker.open).toBe(false);
    }
  });

  it("escapes project names and product context in result and selection markup", () => {
    const api = harness(); api.picker.catalog = [{ key: "x", kind: "project", id: "x", title: '<img src=x onerror="bad()">', context: "<b>Product</b>", search: ["x"] }];
    api.picker.selected = api.picker.catalog[0]; api.renderProjectPicker();
    for (const id of ["project-selection", "project-results"]) {
      expect(api.$(id).innerHTML).not.toContain("<img"); expect(api.$(id).innerHTML).toContain("&lt;img"); expect(api.$(id).innerHTML).not.toContain("<b>");
    }
  });

  it("builds the exact project action fields with optional associations and bounded text", () => {
    const { projectCreateInput } = harness();
    expect(projectCreateInput(form({ name: "  Mission control  ", productId: "mission", goal: "Improve launch planning", notes: "Reference notes" }))).toEqual({ name: "Mission control", productId: "mission", goal: "Improve launch planning", notes: "Reference notes" });
    expect(projectCreateInput(form({ name: "Independent", productId: "", goal: "", notes: "" }))).toEqual({ name: "Independent" });
    for (const input of [{ name: " " }, { name: "x".repeat(201) }, { name: "Valid", goal: "x".repeat(2001) }, { name: "Valid", notes: "x".repeat(20001) }]) expect(() => projectCreateInput(form(input))).toThrow();
  });
});
