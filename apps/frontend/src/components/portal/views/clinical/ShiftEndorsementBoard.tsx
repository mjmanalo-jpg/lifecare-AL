"use client";

/**
 * Shift Endorsements — structured shift handover. Three views: the endorsement
 * list (Today/Week/Month + New Endorsement), Structured Details (per-resident
 * clinical sections), and Carry-Over & Sign-Off (carry-over items + a sign-off
 * checklist whose stats derive from live incidents/tasks/ADL logs/carry-overs).
 * Migration-free: endorsements are a JSON array in the app-setting `shift_endorsements`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  FileText, Plus, X, AlertTriangle, Sparkles, ArrowLeft, ArrowLeftRight, ChevronDown, ChevronUp,
  User, Clock, Heart, Droplets, Accessibility, Shield, Brain, Pill, Calendar, Siren, ShieldCheck, CheckCircle2, Check, Trash2, Pencil, ClipboardList,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, upsertSettingEntry, deleteSettingEntry } from "@/lib/api";
import { recordAudit } from "@/lib/auditClient";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { useCareLogData } from "./CareLogsBoard";
import { TASK_NOTES_FIELD } from "@/lib/taskNotes";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, assigneeForResidentToday } from "@/lib/caregiverSchedule";
import SignatureModal from "@/components/portal/SignatureModal";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = "shift_endorsements";
const ADL_KEY = "adl_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
// Readable label for a care-log domain code (the v4.2 AS-codes emitted by the
// shared useCareLogData hook) used when composing endorsement section text.
const CARE_DOMAIN_LABELS: Record<string, string> = {
  "AS-01": "ADLs", "AS-02": "Mobility", "AS-03": "Fall risk", "AS-04": "Cognition",
  "AS-05": "Behavior", "AS-06": "Clinical monitoring", "AS-08": "Nutrition",
  "AS-09": "Communication", "AS-10": "Continence", "AS-11": "Skin", "AS-12": "Sleep / routine",
  "AS-13": "Concern", "AS-14": "Reablement / therapy", "pain": "Pain",
};
const careDomainLabel = (d: string) => CARE_DOMAIN_LABELS[d] ?? d;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `end-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const isoDate = (d: Date) => d.toISOString().split("T")[0];
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const fmtDay = (isoStr: string) => new Date(isoStr + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

const SHIFT_TYPES = [
  { label: "Morning", range: "06:00–14:00" }, { label: "Afternoon", range: "14:00–22:00" }, { label: "Night", range: "22:00–06:00" },
  { label: "Morning 12h", range: "06:00–18:00" }, { label: "Night 12h", range: "18:00–06:00" },
];
// Auto-pick the current 8-hour shift from the wall clock so a new endorsement
// defaults to the shift the clinician is actually on: Morning 06–14, Afternoon
// 14–22, Night 22–06. (Indexes match the first three SHIFT_TYPES entries.)
const currentShiftIdx = () => {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return 0;   // Morning
  if (h >= 14 && h < 22) return 1;  // Afternoon
  return 2;                          // Night (wraps 22:00 → 06:00)
};
const SECTIONS = [
  { key: "generalCondition", label: "General Condition", icon: Heart, color: "text-rose-500" },
  { key: "intakeElimination", label: "Intake & Elimination", icon: Droplets, color: "text-blue-500" },
  { key: "adlMobility", label: "ADL & Mobility", icon: Accessibility, color: "text-purple-500" },
  { key: "skinWound", label: "Skin & Wound", icon: Shield, color: "text-amber-500" },
  { key: "behaviorCognitive", label: "Behavior & Cognitive", icon: Brain, color: "text-pink-500" },
  { key: "medicationIssues", label: "Medication Issues", icon: Pill, color: "text-green-500" },
  { key: "appointmentsOrders", label: "Appointments & Orders", icon: Calendar, color: "text-indigo-500" },
  { key: "incidentsEscalations", label: "Incidents & Escalations", icon: Siren, color: "text-red-500" },
] as const;
const CHECKLIST = [
  { key: "alerts", label: "I have reviewed all unresolved alerts", desc: "Alerts have been acknowledged, escalated, or documented for carry-over" },
  { key: "tasks", label: "I have reviewed all pending tasks", desc: "Tasks are completed, delegated, or carried over with instructions" },
  { key: "adl", label: "I have reviewed ADL declines for this shift", desc: "Residents with declining ADL status have been noted and escalated if needed" },
  { key: "carryover", label: "Carry-over notes are complete for all unresolved concerns", desc: "All items requiring next-shift action have been documented above" },
];
const PRIORITIES = ["Routine", "Important", "Urgent"];
const ROLES = ["Nurse", "Caregiver", "Care Manager", "Physician"];
// Per-item current condition (§12): where the resident stands right now.
const ITEM_STATUSES = ["Stable", "Watch", "Escalated"] as const;
type ItemStatus = typeof ITEM_STATUSES[number];
// Pre-drafted carry-over fields pulled from a resident's live shift data.
type CarryOverDraft = { concern: string; action: string; priority: string; status: ItemStatus; whatChanged: string; pending: string; watchNext: string };
// How an incoming shift disposes of a carry-over item (§12 close states).
const CLOSE_STATES = ["Resolved", "Continue Monitoring", "Action Next Shift", "Awaiting External Response"] as const;
type CloseState = typeof CLOSE_STATES[number];
const CONCERN_SECTIONS = ["skinWound", "behaviorCognitive", "medicationIssues", "incidentsEscalations"];

interface CarryOver {
  id: string; residentId: string; concern: string; priority: string; role: string; dueTime?: string; action?: string; autoTask?: boolean; autoAlert?: boolean;
  status?: ItemStatus;      // current condition: Stable / Watch / Escalated
  whatChanged?: string;     // what changed this shift vs prior baseline
  pending?: string;         // what remains outstanding
  watchNext?: string;       // what the next shift must watch for
  coverageNote?: string;    // caregiver / coverage constraint note
  closeState?: CloseState;  // disposition once handled by the incoming shift
  closedAt?: string; closedBy?: string;
}
const STATUS_CLS: Record<ItemStatus, string> = {
  Stable: "bg-green-100 text-green-700",
  Watch: "bg-amber-100 text-amber-700",
  Escalated: "bg-red-100 text-red-700",
};
const CLOSE_CLS: Record<CloseState, string> = {
  Resolved: "bg-emerald-50 border-emerald-200 text-emerald-700",
  "Continue Monitoring": "bg-blue-50 border-blue-200 text-blue-700",
  "Action Next Shift": "bg-amber-50 border-amber-200 text-amber-700",
  "Awaiting External Response": "bg-purple-50 border-purple-200 text-purple-700",
};
interface EndResident { residentId: string; sections: Record<string, string>; }
interface HTask { id: string; title: string; resident: string; room: string; priority: string; due: string }
interface HIncident { id: string; type: string; resident: string; room: string; severity: string }
interface Handover { pendingTasks: HTask[]; openIncidents: HIncident[]; snapshotAt: string }
interface Endorsement {
  id: string; number: string; date: string; shiftLabel: string; shiftRange: string;
  generalNotes?: string; medicationNotes?: string; aiSummary?: string;
  outgoingBy?: string; incomingBy?: string; signedAt?: string; status: "PENDING" | "SIGNED_OFF" | "ACKNOWLEDGED";
  residents: EndResident[]; carryOvers: CarryOver[]; checklist: Record<string, boolean>; createdAt: string;
  outgoingById?: string; // User id of whoever logged it — only they may sign off.
  authorRole?: ClinicianRole; // who authored it: caregiver handover vs nurse/CM endorsement.
  handover?: Handover;   // frozen snapshot of pending tasks + open incidents at sign-off
  acceptedBy?: string; acceptedById?: string; acceptedAt?: string; // stamped when incoming acknowledges
}
const parse = (raw: string | null | undefined): Endorsement[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : []; } catch { return []; } };

export default function ShiftEndorsementBoard({ clinicianRole = "NURSE", embedded }: { clinicianRole?: ClinicianRole; embedded?: boolean }) {
  const { name: clinicianName, userId: clinicianUserId, staffId: clinicianStaffId } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const taskQ = useLiveQuery<Row>("tasks", { query: "take=600", tables: ["Task"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  // Live care data used to auto-draft the per-resident structured sections.
  const vitQ = useLiveQuery<Row>("vitals", { query: "take=1500", tables: ["VitalsLog"] });
  const escQ = useLiveQuery<Row>("escalations", { query: "take=400", tables: ["Escalation"] });
  const marQ = useLiveQuery<Row>("medication-administrations", { query: "include=medication&take=2000", tables: ["MedicationAdministration"] });
  const refQ = useLiveQuery<Row>("hospital-referrals", { query: "take=400", tables: ["HospitalReferral"] });
  const { allEntries: careEntries } = useCareLogData(clinicianRole);

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const items = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);
  // Role-separated visibility: caregivers see only caregiver handovers, nurses see
  // only nurse endorsements; the Care Manager (oversight) sees everything. Legacy
  // records without authorRole are treated as nurse endorsements.
  const visibleItems = useMemo(() => {
    if (clinicianRole === "CARE_MANAGER") return items;
    return items.filter((e) => (e.authorRole || "NURSE") === clinicianRole);
  }, [items, clinicianRole]);
  const adlLogs = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === ADL_KEY)?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);
  const woundRecords = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === "wound_records")?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);
  const weightLogs = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === "weight_logs")?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "Resident", room: "" }; };

  // Caregivers endorse ONLY the residents assigned to them today — the same roster
  // the task materializer and /api/caregiver/my-residents use. Every data pull
  // (add-resident picker, auto-fill, handover snapshot, sign-off stats) is scoped
  // to this set. Other roles (Nurse / Care Manager) see the whole community.
  const scopedResidents = useMemo(() => {
    if (clinicianRole !== "CAREGIVER" || !clinicianStaffId) return residents;
    const schedules = parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value);
    const now = new Date();
    return residents.filter((r: Row) => assigneeForResidentToday(schedules, s(r.id), now, "Asia/Manila")?.caregiverStaffId === clinicianStaffId);
  }, [residents, settingRows, clinicianRole, clinicianStaffId]);
  const scopedIds = useMemo(() => new Set(scopedResidents.map((r: Row) => s(r.id))), [scopedResidents]);
  const inScope = (rid: string) => clinicianRole !== "CAREGIVER" || scopedIds.has(rid);

  const [view, setView] = useState<"list" | "details" | "carryover">("list");
  const [activeId, setActiveId] = useState("");
  const [range, setRange] = useState<"today" | "week" | "month">("today");
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<Endorsement | null>(null); // edit an existing endorsement's content
  const active = items.find((e) => e.id === activeId) || null;

  // Per-entry delta writes so concurrent shifts don't clobber each other's
  // endorsements — the server merges the whole endorsement object into the array
  // by id under a row lock (see /api/db/[model] POST).
  const putEndorsement = async (e: Endorsement) => { await upsertSettingEntry(KEY, e as unknown as { id: string } & Record<string, unknown>); await refetch(); };
  const removeEndorsement = async (id: string) => { await deleteSettingEntry(KEY, id); await refetch(); };
  const update = async (id: string, patch: Partial<Endorsement> | ((e: Endorsement) => Endorsement)) => {
    const cur = items.find((e) => e.id === id);
    if (!cur) return;
    await putEndorsement(typeof patch === "function" ? patch(cur) : { ...cur, ...patch });
  };

  // Snapshot the shift's still-open work at sign-off — a frozen, accountable
  // record of what was outstanding when the shift ended.
  const buildHandover = (): Handover => ({
    pendingTasks: (taskQ.data || []).filter((t) => s(t.status) === "PENDING" && inScope(s(t.residentId))).slice(0, 150).map((t) => { const rn = resName(s(t.residentId)); return { id: s(t.id), title: s(t.title), resident: rn.name, room: rn.room, priority: s(t.priority), due: s(t.dueDate) }; }),
    openIncidents: (incQ.data || []).filter((i) => !i.resolvedAt && inScope(s(i.residentId))).slice(0, 150).map((i) => { const rn = resName(s(i.residentId)); return { id: s(i.id), type: s(i.incidentType), resident: rn.name, room: rn.room, severity: s(i.severity) }; }),
    snapshotAt: new Date().toISOString(),
  });

  // When the incoming shift acknowledges, put the curated carry-overs on THEIR
  // account: one task assigned to the acknowledging user per carry-over, plus a
  // notification. Best-effort — never blocks the acknowledgement.
  const acceptHandover = async (e: Endorsement) => {
    if (clinicianStaffId) {
      for (const c of e.carryOvers) {
        await createRecord("tasks", {
          residentId: c.residentId,
          title: `Carry-over: ${c.concern.slice(0, 60)}`,
          description: c.action || c.concern,
          status: "PENDING",
          priority: c.priority === "Urgent" ? "HIGH" : c.priority === "Important" ? "MEDIUM" : "LOW",
          category: "Observation",
          assignedToId: clinicianStaffId,
          [TASK_NOTES_FIELD]: `Accepted from ${e.outgoingBy || "outgoing shift"}'s ${e.shiftLabel || "shift"} handover by ${clinicianName}.`,
        }).catch(() => null);
      }
    }
    if (clinicianUserId) {
      const n = e.carryOvers.length;
      createRecord("notifications", {
        userId: clinicianUserId, type: "SHIFT_REMINDER",
        title: "Shift handover accepted",
        message: `You acknowledged Endorsement ${e.number}${n ? ` — ${n} carry-over task${n === 1 ? "" : "s"} added to your list` : ""}.`,
        relatedEntityType: "handover", severity: "INFO",
      }).catch(() => null);
    }
  };

  // Auto-draft the 8 structured sections for a resident from the live care data
  // for the endorsement's day. Only sections with data are filled; everything is
  // still editable and the outgoing nurse signs off, so this is a draft, not a
  // source of truth.
  const buildSections = (rid: string, dateIso: string): Record<string, string> => {
    const dayStart = new Date(`${dateIso}T00:00:00`).getTime();
    const dayEnd = new Date(`${dateIso}T23:59:59`).getTime();
    const inDay = (v: unknown) => { const t = new Date(String(v)).getTime(); return !isNaN(t) && t >= dayStart && t <= dayEnd; };
    const dayStr = (v: unknown) => String(v).slice(0, 10) === dateIso;
    const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);
    const timeOf = (v: unknown) => { const d = new Date(String(v)); return isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
    const out: Record<string, string> = {};

    const adl = adlLogs.filter((l: Row) => s(l.residentId) === rid && dayStr(l.date));
    const adlLine = (l: Row) => `${cap(s(l.domain))}: ${s(l.assistance) || "—"}${l.change ? ` (${s(l.change)})` : ""}`;

    // 1. General Condition — latest vitals + weight + sleep
    const vlatest: Record<string, Row> = {};
    (vitQ.data || []).filter((v) => s(v.residentId) === rid && inDay(v.recordedAt || v.createdAt))
      .sort((a, b) => new Date(s(b.recordedAt || b.createdAt)).getTime() - new Date(s(a.recordedAt || a.createdAt)).getTime())
      .forEach((v) => { const t = s(v.type); if (!vlatest[t]) vlatest[t] = v; });
    const VLBL: Record<string, string> = { BLOOD_PRESSURE: "BP", HEART_RATE: "HR", TEMPERATURE: "Temp", OXYGEN: "SpO₂", RESPIRATORY_RATE: "RR", BLOOD_GLUCOSE: "Glucose", WEIGHT: "Weight" };
    const vparts = Object.entries(VLBL).map(([k, l]) => { const v = vlatest[k]; return v ? `${l} ${s(v.value)}${s(v.unit) ? ` ${s(v.unit)}` : ""}` : ""; }).filter(Boolean);
    const wLatest = [...weightLogs.filter((l: Row) => s(l.residentId) === rid && l.weightKg != null)].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    const sleep = adl.filter((l: Row) => s(l.domain).toLowerCase() === "sleep").map(adlLine);
    let gc = vparts.length ? `Vitals — ${vparts.join(", ")}.` : "";
    if (wLatest && !vlatest.WEIGHT) gc += `${gc ? " " : ""}Weight ${wLatest.weightKg} kg.`;
    if (sleep.length) gc += `${gc ? " " : ""}${sleep.join("; ")}.`;
    // AS-06 Clinical Monitoring + AS-12 Sleep/Daily Routine care-log notes.
    const gcCare = careEntries.filter((e) => e.resId === rid && inDay(e.at) && ["AS-06", "AS-12"].includes(e.domain)).map((e) => `${careDomainLabel(e.domain)}: ${e.summary}`);
    if (gcCare.length) gc += `${gc ? " " : ""}${gcCare.join(" ")}`;
    if (gc) out.generalCondition = gc.trim();

    // 2. Intake & Elimination — care logs + ADL continence. Care-log domains are
    // the v4.2 AS-codes: AS-08 Nutrition/Hydration, AS-10 Continence, AS-11 Skin.
    const ie = careEntries.filter((e) => e.resId === rid && inDay(e.at) && ["AS-08", "AS-10", "AS-11"].includes(e.domain)).map((e) => `${careDomainLabel(e.domain)}: ${e.summary}`);
    const cont = adl.filter((l: Row) => s(l.domain).toLowerCase() === "continence").map(adlLine);
    const ieAll = [...ie, ...cont];
    if (ieAll.length) out.intakeElimination = ieAll.join(" ");

    // 3. ADL & Mobility — AS-01 ADLs, AS-02 Mobility, AS-03 Fall Risk, AS-14 Reablement/Therapy.
    const adlDomains = ["bathing", "dressing", "grooming", "toileting", "transfers", "feeding", "mobility"];
    const adlM = adl.filter((l: Row) => adlDomains.includes(s(l.domain).toLowerCase())).map(adlLine);
    const mob = careEntries.filter((e) => e.resId === rid && inDay(e.at) && ["AS-01", "AS-02", "AS-03", "AS-14"].includes(e.domain)).map((e) => `${careDomainLabel(e.domain)}: ${e.summary}`);
    const amAll = [...adlM, ...mob];
    if (amAll.length) out.adlMobility = amAll.join("; ");

    // 4. Skin & Wound
    const wounds = woundRecords.filter((w: Row) => s(w.residentId) === rid && !["HEALED", "RESOLVED", "CLOSED"].includes(s(w.status).toUpperCase()));
    if (wounds.length) out.skinWound = wounds.map((w: Row) => [s(w.location) || s(w.bodyLocation) || "Wound", s(w.type) || s(w.woundType), s(w.stage) ? `(${s(w.stage)})` : "", s(w.status) ? `· ${s(w.status)}` : ""].filter(Boolean).join(" ")).join("; ");

    // 5. Behavior & Cognitive — AS-13 Safety, AS-05 Behavior/BPSD, AS-04 Cognition, AS-09 Communication.
    const concerns = careEntries.filter((e) => e.resId === rid && inDay(e.at) && ["AS-13", "AS-05", "AS-04", "AS-09"].includes(e.domain)).map((e) => `${careDomainLabel(e.domain)}: ${e.summary}`);
    const cog = adl.filter((l: Row) => ["cognition", "behavior"].includes(s(l.domain).toLowerCase())).map(adlLine);
    const bcAll = [...concerns, ...cog];
    if (bcAll.length) out.behaviorCognitive = bcAll.join(" ");

    // 6. Medication Issues
    const rMar = (marQ.data || []).filter((m) => s(m.residentId) === rid && inDay(m.scheduledTime || m.actualTime || m.createdAt));
    const medName = (m: Row) => { const rel = (m.medication || {}) as Row; return s(rel.name) || s(m.dosage) || "Medication"; };
    const issues = rMar.filter((m) => ["REFUSED", "HELD", "MISSED"].includes(s(m.status).toUpperCase()));
    if (issues.length) out.medicationIssues = issues.map((m) => `${cap(s(m.status).toLowerCase())}: ${medName(m)}${timeOf(m.scheduledTime) ? ` ${timeOf(m.scheduledTime)}` : ""}${s(m.reasonForRefusal || m.heldReason) ? ` — ${s(m.reasonForRefusal || m.heldReason)}` : ""}`).join("; ");
    else if (rMar.length) out.medicationIssues = "All scheduled doses given as ordered; no medication issues this shift.";

    // 7. Appointments & Orders
    const refs = (refQ.data || []).filter((r) => s(r.residentId) === rid && s(r.status).toUpperCase() !== "CANCELLED" && s(r.scheduledDate));
    if (refs.length) out.appointmentsOrders = refs.map((r) => { const d = new Date(s(r.scheduledDate)); const ds = isNaN(d.getTime()) ? "" : d.toLocaleDateString(); return `${s(r.facilityName) || "Appointment"}${s(r.reason) ? ` — ${s(r.reason)}` : ""}${ds ? ` (${ds})` : ""} · ${s(r.status)}`; }).join("; ");

    // 8. Incidents & Escalations
    const parts: string[] = [];
    (incQ.data || []).filter((i) => s(i.residentId) === rid && (inDay(i.incidentDate || i.createdAt) || !i.resolvedAt)).forEach((i) => parts.push(`Incident: ${s(i.incidentType).replace(/_/g, " ") || "event"}${i.resolvedAt ? " (resolved)" : " (open)"}${s(i.title) ? ` — ${s(i.title)}` : ""}`));
    (escQ.data || []).filter((x) => s(x.residentId) === rid && (inDay(x.createdAt) || !["RESOLVED", "CANCELLED"].includes(s(x.status).toUpperCase()))).forEach((x) => parts.push(`SBAR: ${s(x.situation).slice(0, 100)}${s(x.status).toUpperCase() === "RESOLVED" ? " (resolved)" : ""}`));
    if (parts.length) out.incidentsEscalations = parts.join(" ");

    return out;
  };

  // Which residents actually had a logged action this day — auto-fill is limited
  // to these, so a resident with no care logs / ADL / weight / vitals / events is
  // skipped entirely (never added with blank sections).
  const hasActivity = (rid: string, dateIso: string): boolean => {
    const dayStart = new Date(`${dateIso}T00:00:00`).getTime();
    const dayEnd = new Date(`${dateIso}T23:59:59`).getTime();
    const inDay = (v: unknown) => { const t = new Date(String(v)).getTime(); return !isNaN(t) && t >= dayStart && t <= dayEnd; };
    const dayStr = (v: unknown) => String(v).slice(0, 10) === dateIso;
    if (careEntries.some((e) => e.resId === rid && inDay(e.at))) return true;
    if (adlLogs.some((l: Row) => s(l.residentId) === rid && dayStr(l.date))) return true;
    if (weightLogs.some((l: Row) => s(l.residentId) === rid && l.weightKg != null && dayStr(l.date))) return true;
    if ((vitQ.data || []).some((v) => s(v.residentId) === rid && inDay(v.recordedAt || v.createdAt))) return true;
    if ((marQ.data || []).some((m) => s(m.residentId) === rid && ["GIVEN", "REFUSED", "HELD"].includes(s(m.status).toUpperCase()) && inDay(m.actualTime || m.scheduledTime || m.createdAt))) return true;
    if ((incQ.data || []).some((i) => s(i.residentId) === rid && inDay(i.incidentDate || i.createdAt))) return true;
    if ((escQ.data || []).some((x) => s(x.residentId) === rid && inDay(x.createdAt))) return true;
    return false;
  };

  // Pre-draft a carry-over item for a resident from their live shift data — the
  // remaining (pending / in-progress) tasks, open incidents & escalations, and any
  // ADL declines. Same scoping as everything else (only assigned residents for a
  // caregiver, since the picker is already scoped). Everything stays editable.
  const buildCarryOverDraft = (rid: string): CarryOverDraft => {
    const up = (v: unknown) => s(v).toUpperCase();
    const cap = (x: string) => (x ? x[0].toUpperCase() + x.slice(1) : x);
    const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
    const CAP = 8; // keep lists readable; care-plan tasks can number in the dozens
    const bullets = (a: string[]) => { const shown = a.slice(0, CAP); const more = a.length - shown.length; return shown.map((x) => `• ${x}`).join("\n") + (more > 0 ? `\n• +${more} more` : ""); };
    const tasks = (taskQ.data || []).filter((t) => s(t.residentId) === rid && ["PENDING", "IN_PROGRESS"].includes(up(t.status)));
    const incidents = (incQ.data || []).filter((i) => s(i.residentId) === rid && !i.resolvedAt);
    const escs = (escQ.data || []).filter((x) => s(x.residentId) === rid && !["RESOLVED", "CANCELLED"].includes(up(x.status)));
    const adlChanges = uniq(adlLogs.filter((l: Row) => s(l.residentId) === rid && (l.change === "Declined" || l.change === "Significant Decline")).map((l: Row) => `${cap(s(l.domain))} ${s(l.change).toLowerCase()}`));
    // Care-plan tasks repeat across shifts/AM-PM-NOC — collapse to distinct titles.
    const taskTitles = uniq(tasks.map((t) => s(t.title)));
    // Headline concern: notable clinical items first, then a concise task summary —
    // never a wall of every task/intervention (that lives in the care plan).
    const head: string[] = [];
    incidents.forEach((i) => head.push(`Open incident: ${(s(i.incidentType).replace(/_/g, " ") || "event")}${up(i.severity) ? ` (${cap(s(i.severity).toLowerCase())})` : ""}`));
    escs.forEach((x) => head.push(`Open escalation: ${s(x.situation).slice(0, 80)}`));
    if (adlChanges.length) head.push(`ADL change: ${adlChanges.join(", ")}`);
    if (taskTitles.length) head.push(`${taskTitles.length} pending care task${taskTitles.length === 1 ? "" : "s"} to continue`);
    const critical = escs.length > 0 || incidents.some((i) => ["CRITICAL", "SEVERE", "HIGH"].includes(up(i.severity)));
    return {
      concern: head.join("\n") || "No outstanding items this shift.",
      // Auto-fill leaves the specific handover action for the clinician — the care
      // plan holds the full intervention detail; a dump of it here is just noise.
      action: "",
      priority: critical ? "Urgent" : (tasks.some((t) => up(t.priority) === "HIGH") || incidents.length) ? "Important" : "Routine",
      status: escs.length ? "Escalated" : (tasks.length || incidents.length) ? "Watch" : "Stable",
      whatChanged: adlChanges.join("; "),
      pending: taskTitles.length ? bullets(taskTitles) : "",
      watchNext: uniq(escs.map((x) => s(x.situation).slice(0, 60))).join("; "),
    };
  };

  // Derived sign-off stats.
  const stats = useMemo(() => ({
    alerts: (incQ.data || []).filter((i) => !i.resolvedAt && inScope(s(i.residentId))).length,
    tasks: (taskQ.data || []).filter((t) => s(t.status) === "PENDING" && inScope(s(t.residentId))).length,
    adl: adlLogs.filter((l: Row) => (l.change === "Declined" || l.change === "Significant Decline") && inScope(s(l.residentId))).length,
    carry: active?.carryOvers.length ?? 0,
  }), [incQ.data, taskQ.data, adlLogs, active, scopedIds, clinicianRole]);

  const pendingCount = visibleItems.filter((e) => e.status !== "ACKNOWLEDGED").length;

  const filteredByRange = useMemo(() => {
    const today = new Date();
    return visibleItems.filter((e) => {
      const d = new Date(e.date + "T00:00:00");
      if (range === "today") return e.date === isoDate(today);
      const diff = (today.getTime() - d.getTime()) / 86_400_000;
      return range === "week" ? diff <= 7 && diff >= -1 : diff <= 31 && diff >= -1;
    });
  }, [visibleItems, range]);

  const grouped = useMemo(() => { const m = new Map<string, Endorsement[]>(); filteredByRange.forEach((e) => { const a = m.get(e.date); if (a) a.push(e); else m.set(e.date, [e]); }); return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])); }, [filteredByRange]);

  type EndorsementDraft = { shiftLabel: string; shiftRange: string; generalNotes?: string; medicationNotes?: string; aiSummary?: string };
  // Silent upsert used by the modal's auto-save + Save Draft: creates a PENDING
  // record on first save, updates it thereafter. Returns the record id so the
  // modal keeps writing to the same draft (no duplicates).
  const saveEndorsement = async (data: EndorsementDraft, id?: string): Promise<string> => {
    const existing = id ? items.find((e) => e.id === id) : undefined;
    if (existing) { await putEndorsement({ ...existing, ...data }); return existing.id; }
    const rec: Endorsement = { ...data, id: newId(), number: `#${2940000 + items.length + 1}`, date: isoDate(new Date()), outgoingBy: clinicianName, outgoingById: clinicianUserId, authorRole: clinicianRole, incomingBy: "(pending)", signedAt: nowTime(), status: "PENDING", residents: [], carryOvers: [], checklist: {}, createdAt: new Date().toISOString() };
    await putEndorsement(rec);
    return rec.id;
  };
  // Finalize (PIN-signed "Create Endorsement"): audit + close. The content was
  // already persisted via saveEndorsement, so this just records + dismisses.
  const finalizeEndorsement = (id: string, data: EndorsementDraft, edit = false) => {
    recordAudit({
      action: edit ? "UPDATE" : "CREATE",
      entityType: "shift-endorsements",
      entityId: id,
      reason: `${edit ? "Updated" : "Created"} shift endorsement — ${data.shiftLabel}${data.shiftRange ? ` (${data.shiftRange})` : ""}`,
    });
    setNewOpen(false); setEditing(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: edit ? "Endorsement updated" : "Endorsement created", showConfirmButton: false, timer: 1600 });
  };
  // Only the author (the nurse or caregiver who logged it) may edit/delete. The
  // Care Manager is oversight-only here — sees everything, modifies nothing.
  const canModify = (e: Endorsement) => clinicianRole !== "CARE_MANAGER" && (e.outgoingById ? clinicianUserId === e.outgoingById : clinicianName === e.outgoingBy);
  const deleteEndorsement = async (e: Endorsement) => {
    const c = await Swal.fire({ title: "Delete endorsement?", html: `Delete <b>${e.number}</b> (${e.shiftLabel})? This can't be undone.`, icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Delete" });
    if (!c.isConfirmed) return;
    await removeEndorsement(e.id);
    recordAudit({ action: "DELETE", entityType: "shift-endorsements", entityId: e.id, reason: `Deleted shift endorsement ${e.number} — ${e.shiftLabel}` });
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Endorsement deleted", showConfirmButton: false, timer: 1500 });
  };

  // ── Structured Details view ────────────────────────────────────────────────
  if (view === "details" && active) return <DetailsView e={active} residents={scopedResidents} resName={resName} onBack={() => setView("list")} update={update} buildSections={buildSections} hasActivity={hasActivity} canEdit={active.outgoingById ? clinicianUserId === active.outgoingById : clinicianName === active.outgoingBy} />;
  // ── Carry-Over & Sign-Off view ─────────────────────────────────────────────
  if (view === "carryover" && active) return <CarryOverView e={active} residents={scopedResidents} resName={resName} stats={stats} by={clinicianName} byId={clinicianUserId} onBack={() => setView("details")} update={update} buildHandover={buildHandover} acceptHandover={acceptHandover} buildCarryOverDraft={buildCarryOverDraft} />;

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? "" : "min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6"}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        {!embedded && <div><h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Shift Endorsements</h1><p className="text-sm text-slate-500 mt-1">{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div>}
        <button onClick={() => setNewOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 ml-auto"><Plus className="w-4 h-4" /> New Endorsement</button>
      </div>

      {pendingCount > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 mb-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5" />
          <div><p className="font-bold text-amber-800">{pendingCount} Pending Endorsement{pendingCount === 1 ? "" : "s"}</p><p className="text-sm text-amber-700">Awaiting incoming nurse acknowledgment</p></div>
        </div>
      )}

      <div className="flex items-center gap-5 border-b border-slate-200 mb-5">
        {([["today", "Today"], ["week", "This Week"], ["month", "This Month"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setRange(v)} className={`pb-2.5 text-sm font-semibold border-b-2 -mb-px ${range === v ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500"}`}>{label}</button>
        ))}
      </div>

      {grouped.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">No endorsements for this period.</div>
        : <div className="space-y-6">
            {grouped.map(([date, list]) => (
              <div key={date}>
                <p className="text-sm font-semibold text-slate-500 mb-2">{fmtDay(date)}</p>
                <div className="space-y-3">
                  {list.map((e) => (
                    <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${e.status === "ACKNOWLEDGED" ? "bg-green-100 text-green-700" : e.status === "SIGNED_OFF" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{e.status === "ACKNOWLEDGED" ? "Acknowledged" : e.status === "SIGNED_OFF" ? "Signed Off" : "Pending"}</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full border border-slate-200 text-slate-600">{e.shiftLabel} · {e.shiftRange}</span>
                      </div>
                      <p className="text-sm font-semibold text-slate-800 mt-2 flex items-center gap-1.5"><User className="w-4 h-4 text-slate-400" />{e.outgoingBy} → {e.incomingBy} <span className="font-normal text-slate-400 inline-flex items-center gap-1 ml-1"><Clock className="w-3.5 h-3.5" /> Signed {e.signedAt}</span></p>
                      {e.generalNotes && <div className="mt-2"><p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">General Notes</p><p className="text-sm text-slate-600 whitespace-pre-line line-clamp-4">{e.generalNotes}</p></div>}
                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        <button onClick={() => { setActiveId(e.id); setView("details"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileText className="w-4 h-4" /> Structured Details</button>
                        <button onClick={() => { setActiveId(e.id); setView("carryover"); }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ArrowLeftRight className="w-4 h-4" /> Carry-Over & Sign-Off</button>
                        {canModify(e) && e.status !== "ACKNOWLEDGED" && <button onClick={() => setEditing(e)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="w-4 h-4" /> Edit</button>}
                        {canModify(e) && <button onClick={() => deleteEndorsement(e)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /> Delete</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>}

      {(newOpen || editing) && <NewEndorsementModal existing={editing ?? undefined} onClose={() => { setNewOpen(false); setEditing(null); }} onSave={saveEndorsement} onDone={finalizeEndorsement} />}
    </div>
  );
}

// ── New Endorsement modal ────────────────────────────────────────────────────
function NewEndorsementModal({ existing, onClose, onSave, onDone }: { existing?: Endorsement; onClose: () => void; onSave: (d: { shiftLabel: string; shiftRange: string; generalNotes?: string; medicationNotes?: string; aiSummary?: string }, id?: string) => Promise<string>; onDone: (id: string, d: { shiftLabel: string; shiftRange: string }, edit?: boolean) => void }) {
  const isEdit = !!existing;
  const [shiftIdx, setShiftIdx] = useState(() => { const i = existing ? SHIFT_TYPES.findIndex((t) => t.label === existing.shiftLabel) : -1; return i >= 0 ? i : currentShiftIdx(); });
  const [general, setGeneral] = useState(existing?.generalNotes ?? "");
  const [med, setMed] = useState(existing?.medicationNotes ?? "");
  const [ai, setAi] = useState(existing?.aiSummary ?? "");
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false); // brief "Draft saved" confirmation
  const [aiLoading, setAiLoading] = useState(false);
  const [recapLoading, setRecapLoading] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const sh = SHIFT_TYPES[shiftIdx];
  // Id of the draft record once first saved — auto-save + Save Draft write to it.
  // In edit mode it starts as the existing record's id so writes update it.
  const draftIdRef = useRef<string | null>(existing?.id ?? null);
  const savingRef = useRef(false);
  const hasContent = () => !!(general.trim() || med.trim() || ai.trim());
  const draftData = () => ({ shiftLabel: sh.label, shiftRange: sh.range, generalNotes: general || undefined, medicationNotes: med || undefined, aiSummary: ai || undefined });
  const persistDraft = async () => {
    if (savingRef.current) return draftIdRef.current;
    savingRef.current = true;
    try { const id = await onSave(draftData(), draftIdRef.current ?? undefined); if (id) draftIdRef.current = id; return id; }
    finally { savingRef.current = false; }
  };
  // Debounced auto-save: persists the draft ~1s after typing stops, once there's
  // any content. Never blocks the UI; the record is PENDING until finalized.
  useEffect(() => {
    if (!hasContent()) return;
    const t = window.setTimeout(() => { void persistDraft(); }, 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [general, med, ai, shiftIdx]);
  // Flush the latest edits on unmount (e.g. accidental close) so nothing is lost.
  useEffect(() => () => { if (hasContent()) void persistDraft(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveDraft = async () => {
    if (!hasContent()) return;
    setSaving(true);
    try { await persistDraft(); setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1800); }
    finally { setSaving(false); }
  };
  const closeModal = () => { if (hasContent()) void persistDraft(); onClose(); };

  // Auto-fill the whole endorsement from what actually happened this shift — the
  // meds given, incidents filed, escalations raised, tasks completed, plus open
  // carry-over — then let Gemini draft the narrative. Reviewed before saving.
  const autofill = async () => {
    setRecapLoading(true);
    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shift-recap", shiftType: sh.label.toUpperCase().split(" ")[0], date: new Date().toISOString() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { Swal.fire({ title: "Couldn't pull your shift", text: data?.error || "Fill the endorsement manually or try again.", icon: "info" }); return; }
      const f = (data.fields ?? {}) as Record<string, unknown>;
      const gen = [f.residentUpdates, f.incidentsOccurred ? `Incidents: ${f.incidentDetails || "see incident log"}` : "", f.taskCompleted ? `Tasks: ${f.taskCompleted}` : "", f.handoverNotes ? `Carry-over: ${f.handoverNotes}` : ""].filter(Boolean).join("\n");
      if (gen) setGeneral(gen);
      if (f.medicationsAdministered) setMed(String(f.medicationsAdministered));
      if (data.summary) setAi(String(data.summary));
      Swal.fire({ toast: true, position: "top-end", icon: data.empty ? "info" : "success", showConfirmButton: false, timer: 3600, timerProgressBar: true, title: data.empty ? "No logged activity found for this shift — fill in anything manual." : "Pulled your shift activity — review and edit before saving." });
    } catch { Swal.fire({ title: "Couldn't pull your shift", text: "Network error — fill the endorsement manually.", icon: "info" }); }
    finally { setRecapLoading(false); }
  };
  const compose = () => `${sh.label} shift (${sh.range}) endorsement. ${general ? `Overall: ${general} ` : ""}${med ? `Medications: ${med} ` : ""}Handover completed; incoming shift to acknowledge outstanding items.`.trim();
  // Auto-fill the narrative with Gemini via the same /api/ai-assistant endpoint
  // the shift reports use; falls back to an editable local draft when AI is off.
  const generate = async () => {
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai-assistant", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "endorsement", shift: `${sh.label} (${sh.range})`, residentUpdates: general.trim(), medications: med.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.summary) setAi(String(data.summary).trim());
      else { setAi(compose()); Swal.fire({ toast: true, position: "top-end", icon: "info", showConfirmButton: false, timer: 3200, title: res.status === 403 ? "AI isn't enabled on your plan — used a draft you can edit." : "AI unavailable right now — used a draft you can edit." }); }
    } catch { setAi(compose()); }
    finally { setAiLoading(false); }
  };
  const submit = async () => { setSaving(true); try { const id = await persistDraft(); if (id) onDone(id, { shiftLabel: sh.label, shiftRange: sh.range }, isEdit); } finally { setSaving(false); } };
  const ta = "w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2 block";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg flex items-center gap-2"><FileText className="w-5 h-5" /> {isEdit ? "Edit Shift Endorsement" : "New Shift Endorsement"}</h2><button onClick={closeModal} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <button onClick={autofill} disabled={recapLoading} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:opacity-95 disabled:opacity-60"><Sparkles className="w-4 h-4" /> {recapLoading ? "Pulling your shift…" : "Auto-fill from my shift activity"}</button>
            <p className="text-xs text-slate-400 text-center mt-1.5">Pulls the meds you gave, incidents you filed, escalations you raised, tasks you completed &amp; open carry-over for this shift — then drafts the summary. Review before saving.</p>
          </div>
          <div><span className={lbl}>Shift Type</span>
            <div className="grid grid-cols-3 gap-2">
              {SHIFT_TYPES.map((t, i) => <button key={t.label} onClick={() => setShiftIdx(i)} className={`px-2 py-2.5 rounded-xl text-center border ${shiftIdx === i ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-300"}`}><span className="block text-sm font-semibold">{t.label}</span><span className={`block text-[11px] ${shiftIdx === i ? "text-white/80" : "text-slate-400"}`}>{t.range}</span></button>)}
            </div>
          </div>
          <div><span className={lbl}>General Notes</span><textarea rows={2} value={general} onChange={(e) => setGeneral(e.target.value)} placeholder="Overall shift observations, incidents, concerns…" className={ta} /></div>
          <div><span className={lbl}>Medication Notes</span><textarea rows={2} value={med} onChange={(e) => setMed(e.target.value)} placeholder="PRN medications given, missed doses, reactions…" className={ta} /></div>
          <div>
            <div className="flex items-center justify-between mb-2"><span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">AI Narrative Summary</span><button onClick={generate} disabled={aiLoading} className="inline-flex items-center gap-1 text-xs font-semibold text-purple-600 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 disabled:opacity-60"><Sparkles className="w-3.5 h-3.5" /> {aiLoading ? "Generating…" : "Generate with AI"}</button></div>
            <textarea rows={3} value={ai} onChange={(e) => setAi(e.target.value)} placeholder="AI-generated narrative will appear here, or type manually…" className={ta} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={closeModal} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={saveDraft} disabled={saving || !hasContent()} title="Save what you've entered without finalizing — auto-saves as you type" className="px-4 py-2 rounded-xl text-sm font-semibold text-blue-700 border border-blue-200 hover:bg-blue-50 disabled:opacity-50">{savedTick ? "Draft saved ✓" : "Save Draft"}</button>
          <button onClick={() => (isEdit ? submit() : setSignOpen(true))} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : isEdit ? "Save Changes" : "Create Endorsement"}</button>
        </div>
      </div>
      <SignatureModal open={signOpen} onClose={() => setSignOpen(false)} onSigned={submit} title="Sign shift endorsement" description="Enter your 4-digit signing PIN to sign off and create this endorsement." />
    </div>
  );
}

// ── Structured Details view ──────────────────────────────────────────────────
function DetailsView({ e, residents, resName, onBack, update, buildSections, hasActivity, canEdit }: { e: Endorsement; residents: Row[]; resName: (id: string) => { name: string; room: string }; onBack: () => void; update: (id: string, patch: (e: Endorsement) => Endorsement) => Promise<void>; buildSections: (rid: string, dateIso: string) => Record<string, string>; hasActivity: (rid: string, dateIso: string) => boolean; canEdit: boolean }) {
  const [openKey, setOpenKey] = useState<string>("");
  const [filling, setFilling] = useState(false);
  // Add-resident capture — a designed modal with a styled <select> replaces the
  // bare Swal select prompt.
  const [addOpen, setAddOpen] = useState(false);
  const [addSel, setAddSel] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const addResident = () => {
    const existing = new Set(e.residents.map((r) => r.residentId));
    const opts = residents.filter((r: Row) => !existing.has(s(r.id)));
    if (!opts.length) { Swal.fire({ title: "All residents added", icon: "info" }); return; }
    setAddSel(""); setAddOpen(true);
  };
  const submitAddResident = async () => {
    if (!addSel) return;
    setAddBusy(true);
    try {
      // Pre-draft the added resident's sections from the shift's live care data.
      await update(e.id, (en) => ({ ...en, residents: [...en.residents, { residentId: addSel, sections: buildSections(addSel, e.date) }] }));
      setAddOpen(false);
    } finally { setAddBusy(false); }
  };
  // Auto-fill every resident who logged care this shift: ADD those not yet on the
  // endorsement, AND draft already-added residents whose sections are still empty
  // (never overwriting section text that's already been written — use the per-row
  // re-fill for that).
  const autoFillAll = async () => {
    const byId = new Map(e.residents.map((r) => [r.residentId, r]));
    const isEmpty = (r?: EndResident) => !r || !Object.values(r.sections || {}).some((v) => (v || "").trim());
    const active = residents.filter((r: Row) => hasActivity(s(r.id), e.date));
    const toAdd = active.filter((r: Row) => !byId.has(s(r.id)));
    const toFill = active.filter((r: Row) => byId.has(s(r.id)) && isEmpty(byId.get(s(r.id))));
    const total = toAdd.length + toFill.length;
    if (!total) { Swal.fire({ title: "Nothing to auto-fill", text: "No residents with logged care this shift need drafting — added residents already have section notes (use a row's re-fill to redraft).", icon: "info" }); return; }
    const c = await Swal.fire({ title: "Auto-fill from shift data?", html: `Draft <b>${total}</b> resident(s) who logged care this shift${toAdd.length ? ` (${toAdd.length} added)` : ""} from their vitals, care logs, ADL, medications, wounds, incidents & escalations. Section text you've already written is kept.`, icon: "question", showCancelButton: true, confirmButtonColor: "#2563eb", confirmButtonText: "Auto-fill" });
    if (!c.isConfirmed) return;
    setFilling(true);
    try {
      const fillIds = new Set(toFill.map((r: Row) => s(r.id)));
      await update(e.id, (en) => ({
        ...en,
        residents: [
          ...en.residents.map((r) => (fillIds.has(r.residentId) ? { ...r, sections: buildSections(r.residentId, e.date) } : r)),
          ...toAdd.map((r: Row) => ({ residentId: s(r.id), sections: buildSections(s(r.id), e.date) })),
        ],
      }));
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Drafted ${total} resident(s)`, showConfirmButton: false, timer: 1800 });
    } finally { setFilling(false); }
  };
  // Re-draft one resident's sections from the data (overwrites the current text).
  const refillResident = async (rid: string) => {
    const c = await Swal.fire({ title: "Re-fill from shift data?", text: "This replaces this resident's section text with a fresh draft from the live care data.", icon: "warning", showCancelButton: true, confirmButtonColor: "#2563eb", confirmButtonText: "Re-fill" });
    if (!c.isConfirmed) return;
    await update(e.id, (en) => ({ ...en, residents: en.residents.map((r) => (r.residentId === rid ? { ...r, sections: buildSections(rid, e.date) } : r)) }));
  };
  const setSection = async (rid: string, key: string, text: string) => update(e.id, (en) => ({ ...en, residents: en.residents.map((r) => (r.residentId === rid ? { ...r, sections: { ...r.sections, [key]: text } } : r)) }));

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 mt-1"><ArrowLeft className="w-4 h-4" /> Back</button>
          <div><h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">Structured Endorsement Details{!canEdit && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 align-middle">View only</span>}</h1><p className="text-sm text-slate-500">Endorsement {e.number} — Per-resident clinical sections</p></div>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={autoFillAll} disabled={filling} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-blue-200 bg-white text-blue-700 text-sm font-semibold hover:bg-blue-50 disabled:opacity-60"><Sparkles className="w-4 h-4" /> {filling ? "Filling…" : "Auto-fill from shift data"}</button>
            <button onClick={addResident} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Resident</button>
          </div>
        ) : (
          <span className="text-xs text-slate-400">Only {e.outgoingBy || "the logging clinician"} can edit this endorsement.</span>
        )}
      </div>

      {e.residents.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">{canEdit ? <>No residents added yet. Click <b>Auto-fill from shift data</b> or <b>Add Resident</b> to document per-resident sections.</> : "No residents have been documented on this endorsement yet."}</div>
        : <div className="space-y-4">
            {e.residents.map((r) => {
              const rn = resName(r.residentId);
              const hasConcerns = CONCERN_SECTIONS.some((k) => (r.sections[k] || "").trim());
              return (
                <div key={r.residentId} className={`rounded-2xl border overflow-hidden ${hasConcerns ? "border-amber-200" : "border-slate-200"}`}>
                  <div className={`flex items-center justify-between gap-2 px-4 py-3 ${hasConcerns ? "bg-amber-50/60" : "bg-slate-50/60"}`}>
                    <div className="flex items-center gap-2.5"><span className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center"><User className="w-4 h-4 text-blue-500" /></span><div><p className="font-bold text-slate-900 flex items-center gap-2">{rn.name}{hasConcerns && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Has Concerns</span>}</p><p className="text-xs text-slate-400">Room {rn.room}</p></div></div>
                    <div className="flex items-center gap-1">
                      {canEdit && <button onClick={() => refillResident(r.residentId)} title="Re-fill from shift data" className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 hover:text-blue-600"><Sparkles className="w-4 h-4" /></button>}
                      {canEdit && <button onClick={() => update(e.id, (en) => ({ ...en, residents: en.residents.filter((x) => x.residentId !== r.residentId) }))} className="p-1.5 rounded-lg hover:bg-white/60 text-slate-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {SECTIONS.map((sec) => { const Icon = sec.icon; const id = `${r.residentId}:${sec.key}`; const open = openKey === id; const val = r.sections[sec.key] || ""; return (
                      <div key={sec.key}>
                        <button onClick={() => setOpenKey(open ? "" : id)} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-slate-50/60">
                          <Icon className={`w-4 h-4 ${sec.color}`} /><span className="text-sm font-semibold text-slate-800 flex-1 text-left">{sec.label}</span>
                          {val.trim() && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">1</span>}
                          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </button>
                        {open && <div className="px-4 pb-3">{canEdit ? <textarea rows={2} defaultValue={val} onBlur={(ev) => { if (ev.target.value !== val) setSection(r.residentId, sec.key, ev.target.value); }} placeholder={`${sec.label} notes for this shift…`} className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /> : <p className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-sm text-slate-700 whitespace-pre-wrap min-h-[2.5rem]">{val || <span className="text-slate-400">No notes.</span>}</p>}</div>}
                      </div>
                    ); })}
                  </div>
                </div>
              );
            })}
          </div>}

      {addOpen && (() => {
        const existing = new Set(e.residents.map((r) => r.residentId));
        const opts = residents.filter((r: Row) => !existing.has(s(r.id)));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-3" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) setAddOpen(false); }}>
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900"><User className="h-5 w-5" /> Add resident</h2>
                <button onClick={() => setAddOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4 p-5">
                <p className="text-sm text-slate-500">Pick a resident to document on this endorsement — their eight sections are pre-drafted from this shift&apos;s live care data.</p>
                <div>
                  <label htmlFor="add-resident-sel" className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-slate-400">Resident</label>
                  <select id="add-resident-sel" autoFocus value={addSel} onChange={(ev) => setAddSel(ev.target.value)} className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
                    <option value="">Select resident…</option>
                    {opts.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <button onClick={() => setAddOpen(false)} disabled={addBusy} className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button onClick={submitAddResident} disabled={addBusy || !addSel} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Plus className="h-4 w-4" /> {addBusy ? "Adding…" : "Add resident"}</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Carry-Over & Sign-Off view ───────────────────────────────────────────────
function CarryOverView({ e, residents, resName, stats, by, byId, onBack, update, buildHandover, acceptHandover, buildCarryOverDraft }: {
  e: Endorsement; residents: Row[]; resName: (id: string) => { name: string; room: string }; stats: { alerts: number; tasks: number; adl: number; carry: number }; by: string; byId: string; onBack: () => void; update: (id: string, patch: (e: Endorsement) => Endorsement) => Promise<void>; buildHandover: () => Handover; acceptHandover: (e: Endorsement) => Promise<void>; buildCarryOverDraft: (rid: string) => CarryOverDraft;
}) {
  // Only the user who LOGGED the endorsement may sign it off. Everyone else can
  // only acknowledge — and only once it has been signed off.
  const signed = e.status === "SIGNED_OFF" || e.status === "ACKNOWLEDGED";
  const acknowledged = e.status === "ACKNOWLEDGED";
  const isOutgoing = e.outgoingById ? byId === e.outgoingById : by === e.outgoingBy;
  const canEdit = isOutgoing && !signed; // outgoing owns carry-over + checklist until sign-off
  const [addOpen, setAddOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);
  // Local, optimistic checklist so a tick reflects instantly — the persist +
  // realtime refetch round-trip otherwise makes the checkbox feel laggy. Re-syncs
  // whenever a different endorsement is opened.
  const [checklist, setChecklist] = useState<Record<string, boolean>>(e.checklist || {});
  // Render-phase reset (React-recommended, no effect cascade): re-seed the local
  // checklist whenever a different endorsement is opened.
  const [seenId, setSeenId] = useState(e.id);
  if (seenId !== e.id) { setSeenId(e.id); setChecklist(e.checklist || {}); }
  const allChecked = CHECKLIST.every((c) => checklist[c.key]);
  const addItem = async (c: Omit<CarryOver, "id">) => {
    await update(e.id, (en) => ({ ...en, carryOvers: [...en.carryOvers, { ...c, id: newId() }] }));
    if (c.autoTask) createRecord("tasks", { residentId: c.residentId, title: `Carry-over: ${c.concern.slice(0, 60)}`, description: c.action || c.concern, status: "PENDING", priority: c.priority === "Urgent" ? "HIGH" : "MEDIUM", category: "Observation" }).catch(() => null);
    setAddOpen(false);
  };
  // Gate the sign-off behind the 4-digit signing PIN; the actual write happens in
  // doSignOff once the PIN is verified.
  const requestSignOff = () => { if (!allChecked) { Swal.fire({ title: "Complete the checklist", text: "Review all four items before signing off.", icon: "warning" }); return; } setSignOpen(true); };
  // Sign-off freezes a handover snapshot (pending tasks + open incidents) onto the endorsement.
  const doSignOff = async () => { await update(e.id, (en) => ({ ...en, status: "SIGNED_OFF", signedAt: nowTime(), outgoingBy: by, handover: buildHandover() })); setSignOpen(false); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Signed off", showConfirmButton: false, timer: 1500 }); };
  // Acknowledge stamps acceptance AND puts the carry-overs on the incoming user's account.
  const doAcknowledge = async () => { await update(e.id, (en) => ({ ...en, status: "ACKNOWLEDGED", incomingBy: by, acceptedBy: by, acceptedById: byId, acceptedAt: new Date().toISOString() })); await acceptHandover(e); setAckOpen(false); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Acknowledged — carry-overs added to your tasks", showConfirmButton: false, timer: 1800 }); };
  // Close-state disposition (§12): once the endorsement is signed, either party
  // records how each carry-over ended — Resolved / Continue Monitoring /
  // Action Next Shift / Awaiting External Response.
  const setCloseState = async (cid: string, closeState: CloseState | "") => {
    await update(e.id, (en) => ({ ...en, carryOvers: en.carryOvers.map((c) => (c.id === cid ? { ...c, closeState: closeState || undefined, closedAt: closeState ? new Date().toISOString() : undefined, closedBy: closeState ? by : undefined } : c)) }));
  };
  const toggle = (k: string) => { const next = { ...checklist, [k]: !checklist[k] }; setChecklist(next); void update(e.id, (en) => ({ ...en, checklist: next })); };

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-5">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900 mt-1"><ArrowLeft className="w-4 h-4" /> Back to Details</button>
        <div><h1 className="text-2xl font-bold text-slate-900">Carry-Over &amp; Sign-Off</h1><p className="text-sm text-slate-500">Endorsement {e.number}</p></div>
      </div>

      <div className="flex items-center justify-between mb-3"><p className="font-bold text-slate-900 flex items-center gap-2"><ArrowLeftRight className="w-5 h-5 text-blue-500" /> Carry-Over to Next Shift</p>{canEdit && <button onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Item</button>}</div>
      {e.carryOvers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center mb-6">
          <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50"><ClipboardList className="h-5 w-5 text-blue-500" /></span>
          <p className="font-semibold text-slate-700">No carry-over items.</p>
          <p className="text-sm text-slate-400 mt-1">Add concerns that need to continue into the next shift.</p>
        </div>
      ) : <div className="space-y-2 mb-6">{e.carryOvers.map((c) => { const rn = resName(c.residentId); return (
            <div key={c.id} className={`rounded-xl border bg-white p-4 ${c.closeState ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
              <div className="flex flex-wrap items-center gap-2"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${c.priority === "Urgent" ? "bg-red-100 text-red-700" : c.priority === "Important" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{c.priority}</span>{c.status && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_CLS[c.status] ?? "bg-slate-100 text-slate-600"}`}>{c.status}</span>}<span className="font-bold text-slate-900">{rn.name}</span><span className="text-xs text-slate-400">Rm {rn.room} · {c.role}{c.dueTime ? ` · due ${c.dueTime}` : ""}</span>{canEdit && <button onClick={() => update(e.id, (en) => ({ ...en, carryOvers: en.carryOvers.filter((x) => x.id !== c.id) }))} className="ml-auto p-1 rounded hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>}</div>
              <p className={`text-sm mt-1.5 whitespace-pre-line ${c.closeState === "Resolved" ? "text-slate-400 line-through" : "text-slate-700"}`}>{c.concern}</p>
              {c.whatChanged && <p className="text-xs text-slate-500 mt-0.5">What changed: {c.whatChanged}</p>}
              {c.action && <p className="text-xs text-slate-500 mt-0.5">Action: {c.action}</p>}
              {c.pending && <p className="text-xs text-slate-500 mt-0.5 whitespace-pre-line">Pending:{"\n"}{c.pending}</p>}
              {c.watchNext && <p className="text-xs text-blue-600/90 mt-0.5">Watch next shift: {c.watchNext}</p>}
              {c.coverageNote && <p className="text-xs text-slate-500 mt-0.5 italic">Coverage: {c.coverageNote}</p>}
              {(e.status !== "PENDING") && (
                <div className="flex flex-wrap items-center gap-2 mt-3 pt-2.5 border-t border-slate-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Close state</span>
                  <select
                    value={c.closeState || ""}
                    onChange={(ev) => setCloseState(c.id, ev.target.value as CloseState | "")}
                    className={`text-xs font-semibold rounded-lg border px-2 py-1 outline-none focus:ring-2 focus:ring-blue-400/40 ${c.closeState ? CLOSE_CLS[c.closeState] : "border-slate-200 text-slate-500"}`}
                  >
                    <option value="">Open — not closed yet</option>
                    {CLOSE_STATES.map((cs) => <option key={cs} value={cs}>{cs}</option>)}
                  </select>
                  {c.closeState && c.closedBy && <span className="text-[11px] text-slate-400">by {c.closedBy}</span>}
                </div>
              )}
            </div>
          ); })}</div>}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <p className="font-bold text-slate-900 flex items-center gap-2 mb-1"><ShieldCheck className="w-5 h-5 text-green-500" /> Shift Sign-Off Checklist</p>
        <p className="text-sm text-slate-500 mb-4">Before signing off, the outgoing shift must review all pending items. The incoming shift must acknowledge receipt.</p>
        <div className="grid grid-cols-2 gap-3 mb-5">
          <EndStat n={stats.alerts} label="Unresolved Alerts" cls="bg-red-50 border-red-100" color="text-red-700" />
          <EndStat n={stats.tasks} label="Pending Tasks" cls="bg-yellow-50 border-yellow-100" color="text-amber-700" />
          <EndStat n={stats.adl} label="ADL Declines" cls="bg-green-50 border-green-100" color="text-green-700" />
          <EndStat n={stats.carry} label="Unresolved Carry-Overs" cls="bg-orange-50 border-orange-100" color="text-orange-600" />
        </div>
        <div className="space-y-2 mb-5">
          {CHECKLIST.map((c) => { const on = !!checklist[c.key]; return (
            <button key={c.key} onClick={() => toggle(c.key)} disabled={!canEdit} className="w-full flex items-start gap-3 text-left rounded-xl p-2 transition hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent">
              <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 transition ${on ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
              <span><span className="block text-sm font-semibold text-slate-800">{c.label}</span><span className="block text-xs text-amber-600/80">{c.desc}</span></span>
            </button>
          ); })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {isOutgoing ? (
            signed ? (
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="w-4 h-4" /> You signed off{acknowledged ? " · acknowledged by incoming shift" : " · awaiting incoming acknowledgement"}</span>
            ) : (
              <button onClick={requestSignOff} disabled={!allChecked} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-40"><CheckCircle2 className="w-4 h-4" /> Sign Off (Outgoing)</button>
            )
          ) : acknowledged ? (
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700"><CheckCircle2 className="w-4 h-4" /> Acknowledged</span>
          ) : (
            <>
              <button onClick={() => setAckOpen(true)} disabled={!signed} title={!signed ? "Awaiting the outgoing shift's sign-off" : undefined} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"><Check className="w-4 h-4" /> Acknowledge (Incoming)</button>
              {!signed && <span className="text-xs text-slate-400">Awaiting sign-off from {e.outgoingBy || "the outgoing shift"} — acknowledgement unlocks once signed.</span>}
            </>
          )}
        </div>
      </div>

      {addOpen && <AddCarryOverModal residents={residents} onClose={() => setAddOpen(false)} onAdd={addItem} buildDraft={buildCarryOverDraft} />}
      <SignatureModal open={signOpen} onClose={() => setSignOpen(false)} onSigned={doSignOff} title="Sign off shift endorsement" description="Enter your 4-digit signing PIN to sign off this shift." />
      <SignatureModal open={ackOpen} onClose={() => setAckOpen(false)} onSigned={doAcknowledge} title="Acknowledge shift endorsement" description="Enter your 4-digit signing PIN to acknowledge receipt of this shift endorsement." />
    </div>
  );
}

function EndStat({ n, label, cls, color }: { n: number; label: string; cls: string; color: string }) {
  return <div className={`rounded-2xl border p-5 text-center ${cls}`}><p className={`text-3xl font-bold ${color}`}>{n}</p><p className={`text-sm mt-1 ${color}`}>{label}</p></div>;
}

function AddCarryOverModal({ residents, onClose, onAdd, buildDraft }: { residents: Row[]; onClose: () => void; onAdd: (c: Omit<CarryOver, "id">) => Promise<void>; buildDraft: (rid: string) => CarryOverDraft }) {
  const [residentId, setResidentId] = useState("");
  const [concern, setConcern] = useState("");
  const [priority, setPriority] = useState("Routine");
  const [role, setRole] = useState("Nurse");
  const [dueTime, setDueTime] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState<ItemStatus>("Watch");
  const [whatChanged, setWhatChanged] = useState("");
  const [pending, setPending] = useState("");
  const [watchNext, setWatchNext] = useState("");
  const [coverageNote, setCoverageNote] = useState("");
  const [autoTask, setAutoTask] = useState(false);
  const [autoAlert, setAutoAlert] = useState(false);
  const [saving, setSaving] = useState(false);
  const submit = async () => { if (!residentId || !concern.trim()) { Swal.fire({ title: "Resident and concern are required", icon: "warning" }); return; } setSaving(true); try { await onAdd({ residentId, concern: concern.trim(), priority, role, dueTime: dueTime || undefined, action: action || undefined, status, whatChanged: whatChanged.trim() || undefined, pending: pending.trim() || undefined, watchNext: watchNext.trim() || undefined, coverageNote: coverageNote.trim() || undefined, autoTask, autoAlert }); } finally { setSaving(false); } };
  // Pull the resident's remaining tasks + open incidents/escalations + ADL changes
  // into the form. Auto-runs the first time a resident is picked (only fills blank
  // fields, so it never clobbers what the caregiver typed) and re-runs on demand.
  const applyDraft = (rid: string, force = false) => {
    if (!rid) return;
    const d = buildDraft(rid);
    if (force || !concern.trim()) setConcern(d.concern);
    if (force || !action.trim()) setAction(d.action);
    if (force || !whatChanged.trim()) setWhatChanged(d.whatChanged);
    if (force || !pending.trim()) setPending(d.pending);
    if (force || !watchNext.trim()) setWatchNext(d.watchNext);
    if (force) { setPriority(d.priority); setStatus(d.status); }
    else { if (priority === "Routine") setPriority(d.priority); if (status === "Watch") setStatus(d.status); }
    if (d.concern || d.action) Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Pulled from shift data — review and edit.", showConfirmButton: false, timer: 2200 });
    else Swal.fire({ toast: true, position: "top-end", icon: "info", title: "No open tasks or events for this resident.", showConfirmButton: false, timer: 2200 });
  };
  const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 block";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">Add Carry-Over Item</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div>
            <button onClick={() => residentId ? applyDraft(residentId, true) : Swal.fire({ title: "Select a resident first", icon: "info" })} className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-semibold hover:opacity-95"><Sparkles className="w-4 h-4" /> Auto-fill from shift data</button>
            <p className="text-xs text-slate-400 text-center mt-1.5">Pulls the resident&apos;s remaining tasks, open incidents &amp; escalations, and ADL changes into the form. Review before saving.</p>
          </div>
          <div><span className={lbl}>Resident</span><select value={residentId} onChange={(e) => { const v = e.target.value; setResidentId(v); applyDraft(v); }} className={inp}><option value="">Select resident…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}</select></div>
          <div><span className={lbl}>Concern / Task to Carry Over</span><textarea rows={2} value={concern} onChange={(e) => setConcern(e.target.value)} placeholder="Describe what needs to continue into the next shift…" className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>Priority</span><select value={priority} onChange={(e) => setPriority(e.target.value)} className={inp}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
            <div><span className={lbl}>Current Status</span><select value={status} onChange={(e) => setStatus(e.target.value as ItemStatus)} className={inp}>{ITEM_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select></div>
          </div>
          <div><span className={lbl}>Responsible Role</span><select value={role} onChange={(e) => setRole(e.target.value)} className={inp}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div><span className={lbl}>Due Time (Optional)</span><input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={inp} /></div>
          <div><span className={lbl}>Required Action</span><textarea rows={2} value={action} onChange={(e) => setAction(e.target.value)} placeholder="What specifically needs to be done…" className={inp} /></div>
          <div><span className={lbl}>What Changed This Shift (Optional)</span><textarea rows={2} value={whatChanged} onChange={(e) => setWhatChanged(e.target.value)} placeholder="How this differs from the resident's prior baseline…" className={inp} /></div>
          <div><span className={lbl}>Still Pending (Optional)</span><textarea rows={2} value={pending} onChange={(e) => setPending(e.target.value)} placeholder="What remains outstanding…" className={inp} /></div>
          <div><span className={lbl}>Watch Next Shift (Optional)</span><textarea rows={2} value={watchNext} onChange={(e) => setWatchNext(e.target.value)} placeholder="What the incoming shift should keep an eye on…" className={inp} /></div>
          <div><span className={lbl}>Caregiver / Coverage Note (Optional)</span><textarea rows={2} value={coverageNote} onChange={(e) => setCoverageNote(e.target.value)} placeholder="Staffing constraints, who covered this before, special competencies…" className={inp} /></div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-2">
            <button onClick={() => setAutoTask((v) => !v)} className="flex items-center gap-2.5 text-sm text-slate-700"><span className={`w-5 h-5 rounded border flex items-center justify-center ${autoTask ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{autoTask && <Check className="w-3.5 h-3.5" />}</span>Auto-create clinical task</button>
            <button onClick={() => setAutoAlert((v) => !v)} className="flex items-center gap-2.5 text-sm text-slate-700"><span className={`w-5 h-5 rounded border flex items-center justify-center ${autoAlert ? "bg-blue-600 border-blue-600 text-white" : "border-slate-300"}`}>{autoAlert && <Check className="w-3.5 h-3.5" />}</span>Auto-create alert</button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100"><button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button><button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Adding…" : "Add Carry-Over"}</button></div>
      </div>
    </div>
  );
}
