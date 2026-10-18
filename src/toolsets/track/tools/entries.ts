import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { TrackStore } from "../store.js";
import { formatDuration, hours, resolveRange } from "../time.js";

const store = (ctx: ToolsetContext) => new TrackStore(ctx.config);

const WHEN_HINT = 'ISO 8601 ("2026-07-22T14:00", "…T14:00:00Z") or "YYYY-MM-DD HH:mm" (local) or "YYYY-MM-DD".';

export function entryTools(): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "track_log",
      title: "Log time manually (after the fact)",
      description:
        "Records a time entry without the stopwatch — for retroactive logging (\"log 2h on the roadmap doc " +
        "yesterday afternoon\"). Give start+end, or durationMinutes (optionally anchored with start OR end; " +
        "defaults to ending now).",
      inputSchema: {
        task: z.string().describe("Task id (t1, t2, …) or unique name fragment."),
        durationMinutes: z.number().int().positive().optional().describe("Length of the work session in minutes."),
        start: z.string().optional().describe(`Start time. ${WHEN_HINT}`),
        end: z.string().optional().describe(`End time. ${WHEN_HINT}`),
        note: z.string().optional().describe("What was done — feeds reports and Person-log summaries."),
      },
      handler: async (args, ctx) => {
        const { entry, task } = store(ctx).logEntry(args);
        return ok({
          recorded: {
            entryId: entry.id,
            taskId: task.id,
            task: task.title,
            duration: formatDuration(entry.seconds),
            start: entry.start,
            end: entry.end,
            note: entry.note,
          },
        });
      },
    }),
    defineTool({
      name: "track_list_entries",
      title: "List time entries",
      description:
        "Lists raw time entries (newest last) in a range, optionally filtered to a task or project. " +
        "Use it to audit or find entry ids for track_edit_entry / track_delete_entry. For rollups, prefer track_report.",
      inputSchema: {
        range: z.enum(["today", "yesterday", "this_week", "last_week"]).optional().describe("Preset range (default today)."),
        from: z.string().optional().describe(`Custom range start (overrides range). ${WHEN_HINT}`),
        to: z.string().optional().describe("Custom range end (paired with from)."),
        task: z.string().optional().describe("Only entries for this task."),
        project: z.string().optional().describe("Only entries for tasks in this project."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const s = store(ctx);
        const r = resolveRange(args);
        const reg = s.loadRegistry();
        const tasksById = new Map(reg.tasks.map((t) => [t.id, t]));
        const entries = s.listEntries({ from: r.from, to: r.to, task: args.task, project: args.project });
        return ok({
          range: r.label,
          totalHours: hours(entries.reduce((acc, e) => acc + e.seconds, 0)),
          entries: entries.map((e) => ({
            id: e.id,
            taskId: e.taskId,
            task: tasksById.get(e.taskId)?.title ?? "(deleted task)",
            start: e.start,
            end: e.end,
            duration: formatDuration(e.seconds),
            note: e.note,
          })),
        });
      },
    }),
    defineTool({
      name: "track_edit_entry",
      title: "Edit a time entry",
      description:
        "Fixes a recorded entry: move it to another task, adjust start/end, or change the note. " +
        "Find entry ids with track_list_entries.",
      inputSchema: {
        entryId: z.string().describe("Entry id (e-…) from track_list_entries."),
        task: z.string().optional().describe("Reassign to this task."),
        start: z.string().optional().describe(`New start. ${WHEN_HINT}`),
        end: z.string().optional().describe(`New end. ${WHEN_HINT}`),
        note: z.string().optional().describe("New note (empty string clears it)."),
      },
      handler: async (args, ctx) => {
        const entry = store(ctx).updateEntry(args.entryId, args);
        return ok({ updated: { ...entry, duration: formatDuration(entry.seconds) } });
      },
    }),
    defineTool({
      name: "track_delete_entry",
      title: "Delete a time entry",
      description: "Permanently removes one recorded time entry (find ids with track_list_entries).",
      inputSchema: {
        entryId: z.string().describe("Entry id (e-…) to delete."),
      },
      annotations: { destructiveHint: true },
      handler: async (args, ctx) => {
        const entry = store(ctx).deleteEntry(args.entryId);
        return ok({ deleted: { ...entry, duration: formatDuration(entry.seconds) } });
      },
    }),
  ];
}
