"use client";

/**
 * Clinical Records — a per-resident hub for lab results, therapy sessions,
 * referrals, medication changes, physician orders and diagnoses. Migration-free:
 * all six record collections live in a single app-setting `clinical_records`
 * holding { labs, therapy, referrals, medications, orders, diagnoses }, each a
 * flat array of records keyed by residentId. Read via useLiveQuery over
 * AppSetting, written back with upsertRecord.
 */

import { useMemo, useState } from "react";
import { TestTube, Activity, Send, Pill, ClipboardList, Stethoscope, Plus, Pencil, Trash2, ExternalLink, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";

const KEY = "clinical_records";
const newId = (p: string) => globalThis.crypto?.randomUUID?.() ?? `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (v: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-").replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$1-$2") : "");

type TabId = "labs" | "therapy" | "referrals" | "medications" | "orders" | "diagnoses";

interface BaseRec { id: string; residentId: string; createdAt: string; driveLink?: string; notes?: string }
interface LabRec extends BaseRec { testName: string; dateCollected: string; status: string; resultValue?: string; unit?: string; refRange?: string; physician?: string }
interface TherapyRec extends BaseRec { sessionDate: string; type: string; therapist: string; goals?: string; response?: string; progress?: string }
interface ReferralRec extends BaseRec { referralDate: string; urgency: string; referringPhysician: string; specialist: string; reason: string; followUpDate?: string; outcome?: string }
interface MedRec extends BaseRec { date: string; changeType: string; medName: string; physician?: string; reason?: string }
interface OrderRec extends BaseRec { orderDate: string; status: string; physician: string; orderType: string; details: string }
interface DiagRec extends BaseRec { date: string; diagnosis: string; icdCode?: string; physician?: string }

interface Store { labs: LabRec[]; therapy: TherapyRec[]; referrals: ReferralRec[]; medications: MedRec[]; orders: OrderRec[]; diagnoses: DiagRec[] }
const EMPTY: Store = { labs: [], therapy: [], referrals: [], medications: [], orders: [], diagnoses: [] };

type ResOpt = { id: string; name: string; room: string };

const parseStore = (raw: string | null | undefined): Store => {
  if (!raw) return { ...EMPTY };
  try {
    const v = JSON.parse(raw) as Partial<Store>;
    return {
      labs: Array.isArray(v.labs) ? v.labs : [],
      therapy: Array.isArray(v.therapy) ? v.therapy : [],
      referrals: Array.isArray(v.referrals) ? v.referrals : [],
      medications: Array.isArray(v.medications) ? v.medications : [],
      orders: Array.isArray(v.orders) ? v.orders : [],
      diagnoses: Array.isArray(v.diagnoses) ? v.diagnoses : [],
    };
  } catch {
    return { ...EMPTY };
  }
};

const TABS: { id: TabId; label: string; icon: LucideIcon; addLabel: string }[] = [
  { id: "labs", label: "Lab Results", icon: TestTube, addLabel: "Add Lab Result" },
  { id: "therapy", label: "Therapy", icon: Activity, addLabel: "Log Therapy Session" },
  { id: "referrals", label: "Referrals", icon: Send, addLabel: "Add Referral" },
  { id: "medications", label: "Medications", icon: Pill, addLabel: "Log Medication Change" },
  { id: "orders", label: "Orders", icon: ClipboardList, addLabel: "Add Order" },
  { id: "diagnoses", label: "Diagnoses", icon: Stethoscope, addLabel: "Add Diagnosis" },
];

const pillTone = (status: string) => {
  const s = status.toLowerCase();
  if (["active", "completed", "resolved", "routine"].includes(s)) return "bg-green-100 text-green-700";
  if (["pending", "hold", "urgent"].includes(s)) return "bg-amber-100 text-amber-700";
  if (["discontinued", "emergency", "rejected"].includes(s)) return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-600";
};

export default function ClinicalRecordsBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  // clinicianRole is kept for parity with sibling clinical boards.
  useClinician(clinicianRole);
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const resQ = useLiveQuery<Record<string, unknown>>("residents", { tables: ["Resident"] });
  const residents = useMemo<ResOpt[]>(() => (resQ.data || []).map(adaptResident).map((r) => ({ id: String(r.id), name: String(r.name), room: String(r.room ?? "") })), [resQ.data]);
  const store = useMemo(() => parseStore(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);

  const [residentId, setResidentId] = useState("");
  const [tab, setTab] = useState<TabId>("labs");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BaseRec | null>(null);

  const saveStore = async (next: Store) => {
    await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) });
    await refetch();
  };

  const listFor = (t: TabId): BaseRec[] => (store[t] as BaseRec[]);
  const dateOf = (r: BaseRec): string => {
    const rec = r as unknown as Record<string, string>;
    return rec.dateCollected || rec.sessionDate || rec.referralDate || rec.date || rec.orderDate || "";
  };

  const records = useMemo(() => {
    if (!residentId) return [] as BaseRec[];
    return listFor(tab)
      .filter((r) => r.residentId === residentId)
      .slice()
      .sort((a, b) => (dateOf(b) || b.createdAt).localeCompare(dateOf(a) || a.createdAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, tab, residentId]);

  const upsert = async (rec: BaseRec) => {
    const list = listFor(tab).filter((x) => x.id !== rec.id);
    await saveStore({ ...store, [tab]: [rec, ...list] });
    setModalOpen(false);
    setEditing(null);
  };

  const remove = async (rec: BaseRec) => {
    const res = await Swal.fire({ title: "Delete this record?", text: "This cannot be undone.", icon: "warning", showCancelButton: true, confirmButtonText: "Delete", confirmButtonColor: "#dc2626" });
    if (!res.isConfirmed) return;
    await saveStore({ ...store, [tab]: listFor(tab).filter((x) => x.id !== rec.id) });
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Record deleted", showConfirmButton: false, timer: 1400 });
  };

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-2"><ClipboardList className="w-6 h-6 text-blue-500" /> Clinical Records</h1>
        <p className="text-sm text-slate-500 mt-1">Lab results, therapy, referrals, medication changes, physician orders &amp; diagnoses</p>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <label className="text-sm font-bold text-slate-700">Resident:</label>
        <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className="min-w-[240px] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40">
          <option value="">Select a resident…</option>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.room ? `Rm ${r.room} — ` : ""}{r.name}</option>)}
        </select>
      </div>

      {!residentId ? (
        <div className="flex flex-col items-center justify-center text-center py-24 text-slate-400">
          <ClipboardList className="w-12 h-12 mb-3" />
          <p className="text-slate-500 font-medium">Select a resident to view or add clinical records</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1 mb-5">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium ${tab === t.id ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
                  <Icon className="w-4 h-4" /> {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-slate-500">{records.length} {records.length === 1 ? "record" : "records"}</p>
            <button onClick={() => { setEditing(null); setModalOpen(true); }} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> {active.addLabel}</button>
          </div>

          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400">No {active.label.toLowerCase()} yet. Click <b>{active.addLabel}</b> to start.</div>
            ) : (
              records.map((r) => <RecordCard key={r.id} tab={tab} rec={r} onEdit={() => { setEditing(r); setModalOpen(true); }} onDelete={() => remove(r)} />)
            )}
          </div>
        </>
      )}

      {modalOpen && residentId && (
        <RecordModal tab={tab} residentId={residentId} editing={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={upsert} />
      )}
    </div>
  );
}

/* ---------- Record card ---------- */

function RecordCard({ tab, rec, onEdit, onDelete }: { tab: TabId; rec: BaseRec; onEdit: () => void; onDelete: () => void }) {
  const r = rec as unknown as Record<string, string | undefined>;
  let title = "";
  let pill: string | undefined;
  let icd: string | undefined;
  let date = "";
  let who = "";

  if (tab === "labs") { title = r.testName || ""; pill = r.status; date = r.dateCollected || ""; who = r.physician || ""; }
  else if (tab === "therapy") { title = `${r.type || ""} Session`.trim(); pill = r.type; date = r.sessionDate || ""; who = r.therapist || ""; }
  else if (tab === "referrals") { title = r.specialist || ""; pill = r.urgency; date = r.referralDate || ""; who = r.referringPhysician || ""; }
  else if (tab === "medications") { title = r.medName || ""; pill = r.changeType; date = r.date || ""; who = r.physician || ""; }
  else if (tab === "orders") { title = r.orderType || ""; pill = r.status; date = r.orderDate || ""; who = r.physician || ""; }
  else { title = r.diagnosis || ""; icd = r.icdCode; date = r.date || ""; who = r.physician || ""; }

  const meta = [fmtDate(date), who].filter(Boolean).join(" · ");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-slate-900">{title || "(untitled)"}</p>
          {icd && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{icd}</span>}
          {pill && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${pillTone(pill)}`}>{pill}</span>}
        </div>
        {meta && <p className="text-sm text-slate-500 mt-1">{meta}</p>}
        {rec.notes && <p className="text-sm text-slate-500 mt-1">{rec.notes}</p>}
        {rec.driveLink && (
          <a href={rec.driveLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline mt-2">
            <ExternalLink className="w-3.5 h-3.5" /> View Document
          </a>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onEdit} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><Pencil className="w-4 h-4" /></button>
        <button onClick={onDelete} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

/* ---------- Shared form primitives ---------- */

const inp = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
const lbl = "block text-sm font-bold text-slate-700 mb-1.5";
const optLbl = "block text-sm font-semibold text-slate-500 mb-1.5";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div><label className={lbl}>{label}{required && <span className="text-red-500"> *</span>}</label>{children}</div>;
}
function DriveField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div><label className={optLbl}>Google Drive Link (optional)</label><input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://drive.google.com/..." className={inp} /></div>;
}

