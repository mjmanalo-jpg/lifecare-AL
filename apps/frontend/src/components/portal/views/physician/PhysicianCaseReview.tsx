"use client";

import { useMemo, useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Stethoscope, Search, RefreshCw, HeartPulse, Pill, PenTool, AlertTriangle,
  Target, Signature, Plus, X, CheckCircle2, Loader2, ClipboardCheck,
  Eye, ChevronLeft, ChevronRight, UserRound, Clock, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { useClinician } from "@/components/portal/views/clinical/useClinician";

/**
 * Physician Case Review & Diagnosis — the physician's synthesis view. For one
 * patient it consolidates every care-team perspective (vitals, medications,
 * nurse/caregiver clinical notes, incidents, care-plan goals) and lets the
 * physician act with authority: record a diagnosis/assessment/directive and
 * co-sign the care team's documentation. Live via Supabase realtime + polling.
 */

type Row = Record<string, unknown>;
const asStr = (v: unknown): string => (v == null ? "" : String(v));
const PHYSICIAN_TYPES = new Set(["DIAGNOSIS", "ASSESSMENT", "DIRECTIVE", "CONSULTATION", "REFERRAL", "CARE_PLAN"]);

const VITAL_META: Record<string, { label: string }> = {
  HEART_RATE: { label: "HR" }, BLOOD_PRESSURE: { label: "BP" }, TEMPERATURE: { label: "Temp" },
  OXYGEN: { label: "O₂" }, RESPIRATORY_RATE: { label: "RR" }, BLOOD_GLUCOSE: { label: "Glucose" }, WEIGHT: { label: "Weight" },
};

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

const DX_TYPES = [
  { value: "DIAGNOSIS", label: "Diagnosis" },
  { value: "ASSESSMENT", label: "Assessment" },
  { value: "DIRECTIVE", label: "Care Directive" },
];

function CaseReviewInner() {
  const searchParams = useSearchParams();
  const clinician = useClinician("PHYSICIAN");

  const residentsQ = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const vitalsQ = useLiveQuery<Row>("vitals", { query: "take=800", tables: ["VitalsLog"] });
  const medsQ = useLiveQuery<Row>("medications", { query: "take=500", tables: ["Medication"] });
  const notesQ = useLiveQuery<Row>("medical-notes", { query: "take=600", tables: ["MedicalNote"] });
  const incidentsQ = useLiveQuery<Row>("incidents", { query: "take=400", tables: ["Incident"] });
  const goalsQ = useLiveQuery<Row>("resident-goals", { query: "take=400", tables: ["ResidentGoal"] });

  const residents = useMemo(() => residentsQ.data.map(adaptResident), [residentsQ.data]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [careFilter, setCareFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [showDx, setShowDx] = useState(false);
  const [viewNote, setViewNote] = useState<Row | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const PER_PAGE = 8;

  // Deep-link from Command Center (?resident=) or default to first patient.
  useEffect(() => {
    const q = searchParams.get("resident");
    if (q) { setSelectedId(q); return; }
    if (!selectedId && residents.length) setSelectedId(residents[0].id);
  }, [searchParams, residents, selectedId]);

  const careLevels = useMemo(() => Array.from(new Set(residents.map((r) => String(r.careLevel)).filter(Boolean))).sort(), [residents]);

  const filteredResidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return residents.filter((r) =>
      (!q || r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q)) &&
      (careFilter === "all" || String(r.careLevel) === careFilter)
    );
  }, [residents, search, careFilter]);

  useEffect(() => { setPage(1); }, [search, careFilter]);
  const totalPages = Math.max(1, Math.ceil(filteredResidents.length / PER_PAGE));
  const pageClamped = Math.min(page, totalPages);
  const pagedResidents = filteredResidents.slice((pageClamped - 1) * PER_PAGE, pageClamped * PER_PAGE);

  const selected = residents.find((r) => r.id === selectedId) ?? null;

  const latestVitals = useMemo(() => {
    const m = new Map<string, { value: string; unit: string; at: number }>();
    vitalsQ.data.filter((v) => asStr(v.residentId) === selectedId).forEach((v) => {
      const type = asStr(v.type); const at = v.recordedAt ? new Date(String(v.recordedAt)).getTime() : 0;
      const cur = m.get(type);
      if (!cur || at >= cur.at) m.set(type, { value: asStr(v.value), unit: asStr(v.unit), at });
    });
    return m;
  }, [vitalsQ.data, selectedId]);

  const activeMeds = useMemo(() => medsQ.data.filter((x) => asStr(x.residentId) === selectedId && asStr(x.status) === "ACTIVE"), [medsQ.data, selectedId]);
  const patientNotes = useMemo(() => notesQ.data.filter((n) => asStr(n.residentId) === selectedId && asStr(n.noteType) !== "MEDICATION_ADMIN")
    .sort((a, b) => new Date(asStr(b.createdAt)).getTime() - new Date(asStr(a.createdAt)).getTime()), [notesQ.data, selectedId]);
  const careTeamNotes = useMemo(() => patientNotes.filter((n) => !PHYSICIAN_TYPES.has(asStr(n.noteType))), [patientNotes]);
  const physicianNotes = useMemo(() => patientNotes.filter((n) => PHYSICIAN_TYPES.has(asStr(n.noteType))), [patientNotes]);
  const openIncidents = useMemo(() => incidentsQ.data.filter((i) => asStr(i.residentId) === selectedId && !i.resolvedAt), [incidentsQ.data, selectedId]);
  const goals = useMemo(() => goalsQ.data.filter((g) => asStr(g.residentId) === selectedId), [goalsQ.data, selectedId]);

  const refreshAll = () => { vitalsQ.refetch(); medsQ.refetch(); notesQ.refetch(); incidentsQ.refetch(); goalsQ.refetch(); };

  const coSign = async (noteId: string) => {
    setBusyId(noteId);
    try {
      const at = new Date().toISOString();
      await updateRecord("medical-notes", noteId, { coSignedBy: clinician.name, coSignedAt: at });
      await notesQ.refetch();
      setViewNote((v) => (v && asStr(v.id) === noteId ? { ...v, coSignedBy: clinician.name, coSignedAt: at } : v));
    } catch (err) {
      Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not co-sign.", icon: "error" });
    } finally { setBusyId(null); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-1 flex items-center gap-2">
            <Stethoscope className="w-7 h-7 text-yellow-500 flex-shrink-0" /> Case Review &amp; Diagnosis
          </h1>
          <p className="text-gray-600 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1 text-green-600"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Live</span>
            Consolidated chart across the care team — diagnose, direct &amp; co-sign
          </p>
        </div>
        <button onClick={refreshAll} className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition text-sm font-medium self-start">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Patient list */}
        <div className="bg-white rounded-lg border border-gray-200 p-3 h-fit">
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Find patient…" value={search} onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none" />
          </div>
          {/* Care-level filter */}
          <div className="flex gap-1.5 flex-wrap mb-3">
            <button onClick={() => setCareFilter("all")}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition border ${careFilter === "all" ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>All</button>
            {careLevels.map((c) => (
              <button key={c} onClick={() => setCareFilter(c)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition border ${careFilter === c ? "bg-yellow-400 text-black border-yellow-400" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>{c}</button>
            ))}
          </div>
          {filteredResidents.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No patients match.</p>
          ) : (
            <div className="space-y-1 max-h-[520px] overflow-y-auto">
              {pagedResidents.map((r) => (
                <button key={r.id} onClick={() => setSelectedId(r.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg transition text-sm ${selectedId === r.id ? "bg-yellow-100 text-yellow-800 font-semibold" : "hover:bg-gray-50 text-gray-700"}`}>
                  {r.name}
                  <span className="block text-xs text-gray-400 font-normal">Room {r.room} · {r.careLevel}</span>
                </button>
              ))}
            </div>
          )}
          {/* Pagination */}
          {filteredResidents.length > PER_PAGE && (
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-gray-100">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pageClamped === 1}
                className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition" title="Previous"><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs font-medium text-gray-600">Page {pageClamped} / {totalPages} · {filteredResidents.length} patients</span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={pageClamped === totalPages}
                className="p-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition" title="Next"><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>

        {/* Chart */}
        {!selected ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Select a patient to review.</div>
        ) : (
          <div className="space-y-4">
            {/* Header + actions */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-5 text-white flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold">{selected.name}</h2>
                <p className="text-blue-100 text-sm">Room {selected.room} · {selected.careLevel} · {selected.age ?? "—"} yrs{selected.allergies ? ` · Allergies: ${selected.allergies}` : ""}</p>
              </div>
              <button onClick={() => setShowDx(true)} className="flex items-center gap-2 px-4 py-2 bg-white text-blue-700 font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm">
                <Plus className="w-4 h-4" /> Record Diagnosis / Directive
              </button>
            </div>

            {/* Vitals */}
            <Section icon={HeartPulse} title="Latest Vitals" iconColor="text-red-500">
              {latestVitals.size === 0 ? <Empty text="No vitals recorded." /> : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {Array.from(latestVitals.entries()).map(([type, v]) => {
                    const bad = isAbnormal(type, v.value);
                    return (
                      <div key={type} className={`rounded-lg border p-2.5 ${bad ? "bg-red-50 border-red-200" : "bg-gray-50 border-gray-200"}`}>
                        <p className="text-[11px] font-semibold text-gray-500">{VITAL_META[type]?.label ?? type.replace(/_/g, " ")}</p>
                        <p className={`text-lg font-bold ${bad ? "text-red-600" : "text-gray-900"}`}>{v.value}<span className="text-xs font-normal text-gray-400"> {v.unit}</span></p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Active meds */}
            <Section icon={Pill} title={`Active Medications (${activeMeds.length})`} iconColor="text-yellow-500">
              {activeMeds.length === 0 ? <Empty text="No active medications." /> : (
                <div className="space-y-1.5">
                  {activeMeds.map((m) => (
                    <div key={asStr(m.id)} className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2">
                      <span className="font-medium text-gray-900">{asStr(m.name)} {asStr(m.dosage)}</span>
                      <span className="text-xs text-gray-500">{asStr(m.frequency)} · {asStr(m.route) || "oral"}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Care-team documentation — co-sign */}
            <Section icon={PenTool} title={`Care-Team Documentation (${careTeamNotes.length})`} iconColor="text-green-500">
              {careTeamNotes.length === 0 ? <Empty text="No nurse/caregiver notes." /> : (
                <div className="space-y-2">
                  {careTeamNotes.slice(0, 12).map((n) => {
                    const signed = !!n.coSignedBy; const busy = busyId === asStr(n.id);
                    return (
                      <div key={asStr(n.id)} className="border border-gray-100 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => setViewNote(n)} className="min-w-0 text-left flex-1">
                            <p className="text-sm font-semibold text-gray-900">{asStr(n.title) || asStr(n.noteType).replace(/_/g, " ") || "Note"}</p>
                            <p className="text-xs text-gray-500">{asStr(n.authorName) || "Care team"} · {n.createdAt ? new Date(asStr(n.createdAt)).toLocaleString() : ""}</p>
                          </button>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button onClick={() => setViewNote(n)} className="p-1.5 rounded hover:bg-blue-50 text-blue-600 transition" title="View"><Eye className="w-4 h-4" /></button>
                            {signed ? (
                              <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold whitespace-nowrap"><CheckCircle2 className="w-3.5 h-3.5" /> Co-signed</span>
                            ) : busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : (
                              <button onClick={() => coSign(asStr(n.id))} className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition whitespace-nowrap">
                                <Signature className="w-3.5 h-3.5" /> Co-sign
                              </button>
                            )}
                          </div>
                        </div>
                        {asStr(n.content) && <p className="text-xs text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">{asStr(n.content)}</p>}
                        {signed && <p className="text-[11px] text-green-600 mt-1">Reviewed by {asStr(n.coSignedBy)}{n.coSignedAt ? ` · ${new Date(asStr(n.coSignedAt)).toLocaleDateString()}` : ""}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            {/* Physician assessments */}
            <Section icon={ClipboardCheck} title={`Physician Assessments & Directives (${physicianNotes.length})`} iconColor="text-blue-500">
              {physicianNotes.length === 0 ? <Empty text="No diagnoses or directives yet." /> : (
                <div className="space-y-2">
                  {physicianNotes.slice(0, 10).map((n) => (
                    <button key={asStr(n.id)} onClick={() => setViewNote(n)} className="w-full text-left border-l-2 border-blue-400 bg-blue-50/40 hover:bg-blue-50 rounded-r-lg p-3 transition">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-700">{asStr(n.noteType).replace(/_/g, " ")}</span>
                        <span className="text-sm font-semibold text-gray-900">{asStr(n.title)}</span>
                        <Eye className="w-3.5 h-3.5 text-blue-500 ml-auto" />
                      </div>
                      <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap line-clamp-2">{asStr(n.content)}</p>
                      <p className="text-[11px] text-gray-500 mt-1">{asStr(n.authorName)} · {n.createdAt ? new Date(asStr(n.createdAt)).toLocaleString() : ""}</p>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {/* Open incidents + care goals side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Section icon={AlertTriangle} title={`Open Incidents (${openIncidents.length})`} iconColor="text-orange-500">
                {openIncidents.length === 0 ? <Empty text="No open incidents." /> : (
                  <div className="space-y-1.5">
                    {openIncidents.map((i) => (
                      <div key={asStr(i.id)} className="text-sm border border-orange-100 bg-orange-50/40 rounded-lg px-3 py-2">
                        <span className="font-semibold text-gray-900">{asStr(i.incidentType).replace(/_/g, " ")}</span>
                        <span className="ml-2 text-xs text-orange-700">{asStr(i.severity)}</span>
                        {asStr(i.description) && <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">{asStr(i.description)}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </Section>
              <Section icon={Target} title={`Care-Plan Goals (${goals.length})`} iconColor="text-purple-500">
                {goals.length === 0 ? <Empty text="No care-plan goals." /> : (
                  <div className="space-y-1.5">
                    {goals.slice(0, 8).map((g) => (
                      <div key={asStr(g.id)} className="flex items-center gap-2 text-sm border border-gray-100 rounded-lg px-3 py-2">
                        <CheckCircle2 className={`w-4 h-4 flex-shrink-0 ${g.isCompleted ? "text-green-500" : "text-gray-300"}`} />
                        <span className={g.isCompleted ? "line-through text-gray-400" : "text-gray-800"}>{asStr(g.title)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          </div>
        )}
      </div>

      {showDx && selected && (
        <DiagnosisModal residentName={selected.name} residentId={selected.id} authorName={clinician.name}
          onClose={() => setShowDx(false)} onSaved={() => { void notesQ.refetch(); setShowDx(false); }} />
      )}

      {/* Responsive note detail modal */}
      {viewNote && (() => {
        const n = viewNote;
        const isPhysician = PHYSICIAN_TYPES.has(asStr(n.noteType));
        const signed = !!n.coSignedBy;
        const busy = busyId === asStr(n.id);
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
              <div className={`sticky top-0 text-white p-5 flex items-start justify-between gap-3 z-10 ${isPhysician ? "bg-gradient-to-r from-blue-500 to-blue-600" : "bg-gradient-to-r from-green-500 to-green-600"}`}>
                <div className="min-w-0">
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-white/20">{asStr(n.noteType).replace(/_/g, " ") || "Note"}</span>
                  <h2 className="text-lg sm:text-xl font-bold mt-1 break-words">{asStr(n.title) || "Clinical Note"}</h2>
                </div>
                <button onClick={() => setViewNote(null)} className="p-2 hover:bg-white/20 rounded-lg transition flex-shrink-0"><X className="w-6 h-6" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> Author</p><p className="text-gray-900">{asStr(n.authorName) || "Care team"}</p></div>
                  <div><p className="text-xs font-semibold text-gray-500 mb-0.5 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Recorded</p><p className="text-gray-900">{n.createdAt ? new Date(asStr(n.createdAt)).toLocaleString() : "—"}</p></div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1">Note</p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-sm text-gray-900 whitespace-pre-wrap">{asStr(n.content) || "—"}</p>
                  </div>
                </div>
                {signed && (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Co-signed by {asStr(n.coSignedBy)}{n.coSignedAt ? ` · ${new Date(asStr(n.coSignedAt)).toLocaleString()}` : ""}
                  </div>
                )}
              </div>
              <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-end gap-2">
                <button onClick={() => setViewNote(null)} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition text-sm">Close</button>
                {!isPhysician && !signed && (
                  <button onClick={() => coSign(asStr(n.id))} disabled={busy}
                    className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50 text-sm">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Signature className="w-4 h-4" />} Co-sign
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function DiagnosisModal({ residentId, residentName, authorName, onClose, onSaved }: {
  residentId: string; residentName: string; authorName: string; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({ noteType: "DIAGNOSIS", title: "", content: "" });
  const [saving, setSaving] = useState(false);
  const valid = form.title.trim() && form.content.trim();
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      await createRecord("medical-notes", {
        residentId, title: form.title.trim(), content: form.content.trim(), noteType: form.noteType, authorName,
      });
      Swal.fire({ title: "Recorded", icon: "success", timer: 1300, showConfirmButton: false });
      onSaved();
    } catch (err) {
      setSaving(false);
      Swal.fire({ title: "Save Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" });
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white p-5 flex items-center justify-between z-10">
          <div><h2 className="text-xl font-bold">Record Diagnosis / Directive</h2><p className="text-blue-100 text-sm">{residentName}</p></div>
          <button onClick={onClose} className="p-2 hover:bg-white/20 rounded-lg transition"><X className="w-6 h-6" /></button>
        </div>
        <form onSubmit={submit}>
          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Type</label>
              <select value={form.noteType} onChange={(e) => setForm((f) => ({ ...f, noteType: e.target.value }))} className={inputCls}>
                {DX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Title <span className="text-red-500">*</span></label>
              <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Stage 2 hypertension — adjust regimen" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Details <span className="text-red-500">*</span></label>
              <textarea value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={6}
                placeholder="Clinical reasoning, orders to the care team, follow-up plan…" className={`${inputCls} resize-y`} />
            </div>
          </div>
          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
            <button type="button" onClick={onClose} className="px-5 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition">Cancel</button>
            <button type="submit" disabled={!valid || saving}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-blue-400 to-blue-500 text-white font-semibold rounded-lg hover:shadow-lg transition disabled:opacity-50">
              <ClipboardCheck className="w-4 h-4" /> {saving ? "Saving…" : "Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, iconColor, children }: { icon: LucideIcon; title: string; iconColor: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-3"><Icon className={`w-5 h-5 ${iconColor}`} /><h3 className="font-bold text-gray-900 text-sm">{title}</h3></div>
      {children}
    </div>
  );
}
function Empty({ text }: { text: string }) { return <p className="text-sm text-gray-400 py-3 text-center">{text}</p>; }

export default function PhysicianCaseReview() {
  return (
    <Suspense fallback={<div className="bg-white rounded-lg border border-gray-200 p-12 text-center text-gray-500">Loading case review…</div>}>
      <CaseReviewInner />
    </Suspense>
  );
}
