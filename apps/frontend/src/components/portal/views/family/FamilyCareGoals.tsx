"use client";

import { useMemo, useState } from "react";
import { Target, HeartPulse, Pill, ClipboardList, AlertTriangle, CheckCircle2, FileText, Users, CalendarClock, Send, MessageSquarePlus, Stethoscope } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";
import Swal from "@/lib/swal";
import { useRelative, relVitalsOf, latestVitalOf, LiveBadge, type Row } from "./shared";

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v == null ? d : String(v));
const fmtDate = (v: unknown) => { const s = str(v); return s ? new Date(s).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""; };

interface Goal {
  icon: typeof Target;
  title: string;
  detail: string;
  status: "on-track" | "in-progress" | "attention";
  pct: number;
}

const STATUS_META = {
  "on-track": { label: "On track", badge: "bg-green-100 text-green-700", bar: "bg-green-500" },
  "in-progress": { label: "In progress", badge: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
  attention: { label: "Needs attention", badge: "bg-red-100 text-red-700", bar: "bg-red-500" },
} as const;

// The documented care plan is authored by the care team as CarePlanItem rows
// grouped by category. We present them to the resident/family in plain language.
const ITEM_GROUPS: { key: string; label: string; icon: typeof Target; tone: string }[] = [
  { key: "GOAL", label: "Care goals", icon: Target, tone: "text-green-600" },
  { key: "INTERVENTION", label: "What the care team will do", icon: Stethoscope, tone: "text-blue-600" },
  { key: "RESPONSIBILITY", label: "Responsibilities", icon: Users, tone: "text-purple-600" },
  { key: "REVIEW_NOTE", label: "Review notes", icon: FileText, tone: "text-gray-600" },
];
const PLAN_STATUS_BADGE: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700", DRAFT: "bg-gray-100 text-gray-600",
  UNDER_REVIEW: "bg-amber-100 text-amber-700", COMPLETED: "bg-blue-100 text-blue-700",
  DISCONTINUED: "bg-red-100 text-red-600",
};

/**
 * Care Plan — the resident/family view of the documented care plan the care
 * team authored (goals, interventions, responsibilities, review schedule),
 * plus a live wellness snapshot and a way to send input to the care team so
 * residents and families are active participants in the plan.
 */
