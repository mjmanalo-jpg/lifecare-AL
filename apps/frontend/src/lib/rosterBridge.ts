/**
 * Phase 2 — bridge the Staff Roster → the operational Caregiver Schedule.
 *
 * Turns each WORKING caregiver cell in the roster into a caregiver_schedules
 * entry (caregiver → the residents they cover, per rostered shift) so the roster
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

import { parseShiftCode, type CodeShift, type StaffRoster } from "./caregiverRoster.ts";
import type { ShiftKey } from "./caregiverSchedule.ts";

export const ROSTER_MAPPING_KEY = "roster_mappings";

export interface RosterMapping {
  /** Roster employee code (e.g. "CG1") → staff id. Overrides name matching. */
  staffByCode?: Record<string, string>;
  /** PCG resident code (e.g. "107") → resident id. Overrides room matching. */
  residentByCode?: Record<string, string>;
  /** CG station/team number → the resident ids that station covers. */
  stationResidents?: Record<string, string[]>;
}

/** Roster shift letter → the operational 8-hour shift. MID is supervisory. */
export const SHIFT_MAP: Record<string, ShiftKey | null> = { AM: "AM", PM: "PM", NIGHT: "NOC", MID: null };

/**
 * A roster cell → the rosterable shift whose window it actually works.
 *
 * The roster codes already carry 8h vs 12h (`CG1A12`, `NODN12` — see
 * {@link parseShiftCode}); before the 12-hour patterns existed this bridge dropped
 * that and gave every cell an 8-hour window, so a 12-hour caregiver lost resident
 * access half-way through their shift. Now: a `…12` cell on the AM side is Day 12h
 * (7a–7p), and on the PM / Night side it is Night 12h (7p–7a) — the facility rosters
 * no other 12-hour pattern. Plain codes keep their 8-hour AM / PM / Noc windows.
 */
export function rosterShiftKey(cell: { shift?: CodeShift; hours?: 8 | 12 }): ShiftKey | null {
  if (!cell.shift || cell.shift === "MID") return null;
  if (cell.hours === 12) return cell.shift === "AM" ? "D12" : "N12";
  return SHIFT_MAP[cell.shift] ?? null;
}

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

/** A resident-coverage gap for one cell (nobody/nothing to resolve it to). */
type ResidentGap = { type: "residentCode" | "station"; value: string };

/** Shared resolvers so bridgeRoster + rosterReadiness agree on matching rules. */
function makeResolvers(ctx: { staff: StaffRef[]; residents: ResidentRef[]; mapping?: RosterMapping }) {
  const mapping = ctx.mapping ?? {};
  const staffById = new Map(ctx.staff.map((s) => [s.id, s]));
  const staffByName = new Map(ctx.staff.map((s) => [nameKey(s.name), s]));
  const residentByRoom = new Map(ctx.residents.map((r) => [String(r.room).trim(), r]));
  const residentById = new Map(ctx.residents.map((r) => [r.id, r]));

  /** Employee-code mapping first (reliable), then order-independent name match. */
  const resolveStaff = (row: { employeeCode: string; name: string }): StaffRef | undefined => {
    const mappedId = mapping.staffByCode?.[row.employeeCode];
    if (mappedId && staffById.has(mappedId)) return staffById.get(mappedId);
    return staffByName.get(nameKey(row.name)) ?? staffByName.get(nameKey(row.employeeCode));
  };

  /** Residents a working code covers, or the gap that blocks it. null = not coverage. */
  const resolveResidents = (c: ParsedCodeLike): { residents: ResidentRef[] } | { gap: ResidentGap } | null => {
    if (c.private && c.residentCode) {
      const mapped = mapping.residentByCode?.[c.residentCode];
      const res = mapped ? residentById.get(mapped) : residentByRoom.get(c.residentCode);
      return res ? { residents: [res] } : { gap: { type: "residentCode", value: c.residentCode } };
    }
    if (c.station) {
      const ids = mapping.stationResidents?.[c.station] ?? [];
      const residents = ids.map((id) => residentById.get(id)).filter((r): r is ResidentRef => !!r);
      return residents.length ? { residents } : { gap: { type: "station", value: c.station } };
    }
    return null;
  };

  return { resolveStaff, resolveResidents };
}

type ParsedCodeLike = { private?: boolean; residentCode?: string; station?: string };

