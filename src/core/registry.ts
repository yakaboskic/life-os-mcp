import { createGmailToolset } from "../toolsets/gmail/index.js";
import { createTrackToolset } from "../toolsets/track/index.js";
import { createDriveToolset } from "../toolsets/drive/index.js";
import type { Toolset } from "./toolset.js";

/**
 * Adding a new toolset to Life OS = write the module under src/toolsets/<name>/
 * and add one entry here. Nothing else in core changes.
 */
export function allToolsets(): Toolset[] {
  return [createGmailToolset(), createTrackToolset(), createDriveToolset()];
}

/**
 * Applies the toolset filter (--toolsets flag or LIFE_OS_TOOLSETS env).
 * Fails fast on unknown names — a typo silently dropping a whole domain's
 * tools would otherwise be a confusing agent-side mystery.
 */
export function selectToolsets(filter: string[] | undefined, toolsets: Toolset[] = allToolsets()): Toolset[] {
  if (!filter || filter.length === 0) return toolsets;
  const known = new Map(toolsets.map((t) => [t.name, t]));
  const selected: Toolset[] = [];
  for (const name of filter) {
    const ts = known.get(name);
    if (!ts) {
      throw new Error(`Unknown toolset "${name}". Known toolsets: ${[...known.keys()].join(", ")}`);
    }
    selected.push(ts);
  }
  return selected;
}
