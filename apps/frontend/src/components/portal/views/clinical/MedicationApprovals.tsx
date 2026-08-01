"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Check, X, Clock, Pill, ShieldCheck, Plus, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/**
 * Medication Approvals (Module 13 / 05) — new prescriptions are created PENDING
 * and require a Care Manager sign-off before they go ACTIVE in the MAR. Approve
 * activates it; Reject records a reason and notifies the submitting clinician.
 */
export default function MedicationApprovals() {
  const { data: rows, loading, refetch } = useLiveQuery<Row>("medications", {
    query: "include=resident&take=400",
    tables: ["Medication", "Resident"],
  });

  const [session, setSession] = useState<{ id: string | null; name: string | null }>({ id: null, name: null });
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (d?.authenticated) setSession({ id: d.session?.userId ?? null, name: d.session?.name ?? d.session?.role ?? "Care Manager" });
    }).catch(() => {});
  }, []);

  // Residents for the "Request Meds" submission form.
  const { data: residentRows } = useLiveQuery<Row>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map((r) => ({ id: s(r.id), name: `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—", room: s(r.roomNumber) })), [residentRows]);

  const [showRequest, setShowRequest] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", name: "", dosage: "", route: "ORAL", frequency: "", reason: "" });
  const setField = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submitRequest = async () => {
    if (!form.residentId || !form.name.trim()) { Swal.fire("Missing fields", "Resident and medication name are required.", "warning"); return; }
    setSaving(true);
    try {
      await createRecord("medications", {
        residentId: form.residentId, name: form.name.trim(), dosage: form.dosage.trim() || null,
        route: form.route, frequency: form.frequency.trim() || null, reason: form.reason.trim() || null,
        status: "PENDING", submittedById: session.id, submittedByName: session.name,
      });
      await refetch();
      setShowRequest(false);
      setForm({ residentId: "", name: "", dosage: "", route: "ORAL", frequency: "", reason: "" });
      Swal.fire({ title: "Request submitted", text: "Sent for Care Manager approval.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) { Swal.fire("Failed", e instanceof Error ? e.message : "Could not submit the request.", "error"); }
    finally { setSaving(false); }
  };

  const pending = useMemo(() => rows.filter((m) => s(m.status) === "PENDING"), [rows]);
  const decided = useMemo(
    () => rows.filter((m) => m.approvedAt || m.rejectionReason).sort((a, b) => new Date(s(b.updatedAt)).getTime() - new Date(s(a.updatedAt)).getTime()).slice(0, 30),
    [rows],
  );

  const residentName = (m: Row) => {
    const r = (m.resident ?? {}) as Row;
    return `${s(r.firstName)} ${s(r.lastName)}`.trim() || "—";
  };

  const notifySubmitter = async (m: Row, title: string, message: string) => {
    const uid = s(m.submittedById);
    if (!uid) return;
    try {
      await createRecord("notifications", { userId: uid, type: "MEDICATION_REMINDER", title, message, relatedEntityId: s(m.id), relatedEntityType: "medication", severity: "INFO" });
    } catch { /* non-critical */ }
  };

  const approve = async (m: Row) => {
    const res = await Swal.fire({ title: "Approve prescription?", text: `Activate ${s(m.name)} ${s(m.dosage)} for ${residentName(m)} in the MAR?`, icon: "question", showCancelButton: true, confirmButtonColor: "#16a34a" });
    if (!res.isConfirmed) return;
    try {
      await updateRecord("medications", s(m.id), { status: "ACTIVE", approvedByName: session.name, approvedAt: new Date().toISOString(), rejectionReason: null });
      await notifySubmitter(m, "Prescription approved", `${s(m.name)} for ${residentName(m)} was approved and is now active in the MAR.`);
      await refetch();
      Swal.fire({ title: "Approved", text: "Now active in the MAR.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not approve.", "error");
    }
  };

  const reject = async (m: Row) => {
    const res = await Swal.fire({ title: "Reject prescription?", input: "textarea", inputLabel: "Reason (sent back to the submitting clinician)", inputPlaceholder: "e.g. dose too high for renal function…", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Reject" });
    if (!res.isConfirmed) return;
    const reason = res.value || "Rejected";
    try {
      await updateRecord("medications", s(m.id), { status: "DISCONTINUED", rejectionReason: reason, approvedByName: null, approvedAt: null });
      await notifySubmitter(m, "Prescription rejected", `${s(m.name)} for ${residentName(m)} was rejected: ${reason}`);
      await refetch();
      Swal.fire({ title: "Rejected", text: "The submitting clinician has been notified.", icon: "success", timer: 1800, showConfirmButton: false });
    } catch (e) {
      Swal.fire("Failed", e instanceof Error ? e.message : "Could not reject.", "error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2 flex items-center gap-3">
            <ClipboardCheck className="w-8 h-8 text-blue-500" /> Medication Approvals
          </h1>
          <p className="text-gray-600">Nurses request meds; a Care Manager signs off before they activate in the MAR.</p>
        </div>
        <button onClick={() => setShowRequest(true)} className="self-start inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-sm font-semibold shadow hover:shadow-lg transition active:scale-95">
          <Plus className="w-4 h-4" /> Request Meds
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Stat label="Pending Approval" value={String(pending.length)} tint="text-amber-600 bg-amber-50" icon={Clock} />
        <Stat label="Approved" value={String(rows.filter((m) => m.approvedAt).length)} tint="text-green-600 bg-green-50" icon={ShieldCheck} />
        <Stat label="Rejected" value={String(rows.filter((m) => m.rejectionReason && s(m.status) === "DISCONTINUED").length)} tint="text-red-600 bg-red-50" icon={X} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 font-bold text-gray-800 flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Awaiting Approval</div>
        <div className="divide-y divide-gray-100">
          {loading && pending.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-500">Loading…</p>
          ) : pending.length === 0 ? (
            <p className="px-5 py-8 text-center text-gray-500">No prescriptions awaiting approval. 🎉</p>
          ) : pending.map((m) => (
            <div key={s(m.id)} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 flex items-center gap-2"><Pill className="w-4 h-4 text-indigo-500" /> {s(m.name)} <span className="text-gray-500 font-normal">{s(m.dosage)} · {s(m.route) || "PO"} · {s(m.frequency)}</span></p>
                <p className="text-xs text-gray-500 mt-0.5">{residentName(m)}{m.submittedByName ? ` · submitted by ${s(m.submittedByName)}` : ""}{m.reason ? ` · ${s(m.reason)}` : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => approve(m)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-green-500 text-white text-sm font-semibold hover:bg-green-600"><Check className="w-4 h-4" /> Approve</button>
                <button onClick={() => reject(m)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50"><X className="w-4 h-4" /> Reject</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {decided.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 font-bold text-gray-800">Recent Decisions</div>
          <div className="divide-y divide-gray-100">
            {decided.map((m) => (
              <div key={s(m.id)} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700">{s(m.name)} · {residentName(m)}</span>
                {m.approvedAt ? (
                  <span className="inline-flex items-center gap-1 text-green-700"><Check className="w-3.5 h-3.5" /> Approved{m.approvedByName ? ` · ${s(m.approvedByName)}` : ""}</span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-red-600" title={s(m.rejectionReason)}><X className="w-3.5 h-3.5" /> Rejected</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between bg-gradient-to-r from-blue-500 to-indigo-600 p-5 text-white">
              <h2 className="text-lg font-bold flex items-center gap-2"><Pill className="w-5 h-5" /> Request Medication</h2>
              <button onClick={() => setShowRequest(false)} className="rounded-lg p-1.5 hover:bg-white/20"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Resident <span className="text-red-500">*</span></label>
                <select value={form.residentId} onChange={(e) => setField("residentId", e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400">
                  <option value="">Select resident…</option>
                  {residents.map((r) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Medication <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="e.g. Amlodipine" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Dosage</label>
                  <input value={form.dosage} onChange={(e) => setField("dosage", e.target.value)} placeholder="e.g. 5mg" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-gray-700">Route</label>
                  <select value={form.route} onChange={(e) => setField("route", e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-blue-400">
                    {["ORAL", "IV", "IM", "SUBCUTANEOUS", "TOPICAL", "INHALATION", "RECTAL", "OTHER"].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Frequency</label>
                <input value={form.frequency} onChange={(e) => setField("frequency", e.target.value)} placeholder="e.g. Once daily, BID, PRN" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400" />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-gray-700">Indication / reason</label>
                <textarea value={form.reason} onChange={(e) => setField("reason", e.target.value)} rows={2} placeholder="Why is this being prescribed?" className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:ring-2 focus:ring-blue-400 resize-y" />
              </div>
              <p className="text-xs text-gray-500">Saved as <span className="font-semibold">Pending</span> — it won't activate in the MAR until a Care Manager approves it.</p>
            </div>
            <div className="sticky bottom-0 flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button onClick={() => setShowRequest(false)} disabled={saving} className="rounded-lg px-4 py-2 text-gray-700 hover:bg-gray-100 disabled:opacity-50">Cancel</button>
              <button onClick={submitRequest} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 px-6 py-2 font-semibold text-white shadow hover:shadow-lg disabled:opacity-50">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} {saving ? "Submitting…" : "Submit request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint, icon: Icon }: { label: string; value: string; tint: string; icon: typeof Clock }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tint}`}><Icon className="w-4 h-4" /></span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
