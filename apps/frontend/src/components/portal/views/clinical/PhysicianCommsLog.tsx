"use client";

import { useEffect, useMemo, useState } from "react";
import { Phone, Plus, X, Printer, Search, Check, Video, FileText, User, Link2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { ClinicalHeader, ClinicalCard, StatusPill, MicroLabel, Eyebrow, CLINICAL } from "./clinical-ui";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const METHODS = ["PHONE", "IN_PERSON", "WRITTEN", "TELEMEDICINE"] as const;
const METHOD_ICON: Record<string, typeof Phone> = { PHONE: Phone, IN_PERSON: User, WRITTEN: FileText, TELEMEDICINE: Video };
const METHOD_LABEL: Record<string, string> = { PHONE: "Phone Call", IN_PERSON: "In-Person Visit", WRITTEN: "Written", TELEMEDICINE: "Telemedicine" };

/** Physician Communication Log (Module 11) — clinical-editorial style (PDF-matched). */
export default function PhysicianCommsLog() {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("physician-communications", { query: "include=resident&take=400", tables: ["PhysicianCommunication"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "" });

  const rname = (c: Row) => { const r = (c.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
  const rroom = (c: Row) => s((c.resident as Row)?.roomNumber) || "—";
  const isOverdue = (c: Row) => c.followUpRequired && !c.followUpCompletedAt && c.followUpDeadline && new Date(s(c.followUpDeadline)).getTime() < Date.now();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => !q || rname(c).toLowerCase().includes(q) || s(c.physicianName).toLowerCase().includes(q) || s(c.reason).toLowerCase().includes(q));
  }, [rows, search]);
  const overdueCount = rows.filter(isOverdue).length;

  const submit = async () => {
    if (!form.residentId || !form.physicianName.trim() || !form.reason.trim() || !form.instructionsReceived.trim()) { Swal.fire("Missing fields", "Resident, physician, reason, and instructions received are required.", "warning"); return; }
    setBusy(true);
    try {
      await createRecord("physician-communications", {
        residentId: form.residentId, method: form.method, physicianName: form.physicianName.trim(),
        reason: form.reason.trim(), instructionsReceived: form.instructionsReceived.trim(),
        loggedById: session.id, loggedByName: session.name, followUpRequired: form.followUpRequired,
        followUpDeadline: form.followUpRequired && form.followUpDeadline ? new Date(form.followUpDeadline).toISOString() : null,
        occurredAt: new Date().toISOString(),
      });
      await refetch(); setShowAdd(false);
      setForm({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "" });
      Swal.fire({ title: "Logged", text: "Physician communication recorded.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not save.", "error"); } finally { setBusy(false); }
  };
  const completeFollowUp = async (c: Row) => { try { await updateRecord("physician-communications", s(c.id), { followUpCompletedAt: new Date().toISOString() }); await refetch(); } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); } };

  const inp = "w-full rounded-md border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30 text-sm";

  return (
    <div className="-m-4 sm:-m-6 p-4 sm:p-6 min-h-full space-y-5 print:m-0 print:p-0" style={{ background: CLINICAL.ground }}>
      <div className="print:hidden">
        <ClinicalHeader
          eyebrow="Physician Communication Log"
          title="Physician Communications"
          subtitle="Every physician contact on record — with instructions received verbatim and follow-up tracking."
          right={
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-[#2E4A48]/25 bg-white px-4 py-2 text-sm font-semibold text-[#2B2B27] hover:bg-[#2E4A48]/5"><Printer className="w-4 h-4" /> Print</button>
              <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 rounded-md bg-[#2E4A48] px-4 py-2 text-sm font-semibold text-white hover:bg-[#25403D]"><Plus className="w-4 h-4" /> Log Contact</button>
            </div>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-[#8A8D82]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, physician, or reason…" className="w-full rounded-md border border-[#D6D8CD] bg-white pl-9 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-[#2E4A48]/30" />
        </div>
        {overdueCount > 0 && <StatusPill status="OVERDUE" className="!text-xs">{`${overdueCount} follow-up${overdueCount === 1 ? "" : "s"} overdue`}</StatusPill>}
      </div>

      <Eyebrow className="print:block">Log Entries</Eyebrow>

      <div className="space-y-4">
        {loading && filtered.length === 0 ? (
          <ClinicalCard className="p-8 text-center text-[#8A8D82]">Loading…</ClinicalCard>
        ) : filtered.length === 0 ? (
          <ClinicalCard className="p-8 text-center text-[#8A8D82]">No physician communications logged.</ClinicalCard>
        ) : filtered.map((c) => {
          const Icon = METHOD_ICON[s(c.method)] ?? Phone;
          const overdue = isOverdue(c);
          return (
            <ClinicalCard key={s(c.id)} top={overdue ? "coral" : "teal"} className="p-5 break-inside-avoid">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2.5">
                  <StatusPill status={s(c.method)} className="!gap-1"><Icon className="w-3 h-3 mr-1 inline" />{METHOD_LABEL[s(c.method)] ?? s(c.method)}</StatusPill>
                  <span className="text-base font-bold text-[#2B2B27]">{s(c.physicianName)}</span>
                </div>
                <span className="text-xs text-[#8A8D82]">{fmt(c.occurredAt)}</span>
              </div>
              <p className="text-[13px] text-[#6B6E63] mb-3">Resident: <span className="font-medium text-[#2B2B27]">{rname(c)}, Room {rroom(c)}</span>{c.loggedByName ? ` · Logged by: ${s(c.loggedByName)}` : ""}</p>

              <div className="border-t border-[#EBEDE4] pt-3">
                <MicroLabel className="!text-[#C0573F]">Reason for contact</MicroLabel>
                <p className="text-sm text-[#2B2B27] mt-0.5">{s(c.reason)}</p>
              </div>
              <div className="border-t border-[#EBEDE4] pt-3 mt-3">
                <MicroLabel className="!text-[#C0573F]">Instructions received</MicroLabel>
                <p className="text-sm text-[#2B2B27] mt-0.5 whitespace-pre-wrap">{s(c.instructionsReceived)}</p>
              </div>

              {c.followUpRequired && (
                <div className="mt-3.5 flex flex-wrap items-center gap-2 text-sm">
                  {c.followUpCompletedAt ? (
                    <span className="inline-flex items-center gap-1 text-[#7E9B6F] font-medium"><Check className="w-4 h-4" /> Follow-up completed {fmt(c.followUpCompletedAt)}</span>
                  ) : (
                    <>
                      <StatusPill status={overdue ? "OVERDUE" : "FOLLOW_UP"}>{overdue ? "OVERDUE" : "FOLLOW-UP REQUIRED"}</StatusPill>
                      <span className="text-[13px] text-[#6B6E63]">Deadline: {fmt(c.followUpDeadline)}</span>
                      <button onClick={() => completeFollowUp(c)} className="print:hidden text-xs font-semibold text-[#2E4A48] hover:underline">Mark complete</button>
                    </>
                  )}
                </div>
              )}
            </ClinicalCard>
          );
        })}
      </div>

      <div className="rounded-lg bg-[#2E4A48] px-5 py-3.5 flex items-center gap-3 print:hidden">
        <Link2 className="w-4 h-4 text-[#C0573F] flex-shrink-0" />
        <p className="text-sm text-[#D7DAD1]"><span className="font-semibold text-white">SBAR Link:</span> escalations can be directly linked to the resulting physician communication — one record for the full clinical context.</p>
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:hidden">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-[#2E4A48] p-5 text-white"><h2 className="text-lg font-bold">Log Physician Contact</h2><button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-white/15"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4 p-6">
              <div><MicroLabel>Resident *</MicroLabel><select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className={`${inp} mt-1`}><option value="">Select resident…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><MicroLabel>Method</MicroLabel><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={`${inp} mt-1 bg-white`}>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
                <div><MicroLabel>Physician *</MicroLabel><input value={form.physicianName} onChange={(e) => setForm({ ...form, physicianName: e.target.value })} placeholder="Dr. …" className={`${inp} mt-1`} /></div>
              </div>
              <div><MicroLabel>Reason for contact *</MicroLabel><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={`${inp} mt-1`} /></div>
              <div><MicroLabel>Instructions received (verbatim) *</MicroLabel><textarea value={form.instructionsReceived} onChange={(e) => setForm({ ...form, instructionsReceived: e.target.value })} rows={3} placeholder="Record exactly what the physician instructed…" className={`${inp} mt-1 resize-y`} /></div>
              <div className="flex items-center gap-2"><input id="fu" type="checkbox" checked={form.followUpRequired} onChange={(e) => setForm({ ...form, followUpRequired: e.target.checked })} className="rounded" /><label htmlFor="fu" className="text-sm font-semibold text-[#2B2B27]">Follow-up required</label></div>
              {form.followUpRequired && <div><MicroLabel>Follow-up deadline</MicroLabel><input type="datetime-local" value={form.followUpDeadline} onChange={(e) => setForm({ ...form, followUpDeadline: e.target.value })} className={`${inp} mt-1`} /></div>}
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-[#E1E3D9] bg-[#F5F6F1] px-6 py-4"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-md px-4 py-2 text-[#6B6E63] hover:bg-black/5 disabled:opacity-50">Cancel</button><button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[#2E4A48] px-6 py-2 font-semibold text-white hover:bg-[#25403D] disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
