import { z } from "zod";
import { defineTool, type ToolDefinition, type ToolsetContext } from "../../../core/toolset.js";
import { ok } from "../../../core/result.js";
import { TrackStore } from "../store.js";
import { STATUS_COLORS, STATUS_LEGEND, checkInState } from "../status.js";

const store = (ctx: ToolsetContext) => new TrackStore(ctx.config);

const DATE_HINT = "YYYY-MM-DD";

const statusArg = () =>
  z
    .enum(STATUS_COLORS)
    .optional()
    .describe(`Check-in cadence color — ${STATUS_LEGEND}.`);
const lastCheckInArg = () =>
  z.string().optional().describe(`Date of the most recent check-in (${DATE_HINT}) — drives next-check-in-due.`);

export function registryTools(): ToolDefinition<any>[] {
  return [
    defineTool({
      name: "track_check_ins",
      title: "Which products/projects are due for a check-in",
      description:
        `Status colors ARE a check-in cadence: ${STATUS_LEGEND}. This lists every product and project with its ` +
        "cadence, last check-in, next due date, and how overdue it is — sorted most-overdue first. " +
        "Anything with a cadence and no recorded check-in counts as due. Record one with track_update_product / " +
        "track_update_project (`lastCheckIn`).",
      inputSchema: {
        dueOnly: z.boolean().optional().describe("Only items due or overdue (default true)."),
      },
      annotations: { readOnlyHint: true },
      handler: async (args, ctx) => {
        const reg = store(ctx).loadRegistry();
        const dueOnly = args.dueOnly ?? true;
        const rows = [
          ...reg.products.map((p) => ({ kind: "product" as const, id: p.id, name: p.name, s: p.status, l: p.lastCheckIn })),
          ...reg.projects.map((p) => ({ kind: "project" as const, id: p.id, name: p.name, s: p.status, l: p.lastCheckIn })),
        ]
          .map((r) => ({ kind: r.kind, id: r.id, name: r.name, ...checkInState(r.s, r.l) }))
          .filter((r) => (dueOnly ? r.due : true))
          .sort((a, b) => (b.daysOverdue ?? 0) - (a.daysOverdue ?? 0));
        const unset = reg.products.filter((p) => !p.status).length + reg.projects.filter((p) => !p.status).length;
        return ok({
          legend: STATUS_LEGEND,
          dueCount: rows.filter((r) => r.due).length,
          items: rows,
          withoutStatus: unset > 0 ? `${unset} item(s) have no status color set — set one to put them on a cadence.` : undefined,
        });
      },
    }),
    defineTool({
      name: "track_add_task",
      title: "Add a task",
      description:
        "Creates a trackable task, optionally attached to a project. Tasks are what the stopwatch runs against — " +
        "keep them deliverable-sized (\"MCP gateway roadmap doc\"), not vague (\"work\").",
      inputSchema: {
        title: z.string().min(1).describe("Task title."),
        project: z.string().optional().describe("Project id or name to attach it to (see track_overview)."),
        notes: z.string().optional().describe("Context, links, acceptance criteria."),
      },
      handler: async (args, ctx) => ok({ created: store(ctx).addTask(args) }),
    }),
    defineTool({
      name: "track_update_task",
      title: "Update a task (rename, move, complete)",
      description:
        'Updates a task: rename, move to another project, set notes, or change status ("done" marks completion, ' +
        '"open" reopens).',
      inputSchema: {
        task: z.string().describe("Task id (t1, t2, …) or unique name fragment."),
        title: z.string().optional(),
        project: z.string().nullable().optional().describe("Move to this project (id or name), or null to detach it."),
        status: z.enum(["open", "done"]).optional(),
        notes: z.string().optional(),
      },
      handler: async (args, ctx) => {
        const { task, ...patch } = args;
        return ok({ updated: store(ctx).updateTask(task, patch) });
      },
    }),
    defineTool({
      name: "track_add_project",
      title: "Add a project",
      description:
        "Creates a project (optionally under a product) with the team-tracker fields: role (owner/lead/contributor), " +
        "overall SMART goal + deadline, and the next milestone + its deadline.",
      inputSchema: {
        name: z.string().min(1).describe("Project name."),
        product: z.string().optional().describe("Product id or name this project belongs to."),
        role: z.enum(["owner", "lead", "contributor"]).optional().describe("Your role on this project."),
        lead: z.string().optional().describe("Who leads it (when it's not you)."),
        status: statusArg(),
        lastCheckIn: lastCheckInArg(),
        goal: z.string().optional().describe("Overall SMART goal."),
        deadline: z.string().optional().describe(`Overall deadline (${DATE_HINT}).`),
        nextMilestone: z.string().optional().describe("Next milestone / SMART goal."),
        nextMilestoneDeadline: z.string().optional().describe(`Next milestone deadline (${DATE_HINT}).`),
        notes: z.string().optional(),
      },
      handler: async (args, ctx) => ok({ created: store(ctx).addProject(args) }),
    }),
    defineTool({
      name: "track_update_project",
      title: "Update a project",
      description: "Updates any project field: goal, deadlines, next milestone, role, lead, product link, notes.",
      inputSchema: {
        project: z.string().describe("Project id or name."),
        name: z.string().optional().describe("Rename the project."),
        product: z.string().optional().describe("Attach to this product."),
        role: z.enum(["owner", "lead", "contributor"]).optional(),
        lead: z.string().optional(),
        status: statusArg(),
        lastCheckIn: lastCheckInArg(),
        goal: z.string().optional(),
        deadline: z.string().optional().describe(DATE_HINT),
        nextMilestone: z.string().optional(),
        nextMilestoneDeadline: z.string().optional().describe(DATE_HINT),
        notes: z.string().optional(),
      },
      handler: async (args, ctx) => {
        const { project, ...patch } = args;
        return ok({ updated: store(ctx).updateProject(project, patch) });
      },
    }),
    defineTool({
      name: "track_add_product",
      title: "Add a product",
      description:
        "Creates a product (the top of the hierarchy: products contain projects, projects contain tasks) with " +
        "team-tracker fields: status color, SMART goal, deadline.",
      inputSchema: {
        name: z.string().min(1).describe("Product name."),
        status: statusArg(),
        lastCheckIn: lastCheckInArg(),
        goal: z.string().optional().describe("Overall SMART goal."),
        deadline: z.string().optional().describe(DATE_HINT),
        notes: z.string().optional(),
      },
      handler: async (args, ctx) => ok({ created: store(ctx).addProduct(args) }),
    }),
    defineTool({
      name: "track_update_product",
      title: "Update a product",
      description: "Updates any product field: status color, SMART goal, deadline, notes, name.",
      inputSchema: {
        product: z.string().describe("Product id or name."),
        name: z.string().optional().describe("Rename the product."),
        status: statusArg(),
        lastCheckIn: lastCheckInArg(),
        goal: z.string().optional(),
        deadline: z.string().optional().describe(DATE_HINT),
        notes: z.string().optional(),
      },
      handler: async (args, ctx) => {
        const { product, ...patch } = args;
        return ok({ updated: store(ctx).updateProduct(product, patch) });
      },
    }),
  ];
}
