import { ToolInputError } from "../../core/errors.js";

/**
 * Parses agent/user-supplied times in the machine's LOCAL timezone unless an
 * explicit offset/Z is given. Accepted: full ISO 8601 ("2026-07-22T14:00:00Z",
 * "2026-07-22T14:00" = local), "YYYY-MM-DD HH:mm" (local), "YYYY-MM-DD"
 * (local midnight).
 */
export function parseWhen(input: string, field = "time"): Date {
  const s = input.trim();
  let candidate = s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    candidate = `${s}T00:00:00`; // bare dates parse as UTC per spec; force local midnight
  } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
    candidate = s.replace(" ", "T");
  }
  const d = new Date(candidate);
  if (Number.isNaN(d.getTime())) {
    throw new ToolInputError(
      `Could not parse ${field} "${input}". Use ISO 8601 ("2026-07-22T14:00", "…T14:00:00Z") or "YYYY-MM-DD HH:mm" (local) or "YYYY-MM-DD".`,
    );
  }
  return d;
}

/** Local calendar date key, e.g. "2026-07-22". */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday 00:00 local of the week containing d. */
export function startOfLocalWeek(d: Date): Date {
  const day = startOfLocalDay(d);
  const dow = (day.getDay() + 6) % 7; // Mon=0 … Sun=6
  day.setDate(day.getDate() - dow);
  return day;
}

export interface ResolvedRange {
  from: Date;
  to: Date; // exclusive
  label: string;
  isFullWeek: boolean;
}

export type RangePreset = "today" | "yesterday" | "this_week" | "last_week";

export function resolveRange(opts: { range?: string; from?: string; to?: string }, now = new Date()): ResolvedRange {
  const { range, from, to } = opts;
  if (from || to) {
    if (!from || !to) throw new ToolInputError("Custom ranges need both `from` and `to`.");
    const f = parseWhen(from, "from");
    let t = parseWhen(to, "to");
    if (/^\d{4}-\d{2}-\d{2}$/.test(to.trim())) t = addDays(t, 1); // whole end day inclusive
    if (t <= f) throw new ToolInputError("`to` must be after `from`.");
    return { from: f, to: t, label: `${from} → ${to}`, isFullWeek: false };
  }

  switch (range ?? "today") {
    case "today": {
      const f = startOfLocalDay(now);
      return { from: f, to: addDays(f, 1), label: "today", isFullWeek: false };
    }
    case "yesterday": {
      const f = addDays(startOfLocalDay(now), -1);
      return { from: f, to: addDays(f, 1), label: "yesterday", isFullWeek: false };
    }
    case "this_week": {
      const f = startOfLocalWeek(now);
      return { from: f, to: addDays(f, 7), label: "this week (Mon–Sun)", isFullWeek: true };
    }
    case "last_week": {
      const f = addDays(startOfLocalWeek(now), -7);
      return { from: f, to: addDays(f, 7), label: "last week (Mon–Sun)", isFullWeek: true };
    }
    default:
      throw new ToolInputError(`Unknown range "${range}". Use today, yesterday, this_week, last_week, or from/to.`);
  }
}

export function hours(seconds: number): number {
  return Math.round((seconds / 3600) * 100) / 100;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date); result.setDate(result.getDate() + days); return result;
}
