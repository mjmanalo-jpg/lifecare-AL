"use client";

/**
 * Medication Administration Record — Daily MAR (per-resident dose board) + a
 * Medication Summary. Uses the real Medication + MedicationAdministration models.
 * Scheduled dose occurrences are derived from Medication.frequency (free-text →
 * time slots), since the schema has no scheduled-times column; recording a dose
 * creates a MedicationAdministration row. No schema changes.
 */

import { useEffect, useMemo, useState } from "react";
import { Pill, Search, Plus, ChevronRight, ChevronLeft, Clock, CheckCircle2, XCircle, PauseCircle, Pencil, Trash2, X, Activity, BellRing } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord, upsertRecord } from "@/lib/api";
import { planMedConsumption, parseInvItems, parseInvPRs, INV_ITEMS_KEY, INV_PR_KEY } from "@/lib/medInventory";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalHeader, ClinicalButton, ClinicalCard, DataState, SERIF } from "./clinical-ui";
import SignatureModal from "@/components/portal/SignatureModal";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const todayIso = () => new Date().toISOString().split("T")[0];
const dayOf = (v: unknown) => (v ? new Date(s(v)).toISOString().split("T")[0] : "");
// Local-calendar day (YYYY-MM-DD) — used for the "vitals recorded today" check.
const localDay = (v: unknown) => { const d = new Date(s(v)); return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// app-setting key holding the { [medicationId]: true } vitals-required map.
const VITALS_KEY = "med_vitals_required";

const ROUTES = ["Oral", "Sublingual", "Topical", "Inhalation", "Subcutaneous", "Intramuscular", "Intravenous", "Rectal", "Ophthalmic", "Otic", "Nasal", "Transdermal"];
const FREQUENCIES = ["Once daily (OD)", "Twice daily (BID)", "Three times daily (TID)", "Four times daily (QID)", "Every 6 hours (Q6H)", "Every 8 hours (Q8H)", "Every 12 hours (Q12H)", "As needed (PRN)", "Once weekly", "Twice weekly (2x/week)", "Three times weekly (3x/week)", "Alternate days", "Once monthly"];
const SLOT_TIME: Record<string, string> = { MORNING: "08:00", NOON: "12:00", EVENING: "18:00", NIGHT: "22:00", PRN: "PRN" };
const SLOT_HOUR: Record<string, number> = { MORNING: 8, NOON: 12, EVENING: 18, NIGHT: 22, PRN: -1 };
// Display a 24h "HH:MM" as friendly 12-hour time (18:00 → "6:00 PM"); "PRN" stays.
const to12h = (hhmm: string): string => {
  if (!hhmm || hhmm === "PRN") return hhmm || "";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
};

function parseSlots(frequency: string): string[] {
  const f = frequency.toLowerCase();
  if (/prn|as needed/.test(f)) return ["PRN"];
  if (/four|qid|4x|every 6/.test(f)) return ["MORNING", "NOON", "EVENING", "NIGHT"];
  if (/three|tid|3x|every 8/.test(f)) return ["MORNING", "NOON", "EVENING"];
  if (/twice|bid|2x|every 12/.test(f)) return ["MORNING", "EVENING"];
  if (/night|bedtime|\bhs\b/.test(f)) return ["NIGHT"];
  return ["MORNING"];
}
const activeOn = (m: Row, iso: string) => { const st = dayOf(m.startDate); const en = dayOf(m.endDate); return (!st || st <= iso) && (!en || en >= iso) && s(m.status) !== "DISCONTINUED"; };
// Split "Brand (Generic)" for display.
const splitName = (name: string): [string, string] => { const mt = name.match(/^(.*?)\s*\((.*)\)\s*$/); return mt ? [mt[1], mt[2]] : [name, ""]; };

type MarStatus = "GIVEN" | "REFUSED" | "HELD" | "PENDING";
const STATUS_ICON = { GIVEN: CheckCircle2, REFUSED: XCircle, HELD: PauseCircle, PENDING: Clock };
const STATUS_CLS: Record<MarStatus, string> = { GIVEN: "bg-green-100 text-green-700 border-green-200", REFUSED: "bg-red-100 text-red-700 border-red-200", HELD: "bg-amber-100 text-amber-700 border-amber-200", PENDING: "bg-slate-100 text-slate-500 border-slate-200" };

export default function MARDailyBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName, userId } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const medQ = useLiveQuery<Row>("medications", { query: "take=1000", tables: ["Medication"] });
  const marQ = useLiveQuery<Row>("medication-administrations", { query: "take=3000", tables: ["MedicationAdministration"] });
  const vitQ = useLiveQuery<Row>("vitals", { query: "take=1000", tables: ["VitalsLog"] });
  const setQ = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const meds = useMemo(() => medQ.data || [], [medQ.data]);

  // Meds flagged "vitals required before administration" — stored migration-free
  // as an app-setting map { [medicationId]: true } (no Medication column).
  const vitalsReqMap = useMemo<Record<string, boolean>>(() => {
    const row = (setQ.data || []).find((r) => s(r.key || r.id) === VITALS_KEY);
    try { return row ? (JSON.parse(s(row.value)) as Record<string, boolean>) : {}; } catch { return {}; }
  }, [setQ.data]);
  const isVitalsRequired = (medId: string) => Boolean(vitalsReqMap[medId]);

  // Resident-medication inventory (app-setting) — decremented as doses are given.
  const invItems = useMemo(() => parseInvItems((setQ.data || []).find((r) => s(r.key || r.id) === INV_ITEMS_KEY)?.value), [setQ.data]);
  const invPRs = useMemo(() => parseInvPRs((setQ.data || []).find((r) => s(r.key || r.id) === INV_PR_KEY)?.value), [setQ.data]);
  const saveVitalsFlag = async (medId: string, required: boolean) => {
    if (!medId) return;
    const next = { ...vitalsReqMap };
    if (required) next[medId] = true; else delete next[medId];
    await upsertRecord("app-settings", VITALS_KEY, { key: VITALS_KEY, value: JSON.stringify(next) });
    await setQ.refetch();
  };
  // Residents with a vitals reading recorded today (local day).
  const vitalsTodayByResident = useMemo(() => {
    const set = new Set<string>(); const t = localDay(new Date());
    for (const v of vitQ.data || []) { if (v.residentId && localDay(v.recordedAt || v.createdAt) === t) set.add(s(v.residentId)); }
    return set;
  }, [vitQ.data]);

  const [tab, setTab] = useState<"daily" | "summary">("daily");
  const [date, setDate] = useState(todayIso());
  const [search, setSearch] = useState("");
  const [openRes, setOpenRes] = useState<Row | null>(null);
  const [addFor, setAddFor] = useState<Row | null>(null);

  // Step the viewed day without opening the date picker — the common MAR move.
  const shiftDate = (delta: number) => {
    const [y, mo, d] = date.split("-").map(Number);
    const nd = new Date(y, mo - 1, d + delta);
    setDate(`${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, "0")}-${String(nd.getDate()).padStart(2, "0")}`);
  };

  const refetch = async () => { await Promise.allSettled([medQ.refetch(), marQ.refetch()]); };

  // Scheduled occurrences for a med on the date → [{slot, time, hour, status, marId}]
  const occurrencesFor = (m: Row, iso: string) => {
    if (!activeOn(m, iso)) return [];
    return parseSlots(s(m.frequency)).map((slot) => {
      const mar = (marQ.data || []).find((a) => s(a.medicationId) === s(m.id) && dayOf(a.scheduledTime) === iso && (slot === "PRN" || new Date(s(a.scheduledTime)).getHours() === SLOT_HOUR[slot]));
      const status = (mar ? s(mar.status).toUpperCase() : "PENDING") as string;
      const reason = mar ? (s(mar.reasonForRefusal) || s(mar.heldReason)) : "";
      return { slot, time: to12h(SLOT_TIME[slot]), status: (["GIVEN", "REFUSED", "HELD"].includes(status) ? status : "PENDING") as MarStatus, marId: mar ? s(mar.id) : "", reason };
    });
  };

  const medsByRes = useMemo(() => { const m = new Map<string, Row[]>(); meds.forEach((x) => { const a = m.get(s(x.residentId)); if (a) a.push(x); else m.set(s(x.residentId), [x]); }); return m; }, [meds]);

  // Per-resident daily totals.
  const resStats = (residentId: string) => {
    let total = 0, given = 0, refused = 0, held = 0;
    (medsByRes.get(residentId) || []).forEach((m) => occurrencesFor(m, date).forEach((o) => { total++; if (o.status === "GIVEN") given++; else if (o.status === "REFUSED") refused++; else if (o.status === "HELD") held++; }));
    return { total, given, refused, held, pending: total - given - refused - held };
  };
  const facility = useMemo(() => { let total = 0, given = 0, refusedHeld = 0; residents.forEach((r: Row) => { const st = resStats(s(r.id)); total += st.total; given += st.given; refusedHeld += st.refused + st.held; }); return { total, given, pending: total - given - refusedHeld, refusedHeld }; }, [residents, medsByRes, marQ.data, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const administer = async (m: Row, slot: string, iso: string, marId: string, status: "GIVEN" | "REFUSED" | "HELD", reason = "") => {
    // Vitals-first alert: block a GIVEN dose on a flagged med until vitals are
    // recorded today for the resident (nurse may override with reason).
    if (status === "GIVEN" && isVitalsRequired(s(m.id)) && !vitalsTodayByResident.has(s(m.residentId))) {
      const proceed = await Swal.fire({
        title: "Vitals required first",
        html: `<b>${splitName(s(m.name))[0]}</b> is flagged <b>Vitals Required</b> before administration, but no vitals are recorded today for this resident.<br/><br/>Record vitals first, or proceed anyway?`,
        icon: "warning", showCancelButton: true, confirmButtonColor: "#2563eb", confirmButtonText: "Proceed anyway", cancelButtonText: "Record vitals first",
      });
      if (!proceed.isConfirmed) return;
    }
    const scheduledTime = slot === "PRN" ? new Date().toISOString() : new Date(`${iso}T${SLOT_TIME[slot]}:00`).toISOString();
    const cleanReason = reason.trim();
    // Store the reason in the matching column so it persists on the record; clear
    // the other so switching status (e.g. Held → Given) doesn't leave a stale note.
    const payload: Row = {
      status,
      actualTime: status === "GIVEN" ? new Date().toISOString() : null,
      recordedById: userId,
      recordedByName: clinicianName,
      reasonForRefusal: status === "REFUSED" ? (cleanReason || null) : null,
      heldReason: status === "HELD" ? (cleanReason || null) : null,
    };
    try {
      if (marId) await updateRecord("medication-administrations", marId, payload);
      else await createRecord("medication-administrations", { medicationId: s(m.id), residentId: s(m.residentId), scheduledTime, dosage: s(m.dosage), route: s(m.route), ...payload });
      await refetch();
      // A given dose consumes one unit of the resident's medication in inventory.
      // Low/out crossings auto-queue a purchase request. Best-effort — never blocks
      // the dose record itself.
      if (status === "GIVEN") {
        try {
          const plan = planMedConsumption({ items: invItems, prs: invPRs, residentId: s(m.residentId), medName: s(m.name), qty: 1, by: clinicianName });
          if (plan.matched) {
            await upsertRecord("app-settings", INV_ITEMS_KEY, { key: INV_ITEMS_KEY, value: JSON.stringify(plan.items) });
            if (plan.createdPR) await upsertRecord("app-settings", INV_PR_KEY, { key: INV_PR_KEY, value: JSON.stringify(plan.prs) });
            await setQ.refetch();
            if (plan.level === "out") Swal.fire({ toast: true, position: "top-end", icon: "error", title: `${plan.item?.name}: out of stock`, text: plan.createdPR ? "Urgent purchase request auto-created." : "Restock needed.", showConfirmButton: false, timer: 3400 });
            else if (plan.level === "low") Swal.fire({ toast: true, position: "top-end", icon: "warning", title: `${plan.item?.name}: low — ${plan.remaining} ${plan.item?.unit} left`, text: plan.createdPR ? "Purchase request auto-created." : undefined, showConfirmButton: false, timer: 3000 });
          }
        } catch { /* inventory sync is best-effort */ }
      }
    } catch (e) { Swal.fire({ title: "Could not record dose", text: e instanceof Error ? e.message : "", icon: "error" }); }
  };

  const q = search.trim().toLowerCase();
  const filteredResidents = residents.filter((r: Row) => !q || s(r.name).toLowerCase().includes(q) || s(r.room).toLowerCase().includes(q));

  // Medication reminders — while the MAR is open, an in-app toast pings staff as
  // each scheduled dose time is reached and the dose is still pending. Fired doses
  // are remembered per-day in localStorage so a reminder never repeats within the day.
  useEffect(() => {
    const iso = todayIso();
    const storeKey = `mar_reminded_${iso}`;
    const load = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(storeKey) || "[]") as string[]); } catch { return new Set(); } };
    const save = (set: Set<string>) => { try { localStorage.setItem(storeKey, JSON.stringify([...set])); } catch { /* quota / private mode */ } };
    const esc = (str: string) => str.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string));

    const check = () => {
      if (todayIso() !== iso) return; // day rolled over — the effect re-runs and reschedules
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const done = load();
      const due: { time: string; med: string; who: string }[] = [];
      meds.forEach((m) => {
        if (!activeOn(m, iso)) return;
        parseSlots(s(m.frequency)).forEach((slot) => {
          if (slot === "PRN") return;
          const [h, mm] = SLOT_TIME[slot].split(":").map(Number);
          if (h * 60 + mm > nowMin) return; // not due yet
          const mar = (marQ.data || []).find((a) => s(a.medicationId) === s(m.id) && dayOf(a.scheduledTime) === iso && new Date(s(a.scheduledTime)).getHours() === SLOT_HOUR[slot]);
          const status = mar ? s(mar.status).toUpperCase() : "PENDING";
          if (["GIVEN", "REFUSED", "HELD"].includes(status)) return; // already actioned
          const key = `${s(m.id)}|${slot}`;
          if (done.has(key)) return;
          done.add(key);
          const r = residents.find((x: Row) => s(x.id) === s(m.residentId));
          due.push({ time: to12h(SLOT_TIME[slot]), med: splitName(s(m.name))[0], who: `${s(r?.name) || "Resident"}${r?.room ? ` (Rm ${r.room})` : ""}` });
        });
      });
      if (!due.length) return;
      save(done);
      const pillSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`;
      const rowsHtml = due.slice(0, 6).map((d) => `<div style="display:flex;gap:8px;align-items:flex-start;padding:4px 0;border-top:1px solid #f1f5f9"><span style="flex:none;font-weight:700;font-size:11px;color:#1d4ed8;background:#eff6ff;border-radius:6px;padding:2px 7px;line-height:1.5;letter-spacing:.02em">${esc(d.time)}</span><span style="font-size:12px;color:#334155;line-height:1.4"><b style="color:#0f172a">${esc(d.med)}</b> — ${esc(d.who)}</span></div>`).join("");
      const moreHtml = due.length > 6 ? `<div style="font-size:11px;color:#64748b;padding-top:6px">+ ${due.length - 6} more due</div>` : "";
      Swal.fire({
        toast: true, position: "bottom-end", showConfirmButton: false, timer: 9000, timerProgressBar: true, width: 348, padding: "0.9em 1.05em",
        html: `<div style="text-align:left"><div style="display:flex;align-items:center;gap:9px;padding-bottom:6px"><span style="width:30px;height:30px;border-radius:9px;background:#dbeafe;display:inline-flex;align-items:center;justify-content:center;flex:none">${pillSvg}</span><span style="font-weight:800;font-size:13.5px;color:#0f172a">${due.length} medication${due.length > 1 ? "s" : ""} due now</span></div>${rowsHtml}${moreHtml}</div>`,
      });
    };

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [meds, marQ.data, residents]);

  // ── Resident detail ────────────────────────────────────────────────────────
  if (openRes) {
    const rMeds = (medsByRes.get(s(openRes.id)) || []).filter((m) => activeOn(m, date));
    return (
      <div className="min-h-full bg-[var(--clinical-ground)] -m-4 sm:-m-6 p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4"><label className="text-sm text-slate-500" htmlFor="mar-date-detail">Date:</label><input id="mar-date-detail" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm" /></div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3"><ClinicalButton variant="secondary" size="sm" onClick={() => setOpenRes(null)}><ChevronLeft className="w-4 h-4" /> Back</ClinicalButton><div><h1 className="text-2xl font-bold text-[var(--clinical-ink)]">{s(openRes.name)}</h1><p className="text-sm text-[var(--clinical-muted)]">Daily MAR — {date}</p></div></div>
          <ClinicalButton variant="accent" onClick={() => setAddFor(openRes)}><Plus className="w-4 h-4" /> Add Medication</ClinicalButton>
        </div>
        <div className="space-y-3">
          {rMeds.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No active medications for this date.</div>
            : rMeds.map((m) => { const [brand, generic] = splitName(s(m.name)); const occ = occurrencesFor(m, date); return (
              <div key={s(m.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-bold text-slate-900 flex flex-wrap items-center gap-2">{brand}{isVitalsRequired(s(m.id)) && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700"><Activity className="w-3 h-3" /> Vitals required</span>}</p>{generic && <p className="text-xs text-slate-400">{generic}</p>}<p className="text-sm text-slate-600 mt-0.5">{s(m.dosage) || "NA"} · {s(m.route) || "oral"} · {s(m.frequency)}</p>{s(m.reason) && <p className="text-xs text-slate-400 mt-0.5">For: {s(m.reason)}</p>}</div>
                  <div className="flex items-center gap-1"><button onClick={() => setAddFor({ ...m, __edit: true })} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><Pencil className="w-4 h-4" /></button><button onClick={async () => { const c = await Swal.fire({ title: "Discontinue medication?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" }); if (c.isConfirmed) { await updateRecord("medications", s(m.id), { status: "DISCONTINUED" }); await refetch(); } }} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button></div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {occ.map((o, i) => { const Icon = STATUS_ICON[o.status]; return (
                    <button key={i} onClick={() => doseAction(m, o.slot, date, o.marId, o.status, administer)} title={o.reason || undefined} className={`flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl border ${STATUS_CLS[o.status]}`}>
                      <span className="text-sm font-bold">{o.time}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium"><Icon className="w-3.5 h-3.5" />{o.status === "PENDING" ? "Pending" : o.status[0] + o.status.slice(1).toLowerCase()}</span>
                    </button>
                  ); })}
                </div>
                {occ.some((o) => o.reason && (o.status === "REFUSED" || o.status === "HELD")) && (
                  <div className="mt-2 space-y-1">
                    {occ.filter((o) => o.reason && (o.status === "REFUSED" || o.status === "HELD")).map((o, i) => (
                      <p key={i} className="text-xs text-slate-500"><span className="font-semibold text-slate-600">{o.status === "REFUSED" ? "Refused" : "Held"} · {o.time}:</span> {o.reason}</p>
                    ))}
                  </div>
                )}
              </div>
            ); })}
        </div>
        {addFor && <AddMedicationModal resident={openRes} med={addFor.__edit ? addFor : null} vitalsRequired={addFor.__edit ? isVitalsRequired(s(addFor.id)) : false} onSaveVitalsFlag={saveVitalsFlag} onClose={() => setAddFor(null)} onDone={refetch} />}
      </div>
    );
  }

  // ── Main (Daily MAR + Medication Summary) ──────────────────────────────────
  return (
    <div className="min-h-full bg-[var(--clinical-ground)] -m-4 sm:-m-6 p-4 sm:p-6">
      <ClinicalHeader title="Medication Administration Record" subtitle="Track and document daily medication administration" />
      <div className="inline-flex gap-1 rounded-xl p-1 mb-5 mt-5" style={{ backgroundColor: "var(--clinical-surface-2)" }} role="tablist" aria-label="MAR view">
        {([["daily", "Daily MAR"], ["summary", "Medication Summary"]] as const).map(([v, label]) => (
          <button key={v} role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${tab === v ? "text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`} style={tab === v ? { backgroundColor: "var(--clinical-panel)" } : undefined}>{label}</button>
        ))}
      </div>

      {tab === "daily" ? (<>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <ClinicalButton variant="secondary" size="sm" onClick={() => shiftDate(-1)} aria-label="Previous day" className="!px-2.5"><ChevronLeft className="w-4 h-4" /></ClinicalButton>
          <div className="relative">
            <input id="mar-date-main" aria-label="Viewed date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="px-3 py-2 rounded-lg border text-sm text-[var(--clinical-ink)] bg-[var(--clinical-surface)]" style={{ borderColor: "var(--clinical-line-strong)" }} />
          </div>
          <ClinicalButton variant="secondary" size="sm" onClick={() => shiftDate(1)} aria-label="Next day" className="!px-2.5"><ChevronRight className="w-4 h-4" /></ClinicalButton>
          {date !== todayIso() && (
            <ClinicalButton variant="secondary" size="sm" onClick={() => setDate(todayIso())}>Today</ClinicalButton>
          )}
          <span className="flex-1" />
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><BellRing className="w-3.5 h-3.5" /> Reminders on</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <MarStat value={facility.total} label="Total Doses" accent="ink" />
          <MarStat value={facility.given} label="Given" accent="given" />
          <MarStat value={facility.pending} label="Pending" accent="pending" />
          <MarStat value={facility.refusedHeld} label="Refused / Held" accent="refused" />
        </div>
        <div className="relative mb-5"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or room…" aria-label="Search residents by name or room" className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
        <DataState
          loading={resQ.loading && residents.length === 0}
          error={resQ.error}
          empty={filteredResidents.length === 0}
          emptyTitle={q ? "No residents match" : "No residents yet"}
          emptyHint={q ? "Try a different name or room number." : "Residents will appear here once they're admitted to your community."}
          onRetry={() => void resQ.refetch()}
          skeletonRows={5}
        >
          <div className="space-y-2">
            {filteredResidents.map((r: Row) => { const st = resStats(s(r.id)); const initials = s(r.name).split(" ").map((w: string) => w[0]).slice(0, 2).join(""); const scheduled = st.total > 0; return (
              <button key={s(r.id)} onClick={() => setOpenRes(r)} className="group w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition hover:shadow-sm hover:shadow-black/[0.04]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="font-semibold text-[var(--clinical-ink)] truncate">{s(r.name)}</p>
                    <span className="shrink-0 text-[11px] font-medium text-[var(--clinical-muted)] border rounded px-1.5 py-0.5" style={{ borderColor: "var(--clinical-line-strong)" }}>Rm {s(r.room)}</span>
                  </div>
                  {scheduled ? (
                    <div className="mt-2 flex items-center gap-2.5">
                      <AdherenceBar given={st.given} refusedHeld={st.refused + st.held} total={st.total} />
                      <span className="shrink-0 text-xs font-medium text-[var(--clinical-muted)] tabular-nums">{st.given}/{st.total} given</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-[var(--clinical-muted)]">No doses scheduled today</p>
                  )}
                </div>
                {scheduled && (st.pending > 0 ? (
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--clinical-amber)]">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--clinical-amber)" }} />{st.pending} due
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-[var(--clinical-green)]">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Done
                  </span>
                ))}
                <ChevronRight className="w-5 h-5 shrink-0 text-[var(--clinical-muted)] transition group-hover:translate-x-0.5" />
              </button>
            ); })}
          </div>
        </DataState>
      </>) : <SummaryView residents={residents} meds={meds} />}

      {addFor && <AddMedicationModal resident={addFor} med={null} vitalsRequired={false} onSaveVitalsFlag={saveVitalsFlag} onClose={() => setAddFor(null)} onDone={refetch} />}
    </div>
  );
}

