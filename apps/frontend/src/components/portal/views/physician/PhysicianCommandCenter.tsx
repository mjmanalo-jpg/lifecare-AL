"use client";

import RefreshButton from "@/components/portal/RefreshButton";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Stethoscope, Activity, Pill, AlertTriangle, PenTool, ClipboardCheck,
  HeartPulse, MessageSquare, BellRing, CheckSquare, Users, ChevronRight,
  Signature, Siren, Bandage, Target, FolderOpen, PieChart,
  Accessibility, Scale, FileText, Package, Cross, NotebookPen, History,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

/**
 * Physician Command Center — the medical-authority cockpit. Unlike the nurse's
 * operational dashboard, this consolidates every care-team perspective (patient
 * self-reports, family messages, nurse notes, caregiver task logs, vitals,
 * incidents, med adherence) into a single triage view and surfaces the actions
 * only a physician can take (approve orders, diagnose, co-sign, set directives).
 * Fully live via Supabase realtime + polling.
 */

type Row = Record<string, unknown>;
const asStr = (v: unknown): string => (v == null ? "" : String(v));

function isAbnormal(type: string, value: string): boolean {
  const n = parseFloat(value);
  switch (type) {
    case "HEART_RATE": return !isNaN(n) && (n < 60 || n > 100);
    case "OXYGEN": return !isNaN(n) && n < 95;
    case "TEMPERATURE": return !isNaN(n) && n > 37.5;
    case "RESPIRATORY_RATE": return !isNaN(n) && (n < 12 || n > 20);
    case "BLOOD_GLUCOSE": return !isNaN(n) && (n < 70 || n > 180);
    case "BLOOD_PRESSURE": { const sys = parseInt(value, 10); return !isNaN(sys) && (sys >= 140 || sys < 90); }
    default: return false;
  }
}

// Note types a physician authors/owns — everything else is care-team documentation
// (nurse/caregiver) that the physician reviews & co-signs.
const PHYSICIAN_NOTE_TYPES = new Set(["DIAGNOSIS", "DIRECTIVE", "CONSULTATION", "REFERRAL", "CARE_PLAN"]);

