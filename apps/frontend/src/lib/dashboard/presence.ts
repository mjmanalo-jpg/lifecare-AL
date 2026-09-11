/**
 * Who is on duty this shift — resolved from every source that can prove it.
 *
 * The ROSTER is this product's duty authority. ClockInGate makes clock-in optional:
 * a caregiver reaches their care boards because they are scheduled today, and the
 * server scopes their reads to their rostered residents. So being rostered to the
 * active shift IS being on duty, whether or not they used the Time In tab.
 *
 * The time clock still counts when it is used, so all three sources are unioned:
 *   1. rostered to the active shift  (authority)
 *   2. an open TimeTracking row      (mirror, best-effort)
 *   3. a verified clock-in event     (authoritative when present)
 *
 * Reading only source 2 reported "CG Present 0" for a fully rostered shift and
 * falsely flagged those residents as uncovered. Deduping matters just as much:
 * someone rostered AND clocked in AND holding a TimeTracking row is ONE person.
 *
 * Pure and dependency-free so it is directly testable — see tests/dashboard-attendance.
 */

/** Minimum shape of a Staff row needed to resolve identity + discipline. */
export interface StaffLike {
  id: string;
  userId?: string | null;
  position?: string | null;
  user?: { name?: string | null; role?: string | null } | null;
}

export interface OnDutyPerson {
  /** Stable de-dupe key: the Staff id when resolvable, else the User id. */
  key: string;
  name?: string | null;
  /** Discipline, as User.role (e.g. "CAREGIVER") when known. */
  role?: string | null;
  position?: string | null;
  /** Which evidence put them on the floor. Roster wins — it is the authority. */
  source: "roster" | "clock";
}

export interface PresenceSources {
  /** Caregiver-roster rows for the ACTIVE shift only. */
  rostered: Array<{ caregiverStaffId?: string | null; caregiverUserId?: string | null; caregiverName?: string | null }>;
  /** Open (not ended, not ABSENT) TimeTracking rows. */
  timeTracking: Array<{ staffId: string; name?: string | null; role?: string | null; position?: string | null }>;
  /** Verified clock-ins inside the attendance window, keyed by userId. */
  clockedIn: Array<{ userId: string; name?: string | null; role?: string | null }>;
  staff: StaffLike[];
}

// "aide" is included deliberately: this roster really does carry positions like
// "Nurse Aide" (a caregiver). Note it contains the word "nurse", so the aide test
// MUST win over the nurse test or an aide gets reported as the nurse on duty.
const IS_CAREGIVER = /caregiver|aide|care assistant|daily assistance/i;
const IS_NURSE = /nurse|clinical/i;

/**
 * Discipline by authoritative User.role first, then the free-text position title.
 * Matching position alone undercounted caregivers whose title isn't literally
 * "Caregiver" (e.g. "Nurse Aide", "Daily Assistance").
 */
export const isCaregiver = (p: Pick<OnDutyPerson, "role" | "position">) =>
  p.role === "CAREGIVER" || (p.role !== "NURSE" && IS_CAREGIVER.test(p.position || ""));

/** Nurse only when the title isn't an aide's — "Nurse Aide" is caregiver duty. */
export const isNurse = (p: Pick<OnDutyPerson, "role" | "position">) =>
  p.role === "NURSE"
  || (p.role !== "CAREGIVER" && IS_NURSE.test(p.position || "") && !IS_CAREGIVER.test(p.position || ""));

export function resolveOnDuty(sources: PresenceSources): OnDutyPerson[] {
  const byId = new Map(sources.staff.map((s) => [s.id, s]));
  const byUserId = new Map(sources.staff.filter((s) => s.userId).map((s) => [s.userId as string, s]));

  const find = (staffId?: string | null, userId?: string | null) =>
    (staffId ? byId.get(staffId) : undefined) ?? (userId ? byUserId.get(userId) : undefined);

  /** One canonical key per human, so the three sources collapse instead of stacking. */
  const keyFor = (staffId?: string | null, userId?: string | null) => {
    const staff = find(staffId, userId);
    if (staff) return `staff:${staff.id}`;
    if (userId) return `user:${userId}`;
    return `staff:${staffId ?? "unknown"}`;
  };

  const people = new Map<string, OnDutyPerson>();

  // 1. Rostered — the authority. Added first so its `source` survives the dedupe.
  for (const row of sources.rostered) {
    const staff = find(row.caregiverStaffId, row.caregiverUserId);
    const key = keyFor(row.caregiverStaffId, row.caregiverUserId);
    people.set(key, {
      key,
      // A row on the CAREGIVER roster IS caregiver duty for this shift. Don't infer
      // the discipline from User.role — a staffer whose login role is something
      // else still works the shift as a caregiver, and inferring would drop them.
      role: "CAREGIVER",
      position: staff?.position,
      name: staff?.user?.name ?? row.caregiverName,
      source: "roster",
    });
  }

  // 2. Open TimeTracking row.
  for (const row of sources.timeTracking) {
    const key = keyFor(row.staffId, byId.get(row.staffId)?.userId);
    if (people.has(key)) continue;
    const staff = byId.get(row.staffId);
    people.set(key, {
      key,
      role: row.role ?? staff?.user?.role,
      position: row.position ?? staff?.position,
      name: row.name ?? staff?.user?.name,
      source: "clock",
    });
  }

  // 3. Verified clock-in.
  for (const row of sources.clockedIn) {
    const staff = byUserId.get(row.userId);
    const key = keyFor(staff?.id, row.userId);
    if (people.has(key)) continue;
    people.set(key, {
      key,
      role: staff?.user?.role ?? row.role,
      position: staff?.position,
      name: staff?.user?.name ?? row.name,
      source: "clock",
    });
  }

  return [...people.values()];
}
