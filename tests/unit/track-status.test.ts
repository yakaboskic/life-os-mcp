import { describe, expect, it } from "vitest";
import { STATUS_LEGEND, checkInState, normalizeStatus } from "../../src/toolsets/track/status.js";
import { ToolInputError } from "../../src/core/errors.js";

const NOW = new Date("2026-07-28T12:00:00");

describe("status colors as check-in cadence", () => {
  it("normalizes known colors and rejects unknown ones with the legend", () => {
    expect(normalizeStatus("RED")).toBe("red");
    expect(normalizeStatus(" white ")).toBe("white");
    expect(() => normalizeStatus("purple")).toThrowError(ToolInputError);
    expect(() => normalizeStatus("purple")).toThrowError(/red = check in every week/);
    expect(STATUS_LEGEND).toContain("black = done");
  });

  it("maps each color to its cadence", () => {
    expect(checkInState("red", "2026-07-27", NOW).cadenceDays).toBe(7);
    expect(checkInState("yellow", "2026-07-27", NOW).cadenceDays).toBe(14);
    expect(checkInState("green", "2026-07-27", NOW).cadenceDays).toBe(30);
    expect(checkInState("white", "2026-07-27", NOW).cadenceDays).toBe(90);
  });

  it("computes next due date and overdue days", () => {
    const red = checkInState("red", "2026-07-14", NOW); // 14 days ago, weekly cadence
    expect(red.nextCheckInDue).toBe("2026-07-21");
    expect(red.daysOverdue).toBe(7);
    expect(red.due).toBe(true);

    const fresh = checkInState("red", "2026-07-27", NOW);
    expect(fresh.due).toBe(false);
    expect(fresh.daysOverdue).toBeUndefined();
  });

  it("treats never-checked-in items with a cadence as due", () => {
    const s = checkInState("yellow", undefined, NOW);
    expect(s.due).toBe(true);
    expect(s.lastCheckIn).toBeUndefined();
  });

  it("never makes done (black) or new (blue) due", () => {
    expect(checkInState("black", undefined, NOW).due).toBe(false);
    expect(checkInState("blue", undefined, NOW).due).toBe(false);
    expect(checkInState("black", "2020-01-01", NOW).due).toBe(false);
  });

  it("degrades gracefully for unset or unrecognized status", () => {
    expect(checkInState(undefined, undefined, NOW)).toMatchObject({ cadence: "unset", due: false });
    expect(checkInState("chartreuse", undefined, NOW)).toMatchObject({ cadence: "unrecognized", due: false });
  });
});
