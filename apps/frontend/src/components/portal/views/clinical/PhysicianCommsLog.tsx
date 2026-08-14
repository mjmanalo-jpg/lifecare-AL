"use client";

import { useEffect, useMemo, useState } from "react";
import { Phone, Plus, X, Printer, Search, Check, Video, FileText, User, Link2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";
import { ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill, MicroLabel, Eyebrow } from "./clinical-ui";

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

  // Escalations, for the SBAR link — a physician communication can be the direct
  // result of an SBAR escalation, giving one record with the full clinical context.
  const { data: escRows } = useLiveQuery<Row>("escalations", { query: "include=resident&take=400", tables: ["Escalation"] });
  const escMap = useMemo(() => new Map(escRows.map((e) => [s(e.id), e])), [escRows]);
  const escSnippet = (e: Row) => { const t = s(e.situation).trim(); return t.length > 52 ? `${t.slice(0, 52)}…` : t || "SBAR escalation"; };

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {}); }, []);

  const [search, setSearch] = useState("");
  const [resFilter, setResFilter] = useState("");
  const [nowMs] = useState(() => Date.now());
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "", relatedEscalationId: "" });

  // Escalations for the resident chosen in the modal (newest first) — the SBAR picker.
  const residentEscalations = useMemo(
    () => escRows.filter((e) => s(e.residentId) === form.residentId).sort((a, b) => new Date(s(b.createdAt)).getTime() - new Date(s(a.createdAt)).getTime()),
    [escRows, form.residentId]
  );

  const rname = (c: Row) => { const r = (c.resident ?? {}) as Row; return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—"; };
  const rroom = (c: Row) => s((c.resident as Row)?.roomNumber) || "—";
  const isOverdue = (c: Row) => c.followUpRequired && !c.followUpCompletedAt && c.followUpDeadline && new Date(s(c.followUpDeadline)).getTime() < nowMs;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => (!resFilter || s(c.residentId) === resFilter) && (!q || rname(c).toLowerCase().includes(q) || s(c.physicianName).toLowerCase().includes(q) || s(c.reason).toLowerCase().includes(q)));
  }, [rows, search, resFilter]);
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
        relatedEscalationId: form.relatedEscalationId || null,
        occurredAt: new Date().toISOString(),
      });
      await refetch(); setShowAdd(false);
      setForm({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "", relatedEscalationId: "" });
      Swal.fire({ title: "Logged", text: "Physician communication recorded.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not save.", "error"); } finally { setBusy(false); }
  };
  const completeFollowUp = async (c: Row) => { try { await updateRecord("physician-communications", s(c.id), { followUpCompletedAt: new Date().toISOString() }); await refetch(); } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); } };

  const inp = "w-full rounded-md border border-[#D6D8CD] px-3 py-2 outline-none focus:ring-2 focus:ring-[#2E4A48]/30 text-sm";

  return (
    <div className="-m-4 min-h-full space-y-5 bg-[var(--clinical-ground)] p-4 sm:-m-6 sm:p-6 print:m-0 print:bg-white print:p-0">
      <div className="print:hidden">
        <ClinicalHeader
          title="Physician Communications"
          subtitle="Every physician contact on record — with instructions received verbatim and follow-up tracking."
          right={
            <div className="flex flex-wrap items-center gap-2">
              <ClinicalButton variant="secondary" onClick={() => window.print()}><Printer className="w-4 h-4" /> Print</ClinicalButton>
              <ClinicalButton onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" /> Log Contact</ClinicalButton>
            </div>
          }
        />
      </div>

      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border bg-[var(--clinical-line)] print:hidden" style={{ borderColor: "var(--clinical-line)" }}>
        <div className="bg-[var(--clinical-surface)] p-4"><MicroLabel>Contacts on record</MicroLabel><p className="mt-1 text-2xl font-bold text-[var(--clinical-ink)]">{rows.length}</p></div>
        <div className="bg-[var(--clinical-surface)] p-4"><MicroLabel>Open follow-ups</MicroLabel><p className="mt-1 text-2xl font-bold text-[var(--clinical-amber)]">{rows.filter((c) => c.followUpRequired && !c.followUpCompletedAt).length}</p></div>
        <div className="bg-[var(--clinical-surface)] p-4"><MicroLabel>Linked SBAR</MicroLabel><p className="mt-1 text-2xl font-bold text-[var(--clinical-panel)]">{rows.filter((c) => c.relatedEscalationId).length}</p></div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border p-3 print:hidden" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, physician, or reason…" className="min-h-11 w-full rounded-xl border bg-[var(--clinical-surface)] py-2.5 pl-10 pr-4 text-sm text-[var(--clinical-ink)] outline-none transition focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line)" }} />
        </div>
        <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} className="min-h-11 rounded-xl border bg-[var(--clinical-surface)] px-3 py-2 text-sm text-[var(--clinical-ink)] outline-none focus:border-[var(--clinical-focus)] focus:ring-2 focus:ring-[var(--clinical-focus)]/20" style={{ borderColor: "var(--clinical-line)" }}>
          <option value="">All residents</option>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Rm {r.room}</option>)}
        </select>
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
          const linked = c.relatedEscalationId ? escMap.get(s(c.relatedEscalationId)) : undefined;
          return (
            <ClinicalCard key={s(c.id)} className="break-inside-avoid overflow-hidden p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b pb-3" style={{ borderColor: "var(--clinical-line)" }}>
                <div className="flex items-center gap-2.5">
                  <StatusPill status={s(c.method)} className="!gap-1"><Icon className="w-3 h-3 mr-1 inline" />{METHOD_LABEL[s(c.method)] ?? s(c.method)}</StatusPill>
                   <span className="text-base font-bold text-[var(--clinical-ink)]">{s(c.physicianName)}</span>
                </div>
                 <span className="rounded-lg bg-[var(--clinical-surface-2)] px-2.5 py-1 text-xs text-[var(--clinical-muted)]">{fmt(c.occurredAt)}</span>
              </div>
              <p className="text-[13px] text-[#6B6E63] mb-3">Resident: <span className="font-medium text-[#2B2B27]">{rname(c)}, Room {rroom(c)}</span>{c.loggedByName ? ` · Logged by: ${s(c.loggedByName)}` : ""}</p>

              <div className="rounded-xl bg-[var(--clinical-surface-2)] p-3">
                <MicroLabel className="!text-[#C0573F]">Reason for contact</MicroLabel>
                <p className="text-sm text-[#2B2B27] mt-0.5">{s(c.reason)}</p>
              </div>
              <div className="rounded-xl bg-[var(--clinical-surface-2)] p-3">
                <MicroLabel className="!text-[#C0573F]">Instructions received</MicroLabel>
                <p className="text-sm text-[#2B2B27] mt-0.5 whitespace-pre-wrap">{s(c.instructionsReceived)}</p>
              </div>

              {linked && (
                <div className="mt-3 rounded-md border border-[#2E4A48]/15 bg-[#2E4A48]/[0.04] p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#2E4A48]"><Link2 className="w-3.5 h-3.5 text-[#C0573F]" /> Linked SBAR Escalation</span>
                    {linked.priority ? <StatusPill status={s(linked.priority)} /> : null}
                    {linked.status ? <StatusPill status={s(linked.status)} /> : null}
                  </div>
                  <p className="text-sm text-[#2B2B27]"><span className="font-semibold text-[#6B6E63]">S:</span> {s(linked.situation) || "—"}</p>
                  {linked.recommendation ? <p className="text-[13px] text-[#6B6E63] mt-0.5"><span className="font-semibold">R:</span> {s(linked.recommendation)}</p> : null}
                  {linked.response ? <p className="text-[13px] text-[#6B6E63] mt-0.5"><span className="font-semibold">Physician response:</span> {s(linked.response)}</p> : null}
                </div>
              )}

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

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:hidden">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-[#2E4A48] p-5 text-white"><h2 className="text-lg font-bold">Log Physician Contact</h2><button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-white/15"><X className="w-5 h-5" /></button></div>
            <div className="space-y-4 p-6">
              <div><MicroLabel>Resident *</MicroLabel><select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value, relatedEscalationId: "" })} className={`${inp} mt-1`}><option value="">Select resident…</option>{residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}</select></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><MicroLabel>Method</MicroLabel><select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={`${inp} mt-1 bg-white`}>{METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></div>
                <div><MicroLabel>Physician *</MicroLabel><input value={form.physicianName} onChange={(e) => setForm({ ...form, physicianName: e.target.value })} placeholder="Dr. …" className={`${inp} mt-1`} /></div>
              </div>
              <div><MicroLabel>Reason for contact *</MicroLabel><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={`${inp} mt-1`} /></div>
              <div><MicroLabel>Instructions received (verbatim) *</MicroLabel><textarea value={form.instructionsReceived} onChange={(e) => setForm({ ...form, instructionsReceived: e.target.value })} rows={3} placeholder="Record exactly what the physician instructed…" className={`${inp} mt-1 resize-y`} /></div>
              <div>
                <MicroLabel className="flex items-center gap-1"><Link2 className="w-3 h-3 text-[#C0573F]" /> Link to SBAR escalation (optional)</MicroLabel>
                <select value={form.relatedEscalationId} onChange={(e) => setForm({ ...form, relatedEscalationId: e.target.value })} disabled={!form.residentId} className={`${inp} mt-1 bg-white disabled:opacity-50`}>
                  <option value="">{form.residentId ? (residentEscalations.length ? "None" : "No escalations for this resident") : "Select a resident first…"}</option>
                  {residentEscalations.map((e) => <option key={s(e.id)} value={s(e.id)}>{s(e.priority) || "SBAR"} · {escSnippet(e)} · {fmt(e.createdAt)}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-[#8A8D82]">Ties this contact to the escalation it resulted from — one record for the full clinical context.</p>
              </div>
              <div className="flex items-center gap-2"><input id="fu" type="checkbox" checked={form.followUpRequired} onChange={(e) => setForm({ ...form, followUpRequired: e.target.checked })} className="rounded" /><label htmlFor="fu" className="text-sm font-semibold text-[#2B2B27]">Follow-up required</label></div>
              {form.followUpRequired && <div><MicroLabel>Follow-up deadline</MicroLabel><input type="datetime-local" value={form.followUpDeadline} onChange={(e) => setForm({ ...form, followUpDeadline: e.target.value })} className={`${inp} mt-1`} /></div>}
            </div>
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-[#E1E3D9] bg-[#F5F6F1] px-6 py-4"><button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-md px-4 py-2 text-[#6B6E63] hover:bg-black/5 disabled:opacity-50">Cancel</button><button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-md bg-[#2E4A48] px-6 py-2 font-semibold text-white hover:bg-[#25403D] disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Saving…" : "Save"}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
