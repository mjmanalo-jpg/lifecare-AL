"use client";

import { useState } from "react";
import { X, Gauge, ShieldCheck, ClipboardList, RefreshCw, Plus, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import Swal from "@/lib/swal";
import { ClinicalCard, MicroLabel, StatusPill } from "./clinical-ui";
import {
  ACUITY_LEVELS, levelLabel, levelColor, deriveProblems, computeNextReview,
  isReassessmentDue, REASSESSMENT_OPTIONS,
  type PreAdmissionAssessment, type CarePlanProblem, type ValidationDecision,
} from "@/lib/preadmissionAssessment";

const input = "w-full rounded-lg border border-[#D6D8CD] px-3 py-2 text-sm text-[#2B2B27] bg-white outline-none focus:ring-2 focus:ring-[#2E4A48]/25";
const RESPONSIBLE = ["Caregiver", "Nurse", "Care Manager", "Physician", "Nutritionist"];
const PROBLEM_STATUS: CarePlanProblem["status"][] = ["OPEN", "IN_PROGRESS", "MET", "DISCONTINUED"];
const DECISIONS: { value: ValidationDecision; label: string }[] = [
  { value: "APPROVED", label: "Approve" },
  { value: "APPROVED_WITH_CHANGES", label: "Approve with changes" },
  { value: "NEEDS_REASSESSMENT", label: "Needs reassessment" },
];

export default function LevelOfCareReview({
  assessment, me, clinicianRole, onClose, onSave, onStartReassessment,
}: {
  assessment: PreAdmissionAssessment;
  me: string;
  clinicianRole: string;
  onClose: () => void;
  onSave: (updated: PreAdmissionAssessment) => Promise<void>;
  onStartReassessment: (prior: PreAdmissionAssessment) => Promise<void>;
}) {
  const roleLabel = clinicianRole === "FACILITY_ADMIN" ? "Care Manager" : "Nurse";
  const computed = assessment.scores?.level ?? 1;

  const [ovLevel, setOvLevel] = useState<number | "">(assessment.overrideLevel ?? "");
  const [ovReason, setOvReason] = useState(assessment.overrideReason ?? "");
  const [rInterval, setRInterval] = useState(assessment.reassessment ?? "");
  const [problems, setProblems] = useState<CarePlanProblem[] | null>(assessment.carePlan?.problems ?? null);
  const [vDecision, setVDecision] = useState<ValidationDecision>(assessment.validation?.decision ?? "APPROVED");
  const [vNotes, setVNotes] = useState(assessment.validation?.notes ?? "");
  const [busy, setBusy] = useState(false);

  // Local state initializes from props on mount; the parent passes key={id} so a
  // different assessment remounts this cleanly (no re-seed effect, no clobbering
  // of in-progress edits after a save re-renders with the same id).
  const effLevel = ovLevel === "" ? computed : Number(ovLevel);
  const due = isReassessmentDue(assessment.nextReviewDate, new Date().toISOString());

  const buildUpdated = (extra: Partial<PreAdmissionAssessment>): PreAdmissionAssessment => {
    const now = new Date().toISOString();
    const overridden = ovLevel !== "" && Number(ovLevel) !== computed;
    return {
      ...assessment,
      overrideLevel: overridden ? Number(ovLevel) : undefined,
      overrideReason: overridden ? (ovReason || undefined) : undefined,
      overrideBy: overridden ? (me || "Clinician") : undefined,
      reassessment: rInterval || assessment.reassessment,
      carePlan: problems ? { problems, generatedAt: assessment.carePlan?.generatedAt ?? now, updatedAt: now, generatedBy: assessment.carePlan?.generatedBy ?? me } : assessment.carePlan,
      updatedAt: now,
      ...extra,
    };
  };

  const persist = async (extra: Partial<PreAdmissionAssessment>, toast?: string) => {
    setBusy(true);
    try { await onSave(buildUpdated(extra)); if (toast) Swal.fire({ title: toast, icon: "success", timer: 1400, showConfirmButton: false }); }
    catch (e) { Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Could not save.", icon: "error" }); }
    finally { setBusy(false); }
  };

  const validate = async () => {
    if (ovLevel !== "" && Number(ovLevel) !== computed && !ovReason.trim()) {
      Swal.fire({ title: "Override reason required", text: "Enter a clinical reason when overriding the calculated level.", icon: "warning" }); return;
    }
    const now = new Date().toISOString();
    await persist(
      { status: "VALIDATED", validation: { by: me || "Clinician", role: roleLabel, at: now, decision: vDecision, notes: vNotes || undefined }, nextReviewDate: computeNextReview(now, rInterval || assessment.reassessment) ?? undefined },
      "Level of Care validated",
    );
  };

  const startReassessment = async () => {
    const c = await Swal.fire({ title: "Start reassessment?", text: "Creates a new draft assessment carrying this clinical picture forward.", icon: "question", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Start" });
    if (!c.isConfirmed) return;
    setBusy(true);
    try { await onStartReassessment(assessment); } finally { setBusy(false); }
  };

  // ── Care-plan problem editing ──────────────────────────────────────────────
  const patchProblem = (i: number, patch: Partial<CarePlanProblem>) => setProblems((ps) => (ps ?? []).map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeProblem = (i: number) => setProblems((ps) => (ps ?? []).filter((_, idx) => idx !== i));
  const addProblem = () => setProblems((ps) => [...(ps ?? []), { id: `custom-${(ps?.length ?? 0)}-${Date.now()}`, domain: "CUSTOM", problem: "", goal: "", interventions: [], frequency: "", responsible: "Caregiver", expectedOutcome: "", status: "OPEN" }]);
  const generate = () => setProblems(deriveProblems(assessment));

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
      <div className="bg-[#F4F5F0] rounded-2xl shadow-2xl w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#D7DAD1]">Level of Care · Validation · Care Plan</p>
            <h2 className="text-lg font-bold" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{assessment.residentName || "Assessment"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusPill status={assessment.status === "VALIDATED" ? "APPROVED" : assessment.status} />
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4">
          {/* Stage 5 — Level of Care + override */}
          <ClinicalCard top="teal" className="p-4 sm:p-5">
            <h3 className="text-sm font-bold text-[#2B2B27] mb-3 flex items-center gap-2"><Gauge className="w-4 h-4 text-[#2E4A48]" /> Level of Care Calculation</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg border border-[#E1E3D9] p-3">
                <MicroLabel>Assessment Total</MicroLabel>
                <p className="text-2xl font-bold text-[#2E4A48] mt-0.5">{assessment.scores?.total ?? 0}<span className="text-sm text-[#8A8D82]">/50</span></p>
              </div>
              <div className="rounded-lg border border-[#E1E3D9] p-3">
                <MicroLabel>Calculated Level</MicroLabel>
                <p className="text-sm font-bold mt-1.5" style={{ color: levelColor(computed) }}>{levelLabel(computed)}</p>
              </div>
              <div className="rounded-lg border p-3" style={{ borderColor: levelColor(effLevel), background: `${levelColor(effLevel)}0F` }}>
                <MicroLabel>Effective Level {ovLevel !== "" && Number(ovLevel) !== computed ? "(overridden)" : ""}</MicroLabel>
                <p className="text-sm font-bold mt-1.5" style={{ color: levelColor(effLevel) }}>{levelLabel(effLevel)}</p>
              </div>
            </div>
            <MicroLabel className="mb-1.5">Clinical Override</MicroLabel>
            <div className="flex flex-wrap gap-1.5 mb-2">
              <button type="button" onClick={() => setOvLevel("")} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${ovLevel === "" ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#4A4D44] border-[#D6D8CD]"}`}>Use calculated</button>
              {ACUITY_LEVELS.map((l) => (
                <button key={l.level} type="button" onClick={() => setOvLevel(l.level)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${ovLevel === l.level ? "bg-[#C0573F] text-white border-[#C0573F]" : "bg-white text-[#4A4D44] border-[#D6D8CD]"}`}>L{l.level}</button>
              ))}
            </div>
            {ovLevel !== "" && Number(ovLevel) !== computed && (
              <input value={ovReason} onChange={(e) => setOvReason(e.target.value)} placeholder="Clinical reason for override (required)…" className={input} />
            )}
          </ClinicalCard>

          {/* Stage 6–7 — Validation & clinical decision */}
          <ClinicalCard top="teal" className="p-4 sm:p-5">
            <h3 className="text-sm font-bold text-[#2B2B27] mb-3 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-[#2E4A48]" /> Clinical Validation & Decision</h3>
            {assessment.validation ? (
              <div className="rounded-lg bg-[#7E9B6F]/10 border border-[#7E9B6F]/30 p-3 text-sm text-[#2B2B27] mb-3">
                <span className="font-semibold">{assessment.validation.decision.replace(/_/g, " ")}</span> — validated by {assessment.validation.by} ({assessment.validation.role}) on {assessment.validation.at.slice(0, 10)}.
                {assessment.validation.notes && <p className="text-[#4A4D44] mt-1">{assessment.validation.notes}</p>}
              </div>
            ) : (
              <p className="text-xs text-[#8A8D82] mb-3">Not yet validated. Sign off to confirm the Level of Care before the care plan goes live.</p>
            )}
            <MicroLabel className="mb-1.5">Decision</MicroLabel>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {DECISIONS.map((d) => (
                <button key={d.value} type="button" onClick={() => setVDecision(d.value)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${vDecision === d.value ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-[#4A4D44] border-[#D6D8CD]"}`}>{d.label}</button>
              ))}
            </div>
            <textarea rows={2} value={vNotes} onChange={(e) => setVNotes(e.target.value)} placeholder="Decision notes — what does this resident actually need?" className={input} />
            <div className="flex items-center gap-2 mt-3">
              <button onClick={validate} disabled={busy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] disabled:opacity-60"><CheckCircle2 className="w-4 h-4" /> {assessment.status === "VALIDATED" ? "Re-validate" : "Validate Level of Care"}</button>
            </div>
          </ClinicalCard>

          {/* Stage 8 — Individualized care plan */}
          <ClinicalCard top="teal" className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-bold text-[#2B2B27] flex items-center gap-2"><ClipboardList className="w-4 h-4 text-[#2E4A48]" /> Individualized Care Plan</h3>
              <div className="flex items-center gap-2">
                <button onClick={generate} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2E4A48] text-[#2E4A48] text-xs font-semibold hover:bg-[#2E4A48]/8"><RefreshCw className="w-3.5 h-3.5" /> {problems ? "Regenerate" : "Generate from assessment"}</button>
                {problems && <button onClick={addProblem} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#D6D8CD] text-[#4A4D44] text-xs font-semibold hover:bg-white"><Plus className="w-3.5 h-3.5" /> Add</button>}
              </div>
            </div>
            {!problems ? (
              <p className="text-xs text-[#8A8D82]">No care plan yet. <b>Generate from assessment</b> seeds problems, goals, interventions and expected outcomes from the flagged domains — then refine.</p>
            ) : problems.length === 0 ? (
              <p className="text-xs text-[#8A8D82]">No problems. Click <b>Add</b> to create one, or <b>Regenerate</b>.</p>
            ) : (
              <div className="space-y-3">
                {problems.map((p, i) => (
                  <div key={p.id} className="rounded-lg border border-[#E1E3D9] bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-white px-2 py-0.5 rounded" style={{ background: "#3C5A55" }}>{p.domain}</span>
                      <div className="flex items-center gap-2">
                        <select value={p.status} onChange={(e) => patchProblem(i, { status: e.target.value as CarePlanProblem["status"] })} className="text-xs rounded border border-[#D6D8CD] px-2 py-1 bg-white">
                          {PROBLEM_STATUS.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
                        </select>
                        <button onClick={() => removeProblem(i)} className="p-1 rounded hover:bg-[#F3E2DD] text-[#C0573F]"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <input value={p.problem} onChange={(e) => patchProblem(i, { problem: e.target.value })} placeholder="Problem" className={`${input} font-semibold`} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={p.goal} onChange={(e) => patchProblem(i, { goal: e.target.value })} placeholder="Goal" className={input} />
                      <input value={p.expectedOutcome} onChange={(e) => patchProblem(i, { expectedOutcome: e.target.value })} placeholder="Expected outcome" className={input} />
                    </div>
                    <textarea rows={2} value={p.interventions.join("\n")} onChange={(e) => patchProblem(i, { interventions: e.target.value.split("\n").filter(Boolean) })} placeholder="Interventions (one per line)" className={input} />
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input value={p.frequency} onChange={(e) => patchProblem(i, { frequency: e.target.value })} placeholder="Frequency" className={input} />
                      <select value={p.responsible} onChange={(e) => patchProblem(i, { responsible: e.target.value })} className={input}>
                        {RESPONSIBLE.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ClinicalCard>

          {/* Stage 13 — Reassessment cycle */}
          <ClinicalCard top={due ? "coral" : "teal"} className="p-4 sm:p-5">
            <h3 className="text-sm font-bold text-[#2B2B27] mb-3 flex items-center gap-2"><RefreshCw className="w-4 h-4 text-[#2E4A48]" /> Periodic Reassessment</h3>
            <MicroLabel className="mb-1.5">Reassessment Interval</MicroLabel>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {REASSESSMENT_OPTIONS.map((o) => (
                <button key={o} type="button" onClick={() => setRInterval(o)} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${rInterval === o ? "bg-[#3C5A55] text-white border-[#3C5A55]" : "bg-white text-[#4A4D44] border-[#D6D8CD]"}`}>{o}</button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {assessment.nextReviewDate ? (
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${due ? "text-[#C0573F]" : "text-[#2E4A48]"}`}>
                  {due && <AlertTriangle className="w-4 h-4" />} Next review: {assessment.nextReviewDate.slice(0, 10)}{due ? " — due now" : ""}
                </span>
              ) : (
                <span className="text-xs text-[#8A8D82]">Next review date is set when the Level of Care is validated.</span>
              )}
              <button onClick={startReassessment} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#2E4A48] text-[#2E4A48] text-xs font-semibold hover:bg-[#2E4A48]/8 disabled:opacity-60"><RefreshCw className="w-3.5 h-3.5" /> Start Reassessment</button>
            </div>
            {assessment.priorAssessmentId && <p className="text-[11px] text-[#8A8D82] mt-2">This is a reassessment carried forward from a prior assessment.</p>}
          </ClinicalCard>
        </div>

        {/* Footer */}
        <div className="border-t border-[#D6D8CD] px-5 py-3.5 flex items-center justify-between bg-white gap-2">
          <span className="text-xs text-[#8A8D82]">{roleLabel} review</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#D6D8CD] text-[#2B2B27] text-sm font-medium hover:bg-[#F0F1EA]">Close</button>
            <button onClick={() => persist({}, "Saved")} disabled={busy} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg bg-[#7E9B6F] text-white text-sm font-semibold hover:bg-[#6E8A60] disabled:opacity-60"><CheckCircle2 className="w-4 h-4" /> Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
