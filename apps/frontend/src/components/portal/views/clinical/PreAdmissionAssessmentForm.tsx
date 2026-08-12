"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Search, Loader2, Trash2, Pencil, CheckCircle2, Gauge, AlertTriangle,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { ClinicalHeader, ClinicalCard, StatusPill, MicroLabel } from "./clinical-ui";
import LevelOfCareReview from "./LevelOfCareReview";
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

const input = "w-full rounded-lg border border-[#D6D8CD] px-3 py-2 text-sm text-[#2B2B27] bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/25";

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
      <MicroLabel className="mb-1.5">{label}{hint && <span className="text-[#8A8D82] normal-case tracking-normal font-normal"> — {hint}</span>}</MicroLabel>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button key={o.value} type="button" onClick={() => onChange(on ? "" : o.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#4A4D44] border-[#D6D8CD] hover:border-[#2E4A48]/40"}`}>
              {o.label}{o.points ? <span className={`ml-1 ${on ? "text-white/70" : "text-[#8A8D82]"}`}>+{o.points}</span> : ""}
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
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? "bg-[#3C5A55] text-white border-[#3C5A55]" : "bg-white text-[#4A4D44] border-[#D6D8CD] hover:border-[#2E4A48]/40"}`}>
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
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? "bg-[#7E9B6F] text-white border-[#7E9B6F]" : "bg-white text-[#4A4D44] border-[#D6D8CD] hover:border-[#7E9B6F]/50"}`}>
              {o.label}{o.points ? <span className={`ml-1 ${on ? "text-white/70" : "text-[#8A8D82]"}`}>+{o.points}</span> : ""}
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
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${value ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#4A4D44] border-[#D6D8CD]"}`}>
      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${value ? "bg-white/20 border-white" : "border-[#B8BBB0]"}`}>{value && <CheckCircle2 className="w-3 h-3" />}</span>
      {label}
    </button>
  );
}
function Section({ code, title, points, subtotal, children }: { code: string; title: string; points?: number; subtotal?: number; children: React.ReactNode }) {
  return (
    <ClinicalCard top="teal" className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 border-b border-[#EEEFE8] pb-2">
        <h3 className="text-sm font-bold text-[#2B2B27]"><span className="text-[#C0573F] mr-1.5">{code}</span>{title}</h3>
        {typeof points === "number" && (
          <span className="text-xs font-bold text-[#2E4A48] bg-[#2E4A48]/8 px-2 py-0.5 rounded">{subtotal ?? 0}<span className="text-[#8A8D82] font-medium">/{points}</span></span>
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
  const { data: settingRows, loading, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
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
    const c = await Swal.fire({ title: "Delete assessment?", text: `Remove the pre-admission assessment for ${a.residentName || "this prospect"}?`, icon: "warning", showCancelButton: true, confirmButtonColor: "#C0573F", confirmButtonText: "Delete" });
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
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-6" style={{ background: "#F4F5F0" }}>
      <ClinicalHeader
        eyebrow="Stage 2 · Pre-Admission Screen"
        title="Pre-Admission Assessment"
        subtitle="LifeCare Living Solutions — Resident Assessment Form v2.0. Scores the 0–50 acuity total and LifeCare Level of Care."
        right={<button onClick={openNew} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] shadow-sm"><Plus className="w-4 h-4" /> New Assessment</button>}
      />

      {/* Level distribution */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total" value={assessments.length} tone="#2E4A48" />
        {[1, 2, 3, 4, 5].map((l) => <StatCard key={l} label={`Level ${l}`} value={stat(l)} tone={["#7E9B6F", "#7E9B6F", "#C39A3E", "#C0573F", "#9E3B2A"][l - 1]} />)}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8A8D82]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by resident name…" className={`${input} pl-9`} />
      </div>

      {/* List */}
      {loading && assessments.length === 0 ? (
        <ClinicalCard className="p-8 text-center text-[#8A8D82]"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Loading assessments…</ClinicalCard>
      ) : filtered.length === 0 ? (
        <ClinicalCard className="p-8 text-center text-[#8A8D82]">No assessments yet. Click <b>New Assessment</b> to screen a prospective resident.</ClinicalCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((a) => {
            const eff = effectiveLevel(a);
            const overridden = a.overrideLevel != null && a.overrideLevel !== a.scores?.level;
            const due = isReassessmentDue(a.nextReviewDate, nowISO);
            const top = due ? "coral" : a.status === "VALIDATED" ? "teal" : a.status === "COMPLETED" ? "green" : "amber";
            return (
              <ClinicalCard key={a.id} top={top} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-[#2B2B27]">{a.residentName || "Unnamed prospect"}</h3>
                    <p className="text-xs text-[#8A8D82] mt-0.5">{a.referralSource ? `Referral: ${a.referralSource} · ` : ""}{a.dateOfAssessment || (a.updatedAt || "").slice(0, 10)}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {a.status === "VALIDATED" ? <StatusPill status="APPROVED">Validated</StatusPill> : <StatusPill status={a.status} />}
                    <button onClick={() => openEdit(a)} title="Edit form" className="p-1.5 rounded-lg hover:bg-[#EEEFE8] text-[#4A4D44]"><Pencil className="w-4 h-4" /></button>
                    <button onClick={() => remove(a)} title="Delete" className="p-1.5 rounded-lg hover:bg-[#F3E2DD] text-[#C0573F]"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>

                {/* badges */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {a.carePlan && <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#2E4A48]/8 text-[#2E4A48]">Care plan · {a.carePlan.problems.length} problem{a.carePlan.problems.length === 1 ? "" : "s"}</span>}
                  {due && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-[#C0573F] text-white"><AlertTriangle className="w-3 h-3" /> Reassessment due</span>}
                  {a.priorAssessmentId && <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-[#D8DAD0] text-[#5A5D53]">Reassessment</span>}
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold text-[#2E4A48]">{a.scores?.total ?? 0}</span>
                    <span className="text-sm text-[#8A8D82]">/ 50</span>
                  </div>
                  <span className="text-xs font-bold text-white px-2.5 py-1 rounded" style={{ background: levelColor(eff) }}>
                    {levelLabel(eff)}{overridden ? " ·override" : ""}
                  </span>
                </div>

                {a.status !== "DRAFT" && (
                  <button onClick={() => setReviewing(a)} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#2E4A48] text-white text-xs font-semibold hover:bg-[#25403D]">
                    <Gauge className="w-3.5 h-3.5" /> Review · Validate · Care Plan
                  </button>
                )}
              </ClinicalCard>
            );
          })}
        </div>
      )}

      {/* Form modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
          <div className="bg-[#F4F5F0] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D7DAD1]">Pre-Admission Resident Assessment v2.0</p>
                <h2 className="text-lg font-bold" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{form.residentName || "New Assessment"}</h2>
              </div>
              <button onClick={() => setOpen(false)} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
            </div>

            {/* Live acuity bar */}
            <div className="bg-[#25403D] text-white px-5 py-2.5 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 text-xs text-[#D7DAD1]">
                <Gauge className="w-4 h-4" />
                <span>ADL {scores.adl}/12</span><span>·</span><span>Mob {scores.mobility}/6</span><span>·</span>
                <span>Cont {scores.continence}/4</span><span>·</span><span>Cog {scores.cognition}/8</span><span>·</span>
                <span>Nurse {scores.nursing}/8</span><span>·</span><span>Risk {scores.risk}/12</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold">{scores.total}<span className="text-sm text-[#D7DAD1] font-medium">/50</span></span>
                <span className="text-xs font-bold px-2.5 py-1 rounded" style={{ background: ["#7E9B6F", "#7E9B6F", "#C39A3E", "#C0573F", "#9E3B2A"][scores.level - 1] }}>{scores.levelLabel}</span>
              </div>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
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
                      <span className="text-sm font-medium text-[#2B2B27] w-28 shrink-0">{ADL_LABEL[item]}</span>
                      <div className="flex flex-wrap gap-1.5">
                        {ADL_LEVEL_OPTIONS.map((o) => {
                          const on = form.adl?.[item] === o.value;
                          return (
                            <button key={o.value} type="button" onClick={() => set({ adl: { ...form.adl, [item]: on ? undefined : (o.value as never) } })}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition ${on ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#4A4D44] border-[#D6D8CD] hover:border-[#2E4A48]/40"}`}>
                              {o.label}{o.points ? <span className={on ? "text-white/70 ml-1" : "text-[#8A8D82] ml-1"}>+{o.points}</span> : ""}
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
            <div className="border-t border-[#D6D8CD] px-5 py-3.5 flex items-center justify-between bg-white gap-2">
              <span className="text-xs text-[#8A8D82]">{editingId ? "Editing" : "New"} · {clinicianRole === "FACILITY_ADMIN" ? "Care Manager" : "Nurse"}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => save("DRAFT")} disabled={saving} className="px-4 py-2 rounded-lg border border-[#D6D8CD] text-[#2B2B27] text-sm font-medium hover:bg-[#F0F1EA] disabled:opacity-60">{saving ? "Saving…" : "Save Draft"}</button>
                <button onClick={() => save("COMPLETED")} disabled={saving} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#7E9B6F] text-white text-sm font-semibold hover:bg-[#6E8A60] disabled:opacity-60"><CheckCircle2 className="w-4 h-4" /> Complete Assessment</button>
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
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <ClinicalCard className="p-3.5">
      <MicroLabel>{label}</MicroLabel>
      <p className="text-2xl font-bold mt-0.5" style={{ color: tone }}>{value}</p>
    </ClinicalCard>
  );
}