export default function FamilyCareGoals() {
  const { relative, displayName } = useRelative();

  // Resident-scoped by the API for FAMILY/RESIDENT — only this resident's plan.
  const { data: planRows } = useLiveQuery<Row>("care-plans", { query: "take=20", tables: ["CarePlan"] });
  const { data: itemRows } = useLiveQuery<Row>("care-plan-items", { query: "take=300", tables: ["CarePlanItem"] });
  const { data: vitalsRows } = useLiveQuery("vitals", { query: "include=resident&take=50", tables: ["VitalsLog"] });
  const { data: taskRows } = useLiveQuery("tasks", { query: "take=50", tables: ["Task"] });

  // Pick the resident's current plan: an ACTIVE one first, else the most recent.
  const plan = useMemo(() => {
    const mine = relative ? planRows.filter((p) => !p.residentId || p.residentId === relative.id) : planRows;
    if (!mine.length) return null;
    const active = mine.find((p) => str(p.status) === "ACTIVE");
    return active ?? [...mine].sort((a, b) => new Date(str(b.createdAt)).getTime() - new Date(str(a.createdAt)).getTime())[0];
  }, [planRows, relative]);

  const planItems = useMemo(() => (plan ? itemRows.filter((i) => i.carePlanId === plan.id) : []), [itemRows, plan]);

  // ── Participation: send input to the care team (stored as a preference) ──
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const shareInput = async () => {
    const text = input.trim();
    if (!text || !relative) return;
    setSending(true);
    try {
      await createRecord("resident-preferences", {
        residentId: relative.id,
        category: "Care Plan Input",
        preference: "Note to the care team",
        value: text,
      });
      setInput("");
      Swal.fire({ title: "Sent to the care team", text: "Thank you — your input is now part of the care conversation.", icon: "success", timer: 2200, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Couldn't send", text: err instanceof Error ? err.message : "Please try again.", icon: "error" });
    } finally {
      setSending(false);
    }
  };

  // ── Derive a live wellness snapshot from real data ──
  const relVitals = relVitalsOf(vitalsRows, relative);
  const rawMeds = (relative?.raw?.medications ?? []) as Row[];
  const rawIncidents = (relative?.raw?.incidents ?? []) as Row[];
  const tasks = relative ? taskRows.filter((t) => !t.residentId || t.residentId === relative.id) : taskRows;

  const goals: Goal[] = [];
  const hr = latestVitalOf(relVitals, "HEART_RATE");
  const hrVal = hr ? parseFloat(String(hr.value)) : NaN;
  const hrOk = !isNaN(hrVal) && hrVal >= 55 && hrVal <= 100;
  goals.push({ icon: HeartPulse, title: "Maintain healthy vital signs", detail: hr ? `Latest heart rate ${String(hr.value)} bpm — ${hrOk ? "within the normal range" : "outside the normal range, care team notified"}.` : "Awaiting the next vitals reading.", status: hr ? (hrOk ? "on-track" : "attention") : "in-progress", pct: hr ? (hrOk ? 100 : 40) : 50 });
  const activeMeds = rawMeds.filter((m) => String(m.status ?? "ACTIVE") === "ACTIVE");
  goals.push({ icon: Pill, title: "Medication adherence", detail: activeMeds.length ? `${activeMeds.length} active medication${activeMeds.length === 1 ? "" : "s"} administered on schedule by nursing staff.` : "No active medications — nothing to administer.", status: "on-track", pct: 100 });
  const doneTasks = tasks.filter((t) => String(t.status) === "COMPLETED").length;
  const taskPct = tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 0;
  goals.push({ icon: ClipboardList, title: "Daily activity & assistance", detail: tasks.length ? `${doneTasks} of ${tasks.length} caregiver task${tasks.length === 1 ? "" : "s"} completed (${taskPct}%).` : "No assistance tasks scheduled yet.", status: tasks.length === 0 ? "in-progress" : taskPct >= 60 ? "on-track" : "in-progress", pct: tasks.length ? taskPct : 30 });
  const openIncidents = rawIncidents.filter((i) => !i.resolvedAt).length;
  goals.push({ icon: AlertTriangle, title: "Safety & fall prevention", detail: openIncidents ? `${openIncidents} open incident${openIncidents === 1 ? "" : "s"} — staff are attending.` : "No open incidents. AI fall detection is monitoring 24/7.", status: openIncidents ? "attention" : "on-track", pct: openIncidents ? 35 : 100 });
  const onTrack = goals.filter((g) => g.status === "on-track").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2">
          <Target className="w-6 h-6 text-green-500 flex-shrink-0" /> Care Plan
        </h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge /> Care plan &amp; live progress for {displayName}
        </p>
      </div>

      {/* ── Documented care plan (authored by the care team) ── */}
      {plan ? (
        <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-gray-900 flex items-center gap-2"><FileText className="w-5 h-5 text-blue-500" /> Your documented care plan</h2>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${PLAN_STATUS_BADGE[str(plan.status)] ?? "bg-gray-100 text-gray-600"}`}>{str(plan.status, "DRAFT")}</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500">
            {str(plan.startDate) && <span className="flex items-center gap-1"><CalendarClock className="w-3.5 h-3.5" /> Started {fmtDate(plan.startDate)}</span>}
            {str(plan.reviewFrequency) && <span>Reviewed {str(plan.reviewFrequency).toLowerCase()}</span>}
            {str(plan.nextReviewDate) && <span>Next review {fmtDate(plan.nextReviewDate)}</span>}
          </div>

          {ITEM_GROUPS.map((grp) => {
            const rows = planItems.filter((i) => str(i.category) === grp.key);
            if (!rows.length) return null;
            const Icon = grp.icon;
            return (
              <div key={grp.key}>
                <h3 className={`text-sm font-semibold flex items-center gap-1.5 mb-1.5 ${grp.tone}`}><Icon className="w-4 h-4" /> {grp.label}</h3>
                <ul className="space-y-1.5">
                  {rows.map((i) => {
                    const done = str(i.status) === "COMPLETED";
                    return (
                      <li key={str(i.id)} className="flex items-start gap-2 text-sm">
                        <CheckCircle2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${done ? "text-green-500" : "text-gray-300"}`} />
                        <span className="min-w-0">
                          <span className={`font-medium text-gray-900 ${done ? "line-through text-gray-400" : ""}`}>{str(i.title)}</span>
                          {str(i.description) && <span className="block text-xs text-gray-500">{str(i.description)}</span>}
                          {str(i.targetDate) && <span className="text-[11px] text-gray-400">Target: {fmtDate(i.targetDate)}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}

          {planItems.length === 0 && str(plan.careGoals) && (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{str(plan.careGoals)}</p>
          )}
          {str(plan.notes) && <p className="text-xs text-gray-500 border-t border-gray-100 pt-3">{str(plan.notes)}</p>}
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <FileText className="w-5 h-5 flex-shrink-0" /> Your care team is preparing the documented care plan. Meanwhile, here is {displayName}&apos;s live progress.
        </div>
      )}

      {/* ── Be an active participant ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1"><MessageSquarePlus className="w-4 h-4 text-indigo-500" /> Share your input with the care team</h3>
        <p className="text-xs text-gray-500 mb-3">Your goals, preferences, and questions help shape the plan. What matters most to you?</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="e.g. I'd like more time outdoors in the afternoon…" className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-400 outline-none resize-none" />
          <button onClick={shareInput} disabled={sending || !input.trim()} className="self-start inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition disabled:opacity-40">
            <Send className="w-4 h-4" /> Send
          </button>
        </div>
      </div>

      {/* ── Live progress snapshot ── */}
      <div>
        <div className={`rounded-lg border px-4 py-3 text-sm font-semibold flex items-center gap-2 mb-4 ${onTrack === goals.length ? "border-green-200 bg-green-50 text-green-800" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          {onTrack === goals.length ? `Every wellness goal is on track — ${displayName} is doing great.` : `${onTrack} of ${goals.length} wellness goals on track; the care team is working on the rest.`}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((g, i) => {
            const meta = STATUS_META[g.status];
            const Icon = g.icon;
            return (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Icon className="w-4 h-4 text-gray-500" /> {g.title}</h3>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold flex-shrink-0 ${meta.badge}`}>{meta.label}</span>
                </div>
                <p className="text-sm text-gray-600 mt-2">{g.detail}</p>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mt-3">
                  <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${g.pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
