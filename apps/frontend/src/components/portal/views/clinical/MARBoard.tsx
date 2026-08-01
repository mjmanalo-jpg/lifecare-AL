"use client";
import { useMemo, useState } from "react";
import { Pill, Plus, X, Trash2, Search, CheckCircle, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { StatusPill, ClinicalHeader, ClinicalCard, MicroLabel } from "./clinical-ui";

const inputCls = "w-full rounded-md border border-[#D6D8CD] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2E4A48]/30";
// Keys MUST match the Prisma MARStatus enum.
const MAR_STATUSES = ["SCHEDULED", "GIVEN", "REFUSED", "HELD", "MISSED", "PARTIAL"] as const;

export default function MARBoard() {
  const { data: marRows, loading, refetch } = useLiveQuery("medication-administrations", { query: "take=500", tables: ["MedicationAdministration"] });
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const medMap = useMemo(() => new Map((medRows || []).map((m: any) => [m.id, m])), [medRows]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [dateFilter, setDateFilter] = useState(new Date().toISOString().split("T")[0]);

  const rowTime = (m: any) => m.actualTime || m.scheduledTime || null;
  const today = new Date().toISOString().split("T")[0];

  const filtered = useMemo(() => {
    return (marRows || []).filter((m: any) => {
      const name = resMap.get(m.residentId)?.name || "";
      const medName = medMap.get(m.medicationId)?.name || "";
      if (filter !== "ALL" && m.status !== filter) return false;
      if (dateFilter) {
        const t = rowTime(m);
        const mDate = t ? new Date(t).toISOString().split("T")[0] : null;
        if (mDate && mDate !== dateFilter) return false;
      }
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !medName.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [marRows, filter, search, resMap, medMap, dateFilter]);

  // Group the shown doses by resident — one card per resident, PDF-style.
  const groups = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const mar of filtered as any[]) {
      const rid = String(mar.residentId);
      const arr = map.get(rid) ?? [];
      arr.push(mar);
      map.set(rid, arr);
    }
    return Array.from(map.entries())
      .map(([rid, rows]) => ({ rid, resident: resMap.get(rid), rows }))
      .sort((a, b) => (a.resident?.name || "").localeCompare(b.resident?.name || ""));
  }, [filtered, resMap]);

  const stats = useMemo(() => {
    const todays = (marRows || []).filter((m: any) => { const t = rowTime(m); return t && new Date(t).toISOString().split("T")[0] === today; });
    const given = todays.filter((m: any) => m.status === "GIVEN").length;
    const refused = todays.filter((m: any) => m.status === "REFUSED").length;
    const held = todays.filter((m: any) => m.status === "HELD").length;
    const missed = todays.filter((m: any) => m.status === "MISSED").length;
    const scheduled = todays.filter((m: any) => m.status === "SCHEDULED").length;
    const decided = given + refused + held + missed;
    return { given, refused, held, missed, scheduled, compliance: decided ? Math.round((given / decided) * 100) : 100 };
  }, [marRows, today]);

  const complianceOf = (rows: any[]) => {
    const decided = rows.filter((r) => ["GIVEN", "REFUSED", "HELD", "MISSED"].includes(r.status)).length;
    const given = rows.filter((r) => r.status === "GIVEN").length;
    return decided ? Math.round((given / decided) * 100) : 100;
  };

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete MAR Entry?", icon: "warning", showCancelButton: true, confirmButtonColor: "#C0573F" });
    if (r.isConfirmed) { await deleteRecord("medication-administrations", id); refetch(); Swal.fire("Deleted", "", "success"); }
  };
  const markGiven = async (id: string) => {
    await updateRecord("medication-administrations", id, { status: "GIVEN", actualTime: new Date().toISOString() });
    refetch();
    Swal.fire({ icon: "success", title: "Recorded", timer: 1200, showConfirmButton: false });
  };

  const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]";

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#FFFFFF" }}>
      <ClinicalHeader
        eyebrow="Module 05 · MAR"
        title="Medication Administration Record"
        subtitle="Every scheduled dose documented — with timestamp, administering nurse, and outcome."
        right={
          <button onClick={() => setCreating(true)} className="self-start inline-flex items-center gap-2 rounded-md bg-[#2E4A48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#25403D]">
            <Plus className="w-4 h-4" /> Log Administration
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: "Given", value: String(stats.given), color: "text-[#2E4A48]" },
          { label: "Refused", value: String(stats.refused), color: "text-[#C0573F]" },
          { label: "Held", value: String(stats.held), color: "text-[#5B7A70]" },
          { label: "Scheduled", value: String(stats.scheduled), color: "text-[#2E4A48]" },
          { label: "Compliance", value: `${stats.compliance}%`, color: stats.compliance >= 90 ? "text-[#7E9B6F]" : stats.compliance >= 75 ? "text-[#C39A3E]" : "text-[#C0573F]" },
        ].map((s) => (
          <ClinicalCard key={s.label} className="p-3.5">
            <MicroLabel>{s.label}</MicroLabel>
            <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
          </ClinicalCard>
        ))}
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A8D82]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by resident or medication…" className={`${inputCls} pl-9`} />
        </div>
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className={`${inputCls} w-auto`} />
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="ALL">All Status</option>
          {MAR_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      </div>

      {loading ? (
        <ClinicalCard className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[#8A8D82]" /></ClinicalCard>
      ) : groups.length === 0 ? (
        <ClinicalCard className="p-12 text-center text-[#8A8D82]">
          <Pill className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No MAR entries found</p>
        </ClinicalCard>
      ) : (
        <div className="space-y-4">
          {groups.map(({ rid, resident, rows }) => (
            <div key={rid} className="rounded-lg border border-[#E1E3D9] bg-white overflow-hidden">
              {/* Resident header band */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#2E4A48] text-white">
                <span className="font-bold" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{resident?.name ?? "Unknown"} <span className="font-normal text-white/60 text-sm">— Room {resident?.room ?? "—"}</span></span>
                <span className="text-xs text-white/70">{dateFilter ? new Date(dateFilter + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="bg-[#38564F]">
                      <th className={th}>Medication</th>
                      <th className={th}>Dose / Route</th>
                      <th className={th}>Schedule</th>
                      <th className={th}>Status</th>
                      <th className={th}>Administered By</th>
                      <th className={`${th} text-right`}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EBEDE4]">
                    {rows.map((mar: any) => {
                      const med = medMap.get(mar.medicationId);
                      const admin = mar.administeredByName || mar.witnessName || "—";
                      return (
                        <tr key={mar.id} className="hover:bg-[#F5F6F1]">
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#2B2B27]">{med?.name || "—"}</p>
                            {med?.category ? <p className="text-[11px] text-[#C0573F]">{String(med.category)}</p> : null}
                            {mar.reasonForRefusal && <p className="text-[11px] text-[#C0573F] mt-0.5">Reason: {mar.reasonForRefusal}</p>}
                            {mar.heldReason && <p className="text-[11px] text-[#5B7A70] mt-0.5">Held: {mar.heldReason}</p>}
                          </td>
                          <td className="px-4 py-3 text-[#3C3C36]">{mar.dosage || med?.dosage || "—"} / {mar.route || med?.route || "—"}</td>
                          <td className="px-4 py-3 text-[#6B6E63]">{rowTime(mar) ? new Date(rowTime(mar)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                          <td className="px-4 py-3"><StatusPill status={mar.status || "SCHEDULED"} /></td>
                          <td className="px-4 py-3 text-[#3C3C36]">{admin}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-1">
                              {mar.status === "SCHEDULED" && (
                                <button onClick={() => markGiven(mar.id)} className="p-1.5 text-[#7E9B6F] hover:bg-[#7E9B6F]/12 rounded" title="Mark Given"><CheckCircle className="w-4 h-4" /></button>
                              )}
                              <button onClick={() => handleDelete(mar.id)} className="p-1.5 text-[#C0573F] hover:bg-[#C0573F]/10 rounded" title="Delete"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Shift compliance bar */}
              <div className="flex items-center gap-3 px-4 py-3 border-t border-[#EBEDE4]">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A8D82] whitespace-nowrap">Shift Compliance</span>
                <div className="flex-1 h-2 rounded-full bg-[#E1E3D9] overflow-hidden"><div className="h-full bg-[#2E4A48]" style={{ width: `${complianceOf(rows)}%` }} /></div>
                <span className="text-sm font-bold text-[#2B2B27] tabular-nums">{complianceOf(rows)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <MARModal residents={residents} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />}
    </div>
  );
}

function MARModal({ residents, onClose, onSaved }: { residents: any[]; onClose: () => void; onSaved: () => void }) {
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", medicationId: "", dosage: "", route: "ORAL", status: "GIVEN", reasonForRefusal: "", heldReason: "", witnessName: "", notes: "" });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId || !form.medicationId) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      await createRecord("medication-administrations", { ...form, scheduledTime: now, actualTime: form.status === "SCHEDULED" ? null : now });
      onSaved();
      Swal.fire({ icon: "success", title: "Recorded!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Could not save the MAR entry.", "error"); } finally { setSaving(false); }
  };

  const medsForResident = (medRows || []).filter((m: any) => !form.residentId || m.residentId === form.residentId);
  const lbl = "block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8D82] mb-1";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#2E4A48] px-6 py-4 flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Log MAR Entry</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className={lbl}>Resident *</label>
            <select value={form.residentId} onChange={(e) => set("residentId", e.target.value)} className={inputCls} required>
              <option value="">Select…</option>
              {residents.map((r: any) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
            </select>
          </div>
          <div>
            <label className={lbl}>Medication *</label>
            <select value={form.medicationId} onChange={(e) => set("medicationId", e.target.value)} className={inputCls} required>
              <option value="">Select…</option>
              {medsForResident.map((m: any) => <option key={m.id} value={m.id}>{m.name} — {m.dosage || "—"}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Dose</label><input value={form.dosage} onChange={(e) => set("dosage", e.target.value)} className={inputCls} placeholder="10mg" /></div>
            <div><label className={lbl}>Route</label><select value={form.route} onChange={(e) => set("route", e.target.value)} className={inputCls}>
              {["ORAL", "IV", "IM", "SUBCUTANEOUS", "TOPICAL", "INHALATION", "RECTAL", "OTHER"].map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
          </div>
          <div>
            <label className={lbl}>MAR Status *</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)} className={inputCls} required>
              {MAR_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          </div>
          {form.status === "REFUSED" && <div><label className={lbl}>Refusal Reason *</label><input value={form.reasonForRefusal} onChange={(e) => set("reasonForRefusal", e.target.value)} className={inputCls} required placeholder="Why was the medication refused?" /></div>}
          {form.status === "HELD" && <div><label className={lbl}>Hold Reason *</label><input value={form.heldReason} onChange={(e) => set("heldReason", e.target.value)} className={inputCls} required placeholder="Why is the medication being held?" /></div>}
          <div><label className={lbl}>Witness Name (for controlled substances)</label><input value={form.witnessName} onChange={(e) => set("witnessName", e.target.value)} className={inputCls} /></div>
          <div><label className={lbl}>Notes</label><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
          <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-3 -mx-6 -mb-6 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[#6B6E63] hover:bg-black/5 rounded-md">Cancel</button>
            <button type="submit" disabled={saving || !form.residentId || !form.medicationId} className="px-5 py-2 rounded-md bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
