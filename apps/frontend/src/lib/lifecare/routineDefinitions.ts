// SLMS v4.2 routine persistence logic (sub-project #3) — PURE helpers shared by the
// dedicated API routes. No Prisma/IO here so the governance rules (Rule 14/15/18/19)
// are unit-testable without a DB. The routes wrap these with transactions + audit.

import { occurrencesForDate, type DaySchedule } from "./highFrequency.ts";
import { ASSISTANCE, parseSupport, type Assistance } from "./assistance.ts";
import type { RoutineEventDefinition } from "./assembleRoutine.ts";

/** occId = `${definitionId}@${careDateISO}@${HHMM}` (HH:MM without the colon). */
export function makeOccId(definitionId: string, careDateISO: string, hhmm: string): string {
  return `${definitionId}@${careDateISO}@${hhmm.replace(":", "")}`;
}

const isoDay = (d: string | Date | null | undefined): string | null => {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

// ── Draft mapping (§2) ───────────────────────────────────────────────────────────

/** A create-payload row for RoutineEventDefinition (plain data; the route hands it to Prisma). */
export type RoutineDefinitionRow = Record<string, unknown>;

/**
 * Map an in-memory DraftEvent (#2 assembleRoutine output) to a v1 DRAFT definition
 * row. A #2 "BLOCKED" event persists as DRAFT + blockReason (there is no BLOCKED
 * DB status): the board shows it, but it is excluded from the approvable set until
 * the nurse resolves it (Rule 9/11).
 */
export function draftEventToDefinitionRow(
  e: RoutineEventDefinition,
  residentId: string,
  communityId?: string | null,
): RoutineDefinitionRow {
  return {
    residentId,
    communityId: communityId ?? null,
    version: 1,
    status: "DRAFT",
    sourceLocBundleId: e.sourceLocBundleId ?? null,
    sourceAsDomain: e.sourceAsDomain ?? null,
    asScore: e.asScore ?? null,
    goalId: e.goalId ?? null,
    sourceTaskId: e.sourceTaskId ?? null,
    conditionBundleId: e.conditionBundleId ?? null,
    memoryPathwayId: e.memoryPathwayId ?? null,
    orderRef: e.orderRef ?? null,
    name: e.name,
    instructions: e.instructions,
    assistanceLevel: e.assistanceLevel ?? null,
    supervision: e.supervision ?? null,
    staffing: e.staffing ?? null,
    equipment: e.equipment ?? null,
    technique: e.technique ?? null,
    conditionModifier: e.conditionModifier ?? null,
    responsibleRole: e.responsibleRole,
    frequencyMethod: e.frequencyMethod,
    schedule: e.schedule,
    shiftOwner: e.shiftOwner ?? null,
    criticality: e.criticality,
    resultSchemaKey: e.resultSchemaKey,
    exceptionSet: e.exceptionSet,
    escalationTrigger: e.escalationTrigger ?? null,
    escalationPriority: e.escalationPriority ?? null,
    completionControl: e.completionControl,
    effectiveDate: e.effectiveDate ? new Date(e.effectiveDate) : null,
    originalRecommendation: e.originalRecommendation ?? {},
    blockReason: e.blockReason ?? null,
  };
}

// ── Eligibility gate (Rule 14/19) ─────────────────────────────────────────────────

export interface DefLifecycle {
  status: string;
  effectiveDate?: string | Date | null;
  stopDate?: string | Date | null;
  reviewDate?: string | Date | null;
}

/**
 * A definition generates occurrences for a care day only when it is APPROVED,
 * effective on/before the day, and not past its stop date. Draft / Returned /
 * Expired / Cancelled generate NOTHING (Rule 14). Stop-date honored (Rule 19).
 */
export function isEligibleForCareDay(def: DefLifecycle, careDateISO: string): boolean {
  if (def.status !== "APPROVED") return false;
  const eff = isoDay(def.effectiveDate);
  if (eff && eff > careDateISO) return false;      // not yet effective
  const stop = isoDay(def.stopDate);
  if (stop && careDateISO > stop) return false;    // past stop date
  return true;
}

export function eligibleForCareDay<T extends DefLifecycle>(defs: T[], careDateISO: string): T[] {
  return defs.filter((d) => isEligibleForCareDay(d, careDateISO));
}

// ── Occurrence expansion (§5, Rule 15) ─────────────────────────────────────────────

export interface OccurrenceRow {
  occId: string;
  definitionId: string;
  definitionVersion: number;
  residentId: string;
  communityId: string | null;
  careDateISO: string;
  scheduledTime: string;
  workflowState: "Upcoming";
  escalationState: "Not required";
}

interface DefForExpansion {
  id: string;
  version: number;
  residentId: string;
  communityId?: string | null;
  frequencyMethod: string;
  schedule: DaySchedule;
}

/**
 * Expand one APPROVED definition into a care day's occurrence rows. Deterministic;
 * definitionVersion pinned (Rule 15/18). Trigger-based/PRN and completion-based
 * return no scheduled occurrences (created at runtime in #4/#5).
 */
export function expandDefinitionOccurrences(def: DefForExpansion, careDateISO: string): OccurrenceRow[] {
  const occs = occurrencesForDate(def.frequencyMethod as never, def.schedule, careDateISO);
  return occs.map((o) => ({
    occId: makeOccId(def.id, careDateISO, o.time),
    definitionId: def.id,
    definitionVersion: def.version,
    residentId: def.residentId,
    communityId: def.communityId ?? null,
    careDateISO,
    scheduledTime: o.time,
    workflowState: "Upcoming",
    escalationState: "Not required",
  }));
}

/** All occurrences for a resident's care day (dedup by occId — Rule 15 no duplicate ids). */
export function materializeCareDay(defs: DefForExpansion[], careDateISO: string): OccurrenceRow[] {
  const byId = new Map<string, OccurrenceRow>();
  for (const def of defs) for (const occ of expandDefinitionOccurrences(def, careDateISO)) byId.set(occ.occId, occ);
  return [...byId.values()].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
}

// ── Versioning (Rule 18) ───────────────────────────────────────────────────────────

/**
 * Build the next-version DRAFT row from an APPROVED definition + nurse edits, WITHOUT
 * mutating the prior row. The prior version (and its historical occurrences, pinned by
 * definitionVersion) are never touched here — that is what keeps past charting immutable.
 */
export function applyRevision(
  prev: RoutineDefinitionRow & { version: number; id?: string },
  edits: Partial<RoutineDefinitionRow>,
  revisionReason: string,
): RoutineDefinitionRow {
  const { id: _id, createdAt: _c, updatedAt: _u, approvedAt: _aa, approvedBy: _ab, ...carry } = prev as Record<string, unknown>;
  return {
    ...carry,
    ...edits,
    version: (prev.version ?? 1) + 1,
    status: "DRAFT",
    supersedesVersion: prev.version ?? 1,
    revisionReason,
    approvedBy: null,
    approvedAt: null,
    originalRecommendation: { ...(prev.originalRecommendation as object ?? {}), supersededFrom: prev.version },
  };
}

// ── Assistance guard (Rule 9 / assistance-never-staffing) ──────────────────────────

/**
 * A nurse's assistance-level edit must be a canonical ASSISTANCE value. Two-person /
 * mechanical are staffing/equipment — reject them as a level and route them to the
 * right fields via parseSupport. Throws on an invalid level.
 */
export function assertAssistanceLevel(value: string): Assistance {
  if ((ASSISTANCE as readonly string[]).includes(value)) return value as Assistance;
  const support = parseSupport(value, 0);
  if (support.staffing || support.equipment) {
    throw new Error(`"${value}" is staffing/equipment, not an assistance level — set staffing/equipment instead`);
  }
  throw new Error(`"${value}" is not a canonical assistance level (${ASSISTANCE.join(", ")})`);
}
