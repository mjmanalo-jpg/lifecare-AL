"use client";

/**
 * Shift Endorsement Dashboard — a Care-Manager oversight view over the shift
 * handovers created in the Shift Endorsements board. It surfaces endorsements
 * that are signed off and AWAITING INCOMING acknowledgement, all unresolved
 * carry-overs, and at-risk residents, lets the incoming clinician View the full
 * handover, and Acknowledge receipt (4-digit PIN gated). Reads/writes the same
 * migration-free `shift_endorsements` app-setting.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Repeat, Inbox, CheckCircle2, Clock, Eye, X, User, ArrowLeftRight, ShieldCheck,
  AlertTriangle, Accessibility, Shield, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { TASK_NOTES_FIELD } from "@/lib/taskNotes";
import SignatureModal from "@/components/portal/SignatureModal";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KEY = "shift_endorsements";
const ADL_KEY = "adl_logs";
const s = (v: unknown) => (v == null ? "" : String(v));

const CONCERN_SECTIONS = ["skinWound", "behaviorCognitive", "medicationIssues", "incidentsEscalations"];
const SECTION_LABELS: Record<string, string> = {
  generalCondition: "General Condition", intakeElimination: "Intake & Elimination", adlMobility: "ADL & Mobility",
  skinWound: "Skin & Wound", behaviorCognitive: "Behavior & Cognitive", medicationIssues: "Medication Issues",
  appointmentsOrders: "Appointments & Orders", incidentsEscalations: "Incidents & Escalations",
};
const CHECKLIST_LABELS: { key: string; label: string }[] = [
  { key: "alerts", label: "Reviewed unresolved alerts" },
  { key: "tasks", label: "Reviewed pending tasks" },
  { key: "adl", label: "Reviewed ADL declines" },
  { key: "carryover", label: "Carry-over notes complete" },
];

interface EndResident { residentId: string; sections: Record<string, string> }
interface CarryOver { id: string; residentId: string; concern: string; priority: string; role: string; dueTime?: string; action?: string }
interface HTask { id: string; title: string; resident: string; room: string; priority: string; due: string }
interface HIncident { id: string; type: string; resident: string; room: string; severity: string }
interface Handover { pendingTasks: HTask[]; openIncidents: HIncident[]; snapshotAt: string }
interface Endorsement {
  id: string; number: string; date: string; shiftLabel?: string; shiftRange?: string; generalNotes?: string;
  outgoingBy?: string; outgoingById?: string; incomingBy?: string; signedAt?: string; status: "PENDING" | "SIGNED_OFF" | "ACKNOWLEDGED";
  residents: EndResident[]; carryOvers: CarryOver[]; checklist: Record<string, boolean>; createdAt: string;
  handover?: Handover; acceptedBy?: string; acceptedById?: string; acceptedAt?: string;
}
const parse = (raw: string | null | undefined): Endorsement[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((e) => e && typeof e.id === "string") : []; } catch { return []; } };
const parseArr = (raw: string | null | undefined): Row[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const fmtDay = (iso: string) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "—");
const todayIso = () => new Date().toISOString().split("T")[0];

export default function ShiftEndorsementDashboard({ clinicianRole = "FACILITY_ADMIN" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName, userId: clinicianUserId, staffId: clinicianStaffId } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const items = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);
  const adlLogs = useMemo(() => parseArr(settingRows.find((r) => (r.key || r.id) === ADL_KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "Resident", room: "" }; };

  const [range, setRange] = useState<"today" | "week" | "month" | "all">("week");
  const [viewing, setViewing] = useState<Endorsement | null>(null);
  const [ackOpen, setAckOpen] = useState(false);
  // "Now" captured after mount (rAF keeps setState out of the effect body) so the
  // ADL-decline window doesn't call Date.now() during render.
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setNowTs(Date.now())); return () => cancelAnimationFrame(id); }, []);

  const isOutgoing = (e: Endorsement) => (e.outgoingById ? clinicianUserId === e.outgoingById : clinicianName === e.outgoingBy);

  const notAck = useMemo(() => items.filter((e) => e.status !== "ACKNOWLEDGED"), [items]);
  const awaiting = useMemo(() => items.filter((e) => e.status === "SIGNED_OFF").sort((a, b) => (b.date + (b.signedAt || "")).localeCompare(a.date + (a.signedAt || ""))), [items]);
  // Carry-overs on any not-yet-acknowledged endorsement are treated as unresolved.
  const unresolvedCarry = useMemo(() => notAck.flatMap((e) => e.carryOvers.map((c) => ({ c, e }))), [notAck]);

  const declineResidents = useMemo(() => {
    const cutoff = (nowTs || 0) - 7 * 86_400_000; // before mount nowTs=0 → include all
    const set = new Set<string>();
    adlLogs.forEach((l) => {
      if (l.change !== "Declined" && l.change !== "Significant Decline") return;
      const t = new Date(s(l.date)).getTime();
      if (Number.isNaN(t) || t >= cutoff) set.add(s(l.residentId));
    });
    return set;
  }, [adlLogs, nowTs]);

  const watchlist = useMemo(() => {
    const set = new Set<string>();
    unresolvedCarry.forEach(({ c }) => set.add(c.residentId));
    notAck.forEach((e) => e.residents.forEach((r) => { if (CONCERN_SECTIONS.some((k) => (r.sections[k] || "").trim())) set.add(r.residentId); }));
    declineResidents.forEach((id) => set.add(id));
    set.delete("");
    return set;
  }, [unresolvedCarry, notAck, declineResidents]);

  const stats: { label: string; value: number; icon: LucideIcon; color: string }[] = [
    { label: "Pending Sign-Off", value: items.filter((e) => e.status === "PENDING").length, icon: Clock, color: "#D97706" },
    { label: "Awaiting Incoming", value: awaiting.length, icon: Inbox, color: "#2563EB" },
    { label: "Acknowledged", value: items.filter((e) => e.status === "ACKNOWLEDGED").length, icon: CheckCircle2, color: "#16A34A" },
    { label: "Unresolved Carry-Overs", value: unresolvedCarry.length, icon: ArrowLeftRight, color: "#9333EA" },
    { label: "Urgent Carry-Overs", value: unresolvedCarry.filter(({ c }) => c.priority === "Urgent").length, icon: AlertTriangle, color: "#DC2626" },
    { label: "ADL Decline Residents", value: declineResidents.size, icon: Accessibility, color: "#64748B" },
    { label: "Watchlist Residents", value: watchlist.size, icon: Shield, color: "#C39A3E" },
  ];

  const filtered = useMemo(() => {
    const today = new Date();
    return items.filter((e) => {
      if (range === "all") return true;
      const d = new Date(e.date + "T00:00:00");
      if (range === "today") return e.date === todayIso();
      const diff = (today.getTime() - d.getTime()) / 86_400_000;
      return range === "week" ? diff <= 7 && diff >= -1 : diff <= 31 && diff >= -1;
    }).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
  }, [items, range]);

  const persist = async (next: Endorsement[]) => { await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) }); await refetch(); };
  // Acknowledge → stamp acceptance AND put the carry-overs on the incoming user's
  // account: a task assigned to them per carry-over item + a notification.
  const doAcknowledge = async () => {
    if (!viewing) return;
    const e = viewing;
    await persist(items.map((x) => (x.id === e.id ? { ...x, status: "ACKNOWLEDGED", incomingBy: clinicianName, acceptedBy: clinicianName, acceptedById: clinicianUserId, acceptedAt: new Date().toISOString() } : x)));
    if (clinicianStaffId) {
      for (const c of e.carryOvers) {
        await createRecord("tasks", {
          residentId: c.residentId, title: `Carry-over: ${c.concern.slice(0, 60)}`, description: c.action || c.concern,
          status: "PENDING", priority: c.priority === "Urgent" ? "HIGH" : c.priority === "Important" ? "MEDIUM" : "LOW",
          category: "Observation", assignedToId: clinicianStaffId,
          [TASK_NOTES_FIELD]: `Accepted from ${e.outgoingBy || "outgoing shift"}'s ${e.shiftLabel || "shift"} handover by ${clinicianName}.`,
        }).catch(() => null);
      }
    }
    if (clinicianUserId) {
      const n = e.carryOvers.length;
      createRecord("notifications", { userId: clinicianUserId, type: "SHIFT_REMINDER", title: "Shift handover accepted", message: `You acknowledged Endorsement ${e.number}${n ? ` — ${n} carry-over task${n === 1 ? "" : "s"} added to your list` : ""}.`, relatedEntityType: "handover", severity: "INFO" }).catch(() => null);
    }
    setAckOpen(false); setViewing(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: e.carryOvers.length ? "Acknowledged — carry-overs added to your tasks" : "Acknowledged", showConfirmButton: false, timer: 1800 });
  };

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-6" style={{ background: "#F7F8FA" }}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.75rem] flex items-center gap-2"><Repeat className="w-6 h-6 text-blue-600" /> Shift Endorsement Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">Shift continuity overview — pending items, carry-overs, and alerts.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {stats.map((st) => <Stat key={st.label} label={st.label} value={st.value} icon={st.icon} color={st.color} />)}
      </div>

      {/* Awaiting incoming acknowledgement */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Clock className="w-5 h-5 text-orange-500" />
          <p className="font-bold text-slate-900">Awaiting Incoming Acknowledgement</p>
          <span className="ml-1 inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">{awaiting.length}</span>
        </div>
        {loading && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : awaiting.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-500" />
            <p className="text-sm text-slate-400">All endorsements have been acknowledged.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {awaiting.map((e) => <EndorsementRow key={e.id} e={e} mine={isOutgoing(e)} onView={() => setViewing(e)} />)}
          </div>
        )}
      </div>

      {/* All unresolved carry-overs */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <ArrowLeftRight className="w-5 h-5 text-purple-500" />
          <p className="font-bold text-slate-900">All Unresolved Carry-Overs</p>
          <span className="ml-1 inline-flex items-center justify-center min-w-6 h-5 px-1.5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold">{unresolvedCarry.length}</span>
        </div>
        {unresolvedCarry.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 p-10 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-500" />
            <p className="text-sm text-slate-400">No unresolved carry-over items</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {unresolvedCarry.map(({ c, e }) => { const rn = resName(c.residentId); return (
              <div key={c.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.priority === "Urgent" ? "bg-red-100 text-red-700" : c.priority === "Important" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{c.priority}</span>
                    <span className="text-sm font-bold text-slate-900">{rn.name}</span>
                    <span className="text-xs text-slate-400">Rm {rn.room} · {c.role}{c.dueTime ? ` · due ${c.dueTime}` : ""}</span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">{c.concern}</p>
                  {c.action && <p className="text-xs text-slate-500 mt-0.5">Action: {c.action}</p>}
                  <p className="mt-1 text-[11px] text-slate-400">From Endorsement {e.number} · {fmtDay(e.date)} · {e.outgoingBy || "—"}</p>
                </div>
                <button onClick={() => setViewing(e)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"><Eye className="w-3.5 h-3.5" /> View</button>
              </div>
            ); })}
          </div>
        )}
      </div>

      {/* All endorsements */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="font-bold text-slate-900">Recent Endorsements</p>
          <div className="inline-flex items-center rounded-full bg-slate-100 p-1">
            {(["today", "week", "month", "all"] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={`rounded-full px-3.5 py-1.5 text-xs font-semibold capitalize transition ${range === r ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"}`}>{r === "week" ? "This week" : r === "month" ? "This month" : r}</button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-8 text-center text-sm text-slate-400">No endorsements in this range.</div>
        ) : (
          <div className="space-y-2.5">
            {filtered.map((e) => <EndorsementRow key={e.id} e={e} mine={isOutgoing(e)} onView={() => setViewing(e)} />)}
          </div>
        )}
      </div>

      {viewing && (
        <ViewModal
          e={viewing}
          resName={resName}
          canAck={!isOutgoing(viewing) && viewing.status === "SIGNED_OFF"}
          onAck={() => setAckOpen(true)}
          onClose={() => setViewing(null)}
        />
      )}
      <SignatureModal open={ackOpen} onClose={() => setAckOpen(false)} onSigned={doAcknowledge} title="Acknowledge shift endorsement" description="Enter your 4-digit signing PIN to acknowledge receipt of this shift endorsement." />
    </div>
  );
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Pending Sign-Off", cls: "bg-amber-100 text-amber-700" },
  SIGNED_OFF: { label: "Awaiting Acknowledgement", cls: "bg-blue-100 text-blue-700" },
  ACKNOWLEDGED: { label: "Acknowledged", cls: "bg-green-100 text-green-700" },
};

function EndorsementRow({ e, mine, onView }: { e: Endorsement; mine: boolean; onView: () => void }) {
  const sm = STATUS_META[e.status] ?? STATUS_META.PENDING;
  const concerns = e.carryOvers.length;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
          <span className="text-sm font-bold text-slate-900">Endorsement {e.number}</span>
          <span className="text-xs text-slate-400">{fmtDay(e.date)}{e.shiftLabel ? ` · ${e.shiftLabel}${e.shiftRange ? ` ${e.shiftRange}` : ""}` : ""}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-slate-400" /> {e.outgoingBy || "—"} <ArrowLeftRight className="w-3 h-3 text-slate-300" /> {e.status === "ACKNOWLEDGED" ? (e.incomingBy || "incoming") : "(pending)"}
          <span className="text-slate-300">·</span> {e.residents.length} resident{e.residents.length === 1 ? "" : "s"}
          {concerns > 0 && <><span className="text-slate-300">·</span> <span className="text-amber-600 font-semibold">{concerns} carry-over{concerns === 1 ? "" : "s"}</span></>}
          {mine && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600">You logged</span>}
        </p>
      </div>
      <button onClick={onView} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><Eye className="w-4 h-4" /> View</button>
    </div>
  );
}

function ViewModal({ e, resName, canAck, onAck, onClose }: { e: Endorsement; resName: (id: string) => { name: string; room: string }; canAck: boolean; onAck: () => void; onClose: () => void }) {
  const sm = STATUS_META[e.status] ?? STATUS_META.PENDING;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl">
        <div className="flex flex-none items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">Endorsement {e.number}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{fmtDay(e.date)}{e.shiftLabel ? ` · ${e.shiftLabel}${e.shiftRange ? ` ${e.shiftRange}` : ""}` : ""} · {e.outgoingBy || "—"} → {e.status === "ACKNOWLEDGED" ? (e.incomingBy || "incoming") : "(pending)"}{e.signedAt ? ` · signed ${e.signedAt}` : ""}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
            <button onClick={onClose} aria-label="Close" className="-mr-1.5 shrink-0 rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {e.generalNotes && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1">General Notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 p-3">{e.generalNotes}</p>
            </div>
          )}

          {e.carryOvers.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 flex items-center gap-1"><ArrowLeftRight className="w-3.5 h-3.5" /> Carry-Over to Next Shift ({e.carryOvers.length})</p>
              <div className="space-y-2">
                {e.carryOvers.map((c) => { const rn = resName(c.residentId); return (
                  <div key={c.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.priority === "Urgent" ? "bg-red-100 text-red-700" : c.priority === "Important" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{c.priority}</span><span className="font-semibold text-slate-900 text-sm">{rn.name}</span><span className="text-xs text-slate-400">Rm {rn.room} · {c.role}{c.dueTime ? ` · due ${c.dueTime}` : ""}</span></div>
                    <p className="text-sm text-slate-700 mt-1">{c.concern}</p>{c.action && <p className="text-xs text-slate-500 mt-0.5">Action: {c.action}</p>}
                  </div>
                ); })}
              </div>
            </div>
          )}

          {e.handover && (e.handover.pendingTasks.length > 0 || e.handover.openIncidents.length > 0) && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Outstanding at Sign-Off</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">Pending Tasks ({e.handover.pendingTasks.length})</p>
                  {e.handover.pendingTasks.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                      {e.handover.pendingTasks.map((t) => <li key={t.id} className="text-xs text-slate-600"><span className="font-semibold text-slate-800">{t.title}</span> — {t.resident}{t.room ? ` (Rm ${t.room})` : ""}</li>)}
                    </ul>
                  )}
                </div>
                <div className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                  <p className="text-xs font-bold text-red-700 mb-1">Open Incidents ({e.handover.openIncidents.length})</p>
                  {e.handover.openIncidents.length === 0 ? <p className="text-xs text-slate-400">None.</p> : (
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                      {e.handover.openIncidents.map((i) => <li key={i.id} className="text-xs text-slate-600"><span className="font-semibold text-slate-800">{(i.type || "Incident").replace(/_/g, " ")}</span>{i.severity ? ` · ${i.severity}` : ""} — {i.resident}{i.room ? ` (Rm ${i.room})` : ""}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          {e.residents.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5">Per-Resident Sections ({e.residents.length})</p>
              <div className="space-y-2.5">
                {e.residents.map((r) => { const rn = resName(r.residentId); const filled = Object.entries(r.sections).filter(([, v]) => (v || "").trim()); return (
                  <div key={r.residentId} className="rounded-xl border border-slate-200 p-3">
                    <p className="font-bold text-slate-900 text-sm">{rn.name} <span className="font-normal text-slate-400">· Room {rn.room}</span></p>
                    {filled.length === 0 ? <p className="text-xs text-slate-400 mt-1">No section notes.</p> : (
                      <div className="mt-2 space-y-1.5">
                        {filled.map(([k, v]) => (
                          <div key={k}><span className="text-[11px] font-semibold text-slate-500">{SECTION_LABELS[k] || k}:</span> <span className="text-sm text-slate-700">{v}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                ); })}
              </div>
            </div>
          )}

          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400 mb-1.5 flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5" /> Sign-Off Checklist</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {CHECKLIST_LABELS.map((c) => { const on = !!e.checklist[c.key]; return (
                <div key={c.key} className="flex items-center gap-2 text-sm">
                  {on ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <AlertTriangle className="w-4 h-4 text-slate-300" />}
                  <span className={on ? "text-slate-700" : "text-slate-400"}>{c.label}</span>
                </div>
              ); })}
            </div>
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
          <span className="text-xs text-slate-400">
            {e.status === "ACKNOWLEDGED" ? `Acknowledged by ${e.incomingBy || "incoming shift"}` : e.status === "SIGNED_OFF" ? (canAck ? "Ready for your acknowledgement." : "Awaiting the incoming shift's acknowledgement.") : `Not yet signed off by ${e.outgoingBy || "the outgoing shift"}.`}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">Close</button>
            {canAck && <button onClick={onAck} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700"><CheckCircle2 className="w-4 h-4" /> Acknowledge</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, color }: { label: string; value: number; icon: LucideIcon; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" style={{ borderTopWidth: 3, borderTopColor: color }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</span>
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <p className="mt-3 text-4xl font-bold leading-none" style={{ color }}>{value}</p>
    </div>
  );
}
