"use client";

import { useEffect, useMemo, useState } from "react";
import { Phone, Plus, X, Printer, Stethoscope, Search, Check, Video, FileText, User } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, updateRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (v: unknown) => (v ? new Date(s(v)).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const METHODS = ["PHONE", "IN_PERSON", "WRITTEN", "TELEMEDICINE"] as const;
const METHOD_ICON: Record<string, typeof Phone> = { PHONE: Phone, IN_PERSON: User, WRITTEN: FileText, TELEMEDICINE: Video };

/**
 * Physician Communication Log (Module 11) — every physician contact on record
 * by method, with instructions received verbatim and follow-up tracking
 * (deadline + overdue badge). Printable per resident for the clinical record.
 */
export default function PhysicianCommsLog() {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("physician-communications", { query: "include=resident&take=400", tables: ["PhysicianCommunication"] });
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? "Clinician" }); }).catch(() => {});
  }, []);

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
    if (!form.residentId || !form.physicianName.trim() || !form.reason.trim() || !form.instructionsReceived.trim()) {
      Swal.fire("Missing fields", "Resident, physician, reason, and instructions received are required.", "warning");
      return;
    }
    setBusy(true);
    try {
      await createRecord("physician-communications", {
        residentId: form.residentId,
        method: form.method,
        physicianName: form.physicianName.trim(),
        reason: form.reason.trim(),
        instructionsReceived: form.instructionsReceived.trim(),
        loggedById: session.id,
        loggedByName: session.name,
        followUpRequired: form.followUpRequired,
        followUpDeadline: form.followUpRequired && form.followUpDeadline ? new Date(form.followUpDeadline).toISOString() : null,
        occurredAt: new Date().toISOString(),
      });
      await refetch();
      setShowAdd(false);
      setForm({ residentId: "", method: "PHONE", physicianName: "", reason: "", instructionsReceived: "", followUpRequired: false, followUpDeadline: "" });
      Swal.fire({ title: "Logged", text: "Physician communication recorded.", icon: "success", timer: 1500, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not save.", "error");
    } finally { setBusy(false); }
  };

  const completeFollowUp = async (c: Row) => {
    try {
      await updateRecord("physician-communications", s(c.id), { followUpCompletedAt: new Date().toISOString() });
      await refetch();
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not update.", "error"); }
  };

  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <Stethoscope className="w-8 h-8 text-teal-500" /> Physician Communication Log
          </h1>
          <p className="text-gray-600">Every physician contact — phone, in-person, written, telemedicine — with instructions received verbatim.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"><Printer className="w-4 h-4" /> Print</button>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-lg"><Plus className="w-4 h-4" /> Log Contact</button>
        </div>
      </div>

      <div className="relative print:hidden">
        <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident, physician, or reason…" className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-blue-400" />
      </div>
      {overdueCount > 0 && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 print:hidden">{overdueCount} follow-up{overdueCount === 1 ? "" : "s"} overdue</div>}

      <div className="space-y-3">
        {loading && filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">No physician communications logged.</div>
        ) : filtered.map((c) => {
          const Icon = METHOD_ICON[s(c.method)] ?? Phone;
          const overdue = isOverdue(c);
          return (
            <div key={s(c.id)} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-5 break-inside-avoid">
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 text-xs font-semibold border border-teal-200"><Icon className="w-3.5 h-3.5" /> {s(c.method).replace("_", "-")}</span>
                  <span className="font-bold text-gray-900">{s(c.physicianName)}</span>
                </div>
                <span className="text-xs text-gray-500">{fmt(c.occurredAt)}</span>
              </div>
              <p className="text-sm text-gray-600 mb-2">{rname(c)} · Room {rroom(c)}{c.loggedByName ? ` · logged by ${s(c.loggedByName)}` : ""}</p>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Reason for contact</p><p className="text-gray-800">{s(c.reason)}</p></div>
                <div><p className="text-xs font-semibold text-gray-500 uppercase mb-1">Instructions received</p><p className="text-gray-800 whitespace-pre-wrap">{s(c.instructionsReceived)}</p></div>
              </div>
              {c.followUpRequired && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {c.followUpCompletedAt ? (
                    <span className="inline-flex items-center gap-1 text-green-700"><Check className="w-4 h-4" /> Follow-up completed {fmt(c.followUpCompletedAt)}</span>
                  ) : (
                    <>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${overdue ? "bg-red-100 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{overdue ? "OVERDUE" : "Follow-up due"} {fmt(c.followUpDeadline)}</span>
                      <button onClick={() => completeFollowUp(c)} className="print:hidden text-xs font-semibold text-blue-600 hover:underline">Mark complete</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 print:hidden">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-teal-500 to-blue-600 p-5 text-white">
              <h2 className="text-xl font-bold flex items-center gap-2"><Stethoscope className="w-5 h-5" /> Log Physician Contact</h2>
              <button onClick={() => setShowAdd(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Resident <span className="text-red-500">*</span></label>
                  <select value={form.residentId} onChange={(e) => setForm({ ...form, residentId: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400">
                    <option value="">Select resident…</option>
                    {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                  </select>
                </div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Method</label>
                  <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-400">{METHODS.map((m) => <option key={m} value={m}>{m.replace("_", "-")}</option>)}</select>
                </div>
                <div><label className="mb-1 block text-sm font-semibold text-gray-700">Physician <span className="text-red-500">*</span></label><input value={form.physicianName} onChange={(e) => setForm({ ...form, physicianName: e.target.value })} placeholder="Dr. …" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Reason for contact <span className="text-red-500">*</span></label><input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>
                <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Instructions received (verbatim) <span className="text-red-500">*</span></label><textarea value={form.instructionsReceived} onChange={(e) => setForm({ ...form, instructionsReceived: e.target.value })} rows={3} placeholder="Record exactly what the physician instructed…" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400 resize-y" /></div>
                <div className="col-span-2 flex items-center gap-2"><input id="fu" type="checkbox" checked={form.followUpRequired} onChange={(e) => setForm({ ...form, followUpRequired: e.target.checked })} className="rounded" /><label htmlFor="fu" className="text-sm font-semibold text-gray-700">Follow-up required</label></div>
                {form.followUpRequired && <div className="col-span-2"><label className="mb-1 block text-sm font-semibold text-gray-700">Follow-up deadline</label><input type="datetime-local" value={form.followUpDeadline} onChange={(e) => setForm({ ...form, followUpDeadline: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" /></div>}
              </div>
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button onClick={() => setShowAdd(false)} disabled={busy} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={submit} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-teal-500 to-blue-600 px-6 py-2 font-semibold text-white shadow hover:shadow-lg disabled:opacity-50"><Plus className="w-4 h-4" /> {busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
