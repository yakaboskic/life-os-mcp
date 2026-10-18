import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { TrackStore } from "../store.js";
import { formatDuration, hours, localDateKey, resolveRange } from "../time.js";
import { checkInState } from "../status.js";
import type { TimeEntry } from "../types.js";

const store = (ctx: ToolsetContext) => new TrackStore(ctx.config);

export function reportTools(): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "track_report",
      title: "Time report (rollup by project/task/day)",
      description:
        "Aggregated time report for a range: total hours, hours vs the weekly target (for week ranges), and " +
        "breakdowns by day, product, project, and task — including the work-session notes per task. " +
        "This is the tool to use when preparing Person-log / Weekly-commitment updates for the team tracker.",
      inputSchema: {
        range: z
          .enum(["today", "yesterday", "this_week", "last_week"])
          .optional()
          .describe("Preset range (default this_week)."),
        from: z.string().optional().describe("Custom range start (overrides range)."),
        to: z.string().optional().describe("Custom range end (paired with from; bare dates are inclusive)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const s = store(ctx);
        const r = resolveRange({ range: args.range ?? "this_week", from: args.from, to: args.to });
        const reg = s.loadRegistry();
        const entries = s.listEntries({ from: r.from, to: r.to });

        const tasksById = new Map(reg.tasks.map((t) => [t.id, t]));
        const projectsById = new Map(reg.projects.map((p) => [p.id, p]));
        const productsById = new Map(reg.products.map((p) => [p.id, p]));

        const byDay = new Map<string, number>();
        const byTask = new Map<string, { seconds: number; notes: Set<string> }>();
        for (const e of entries) {
          const day = localDateKey(new Date(e.start));
          byDay.set(day, (byDay.get(day) ?? 0) + e.seconds);
          const t = byTask.get(e.taskId) ?? { seconds: 0, notes: new Set<string>() };
          t.seconds += e.seconds;
          if (e.note) t.notes.add(e.note);
          byTask.set(e.taskId, t);
        }

        interface ProjectRow {
          projectId: string | null;
          project: string;
          product?: string;
          role?: string;
          seconds: number;
          tasks: { taskId: string; task: string; status: string; hours: number; notes: string[] }[];
        }
        const projects = new Map<string, ProjectRow>();
        for (const [taskId, agg] of byTask) {
          const task = tasksById.get(taskId);
          const project = task?.projectId ? projectsById.get(task.projectId) : undefined;
          const key = project?.id ?? "(none)";
          const row = projects.get(key) ?? {
            projectId: project?.id ?? null,
            project: project?.name ?? "(no project)",
            product: project?.productId ? productsById.get(project.productId)?.name : undefined,
            role: project?.role,
            seconds: 0,
            tasks: [],
          };
          row.seconds += agg.seconds;
          row.tasks.push({
            taskId,
            task: task?.title ?? "(deleted task)",
            status: task?.status ?? "?",
            hours: hours(agg.seconds),
            notes: [...agg.notes],
          });
          projects.set(key, row);
        }

        const totalSeconds = entries.reduce((acc, e) => acc + e.seconds, 0);
        const byProduct = new Map<string, number>();
        for (const row of projects.values()) {
          byProduct.set(row.product ?? "(no product)", (byProduct.get(row.product ?? "(no product)") ?? 0) + row.seconds);
        }

        const timer = s.getTimer();
        return ok({
          range: { label: r.label, from: r.from.toISOString(), to: r.to.toISOString() },
          totalHours: hours(totalSeconds),
          total: formatDuration(totalSeconds),
          weeklyTarget: r.isFullWeek
            ? {
                hours: reg.weeklyTargetHours,
                loggedHours: hours(totalSeconds),
                remainingHours: Math.max(0, hours(reg.weeklyTargetHours * 3600 - totalSeconds)),
              }
            : undefined,
          byDay: [...byDay.entries()].sort().map(([date, seconds]) => ({ date, hours: hours(seconds) })),
          byProduct: [...byProduct.entries()].map(([product, seconds]) => ({ product, hours: hours(seconds) })),
          byProject: [...projects.values()]
            .sort((a, b) => b.seconds - a.seconds)
            .map((row) => ({
              project: row.project,
              projectId: row.projectId,
              product: row.product,
              role: row.role,
              hours: hours(row.seconds),
              tasks: row.tasks.sort((a, b) => b.hours - a.hours),
            })),
          entryCount: entries.length,
          activeTimer: timer
            ? {
                taskId: timer.taskId,
                task: tasksById.get(timer.taskId)?.title,
                startedAt: timer.start,
                note: "running — NOT included in totals until stopped",
              }
            : null,
        });
      },
    }),
    defineTool({
      name: "track_overview",
      title: "Full tracker overview (products → projects → tasks)",
      description:
        "The whole tracking registry as a tree: products with their projects, projects with their tasks (+ roles, " +
        "goals, deadlines, next milestones), standalone items, and the running stopwatch. Start here to see what " +
        "exists before adding or timing anything.",
      inputSchema: {
        includeDone: z.boolean().optional().describe("Include completed tasks (default false)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const s = store(ctx);
        const reg = s.loadRegistry();
        const timer = s.getTimer();
        const taskView = (t: (typeof reg.tasks)[number]) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          notes: t.notes,
        });
        const tasksFor = (projectId: string | undefined) =>
          reg.tasks
            .filter((t) => t.projectId === projectId && (args.includeDone || t.status === "open"))
            .map(taskView);
        const projectView = (p: (typeof reg.projects)[number]) => ({
          id: p.id,
          name: p.name,
          role: p.role,
          lead: p.lead,
          status: p.status,
          checkIn: p.status ? checkInState(p.status, p.lastCheckIn) : undefined,
          goal: p.goal,
          deadline: p.deadline,
          nextMilestone: p.nextMilestone,
          nextMilestoneDeadline: p.nextMilestoneDeadline,
          notes: p.notes,
          tasks: tasksFor(p.id),
        });
        return ok({
          products: reg.products.map((prod) => ({
            id: prod.id,
            name: prod.name,
            status: prod.status,
            checkIn: prod.status ? checkInState(prod.status, prod.lastCheckIn) : undefined,
            goal: prod.goal,
            deadline: prod.deadline,
            notes: prod.notes,
            projects: reg.projects.filter((p) => p.productId === prod.id).map(projectView),
          })),
          projectsWithoutProduct: reg.projects.filter((p) => !p.productId).map(projectView),
          tasksWithoutProject: tasksFor(undefined),
          activeTimer: timer,
          weeklyTargetHours: reg.weeklyTargetHours,
        });
      },
    }),
  ];
}
