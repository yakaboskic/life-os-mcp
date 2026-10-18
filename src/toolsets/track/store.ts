import type { DatabaseSync } from "node:sqlite";
import { openDatabase, transaction } from "../../state/database.js";
import { randomBytes, randomUUID } from "node:crypto";
import { ToolInputError } from "../../core/errors.js";
import type { LifeOsConfig } from "../../core/config.js";
import { parseWhen } from "./time.js";
import { normalizeStatus } from "./status.js";
import {
  EMPTY_REGISTRY,
  type Product,
  type Project,
  type Role,
  type Task,
  type TimeEntry,
  type TimerState,
  type TrackRegistry,
} from "./types.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item"
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function taskTitle(value: string): string {
  const title = value.trim();
  if (!title || title.length > 500) throw new ToolInputError("Task title must contain 1 to 500 characters.");
  return title;
}

/** SQLite tracker. Every mutation holds an immediate transaction, including timer transitions. */
export class TrackStore {
  readonly db: DatabaseSync;

  constructor(config: LifeOsConfig) {
    this.db = openDatabase(config);
    // Wrap complete operations, not only their final writes. Nested operations use savepoints.
    for (const name of ["saveRegistry", "addProduct", "updateProduct", "addProject", "updateProject",
      "addTask", "updateTask", "startTimer", "stopTimer", "cancelTimer", "logEntry", "updateEntry", "deleteEntry"] as const) {
      const original = (this[name] as Function).bind(this);
      (this as any)[name] = (...args: unknown[]) => transaction(this.db, () => original(...args));
    }
  }

