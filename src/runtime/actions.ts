import { createHash } from "node:crypto";
import { z } from "zod";
import type { LifeOsConfig } from "../core/config.js";
import { transaction } from "../state/database.js";
import { TrackStore } from "../toolsets/track/store.js";

const id = z.string().min(1).max(200);
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const note = z.string().max(20_000);
const instant = z.string().datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)));
export const actionEnvelope = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
  action: z.enum(["timer.start", "timer.stop", "timer.cancel", "project.create", "task.create", "task.update", "time.log", "time.update",
    "automation.run", "automation.schedule", "review.resolve"]),
  input: z.record(z.unknown()),
}).strict();
const schemas = {
  "timer.start": z.union([
    z.object({ taskId: id, note: note.optional(), expectedTimerRevision: revision.nullable() }).strict(),
    z.object({ newTask: z.object({ title: z.string().trim().min(1).max(500), projectId: id.optional() }).strict(),
      note: note.optional(), expectedTimerRevision: revision.nullable() }).strict(),
  ]),
  "timer.stop": z.object({ expectedTimerRevision: revision, note: note.optional() }).strict(),
  "timer.cancel": z.object({ expectedTimerRevision: revision }).strict(),
  "project.create": z.object({ name: z.string().trim().min(1).max(200), productId: id.optional(),
    goal: z.string().max(2_000).optional(), notes: note.optional() }).strict(),
  "task.create": z.object({ title: z.string().trim().min(1).max(500), projectId: id.optional(), notes: note.optional() }).strict(),
  "task.update": z.object({ taskId: id, expectedRevision: revision, title: z.string().trim().min(1).max(500).optional(),
    projectId: id.nullable().optional(), notes: note.optional(), status: z.enum(["open", "done"]).optional(),
    expectedTimerRevision: revision.optional() }).strict(),
  "time.log": z.object({ taskId: id, start: instant, end: instant, note: note.optional() }).strict(),
  "time.update": z.object({ entryId: id, expectedRevision: revision, taskId: id.optional(), start: instant.optional(),
    end: instant.optional(), note: note.optional() }).strict(),
};
export class ActionError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = "INVALID_ACTION") { super(message); }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Content preconditions also detect changes made by older MCP clients. */
export function entityRevision(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function withRevision<T extends object>(value: T): T & { revision: string } {
  return { ...value, revision: entityRevision(value) };
}
export function parseActionRequest(raw: unknown): z.infer<typeof actionEnvelope> {
  const parsed = actionEnvelope.safeParse(raw);
  if (!parsed.success) throw new ActionError("Invalid action request. Refresh LifeOS and try again.");
  return parsed.data;
}
/** Commands and durable receipts commit together; a lost response can be safely retried. */
export class TrackerActions {
  readonly store: TrackStore;
  constructor(config: LifeOsConfig) {
    this.store = new TrackStore(config);
    transaction(this.store.db, () => this.store.db.exec(`CREATE TABLE IF NOT EXISTS action_receipts(
      request_id TEXT PRIMARY KEY, actor TEXT NOT NULL, request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL CHECK(json_valid(response_json)), created_at TEXT NOT NULL)`));
  }
  execute(raw: unknown, actor: string): { ok: true; requestId: string; result: unknown } {
    const request = parseActionRequest(raw);
    if (!(request.action in schemas)) throw new ActionError("This command is not a tracker action.");
    if (!actor || actor.length > 320 || /[\r\n\x00]/.test(actor)) throw new ActionError("Invalid action actor.");
    const parsed = schemas[request.action as keyof typeof schemas].safeParse(request.input);
    if (!parsed.success) throw new ActionError(parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    const hash = entityRevision({ action: request.action, input: parsed.data });
    return transaction(this.store.db, () => {
      const existing = this.store.db.prepare("SELECT * FROM action_receipts WHERE request_id=?").get(request.requestId);
      if (existing) {
        if (existing.actor !== actor || existing.request_hash !== hash) throw new ActionError("This request ID was already used for another action.", 409, "REQUEST_CONFLICT");
        return JSON.parse(String(existing.response_json));
      }
      const result = this.apply(request.action as keyof typeof schemas, parsed.data);
      const response = { ok: true as const, requestId: request.requestId, result };
      this.store.db.prepare("INSERT INTO action_receipts VALUES(?,?,?,?,?)").run(request.requestId, actor, hash, JSON.stringify(response), new Date().toISOString());
      return response;
    });
  }
  private expectTimer(expected: string | null): void {
    const current = this.store.getTimer();
    if ((current ? entityRevision(current) : null) !== expected) throw new ActionError("The focus timer changed. Refresh it before trying again.", 409, "TIMER_CHANGED");
  }
  private task(taskId: string) {
    const task = this.store.loadRegistry().tasks.find(t => t.id === taskId);
    if (!task) throw new ActionError("This task no longer exists.", 404, "TASK_MISSING");
    return task;
  }
  private project(projectId?: string | null): void {
    if (projectId && !this.store.loadRegistry().projects.some(p => p.id === projectId)) throw new ActionError("This project no longer exists.", 404, "PROJECT_MISSING");
  }
  private apply(action: keyof typeof schemas, input: any): unknown {
    switch (action) {
      case "timer.start": {
        this.expectTimer(input.expectedTimerRevision);
        // Task creation, a possible switch, and the receipt share the outer transaction.
        // A stale timer or a lost response must never leave a duplicate/orphan task.
        if (input.newTask) {
          this.project(input.newTask.projectId);
          const task = this.store.addTask({ title: input.newTask.title, project: input.newTask.projectId });
          return this.store.startTimer(task.id, input.note);
        }
        this.task(input.taskId);
        return this.store.startTimer(input.taskId, input.note);
      }
      case "timer.stop": this.expectTimer(input.expectedTimerRevision); return this.store.stopTimer(input.note);
      case "timer.cancel": this.expectTimer(input.expectedTimerRevision); return this.store.cancelTimer();
      case "project.create": {
        const registry = this.store.loadRegistry();
        if (input.productId && !registry.products.some(product => product.id === input.productId)) {
          throw new ActionError("This product no longer exists.", 404, "PRODUCT_MISSING");
        }
        // The outer immediate transaction serializes this check with creation,
        // including projects created concurrently through an MCP client.
        if (registry.projects.some(project => project.name.trim().toLowerCase() === input.name.toLowerCase())) {
          throw new ActionError("A project with this name already exists. Use the existing project.", 409, "PROJECT_EXISTS");
        }
        return this.store.addProject({ name: input.name, product: input.productId, goal: input.goal, notes: input.notes });
      }
      case "task.create":
        this.project(input.projectId);
        return this.store.addTask({ title: input.title, project: input.projectId, notes: input.notes });
      case "task.update": {
        const task = this.task(input.taskId);
        if (entityRevision(task) !== input.expectedRevision) throw new ActionError("This task changed. Reopen it to edit the latest version.", 409, "TASK_CHANGED");
        if (!["title", "projectId", "notes", "status"].some(key => Object.hasOwn(input, key))) throw new ActionError("Choose a task field to change.");
        if (input.status === "done" && this.store.getTimer()?.taskId === task.id) {
          if (!input.expectedTimerRevision) throw new ActionError("This task has an active timer. Use Stop and complete.", 409, "TIMER_ACTIVE");
          this.expectTimer(input.expectedTimerRevision);
        }
        this.project(input.projectId);
        return this.store.updateTask(task.id, { title: input.title, project: input.projectId, notes: input.notes, status: input.status });
      }
      case "time.log":
        this.task(input.taskId);
        return this.store.logEntry({ task: input.taskId, start: input.start, end: input.end, note: input.note });
      case "time.update": {
        const entry = this.store.readEntries().find(e => e.id === input.entryId);
        if (!entry) throw new ActionError("This time entry no longer exists.", 404, "ENTRY_MISSING");
        if (entityRevision(entry) !== input.expectedRevision) throw new ActionError("This time entry changed. Reopen it to edit the latest version.", 409, "ENTRY_CHANGED");
        if (!["taskId", "start", "end", "note"].some(key => Object.hasOwn(input, key))) throw new ActionError("Choose a time entry field to change.");
        if (input.taskId) this.task(input.taskId);
        return this.store.updateEntry(entry.id, { task: input.taskId, start: input.start, end: input.end, note: input.note });
      }
    }
  }
}
