import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { TrackStore } from "../store.js";
import { formatDuration, hours, resolveRange } from "../time.js";

const store = (ctx: ToolsetContext) => new TrackStore(ctx.config);

function timerView(s: TrackStore) {
  const timer = s.getTimer();
  if (!timer) return null;
  const task = s.loadRegistry().tasks.find((t) => t.id === timer.taskId);
  const runningSeconds = Math.max(0, Math.round((Date.now() - new Date(timer.start).getTime()) / 1000));
  return {
    taskId: timer.taskId,
    task: task?.title ?? "(unknown task)",
    startedAt: timer.start,
    running: formatDuration(runningSeconds),
    runningSeconds,
    note: timer.note,
  };
}

function sumHours(s: TrackStore, range: "today" | "this_week"): number {
  const r = resolveRange({ range });
  return hours(s.listEntries({ from: r.from, to: r.to }).reduce((acc, e) => acc + e.seconds, 0));
}

export function timerTools(): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "track_status",
      title: "Stopwatch status",
      description:
        "Shows whether the stopwatch is running (and on which task), plus recorded hours today and this week. " +
        "Cheap — call this before starting/stopping if unsure of current state.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
      handler: async (_args, ctx) => {
        const s = store(ctx);
        return ok({
          activeTimer: timerView(s),
          recordedTodayHours: sumHours(s, "today"),
          recordedThisWeekHours: sumHours(s, "this_week"),
          weeklyTargetHours: s.loadRegistry().weeklyTargetHours,
        });
      },
    }),
    defineTool({
      name: "track_start",
      title: "Start the stopwatch on a task",
      description:
        "Starts timing a task (by id like `t3`, or by name/substring). Only one stopwatch runs at a time: if another " +
        "task is being timed, that entry is stopped and recorded automatically, then the new one starts. " +
        "If the task doesn't exist yet, create it first with track_add_task.",
      inputSchema: {
        task: z.string().describe("Task id (t1, t2, …) or a unique name fragment. See track_overview."),
        note: z.string().optional().describe("What this work session is about (becomes the entry note on stop)."),
      },
      handler: async (args, ctx) => {
        const s = store(ctx);
        const { stopped, timer, task } = s.startTimer(args.task, args.note);
        return ok({
          started: { taskId: task.id, task: task.title, at: timer.start, note: timer.note },
          autoStopped: stopped
            ? { entryId: stopped.id, taskId: stopped.taskId, duration: formatDuration(stopped.seconds) }
            : null,
        });
      },
    }),
    defineTool({
      name: "track_stop",
      title: "Stop the stopwatch and record the entry",
      description:
        "Stops the running stopwatch and records a time entry. Optionally attach/override the note describing what " +
        "was done — notes feed weekly reports and Person-log summaries, so a one-liner is worth adding.",
      inputSchema: {
        note: z.string().optional().describe("What was accomplished (overrides the note given at start)."),
      },
      handler: async (args, ctx) => {
        const s = store(ctx);
        const entry = s.stopTimer(args.note);
        const task = s.loadRegistry().tasks.find((t) => t.id === entry.taskId);
        return ok({
          recorded: {
            entryId: entry.id,
            taskId: entry.taskId,
            task: task?.title,
            duration: formatDuration(entry.seconds),
            start: entry.start,
            end: entry.end,
            note: entry.note,
          },
          recordedTodayHours: sumHours(s, "today"),
        });
      },
    }),
    defineTool({
      name: "track_cancel",
      title: "Discard the running stopwatch",
      description:
        "Stops the running stopwatch WITHOUT recording an entry (accidental start, forgot to stop overnight, etc.). " +
        "To keep the time instead, use track_stop; to record a corrected span, follow up with track_log.",
      inputSchema: {},
      annotations: { destructiveHint: true },
      handler: async (_args, ctx) => {
        const timer = store(ctx).cancelTimer();
        return ok({ discarded: timer });
      },
    }),
  ];
}
