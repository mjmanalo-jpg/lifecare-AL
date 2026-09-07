// SLMS v4.2 occurrence lifecycle (sub-project #5) — PURE governance layer over an
// occurrence's five SEPARATE controlled-vocab state fields, escalation state, no-
// silent-rollover invariants, handover gate, correction append, quick-chart match,
// and release validation. No IO/Prisma; the routes wrap these with persistence.

import {
  WORKFLOW_STATE, CARE_OUTCOME, EXCEPTION_REASON, CLINICAL_FINDING, ESCALATION_STATE, PRIORITY,
  type WorkflowState, type CareOutcome, type ExceptionReason, type ClinicalFinding, type EscalationState,
} from "./vocab.ts";

const inEnum = (v: unknown, e: readonly string[]): boolean => typeof v === "string" && e.includes(v);

// ── 1. Separated state model + single validated write path ──────────────────────

export interface OccurrenceState {
  workflowState: WorkflowState;
  careDeliveryOutcome?: CareOutcome | null;
  exceptionReason?: ExceptionReason | null;
  clinicalFinding?: ClinicalFinding[] | null;
  escalationState: EscalationState;
}

export interface StateChange { field: string; from: unknown; to: unknown; }

const FORWARD: WorkflowState[] = ["Upcoming", "Due", "Overdue", "Closed"];
const TERMINAL = new Set<WorkflowState>(["Closed", "Cancelled"]);

/**
 * The ONLY write path for the five state fields. Validates each value against its
 * OWN enum (a clinical finding can never land in outcome/exception, and vice-versa),
 * enforces the cross-field rules, and constrains workflow transitions. Throws on any
 * violation; returns the merged state + the field changes (for the caller's audit).
 */
export function applyOccurrenceState(
  prev: OccurrenceState,
  patch: Partial<OccurrenceState>,
): { state: OccurrenceState; changes: StateChange[] } {
  const next: OccurrenceState = { ...prev, ...patch };

  // (1) per-field enum membership
  if (!inEnum(next.workflowState, WORKFLOW_STATE)) throw new Error(`invalid workflowState: ${next.workflowState}`);
  if (next.careDeliveryOutcome != null && !inEnum(next.careDeliveryOutcome, CARE_OUTCOME))
    throw new Error(`invalid careDeliveryOutcome: ${next.careDeliveryOutcome}`);
  if (next.exceptionReason != null && !inEnum(next.exceptionReason, EXCEPTION_REASON))
    throw new Error(`invalid exceptionReason: ${next.exceptionReason}`);
  if (next.clinicalFinding != null &&
    (!Array.isArray(next.clinicalFinding) || !next.clinicalFinding.every((f) => inEnum(f, CLINICAL_FINDING))))
    throw new Error(`invalid clinicalFinding`);
  if (!inEnum(next.escalationState, ESCALATION_STATE)) throw new Error(`invalid escalationState: ${next.escalationState}`);

  // (2) cross-field rules — exception is not completion; a finding is never an outcome
  if (next.careDeliveryOutcome === "Not completed" && !next.exceptionReason)
    throw new Error(`"Not completed" requires an exceptionReason`);
  if (next.exceptionReason &&
    (next.careDeliveryOutcome === "Completed as planned" || next.careDeliveryOutcome === "Completed with variance"))
    throw new Error(`an exceptionReason cannot accompany a completed outcome`);

  // (3) workflow transition constraints
  if (prev.workflowState !== next.workflowState) {
    if (TERMINAL.has(prev.workflowState)) throw new Error(`illegal transition from terminal ${prev.workflowState}`);
    const forward = FORWARD.includes(next.workflowState) &&
      FORWARD.indexOf(next.workflowState) >= FORWARD.indexOf(prev.workflowState);
    if (!(forward || next.workflowState === "Cancelled"))
      throw new Error(`illegal workflow transition ${prev.workflowState}→${next.workflowState}`);
  }
  if (next.workflowState === "Closed" && !next.careDeliveryOutcome)
    throw new Error(`Closed requires a careDeliveryOutcome`);

  const changes: StateChange[] = [];
  for (const f of ["workflowState", "careDeliveryOutcome", "exceptionReason", "clinicalFinding", "escalationState"] as const) {
    if (JSON.stringify(prev[f] ?? null) !== JSON.stringify(next[f] ?? null)) changes.push({ field: f, from: prev[f] ?? null, to: next[f] ?? null });
  }
  return { state: next, changes };
}

// ── 3. Escalation lifecycle (rides the existing Escalation model) ────────────────

/** Map an Escalation.status onto the canonical escalationState. */
export function escalationStateFromStatus(status: string): EscalationState {
  const s = (status || "").toUpperCase();
  if (s === "RESOLVED" || s === "CLOSED") return "Resolved";
  if (s === "ACK" || s === "ACKNOWLEDGED" || s === "IN_PROGRESS") return "Acknowledged";
  if (s === "OPEN" || s === "PENDING") return "Pending acknowledgement";
  return "Not required";
}
export function escalationTargetStatus(state: EscalationState): string {
  switch (state) {
    case "Acknowledged": return "ACK";
    case "Resolved": return "RESOLVED";
    case "Pending acknowledgement": return "OPEN";
    default: return "OPEN";
  }
}
/** P1 cannot passively close — an explicit nurse acknowledgement is required. */
export function canCloseEscalation(priority: string, acknowledged: boolean): boolean {
  return priority === "P1" ? acknowledged : true;
}

