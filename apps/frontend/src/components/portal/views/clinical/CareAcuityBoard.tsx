"use client";

/**
 * Care Acuity & Level of Care — a 10-domain acuity assessment (0–5 each → 0/50)
 * that assigns a Level of Care (1–5) through a Nurse-review → Admin-approval
 * workflow, plus Service Packages, Care Activities, and Level History. Migration-
 * free: assessments are a JSON array in the app-setting `acuity_assessments`;
 * approval best-effort maps the level onto the resident's careLevel.
 */

import { useMemo, useState } from "react";
import { ClipboardCheck, CheckCircle2, Eye } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, ClinicalModal,
  StatCard, DataState, FieldLabel, controlClass, StatusPill, SERIF,
} from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ACUITY_KEY = "acuity_assessments";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `ac-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (isoStr: string) => (isoStr ? new Date(isoStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Domain { key: string; label: string; scale: string[] }
const DOMAINS: Domain[] = [
  { key: "adl", label: "Activities of Daily Living", scale: ["Fully independent", "Minimal setup or cueing", "Some help with 1–2 ADLs", "Help with most ADLs", "Extensive assistance (one-person)", "Total dependence (two-person)"] },
  { key: "mobility", label: "Mobility & Fall Risk", scale: ["Independent, no fall risk", "Steady with device, low risk", "Supervision, occasionally unsteady", "Assist to transfer, moderate risk", "High fall risk, extensive assist", "Non-ambulatory / bedbound"] },
  { key: "cognition", label: "Cognition & Memory", scale: ["Fully oriented", "Mild forgetfulness", "Occasional confusion", "Moderate impairment, needs cueing", "Severe impairment, disoriented", "Profound impairment"] },
  { key: "behavior", label: "Behavior & Emotional Regulation", scale: ["No concerns", "Occasional mild agitation", "Intermittent agitation/anxiety", "Frequent behaviors, redirectable", "Frequent, hard to redirect", "Severe behaviors, safety risk"] },
  { key: "nutrition", label: "Nutrition & Hydration", scale: ["Independent, good appetite", "Mild appetite changes", "Needs encouragement/monitoring", "Needs feeding assist / modified diet", "Poor intake, high risk", "Tube feeding / NPO / complex"] },
  { key: "elimination", label: "Elimination & Continence", scale: ["Fully continent", "Occasional incontinence", "Needs toileting schedule", "Frequently incontinent, needs assist", "Fully incontinent / catheter", "Ostomy / complex needs"] },
  { key: "medication", label: "Medication Complexity", scale: ["No meds or self-admin", "Simple regimen, supervised", "Several meds, nurse-administered", "Complex regimen / PRNs", "High-alert meds / titration", "IV / injectable / intensive"] },
  { key: "medical", label: "Medical Acuity & Stability", scale: ["Stable, no issues", "Stable chronic conditions", "Needs routine monitoring", "Unstable, frequent monitoring", "Acute needs / skilled care", "Complex / critical"] },
  { key: "psychosocial", label: "Psychosocial & Family Needs", scale: ["Well-adjusted", "Minor adjustment needs", "Needs regular engagement", "Isolation / mood concerns", "Significant psychosocial needs", "Complex needs / crisis support"] },
  { key: "night", label: "Night Care Requirements", scale: ["Sleeps through night", "Occasional night check", "Scheduled night checks", "Frequent night assistance", "Extensive night care", "Continuous night supervision"] },
];

// Level → clinical-editorial accent. L1 reads as low/resolved (green), L2 info (teal),
// L3 in-progress (amber), L4/L5 attention (coral).
type LevelAccent = "green" | "teal" | "amber" | "coral";
const ACCENT_VAR: Record<LevelAccent, string> = { green: "var(--clinical-green)", teal: "var(--clinical-panel)", amber: "var(--clinical-amber)", coral: "var(--clinical-coral)" };
interface Level { n: number; name: string; min: number; max: number; accent: LevelAccent; careLevel: string; package: string; services: string[] }
const LEVELS: Level[] = [
  { n: 1, name: "Independent Living Plus", min: 0, max: 10, accent: "green", careLevel: "INDEPENDENT", package: "Wellness & light-touch support", services: ["Weekly wellness check", "Medication reminders", "Community activities", "Housekeeping & laundry"] },
  { n: 2, name: "Assisted Living", min: 11, max: 20, accent: "teal", careLevel: "ASSISTED", package: "Daily assistance", services: ["Daily ADL assistance", "Nurse-administered medications", "Escort to meals/activities", "Scheduled vitals"] },
  { n: 3, name: "Enhanced Assisted Care", min: 21, max: 30, accent: "amber", careLevel: "ASSISTED", package: "Extensive daily care", services: ["Extensive ADL assistance", "Fall-prevention program", "Continence care", "Frequent nursing review"] },
  { n: 4, name: "Memory / Comprehensive Care", min: 31, max: 40, accent: "coral", careLevel: "MEMORY", package: "Comprehensive & memory support", services: ["Secured/memory support", "Behavioral care plan", "Two-person transfers", "24-hour supervision"] },
  { n: 5, name: "Skilled / Complex Care", min: 41, max: 50, accent: "coral", careLevel: "SKILLED", package: "Skilled & complex medical", services: ["Skilled nursing interventions", "Complex medication management", "Wound / IV / tube care", "Dedicated caregiver"] },
];
const levelFor = (total: number) => LEVELS.find((l) => total >= l.min && total <= l.max) ?? LEVELS[LEVELS.length - 1];
const accentFor = (n: number) => LEVELS.find((l) => l.n === n)?.accent ?? "coral";
// The 4-value careLevel enum → its representative Level (1–5). ASSISTED covers both
// L2 & L3, so it reads as L2. Used to heal admission-seeded records whose stored
// level pre-dates the careLevel-based seed fix.
const CARELEVEL_TO_LEVEL: Record<string, number> = { INDEPENDENT: 1, ASSISTED: 2, MEMORY: 4, SKILLED: 5 };

// Theme-safe level chip: ink label + a coloured dot (matches WoundCare's status chip).
function LevelChip({ level, label }: { level: number; label?: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[accentFor(level)] }} />
      {label ? `Level ${level} — ${label}` : `L${level}`}
    </span>
  );
}

// Care-activity catalog by level (Category · Activity · Frequency · Shift · Duration).
const CARE_ACTIVITIES: { category: string; activity: string; frequency: string; shift: string; duration: string; levels: number[] }[] = [
  { category: "Wellness", activity: "Weekly wellness check", frequency: "Weekly", shift: "Morning", duration: "15 min", levels: [1] },
  { category: "Vitals & Monitoring", activity: "Routine vital signs", frequency: "Daily", shift: "Morning", duration: "10 min", levels: [1, 2, 3, 4, 5] },
  { category: "Psychosocial", activity: "Social engagement & activities", frequency: "Daily", shift: "Afternoon", duration: "30 min", levels: [1, 2, 3, 4] },
  { category: "Medication", activity: "Medication administration", frequency: "Per schedule", shift: "All shifts", duration: "10 min", levels: [2, 3, 4, 5] },
  { category: "Personal Care", activity: "Assist with bathing", frequency: "Daily", shift: "Morning", duration: "20 min", levels: [2, 3, 4, 5] },
  { category: "Personal Care", activity: "Assist with dressing & grooming", frequency: "Daily", shift: "Morning", duration: "15 min", levels: [2, 3, 4, 5] },
  { category: "Mobility", activity: "Ambulation & transfer assistance", frequency: "Every shift", shift: "All shifts", duration: "15 min", levels: [2, 3, 4, 5] },
  { category: "Nutrition", activity: "Meal setup & encouragement", frequency: "Each meal", shift: "All shifts", duration: "10 min", levels: [2, 3] },
  { category: "Fall Prevention", activity: "Hourly safety rounding", frequency: "Hourly", shift: "All shifts", duration: "5 min", levels: [3, 4, 5] },
  { category: "Continence", activity: "Scheduled toileting", frequency: "Every 2–3 hrs", shift: "All shifts", duration: "10 min", levels: [3, 4, 5] },
  { category: "Cognitive", activity: "Reorientation & cueing", frequency: "Every shift", shift: "All shifts", duration: "10 min", levels: [3, 4, 5] },
  { category: "Night Care", activity: "Scheduled night checks", frequency: "Every 2 hrs", shift: "Night", duration: "5 min", levels: [3, 4, 5] },
  { category: "Mobility", activity: "Repositioning", frequency: "Every 2 hrs", shift: "All shifts", duration: "10 min", levels: [4, 5] },
  { category: "Nutrition", activity: "Feeding assistance", frequency: "Each meal", shift: "All shifts", duration: "25 min", levels: [4, 5] },
  { category: "Behavioral", activity: "Behavioral care-plan check-in", frequency: "Every shift", shift: "All shifts", duration: "15 min", levels: [4, 5] },
  { category: "Medication", activity: "Complex medication management", frequency: "Per schedule", shift: "All shifts", duration: "20 min", levels: [4, 5] },
  { category: "Skilled Nursing", activity: "Wound care", frequency: "Daily", shift: "Morning", duration: "20 min", levels: [5] },
  { category: "Skilled Nursing", activity: "IV / injectable therapy", frequency: "Per order", shift: "All shifts", duration: "15 min", levels: [5] },
  { category: "Night Care", activity: "Continuous night supervision", frequency: "Continuous", shift: "Night", duration: "—", levels: [5] },
];

const TRIGGERS = ["Scheduled / Quarterly", "Condition Change", "Post-Fall", "Post-Hospitalization", "Family Request", "Admission"];

type AStatus = "PENDING_NURSE" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";
interface Acuity { id: string; residentId: string; scores: Record<string, number>; total: number; level: number; levelName: string; trigger?: string; notes?: string; status: AStatus; createdBy?: string; createdAt: string; decidedBy?: string; decidedAt?: string; rejectionReason?: string; }
const parseAcuity = (raw: string | null | undefined): Acuity[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((a) => a && typeof a.id === "string") : []; } catch { return []; } };

export default function CareAcuityBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const careLevelById = useMemo(() => {
    const m = new Map<string, string>();
    (resQ.data || []).forEach((r) => m.set(s(r.id), s(r.careLevel)));
    return m;
  }, [resQ.data]);
  // Heal admission-seeded records still awaiting review: recompute their level from
  // the resident's current careLevel so older seeds (which stored a mis-derived
  // level) display — and approve — at the correct Level of Care.
  const items = useMemo(() => {
    const raw = parseAcuity(settingRows.find((r) => (r.key || r.id) === ACUITY_KEY)?.value);
    return raw.map((a) => {
      if (a.trigger !== "Admission" || (a.status !== "PENDING_NURSE" && a.status !== "PENDING_ADMIN")) return a;
      const n = CARELEVEL_TO_LEVEL[careLevelById.get(a.residentId) || ""];
      if (!n || n === a.level) return a;
      const lvl = LEVELS.find((l) => l.n === n);
      return lvl ? { ...a, level: n, levelName: lvl.name } : a;
    });
  }, [settingRows, careLevelById]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: id, room: "" }; };

  const [tab, setTab] = useState<"queue" | "packages" | "activities" | "history">("queue");
  const [newOpen, setNewOpen] = useState(false);
  const [viewing, setViewing] = useState<Acuity | null>(null);

  const pendingNurse = items.filter((a) => a.status === "PENDING_NURSE");
  const pendingAdmin = items.filter((a) => a.status === "PENDING_ADMIN");
  const approved = items.filter((a) => a.status === "APPROVED").sort((a, b) => (b.decidedAt || "").localeCompare(a.decidedAt || ""));
  const queue = [...pendingNurse, ...pendingAdmin].sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  // Latest approved level per resident → distribution.
  const dist = useMemo(() => {
    const latest = new Map<string, Acuity>();
    approved.forEach((a) => { if (!latest.has(a.residentId)) latest.set(a.residentId, a); });
    const d: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    latest.forEach((a) => { d[a.level] = (d[a.level] || 0) + 1; });
    return d;
  }, [approved]);

  const persist = async (next: Acuity[]) => { await upsertRecord("app-settings", ACUITY_KEY, { key: ACUITY_KEY, value: JSON.stringify(next) }); await refetch(); };

  const submitNew = async (a: Omit<Acuity, "id" | "status" | "createdBy" | "createdAt">) => {
    const rec: Acuity = { ...a, id: newId(), status: "PENDING_NURSE", createdBy: clinicianName, createdAt: new Date().toISOString() };
    await persist([rec, ...items]);
    setNewOpen(false);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Submitted for nurse review", showConfirmButton: false, timer: 1600 });
  };

  // Approve — confirm first (modal alert), then advance the workflow. Returns
  // whether the action was actually applied (false if the user cancelled).
  const advance = async (a: Acuity, to: AStatus): Promise<boolean> => {
    const rn = resName(a.residentId);
    const isFinal = to === "APPROVED";
    const confirm = await Swal.fire({
      title: isFinal ? "Approve & assign level?" : "Approve for admin?",
      html: isFinal
        ? `Approve <b>${rn.name}</b> at <b>Level ${a.level} — ${a.levelName}</b> and assign this level of care?`
        : `Send <b>${rn.name}</b>'s assessment (Score ${a.total}/50) to admin for final approval?`,
      icon: "question", showCancelButton: true,
      confirmButtonColor: "#4F46E5", cancelButtonColor: "#6b7280",
      confirmButtonText: isFinal ? "Approve & assign" : "Approve → Admin",
    });
    if (!confirm.isConfirmed) return false;
    const next = items.map((x) => (x.id === a.id ? { ...x, status: to, decidedBy: clinicianName, decidedAt: new Date().toISOString() } : x));
    await persist(next);
    if (isFinal) { const lvl = LEVELS.find((l) => l.n === a.level); if (lvl) updateRecord("residents", a.residentId, { careLevel: lvl.careLevel }).catch(() => null); }
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: isFinal ? "Approved — level assigned" : "Sent to admin", showConfirmButton: false, timer: 1600 });
    return true;
  };
  // Reject — confirm with an optional reason.
  const reject = async (a: Acuity): Promise<boolean> => {
    const rn = resName(a.residentId);
    const confirm = await Swal.fire({
      title: "Reject assessment?",
      html: `Reject <b>${rn.name}</b>'s acuity assessment? Add a reason for the record if you like.`,
      input: "textarea", inputPlaceholder: "Reason for rejection (optional)…",
      icon: "warning", showCancelButton: true,
      confirmButtonColor: "#dc2626", cancelButtonColor: "#6b7280", confirmButtonText: "Reject",
    });
    if (!confirm.isConfirmed) return false;
    const reason = String(confirm.value || "").trim() || undefined;
    await persist(items.map((x) => (x.id === a.id ? { ...x, status: "REJECTED", rejectionReason: reason, decidedBy: clinicianName, decidedAt: new Date().toISOString() } : x)));
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Assessment rejected", showConfirmButton: false, timer: 1600 });
    return true;
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Care Acuity & Level of Care"
        subtitle="Assessment scoring, level assignment, and care planning"
        right={<ClinicalButton variant="accent" onClick={() => setNewOpen(true)}><ClipboardCheck className="h-4 w-4" /> New Assessment</ClinicalButton>}
      />

      {/* Stats */}
      <div className="mt-5 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={residents.length} label="Total Residents" accent="ink" />
        <StatCard value={pendingNurse.length} label="Pending Nurse Review" accent="amber" />
        <StatCard value={pendingAdmin.length} label="Pending Admin Approval" accent="coral" />
        <ClinicalCard top="green" className="p-4 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Level Distribution</p>
          <div className="mt-2 flex items-center justify-center gap-2 flex-wrap">{LEVELS.map((l) => <span key={l.n} className="text-xs font-bold tabular-nums" style={{ color: ACCENT_VAR[l.accent] }}>L{l.n}:{dist[l.n] || 0}</span>)}</div>
        </ClinicalCard>
      </div>

      {/* Tabs */}
      <div className="mb-5 inline-flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
        {([["queue", "Assessments Queue"], ["packages", "Service Packages"], ["activities", "Care Activities"], ["history", "Level History"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${tab === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{label}{v === "queue" && queue.length ? ` (${queue.length})` : ""}</button>
        ))}
      </div>

      {tab === "queue" && (
        <DataState
          loading={loading && items.length === 0}
          error={error}
          empty={queue.length === 0}
          emptyTitle="No pending assessments"
          emptyHint="All reviews are up to date."
          onRetry={() => void refetch()}
          skeletonRows={3}
        >
          <div className="space-y-3">
            {queue.map((a) => { const rn = resName(a.residentId); return (
              <div key={a.id} className="rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><p className="font-bold text-[var(--clinical-ink)]">{rn.name}</p><span className="text-xs text-[var(--clinical-muted)]">Room {rn.room}</span><LevelChip level={a.level} label={a.levelName} /></div>
                    <p className="mt-1 text-xs text-[var(--clinical-muted)]">Score {a.total}/50 · {a.trigger || "No trigger"} · by {a.createdBy || "—"} · {fmtDate(a.createdAt)}</p>
                    {a.notes && <p className="mt-1.5 text-sm text-[var(--clinical-ink-soft)]">{a.notes}</p>}
                  </div>
                  <StatusPill status={a.status === "PENDING_NURSE" ? "PENDING" : "PENDING_APPROVAL"}>{a.status === "PENDING_NURSE" ? "Nurse Review" : "Admin Approval"}</StatusPill>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <ClinicalButton variant="secondary" size="sm" onClick={() => setViewing(a)}><Eye className="h-4 w-4" /> View</ClinicalButton>
                  {a.status === "PENDING_NURSE" && <ClinicalButton variant="primary" size="sm" onClick={() => advance(a, "PENDING_ADMIN")}>Approve → Admin</ClinicalButton>}
                  {a.status === "PENDING_ADMIN" && <ClinicalButton variant="accent" size="sm" onClick={() => advance(a, "APPROVED")}>Approve &amp; Assign Level</ClinicalButton>}
                  <ClinicalButton variant="danger" size="sm" onClick={() => reject(a)}>Reject</ClinicalButton>
                </div>
              </div>
            ); })}
          </div>
        </DataState>
      )}

      {tab === "packages" && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LEVELS.map((l) => (
            <ClinicalCard key={l.n} top={l.accent} className="p-4">
              <div className="mb-1 flex items-center gap-2"><LevelChip level={l.n} /><span className="text-xs text-[var(--clinical-muted)]">score {l.min}–{l.max}</span></div>
              <p className="font-bold text-[var(--clinical-ink)]">{l.name}</p>
              <p className="mb-2 text-sm text-[var(--clinical-muted)]">{l.package}</p>
              <ul className="space-y-1">{l.services.map((sv) => <li key={sv} className="flex items-start gap-2 text-sm text-[var(--clinical-ink-soft)]"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: ACCENT_VAR[l.accent] }} />{sv}</li>)}</ul>
            </ClinicalCard>
          ))}
        </div>
      )}

      {tab === "activities" && <CareActivitiesView />}

      {tab === "history" && <LevelHistoryView residents={residents} approved={approved} />}

      <NewAssessmentModal open={newOpen} residents={residents} onClose={() => setNewOpen(false)} onSubmit={submitNew} />

      {viewing && (() => {
        const a = viewing; const rn = resName(a.residentId);
        const pendingNurse = a.status === "PENDING_NURSE";
        const pendingAdmin = a.status === "PENDING_ADMIN";
        const doThen = async (fn: () => Promise<boolean>) => { const ok = await fn(); if (ok) setViewing(null); };
        return (
          <ClinicalModal open onClose={() => setViewing(null)} title={`${rn.name} — Acuity Assessment`} description={`Room ${rn.room} · reviewed before approval`} size="lg"
            footer={<>
              <ClinicalButton variant="ghost" size="sm" onClick={() => setViewing(null)}>Close</ClinicalButton>
              {(pendingNurse || pendingAdmin) && <ClinicalButton variant="danger" size="sm" onClick={() => void doThen(() => reject(a))}>Reject</ClinicalButton>}
              {pendingNurse && <ClinicalButton variant="primary" size="sm" onClick={() => void doThen(() => advance(a, "PENDING_ADMIN"))}>Approve → Admin</ClinicalButton>}
              {pendingAdmin && <ClinicalButton variant="accent" size="sm" onClick={() => void doThen(() => advance(a, "APPROVED"))}>Approve &amp; Assign Level</ClinicalButton>}
            </>}
          >
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <LevelChip level={a.level} label={a.levelName} />
                <StatusPill status={a.status === "PENDING_NURSE" ? "PENDING" : a.status === "PENDING_ADMIN" ? "PENDING_APPROVAL" : a.status === "APPROVED" ? "APPROVED" : "REJECTED"}>{a.status.replace(/_/g, " ")}</StatusPill>
              </div>
              <p className="text-xs text-[var(--clinical-muted)]">{a.trigger || "No trigger"} · by {a.createdBy || "—"} · {fmtDate(a.createdAt)}</p>
              {a.notes && <div className="rounded-lg border p-3 text-sm text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>{a.notes}</div>}
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--clinical-line)" }}>
                {DOMAINS.map((d, i) => { const sc = a.scores?.[d.key] ?? 0; return (
                  <div key={d.key} className="flex items-start justify-between gap-3 p-3" style={i ? { borderTop: "1px solid var(--clinical-line)" } : undefined}>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[var(--clinical-ink)]">{d.label}</p>
                      <p className="text-xs text-[var(--clinical-muted)]">{d.scale[sc] ?? "—"}</p>
                    </div>
                    <span className="shrink-0 rounded-full border px-2 py-0.5 text-xs font-bold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>{sc}/5</span>
                  </div>
                ); })}
              </div>
              <div className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                <span className="text-sm font-semibold text-[var(--clinical-ink)]">Total Acuity Score</span>
                <span className="text-lg font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{a.total}/50</span>
              </div>
            </div>
          </ClinicalModal>
        );
      })()}
    </ClinicalPage>
  );
}

