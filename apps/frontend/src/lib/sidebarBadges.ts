// Real, live per-tab "needs attention" counts for the sidebar badges.
//
// Pure functions over the SAME data the boards render from (Resident, Incident,
// CarePlan, and the migration-free app-settings), so a tab's badge always equals
// what the tab itself would show — never a stale notification tally. Keyed by
// route SEGMENT (the last path part, e.g. "weightmonitoring"); the shell maps
// each count onto whichever roles actually have that tab.
//
// Adding a tab = add one line to computeSidebarBadges. Anything not listed here
// simply shows no badge (an honest blank beats a wrong number).

import { parseDomainCases, DOMAIN_CASES_KEY } from "./lifecare/domainMonitoring";
import { ALERT_NOTIFICATION_TYPES } from "./alertAccess";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

// ── Weight cadence (mirrors WeightMonitoringBoard.evalResident) ──────────────
// A resident "needs attention" when never weighed, past their 7-day next-due
// date (due/overdue), or their last weekly check was logged as "unable".
const WEIGHT_KEY = "weight_logs";
const WEIGHT_INTERVAL_DAYS = 7;
const MANILA_TZ = "Asia/Manila";
const todayManila = () => new Intl.DateTimeFormat("en-CA", { timeZone: MANILA_TZ }).format(new Date());
const dParse = (d: string) => {
  const head = String(d ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? new Date(head + "T00:00:00Z") : new Date(String(d ?? ""));
};
const isoDate = (d: Date) => (Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10));
const addDays = (iso: string, n: number) => {
  const d = dParse(iso);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
};

interface WeightLog { type?: string; residentId?: string; date?: string; unable?: boolean }
const parseWeightLogs = (raw?: string | null): WeightLog[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
};

function weightAttentionCount(residents: Row[], raw?: string | null): number {
  const logs = parseWeightLogs(raw);
  const today = todayManila();
  let n = 0;
  for (const r of residents) {
    const rid = s(r.id);
    const latest = logs
      .filter((l) => l.type === "weekly" && l.residentId === rid && l.date)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    if (!latest) { n++; continue; }                        // never weighed → due
    const nextDue = addDays(String(latest.date), WEIGHT_INTERVAL_DAYS);
    if (!nextDue || nextDue <= today) { n++; continue; }   // due / overdue
    if (latest.unable) n++;                                // logged but unable
  }
  return n;
}

// Shift windows mirror TaskAssignmentBoard: DAY 7–15, EVENING 15–23, else NIGHT.
// The Task board only shows the CURRENT shift's tasks, so the badge matches it.
type Shift = "DAY" | "EVENING" | "NIGHT";
const shiftFor = (h: number): Shift => (h >= 7 && h < 15 ? "DAY" : h >= 15 && h < 23 ? "EVENING" : "NIGHT");
const shiftNow = (): Shift => shiftFor(new Date().getHours());
const shiftOf = (iso: unknown): Shift | null => {
  if (!iso) return null;
  const d = new Date(iso as string);
  return Number.isNaN(d.getTime()) ? null : shiftFor(d.getHours());
};

export interface SidebarBadgeData {
  residents: Row[];
  incidents: Row[];
  carePlans: Row[];
  appSettings: Array<{ key?: string; id?: string; value?: string }>;
  /** Already snooze- + role-scoped UNREAD notifications (same set the bell uses). */
  unreadNotifications: Array<{ type?: string }>;
  /** Raw Task rows (status/assignedToId/dueDate). Omit for roles without the tab. */
  tasks?: Row[];
  /** How to scope tasks: caregivers see only their own, coordinators see all. */
  taskViewer?: { staffId: string | null; scope: "own" | "all" };
}

/** Map of route-segment → count. Segments with a zero count are omitted. */
export function computeSidebarBadges(d: SidebarBadgeData): Record<string, number> {
  const setting = (k: string) => d.appSettings.find((r) => (r.key || r.id) === k)?.value;
  const out: Record<string, number> = {};
  const put = (seg: string, n: number) => { if (n > 0) out[seg] = n; };

  // Weight Tracking — residents due/overdue/unable.
  put("weightmonitoring", weightAttentionCount(d.residents, setting(WEIGHT_KEY)));

  // Incident Reports — open (unresolved) incidents.
  put("incidents", d.incidents.filter((i) => !i.resolved).length);

  // Domain / Vitals — open (non-resolved) monitoring cases.
  const openCases = parseDomainCases(setting(DOMAIN_CASES_KEY)).filter((c) => c.status !== "RESOLVED").length;
  put("domainmonitoring", openCases);
  put("vitalstrend", openCases);

  // Care Plan Governance — plans awaiting approval (held drafts + under review).
  put("careplans", d.carePlans.filter((p) => { const st = s(p.status); return st === "DRAFT" || st === "UNDER_REVIEW"; }).length);

  // Clinical Alerts — unread alert-type notifications (matches Alert Center).
  put("alertcenter", d.unreadNotifications.filter((n) => ALERT_NOTIFICATION_TYPES.has(String(n.type))).length);

  // Task Cards / Assignment — open (not-completed) tasks due THIS shift. Caregivers
  // count only tasks assigned to them (same scope their Task Cards board shows).
  if (d.tasks && d.taskViewer) {
    const now = shiftNow();
    const mine = String(d.taskViewer.staffId ?? "");
    put("taskassignment", d.tasks.filter((t) => {
      if (String(t.status ?? "").toUpperCase() === "COMPLETED") return false;
      if (shiftOf(t.dueDate) !== now) return false;
      return d.taskViewer!.scope === "all" || String(t.assignedToId ?? "") === mine;
    }).length);
  }

  return out;
}
