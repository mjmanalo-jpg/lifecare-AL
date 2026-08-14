"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Trash2, Pencil, CheckCircle2, Gauge, AlertTriangle,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, StatCard,
  SearchInput, DataState, StatusPill, MicroLabel, controlClass, DISPLAY,
} from "./clinical-ui";
import LevelOfCareReview from "./LevelOfCareReview";
import SignatureModal from "@/components/portal/SignatureModal";
import {
  PREADMISSION_KEY, parseAssessments, newId, scoreAssessment,
  effectiveLevel, levelLabel, levelColor, cloneForReassessment, isReassessmentDue,
  WALKING_OPTIONS, TRANSFER_OPTIONS, FALLS_OPTIONS,
  ADL_ITEMS, ADL_LEVEL_OPTIONS,
  URINARY_OPTIONS, BOWEL_OPTIONS,
  MEMORY_OPTIONS, ORIENTATION_OPTIONS, COMMUNICATION_OPTIONS, BEHAVIOR_OPTIONS,
  NURSING_FLAG_ITEMS, NURSING_SCORING_ITEMS,
  RISK_ITEMS, RISK_LEVEL_OPTIONS,
  OTHER_CONDITIONS, REFERRAL_SOURCES, DIET_OPTIONS, APPETITE_OPTIONS,
  CARE_PRIORITY_OPTIONS, STAFFING_OPTIONS, REASSESSMENT_OPTIONS,
  type PreAdmissionAssessment, type PreAdmissionData, type Opt,
} from "@/lib/preadmissionAssessment";

type SettingRow = { key?: string; id?: string; value?: string };

const RISK_LABEL: Record<string, string> = { fall: "Fall Risk", aspiration: "Aspiration Risk", pressure: "Pressure Injury Risk", infection: "Infection Risk" };
const ADL_LABEL: Record<string, string> = { bathing: "Bathing", dressing: "Dressing", grooming: "Grooming", toileting: "Toileting", feeding: "Feeding", transfers: "Transfers" };

// Level 1–5 → KPI accent (low = positive, mid = caution, high = attention).
const LEVEL_ACCENT = ["green", "green", "amber", "coral", "coral"] as const;

const input = controlClass;
// Selected vs. unselected chip styling, shared by every scored/plain/multi pick.
const chipOn = "bg-[var(--clinical-panel)] text-white border-[var(--clinical-panel)]";
const chipOff = "bg-[var(--clinical-surface)] text-[var(--clinical-ink-soft)] border-[var(--clinical-line-strong)] hover:border-[var(--clinical-panel)]";