// Choose Given/Refused/Held for a dose. Refused/Held require a documented reason
// before the dose is recorded; the reason is saved on the administration record.
async function doseAction(m: Row, slot: string, iso: string, marId: string, current: MarStatus, administer: (m: Row, slot: string, iso: string, marId: string, status: "GIVEN" | "REFUSED" | "HELD", reason?: string) => Promise<void>) {
  const { value: status } = await Swal.fire({
    title: `Record dose — ${splitName(s(m.name))[0]}`, input: "radio",
    inputOptions: { GIVEN: "✅ Given", REFUSED: "❌ Refused", HELD: "⏸ Held" },
    inputValue: current === "PENDING" ? "GIVEN" : current,
    showCancelButton: true, confirmButtonText: "Continue", confirmButtonColor: "#2563eb",
  });
  if (!status) return;
  let reason = "";
  if (status === "REFUSED" || status === "HELD") {
    const { value, isConfirmed } = await Swal.fire({
      title: status === "REFUSED" ? "Reason for refusal" : "Reason held",
      input: "textarea",
      inputPlaceholder: status === "REFUSED" ? "Why did the resident refuse this dose?" : "Why is this dose being held?",
      inputAttributes: { "aria-label": "Reason" },
      showCancelButton: true, confirmButtonText: "Save dose", confirmButtonColor: "#2563eb",
      inputValidator: (v: string) => (!v || !v.trim() ? "Please document a reason" : null),
    });
    if (!isConfirmed) return; // cancelling the reason aborts the record
    reason = String(value || "").trim();
  }
  await administer(m, slot, iso, marId, status as "GIVEN" | "REFUSED" | "HELD", reason);
}

