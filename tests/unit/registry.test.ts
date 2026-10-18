import { describe, expect, it } from "vitest";
import { allToolsets, selectToolsets } from "../../src/core/registry.js";
import type { Toolset } from "../../src/core/toolset.js";

const fake = (name: string): Toolset => ({ name, description: name, tools: [] });

describe("selectToolsets", () => {
  const toolsets = [fake("gmail"), fake("calendar")];

  it("returns everything when no filter is given", () => {
    expect(selectToolsets(undefined, toolsets)).toHaveLength(2);
    expect(selectToolsets([], toolsets)).toHaveLength(2);
  });

  it("selects only the named toolsets, in order", () => {
    expect(selectToolsets(["calendar"], toolsets).map((t) => t.name)).toEqual(["calendar"]);
  });

  it("fails fast on unknown names, listing the known set", () => {
    expect(() => selectToolsets(["gmial"], toolsets)).toThrowError(/Unknown toolset "gmial".*gmail, calendar/);
  });
});

describe("allToolsets", () => {
  it("includes gmail and track toolsets, each with correctly prefixed tools", () => {
    const toolsets = allToolsets();
    expect(toolsets.map((t) => t.name)).toEqual(["gmail", "track", "drive"]);
    for (const ts of toolsets) {
      expect(ts.tools.length).toBeGreaterThanOrEqual(11);
      for (const tool of ts.tools) {
        expect(tool.name.startsWith(`${ts.name}_`)).toBe(true);
      }
    }
  });
});