// ── Reusable inputs ──────────────────────────────────────────────────────────
function Text({ label, value, onChange, placeholder, type = "text" }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={input} />
    </label>
  );
}
function Area({ label, value, onChange, placeholder, rows = 2 }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; rows?: number }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={input} />
    </label>
  );
}
/** Single-select scored control — shows each option's point value. */
function ScoredPick({ label, options, value, onChange, hint }: { label: string; options: readonly Opt[]; value?: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <div>
      <MicroLabel className="mb-1.5">{label}{hint && <span className="text-[var(--clinical-muted)] normal-case tracking-normal font-normal"> — {hint}</span>}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button key={o.value} type="button" onClick={() => onChange(on ? "" : o.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? chipOn : chipOff}`}>
              {o.label}{o.points ? <span className={`ml-1 ${on ? "text-white/70" : "text-[var(--clinical-muted)]"}`}>+{o.points}</span> : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
/** Plain single-select from a string list (unscored). */
function Pick({ label, options, value, onChange }: { label: string; options: readonly string[]; value?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <MicroLabel className="mb-1.5">{label}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o;
          return (
            <button key={o} type="button" onClick={() => onChange(on ? "" : o)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? chipOn : chipOff}`}>
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}
/** Multi-select chips (returns the toggled string array). */
function MultiPick({ label, options, values, onChange }: { label: string; options: readonly (string | Opt)[]; values: string[]; onChange: (v: string[]) => void }) {
  const set = new Set(values);
  const toggle = (v: string) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); onChange([...n]); };
  return (
    <div>
      <MicroLabel className="mb-1.5">{label}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((raw) => {
          const o = typeof raw === "string" ? { value: raw, label: raw, points: 0 } : raw;
          const on = set.has(o.value);
          return (
            <button key={o.value} type="button" onClick={() => toggle(o.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? chipOn : chipOff}`}>
              {o.label}{o.points ? <span className={`ml-1 ${on ? "text-white/70" : "text-[var(--clinical-muted)]"}`}>+{o.points}</span> : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Bool({ label, value, onChange }: { label: string; value?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${value ? chipOn : chipOff}`}>
      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${value ? "bg-white/20 border-white" : "border-[var(--clinical-line-strong)]"}`}>{value && <CheckCircle2 className="w-3 h-3" />}</span>
      {label}
    </button>
  );
}
function Section({ code, title, points, subtotal, children }: { code: string; title: string; points?: number; subtotal?: number; children: React.ReactNode }) {
  return (
    <ClinicalCard top="teal" className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 border-b pb-2" style={{ borderColor: "var(--clinical-line)" }}>
        <h3 className="text-sm font-bold text-[var(--clinical-ink)]"><span className="text-[var(--clinical-panel)] mr-1.5">{code}</span>{title}</h3>
        {typeof points === "number" && (
          <span className="text-xs font-bold text-[var(--clinical-panel)] rounded px-2 py-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>{subtotal ?? 0}<span className="text-[var(--clinical-muted)] font-medium">/{points}</span></span>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </ClinicalCard>
  );
}

const EMPTY: PreAdmissionData = { otherConditions: [], adl: {}, behaviors: [], nursing: [], risk: {}, carePriorities: [], staffing: [] };
const META_KEYS = new Set(["id", "status", "scores", "createdAt", "updatedAt", "convertedAdmissionId"]);
const stripMeta = (a: PreAdmissionAssessment): PreAdmissionData =>
  Object.fromEntries(Object.entries(a).filter(([k]) => !META_KEYS.has(k))) as PreAdmissionData;

export default function PreAdmissionAssessmentForm({ clinicianRole = "NURSE" }: { clinicianRole?: string }) {
  const { data: settingRows, loading, error, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const assessments = useMemo(
    () => parseAssessments(settingRows.find((r) => (r.key || r.id) === PREADMISSION_KEY)?.value)
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")),
    [settingRows]
  );

  const [me, setMe] = useState("");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setMe(d.session?.name ?? ""); }).catch(() => {}); }, []);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PreAdmissionData>({ ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState<PreAdmissionAssessment | null>(null);
  const [showPin, setShowPin] = useState(false);
  const nowISO = new Date().toISOString();

  const set = (patch: Partial<PreAdmissionData>) => setForm((f) => ({ ...f, ...patch }));
  const scores = useMemo(() => scoreAssessment(form), [form]);

  const openNew = () => { setEditingId(null); setForm({ ...EMPTY, dateOfAssessment: new Date().toISOString().slice(0, 10), assessor: me }); setOpen(true); };
  const openEdit = (a: PreAdmissionAssessment) => { setEditingId(a.id); setForm({ ...EMPTY, ...stripMeta(a) }); setOpen(true); };

  const persist = async (next: PreAdmissionAssessment[]) => {
    await upsertRecord("app-settings", PREADMISSION_KEY, { key: PREADMISSION_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  const save = async (status: "DRAFT" | "COMPLETED") => {
    if (!form.residentName?.trim()) { Swal.fire({ title: "Resident name required", text: "Enter the resident's name in Section A before saving.", icon: "warning" }); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const snap = scoreAssessment(form);
      let next: PreAdmissionAssessment[];
      if (editingId) {
        next = assessments.map((a) => (a.id === editingId ? { ...a, ...form, status, scores: snap, updatedAt: now } : a));
      } else {
        const rec: PreAdmissionAssessment = { ...form, id: newId(), status, scores: snap, createdAt: now, updatedAt: now };
        next = [rec, ...assessments];
        setEditingId(rec.id);
      }
      await persist(next);
      if (status === "COMPLETED") { setOpen(false); Swal.fire({ title: "Assessment completed", text: `${form.residentName} — ${snap.levelLabel} (${snap.total}/50).`, icon: "success", timer: 2200, showConfirmButton: false }); }
      else Swal.fire({ title: "Draft saved", icon: "success", timer: 1200, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Could not save.", icon: "error" });
    } finally { setSaving(false); }
  };

  const remove = async (a: PreAdmissionAssessment) => {
    const c = await Swal.fire({ title: "Delete assessment?", text: `Remove the pre-admission assessment for ${a.residentName || "this prospect"}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#e11d48", confirmButtonText: "Delete" });
    if (!c.isConfirmed) return;
    await persist(assessments.filter((x) => x.id !== a.id));
  };

  // Stage 5–8: persist a single reviewed record and keep the open modal in sync.
  const saveOne = async (updated: PreAdmissionAssessment) => {
    await persist(assessments.map((a) => (a.id === updated.id ? updated : a)));
    setReviewing(updated);
  };

  // Stage 13: clone forward as a fresh draft, then open it in the form to re-score.
  const startReassessment = async (prior: PreAdmissionAssessment) => {
    const clone = cloneForReassessment(prior, newId(), new Date().toISOString());
    await persist([clone, ...assessments]);
    setReviewing(null);
    openEdit(clone);
  };

  const q = search.trim().toLowerCase();
  const filtered = assessments.filter((a) => !q || (a.residentName || "").toLowerCase().includes(q));
  const stat = (lvl: number) => assessments.filter((a) => a.scores?.level === lvl).length;

  return (
    <ClinicalPage className="space-y-6">
      <ClinicalHeader
        title="Pre-Admission Assessment"
        subtitle="LifeCare Living Solutions — Resident Assessment Form v2.0. Scores the 0–50 acuity total and LifeCare Level of Care."
        right={<ClinicalButton variant="accent" onClick={openNew}><Plus className="w-4 h-4" /> New Assessment</ClinicalButton>}
      />

      {/* Level distribution */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={assessments.length} accent="ink" />
        {[1, 2, 3, 4, 5].map((l) => <StatCard key={l} label={`Level ${l}`} value={stat(l)} accent={LEVEL_ACCENT[l - 1]} />)}
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search by resident name…" className="max-w-sm" />

      {/* List */}
      <DataState
        loading={loading && assessments.length === 0}
        error={error}
        empty={filtered.length === 0}
        emptyTitle={assessments.length === 0 ? "No assessments yet" : "No matches"}
        emptyHint={assessments.length === 0 ? "Click New Assessment to screen a prospective resident." : "Try a different resident name."}
        emptyAction={assessments.length === 0 ? <ClinicalButton variant="accent" onClick={openNew}><Plus className="w-4 h-4" /> New Assessment</ClinicalButton> : undefined}
        onRetry={() => void refetch()}
        skeletonRows={3}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => {
            const eff = effectiveLevel(a);
            const overridden = a.overrideLevel != null && a.overrideLevel !== a.scores?.level;
            const due = isReassessmentDue(a.nextReviewDate, nowISO);
            const top = due ? "coral" : a.status === "VALIDATED" ? "teal" : a.status === "COMPLETED" ? "green" : "amber";
            return (
              <ClinicalCard key={a.id} top={top} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-[var(--clinical-ink)] truncate">{a.residentName || "Unnamed prospect"}</h3>
                    <p className="text-xs text-[var(--clinical-muted)] mt-0.5">{a.referralSource ? `Referral: ${a.referralSource} · ` : ""}{a.dateOfAssessment || (a.updatedAt || "").slice(0, 10)}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {a.status === "VALIDATED" ? <StatusPill status="APPROVED">Validated</StatusPill> : <StatusPill status={a.status} />}
                    <button onClick={() => openEdit(a)} aria-label="Edit form" className="p-2 rounded-lg text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(a)} aria-label="Delete" className="p-2 rounded-lg text-[var(--clinical-coral)] hover:bg-[var(--clinical-surface-2)]"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* badges */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {a.carePlan && <span className="text-[10px] font-semibold px-2 py-0.5 rounded text-[var(--clinical-panel)]" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>Care plan · {a.carePlan.problems.length} problem{a.carePlan.problems.length === 1 ? "" : "s"}</span>}
                  {due && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-[var(--clinical-coral)] text-white"><AlertTriangle className="w-3 h-3" /> Reassessment due</span>}
                  {a.priorAssessmentId && <span className="text-[10px] font-semibold px-2 py-0.5 rounded text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>Reassessment</span>}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-[var(--clinical-ink)] tabular-nums">{a.scores?.total ?? 0}</span>
                    <span className="text-sm text-[var(--clinical-muted)]">/ 50</span>
                  </div>
                  <span className="text-xs font-bold text-white px-2.5 py-1 rounded" style={{ background: levelColor(eff) }}>
                    {levelLabel(eff)}{overridden ? " ·override" : ""}
                  </span>
                </div>

                {a.status !== "DRAFT" && (
                  <ClinicalButton variant="primary" size="sm" className="mt-3 w-full" onClick={() => setReviewing(a)}>
                    <Gauge className="w-3.5 h-3.5" /> Review · Validate · Care Plan
                  </ClinicalButton>
                )}
              </ClinicalCard>
            );
          })}
        </div>
      </DataState>

      {/* Form modal — bespoke rich form (live acuity readout); responsive sheet. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div role="dialog" aria-modal="true" aria-label="Pre-admission assessment form" className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[92vh] sm:max-w-3xl sm:rounded-2xl" style={{ backgroundColor: "var(--clinical-ground)" }}>
            {/* Header */}
            <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Pre-Admission Resident Assessment v2.0</p>
                <h2 className="text-lg font-bold truncate" style={{ fontFamily: DISPLAY }}>{form.residentName || "New Assessment"}</h2>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>

            {/* Live acuity bar */}
            <div className="flex flex-none flex-wrap items-center justify-between gap-3 px-5 py-2.5 text-white" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 82%, black)" }}>
              <div className="flex items-center gap-2 text-xs text-white/80">
                <Gauge className="w-4 h-4" />
                <span>ADL {scores.adl}/12</span><span>·</span><span>Mob {scores.mobility}/6</span><span>·</span>
                <span>Cont {scores.continence}/4</span><span>·</span><span>Cog {scores.cognition}/8</span><span>·</span>
                <span>Nurse {scores.nursing}/8</span><span>·</span><span>Risk {scores.risk}/12</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tabular-nums">{scores.total}<span className="text-sm text-white/75 font-medium">/50</span></span>
                <span className="text-xs font-bold px-2.5 py-1 rounded" style={{ background: levelColor(scores.level) }}>{scores.levelLabel}</span>
              </div>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 scrollbar-thin sm:p-5">
              {/* A — Resident Information */}
              <Section code="A" title="Resident Information">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Text label="Resident Name *" value={form.residentName} onChange={(v) => set({ residentName: v })} />
                  <div className="grid grid-cols-2 gap-3">
                    <Text label="Age" value={form.age} onChange={(v) => set({ age: v })} />
                    <Text label="Sex" value={form.sex} onChange={(v) => set({ sex: v })} placeholder="Male / Female" />
                  </div>
                  <Text label="Date of Birth" type="date" value={form.dateOfBirth} onChange={(v) => set({ dateOfBirth: v })} />
                  <Text label="Date of Assessment" type="date" value={form.dateOfAssessment} onChange={(v) => set({ dateOfAssessment: v })} />
                  <Text label="Assessment Location" value={form.assessmentLocation} onChange={(v) => set({ assessmentLocation: v })} />
                  <Text label="Primary Contact" value={form.primaryContact} onChange={(v) => set({ primaryContact: v })} />
                  <Text label="Contact No." value={form.contactNo} onChange={(v) => set({ contactNo: v })} />
                  <Text label="Relationship" value={form.relationship} onChange={(v) => set({ relationship: v })} />
                  <Text label="Assessor" value={form.assessor} onChange={(v) => set({ assessor: v })} />
                </div>
                <Pick label="Referral Source" options={REFERRAL_SOURCES} value={form.referralSource} onChange={(v) => set({ referralSource: v })} />
              </Section>

              {/* B — Medical History */}
              <Section code="B" title="Medical History">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Text label="Primary Diagnosis" value={form.primaryDiagnosis} onChange={(v) => set({ primaryDiagnosis: v })} />
                  <Text label="Secondary Diagnosis" value={form.secondaryDiagnosis} onChange={(v) => set({ secondaryDiagnosis: v })} />
                </div>
                <MultiPick label="Other Medical Conditions" options={OTHER_CONDITIONS} values={form.otherConditions ?? []} onChange={(v) => set({ otherConditions: v })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Text label="Previous Surgeries" value={form.previousSurgeries} onChange={(v) => set({ previousSurgeries: v })} />
                  <Text label="Allergies" value={form.allergies} onChange={(v) => set({ allergies: v })} />
                </div>
                <Area label="Current Medications" value={form.currentMedications} onChange={(v) => set({ currentMedications: v })} />
                <div className="flex flex-wrap items-end gap-3">
                  <Bool label="Hospitalized in last 12 months" value={form.hospitalized12mo} onChange={(v) => set({ hospitalized12mo: v })} />
                  {form.hospitalized12mo && <div className="flex-1 min-w-[200px]"><Text label="Reason" value={form.hospitalizationReason} onChange={(v) => set({ hospitalizationReason: v })} /></div>}
                </div>
              </Section>

              {/* C — Mobility */}
              <Section code="C" title="Mobility" points={6} subtotal={scores.mobility}>
                <ScoredPick label="Walking" options={WALKING_OPTIONS} value={form.walking} onChange={(v) => set({ walking: v as PreAdmissionData["walking"] })} />
                <Pick label="Transfers" options={TRANSFER_OPTIONS} value={form.transfers} onChange={(v) => set({ transfers: v })} />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                  <Pick label="History of Falls" options={FALLS_OPTIONS} value={form.fallsHistory} onChange={(v) => set({ fallsHistory: v })} />
                  <Text label="Last Fall" value={form.lastFall} onChange={(v) => set({ lastFall: v })} placeholder="e.g. 2 weeks ago" />
                </div>
              </Section>

              {/* D — ADLs */}
              <Section code="D" title="Activities of Daily Living (ADLs)" points={12} subtotal={scores.adl}>
                <div className="space-y-2.5">
                  {ADL_ITEMS.map((item) => (
                    <div key={item} className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-sm font-medium text-[var(--clinical-ink)] w-28 shrink-0">{ADL_LABEL[item]}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {ADL_LEVEL_OPTIONS.map((o) => {
                          const on = form.adl?.[item] === o.value;
                          return (
                            <button key={o.value} type="button" onClick={() => set({ adl: { ...form.adl, [item]: on ? undefined : (o.value as never) } })}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? chipOn : chipOff}`}>
                              {o.label}{o.points ? <span className={on ? "text-white/70 ml-1" : "text-[var(--clinical-muted)] ml-1"}>+{o.points}</span> : ""}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* E — Continence */}
              <Section code="E" title="Continence" points={4} subtotal={scores.continence}>
                <ScoredPick label="Urinary" options={URINARY_OPTIONS} value={form.urinary} onChange={(v) => set({ urinary: v as PreAdmissionData["urinary"] })} />
                <ScoredPick label="Bowel" options={BOWEL_OPTIONS} value={form.bowel} onChange={(v) => set({ bowel: v as PreAdmissionData["bowel"] })} hint="worst channel scores, capped at 4" />
                <Text label="Comments" value={form.continenceComments} onChange={(v) => set({ continenceComments: v })} />
              </Section>

              {/* F — Cognition */}
              <Section code="F" title="Cognitive Status" points={8} subtotal={scores.cognition}>
                <ScoredPick label="Memory" options={MEMORY_OPTIONS} value={form.memory} onChange={(v) => set({ memory: v as PreAdmissionData["memory"] })} />
                <Pick label="Orientation" options={ORIENTATION_OPTIONS} value={form.orientation} onChange={(v) => set({ orientation: v })} />
                <MultiPick label={`Behavior — modifier +${scores.behaviorModifier}`} options={BEHAVIOR_OPTIONS} values={form.behaviors ?? []} onChange={(v) => set({ behaviors: v as PreAdmissionData["behaviors"] })} />
                <Pick label="Communication" options={COMMUNICATION_OPTIONS} value={form.communication} onChange={(v) => set({ communication: v })} />
              </Section>

              {/* G — Nursing Requirements */}
              <Section code="G" title="Nursing Requirements" points={8} subtotal={scores.nursing}>
                <MultiPick label="Routine monitoring (0 pts)" options={NURSING_FLAG_ITEMS} values={form.nursing ?? []} onChange={(v) => set({ nursing: v as PreAdmissionData["nursing"] })} />
                <MultiPick label="Clinical procedures (1 pt each)" options={NURSING_SCORING_ITEMS} values={form.nursing ?? []} onChange={(v) => set({ nursing: v as PreAdmissionData["nursing"] })} />
                <Text label="Other" value={form.nursingOther} onChange={(v) => set({ nursingOther: v })} />
              </Section>

              {/* H — Clinical Risk */}
              <Section code="H" title="Clinical Risk Assessment" points={12} subtotal={scores.risk}>
                {RISK_ITEMS.map((r) => (
                  <ScoredPick key={r} label={RISK_LABEL[r]} options={RISK_LEVEL_OPTIONS} value={form.risk?.[r]} onChange={(v) => set({ risk: { ...form.risk, [r]: (v || undefined) as never } })} />
                ))}
              </Section>

              {/* I — Nutrition */}
              <Section code="I" title="Nutrition">
                <Pick label="Diet" options={DIET_OPTIONS} value={form.diet} onChange={(v) => set({ diet: v })} />
                <div className="flex flex-wrap items-end gap-4">
                  <Pick label="Appetite" options={APPETITE_OPTIONS} value={form.appetite} onChange={(v) => set({ appetite: v })} />
                  <Bool label="Swallowing Difficulty" value={form.swallowingDifficulty} onChange={(v) => set({ swallowingDifficulty: v })} />
                </div>
              </Section>

              {/* J — Social & Emotional Profile */}
              <Section code="J" title="Social & Emotional Profile">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Text label="Current Living Arrangement" value={form.livingArrangement} onChange={(v) => set({ livingArrangement: v })} />
                  <Text label="Primary Caregiver" value={form.primaryCaregiver} onChange={(v) => set({ primaryCaregiver: v })} />
                  <Text label="Favorite Activities" value={form.favoriteActivities} onChange={(v) => set({ favoriteActivities: v })} />
                  <Text label="Religion" value={form.religion} onChange={(v) => set({ religion: v })} />
                </div>
                <Area label="Reason for Admission" value={form.reasonForAdmission} onChange={(v) => set({ reasonForAdmission: v })} />
                <Text label="Family Expectations" value={form.familyExpectations} onChange={(v) => set({ familyExpectations: v })} />
                <div className="flex flex-wrap gap-2">
                  <Bool label="Family Available" value={form.familyAvailable} onChange={(v) => set({ familyAvailable: v })} />
                  <Bool label="Lives Alone" value={form.livesAlone} onChange={(v) => set({ livesAlone: v })} />
                  <Bool label="Caregiver Burnout" value={form.caregiverBurnout} onChange={(v) => set({ caregiverBurnout: v })} />
                  <Bool label="Recent Loss of Primary Caregiver" value={form.recentCaregiverLoss} onChange={(v) => set({ recentCaregiverLoss: v })} />
                </div>
              </Section>

              {/* K — Clinical Observations */}
              <Section code="K" title="Clinical Observations">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Text label="General Appearance" value={form.generalAppearance} onChange={(v) => set({ generalAppearance: v })} />
                  <Text label="Mobility" value={form.obsMobility} onChange={(v) => set({ obsMobility: v })} />
                  <Text label="Communication" value={form.obsCommunication} onChange={(v) => set({ obsCommunication: v })} />
                  <Text label="Mood / Affect" value={form.moodAffect} onChange={(v) => set({ moodAffect: v })} />
                </div>
                <Area label="Clinical Concerns" value={form.clinicalConcerns} onChange={(v) => set({ clinicalConcerns: v })} />
                <Area label="Strengths" value={form.strengths} onChange={(v) => set({ strengths: v })} />
              </Section>

              {/* L — Initial Care Priorities */}
              <Section code="L" title="Initial Care Priorities">
                <MultiPick label="Priorities" options={CARE_PRIORITY_OPTIONS} values={form.carePriorities ?? []} onChange={(v) => set({ carePriorities: v })} />
              </Section>

              {/* N — Staffing Recommendation */}
              <Section code="N" title="Staffing Recommendation">
                <MultiPick label="Recommended Staffing" options={STAFFING_OPTIONS} values={form.staffing ?? []} onChange={(v) => set({ staffing: v })} />
                <Area label="Clinical Justification" value={form.clinicalJustification} onChange={(v) => set({ clinicalJustification: v })} />
                <Pick label="Recommended Reassessment" options={REASSESSMENT_OPTIONS} value={form.reassessment} onChange={(v) => set({ reassessment: v })} />
                <Text label="Assessor Signature" value={form.assessorSignature} onChange={(v) => set({ assessorSignature: v })} />
              </Section>
            </div>

            {/* Footer */}
            <div className="flex flex-none items-center justify-between gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
              <span className="text-xs text-[var(--clinical-muted)]">{editingId ? "Editing" : "New"} · {clinicianRole === "FACILITY_ADMIN" ? "Care Manager" : "Nurse"}</span>
              <div className="flex items-center gap-2">
                <ClinicalButton variant="secondary" size="sm" onClick={() => save("DRAFT")} disabled={saving}>{saving ? "Saving…" : "Save Draft"}</ClinicalButton>
                <ClinicalButton variant="accent" onClick={() => setShowPin(true)} disabled={saving}><CheckCircle2 className="w-4 h-4" /> Complete Assessment</ClinicalButton>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage 5–13 review: Level of Care override, validation, care plan, reassessment */}
      {reviewing && (
        <LevelOfCareReview
          key={reviewing.id}
          assessment={reviewing}
          me={me}
          clinicianRole={clinicianRole}
          onClose={() => setReviewing(null)}
          onSave={saveOne}
          onStartReassessment={startReassessment}
        />
      )}

      {/* Completing (submitting) an assessment is signed with the clinician's 4-digit PIN. */}
      <SignatureModal
        open={showPin}
        onClose={() => setShowPin(false)}
        onSigned={() => { setShowPin(false); void save("COMPLETED"); }}
        mode="sign"
        title="Sign to complete assessment"
        description="Enter your 4-digit signing PIN to submit this pre-admission assessment."
      />
    </ClinicalPage>
  );
}
