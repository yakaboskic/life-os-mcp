import { loadConfig } from "../core/config.js";
import { TrackStore } from "../toolsets/track/store.js";
import { formatDuration, hours, resolveRange } from "../toolsets/track/time.js";

// Interactive terminal stopwatch — same store the MCP tools use, so the agent
// and the terminal always agree.

function getStore(): TrackStore {
  return new TrackStore(loadConfig());
}

export async function trackStart(taskWords: string[], note?: string): Promise<void> {
  const task = taskWords.join(" ").trim();
  if (!task) throw new Error('Usage: life-os track start <task id or name> [--note "..."]');
  const { stopped, task: t } = getStore().startTimer(task, note);
  if (stopped) console.log(`⏹  stopped previous: ${stopped.taskId} (${formatDuration(stopped.seconds)})`);
  console.log(`▶  ${t.id} "${t.title}" — stopwatch running${note ? ` (${note})` : ""}`);
}

export async function trackStop(note?: string): Promise<void> {
  const store = getStore();
  const entry = store.stopTimer(note);
  const reg = store.loadRegistry();
  const task = reg.tasks.find((t) => t.id === entry.taskId);
  console.log(`⏹  ${entry.taskId} "${task?.title ?? "?"}" — ${formatDuration(entry.seconds)} recorded${entry.note ? ` (${entry.note})` : ""}`);
  const today = resolveRange({ range: "today" });
  const total = store.listEntries({ from: today.from, to: today.to }).reduce((a, e) => a + e.seconds, 0);
  console.log(`   today: ${formatDuration(total)}`);
}

export async function trackStatus(): Promise<void> {
  const store = getStore();
  const timer = store.getTimer();
  const reg = store.loadRegistry();
  if (timer) {
    const task = reg.tasks.find((t) => t.id === timer.taskId);
    const secs = Math.round((Date.now() - new Date(timer.start).getTime()) / 1000);
    console.log(`▶  RUNNING: ${timer.taskId} "${task?.title ?? "?"}" — ${formatDuration(secs)}${timer.note ? ` (${timer.note})` : ""}`);
  } else {
    console.log("⏸  no stopwatch running");
  }
  for (const range of ["today", "this_week"] as const) {
    const r = resolveRange({ range });
    const total = store.listEntries({ from: r.from, to: r.to }).reduce((a, e) => a + e.seconds, 0);
    const target = range === "this_week" ? ` / target ${reg.weeklyTargetHours}h` : "";
    console.log(`   ${r.label}: ${formatDuration(total)}${target}`);
  }
}

export async function trackTasks(): Promise<void> {
  const reg = getStore().loadRegistry();
  const projects = new Map(reg.projects.map((p) => [p.id, p.name]));
  const open = reg.tasks.filter((t) => t.status === "open");
  if (open.length === 0) {
    console.log("No open tasks. Add one with the track_add_task MCP tool (or ask your agent).");
    return;
  }
  for (const t of open) {
    console.log(`${t.id.padEnd(5)} ${t.title}${t.projectId ? `  [${projects.get(t.projectId) ?? t.projectId}]` : ""}`);
  }
}

export async function trackReport(rangeArg?: string): Promise<void> {
  const store = getStore();
  const range = rangeArg?.replace("-", "_") ?? "this_week";
  const r = resolveRange({ range });
  const reg = store.loadRegistry();
  const entries = store.listEntries({ from: r.from, to: r.to });
  const tasksById = new Map(reg.tasks.map((t) => [t.id, t]));
  const projectsById = new Map(reg.projects.map((p) => [p.id, p]));

  const byProject = new Map<string, number>();
  for (const e of entries) {
    const task = tasksById.get(e.taskId);
    const name = task?.projectId ? (projectsById.get(task.projectId)?.name ?? task.projectId) : "(no project)";
    byProject.set(name, (byProject.get(name) ?? 0) + e.seconds);
  }
  const total = entries.reduce((a, e) => a + e.seconds, 0);
  console.log(`${r.label}: ${formatDuration(total)} (${hours(total)}h) across ${entries.length} entries`);
  if (r.isFullWeek) console.log(`weekly target: ${reg.weeklyTargetHours}h — remaining ${Math.max(0, hours(reg.weeklyTargetHours * 3600 - total))}h`);
  for (const [name, secs] of [...byProject.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${formatDuration(secs).padStart(8)}  ${name}`);
  }
}
