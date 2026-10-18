export type Role = "owner" | "lead" | "contributor";
export type TaskStatus = "open" | "done";

export interface Product {
  id: string; // slug
  name: string;
  /** Check-in cadence color — see status.ts (red=weekly … black=done). */
  status?: string;
  /** YYYY-MM-DD of the last check-in; drives next-check-in-due math. */
  lastCheckIn?: string;
  goal?: string;
  deadline?: string; // YYYY-MM-DD
  notes?: string;
  created_at: string;
}

export interface Project {
  id: string; // slug
  name: string;
  productId?: string;
  role?: Role;
  lead?: string; // who leads it, when it's not the user
  /** Check-in cadence color — see status.ts. */
  status?: string;
  /** YYYY-MM-DD of the last check-in. */
  lastCheckIn?: string;
  goal?: string;
  deadline?: string;
  nextMilestone?: string;
  nextMilestoneDeadline?: string;
  notes?: string;
  created_at: string;
}

export interface Task {
  id: string; // t1, t2, …
  title: string;
  projectId?: string;
  status: TaskStatus;
  notes?: string;
  created_at: string;
  done_at?: string;
}

export interface TimeEntry {
  id: string; // e-<epochms><rand>
  taskId: string;
  start: string; // ISO UTC instant
  end: string; // ISO UTC instant
  seconds: number;
  note?: string;
}

export interface TimerState {
  /** Unique identity even if a timer is replaced within the same millisecond. */
  id?: string;
  taskId: string;
  start: string; // ISO UTC instant
  note?: string;
}

export interface TrackRegistry {
  products: Product[];
  projects: Project[];
  tasks: Task[];
  nextTaskNum: number;
  weeklyTargetHours: number;
}

export const EMPTY_REGISTRY: TrackRegistry = {
  products: [],
  projects: [],
  tasks: [],
  nextTaskNum: 1,
  weeklyTargetHours: 25,
};