// ── Care Activities — level-filtered activity table ──────────────────────────
function CareActivitiesView() {
  const [lvl, setLvl] = useState<number | "">("");
  const rows = CARE_ACTIVITIES.filter((a) => lvl === "" || a.levels.includes(Number(lvl)));
  return (
    <div className="space-y-4">
      <select value={lvl} onChange={(e) => setLvl(e.target.value === "" ? "" : Number(e.target.value))} aria-label="Filter by level" className={`${controlClass} max-w-xs`}>
        <option value="">All Levels</option>
        {LEVELS.map((l) => <option key={l.n} value={l.n}>Level {l.n}</option>)}
      </select>
      <div className="overflow-x-auto rounded-xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <table className="w-full min-w-[720px] text-sm">
          <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>
            <th className="px-4 py-2.5 font-semibold">Level</th><th className="px-4 py-2.5 font-semibold">Category</th><th className="px-4 py-2.5 font-semibold">Activity</th><th className="px-4 py-2.5 font-semibold">Frequency</th><th className="px-4 py-2.5 font-semibold">Shift</th><th className="px-4 py-2.5 font-semibold">Duration</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-[var(--clinical-muted)]">No care activities for this level.</td></tr>
              : rows.map((a, i) => { const mn = Math.min(...a.levels), mx = Math.max(...a.levels); return (
                <tr key={i} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                  <td className="px-4 py-2.5">{mn === mx ? <LevelChip level={mn} /> : <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[accentFor(mn)] }} />{`L${mn}–L${mx}`}</span>}</td>
                  <td className="px-4 py-2.5"><span className="rounded-full px-2 py-0.5 text-xs font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>{a.category}</span></td>
                  <td className="px-4 py-2.5 font-medium text-[var(--clinical-ink)]">{a.activity}</td>
                  <td className="px-4 py-2.5 text-[var(--clinical-muted)]">{a.frequency}</td>
                  <td className="px-4 py-2.5 text-[var(--clinical-muted)]">{a.shift}</td>
                  <td className="px-4 py-2.5 text-[var(--clinical-muted)]">{a.duration}</td>
                </tr>
              ); })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Level History — per-resident level-change timeline ───────────────────────
