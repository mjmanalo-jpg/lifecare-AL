// 24-Hour Routine generator — translate an approved care plan into a resident's
// day-long routine of shift care events.
//
// The routine template (data/routine_windows.json) is the workbook's "24-Hour
// Routine" sheet: 16 time-windows across Night / Morning / Afternoon, each a care
// event linked to AS domains. This maps the plan's per-domain interventions onto
// those windows — every window whose domains are in the plan becomes one routine
// event bundling those domains' goals + interventions (the caregiver's work for
// that window). Handover / "all active domains" windows are shift-change admin,
// not resident care, so they are excluded from task generation.
//
// PURE: no React / api / prisma deps, so the CarePlan builder (preview) and the
// server-side task materializer (dispatch) share one implementation + one test.

import routineWindows from "./data/routine_windows.json" with { type: "json" };

export type RoutineShift = "AM" | "PM" | "NOC";

export interface RoutineWindow {
  id: string;
  window: string;        // "06:00-08:00"
  startHour: number;     // 0-23, the due hour for the window's tasks
  shift: RoutineShift;
  shiftLabel: string;    // "Morning" | "Afternoon" | "Night"
  label: string;         // care-event name, e.g. "Wake-up, orientation, hygiene and dressing"
  domains: string[];     // AS-codes linked to this window
  handover: boolean;     // shift-change / "all active domains" admin windows
  goal: string;
  caregiver: string;     // template caregiver responsibility
  nurse: string;         // template nurse responsibility
  /** Meals / activities happen for EVERY resident — these windows always generate,
   * with `baselineTasks` as their default care tasks, even if the clinical domain
   * (AS-08 nutrition / AS-14 activity) isn't scored in the plan. */
  baseline?: boolean;
  baselineTasks?: string[];
}

export const ROUTINE_WINDOWS = routineWindows as RoutineWindow[];

/** One scored domain's care, as it feeds the routine. */
export interface RoutineDomainInput {
  code: string;            // AS-01..AS-14
  name: string;
  goal?: string;
  interventions: string[];
  taskId?: string;         // representative governed Care Task (for completion archetype)
}

/**
 * Reconstruct a plan's per-domain care from its INTERVENTION care-plan-items.
 * Assessment-based plans title items "AS-01 · <name>" and bundle the interventions
 * after "Individualized:" with a trailing [task:TASK-###] marker. Returns [] when
 * no item is AS-coded (legacy level-package plans). Shared by the task materializer
 * (cron) and the Today's Care board so both build the same routine.
 */
export function domainInputsFromItems(items: { title?: string | null; description?: string | null }[]): RoutineDomainInput[] {
  const out: RoutineDomainInput[] = [];
  for (const item of items) {
    const title = String(item.title ?? "");
    const code = /AS-\d+/.exec(title)?.[0];
    if (!code) continue;
    const name = title.includes("·") ? title.split("·").slice(1).join("·").trim() : title.trim();
    const desc = String(item.description ?? "");
    const ivRaw = /Individualized:\s*([\s\S]*?)(?:\s*\[task:|$)/.exec(desc)?.[1] || "";
    const interventions = ivRaw.split("•").map((x) => x.trim()).filter(Boolean);
    const taskId = /\[task:([A-Za-z0-9-]+)\]/.exec(desc)?.[1];
    out.push({ code, name, interventions, taskId });
  }
  return out;
}

/** One individually-addressable care task inside a routine event (a checklist row). */
export interface RoutineTaskItem {
  id: string;    // stable within a resident's day, e.g. "W04#2"
  text: string;
}

export type RoutineRole = "Caregiver" | "Nurse";

/** A generated routine event — one window's worth of the resident's care. */
export interface RoutineEvent {
  id: string;
  window: string;
  startHour: number;
  shift: RoutineShift;
  shiftLabel: string;
  label: string;
  role: RoutineRole;       // Nurse for pure clinical/med windows, else Caregiver
  domainCodes: string[];   // plan domains active in this window
  domainNames: string[];
  goals: string[];
  interventions: string[]; // bundled tasks (baseline + active domains), in window order
  items: RoutineTaskItem[]; // same tasks, each with a stable id (checklist rows)
  caregiver: string;
  nurse: string;
  careTaskId?: string;     // first active domain's governed task id
}

/** A window is Nurse-owned only when it is purely clinical monitoring / medication
 * (AS-06 / AS-07); everything else — personal care, meals, mobility, activity — is
 * the caregiver's. Baseline meal/activity windows are always Caregiver. */
function roleForWindow(w: RoutineWindow): RoutineRole {
  return !w.baseline && w.domains.length > 0 && w.domains.every((d) => d === "AS-06" || d === "AS-07")
    ? "Nurse" : "Caregiver";
}

/**
 * Build the 24-hour routine for a plan's active domains. One event per care
 * window that has at least one of the plan's domains; ordered by window start.
 */
export function generateRoutine(domains: RoutineDomainInput[]): RoutineEvent[] {
  const byCode = new Map(domains.filter((d) => d.code).map((d) => [d.code, d]));
  const events: RoutineEvent[] = [];
  for (const w of ROUTINE_WINDOWS) {
    if (w.handover) continue; // shift-change admin, not resident care
    const active = w.domains.map((c) => byCode.get(c)).filter((d): d is RoutineDomainInput => !!d);
    // Baseline windows (meals / activities) always generate; others only when at
    // least one of their domains is in the plan.
    if (!active.length && !w.baseline) continue;
    // Baseline tasks first, then the plan domains' specific tasks; de-duplicated.
    const raw = [...(w.baseline ? w.baselineTasks ?? [] : []), ...active.flatMap((d) => d.interventions)]
      .map((x) => x.trim()).filter(Boolean);
    const seen = new Set<string>();
    const interventions = raw.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    if (!interventions.length) continue;
    events.push({
      id: w.id,
      window: w.window,
      startHour: w.startHour,
      shift: w.shift,
      shiftLabel: w.shiftLabel,
      label: w.label,
      role: roleForWindow(w),
      domainCodes: active.map((d) => d.code),
      domainNames: active.map((d) => d.name),
      goals: active.map((d) => d.goal?.trim()).filter((g): g is string => !!g),
      interventions,
      items: interventions.map((text, i) => ({ id: `${w.id}#${i}`, text })),
      caregiver: w.caregiver,
      nurse: w.nurse,
      careTaskId: active.find((d) => d.taskId)?.taskId,
    });
  }
  return events;
}