  loadRegistry(): TrackRegistry {
    const read = <T>(table: string): T[] => this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r => JSON.parse(String(r.data)) as T);
    const settings = Object.fromEntries(this.db.prepare("SELECT key,value FROM settings").all().map(r => [r.key, r.value]));
    return { products: read<Product>("products"), projects: read<Project>("projects"), tasks: read<Task>("tasks"),
      nextTaskNum: Number(settings.nextTaskNum), weeklyTargetHours: Number(settings.weeklyTargetHours) };
  }

  saveRegistry(reg: TrackRegistry): void {
    for (const [table, items, parent] of [
      ["products", reg.products, null], ["projects", reg.projects, "product"], ["tasks", reg.tasks, "project"],
    ] as const) {
      for (const item of items) {
        const values = parent ? [item.id, (item as any)[`${parent}Id`] ?? null, JSON.stringify(item)] : [item.id, JSON.stringify(item)];
        const columns = parent ? `id,${parent}_id,data` : "id,data";
        const updates = parent ? `${parent}_id=excluded.${parent}_id,data=excluded.data` : "data=excluded.data";
        this.db.prepare(`INSERT INTO ${table}(${columns}) VALUES(${values.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${updates}`).run(...values);
      }
    }
    // Replacements are permitted only when no remaining entry/timer references removed objects.
    for (const [table, items] of [["tasks",reg.tasks],["projects",reg.projects],["products",reg.products]] as const) {
      this.db.prepare(`DELETE FROM ${table} WHERE id NOT IN (SELECT value FROM json_each(?))`).run(JSON.stringify(items.map(i => i.id)));
    }
    this.db.prepare("UPDATE settings SET value=? WHERE key='nextTaskNum'").run(String(reg.nextTaskNum));
    this.db.prepare("UPDATE settings SET value=? WHERE key='weeklyTargetHours'").run(String(reg.weeklyTargetHours));
  }

  // ---- resolution (id, exact name, unique substring — all case-insensitive) ----

  private resolveIn<T extends { id: string }>(
    kind: string,
    items: T[],
    input: string,
    nameOf: (t: T) => string,
    describe: (t: T) => string,
  ): T {
    const needle = input.trim().toLowerCase();
    const byId = items.find((t) => t.id.toLowerCase() === needle);
    if (byId) return byId;
    const byName = items.filter((t) => nameOf(t).toLowerCase() === needle);
    if (byName.length === 1) return byName[0]!;
    const bySub = items.filter(
      (t) => nameOf(t).toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle),
    );
    if (bySub.length === 1) return bySub[0]!;
    if (bySub.length > 1) {
      throw new ToolInputError(
        `"${input}" matches multiple ${kind}s: ${bySub.map(describe).join(", ")}. Be more specific or use the id.`,
      );
    }
    const known = items.map(describe).join(", ");
    throw new ToolInputError(
      known ? `Unknown ${kind} "${input}". Known ${kind}s: ${known}.` : `No ${kind}s exist yet.`,
    );
  }

  resolveProduct(input: string): Product {
    const reg = this.loadRegistry();
    return this.resolveIn("product", reg.products, input, (p) => p.name, (p) => `${p.name} (${p.id})`);
  }

  resolveProject(input: string): Project {
    const reg = this.loadRegistry();
    return this.resolveIn("project", reg.projects, input, (p) => p.name, (p) => `${p.name} (${p.id})`);
  }

  resolveTask(input: string): Task {
    const reg = this.loadRegistry();
    return this.resolveIn("task", reg.tasks, input, (t) => t.title, (t) => `${t.id} "${t.title}"`);
  }

  // ---- products / projects / tasks ----

  private uniqueSlug(reg: TrackRegistry, list: { id: string }[], name: string): string {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; list.some((i) => i.id === slug); n++) slug = `${base}-${n}`;
    return slug;
  }

  addProduct(input: Omit<Product, "id" | "created_at">): Product {
    const reg = this.loadRegistry();
    if (reg.products.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) {
      throw new ToolInputError(`Product "${input.name}" already exists.`);
    }
    if (input.status) input = { ...input, status: normalizeStatus(input.status) };
    const product: Product = { ...input, id: this.uniqueSlug(reg, reg.products, input.name), created_at: nowIso() };
    reg.products.push(product);
    this.saveRegistry(reg);
    return product;
  }

  updateProduct(idOrName: string, patch: Partial<Omit<Product, "id" | "created_at">>): Product {
    const target = this.resolveProduct(idOrName);
    const reg = this.loadRegistry();
    const product = reg.products.find((p) => p.id === target.id)!;
    if (patch.status) patch = { ...patch, status: normalizeStatus(patch.status) };
    Object.assign(product, prune(patch));
    this.saveRegistry(reg);
    return product;
  }

  addProject(input: Omit<Project, "id" | "created_at" | "productId"> & { product?: string }): Project {
    const productId = input.product ? this.resolveProduct(input.product).id : undefined;
    const reg = this.loadRegistry();
    if (reg.projects.some((p) => p.name.toLowerCase() === input.name.toLowerCase())) {
      throw new ToolInputError(`Project "${input.name}" already exists.`);
    }
    const { product: _drop, ...rest } = input;
    if (rest.status) rest.status = normalizeStatus(rest.status);
    const project: Project = {
      ...rest,
      productId,
      id: this.uniqueSlug(reg, reg.projects, input.name),
      created_at: nowIso(),
    };
    reg.projects.push(project);
    this.saveRegistry(reg);
    return project;
  }

  updateProject(
    idOrName: string,
    patch: Partial<Omit<Project, "id" | "created_at" | "productId">> & { product?: string },
  ): Project {
    const target = this.resolveProject(idOrName);
    const productId = patch.product !== undefined ? this.resolveProduct(patch.product).id : undefined;
    const reg = this.loadRegistry();
    const project = reg.projects.find((p) => p.id === target.id)!;
    const { product: _drop, ...rest } = patch;
    if (rest.status) rest.status = normalizeStatus(rest.status);
    Object.assign(project, prune(rest));
    if (productId !== undefined) project.productId = productId;
    this.saveRegistry(reg);
    return project;
  }

  addTask(input: { title: string; project?: string; notes?: string }): Task {
    const projectId = input.project ? this.resolveProject(input.project).id : undefined;
    const reg = this.loadRegistry();
    const task: Task = {
      id: `t${reg.nextTaskNum}`,
      title: taskTitle(input.title),
      projectId,
      status: "open",
      notes: input.notes,
      created_at: nowIso(),
    };
    reg.nextTaskNum += 1;
    reg.tasks.push(prune(task) as Task);
    this.saveRegistry(reg);
    return task;
  }

  updateTask(
    idOrName: string,
    patch: { title?: string; project?: string | null; status?: "open" | "done"; notes?: string },
  ): Task {
    const target = this.resolveTask(idOrName);
    const projectId = patch.project != null ? this.resolveProject(patch.project).id : undefined;
    const reg = this.loadRegistry();
    const task = reg.tasks.find((t) => t.id === target.id)!;
    if (patch.title !== undefined) task.title = taskTitle(patch.title);
    if (patch.notes !== undefined) task.notes = patch.notes;
    if (projectId !== undefined) task.projectId = projectId;
    if (patch.project === null) delete task.projectId;
    if (patch.status !== undefined && patch.status !== task.status) {
      // Keep browser and MCP completion semantics identical and atomic.
      if (patch.status === "done" && this.getTimer()?.taskId === task.id) this.stopTimer();
      task.status = patch.status;
      task.done_at = patch.status === "done" ? nowIso() : undefined;
    }
    this.saveRegistry(reg);
    return prune(task) as Task;
  }

  // ---- timer ----

  getTimer(): TimerState | null {
    const row = this.db.prepare("SELECT data FROM active_timer WHERE singleton=1").get();
    return row ? JSON.parse(String(row.data)) as TimerState : null;
  }

  /** Starts the stopwatch on a task; auto-stops (and records) any running timer. */
  startTimer(taskInput: string, note?: string): { stopped: TimeEntry | null; timer: TimerState; task: Task } {
    const task = this.resolveTask(taskInput);
    if (task.status === "done") throw new ToolInputError("Reopen this task before starting its timer.");
    let stopped: TimeEntry | null = null;
    const running = this.getTimer();
    if (running) {
      if (running.taskId === task.id) {
        throw new ToolInputError(`The stopwatch is already running on ${task.id} "${task.title}".`);
      }
      stopped = this.stopTimer();
    }
    const timer: TimerState = { id: randomUUID(), taskId: task.id, start: nowIso(), ...(note ? { note } : {}) };
    this.db.prepare("INSERT OR REPLACE INTO active_timer VALUES(1,?,?)").run(timer.taskId, JSON.stringify(timer));
    return { stopped, timer, task };
  }

  stopTimer(note?: string): TimeEntry {
    const timer = this.getTimer();
    if (!timer) throw new ToolInputError("No stopwatch is running. Start one with track_start.");
    const end = new Date();
    const start = new Date(timer.start);
    const entry = this.appendEntry({
      taskId: timer.taskId,
      start: start.toISOString(),
      end: end.toISOString(),
      note: note ?? timer.note,
    });
    this.db.prepare("DELETE FROM active_timer WHERE singleton=1").run();
    return entry;
  }

  cancelTimer(): TimerState {
    const timer = this.getTimer();
    if (!timer) throw new ToolInputError("No stopwatch is running.");
    this.db.prepare("DELETE FROM active_timer WHERE singleton=1").run();
    return timer;
  }

  // ---- time entries ----

  readEntries(): TimeEntry[] {
    return this.db.prepare("SELECT data FROM entries ORDER BY start,id").all().map(row => JSON.parse(String(row.data)) as TimeEntry);
  }

  private writeEntries(entries: TimeEntry[]): void {
    this.db.prepare("DELETE FROM entries").run();
    const insert = this.db.prepare("INSERT INTO entries VALUES(?,?,?,?)");
    for (const entry of entries) insert.run(entry.id, entry.taskId, entry.start, JSON.stringify(entry));
  }

  private appendEntry(input: { taskId: string; start: string; end: string; note?: string }): TimeEntry {
    const start = new Date(input.start);
    const end = new Date(input.end);
    // Strictly-before is the error; end === start (instant stop) records a 0m entry.
    if (end.getTime() < start.getTime()) throw new ToolInputError("Entry end must be after start.");
    const entry: TimeEntry = {
      id: `e-${Date.now().toString(36)}${randomBytes(2).toString("hex")}`,
      taskId: input.taskId,
      start: start.toISOString(),
      end: end.toISOString(),
      seconds: Math.round((end.getTime() - start.getTime()) / 1000),
      ...(input.note ? { note: input.note } : {}),
    };
    this.db.prepare("INSERT INTO entries VALUES(?,?,?,?)").run(entry.id, entry.taskId, entry.start, JSON.stringify(entry));
    return entry;
  }

  /** Manual entry: either explicit start+end, or durationMinutes (+ optional end, default now). */
  logEntry(input: { task: string; start?: string; end?: string; durationMinutes?: number; note?: string }): {
    entry: TimeEntry;
    task: Task;
  } {
    const task = this.resolveTask(input.task);
    let start: Date;
    let end: Date;
    if (input.durationMinutes !== undefined) {
      if (input.durationMinutes <= 0) throw new ToolInputError("durationMinutes must be positive.");
      if (input.start && input.end) {
        throw new ToolInputError("Give durationMinutes with at most one of start/end (the other is derived).");
      }
      if (input.start) {
        start = parseWhen(input.start, "start");
        end = new Date(start.getTime() + input.durationMinutes * 60_000);
      } else {
        end = input.end ? parseWhen(input.end, "end") : new Date();
        start = new Date(end.getTime() - input.durationMinutes * 60_000);
      }
    } else {
      if (!input.start || !input.end) {
        throw new ToolInputError("Provide start+end, or durationMinutes (optionally with start or end).");
      }
      start = parseWhen(input.start, "start");
      end = parseWhen(input.end, "end");
    }
    const entry = this.appendEntry({ taskId: task.id, start: start.toISOString(), end: end.toISOString(), note: input.note });
    return { entry, task };
  }

  updateEntry(id: string, patch: { task?: string; start?: string; end?: string; note?: string }): TimeEntry {
    const entries = this.readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new ToolInputError(`No time entry with id "${id}". Use track_list_entries to find ids.`);
    if (patch.task !== undefined) entry.taskId = this.resolveTask(patch.task).id;
    if (patch.start !== undefined) entry.start = parseWhen(patch.start, "start").toISOString();
    if (patch.end !== undefined) entry.end = parseWhen(patch.end, "end").toISOString();
    if (patch.note !== undefined) entry.note = patch.note || undefined;
    const start = new Date(entry.start);
    const end = new Date(entry.end);
    if (end.getTime() < start.getTime()) throw new ToolInputError("Entry end must be after start.");
    entry.seconds = Math.round((end.getTime() - start.getTime()) / 1000);
    this.writeEntries(entries);
    return entry;
  }

  deleteEntry(id: string): TimeEntry {
    const entries = this.readEntries();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new ToolInputError(`No time entry with id "${id}". Use track_list_entries to find ids.`);
    this.writeEntries(entries.filter((e) => e.id !== id));
    return entry;
  }

  /** Entries whose START falls in [from, to). Optional task/project filter. */
  listEntries(filter: { from?: Date; to?: Date; task?: string; project?: string } = {}): TimeEntry[] {
    const reg = this.loadRegistry();
    const taskId = filter.task ? this.resolveTask(filter.task).id : undefined;
    const projectId = filter.project ? this.resolveProject(filter.project).id : undefined;
    const taskIdsInProject = projectId
      ? new Set(reg.tasks.filter((t) => t.projectId === projectId).map((t) => t.id))
      : undefined;
    return this.readEntries().filter((e) => {
      const start = new Date(e.start);
      if (filter.from && start < filter.from) return false;
      if (filter.to && start >= filter.to) return false;
      if (taskId && e.taskId !== taskId) return false;
      if (taskIdsInProject && !taskIdsInProject.has(e.taskId)) return false;
      return true;
    });
  }
}

/** Drop undefined values so optional fields don't serialize as nulls/keys. */
function prune<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
