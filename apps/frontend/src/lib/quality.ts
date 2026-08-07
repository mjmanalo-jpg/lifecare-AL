// ─────────────────────────────────────────────────────────────
// Quality Monitoring aggregation.
//
// Pure functions that roll up raw activity (tasks, medication passes,
// incidents, call bells, care plans) into ResidentQualityScore- and
// CommunityQualityDashboard-shaped metrics. Used by the Quality dashboard for
// live compute AND by its "Save snapshot" action to populate the models.
// No I/O here — the caller supplies already-fetched rows.
// ─────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const tsOf = (v: unknown): number | null => {
  if (!v) return null;
  const d = new Date(String(v)).getTime();
  return isNaN(d) ? null : d;
};
/** Percentage (one decimal) or null when there's nothing to measure. */
const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
const inWindow = (t: number | null, start: number, end: number) => t != null && t >= start && t <= end;
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface QualityPeriod { start: number; end: number; days: number; label: string; periodType: "DAILY" | "WEEKLY" | "MONTHLY" }
export function periodFor(days: number, now = Date.now()): QualityPeriod {
  return {
    start: now - days * 86_400_000,
    end: now,
    days,
    label: `Last ${days} days`,
    periodType: days <= 1 ? "DAILY" : days <= 7 ? "WEEKLY" : "MONTHLY",
  };
}

export interface QualityRaw {
  residents: Row[];
  tasks: Row[];
  meds: Row[];
  incidents: Row[];
  callBells: Row[];
  carePlans: Row[];
}

export interface ResidentQuality {
  residentId: string;
  name: string;
  room: string;
  acuity: string;
  careCompletionScore: number | null;
  medicationComplianceScore: number | null;
  riskManagementScore: number;
  overallScore: number;
  tasksScheduled: number;
  tasksCompleted: number;
  medsScheduled: number;
  medsTaken: number;
  incidentsCount: number;
}

export interface CommunityQuality {
  taskCompletionRate: number | null;
  medicationComplianceRate: number | null;
  medicationErrorRate: number | null;
  incidentRate: number | null; // incidents per resident
  fallRate: number | null; // falls per resident
  carePlanReviewCompliance: number | null;
  callBellResponseTime: number | null; // avg minutes to respond
  averageResidentQualityScore: number | null;
  residentCount: number;
  totalIncidents: number;
  totalFalls: number;
}

const MED_TAKEN = new Set(["GIVEN", "PARTIAL"]);
const MED_ERROR = new Set(["REFUSED", "MISSED"]);

/** Per-resident quality report card for the period. */
export function computeResidentQuality(r: Row, raw: QualityRaw, p: QualityPeriod): ResidentQuality {
  const id = s(r.id);
  const res = (r.resident ?? r) as Row;

  const rTasks = raw.tasks.filter((t) => s(t.residentId) === id && inWindow(tsOf(t.createdAt), p.start, p.end));
  const tasksScheduled = rTasks.length;
  const tasksCompleted = rTasks.filter((t) => s(t.status) === "COMPLETED").length;
  const careCompletionScore = pct(tasksCompleted, tasksScheduled);

  const rMeds = raw.meds.filter((m) => s(m.residentId) === id && inWindow(tsOf(m.scheduledTime), p.start, p.end));
  const medsScheduled = rMeds.length;
  const medsTaken = rMeds.filter((m) => MED_TAKEN.has(s(m.status))).length;
  const medicationComplianceScore = pct(medsTaken, medsScheduled);

  const incidentsCount = raw.incidents.filter((i) => s(i.residentId) === id && inWindow(tsOf(i.createdAt), p.start, p.end)).length;
  const riskManagementScore = Math.max(0, 100 - incidentsCount * 20);

  const parts = [careCompletionScore, medicationComplianceScore, riskManagementScore].filter((x): x is number => x != null);
  const overallScore = parts.length ? round1(parts.reduce((a, b) => a + b, 0) / parts.length) : 0;

  return {
    residentId: id,
    name: `${s(res.firstName)} ${s(res.lastName)}`.trim() || "Resident",
    room: s(res.roomNumber) || "—",
    acuity: s(res.currentAcuityLevel) || "—",
    careCompletionScore,
    medicationComplianceScore,
    riskManagementScore,
    overallScore,
    tasksScheduled,
    tasksCompleted,
    medsScheduled,
    medsTaken,
    incidentsCount,
  };
}

/** Community-wide dashboard metrics + the per-resident breakdown. */
export function computeQuality(raw: QualityRaw, p: QualityPeriod): { community: CommunityQuality; residents: ResidentQuality[] } {
  const residents = raw.residents.filter((r) => s(r.status ?? "ACTIVE") !== "DISCHARGED");
  const perResident = residents
    .map((r) => computeResidentQuality(r, raw, p))
    .sort((a, b) => a.overallScore - b.overallScore); // worst first — needs attention

  const tasks = raw.tasks.filter((t) => inWindow(tsOf(t.createdAt), p.start, p.end));
  const taskCompletionRate = pct(tasks.filter((t) => s(t.status) === "COMPLETED").length, tasks.length);

  const meds = raw.meds.filter((m) => inWindow(tsOf(m.scheduledTime), p.start, p.end));
  const medicationComplianceRate = pct(meds.filter((m) => MED_TAKEN.has(s(m.status))).length, meds.length);
  const medicationErrorRate = pct(meds.filter((m) => MED_ERROR.has(s(m.status))).length, meds.length);

  const incidents = raw.incidents.filter((i) => inWindow(tsOf(i.createdAt), p.start, p.end));
  const totalIncidents = incidents.length;
  const totalFalls = incidents.filter((i) => s(i.incidentType) === "FALL").length;
  const rc = residents.length;
  const incidentRate = rc ? Math.round((totalIncidents / rc) * 100) / 100 : null;
  const fallRate = rc ? Math.round((totalFalls / rc) * 100) / 100 : null;

  const activePlans = raw.carePlans.filter((cp) => ["ACTIVE", "DRAFT"].includes(s(cp.status)));
  const onTime = activePlans.filter((cp) => { const nr = tsOf(cp.nextReviewDate); return nr == null || nr >= p.end; });
  const carePlanReviewCompliance = pct(onTime.length, activePlans.length);

  const responded = raw.callBells.filter((cb) => tsOf(cb.respondedAt) != null && inWindow(tsOf(cb.createdAt), p.start, p.end));
  const callBellResponseTime = responded.length
    ? round1(responded.reduce((a, cb) => a + (tsOf(cb.respondedAt)! - tsOf(cb.createdAt)!) / 60000, 0) / responded.length)
    : null;

  const overalls = perResident.map((x) => x.overallScore).filter((x) => x > 0);
  const averageResidentQualityScore = overalls.length ? round1(overalls.reduce((a, b) => a + b, 0) / overalls.length) : null;

  return {
    community: {
      taskCompletionRate,
      medicationComplianceRate,
      medicationErrorRate,
      incidentRate,
      fallRate,
      carePlanReviewCompliance,
      callBellResponseTime,
      averageResidentQualityScore,
      residentCount: rc,
      totalIncidents,
      totalFalls,
    },
    residents: perResident,
  };
}
