"use client";
import { useMemo, useState, useEffect } from "react";
import {
  Droplets, Thermometer, Bed, Footprints, Activity, Search, Plus, X,
  RefreshCw, CheckCircle2, Clock, Trash2, ChevronLeft, ChevronRight,
  Loader2, type LucideIcon,
} from "lucide-react";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, deleteRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const PER_PAGE = 15;

type TabKey = "elimination" | "pain" | "wound" | "sleep" | "mobility";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "elimination", label: "Elimination", icon: Droplets },
  { key: "pain", label: "Pain", icon: Activity },
  { key: "wound", label: "Wound Care", icon: Thermometer },
  { key: "sleep", label: "Sleep", icon: Bed },
  { key: "mobility", label: "Mobility", icon: Footprints },
];

export default function DailyDocumentation({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const [tab, setTab] = useState<TabKey>("elimination");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const elimQ = useLiveQuery("eliminations", { query: "take=500", tables: ["EliminationLog"] });
  const painQ = useLiveQuery("pain-assessments", { query: "take=500", tables: ["PainAssessment"] });
  const woundQ = useLiveQuery("wound-cares", { query: "take=500", tables: ["WoundCare"] });
  const sleepQ = useLiveQuery("sleep-logs", { query: "take=500", tables: ["SleepLog"] });
  const mobilityQ = useLiveQuery("mobility-logs", { query: "take=500", tables: ["MobilityLog"] });
  const resQ = useLiveQuery("residents", { tables: ["Resident"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);

  const getRows = () => {
    switch (tab) {
      case "elimination": return elimQ.data || [];
      case "pain": return painQ.data || [];
      case "wound": return woundQ.data || [];
      case "sleep": return sleepQ.data || [];
      case "mobility": return mobilityQ.data || [];
    }
  };

  const rows = getRows();
  const filtered = useMemo(() => {
    if (!search) return rows;
    const q = search.toLowerCase();
    return rows.filter((r: any) => {
      const name = resMap.get(r.residentId)?.name || "";
      return name.toLowerCase().includes(q) || (r.notes || "").toLowerCase().includes(q) || (r.type || "").toLowerCase().includes(q) || (r.woundType || "").toLowerCase().includes(q);
    });
  }, [rows, search, resMap]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const handleDelete = async (model: string, id: string) => {
    const result = await Swal.fire({ title: "Delete?", text: "This cannot be undone.", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (result.isConfirmed) {
      await deleteRecord(model, id);
      [elimQ, painQ, woundQ, sleepQ, mobilityQ].forEach(q => q.refetch());
      Swal.fire("Deleted", "", "success");
    }
  };

  const refetchAll = () => [elimQ, painQ, woundQ, sleepQ, mobilityQ].forEach(q => q.refetch());

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Daily Care Documentation</h2>
          <p className="text-sm text-gray-500">Track elimination, pain, wounds, sleep, and mobility</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto justify-center px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> Log Entry
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon;
          const count = (() => {
            switch (t.key) {
              case "elimination": return elimQ.data?.length || 0;
              case "pain": return painQ.data?.length || 0;
              case "wound": return woundQ.data?.length || 0;
              case "sleep": return sleepQ.data?.length || 0;
              case "mobility": return mobilityQ.data?.length || 0;
            }
          })();
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap cursor-pointer ${tab === t.key ? "bg-white shadow text-yellow-600" : "text-gray-500 hover:text-gray-700"}`}>
              <Icon className="w-4 h-4" /> {t.label}
              <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-gray-200 text-gray-600">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search by resident name or notes..." className={`${inputCls} pl-9`} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Details</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Date/Time</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Notes</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paged.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No entries found</td></tr>
              )}
              {paged.map((row: any) => {
                const rName = resMap.get(row.residentId)?.name || "Unknown";
                const rRoom = resMap.get(row.residentId)?.room || "";
                const modelMap: Record<TabKey, string> = { elimination: "eliminations", pain: "pain-assessments", wound: "wound-cares", sleep: "sleep-logs", mobility: "mobility-logs" };
                const detailText = (() => {
                  switch (tab) {
                    case "elimination": return `${row.type || ""} ${row.continenceStatus || ""} ${row.volume || ""}`.trim();
                    case "pain": return `${row.painScale || ""} ${row.numericScore != null ? `(${row.numericScore}/10)` : ""} — ${row.location || ""}`.trim();
                    case "wound": return `${row.woundType || ""} — ${row.location || ""} [${row.stage || ""}]`;
                    case "sleep": return `${row.totalHours ? row.totalHours + "h" : ""} ${row.quality || ""} (${row.interruptions || 0} interruptions)`;
                    case "mobility": return `${row.type || ""} ${row.assistanceLevel || ""} ${row.assistiveDevice || ""}`.trim();
                  }
                })();
                const ts = row.time || row.assessedAt || row.date || row.startTime || row.createdAt;
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{rName}</p>
                      <p className="text-xs text-gray-500">Room {rRoom}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{detailText}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">{ts ? new Date(ts).toLocaleString() : "—"}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{row.notes || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => handleDelete(modelMap[tab], row.id)} className="p-1 text-gray-400 hover:text-red-500 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-xs text-gray-500">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
              <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {creating && <CreateModal tab={tab} residents={residents} clinicianName={clinicianName} onClose={() => setCreating(false)} onSaved={refetchAll} />}
    </div>
  );
}

/* ─── Create Modal ─── */
function CreateModal({ tab, residents, clinicianName, onClose, onSaved }: { tab: TabKey; residents: any[]; clinicianName: string; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ residentId: "", notes: "" });

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const base = { residentId: form.residentId, notes: form.notes };
      // The observation logs use observedBy*; PainAssessment/WoundCare use assessedBy*.
      // Spreading the wrong pair fails the Prisma create silently (unknown field).
      const observer = { observedById: null, observedByName: clinicianName };
      const assessor = { assessedById: null, assessedByName: clinicianName };

      switch (tab) {
        case "elimination":
          await createRecord("eliminations", { ...base, ...observer, type: form.type || "URINATION", time: now, continenceStatus: form.continenceStatus || "CONTINENT", volume: form.volume, consistency: form.consistency, color: form.color });
          break;
        case "pain":
          await createRecord("pain-assessments", { ...base, ...assessor, painScale: form.painScale || "MILD", numericScore: form.numericScore ? parseInt(form.numericScore) : null, location: form.location, type: form.painType, duration: form.duration, assessedAt: now });
          break;
        case "wound": {
          // WoundCare has no `notes` column (unlike the other logs) — fold any
          // note the nurse typed into `treatment` so nothing is lost and Prisma
          // doesn't reject an unknown field.
          const treatmentText = (form.treatment || "").trim();
          const woundNote = (form.notes || "").trim();
          const treatment = woundNote
            ? (treatmentText ? `${treatmentText}\n\nNotes: ${woundNote}` : woundNote)
            : treatmentText;
          await createRecord("wound-cares", { residentId: form.residentId, ...assessor, woundType: form.woundType || "PRESSURE_ULCER", location: form.woundLocation || "", stage: form.stage || "EPISODE", sizeLength: form.sizeLength ? parseFloat(form.sizeLength) : null, sizeWidth: form.sizeWidth ? parseFloat(form.sizeWidth) : null, dressingType: form.dressingType, treatment: treatment || null, assessedAt: now });
          break;
        }
        case "sleep": {
          // Prisma DateTime fields need full ISO strings. `date` was a date-only
          // "YYYY-MM-DD" (rejected), and the datetime-local inputs are partial
          // ("YYYY-MM-DDTHH:mm") — normalise them all to ISO.
          const toIso = (v?: string) => {
            if (!v) return null;
            const d = new Date(v);
            return isNaN(d.getTime()) ? null : d.toISOString();
          };
          await createRecord("sleep-logs", { ...base, ...observer, date: now, bedtime: toIso(form.bedtime) ?? now, wakeTime: toIso(form.wakeTime), totalHours: form.totalHours ? parseFloat(form.totalHours) : null, quality: form.quality || "FAIR", interruptions: form.interruptions ? parseInt(form.interruptions) : 0 });
          break;
        }
        case "mobility":
          await createRecord("mobility-logs", { ...base, ...observer, type: form.mobilityType || "WALKING", startTime: now, duration: form.duration ? parseInt(form.duration) : null, assistanceLevel: form.assistanceLevel || "INDEPENDENT", assistiveDevice: form.assistiveDevice });
          break;
      }
      onSaved();
      onClose();
      Swal.fire({ icon: "success", title: "Logged!", timer: 1500, showConfirmButton: false });
    } catch (err) {
      Swal.fire("Error", err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Log {tab.charAt(0).toUpperCase() + tab.slice(1)} Entry</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={labelCls}>Resident *</label>
            <select value={form.residentId} onChange={e => set("residentId", e.target.value)} className={inputCls} required>
              <option value="">Select resident...</option>
              {residents.map((r: any) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>

          {/* Tab-specific fields */}
          {tab === "elimination" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Type</label><select value={form.type || ""} onChange={e => set("type", e.target.value)} className={inputCls}><option value="URINATION">Urination</option><option value="BOWEL_MOVEMENT">Bowel Movement</option><option value="BOTH">Both</option></select></div>
              <div><label className={labelCls}>Continence</label><select value={form.continenceStatus || ""} onChange={e => set("continenceStatus", e.target.value)} className={inputCls}><option value="CONTINENT">Continent</option><option value="OCCASIONAL_INCONTINENCE">Occasional</option><option value="FREQUENT_INCONTINENCE">Frequent</option><option value="INCONTINENT">Incontinent</option><option value="CATHETER">Catheter</option><option value="OSTOMY">Ostomy</option></select></div>
              <div><label className={labelCls}>Volume</label><select value={form.volume || ""} onChange={e => set("volume", e.target.value)} className={inputCls}><option value="">--</option><option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option><option value="NONE">None</option></select></div>
              <div><label className={labelCls}>Color/Consistency</label><input value={form.color || ""} onChange={e => set("color", e.target.value)} className={inputCls} placeholder="e.g., Dark, Cloudy, Normal" /></div>
            </div>
          )}

          {tab === "pain" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Pain Level *</label><select value={form.painScale || ""} onChange={e => set("painScale", e.target.value)} className={inputCls} required><option value="NONE">None (0)</option><option value="MILD">Mild (1-3)</option><option value="MODERATE">Moderate (4-6)</option><option value="SEVERE">Severe (7-8)</option><option value="VERY_SEVERE">Very Severe (9)</option><option value="WORST_POSSIBLE">Worst Possible (10)</option></select></div>
              <div><label className={labelCls}>Numeric (0-10)</label><input type="number" min="0" max="10" value={form.numericScore || ""} onChange={e => set("numericScore", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Location</label><input value={form.location || ""} onChange={e => set("location", e.target.value)} className={inputCls} placeholder="Head, Chest, Back..." /></div>
              <div><label className={labelCls}>Type</label><select value={form.painType || ""} onChange={e => set("painType", e.target.value)} className={inputCls}><option value="">--</option><option value="SHARP">Sharp</option><option value="DULL">Dull</option><option value="ACHING">Aching</option><option value="BURNING">Burning</option><option value="THROBBING">Throbbing</option><option value="CRAMPING">Cramping</option></select></div>
              <div className="col-span-2"><label className={labelCls}>Duration</label><select value={form.duration || ""} onChange={e => set("duration", e.target.value)} className={inputCls}><option value="">--</option><option value="CONSTANT">Constant</option><option value="INTERMITTENT">Intermittent</option><option value="WITH_MOVEMENT">With Movement</option></select></div>
            </div>
          )}

          {tab === "wound" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Wound Type *</label><select value={form.woundType || ""} onChange={e => set("woundType", e.target.value)} className={inputCls} required><option value="PRESSURE_ULCER">Pressure Ulcer</option><option value="SURGICAL">Surgical</option><option value="SKIN_TEAR">Skin Tear</option><option value="IV_SITE">IV Site</option><option value="OTHER">Other</option></select></div>
              <div><label className={labelCls}>Location *</label><input value={form.woundLocation || ""} onChange={e => set("woundLocation", e.target.value)} className={inputCls} required placeholder="Sacrum, Heel..." /></div>
              <div><label className={labelCls}>Stage</label><select value={form.stage || ""} onChange={e => set("stage", e.target.value)} className={inputCls}><option value="EPISODE">New Episode</option><option value="HEALING">Healing</option><option value="HEALED">Healed</option><option value="DETERIORATED">Deteriorated</option></select></div>
              <div><label className={labelCls}>Dressing</label><input value={form.dressingType || ""} onChange={e => set("dressingType", e.target.value)} className={inputCls} placeholder="Hydrocolloid, Foam..." /></div>
              <div><label className={labelCls}>Length (cm)</label><input type="number" step="0.1" value={form.sizeLength || ""} onChange={e => set("sizeLength", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Width (cm)</label><input type="number" step="0.1" value={form.sizeWidth || ""} onChange={e => set("sizeWidth", e.target.value)} className={inputCls} /></div>
              <div className="col-span-2"><label className={labelCls}>Treatment</label><textarea value={form.treatment || ""} onChange={e => set("treatment", e.target.value)} className={inputCls} rows={2} /></div>
            </div>
          )}

          {tab === "sleep" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Bedtime</label><input type="datetime-local" value={form.bedtime || ""} onChange={e => set("bedtime", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Wake Time</label><input type="datetime-local" value={form.wakeTime || ""} onChange={e => set("wakeTime", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Hours Slept</label><input type="number" step="0.5" value={form.totalHours || ""} onChange={e => set("totalHours", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Quality</label><select value={form.quality || ""} onChange={e => set("quality", e.target.value)} className={inputCls}><option value="RESTFUL">Restful</option><option value="FAIR">Fair</option><option value="POOR">Poor</option><option value="RESTLESS">Restless</option><option value="INSOMNIA">Insomnia</option></select></div>
              <div><label className={labelCls}>Interruptions</label><input type="number" min="0" value={form.interruptions || ""} onChange={e => set("interruptions", e.target.value)} className={inputCls} /></div>
            </div>
          )}

          {tab === "mobility" && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={labelCls}>Type *</label><select value={form.mobilityType || ""} onChange={e => set("mobilityType", e.target.value)} className={inputCls} required><option value="WALKING">Walking</option><option value="WHEELCHAIR">Wheelchair</option><option value="TRANSFER">Transfer</option><option value="EXERCISE">Exercise</option><option value="BED_REST">Bed Rest</option><option value="STANDING">Standing</option></select></div>
              <div><label className={labelCls}>Duration (min)</label><input type="number" min="0" value={form.duration || ""} onChange={e => set("duration", e.target.value)} className={inputCls} /></div>
              <div><label className={labelCls}>Assistance Level</label><select value={form.assistanceLevel || ""} onChange={e => set("assistanceLevel", e.target.value)} className={inputCls}><option value="INDEPENDENT">Independent</option><option value="MINIMAL">Minimal</option><option value="MODERATE">Moderate</option><option value="MAXIMAL">Maximal</option><option value="DEPENDENT">Dependent</option></select></div>
              <div><label className={labelCls}>Assistive Device</label><select value={form.assistiveDevice || ""} onChange={e => set("assistiveDevice", e.target.value)} className={inputCls}><option value="NONE">None</option><option value="WALKER">Walker</option><option value="WHEELCHAIR">Wheelchair</option><option value="CANE">Cane</option></select></div>
            </div>
          )}

          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={form.notes || ""} onChange={e => set("notes", e.target.value)} className={inputCls} rows={3} placeholder="Additional observations..." />
          </div>

          <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 cursor-pointer">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Entry"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
