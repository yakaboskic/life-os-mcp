import { ToolInputError } from "../../core/errors.js";

/**
 * Status colors are a check-in cadence, not a health score — Jason's
 * convention for the team tracker (Slack, 7/28/2026), applied to products,
 * projects, and promises. "Rough guide, not something specific."
 */
export const STATUS_COLORS = ["red", "yellow", "green", "white", "black", "blue"] as const;
export type StatusColor = (typeof STATUS_COLORS)[number];

export interface StatusSemantics {
  /** Days between check-ins; null when no recurring check-in applies. */
  cadenceDays: number | null;
  cadence: string;
  meaning: string;
}

export const STATUS_SEMANTICS: Record<StatusColor, StatusSemantics> = {
  red: { cadenceDays: 7, cadence: "weekly", meaning: "Check in every week" },
  yellow: { cadenceDays: 14, cadence: "every 2 weeks", meaning: "Check in every 2 weeks" },
  green: { cadenceDays: 30, cadence: "monthly", meaning: "Check in monthly" },
  white: { cadenceDays: 90, cadence: "quarterly", meaning: "Dormant — review quarterly" },
  black: { cadenceDays: null, cadence: "none", meaning: "Done" },
  blue: { cadenceDays: null, cadence: "none (new)", meaning: "New — not yet on a check-in cadence" },
};

/** One-line legend for tool descriptions and agent instructions. */
export const STATUS_LEGEND = STATUS_COLORS.map((c) => `${c} = ${STATUS_SEMANTICS[c].meaning.toLowerCase()}`).join("; ");

export function normalizeStatus(input: string): StatusColor {
  const s = input.trim().toLowerCase();
  if ((STATUS_COLORS as readonly string[]).includes(s)) return s as StatusColor;
  throw new ToolInputError(`Unknown status "${input}". Valid: ${STATUS_COLORS.join(", ")}. Meaning — ${STATUS_LEGEND}.`);
}

export interface CheckInState {
  status?: string;
  cadence: string;
  cadenceDays: number | null;
  lastCheckIn?: string;
  nextCheckInDue?: string;
  daysOverdue?: number;
  due: boolean;
}

/**
 * Given a status color and the last check-in date, when is the next one due?
 * Never checked in + a cadence ⇒ due now. black/blue ⇒ never due.
 */
export function checkInState(status: string | undefined, lastCheckIn: string | undefined, now = new Date()): CheckInState {
  if (!status) return { cadence: "unset", cadenceDays: null, lastCheckIn, due: false };
  let color: StatusColor;
  try {
    color = normalizeStatus(status);
  } catch {
    return { status, cadence: "unrecognized", cadenceDays: null, lastCheckIn, due: false };
  }
  const sem = STATUS_SEMANTICS[color];
  if (sem.cadenceDays === null) {
    return { status: color, cadence: sem.cadence, cadenceDays: null, lastCheckIn, due: false };
  }
  if (!lastCheckIn) {
    return {
      status: color,
      cadence: sem.cadence,
      cadenceDays: sem.cadenceDays,
      lastCheckIn: undefined,
      due: true,
    };
  }
  const last = new Date(`${lastCheckIn}T00:00:00`);
  const next = new Date(last.getTime() + sem.cadenceDays * 86400_000);
  const dayMs = 86400_000;
  const overdueDays = Math.floor((now.getTime() - next.getTime()) / dayMs);
  return {
    status: color,
    cadence: sem.cadence,
    cadenceDays: sem.cadenceDays,
    lastCheckIn,
    nextCheckInDue: next.toISOString().slice(0, 10),
    daysOverdue: overdueDays > 0 ? overdueDays : undefined,
    due: overdueDays >= 0,
  };
}
