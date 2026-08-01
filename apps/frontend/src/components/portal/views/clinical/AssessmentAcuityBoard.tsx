"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ClipboardList, Search, Plus, X, RefreshCw, CheckCircle2, Activity,
  Brain, Footprints, HeartPulse, Smile, Utensils, Droplets, Shield, Users,
  Gauge, Clock, Trash2, Loader2, TrendingUp, type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, deleteRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const selectCls = inputCls + " bg-white";
const btnPrimary = "px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium text-sm transition-colors disabled:opacity-50";
const btnSecondary = "px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-xs font-medium";

// 9 assessment dimensions, scored 1 (independent / best) → 5 (total dependence / most acute).
const DIMENSIONS: { key: DimKey; label: string; icon: LucideIcon; hint: string }[] = [
  { key: "adl", label: "ADL / Self-Care", icon: Activity, hint: "Bathing, dressing, toileting, eating" },
  { key: "cognition", label: "Cognition", icon: Brain, hint: "Memory, orientation, decision-making" },
  { key: "mobility", label: "Mobility", icon: Footprints, hint: "Transfers, ambulation, fall risk" },
  { key: "medical", label: "Medical Complexity", icon: HeartPulse, hint: "Conditions, treatments, monitoring" },
  { key: "behavioral", label: "Behavioral", icon: Smile, hint: "Agitation, wandering, mood" },
  { key: "nutrition", label: "Nutrition", icon: Utensils, hint: "Intake, feeding assistance, diet" },
  { key: "hydration", label: "Hydration", icon: Droplets, hint: "Fluid intake, dehydration risk" },
  { key: "skinIntegrity", label: "Skin Integrity", icon: Shield, hint: "Wounds, pressure-injury risk" },
  { key: "socialEngagement", label: "Social Engagement", icon: Users, hint: "Participation, isolation risk" },
];

type DimKey = "adl" | "cognition" | "mobility" | "medical" | "behavioral" | "nutrition" | "hydration" | "skinIntegrity" | "socialEngagement";
type Scores = Record<DimKey, number>;

const ASSESSMENT_TYPES = ["ADMISSION", "ANNUAL", "QUARTERLY", "CONDITION_CHANGE", "CARE_PLAN_REVIEW", "DISCHARGE", "TRANSFER"];

const SCORE_LABELS = ["", "Independent", "Minimal", "Moderate", "Extensive", "Total"];

const ACUITY_BADGE: Record<string, string> = {
  LOW: "bg-green-100 text-green-700",
  MODERATE: "bg-yellow-100 text-yellow-700",
  HIGH: "bg-orange-100 text-orange-700",
  CRITICAL: "bg-red-100 text-red-700",
};
const CARE_BADGE: Record<string, string> = {
  INDEPENDENT: "bg-green-100 text-green-700",
  ASSISTED: "bg-blue-100 text-blue-700",
  MEMORY: "bg-purple-100 text-purple-700",
  SKILLED: "bg-red-100 text-red-700",
};

/** Shared acuity math — mirrors the seed's computeAcuity so UI + data agree. */
function computeAcuity(s: Scores) {
  const total = DIMENSIONS.reduce((sum, d) => sum + (s[d.key] || 0), 0);
  const pct = Math.round((total / 45) * 100);
  const acuityLevel = pct < 40 ? "LOW" : pct < 60 ? "MODERATE" : pct < 80 ? "HIGH" : "CRITICAL";
  let careLevel: string;
  if (s.cognition >= 4 || s.behavioral >= 4) careLevel = "MEMORY";
  else if (pct < 30) careLevel = "INDEPENDENT";
  else if (pct < 65) careLevel = "ASSISTED";
  else careLevel = "SKILLED";
  const dailyCareMinutes = acuityLevel === "LOW" ? 60 : acuityLevel === "MODERATE" ? 120 : acuityLevel === "HIGH" ? 210 : 320;
  const shiftBreakdown = { DAY: Math.round(dailyCareMinutes * 0.45), EVENING: Math.round(dailyCareMinutes * 0.35), NIGHT: Math.round(dailyCareMinutes * 0.20) };
  const staffingDemand = { nurseMinutes: Math.round(dailyCareMinutes * 0.35), caregiverMinutes: Math.round(dailyCareMinutes * 0.65) };
  const confidence = Math.round((0.75 + Math.min(0.2, Math.abs(pct - 50) / 250)) * 100) / 100;
  return { total, pct, acuityLevel, careLevel, dailyCareMinutes, shiftBreakdown, staffingDemand, confidence };
}