const LAB_STATUS = ["Pending", "Completed", "Reviewed", "Abnormal"];
const THERAPY_TYPES = ["PT", "OT", "ST", "RT", "Other"];
const URGENCIES = ["Routine", "Urgent", "Emergency"];
const CHANGE_TYPES = ["New Medication", "Discontinued", "Dose Change", "Hold", "Resume"];
const ORDER_STATUS = ["Active", "Completed", "Discontinued"];

/* ---------- The one modal (branches per tab) ---------- */

function RecordModal({ tab, residentId, editing, onClose, onSave }: { tab: TabId; residentId: string; editing: BaseRec | null; onClose: () => void; onSave: (rec: BaseRec) => Promise<void> }) {
  const e = (editing || {}) as Record<string, string | undefined>;
  const title = TABS.find((t) => t.id === tab)!.addLabel.replace(/^Add /, editing ? "Edit " : "Add ").replace(/^Log /, editing ? "Edit " : "Log ");

  // Common
  const [driveLink, setDriveLink] = useState(e.driveLink || "");
  const [notes, setNotes] = useState(e.notes || "");
  const [saving, setSaving] = useState(false);

  // Lab
  const [testName, setTestName] = useState(e.testName || "");
  const [dateCollected, setDateCollected] = useState(e.dateCollected || "");
  const [labStatus, setLabStatus] = useState(e.status || "Pending");
  const [resultValue, setResultValue] = useState(e.resultValue || "");
  const [unit, setUnit] = useState(e.unit || "");
  const [refRange, setRefRange] = useState(e.refRange || "");
  const [labPhysician, setLabPhysician] = useState(e.physician || "");

  // Therapy
  const [sessionDate, setSessionDate] = useState(e.sessionDate || "");
  const [therapyType, setTherapyType] = useState(e.type || "PT");
  const [therapist, setTherapist] = useState(e.therapist || "");
  const [goals, setGoals] = useState(e.goals || "");
  const [response, setResponse] = useState(e.response || "");
  const [progress, setProgress] = useState(e.progress || "");

  // Referral
  const [referralDate, setReferralDate] = useState(e.referralDate || "");
  const [urgency, setUrgency] = useState(e.urgency || "Routine");
  const [referringPhysician, setReferringPhysician] = useState(e.referringPhysician || "");
  const [specialist, setSpecialist] = useState(e.specialist || "");
  const [reason, setReason] = useState(e.reason || "");
  const [followUpDate, setFollowUpDate] = useState(e.followUpDate || "");
  const [outcome, setOutcome] = useState(e.outcome || "");

  // Medication change
  const [medDate, setMedDate] = useState(e.date || "");
  const [changeType, setChangeType] = useState(e.changeType || "New Medication");
  const [medName, setMedName] = useState(e.medName || "");
  const [medPhysician, setMedPhysician] = useState(e.physician || "");
  const [medReason, setMedReason] = useState(e.reason || "");

  // Order
  const [orderDate, setOrderDate] = useState(e.orderDate || "");
  const [orderStatus, setOrderStatus] = useState(e.status || "Active");
  const [orderPhysician, setOrderPhysician] = useState(e.physician || "");
  const [orderType, setOrderType] = useState(e.orderType || "");
  const [orderDetails, setOrderDetails] = useState(e.details || "");

  // Diagnosis
  const [diagDate, setDiagDate] = useState(e.date || "");
  const [icdCode, setIcdCode] = useState(e.icdCode || "");
  const [diagnosis, setDiagnosis] = useState(e.diagnosis || "");
  const [diagPhysician, setDiagPhysician] = useState(e.physician || "");

  const submit = async () => {
    const id = editing?.id || newId("clr");
    const createdAt = editing?.createdAt || new Date().toISOString();
    const base = { id, residentId, createdAt, driveLink: driveLink.trim() || undefined, notes: notes.trim() || undefined };
    let rec: BaseRec;

    if (tab === "labs") {
      if (!testName.trim()) { warn("Test Name is required"); return; }
      rec = { ...base, testName: testName.trim(), dateCollected, status: labStatus, resultValue: resultValue.trim() || undefined, unit: unit.trim() || undefined, refRange: refRange.trim() || undefined, physician: labPhysician.trim() || undefined } as LabRec;
    } else if (tab === "therapy") {
      if (!therapist.trim()) { warn("Therapist Name is required"); return; }
      rec = { ...base, sessionDate, type: therapyType, therapist: therapist.trim(), goals: goals.trim() || undefined, response: response.trim() || undefined, progress: progress.trim() || undefined } as TherapyRec;
    } else if (tab === "referrals") {
      if (!referringPhysician.trim()) { warn("Referring Physician is required"); return; }
      if (!specialist.trim()) { warn("Specialist / Facility is required"); return; }
      if (!reason.trim()) { warn("Reason for Referral is required"); return; }
      rec = { ...base, referralDate, urgency, referringPhysician: referringPhysician.trim(), specialist: specialist.trim(), reason: reason.trim(), followUpDate: followUpDate || undefined, outcome: outcome.trim() || undefined } as ReferralRec;
    } else if (tab === "medications") {
      if (!medName.trim()) { warn("Medication Name is required"); return; }
      rec = { ...base, date: medDate, changeType, medName: medName.trim(), physician: medPhysician.trim() || undefined, reason: medReason.trim() || undefined } as MedRec;
    } else if (tab === "orders") {
      if (!orderPhysician.trim()) { warn("Ordering Physician is required"); return; }
      if (!orderType.trim()) { warn("Order Type is required"); return; }
      if (!orderDetails.trim()) { warn("Order Details is required"); return; }
      rec = { ...base, orderDate, status: orderStatus, physician: orderPhysician.trim(), orderType: orderType.trim(), details: orderDetails.trim() } as OrderRec;
    } else {
      if (!diagnosis.trim()) { warn("Diagnosis Name is required"); return; }
      rec = { ...base, date: diagDate, diagnosis: diagnosis.trim(), icdCode: icdCode.trim() || undefined, physician: diagPhysician.trim() || undefined } as DiagRec;
    }

    setSaving(true);
    try { await onSave(rec); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">{title}</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">

          {tab === "labs" && (<>
            <Field label="Test Name" required><input value={testName} onChange={(ev) => setTestName(ev.target.value)} placeholder="e.g. Complete Blood Count" className={inp} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date Collected"><input type="date" value={dateCollected} onChange={(ev) => setDateCollected(ev.target.value)} className={inp} /></Field>
              <Field label="Status"><select value={labStatus} onChange={(ev) => setLabStatus(ev.target.value)} className={inp}>{LAB_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Result Value"><input value={resultValue} onChange={(ev) => setResultValue(ev.target.value)} placeholder="e.g. 12.5" className={inp} /></Field>
              <Field label="Unit"><input value={unit} onChange={(ev) => setUnit(ev.target.value)} placeholder="g/dL" className={inp} /></Field>
            </div>
            <Field label="Reference Range"><input value={refRange} onChange={(ev) => setRefRange(ev.target.value)} placeholder="e.g. 12.0–16.0 g/dL" className={inp} /></Field>
            <Field label="Ordering Physician"><input value={labPhysician} onChange={(ev) => setLabPhysician(ev.target.value)} placeholder="Dr. Santos" className={inp} /></Field>
            <Field label="Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={inp} /></Field>
          </>)}

          {tab === "therapy" && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Session Date"><input type="date" value={sessionDate} onChange={(ev) => setSessionDate(ev.target.value)} className={inp} /></Field>
              <Field label="Type"><select value={therapyType} onChange={(ev) => setTherapyType(ev.target.value)} className={inp}>{THERAPY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Therapist Name" required><input value={therapist} onChange={(ev) => setTherapist(ev.target.value)} placeholder="e.g. Maria Cruz, RPT" className={inp} /></Field>
            <Field label="Goals Addressed"><textarea rows={2} value={goals} onChange={(ev) => setGoals(ev.target.value)} placeholder="e.g. Improve gait stability, increase ROM" className={inp} /></Field>
            <Field label="Resident Response"><textarea rows={2} value={response} onChange={(ev) => setResponse(ev.target.value)} placeholder="e.g. Cooperative, tolerated well" className={inp} /></Field>
            <Field label="Progress Notes"><textarea rows={2} value={progress} onChange={(ev) => setProgress(ev.target.value)} className={inp} /></Field>
          </>)}

          {tab === "referrals" && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Referral Date"><input type="date" value={referralDate} onChange={(ev) => setReferralDate(ev.target.value)} className={inp} /></Field>
              <Field label="Urgency"><select value={urgency} onChange={(ev) => setUrgency(ev.target.value)} className={inp}>{URGENCIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Referring Physician" required><input value={referringPhysician} onChange={(ev) => setReferringPhysician(ev.target.value)} placeholder="Dr. Santos" className={inp} /></Field>
            <Field label="Specialist / Facility" required><input value={specialist} onChange={(ev) => setSpecialist(ev.target.value)} placeholder="e.g. St. Luke's Cardiology" className={inp} /></Field>
            <Field label="Reason for Referral" required><textarea rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} className={inp} /></Field>
            <Field label="Follow-up Date"><input type="date" value={followUpDate} onChange={(ev) => setFollowUpDate(ev.target.value)} className={inp} /></Field>
            <Field label="Outcome"><textarea rows={2} value={outcome} onChange={(ev) => setOutcome(ev.target.value)} placeholder="e.g. Specialist confirmed diagnosis, scheduled for procedure" className={inp} /></Field>
            <Field label="Additional Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={inp} /></Field>
          </>)}

          {tab === "medications" && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" value={medDate} onChange={(ev) => setMedDate(ev.target.value)} className={inp} /></Field>
              <Field label="Change Type"><select value={changeType} onChange={(ev) => setChangeType(ev.target.value)} className={inp}>{CHANGE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Medication Name" required><input value={medName} onChange={(ev) => setMedName(ev.target.value)} placeholder="e.g. Amlodipine 5mg" className={inp} /></Field>
            <Field label="Prescribing Physician"><input value={medPhysician} onChange={(ev) => setMedPhysician(ev.target.value)} placeholder="Dr. Reyes" className={inp} /></Field>
            <Field label="Reason"><textarea rows={2} value={medReason} onChange={(ev) => setMedReason(ev.target.value)} placeholder="e.g. Uncontrolled hypertension" className={inp} /></Field>
            <Field label="Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={inp} /></Field>
          </>)}

          {tab === "orders" && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Order Date"><input type="date" value={orderDate} onChange={(ev) => setOrderDate(ev.target.value)} className={inp} /></Field>
              <Field label="Status"><select value={orderStatus} onChange={(ev) => setOrderStatus(ev.target.value)} className={inp}>{ORDER_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="Ordering Physician" required><input value={orderPhysician} onChange={(ev) => setOrderPhysician(ev.target.value)} placeholder="Dr. Dela Cruz" className={inp} /></Field>
            <Field label="Order Type" required><input value={orderType} onChange={(ev) => setOrderType(ev.target.value)} placeholder="e.g. Diet Change, Wound Care, Activity Restriction" className={inp} /></Field>
            <Field label="Order Details" required><textarea rows={2} value={orderDetails} onChange={(ev) => setOrderDetails(ev.target.value)} placeholder="Full order instructions…" className={inp} /></Field>
            <Field label="Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={inp} /></Field>
          </>)}

          {tab === "diagnoses" && (<>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date"><input type="date" value={diagDate} onChange={(ev) => setDiagDate(ev.target.value)} className={inp} /></Field>
              <Field label="ICD Code"><input value={icdCode} onChange={(ev) => setIcdCode(ev.target.value)} placeholder="e.g. I10" className={inp} /></Field>
            </div>
            <Field label="Diagnosis Name" required><input value={diagnosis} onChange={(ev) => setDiagnosis(ev.target.value)} placeholder="e.g. Essential Hypertension" className={inp} /></Field>
            <Field label="Diagnosing Physician"><input value={diagPhysician} onChange={(ev) => setDiagPhysician(ev.target.value)} placeholder="Dr. Reyes" className={inp} /></Field>
            <Field label="Notes"><textarea rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={inp} /></Field>
          </>)}

          <DriveField value={driveLink} onChange={setDriveLink} />
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function warn(title: string) {
  Swal.fire({ title, icon: "warning" });
}