type StatAccent = "ink" | "given" | "pending" | "refused";
function MarStat({ value, label, accent }: { value: number; label: string; accent: StatAccent }) {
  const color = { ink: "var(--clinical-ink)", given: "var(--clinical-green)", pending: "var(--clinical-amber)", refused: "var(--clinical-coral)" }[accent];
  const top = { ink: "teal", given: "green", pending: "amber", refused: "coral" }[accent] as "teal" | "green" | "amber" | "coral";
  return (
    <ClinicalCard top={top} className="p-4 text-center">
      <p className="text-3xl font-bold tabular-nums" style={{ color, fontFamily: SERIF }}>{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{label}</p>
    </ClinicalCard>
  );
}

// Segmented daily-adherence meter: green = given, coral = refused/held, and the
// remaining track = still pending. Replaces the lone progress bar that rendered
// as an empty grey line for residents with nothing scheduled.
function AdherenceBar({ given, refusedHeld, total }: { given: number; refusedHeld: number; total: number }) {
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  const pending = Math.max(0, total - given - refusedHeld);
  return (
    <div className="h-2 flex-1 min-w-0 rounded-full overflow-hidden flex" style={{ backgroundColor: "var(--clinical-surface-2)" }} role="img" aria-label={`${given} given, ${refusedHeld} refused or held, ${pending} pending of ${total} doses`}>
      <div style={{ width: `${pct(given)}%`, backgroundColor: "var(--clinical-green)" }} />
      <div style={{ width: `${pct(refusedHeld)}%`, backgroundColor: "var(--clinical-coral)" }} />
    </div>
  );
}

// ── Medication Summary (Image 50) ────────────────────────────────────────────
function SummaryView({ residents, meds }: { residents: Row[]; meds: Row[] }) {
  const [search, setSearch] = useState("");
  const [resFilter, setResFilter] = useState("");
  const resName = (id: string) => { const r = residents.find((x) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "", room: "" }; };
  const active = meds.filter((m) => s(m.status) === "ACTIVE" || s(m.status) === "PENDING");
  const discontinued = meds.filter((m) => s(m.status) === "DISCONTINUED").length;
  const onMeds = new Set(active.map((m) => s(m.residentId))).size;
  const prn = active.filter((m) => /prn|as needed/i.test(s(m.frequency))).length;
  const q = search.trim().toLowerCase();
  const filtered = active.filter((m) => { const rn = resName(s(m.residentId)); const okQ = !q || s(m.name).toLowerCase().includes(q) || rn.name.toLowerCase().includes(q) || s(m.prescribedBy).toLowerCase().includes(q); return okQ && (!resFilter || s(m.residentId) === resFilter); });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MarStat value={active.length} label="Active Medications" accent="given" />
        <MarStat value={discontinued} label="Discontinued" accent="ink" />
        <MarStat value={onMeds} label="Residents on Meds" accent="ink" />
        <MarStat value={prn} label="PRN Medications" accent="pending" />
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search medication, resident, or prescriber…" className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40" /></div>
        <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} className="px-3 py-2.5 rounded-2xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">All Residents</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}</select>
      </div>
      <p className="text-sm font-bold text-green-700 flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> ACTIVE MEDICATIONS ({filtered.length})</p>
      <div className="space-y-3">
        {filtered.map((m) => { const [brand, generic] = splitName(s(m.name)); const rn = resName(s(m.residentId)); return (
          <div key={s(m.id)} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className="w-10 h-10 rounded-full bg-green-50 text-green-600 flex items-center justify-center shrink-0"><Pill className="w-5 h-5" /></span>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-slate-900">{brand} {generic && <span className="text-xs font-normal text-slate-400">({generic})</span>}</p>
                <p className="text-xs text-slate-500 mt-0.5"><b className="text-slate-600">Dose:</b> {s(m.dosage) || "NA"} · <b className="text-slate-600">Route:</b> {s(m.route) || "oral"} · <b className="text-slate-600">Freq:</b> {s(m.frequency)}{s(m.prescribedBy) ? <> · <b className="text-slate-600">Prescriber:</b> {s(m.prescribedBy)}</> : ""} · <b className="text-slate-600">Started:</b> {dayOf(m.startDate)}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">{parseSlots(s(m.frequency)).map((sl) => <span key={sl} className="text-[11px] font-medium text-blue-600 border border-blue-200 rounded-lg px-2 py-0.5">{SLOT_TIME[sl]}</span>)}</div>
                {s(m.reason) && <p className="text-xs italic text-slate-400 mt-1.5">{s(m.reason)}</p>}
              </div>
              <div className="text-right shrink-0"><span className="text-[11px] font-semibold text-blue-600 border border-blue-200 rounded px-1.5 py-0.5">Rm {rn.room}</span><p className="text-xs text-slate-400 mt-1">{rn.name}</p></div>
            </div>
          </div>
        ); })}
        {filtered.length === 0 && <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No medications match.</div>}
      </div>
    </div>
  );
}