const DEFAULT_SCORES: Scores = { adl: 2, cognition: 2, mobility: 2, medical: 2, behavioral: 1, nutrition: 2, hydration: 2, skinIntegrity: 1, socialEngagement: 2 };

export default function AssessmentAcuityBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName, userId: clinicianId } = useClinician(clinicianRole);
  const [selectedResident, setSelectedResident] = useState<string>("");
  const [searchRes, setSearchRes] = useState("");
  const [showForm, setShowForm] = useState(false);

  const resQ = useLiveQuery("residents", { query: "take=300", tables: ["Resident"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assessQ = useLiveQuery<any>("assessments", { query: "take=300&include=acuityScore", tables: ["Assessment", "AcuityScore"] });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commQ = useLiveQuery<any>("communities", { query: "take=20", tables: ["Community"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const resMap = useMemo(() => new Map(residents.map((r) => [r.id, r])), [residents]);

  const filteredResidents = useMemo(() => {
    if (!searchRes) return residents;
    const q = searchRes.toLowerCase();
    return residents.filter((r) => r.name?.toLowerCase().includes(q) || String(r.room).toLowerCase().includes(q));
  }, [residents, searchRes]);

  // Latest current acuity per resident, for the picker badges.
  const latestByResident = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = new Map<string, any>();
    (assessQ.data || []).forEach((a: any) => {
      const prev = m.get(a.residentId);
      if (!prev || new Date(a.createdAt).getTime() > new Date(prev.createdAt).getTime()) m.set(a.residentId, a);
    });
    return m;
  }, [assessQ.data]);

  const residentAssessments = useMemo(() => {
    if (!selectedResident) return [];
    return (assessQ.data || [])
      .filter((a: any) => a.residentId === selectedResident)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [assessQ.data, selectedResident]);

  const resolveCommunityId = useCallback((residentId: string): string => {
    const r = resMap.get(residentId);
    const fromResident = r?.raw?.communityId;
    if (fromResident) return String(fromResident);
    const firstComm = (commQ.data || [])[0];
    return firstComm ? String(firstComm.id) : "";
  }, [resMap, commQ.data]);

  const handleDelete = async (assessmentId: string) => {
    const result = await Swal.fire({ title: "Delete assessment?", text: "This also removes its acuity score.", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (!result.isConfirmed) return;
    await deleteRecord("assessments", assessmentId); // AcuityScore cascades on delete
    await assessQ.refetch();
  };

  // ── Resident picker ──────────────────────────────────────────────────────
  if (!selectedResident) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <Gauge className="w-5 h-5 text-emerald-600" /> Assessment &amp; Level of Care
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">Multi-dimensional acuity scoring → care-level assignment &amp; staffing demand</p>
          </div>
          <span className="text-sm text-gray-500">{clinicianName}</span>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={searchRes} onChange={(e) => setSearchRes(e.target.value)} placeholder="Search resident name or room..." className={inputCls + " pl-10"} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredResidents.map((r) => {
              const latest = latestByResident.get(r.id);
              const acuity = latest?.acuityScore;
              return (
                <button key={r.id} onClick={() => { setSelectedResident(r.id); setShowForm(false); }}
                  className="text-left p-4 border-2 rounded-xl hover:border-emerald-400 hover:bg-emerald-50 transition-all">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{r.name}</p>
                      <p className="text-xs text-gray-500">Room {r.room} · <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${CARE_BADGE[r.careLevel] || "bg-gray-100 text-gray-600"}`}>{r.careLevel}</span></p>
                    </div>
                    {acuity ? (
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold shrink-0 ${ACUITY_BADGE[acuity.acuityLevel] || "bg-gray-100 text-gray-600"}`}>{acuity.acuityLevel}</span>
                    ) : (
                      <span className="px-2 py-1 bg-gray-100 text-gray-400 rounded-full text-[10px] font-medium shrink-0">No assessment</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Selected resident: history + new-assessment form ───────────────────────
  const current = resMap.get(selectedResident);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedResident(""); setShowForm(false); }} className="text-gray-500 hover:text-gray-700 text-sm">← Back</button>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-emerald-600" /> {current?.name || "Resident"}
          </h2>
          <span className="text-xs text-gray-400">Room {current?.room}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void assessQ.refetch()} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5 inline mr-1" /> Refresh</button>
          <button onClick={() => setShowForm((v) => !v)} className={btnPrimary}><Plus className="w-4 h-4 inline mr-1" /> New Assessment</button>
        </div>
      </div>

      {showForm && (
        <AssessmentForm
          clinicianName={clinicianName}
          clinicianId={clinicianId}
          communityId={resolveCommunityId(selectedResident)}
          residentId={selectedResident}
          onDone={async () => { setShowForm(false); await assessQ.refetch(); await resQ.refetch(); }}
        />
      )}

      {residentAssessments.length === 0 && !showForm ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No assessments yet. Click <b>New Assessment</b> to score this resident.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {residentAssessments.map((a: any, idx: number) => {
            const acuity = a.acuityScore;
            return (
              <div key={a.id} className="bg-white rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-bold">{String(a.assessmentType).replace(/_/g, " ")}</span>
                    {idx === 0 && <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-bold">CURRENT</span>}
                    {acuity && <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${ACUITY_BADGE[acuity.acuityLevel]}`}>Acuity: {acuity.acuityLevel}</span>}
                    {acuity && <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${CARE_BADGE[acuity.careLevel]}`}>{acuity.careLevel}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(a.completedAt || a.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => handleDelete(a.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>

                {/* Dimension score bars */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1.5 mb-3">
                  {DIMENSIONS.map((d) => {
                    const val = a[`${d.key}Score`] ?? 0;
                    return (
                      <div key={d.key} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-500 w-28 shrink-0 truncate">{d.label}</span>
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${val <= 2 ? "bg-green-400" : val === 3 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${(val / 5) * 100}%` }} />
                        </div>
                        <span className="text-[11px] font-bold text-gray-700 w-4 text-right">{val}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-xs border-t pt-2 flex-wrap gap-2">
                  <span className="text-gray-500">Raw score <b className="text-gray-800">{a.totalRawScore}</b>/{a.maxPossibleScore} · by {a.assessedByName}</span>
                  {acuity && (
                    <div className="flex items-center gap-3 text-gray-600">
                      <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3 text-emerald-500" /> {acuity.dailyCareMinutes} care min/day</span>
                      <span className="text-gray-400">
                        D {acuity.shiftBreakdown?.DAY ?? "—"} / E {acuity.shiftBreakdown?.EVENING ?? "—"} / N {acuity.shiftBreakdown?.NIGHT ?? "—"}
                      </span>
                      {acuity.careLevelConfidence != null && <span className="text-gray-400">conf {Math.round(acuity.careLevelConfidence * 100)}%</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── New-assessment form with live acuity preview ──────────────────────────── */

function AssessmentForm({ clinicianName, clinicianId, communityId, residentId, onDone }: {
  clinicianName: string; clinicianId: string; communityId: string; residentId: string; onDone: () => void;
}) {
  const [scores, setScores] = useState<Scores>({ ...DEFAULT_SCORES });
  const [type, setType] = useState("QUARTERLY");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => computeAcuity(scores), [scores]);

  const setDim = (k: DimKey, v: number) => setScores((s) => ({ ...s, [k]: v }));

  const handleSave = async () => {
    if (!communityId) {
      Swal.fire("Missing community", "This resident isn't linked to a community yet. Re-run the seed to link communities.", "warning");
      return;
    }
    setSaving(true);
    try {
      const c = computeAcuity(scores);
      const res = await createRecord("assessments", {
        residentId, communityId, assessmentType: type, status: "COMPLETED",
        adlScore: scores.adl, cognitionScore: scores.cognition, mobilityScore: scores.mobility,
        medicalScore: scores.medical, behavioralScore: scores.behavioral, nutritionScore: scores.nutrition,
        hydrationScore: scores.hydration, skinIntegrityScore: scores.skinIntegrity, socialEngagementScore: scores.socialEngagement,
        totalRawScore: c.total, dimensionCount: 9, maxPossibleScore: 45,
        assessedById: clinicianId || null, assessedByName: clinicianName,
        assessmentTool: "LCMS 9-Dimension Acuity", notes: notes || null, completedAt: new Date().toISOString(),
      });
      const assessmentId = res?.data?.id;
      if (!assessmentId) throw new Error("Assessment did not return an id");
      await createRecord("acuity-scores", {
        assessmentId, residentId, communityId,
        dimensionScores: scores, weightedScore: c.pct, normalizedScore: c.pct,
        acuityLevel: c.acuityLevel, careLevel: c.careLevel, careLevelConfidence: c.confidence,
        dailyCareMinutes: c.dailyCareMinutes, shiftBreakdown: c.shiftBreakdown, staffingDemand: c.staffingDemand,
        weightsUsed: { perDimension: 1, dimensions: 9 }, weightVersion: "v1.0",
        scoredById: clinicianId || null, isCurrent: true,
      });
      Swal.fire({ title: "Assessment saved", text: `Acuity ${c.acuityLevel} · Care level ${c.careLevel}`, icon: "success", timer: 1600, showConfirmButton: false });
      onDone();
    } catch (err) {
      Swal.fire("Save failed", err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-gray-50 rounded-xl border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm text-gray-700">New Assessment</h4>
        <button onClick={onDone} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Scoring column (spans 2) */}
        <div className="lg:col-span-2 space-y-3">
          <div>
            <label className={labelCls}>Assessment Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
              {ASSESSMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div className="space-y-2.5">
            {DIMENSIONS.map((d) => {
              const Icon = d.icon;
              const val = scores[d.key];
              return (
                <div key={d.key} className="bg-white rounded-lg border p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                      <Icon className="w-3.5 h-3.5 text-emerald-500" /> {d.label}
                    </span>
                    <span className="text-[11px] text-gray-500">{SCORE_LABELS[val]} ({val})</span>
                  </div>
                  <div className="flex gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} type="button" onClick={() => setDim(d.key, n)}
                        className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors ${
                          val === n
                            ? n <= 2 ? "bg-green-500 text-white" : n === 3 ? "bg-yellow-500 text-white" : "bg-red-500 text-white"
                            : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                        }`} title={SCORE_LABELS[n]}>{n}</button>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">{d.hint}</p>
                </div>
              );
            })}
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls + " resize-none"} placeholder="Clinical context for this assessment..." />
          </div>
        </div>

        {/* Live acuity preview column */}
        <div className="space-y-3">
          <div className="bg-white rounded-xl border p-4 sticky top-2">
            <h5 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Computed Result</h5>
            <div className="text-center mb-3">
              <div className="text-4xl font-black text-gray-900">{preview.pct}<span className="text-lg text-gray-400">%</span></div>
              <p className="text-[11px] text-gray-500">acuity index · {preview.total}/45 raw</p>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className={`rounded-lg p-2 text-center ${ACUITY_BADGE[preview.acuityLevel]}`}>
                <p className="text-[10px] font-semibold uppercase opacity-70">Acuity</p>
                <p className="text-sm font-bold">{preview.acuityLevel}</p>
              </div>
              <div className={`rounded-lg p-2 text-center ${CARE_BADGE[preview.careLevel]}`}>
                <p className="text-[10px] font-semibold uppercase opacity-70">Care Level</p>
                <p className="text-sm font-bold">{preview.careLevel}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-xs text-gray-600 border-t pt-2">
              <div className="flex justify-between"><span>Daily care</span><b>{preview.dailyCareMinutes} min</b></div>
              <div className="flex justify-between"><span>Day / Eve / Night</span><span className="text-gray-500">{preview.shiftBreakdown.DAY} / {preview.shiftBreakdown.EVENING} / {preview.shiftBreakdown.NIGHT}</span></div>
              <div className="flex justify-between"><span>Nurse / Caregiver</span><span className="text-gray-500">{preview.staffingDemand.nurseMinutes} / {preview.staffingDemand.caregiverMinutes} min</span></div>
              <div className="flex justify-between"><span>Confidence</span><b>{Math.round(preview.confidence * 100)}%</b></div>
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} className={btnPrimary + " w-full flex items-center justify-center gap-1"}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Save Assessment
          </button>
        </div>
      </div>
    </div>
  );
}
