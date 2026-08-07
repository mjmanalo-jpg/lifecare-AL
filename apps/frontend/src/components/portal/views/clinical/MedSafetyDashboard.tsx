"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock, XCircle, RefreshCcw, ShieldAlert, ClipboardX, Loader2, Boxes, ClipboardCheck } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { classifyMedication, isPrn } from "@/lib/medSafety";

/* eslint-disable @typescript-eslint/no-explicit-any */
const str = (v: unknown, d = "") => (typeof v === "string" ? v : v == null ? d : String(v));
const LATE_GRACE_MIN = 60; // minutes past the scheduled time before a dose counts as "late"

// Controlled-substance physical counts live in app-settings (migration-free),
// as a running log of reconciliations keyed by drug name.
const COUNTS_KEY = "controlled_substance_counts";
interface CountRec { drug: string; count: number; expected: number | null; discrepancy: number; at: string; by: string }

/**
 * Real-time medication-safety dashboard — the operational metrics from the eMAR
 * concept: overdue doses, refusals, late administrations, PRN follow-ups,
 * controlled-substance administrations, medication errors, and automated
 * controlled-substance COUNT RECONCILIATION (expected vs. physical count, with
 * discrepancy flagging). Computed live from the administration record.
 */
export default function MedSafetyDashboard() {
  const { data: marRows, loading } = useLiveQuery<any>("medication-administrations", { query: "take=1000", tables: ["MedicationAdministration"] });
  const { data: medRows } = useLiveQuery<any>("medications", { query: "take=500", tables: ["Medication"] });
  const { data: incRows } = useLiveQuery<any>("incidents", { query: "take=500", tables: ["Incident"] });
  const { data: resRows } = useLiveQuery<any>("residents", { query: "take=500", tables: ["Resident"] });
  const { data: settingRows, refetch: refetchSettings } = useLiveQuery<any>("app-settings", { tables: ["AppSetting"] });

  const medMap = useMemo(() => new Map((medRows || []).map((m: any) => [m.id, m])), [medRows]);
  const resMap = useMemo(() => new Map((resRows || []).map(adaptResident).map((r) => [r.id, r])), [resRows]);
  const nameOf = (mar: any) => resMap.get(str(mar.residentId))?.name || "Unknown";
  const medOf = (mar: any) => medMap.get(str(mar.medicationId));

  const [me, setMe] = useState("Clinician");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setMe(d.session?.name || "Clinician"); }).catch(() => {}); }, []);

  // Reading the clock during render is impure; hold "now" in state, refreshed
  // each minute so the time-relative metrics stay live.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t0 = setTimeout(() => setNow(Date.now()), 0); // async initial set (not synchronous-in-effect)
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, []);
  const dayAgo = now - 24 * 3_600_000;
  const weekAgo = now - 7 * 86_400_000;

  const m = useMemo(() => {
    const rows = (marRows || []) as any[];
    const t = (v: any) => (v ? new Date(v).getTime() : 0);

    const overdue = rows.filter((r) => r.status === "SCHEDULED" && r.scheduledTime && t(r.scheduledTime) < now)
      .sort((a, b) => t(a.scheduledTime) - t(b.scheduledTime));
    const refusals = rows.filter((r) => r.status === "REFUSED" && t(r.actualTime || r.scheduledTime) >= weekAgo);
    const late = rows.filter((r) => r.status === "GIVEN" && r.scheduledTime && r.actualTime && (t(r.actualTime) - t(r.scheduledTime)) > LATE_GRACE_MIN * 60_000);
    const prnFollowUps = rows.filter((r) => r.status === "GIVEN" && t(r.actualTime) >= dayAgo && isPrn(medOf(r)?.frequency));
    const controlled = rows.filter((r) => r.status === "GIVEN" && t(r.actualTime) >= weekAgo && classifyMedication(medOf(r)?.name).controlled);
    const medErrors = ((incRows || []) as any[]).filter((i) => String(i.incidentType) === "MEDICATION_ERROR");
    return { overdue, refusals, late, prnFollowUps, controlled, medErrors };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marRows, incRows, medMap, now]);

  // ── Controlled-substance count reconciliation ──────────────────────────
  const controlledDrugs = useMemo(() => {
    const set = new Set<string>();
    for (const med of (medRows || []) as any[]) { const n = str(med.name); if (n && classifyMedication(n).controlled) set.add(n); }
    return [...set].sort();
  }, [medRows]);

  const counts: CountRec[] = useMemo(() => {
    const raw = (settingRows || []).find((r: any) => (r.key || r.id) === COUNTS_KEY)?.value;
    try { const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; } catch { return []; }
  }, [settingRows]);

  const latestFor = (drug: string): CountRec | null =>
    counts.filter((c) => c.drug === drug).sort((a, b) => +new Date(b.at) - +new Date(a.at))[0] ?? null;
  const givenSince = (drug: string, sinceIso: string | null): number =>
    ((marRows || []) as any[]).filter((r) => r.status === "GIVEN" && str(medOf(r)?.name) === drug && r.actualTime && (!sinceIso || +new Date(r.actualTime) > +new Date(sinceIso))).length;
  // Running expected on-hand for the NEXT count = last physical count − doses given since it.
  const expectedNow = (drug: string): number | null => { const l = latestFor(drug); return l ? l.count - givenSince(drug, l.at) : null; };

  const reconciliation = useMemo(
    () => controlledDrugs.map((drug) => {
      const latest = latestFor(drug);
      return { drug, schedule: classifyMedication(drug).deaSchedule, latest, expected: expectedNow(drug), since: givenSince(drug, latest?.at ?? null) };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controlledDrugs, counts, marRows, medMap],
  );
  const discrepancies = reconciliation.filter((r) => r.latest && r.latest.discrepancy !== 0);

  const recordCount = async (drug: string) => {
    const expected = expectedNow(drug); // expected before this physical count
    const res = await Swal.fire({
      title: `Count — ${drug}`,
      input: "number",
      inputLabel: expected != null
        ? `Expected on hand now: ${expected}. Enter the physical count:`
        : "No prior count — enter the current physical count to set the baseline:",
      inputAttributes: { min: "0", step: "1" },
      showCancelButton: true, confirmButtonColor: "#7c3aed", confirmButtonText: "Record count",
      inputValidator: (v) => (v === "" || Number(v) < 0 ? "Enter a valid count" : null),
    });
    if (!res.isConfirmed) return;
    const counted = Math.round(Number(res.value));
    const discrepancy = expected != null ? counted - expected : 0;
    const rec: CountRec = { drug, count: counted, expected, discrepancy, at: new Date().toISOString(), by: me };
    try {
      await upsertRecord("app-settings", COUNTS_KEY, { key: COUNTS_KEY, value: JSON.stringify([...counts, rec].slice(-1000)) });
      await refetchSettings();
      if (discrepancy !== 0) {
        Swal.fire({ title: "Count discrepancy", html: `<b>${drug}</b>: expected <b>${expected}</b>, counted <b>${counted}</b> — off by <b>${discrepancy > 0 ? "+" : ""}${discrepancy}</b>. Flagged for review; escalate per your controlled-substance policy.`, icon: "warning" });
      } else {
        Swal.fire({ title: "Count reconciled", text: `${drug}: ${counted} on hand — matches expected.`, icon: "success", timer: 1600, showConfirmButton: false });
      }
    } catch (e) {
      Swal.fire("Save failed", e instanceof Error ? e.message : String(e), "error");
    }
  };

  const cards = [
    { key: "overdue", label: "Overdue doses", value: m.overdue.length, icon: Clock, tone: "text-red-600 bg-red-50 border-red-200" },
    { key: "late", label: "Late (7d)", value: m.late.length, icon: AlertTriangle, tone: "text-amber-600 bg-amber-50 border-amber-200" },
    { key: "refusals", label: "Refusals (7d)", value: m.refusals.length, icon: XCircle, tone: "text-orange-600 bg-orange-50 border-orange-200" },
    { key: "prn", label: "PRN follow-ups (24h)", value: m.prnFollowUps.length, icon: RefreshCcw, tone: "text-blue-600 bg-blue-50 border-blue-200" },
    { key: "controlled", label: "Controlled given (7d)", value: m.controlled.length, icon: ShieldAlert, tone: "text-purple-600 bg-purple-50 border-purple-200" },
    { key: "discrepancies", label: "Count discrepancies", value: discrepancies.length, icon: Boxes, tone: discrepancies.length ? "text-red-700 bg-red-50 border-red-300" : "text-emerald-600 bg-emerald-50 border-emerald-200" },
    { key: "errors", label: "Medication errors", value: m.medErrors.length, icon: ClipboardX, tone: "text-red-700 bg-red-50 border-red-300" },
  ];

  if (loading && !(marRows || []).length) {
    return <div className="bg-white rounded-xl border p-10 text-center text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-gray-800 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-purple-600" /> Medication Safety</h3>
        <p className="text-xs text-gray-500">Live oversight — overdue, late, refusals, PRN follow-ups, controlled-substance counts, and errors.</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
        {cards.map((c) => { const Icon = c.icon; return (
          <div key={c.key} className={`rounded-xl border p-3 ${c.tone}`}>
            <Icon className="w-5 h-5 mb-1" />
            <p className="text-2xl font-black leading-none">{c.value}</p>
            <p className="text-[11px] font-semibold mt-1 leading-tight">{c.label}</p>
          </div>
        ); })}
      </div>

      {/* Controlled-substance count reconciliation */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Boxes className="w-4 h-4 text-purple-500" /> Controlled-Substance Count Reconciliation</h4>
          <span className="text-xs text-gray-400">{controlledDrugs.length} controlled drug{controlledDrugs.length === 1 ? "" : "s"}</span>
        </div>
        <p className="text-[11px] text-gray-500 mb-3">Expected on-hand = last physical count − doses given since. Record a shift count; a mismatch is flagged for review.</p>
        {controlledDrugs.length === 0 ? (
          <p className="text-sm text-gray-400">No controlled substances in the formulary.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs">
                <tr>
                  <th className="text-left py-1.5 pr-3 font-semibold">Drug</th>
                  <th className="text-left py-1.5 px-3 font-semibold">Last count</th>
                  <th className="text-center py-1.5 px-3 font-semibold">Given since</th>
                  <th className="text-center py-1.5 px-3 font-semibold">Expected now</th>
                  <th className="text-center py-1.5 px-3 font-semibold">Status</th>
                  <th className="text-right py-1.5 pl-3 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reconciliation.map((r) => {
                  const off = r.latest && r.latest.discrepancy !== 0;
                  return (
                    <tr key={r.drug} className={off ? "bg-red-50/40" : ""}>
                      <td className="py-2 pr-3">
                        <span className="font-medium text-gray-900">{r.drug}</span>
                        {r.schedule && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[10px] font-bold">C-{r.schedule}</span>}
                      </td>
                      <td className="py-2 px-3 text-gray-600">
                        {r.latest ? <>{r.latest.count} <span className="text-[11px] text-gray-400">· {new Date(r.latest.at).toLocaleDateString()} by {r.latest.by}</span></> : <span className="text-gray-400">— never counted</span>}
                      </td>
                      <td className="py-2 px-3 text-center tabular-nums text-gray-700">{r.since}</td>
                      <td className="py-2 px-3 text-center tabular-nums font-semibold">{r.expected != null ? r.expected : "—"}</td>
                      <td className="py-2 px-3 text-center">
                        {!r.latest ? <span className="text-[11px] text-gray-400">no baseline</span>
                          : off ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700"><AlertTriangle className="w-3.5 h-3.5" /> off by {r.latest.discrepancy > 0 ? "+" : ""}{r.latest.discrepancy}</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600"><ClipboardCheck className="w-3.5 h-3.5" /> reconciled</span>}
                      </td>
                      <td className="py-2 pl-3 text-right">
                        <button onClick={() => void recordCount(r.drug)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-700 transition">
                          <ClipboardCheck className="w-3.5 h-3.5" /> Record count
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ListPanel title="Overdue doses" icon={Clock} rows={m.overdue} empty="No overdue doses — all scheduled meds are current."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · scheduled ${new Date(r.scheduledTime).toLocaleString()}`} />
      <ListPanel title="Late administrations (last 7 days)" icon={AlertTriangle} rows={m.late} empty="No late administrations."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · ${Math.round((new Date(r.actualTime).getTime() - new Date(r.scheduledTime).getTime()) / 60000)} min late`} />
      <ListPanel title="Refusals (last 7 days)" icon={XCircle} rows={m.refusals} empty="No refusals."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"}${r.reasonForRefusal ? ` — ${r.reasonForRefusal}` : ""}`} />
      <ListPanel title="Controlled substances given (last 7 days)" icon={ShieldAlert} rows={m.controlled} empty="No controlled-substance administrations."
        render={(r) => `${nameOf(r)} · ${medOf(r)?.name ?? "—"} · witnessed by ${r.witnessName || "—"} · ${r.actualTime ? new Date(r.actualTime).toLocaleString() : ""}`} />
    </div>
  );
}

function ListPanel({ title, icon: Icon, rows, empty, render }: { title: string; icon: any; rows: any[]; empty: string; render: (r: any) => string }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5 mb-2"><Icon className="w-4 h-4 text-gray-500" /> {title} <span className="text-xs text-gray-400">({rows.length})</span></h4>
      {rows.length === 0 ? <p className="text-sm text-gray-400">{empty}</p> : (
        <ul className="space-y-1 max-h-56 overflow-y-auto">
          {rows.slice(0, 30).map((r, i) => <li key={r.id ?? i} className="text-sm text-gray-700 border-b border-gray-50 py-1">{render(r)}</li>)}
          {rows.length > 30 && <li className="text-xs text-gray-400 pt-1">…and {rows.length - 30} more</li>}
        </ul>
      )}
    </div>
  );
}
