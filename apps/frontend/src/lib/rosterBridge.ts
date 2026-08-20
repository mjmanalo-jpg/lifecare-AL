/**
 * Phase 2 — bridge the Staff Roster → the operational Caregiver Schedule.
 *
 * Turns each WORKING caregiver cell in the roster into a caregiver_schedules
 * entry (caregiver → the residents they cover, per AM/PM/NOC shift) so the roster
 * becomes the single source that drives assigneeForResidentToday (task
 * materialiser) + the "only my residents during my shift" access lock.
 *
 * Governance: this creates OPERATIONAL coverage only. A PCG (private) cell does
 * NOT auto-create a billable DT-013 assignment — that stays in the family-approved
 * DT-013 flow (no auto-fee). The bridge just flags which residents have a private
 * caregiver on the roster.
 *
 * Codes it can't resolve to real staff/residents are returned as `unresolved`
 * (with a reason) rather than dropped silently — the mapping is client data.
 */

import { parseShiftCode, type StaffRoster } from "./caregiverRoster.ts";
import type { ShiftKey } from "./caregiverSchedule.ts";

export const ROSTER_MAPPING_KEY = "roster_mappings";

export interface RosterMapping {
  /** PCG resident code (e.g. "107") → resident id. Overrides room matching. */
  residentByCode?: Record<string, string>;
  /** CG station/team number → the resident ids that station covers. */
  stationResidents?: Record<string, string[]>;
}

/** Roster shift letter → the operational AM/PM/NOC shift. MID is supervisory. */
export const SHIFT_MAP: Record<string, ShiftKey | null> = { AM: "AM", PM: "PM", NIGHT: "NOC", MID: null };

export interface StaffRef { id: string; userId?: string; name: string }
export interface ResidentRef { id: string; name: string; room: string }

export interface ResolvedAssignment {
  date: string;
  shift: ShiftKey;
  caregiverStaffId: string;
  caregiverUserId?: string;
  caregiverName: string;
  residentIds: string[];
  residents: { id: string; name: string; room: string }[];
  private: boolean;
  code: string;
}

export interface UnresolvedCell { date: string; staff: string; code: string; reason: string }
export interface BridgeResult { assignments: ResolvedAssignment[]; unresolved: UnresolvedCell[] }

/** Order-independent name key so "JULIAN, MAY ANN" matches "May Ann Julian". */
const nameKey = (s: string) =>
  String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).sort().join("");

/**
 * Resolve the roster into operational caregiver→resident assignments.
 * Auto-matches caregivers by name (falling back to employee code) and private
 * residents by room number; a mapping config supplies resident-code and
 * station→residents overrides.
 */
export function bridgeRoster(roster: StaffRoster, ctx: {
  staff: StaffRef[];
  residents: ResidentRef[];
  mapping?: RosterMapping;
  dates?: string[];
}): BridgeResult {
  const staffByKey = new Map<string, StaffRef>();
  for (const s of ctx.staff) staffByKey.set(nameKey(s.name), s);
  const residentByRoom = new Map(ctx.residents.map((r) => [String(r.room).trim(), r]));
  const residentById = new Map(ctx.residents.map((r) => [r.id, r]));
  const mapping = ctx.mapping ?? {};
  const dates = ctx.dates ?? roster.dates;

  const assignments: ResolvedAssignment[] = [];
  const unresolved: UnresolvedCell[] = [];

  for (const row of roster.rows) {
    if (row.baseRole !== "CAREGIVER") continue; // only caregivers map to resident coverage
    const who = row.name || row.employeeCode;
    const staff = staffByKey.get(nameKey(row.name)) ?? staffByKey.get(nameKey(row.employeeCode));

    for (const date of dates) {
      const raw = row.cells[date];
      if (!raw) continue;
      const c = parseShiftCode(raw);
      if (c.kind !== "WORK") continue;
      const shift = c.shift ? SHIFT_MAP[c.shift] : null;
      if (!shift) continue; // MID / supervisory — no resident coverage

      if (!staff) { unresolved.push({ date, staff: who, code: raw, reason: "No matching staff record (matched by name)" }); continue; }

      let residents: ResidentRef[] = [];
      if (c.private && c.residentCode) {
        const mapped = mapping.residentByCode?.[c.residentCode];
        const res = mapped ? residentById.get(mapped) : residentByRoom.get(c.residentCode);
        if (!res) { unresolved.push({ date, staff: who, code: raw, reason: `Private resident code ${c.residentCode} not mapped (room / id)` }); continue; }
        residents = [res];
      } else if (c.station) {
        const ids = mapping.stationResidents?.[c.station] ?? [];
        residents = ids.map((id) => residentById.get(id)).filter((r): r is ResidentRef => !!r);
        if (!residents.length) { unresolved.push({ date, staff: who, code: raw, reason: `Station ${c.station} has no resident mapping` }); continue; }
      } else {
        continue;
      }

      assignments.push({
        date, shift,
        caregiverStaffId: staff.id, caregiverUserId: staff.userId, caregiverName: staff.name,
        residentIds: residents.map((r) => r.id),
        residents: residents.map((r) => ({ id: r.id, name: r.name, room: r.room })),
        private: !!c.private, code: raw,
      });
    }
  }

  return { assignments, unresolved };
}