function LevelHistoryView({ residents, approved }: { residents: Row[]; approved: Acuity[] }) {
  const [sel, setSel] = useState("");
  const resId = sel || (residents[0] ? s(residents[0].id) : "");
  const history = approved.filter((a) => a.residentId === resId).sort((a, b) => (b.decidedAt || b.createdAt || "").localeCompare(a.decidedAt || a.createdAt || ""));
  return (
    <ClinicalCard className="p-5">
      <h2 className="text-lg font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Care Level History</h2>
      <p className="mb-3 text-sm text-[var(--clinical-muted)]">Select a resident to view their level change history</p>
      <select value={resId} onChange={(e) => setSel(e.target.value)} aria-label="Select resident" className={`${controlClass} max-w-sm`}>
        {residents.length === 0 && <option value="">No residents</option>}
        {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — {s(r.room)}</option>)}
      </select>
      <div className="mt-4">
        {history.length === 0 ? <p className="text-[var(--clinical-muted)]">No level changes recorded.</p>
          : <div className="space-y-2">
              {history.map((a, i) => { const prev = history[i + 1]; return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2.5" style={{ borderColor: "var(--clinical-line)" }}>
                  <div className="flex items-center gap-2">
                    <LevelChip level={a.level} label={a.levelName} />
                    {prev && prev.level !== a.level && <span className="text-xs text-[var(--clinical-muted)]">changed from L{prev.level}</span>}
                  </div>
                  <span className="text-xs text-[var(--clinical-muted)]">{a.total}/50 · {fmtDate(a.decidedAt || a.createdAt)} · {a.decidedBy || a.createdBy || "—"}</span>
                </div>
              ); })}
            </div>}
      </div>
    </ClinicalCard>
  );
}