// ── 4/6. No silent rollover + revision immutability ─────────────────────────────

/** A Closed/Cancelled occurrence is frozen — only corrections may append (unit 8). */
export function isEditableOccurrence(occ: { workflowState?: string | null }): boolean {
  return occ.workflowState !== "Closed" && occ.workflowState !== "Cancelled";
}

// ── 8. Correction (append-only) ─────────────────────────────────────────────────

export interface Correction {
  field: string; originalValue: unknown; amendedValue: unknown; reason: string; userId: string; at: string;
}
/** Append an amendment; the original entries + result are preserved untouched. */
export function appendCorrection(existing: Correction[] | null | undefined, entry: Correction): Correction[] {
  return [...(existing ?? []), entry];
}

// ── 5. Handover gate ─────────────────────────────────────────────────────────────

export interface PendingItem {
  occId: string;
  criticality?: string | null;
  escalationPriority?: string | null;
  disposition?: "resolve" | "escalate" | "transfer" | null;
}
/** A shift cannot close with an unaddressed Critical / P1 / P2 item. */
export function canCloseShift(items: PendingItem[]): { ok: boolean; blockers: string[] } {
  const blockers: string[] = [];
  for (const it of items) {
    const critical = it.criticality === "Critical" || it.escalationPriority === "P1" || it.escalationPriority === "P2";
    if (critical && !it.disposition) blockers.push(it.occId);
  }
  return { ok: blockers.length === 0, blockers };
}

// ── 9. Document once — quick-chart match ────────────────────────────────────────

export interface QuickOcc {
  occId: string; residentId: string; category: string; scheduledTime: string; workflowState?: string | null;
}
const toMin = (t: string): number => { const m = /(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : 0; };
/**
 * Match a quick-chart entry to the nearest OPEN scheduled occurrence for the same
 * resident+category within a window; null → the caller creates a trigger-based one.
 * A Closed/Cancelled occurrence is never matched (no duplicate completion).
 */
export function matchOccurrenceForQuickChart(
  occs: QuickOcc[], residentId: string, category: string, atMin: number, windowMin = 120,
): string | null {
  let best: { occId: string; dist: number } | null = null;
  for (const o of occs) {
    if (o.residentId !== residentId) continue;
    if (o.category.toLowerCase() !== category.toLowerCase()) continue;
    if (o.workflowState === "Closed" || o.workflowState === "Cancelled") continue;
    const dist = Math.abs(toMin(o.scheduledTime) - atMin);
    if (dist <= windowMin && (!best || dist < best.dist)) best = { occId: o.occId, dist };
  }
  return best?.occId ?? null;
}

// ── 10. Release validation (Rule 21) ────────────────────────────────────────────

export interface ReleaseDef {
  resultSchemaKey?: string;
  completionControl?: string;
  sourceLocBundleId?: string;
  memoryPathwayId?: string;
  orderRequired?: boolean;
  orderRef?: string;
  escalationTrigger?: string;
  escalationPriority?: string;
  exceptionSet?: string[];
  blockReason?: string | null;
}
export interface ReleaseCheck { name: string; ok: boolean; critical: boolean; detail?: string }
export interface ReleaseResult { ok: boolean; criticalFailures: string[]; warnings: string[]; results: ReleaseCheck[] }

/** Pre-publish suite (Rule 21). Any CRITICAL failure blocks publication. */
export function validateRoutineRelease(cfg: {
  occIds: string[]; definitions: ReleaseDef[]; escalationKeys?: string[];
}): ReleaseResult {
  const results: ReleaseCheck[] = [];
  const push = (name: string, ok: boolean, critical: boolean, detail?: string) => results.push({ name, ok, critical, detail });

  push("ID uniqueness", cfg.occIds.length === new Set(cfg.occIds).size, true, "duplicate occId");
  push("Required-field", cfg.definitions.every((d) => !!d.resultSchemaKey && !!d.completionControl), true, "missing result schema / completion control");
  push("Vocabulary validity",
    cfg.definitions.every((d) =>
      (d.exceptionSet ?? []).every((x) => (EXCEPTION_REASON as readonly string[]).includes(x)) &&
      (!d.escalationPriority || (PRIORITY as readonly string[]).includes(d.escalationPriority))),
    true, "off-vocabulary exceptionSet / priority");
  push("Order/scope", cfg.definitions.every((d) => !d.orderRequired || !!d.orderRef), true, "orderRequired without an order");
  push("Conflict", cfg.definitions.every((d) => !d.blockReason), true, "unresolved block/conflict");
  push("Memory-Care invariant", cfg.definitions.every((d) => !(d.memoryPathwayId && d.memoryPathwayId === d.sourceLocBundleId)), true, "memory equated with an LOC field");
  if (cfg.escalationKeys) {
    const keys = new Set(cfg.escalationKeys);
    push("Escalation-trigger resolves", cfg.definitions.every((d) => !d.escalationTrigger || keys.has(d.escalationTrigger)), false, "unresolved escalation trigger key");
  }

  const criticalFailures = results.filter((r) => r.critical && !r.ok).map((r) => r.name);
  const warnings = results.filter((r) => !r.critical && !r.ok).map((r) => r.name);
  return { ok: criticalFailures.length === 0, criticalFailures, warnings, results };
}