/**
 * Resolve the roster into operational caregiver→resident assignments.
 * Matches caregivers by employee-code mapping then name; private residents by
 * room number (or the residentByCode override); stations via stationResidents.
 */
export function bridgeRoster(roster: StaffRoster, ctx: {
  staff: StaffRef[];
  residents: ResidentRef[];
  mapping?: RosterMapping;
  dates?: string[];
}): BridgeResult {
  const { resolveStaff, resolveResidents } = makeResolvers(ctx);
  const dates = ctx.dates ?? roster.dates;
  const assignments: ResolvedAssignment[] = [];
  const unresolved: UnresolvedCell[] = [];

  for (const row of roster.rows) {
    if (row.baseRole !== "CAREGIVER") continue; // only caregivers map to resident coverage
    const who = row.name || row.employeeCode;
    const staff = resolveStaff(row);

    for (const date of dates) {
      const raw = row.cells[date];
      if (!raw) continue;
      const c = parseShiftCode(raw);
      if (c.kind !== "WORK") continue;
      const shift = rosterShiftKey(c);
      if (!shift) continue; // MID / supervisory — no resident coverage

      if (!staff) { unresolved.push({ date, staff: who, code: raw, reason: "No matching staff record (register the staff / map their code)" }); continue; }

      const r = resolveResidents(c);
      if (!r) continue;
      if ("gap" in r) {
        unresolved.push({
          date, staff: who, code: raw,
          reason: r.gap.type === "residentCode"
            ? `Private resident code ${r.gap.value} not admitted / mapped (room or id)`
            : `Station ${r.gap.value} has no resident mapping`,
        });
        continue;
      }

      assignments.push({
        date, shift,
        caregiverStaffId: staff.id, caregiverUserId: staff.userId, caregiverName: staff.name,
        residentIds: r.residents.map((x) => x.id),
        residents: r.residents.map((x) => ({ id: x.id, name: x.name, room: x.room })),
        private: !!c.private, code: raw,
      });
    }
  }

  return { assignments, unresolved };
}

export interface RosterReadiness {
  ready: boolean;
  caregiverRows: number;
  matchedStaff: number;
  /** Rostered caregivers with no staff account / code mapping. */
  missingStaff: { code: string; name: string }[];
  /** PCG resident codes with no admitted resident (room) / mapping. */
  missingResidentCodes: string[];
  /** CG stations with no resident mapping. */
  unmappedStations: string[];
  /** Working cells that WOULD resolve to a real assignment right now. */
  resolvableAssignments: number;
}

/**
 * Pre-sync readiness: which rostered staff aren't registered, and which
 * residents/stations aren't set up — so onboarding gaps are visible BEFORE a sync
 * writes anything. Pure; safe to run on every render.
 */
export function rosterReadiness(roster: StaffRoster, ctx: {
  staff: StaffRef[];
  residents: ResidentRef[];
  mapping?: RosterMapping;
  dates?: string[];
}): RosterReadiness {
  const { resolveStaff, resolveResidents } = makeResolvers(ctx);
  const dates = ctx.dates ?? roster.dates;
  const caregiverRows = roster.rows.filter((r) => r.baseRole === "CAREGIVER");

  const missingStaff: { code: string; name: string }[] = [];
  const missingResidentCodes = new Set<string>();
  const unmappedStations = new Set<string>();
  let matchedStaff = 0;
  let resolvableAssignments = 0;

  for (const row of caregiverRows) {
    const staff = resolveStaff(row);
    if (staff) matchedStaff++;
    else missingStaff.push({ code: row.employeeCode, name: row.name });

    for (const date of dates) {
      const raw = row.cells[date];
      if (!raw) continue;
      const c = parseShiftCode(raw);
      if (c.kind !== "WORK" || !rosterShiftKey(c)) continue;
      const r = resolveResidents(c);
      if (!r) continue;
      if ("gap" in r) {
        if (r.gap.type === "residentCode") missingResidentCodes.add(r.gap.value);
        else unmappedStations.add(r.gap.value);
      } else if (staff) {
        resolvableAssignments++;
      }
    }
  }

  return {
    ready: missingStaff.length === 0 && missingResidentCodes.size === 0 && unmappedStations.size === 0,
    caregiverRows: caregiverRows.length,
    matchedStaff,
    missingStaff,
    missingResidentCodes: [...missingResidentCodes].sort(),
    unmappedStations: [...unmappedStations].sort(),
    resolvableAssignments,
  };
}
