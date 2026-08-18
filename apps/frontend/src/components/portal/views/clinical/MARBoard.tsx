"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Pill, Plus, X, Trash2, Search, CheckCircle, Loader2, Lock } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { StatusPill, ClinicalHeader, ClinicalCard, MicroLabel } from "./clinical-ui";
import { classifyMedication, medFlagLabels, isPrn, prnIntervalHours } from "@/lib/medSafety";
import { MAR_WINDOW_MIN, classifyDoseWindow, fmtWindowTime } from "@/lib/marWindow";

const inputCls = "w-full rounded-md border border-[#D6D8CD] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2E4A48]/30";
// Keys MUST match the Prisma MARStatus enum.
const MAR_STATUSES = ["SCHEDULED", "GIVEN", "REFUSED", "HELD", "MISSED", "PARTIAL"] as const;

// Local calendar day (YYYY-MM-DD). MAR filtering must key off the LOCAL day the
// nurse sees/picks (the datetime-local scheduler and the date input are both
// local); using UTC (toISOString) would drop a dose whose scheduled local time
// falls on a different UTC day — e.g. an early- or late-day dose in a non-UTC
// timezone would silently vanish from "today".
const localDay = (d: Date | string) => {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

export default function MARBoard() {
  const { data: marRows, loading, refetch } = useLiveQuery("medication-administrations", { query: "take=500", tables: ["MedicationAdministration"] });
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const { data: vitalsRows } = useLiveQuery("vitals", { query: "take=500", tables: ["VitalsLog"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const medMap = useMemo(() => new Map((medRows || []).map((m: any) => [m.id, m])), [medRows]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [dateFilter, setDateFilter] = useState(localDay(new Date()));

  // The signed-in clinician — recorded as who administered/logged each dose.
  const [me, setMe] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setMe({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  // Live clock so the strict administration window (and locked "Mark Given"
  // buttons) open/close without a manual refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 30_000); return () => clearInterval(id); }, []);

  const router = useRouter();
  const pathname = usePathname();
  // Send the clinician to Daily Rounds → Vitals for this resident so they can
  // record the reading; the MAR block clears automatically once it's saved (the
  // vitals live-query picks up the new VitalsLog row).
  const goRecordVitals = (residentId: string) => {
    const role = pathname?.split("/")[1] || "nurse";
    router.push(`/${role}/dailyrounds?resident=${encodeURIComponent(String(residentId))}&focus=vitals`);
  };

  const rowTime = (m: any) => m.actualTime || m.scheduledTime || null;
  const today = localDay(new Date());

  // Residents who already have a vitals reading recorded today (for the
  // vitals-before-administration prompt on vitals-sensitive meds).
  const vitalsTodayByResident = useMemo(() => {
    const s = new Set<string>();
    for (const v of (vitalsRows || []) as any[]) {
      const t = v.recordedAt ? localDay(v.recordedAt) : null;
      if (t === today && v.residentId) s.add(String(v.residentId));
    }
    return s;
  }, [vitalsRows, today]);

  // Witness capture (controlled substances) — a designed in-component modal
  // replaces the bare Swal text prompt. runGiveChecks returns `needsWitness`
  // when a witness is still required; markGiven then opens this modal, and
  // confirming it re-runs the give with the entered witness name.
  const [witnessFor, setWitnessFor] = useState<any>(null);
  const [witnessName, setWitnessName] = useState("");
  const [witnessBusy, setWitnessBusy] = useState(false);
  // Late-administration note captured before a witness prompt, carried into the
  // eventual GIVEN write so it isn't lost through the witness modal.
  const [pendingLateNote, setPendingLateNote] = useState<string | undefined>(undefined);

  // Run controlled-substance, vitals, and PRN-interval safety checks before a
  // dose is marked GIVEN. Returns { ok:false } to abort, { needsWitness:true }
  // when a controlled-substance witness must be captured, or { ok:true } to give.
  const runGiveChecks = async (mar: any): Promise<{ ok: boolean; witnessName?: string; needsWitness?: boolean; lateNote?: string }> => {
    const med: any = medMap.get(mar.medicationId);
    const flags = classifyMedication(med?.name);
    const resName = resMap.get(mar.residentId)?.name || "this resident";

    // Strict administration window (skips PRN). Before the window opens the dose
    // is hard-blocked; after it closes it's allowed but flagged Late with a reason.
    let lateNote: string | undefined;
    const schedMs = mar.scheduledTime ? new Date(mar.scheduledTime).getTime() : NaN;
    if (!isPrn(med?.frequency) && !Number.isNaN(schedMs)) {
      const w = classifyDoseWindow(schedMs, nowMs);
      if (w.phase === "EARLY") {
        await Swal.fire({
          title: "Too early to administer",
          html: `The administration window for <b>${med?.name || "this dose"}</b> opens at <b>${fmtWindowTime(w.openMs)}</b> (scheduled ${fmtWindowTime(schedMs)} ± ${MAR_WINDOW_MIN} min).`,
          icon: "warning", confirmButtonColor: "#C0573F", confirmButtonText: "OK",
        });
        return { ok: false };
      }
      if (w.phase === "LATE") {
        const res = await Swal.fire({
          title: "Outside scheduled window",
          input: "text",
          inputLabel: `The ${fmtWindowTime(schedMs)} window closed at ${fmtWindowTime(w.closeMs)}. Document why this dose is being given late.`,
          inputPlaceholder: "Reason for late administration",
          showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Record late",
          inputValidator: (v) => (!String(v || "").trim() ? "A reason is required" : undefined),
        });
        if (!res.isConfirmed) return { ok: false };
        lateNote = `Late administration — ${String(res.value).trim()}`;
      }
    }

    // PRN over-dispensing guard: block if the last dose was within the interval.
    if (isPrn(med?.frequency)) {
      const interval = prnIntervalHours(med?.frequency);
      const last = (marRows || [])
        .filter((m: any) => m.medicationId === mar.medicationId && m.residentId === mar.residentId && m.status === "GIVEN" && m.actualTime && m.id !== mar.id)
        .map((m: any) => new Date(m.actualTime).getTime())
        .sort((a: number, b: number) => b - a)[0];
      if (last) {
        const hrsSince = (Date.now() - last) / 3_600_000;
        if (hrsSince < interval) {
          const proceed = await Swal.fire({
            title: "PRN interval not met",
            html: `<b>${med?.name}</b> was last given <b>${hrsSince.toFixed(1)}h</b> ago; the minimum interval is <b>${interval}h</b>. Giving again may be over-dispensing.<br/><br/>Give anyway?`,
            icon: "warning", showCancelButton: true, confirmButtonColor: "#C0573F", confirmButtonText: "Give anyway",
          });
          if (!proceed.isConfirmed) return { ok: false };
        }
      }
    }

    // Vitals-before-administration check for vitals-sensitive meds.
    if (flags.needsVitals && !vitalsTodayByResident.has(String(mar.residentId))) {
      if (flags.highRiskVitals) {
        // High-risk cardio/glycemic meds: vitals are mandatory — hard block, no override.
        await Swal.fire({
          title: "Vitals required",
          html: `<b>${med?.name}</b> is a high-risk medication and cannot be given until vitals are recorded today for <b>${resName}</b>.<br/><br/>You'll be taken to Daily Rounds to record vitals now.`,
          icon: "error", confirmButtonColor: "#C0573F", confirmButtonText: "Record vitals first",
        });
        goRecordVitals(mar.residentId);
        return { ok: false };
      }
      // Other vitals-sensitive meds: soft prompt, nurse may proceed.
      const proceed = await Swal.fire({
        title: "Check vitals first",
        html: `<b>${med?.name}</b> should be given after checking vitals, but none are recorded today for <b>${resName}</b>.<br/><br/>Record vitals first, or proceed?`,
        icon: "info", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Proceed anyway", cancelButtonText: "Record vitals first",
      });
      if (!proceed.isConfirmed) { goRecordVitals(mar.residentId); return { ok: false }; }
    }

    // Controlled substances require a witness — captured in a designed modal
    // (opened by markGiven) rather than inline here.
    if (flags.controlled && !(mar.witnessName || "").trim()) {
      return { ok: false, needsWitness: true, lateNote };
    }
    return { ok: true, witnessName: mar.witnessName || undefined, lateNote };
  };

  const filtered = useMemo(() => {
    return (marRows || []).filter((m: any) => {
      const name = resMap.get(m.residentId)?.name || "";
      const medName = medMap.get(m.medicationId)?.name || "";
      if (filter !== "ALL" && m.status !== filter) return false;
      if (dateFilter) {
        const t = rowTime(m);
        const mDate = t ? localDay(t) : null;
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
    const todays = (marRows || []).filter((m: any) => { const t = rowTime(m); return t && localDay(t) === today; });
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
  // Write the GIVEN dose (optionally with a witness). Shared by the row action
  // and the controlled-substance witness modal.
  const applyGiven = async (mar: { id: string; witnessName?: string | null }, witness?: string, note?: string) => {
    await updateRecord("medication-administrations", mar.id, {
      status: "GIVEN", actualTime: new Date().toISOString(),
      recordedById: me.id, recordedByName: me.name,
      ...(witness ? { witnessName: witness } : {}),
      ...(note ? { notes: note } : {}),
    });
    refetch();
    Swal.fire({ icon: "success", title: "Recorded", timer: 1200, showConfirmButton: false });
  };
  const markGiven = async (mar: { id: string; witnessName?: string | null }) => {
    const chk = await runGiveChecks(mar);
    if (chk.needsWitness) { setWitnessName(mar.witnessName || ""); setPendingLateNote(chk.lateNote); setWitnessFor(mar); return; }
    if (!chk.ok) return;
    await applyGiven(mar, chk.witnessName, chk.lateNote);
  };
  const submitWitness = async () => {
    if (!witnessFor || !witnessName.trim()) return;
    setWitnessBusy(true);
    try { await applyGiven(witnessFor, witnessName.trim(), pendingLateNote); setWitnessFor(null); setPendingLateNote(undefined); }
    catch { Swal.fire("Error", "Could not record the administration.", "error"); }
    finally { setWitnessBusy(false); }
  };

  const th = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[#C9D2CB]";

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5" style={{ background: "#FFFFFF" }}>
      <ClinicalHeader
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
                      const admin = mar.recordedByName || mar.witnessName || "—";
                      return (
                        <tr key={mar.id} className="hover:bg-[#F5F6F1]">
                          <td className="px-4 py-3">
                            <p className="font-bold text-[#2B2B27]">{med?.name || "—"}</p>
                            {medFlagLabels(med?.name).length > 0 && (
                              <span className="flex flex-wrap gap-1 mt-0.5">
                                {medFlagLabels(med?.name).map((b) => <span key={b.label} className={`px-1 py-0.5 rounded text-[9px] font-bold ${b.tone === "red" ? "bg-red-100 text-red-700" : b.tone === "purple" ? "bg-purple-100 text-purple-700" : b.tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{b.label}</span>)}
                              </span>
                            )}
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
                              {mar.status === "SCHEDULED" && (() => {
                                const schedMs = mar.scheduledTime ? new Date(mar.scheduledTime).getTime() : NaN;
                                const win = !isPrn(med?.frequency) && !Number.isNaN(schedMs) ? classifyDoseWindow(schedMs, nowMs) : null;
                                return win?.phase === "EARLY"
                                  ? <button disabled className="p-1.5 text-[#8A8D82] rounded cursor-not-allowed" title={`Window opens at ${fmtWindowTime(win.openMs)}`}><Lock className="w-4 h-4" /></button>
                                  : <button onClick={() => markGiven(mar)} className="p-1.5 text-[#7E9B6F] hover:bg-[#7E9B6F]/12 rounded" title="Mark Given"><CheckCircle className="w-4 h-4" /></button>;
                              })()}
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
                <span className="hidden sm:block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#8A8D82] whitespace-nowrap">Shift Compliance</span>
                <div className="flex-1 h-2 rounded-full bg-[#E1E3D9] overflow-hidden"><div className="h-full bg-[#2E4A48]" style={{ width: `${complianceOf(rows)}%` }} /></div>
                <span className="text-sm font-bold text-[#2B2B27] tabular-nums">{complianceOf(rows)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <MARModal residents={residents} me={me} vitalsTodayByResident={vitalsTodayByResident} onRecordVitals={goRecordVitals} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />}

      {witnessFor && (() => {
        const med = medMap.get(witnessFor.medicationId) as { name?: string } | undefined;
        const flags = classifyMedication(med?.name);
        const resName = resMap.get(witnessFor.residentId)?.name || "this resident";
        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setWitnessFor(null); }}>
            <div className="bg-white rounded-lg shadow-2xl w-full max-w-md overflow-hidden">
              <div className="sticky top-0 bg-[#2E4A48] px-6 py-4 flex items-center justify-between">
                <h3 className="text-white font-bold text-lg">Controlled Substance{flags.deaSchedule ? ` (C-${flags.deaSchedule})` : ""}</h3>
                <button onClick={() => setWitnessFor(null)} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="rounded-md border border-[#E1E3D9] bg-[#F5F6F1] px-3 py-2.5 text-sm text-[#3C3C36]">
                  <span className="font-bold text-[#2B2B27]">{med?.name || "Medication"}</span> for <span className="font-semibold">{resName}</span>
                </div>
                <div>
                  <label htmlFor="mar-witness" className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8A8D82] mb-1">Witness Name *</label>
                  <input id="mar-witness" value={witnessName} onChange={(e) => setWitnessName(e.target.value)} autoFocus placeholder="Enter the witness name" className={inputCls} onKeyDown={(e) => { if (e.key === "Enter" && witnessName.trim() && !witnessBusy) void submitWitness(); }} />
                  <p className="mt-1.5 text-[11px] text-[#8A8D82]">A witness is required to administer this controlled substance.</p>
                </div>
              </div>
              <div className="bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-3 flex flex-wrap justify-end gap-2">
                <button onClick={() => setWitnessFor(null)} disabled={witnessBusy} className="px-4 py-2 text-sm text-[#6B6E63] hover:bg-black/5 rounded-md disabled:opacity-50">Cancel</button>
                <button onClick={submitWitness} disabled={witnessBusy || !witnessName.trim()} className="px-5 py-2 rounded-md bg-[#2E4A48] text-white text-sm font-semibold hover:bg-[#25403D] disabled:opacity-50 inline-flex items-center gap-2">{witnessBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />} Confirm &amp; give</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function MARModal({ residents, me, vitalsTodayByResident, onRecordVitals, onClose, onSaved }: { residents: any[]; me: { id: string | null; name: string | null }; vitalsTodayByResident: Set<string>; onRecordVitals: (residentId: string) => void; onClose: () => void; onSaved: () => void }) {
  const { data: medRows } = useLiveQuery("medications", { query: "take=200", tables: ["Medication"] });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", medicationId: "", dosage: "", route: "ORAL", status: "GIVEN", scheduledAt: "", reasonForRefusal: "", heldReason: "", witnessName: "", notes: "" });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const selectedMed: any = (medRows || []).find((m: any) => m.id === form.medicationId);
  const medFlags = classifyMedication(selectedMed?.name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId || !form.medicationId) return;
    // Vitals-before-administration check (mirrors the row "Mark Given" action).
    if (form.status === "GIVEN" && medFlags.needsVitals && !vitalsTodayByResident.has(String(form.residentId))) {
      const resName = residents.find((r: any) => r.id === form.residentId)?.name || "this resident";
      if (medFlags.highRiskVitals) {
        // High-risk cardio/glycemic meds: vitals are mandatory — hard block, no override.
        await Swal.fire({
          title: "Vitals required",
          html: `<b>${selectedMed?.name}</b> is a high-risk medication and cannot be recorded as given until vitals are recorded today for <b>${resName}</b>.<br/><br/>You'll be taken to Daily Rounds to record vitals now.`,
          icon: "error", confirmButtonColor: "#C0573F", confirmButtonText: "Record vitals first",
        });
        onRecordVitals(form.residentId);
        return;
      }
      // Other vitals-sensitive meds: soft prompt, nurse may proceed.
      const proceed = await Swal.fire({
        title: "Check vitals first",
        html: `<b>${selectedMed?.name}</b> should be given after checking vitals, but none are recorded today for <b>${resName}</b>.<br/><br/>Record vitals first, or proceed?`,
        icon: "info", showCancelButton: true, confirmButtonColor: "#2E4A48", confirmButtonText: "Proceed anyway", cancelButtonText: "Record vitals first",
      });
      if (!proceed.isConfirmed) { onRecordVitals(form.residentId); return; }
    }
    // Controlled substances require a witness when recorded as given.
    if (medFlags.controlled && form.status === "GIVEN" && !form.witnessName.trim()) {
      Swal.fire("Witness required", `${selectedMed?.name} is a controlled substance — a witness name is required to record it as given.`, "warning");
      return;
    }
    // A SCHEDULED dose needs its planned date & time.
    if (form.status === "SCHEDULED" && !form.scheduledAt) {
      Swal.fire("Schedule required", "Pick the date and time this dose is scheduled for.", "warning");
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // For SCHEDULED, use the nurse-picked date/time; otherwise the dose is
      // acted on now. `scheduledAt` is a form-only field — keep it out of the payload.
      const { scheduledAt, ...rest } = form;
      const scheduledTime = form.status === "SCHEDULED" && scheduledAt ? new Date(scheduledAt).toISOString() : now;
      await createRecord("medication-administrations", { ...rest, scheduledTime, actualTime: form.status === "SCHEDULED" ? null : now, recordedById: me.id, recordedByName: me.name });
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
            {medFlagLabels(selectedMed?.name).length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {medFlagLabels(selectedMed?.name).map((b) => <span key={b.label} className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${b.tone === "red" ? "bg-red-100 text-red-700" : b.tone === "purple" ? "bg-purple-100 text-purple-700" : b.tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{b.label}</span>)}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
          {form.status === "SCHEDULED" && <div><label className={lbl}>Scheduled Date &amp; Time *</label><input type="datetime-local" value={form.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} className={inputCls} required /></div>}
          {form.status === "REFUSED" && <div><label className={lbl}>Refusal Reason *</label><input value={form.reasonForRefusal} onChange={(e) => set("reasonForRefusal", e.target.value)} className={inputCls} required placeholder="Why was the medication refused?" /></div>}
          {form.status === "HELD" && <div><label className={lbl}>Hold Reason *</label><input value={form.heldReason} onChange={(e) => set("heldReason", e.target.value)} className={inputCls} required placeholder="Why is the medication being held?" /></div>}
          <div><label className={lbl}>Witness Name (for controlled substances)</label><input value={form.witnessName} onChange={(e) => set("witnessName", e.target.value)} className={inputCls} /></div>
          <div><label className={lbl}>Notes</label><textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
          <div className="sticky bottom-0 bg-[#F5F6F1] border-t border-[#E1E3D9] px-6 py-3 -mx-6 -mb-6 flex flex-wrap justify-end gap-2">
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