function NewAssessmentModal({ open, residents, onClose, onSubmit }: { open: boolean; residents: Row[]; onClose: () => void; onSubmit: (a: Omit<Acuity, "id" | "status" | "createdBy" | "createdAt">) => Promise<void> }) {
  const [resId, setResId] = useState("");
  const [scores, setScores] = useState<Record<string, number>>(Object.fromEntries(DOMAINS.map((d) => [d.key, 0])));
  const [trigger, setTrigger] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const total = DOMAINS.reduce((sum, d) => sum + (scores[d.key] || 0), 0);
  const lvl = levelFor(total);
  const setScore = (k: string, v: number) => setScores((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    if (!resId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return; }
    setSaving(true);
    try { await onSubmit({ residentId: resId, scores, total, level: lvl.n, levelName: lvl.name, trigger: trigger || undefined, notes: notes || undefined }); }
    finally { setSaving(false); }
  };

  return (
    <ClinicalModal
      open={open}
      onClose={onClose}
      title="New Acuity Assessment"
      description="Score 10 domains (0–5 each) to assign a Level of Care"
      size="lg"
      footer={<>
        <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={submit} disabled={saving}>{saving ? "Submitting…" : "Submit for Nurse Review"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required htmlFor="ac-res">Resident</FieldLabel>
          <select id="ac-res" value={resId} onChange={(e) => setResId(e.target.value)} className={controlClass}><option value="">Select resident</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}</select>
        </div>

        <div className="rounded-xl border p-3" style={{ borderColor: "var(--clinical-line)" }}>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-sm font-bold text-[var(--clinical-ink)]">Domain Scoring <span className="font-normal text-[var(--clinical-muted)]">(0–5 each)</span></p>
            <p className="text-2xl font-bold tabular-nums text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{total}<span className="text-sm text-[var(--clinical-muted)]">/50</span></p>
          </div>
          <div className="mb-3"><LevelChip level={lvl.n} label={lvl.name} /></div>
          <div className="divide-y" style={{ borderColor: "var(--clinical-line)" }}>
            {DOMAINS.map((d) => { const v = scores[d.key] || 0; return (
              <div key={d.key} className="py-2.5">
                <div className="flex items-center justify-between gap-2"><p className="text-sm font-semibold text-[var(--clinical-ink)]">{d.label}</p><span className="text-sm font-bold text-[var(--clinical-ink-soft)]">{v}</span></div>
                <div className="mt-1.5 flex gap-1" role="group" aria-label={`Score for ${d.label}`}>{[0, 1, 2, 3, 4, 5].map((n) => <button key={n} type="button" aria-label={`${d.label}: ${n}`} aria-pressed={v === n} onClick={() => setScore(d.key, n)} className={`h-7 w-7 rounded-lg border text-xs font-bold transition-colors ${v === n ? "bg-[var(--clinical-panel)] text-white border-[var(--clinical-panel)]" : "text-[var(--clinical-muted)] hover:border-[var(--clinical-panel)]"}`} style={v === n ? undefined : { backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line-strong)" }}>{n}</button>)}</div>
                <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">{v} — {d.scale[v]}</p>
              </div>
            ); })}
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="ac-trigger">Trigger / Reason for Assessment</FieldLabel>
          <select id="ac-trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} className={controlClass}><option value="">Select trigger (optional)</option>{TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        </div>
        <div>
          <FieldLabel htmlFor="ac-notes">Assessment Notes</FieldLabel>
          <textarea id="ac-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Clinical observations, rationale…" className={controlClass} />
        </div>
      </div>
    </ClinicalModal>
  );
}
