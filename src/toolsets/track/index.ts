import type { Toolset } from "../../core/toolset.js";
import { TrackStore } from "./store.js";
import { STATUS_LEGEND, checkInState } from "./status.js";
import { timerTools } from "./tools/timer.js";
import { entryTools } from "./tools/entries.js";
import { reportTools } from "./tools/report.js";
import { registryTools } from "./tools/registry.js";

export function createTrackToolset(): Toolset {
  return {
    name: "track",
    description: "Personal time tracking: products → projects → tasks, a one-at-a-time stopwatch, and reports.",
    instructions: async (ctx) => {
      const store = new TrackStore(ctx.config);
      const reg = store.loadRegistry();
      const timer = store.getTimer();
      const openTasks = reg.tasks.filter((t) => t.status === "open").length;
      const due = [...reg.products, ...reg.projects].filter((x) => checkInState(x.status, x.lastCheckIn).due).length;
      return (
        `Time tracker: ${reg.products.length} products, ${reg.projects.length} projects, ${openTasks} open tasks. ` +
        (timer ? `A stopwatch is RUNNING on ${timer.taskId} since ${timer.start}. ` : `No stopwatch running. `) +
        `One stopwatch at a time (track_start auto-stops the previous). Weekly target: ${reg.weeklyTargetHours}h of ` +
        `tracked, deliverable-tied work. Status colors are a CHECK-IN CADENCE: ${STATUS_LEGEND}` +
        (due > 0 ? ` — ${due} item(s) currently due (track_check_ins). ` : ". ") +
        `Use track_overview to see the tree, track_report (this_week) when compiling ` +
        `Person-log / Weekly-commitment updates for the team tracker.`
      );
    },
    tools: [...timerTools(), ...entryTools(), ...reportTools(), ...registryTools()],
  };
}