// ── Add / Edit Medication (no prescriber input per request) ──────────────────
function AddMedicationModal({ resident, med, vitalsRequired = false, onSaveVitalsFlag, onClose, onDone }: { resident: Row; med: Row | null; vitalsRequired?: boolean; onSaveVitalsFlag: (medId: string, required: boolean) => Promise<void>; onClose: () => void; onDone: () => Promise<void> }) {
  const editing = !!med;
  const [brand, gen] = med ? splitName(s(med.name)) : ["", ""];
  const [brandName, setBrandName] = useState(brand);
  const [generic, setGeneric] = useState(gen);
  const [dosage, setDosage] = useState(med ? s(med.dosage) : "");
  const [route, setRoute] = useState(med ? s(med.route) || "Oral" : "Oral");
  const [frequency, setFrequency] = useState(med ? s(med.frequency) : "");
  const [startDate, setStartDate] = useState(med ? dayOf(med.startDate) || todayIso() : todayIso());
  const [endDate, setEndDate] = useState(med ? dayOf(med.endDate) : "");
  const [reason, setReason] = useState(med ? s(med.reason) : "");
  const [instructions, setInstructions] = useState(med ? s(med.sideEffects) : "");
  const [needsVitals, setNeedsVitals] = useState(vitalsRequired);
  const [saving, setSaving] = useState(false);
  const [showPin, setShowPin] = useState(false);

  // Validate, then require the 4-digit signing PIN before the order is written.
  const tryAdd = () => {
    if (!brandName.trim() || !dosage.trim() || !frequency) { Swal.fire({ title: "Missing required fields", text: "Brand name, dose, and frequency are required.", icon: "warning" }); return; }
    setShowPin(true);
  };
  const doSubmit = async () => {
    setSaving(true);
    try {
      const name = generic.trim() ? `${brandName.trim()} (${generic.trim()})` : brandName.trim();
      const payload: Row = { name, dosage: dosage.trim(), route, frequency, startDate: new Date(startDate).toISOString(), endDate: endDate ? new Date(endDate).toISOString() : null, reason: reason.trim() || null, sideEffects: instructions.trim() || null };
      let medId = editing ? s(med!.id) : "";
      if (editing) await updateRecord("medications", medId, payload);
      else { const res = await createRecord("medications", { residentId: s(resident.id), status: "ACTIVE", ...payload }); medId = s((res as Row)?.data?.id || (res as Row)?.id || ""); }
      await onSaveVitalsFlag(medId, needsVitals);
      await onDone(); onClose();
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: editing ? "Medication updated" : "Medication added", showConfirmButton: false, timer: 1500 });
    } catch (e) { Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "", icon: "error" }); }
    finally { setSaving(false); }
  };
  const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "block text-sm font-bold text-slate-700 mb-1.5";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">{editing ? "Edit" : "Add"} Medication <span className="font-normal text-slate-400">— {s(resident.name)}</span></h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div><label className={lbl}>Brand Name <span className="text-red-500">*</span></label><input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="e.g., Amlodipine" className={inp} /></div>
          <div><label className={lbl}>Generic Name</label><input value={generic} onChange={(e) => setGeneric(e.target.value)} placeholder="e.g., Amlodipine besylate" className={inp} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Dose <span className="text-red-500">*</span></label><input value={dosage} onChange={(e) => setDosage(e.target.value)} placeholder="e.g., 5mg" className={inp} /></div>
            <div><label className={lbl}>Route <span className="text-red-500">*</span></label><select value={route} onChange={(e) => setRoute(e.target.value)} className={inp}>{ROUTES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          </div>
          <div><label className={lbl}>Frequency <span className="text-red-500">*</span></label><select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inp}><option value="">Select frequency</option>{FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}</select></div>
          {frequency && <div><label className={lbl}>Scheduled Times</label><div className="flex flex-wrap gap-1.5">{parseSlots(frequency).map((sl) => <span key={sl} className="text-xs font-medium text-blue-600 border border-blue-200 rounded-lg px-2 py-1">{SLOT_TIME[sl]}</span>)}</div><p className="text-[11px] text-slate-400 mt-1">Derived from frequency.</p></div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Start Date</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inp} /></div>
            <div><label className={lbl}>End Date</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} /></div>
          </div>
          <div><label className={lbl}>Indication</label><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g., Hypertension management" className={inp} /></div>
          <div><label className={lbl}>Special Instructions</label><input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g., Take with food, monitor BP" className={inp} /></div>
          <label className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 cursor-pointer">
            <input type="checkbox" checked={needsVitals} onChange={(e) => setNeedsVitals(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-400" />
            <span><span className="flex items-center gap-1.5 text-sm font-bold text-amber-800"><Activity className="w-4 h-4" /> Requires vitals before administration</span><span className="block text-xs text-amber-700 mt-0.5">Nurses are alerted to record vitals first (Vitals First) when marking a dose Given.</span></span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100"><ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton><ClinicalButton variant="accent" onClick={tryAdd} disabled={saving}>{saving ? "Saving…" : editing ? "Save Changes" : "Add Medication"}</ClinicalButton></div>
      </div>
      <SignatureModal open={showPin} onClose={() => setShowPin(false)} onSigned={doSubmit} mode="sign" title="Sign to save medication" description={`Enter your 4-digit signing PIN to ${editing ? "update" : "add"} this medication order.`} />
    </div>
  );
}