function relTime(iso: string, nowTs: number): string {
  if (!iso || !nowTs) return "";
  const m = Math.round((nowTs - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m ago` : `${h}h ago`;
  return h % 24 ? `${Math.floor(h / 24)}d ${h % 24}h ago` : `${Math.floor(h / 24)}d ago`;
}

export default function PhysicianCommandCenter() {
  const router = useRouter();
  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const vitalsQ = useLiveQuery<Row>("vitals", { query: "include=resident&take=500", tables: ["VitalsLog"] });
  const medsQ = useLiveQuery<Row>("medications", { query: "include=resident&take=500", tables: ["Medication"] });
  const incidentsQ = useLiveQuery<Row>("incidents", { query: "include=resident&take=300", tables: ["Incident"] });
  const notesQ = useLiveQuery<Row>("medical-notes", { query: "take=400", tables: ["MedicalNote"] });
  const messagesQ = useLiveQuery<Row>("messages", { query: "include=sender&take=200", tables: ["Message"] });
  const tasksQ = useLiveQuery<Row>("tasks", { query: "include=resident&take=300", tables: ["Task"] });
  const callBellsQ = useLiveQuery<Row>("call-bells", { query: "include=resident&take=200", tables: ["CallBell"] });
  const escalationsQ = useLiveQuery<Row>("escalations", { query: "take=200", tables: ["Escalation"] });

  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { const tick = () => setNowTs(Date.now()); tick(); const t = setInterval(tick, 60_000); return () => clearInterval(t); }, []);

  const refreshAll = () => {
    residentsQ.refetch(); vitalsQ.refetch(); medsQ.refetch(); incidentsQ.refetch();
    notesQ.refetch(); messagesQ.refetch(); tasksQ.refetch(); callBellsQ.refetch();
    escalationsQ.refetch();
  };

  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);

  // Latest vital per (resident,type) → abnormal flag per resident.
  const abnormalByResident = useMemo(() => {
    const latest = new Map<string, Map<string, { value: string; at: number }>>();
    vitalsQ.data.forEach((row) => {
      const rid = asStr(row.residentId); if (!rid) return;
      const type = asStr(row.type); const value = asStr(row.value);
      const at = row.recordedAt ? new Date(String(row.recordedAt)).getTime() : 0;
      const m = latest.get(rid) ?? new Map();
      const cur = m.get(type);
      if (!cur || at >= cur.at) m.set(type, { value, at });
      latest.set(rid, m);
    });
    const flags = new Map<string, string[]>();
    latest.forEach((m, rid) => {
      const bad: string[] = [];
      m.forEach((v, type) => { if (isAbnormal(type, v.value)) bad.push(`${type.replace(/_/g, " ")} ${v.value}`); });
      if (bad.length) flags.set(rid, bad);
    });
    return flags;
  }, [vitalsQ.data]);

  const openIncidentByResident = useMemo(() => {
    const m = new Map<string, number>();
    incidentsQ.data.forEach((row) => {
      if (row.resolvedAt) return;
      const rid = asStr(row.residentId); if (!rid) return;
      m.set(rid, (m.get(rid) ?? 0) + 1);
    });
    return m;
  }, [incidentsQ.data]);

  // Patients needing physician attention (abnormal vitals or open incidents).
  const attention = useMemo(() => residents
    .map((r) => ({
      id: r.id, name: r.name, room: r.room, careLevel: r.careLevel,
      abnormal: abnormalByResident.get(r.id) ?? [],
      openIncidents: openIncidentByResident.get(r.id) ?? 0,
    }))
    .filter((r) => r.abnormal.length > 0 || r.openIncidents > 0)
    .sort((a, b) => (b.abnormal.length + b.openIncidents) - (a.abnormal.length + a.openIncidents)),
  [residents, abnormalByResident, openIncidentByResident]);

  // Pending physician actions.
  const pendingOrders = useMemo(() => medsQ.data.filter((m) => asStr(m.status) === "PENDING"), [medsQ.data]);
  const unsignedNotes = useMemo(() => notesQ.data.filter((n) =>
    !PHYSICIAN_NOTE_TYPES.has(asStr(n.noteType)) && asStr(n.noteType) !== "MEDICATION_ADMIN" && !n.coSignedBy), [notesQ.data]);
  const openEscalations = useMemo(() => escalationsQ.data.filter((e) => !["RESOLVED", "CANCELLED"].includes(asStr(e.status))), [escalationsQ.data]);

  const stats = useMemo(() => ({
    patients: residents.length,
    needReview: attention.length,
    pendingOrders: pendingOrders.length,
    openIncidents: incidentsQ.data.filter((i) => !i.resolvedAt).length,
    unsigned: unsignedNotes.length,
  }), [residents, attention, pendingOrders, incidentsQ.data, unsignedNotes]);

  // Cross-role activity feed — merge nurse notes, caregiver tasks, family/nurse
  // messages, call bells, incidents into one physician-facing timeline.
  const feed = useMemo(() => {
    const nameById = new Map(residents.map((r) => [r.id, r.name]));
    type Ev = { id: string; icon: LucideIcon; color: string; source: string; text: string; at: string };
    const evs: Ev[] = [];
    notesQ.data.forEach((n) => evs.push({
      id: `n-${n.id}`, icon: PenTool, color: "text-green-600", source: asStr(n.authorName) || "Care team",
      text: `${asStr(n.noteType).replace(/_/g, " ") || "Note"}: ${asStr(n.title) || asStr(n.content).slice(0, 60)}`,
      at: asStr(n.createdAt),
    }));
    tasksQ.data.filter((t) => asStr(t.status) === "COMPLETED").forEach((t) => evs.push({
      id: `t-${t.id}`, icon: CheckSquare, color: "text-blue-600", source: "Caregiver",
      text: `Completed: ${asStr(t.title)}${nameById.get(asStr(t.residentId)) ? ` · ${nameById.get(asStr(t.residentId))}` : ""}`,
      at: asStr(t.completedAt) || asStr(t.updatedAt) || asStr(t.createdAt),
    }));
    messagesQ.data.forEach((m) => {
      const s = (m.sender && typeof m.sender === "object" ? (m.sender as Row) : {});
      evs.push({
        id: `m-${m.id}`, icon: MessageSquare, color: "text-purple-600", source: asStr(s.name) || "Message",
        text: asStr(m.subject) || asStr(m.content).slice(0, 60), at: asStr(m.createdAt),
      });
    });
    callBellsQ.data.forEach((c) => evs.push({
      id: `c-${c.id}`, icon: BellRing, color: "text-red-600", source: "Call bell",
      text: `${asStr(c.status)} · ${nameById.get(asStr(c.residentId)) ?? "Resident"}${asStr(c.reason) ? ` — ${asStr(c.reason)}` : ""}`,
      at: asStr(c.createdAt),
    }));
    incidentsQ.data.forEach((i) => evs.push({
      id: `i-${i.id}`, icon: AlertTriangle, color: "text-orange-600", source: "Incident",
      text: `${asStr(i.incidentType).replace(/_/g, " ")} (${asStr(i.severity)}) · ${nameById.get(asStr(i.residentId)) ?? "Resident"}`,
      at: asStr(i.incidentDate) || asStr(i.createdAt),
    }));
    return evs.filter((e) => e.at).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 25);
  }, [notesQ.data, tasksQ.data, messagesQ.data, callBellsQ.data, incidentsQ.data, residents]);

  const go = (path: string) => router.push(path);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-indigo-700 mb-1 flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-indigo-500 flex-shrink-0" /> Command Center
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Cross-team triage — patient, family, nurse &amp; caregiver signals in one physician view
          </p>
        </div>
        <RefreshButton onRefresh={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Patients Under Care" value={stats.patients} icon={Users} tone="gray" />
        <Kpi label="Needs Review" value={stats.needReview} icon={HeartPulse} tone="red" onClick={() => go("/physician/vitalstrend")} />
        <Kpi label="Pending Orders" value={stats.pendingOrders} icon={Pill} tone="amber" onClick={() => go("/physician/orders")} />
        <Kpi label="Open Incidents" value={stats.openIncidents} icon={AlertTriangle} tone="orange" onClick={() => go("/physician/incidents")} />
        <Kpi label="Notes to Co-sign" value={stats.unsigned} icon={Signature} tone="blue" onClick={() => go("/physician/notes")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patients needing attention */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <HeartPulse className="w-5 h-5 text-red-500" />
            <h2 className="font-bold text-gray-900">Patients Needing Attention</h2>
            <span className="ml-auto text-xs text-gray-500">{attention.length}</span>
          </div>
          {attention.length === 0 ? (
            <p className="text-sm text-gray-400 py-8 text-center">All patients stable — no abnormal vitals or open incidents.</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto">
              {attention.map((p) => (
                <button key={p.id} onClick={() => go(`/physician/vitalstrend?resident=${p.id}`)}
                  className="w-full text-left bg-gray-50 hover:bg-yellow-50 border border-gray-200 hover:border-yellow-300 rounded-lg p-3 transition flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-gray-900 text-sm">{p.name} <span className="text-gray-400 font-normal">· Room {p.room}</span></p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {p.abnormal.map((a, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-red-100 text-red-700">{a}</span>
                      ))}
                      {p.openIncidents > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-orange-100 text-orange-700">{p.openIncidents} open incident{p.openIncidents > 1 ? "s" : ""}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Pending physician actions */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ClipboardCheck className="w-5 h-5 text-blue-500" />
            <h2 className="font-bold text-gray-900">Pending Physician Actions</h2>
          </div>
          <div className="space-y-2">
            <ActionRow icon={Siren} tone="red" label="SBAR escalations awaiting response" count={openEscalations.length} onClick={() => go("/physician/escalations")} />
            <ActionRow icon={AlertTriangle} tone="orange" label="Incidents to review" count={stats.openIncidents} onClick={() => go("/physician/incidents")} />
          </div>
        </div>
      </div>

      {/* Clinical Review — quick access to the full record boards */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardCheck className="w-5 h-5 text-indigo-500" />
          <h2 className="font-bold text-gray-900">Clinical Review — Quick Access</h2>
          <span className="ml-auto text-xs text-gray-500">Jump into any record board</span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {REVIEW_BOARDS.map((b) => <QuickCard key={b.route} board={b} onClick={() => go(b.route)} />)}
        </div>
      </div>

      {/* Cross-role activity feed */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-5 h-5 text-yellow-500" />
          <h2 className="font-bold text-gray-900">Care Team Activity</h2>
          <span className="ml-auto text-xs text-gray-500">patient · family · nurse · caregiver</span>
        </div>
        {feed.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No recent care-team activity.</p>
        ) : (
          <div className="space-y-1 max-h-[460px] overflow-y-auto">
            {feed.map((e) => {
              const Icon = e.icon;
              return (
                <div key={e.id} className="flex items-start gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 transition">
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${e.color}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800"><span className="font-semibold">{e.source}</span> — {e.text}</p>
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{relTime(e.at, nowTs)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const TONES: Record<string, { wrap: string; icon: string; value: string }> = {
  gray: { wrap: "bg-white border-gray-200", icon: "text-gray-500", value: "text-gray-900" },
  red: { wrap: "bg-red-50 border-red-200", icon: "text-red-500", value: "text-red-600" },
  amber: { wrap: "bg-amber-50 border-amber-200", icon: "text-amber-500", value: "text-amber-600" },
  orange: { wrap: "bg-orange-50 border-orange-200", icon: "text-orange-500", value: "text-orange-600" },
  blue: { wrap: "bg-blue-50 border-blue-200", icon: "text-blue-500", value: "text-blue-600" },
  teal: { wrap: "bg-teal-50 border-teal-200", icon: "text-teal-500", value: "text-teal-600" },
  green: { wrap: "bg-green-50 border-green-200", icon: "text-green-500", value: "text-green-600" },
};

function Kpi({ label, value, icon: Icon, tone, onClick }: { label: string; value: number; icon: LucideIcon; tone: keyof typeof TONES; onClick?: () => void }) {
  const t = TONES[tone];
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`p-4 rounded-lg border text-left transition ${t.wrap} ${onClick ? "hover:shadow-md active:scale-[0.98] cursor-pointer" : "cursor-default"}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs sm:text-sm text-gray-600 font-semibold">{label}</p>
        <Icon className={`w-4 h-4 ${t.icon}`} />
      </div>
      <p className={`text-2xl sm:text-3xl font-bold mt-1 ${t.value}`}>{value}</p>
    </button>
  );
}

// The up-to-date clinical record boards a physician reviews (shared with Care
// Manager). Rendered as a quick-access grid so the cockpit opens straight into
// any board without hunting the sidebar.
interface ReviewBoard { label: string; desc: string; icon: LucideIcon; route: string; tint: string }
const REVIEW_BOARDS: ReviewBoard[] = [
  { label: "Vital Sign Trends", desc: "10-domain trends & bands", icon: HeartPulse, route: "/physician/vitalstrend", tint: "text-rose-500" },
  { label: "Wound Care", desc: "Registry, photos, staging", icon: Bandage, route: "/physician/woundcare", tint: "text-amber-600" },
  { label: "Care Plan Reviews", desc: "Reviews due & decisions", icon: Target, route: "/physician/careplans", tint: "text-indigo-600" },
  { label: "Clinical Records", desc: "Labs, therapy, dx, orders", icon: FolderOpen, route: "/physician/clinicalrecords", tint: "text-blue-600" },
  { label: "Med Compliance", desc: "Adherence & missed doses", icon: PieChart, route: "/physician/medcompliance", tint: "text-teal-600" },
  { label: "Daily Living (ADL)", desc: "Function & assistance", icon: Accessibility, route: "/physician/adlmonitoring", tint: "text-cyan-600" },
  { label: "Weight Tracking", desc: "Weekly weights & trend", icon: Scale, route: "/physician/weightmonitoring", tint: "text-slate-600" },
  { label: "Progress Reports", desc: "Period clinical summary", icon: FileText, route: "/physician/progressreport", tint: "text-green-600" },
  { label: "Daily Care Logs", desc: "10-domain bedside logs", icon: NotebookPen, route: "/physician/carelogs", tint: "text-purple-600" },
  { label: "Care Timeline", desc: "Full documentation history", icon: History, route: "/physician/carehistory", tint: "text-orange-600" },
  { label: "Med Inventory", desc: "Stock & purchase requests", icon: Package, route: "/physician/medinventory", tint: "text-blue-500" },
  { label: "Mini Pharmacy", desc: "Backup stock & dispense", icon: Cross, route: "/physician/minipharmacy", tint: "text-teal-500" },
];

function QuickCard({ board, onClick }: { board: ReviewBoard; onClick: () => void }) {
  const Icon = board.icon;
  return (
    <button onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-yellow-300 hover:bg-yellow-50 hover:shadow-sm active:scale-[0.98]">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 ${board.tint}`}><Icon className="h-4 w-4" /></span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-gray-900">{board.label}</span>
        <span className="block truncate text-[11px] text-gray-500">{board.desc}</span>
      </span>
    </button>
  );
}

function ActionRow({ icon: Icon, tone, label, count, onClick }: { icon: LucideIcon; tone: keyof typeof TONES; label: string; count: number; onClick: () => void }) {
  const t = TONES[tone];
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 hover:border-yellow-300 hover:bg-yellow-50 transition text-left">
      <Icon className={`w-4 h-4 flex-shrink-0 ${t.icon}`} />
      <span className="text-sm text-gray-800 flex-1">{label}</span>
      <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${count > 0 ? `${t.wrap} ${t.value}` : "bg-gray-100 text-gray-400"}`}>{count}</span>
      <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
    </button>
  );
}
