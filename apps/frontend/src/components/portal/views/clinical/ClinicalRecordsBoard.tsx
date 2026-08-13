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
import { TestTube, Activity, Send, Pill, ClipboardList, Stethoscope, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, FieldLabel, controlClass } from "./clinical-ui";

const KEY = "clinical_records";
const newId = (p: string) => globalThis.crypto?.randomUUID?.() ?? `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtDate = (v: string) => (v ? new Date(v + (v.length <= 10 ? "T00:00:00" : "")).toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-").replace(/(\d{2})-(\d{2})-(\d{4})/, "$3-$1-$2") : "");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

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

// Status → the clinical-editorial accent, keyed by the PDF's colour language.
const ACCENT_VAR = { coral: "var(--clinical-coral)", amber: "var(--clinical-amber)", green: "var(--clinical-green)", teal: "var(--clinical-panel)" } as const;
type Accent = keyof typeof ACCENT_VAR;
const pillAccent = (status: string): Accent => {
  const s = status.toLowerCase();
  if (["active", "completed", "resolved", "routine"].includes(s)) return "green";
  if (["pending", "hold", "urgent"].includes(s)) return "amber";
  if (["discontinued", "emergency", "rejected"].includes(s)) return "coral";
  return "teal";
};

// Theme-safe status chip: ink label + a coloured dot (no per-theme contrast traps).
function StatusChip({ label, accent }: { label: string; accent: Accent }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[accent] }} />{label}
    </span>
  );
}

export default function ClinicalRecordsBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  // clinicianRole is kept for parity with sibling clinical boards.
  useClinician(clinicianRole);
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
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
    <ClinicalPage>
      <ClinicalHeader
        title="Clinical Records"
        subtitle="Lab results, therapy, referrals, medication changes, physician orders & diagnoses"
        right={
          <ClinicalButton variant="accent" onClick={() => { setEditing(null); setModalOpen(true); }} disabled={!residentId}>
            <Plus className="h-4 w-4" /> {active.addLabel}
          </ClinicalButton>
        }
      />

      <div className="mt-5 mb-5 flex items-center gap-3">
        <FieldLabel htmlFor="clr-resident">Resident</FieldLabel>
        <select id="clr-resident" value={residentId} onChange={(e) => setResidentId(e.target.value)} className={`${controlClass} w-full sm:w-72 -mt-1.5`}>
          <option value="">Select a resident…</option>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.room ? `Rm ${r.room} — ` : ""}{r.name}</option>)}
        </select>
      </div>

      {!residentId ? (
        <div className="@container">
          <div className="mb-4">
            <p className="font-semibold text-[var(--clinical-ink)]">Select a resident to view or add clinical records</p>
            <p className="text-sm text-[var(--clinical-muted)]">Tap a resident to open their clinical records</p>
          </div>
          {residents.length === 0 ? (
            <p className="text-sm text-[var(--clinical-muted)]">No residents found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
              {residents.map((r, i) => (
                <button key={r.id} onClick={() => setResidentId(r.id)}
                  className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(r.name)}</span>
                  <span className="block w-full min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{r.name}</span>
                    <span className="block text-xs text-[var(--clinical-muted)]">Room {r.room}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
            {TABS.map((t) => {
              const Icon = t.icon;
              const activeTab = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-pressed={activeTab}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${activeTab ? "shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}
                  style={activeTab ? { backgroundColor: "var(--clinical-surface)" } : undefined}
                >
                  <Icon className="h-4 w-4" /> {t.label}
                </button>
              );
            })}
          </div>

          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-[var(--clinical-muted)]">{records.length} {records.length === 1 ? "record" : "records"}</p>
          </div>

          <DataState
            loading={loading && records.length === 0}
            error={error}
            empty={records.length === 0}
            emptyTitle={`No ${active.label.toLowerCase()} yet`}
            emptyHint={`Click ${active.addLabel} to start.`}
            emptyAction={<ClinicalButton variant="accent" onClick={() => { setEditing(null); setModalOpen(true); }}><Plus className="h-4 w-4" /> {active.addLabel}</ClinicalButton>}
            onRetry={() => void refetch()}
            skeletonRows={3}
          >
            <div className="space-y-3">
              {records.map((r) => <RecordCard key={r.id} tab={tab} rec={r} onEdit={() => { setEditing(r); setModalOpen(true); }} onDelete={() => remove(r)} />)}
            </div>
          </DataState>
        </>
      )}

      {residentId && (
        <RecordModal open={modalOpen} tab={tab} residentId={residentId} editing={editing} onClose={() => { setModalOpen(false); setEditing(null); }} onSave={upsert} />
      )}
    </ClinicalPage>
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
    <div className="flex items-start justify-between gap-3 rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-bold text-[var(--clinical-ink)]">{title || "(untitled)"}</p>
          {icd && <span className="rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)" }}>{icd}</span>}
          {pill && <StatusChip label={pill} accent={pillAccent(pill)} />}
        </div>
        {meta && <p className="mt-1 text-sm text-[var(--clinical-muted)]">{meta}</p>}
        {rec.notes && <p className="mt-1 text-sm text-[var(--clinical-muted)]">{rec.notes}</p>}
        {rec.driveLink && (
          <a href={rec.driveLink} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[var(--clinical-panel)] hover:underline">
            <ExternalLink className="h-3.5 w-3.5" /> View Document
          </a>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={onEdit} aria-label="Edit record" className="rounded-lg p-2 text-[var(--clinical-muted)] transition hover:bg-[var(--clinical-surface-2)] hover:text-[var(--clinical-ink)]"><Pencil className="h-4 w-4" /></button>
        <button onClick={onDelete} aria-label="Delete record" className="rounded-lg p-2 text-[var(--clinical-coral)] transition hover:bg-[var(--clinical-surface-2)]"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

/* ---------- Shared form primitives ---------- */

function DriveField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <div><FieldLabel htmlFor="clr-drive">Google Drive Link (optional)</FieldLabel><input id="clr-drive" value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://drive.google.com/..." className={controlClass} /></div>;
}

const LAB_STATUS = ["Pending", "Completed", "Reviewed", "Abnormal"];
const THERAPY_TYPES = ["PT", "OT", "ST", "RT", "Other"];
const URGENCIES = ["Routine", "Urgent", "Emergency"];
const CHANGE_TYPES = ["New Medication", "Discontinued", "Dose Change", "Hold", "Resume"];
const ORDER_STATUS = ["Active", "Completed", "Discontinued"];

/* ---------- The one modal (branches per tab) ---------- */

function RecordModal({ open, tab, residentId, editing, onClose, onSave }: { open: boolean; tab: TabId; residentId: string; editing: BaseRec | null; onClose: () => void; onSave: (rec: BaseRec) => Promise<void> }) {
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
    <ClinicalModal
      open={open}
      onClose={onClose}
      title={title}
      footer={<>
        <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">

        {tab === "labs" && (<>
          <div><FieldLabel required htmlFor="clr-testName">Test Name</FieldLabel><input id="clr-testName" value={testName} onChange={(ev) => setTestName(ev.target.value)} placeholder="e.g. Complete Blood Count" className={controlClass} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-dateCollected">Date Collected</FieldLabel><input id="clr-dateCollected" type="date" value={dateCollected} onChange={(ev) => setDateCollected(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-labStatus">Status</FieldLabel><select id="clr-labStatus" value={labStatus} onChange={(ev) => setLabStatus(ev.target.value)} className={controlClass}>{LAB_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-resultValue">Result Value</FieldLabel><input id="clr-resultValue" value={resultValue} onChange={(ev) => setResultValue(ev.target.value)} placeholder="e.g. 12.5" className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-unit">Unit</FieldLabel><input id="clr-unit" value={unit} onChange={(ev) => setUnit(ev.target.value)} placeholder="g/dL" className={controlClass} /></div>
          </div>
          <div><FieldLabel htmlFor="clr-refRange">Reference Range</FieldLabel><input id="clr-refRange" value={refRange} onChange={(ev) => setRefRange(ev.target.value)} placeholder="e.g. 12.0–16.0 g/dL" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-labPhysician">Ordering Physician</FieldLabel><input id="clr-labPhysician" value={labPhysician} onChange={(ev) => setLabPhysician(ev.target.value)} placeholder="Dr. Santos" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-labNotes">Notes</FieldLabel><textarea id="clr-labNotes" rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={controlClass} /></div>
        </>)}

        {tab === "therapy" && (<>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-sessionDate">Session Date</FieldLabel><input id="clr-sessionDate" type="date" value={sessionDate} onChange={(ev) => setSessionDate(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-therapyType">Type</FieldLabel><select id="clr-therapyType" value={therapyType} onChange={(ev) => setTherapyType(ev.target.value)} className={controlClass}>{THERAPY_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div><FieldLabel required htmlFor="clr-therapist">Therapist Name</FieldLabel><input id="clr-therapist" value={therapist} onChange={(ev) => setTherapist(ev.target.value)} placeholder="e.g. Maria Cruz, RPT" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-goals">Goals Addressed</FieldLabel><textarea id="clr-goals" rows={2} value={goals} onChange={(ev) => setGoals(ev.target.value)} placeholder="e.g. Improve gait stability, increase ROM" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-response">Resident Response</FieldLabel><textarea id="clr-response" rows={2} value={response} onChange={(ev) => setResponse(ev.target.value)} placeholder="e.g. Cooperative, tolerated well" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-progress">Progress Notes</FieldLabel><textarea id="clr-progress" rows={2} value={progress} onChange={(ev) => setProgress(ev.target.value)} className={controlClass} /></div>
        </>)}

        {tab === "referrals" && (<>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-referralDate">Referral Date</FieldLabel><input id="clr-referralDate" type="date" value={referralDate} onChange={(ev) => setReferralDate(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-urgency">Urgency</FieldLabel><select id="clr-urgency" value={urgency} onChange={(ev) => setUrgency(ev.target.value)} className={controlClass}>{URGENCIES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div><FieldLabel required htmlFor="clr-referringPhysician">Referring Physician</FieldLabel><input id="clr-referringPhysician" value={referringPhysician} onChange={(ev) => setReferringPhysician(ev.target.value)} placeholder="Dr. Santos" className={controlClass} /></div>
          <div><FieldLabel required htmlFor="clr-specialist">Specialist / Facility</FieldLabel><input id="clr-specialist" value={specialist} onChange={(ev) => setSpecialist(ev.target.value)} placeholder="e.g. St. Luke's Cardiology" className={controlClass} /></div>
          <div><FieldLabel required htmlFor="clr-reason">Reason for Referral</FieldLabel><textarea id="clr-reason" rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-followUpDate">Follow-up Date</FieldLabel><input id="clr-followUpDate" type="date" value={followUpDate} onChange={(ev) => setFollowUpDate(ev.target.value)} className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-outcome">Outcome</FieldLabel><textarea id="clr-outcome" rows={2} value={outcome} onChange={(ev) => setOutcome(ev.target.value)} placeholder="e.g. Specialist confirmed diagnosis, scheduled for procedure" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-refNotes">Additional Notes</FieldLabel><textarea id="clr-refNotes" rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={controlClass} /></div>
        </>)}

        {tab === "medications" && (<>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-medDate">Date</FieldLabel><input id="clr-medDate" type="date" value={medDate} onChange={(ev) => setMedDate(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-changeType">Change Type</FieldLabel><select id="clr-changeType" value={changeType} onChange={(ev) => setChangeType(ev.target.value)} className={controlClass}>{CHANGE_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div><FieldLabel required htmlFor="clr-medName">Medication Name</FieldLabel><input id="clr-medName" value={medName} onChange={(ev) => setMedName(ev.target.value)} placeholder="e.g. Amlodipine 5mg" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-medPhysician">Prescribing Physician</FieldLabel><input id="clr-medPhysician" value={medPhysician} onChange={(ev) => setMedPhysician(ev.target.value)} placeholder="Dr. Reyes" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-medReason">Reason</FieldLabel><textarea id="clr-medReason" rows={2} value={medReason} onChange={(ev) => setMedReason(ev.target.value)} placeholder="e.g. Uncontrolled hypertension" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-medNotes">Notes</FieldLabel><textarea id="clr-medNotes" rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={controlClass} /></div>
        </>)}

        {tab === "orders" && (<>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-orderDate">Order Date</FieldLabel><input id="clr-orderDate" type="date" value={orderDate} onChange={(ev) => setOrderDate(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-orderStatus">Status</FieldLabel><select id="clr-orderStatus" value={orderStatus} onChange={(ev) => setOrderStatus(ev.target.value)} className={controlClass}>{ORDER_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div><FieldLabel required htmlFor="clr-orderPhysician">Ordering Physician</FieldLabel><input id="clr-orderPhysician" value={orderPhysician} onChange={(ev) => setOrderPhysician(ev.target.value)} placeholder="Dr. Dela Cruz" className={controlClass} /></div>
          <div><FieldLabel required htmlFor="clr-orderType">Order Type</FieldLabel><input id="clr-orderType" value={orderType} onChange={(ev) => setOrderType(ev.target.value)} placeholder="e.g. Diet Change, Wound Care, Activity Restriction" className={controlClass} /></div>
          <div><FieldLabel required htmlFor="clr-orderDetails">Order Details</FieldLabel><textarea id="clr-orderDetails" rows={2} value={orderDetails} onChange={(ev) => setOrderDetails(ev.target.value)} placeholder="Full order instructions…" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-orderNotes">Notes</FieldLabel><textarea id="clr-orderNotes" rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={controlClass} /></div>
        </>)}

        {tab === "diagnoses" && (<>
          <div className="grid grid-cols-2 gap-3">
            <div><FieldLabel htmlFor="clr-diagDate">Date</FieldLabel><input id="clr-diagDate" type="date" value={diagDate} onChange={(ev) => setDiagDate(ev.target.value)} className={controlClass} /></div>
            <div><FieldLabel htmlFor="clr-icdCode">ICD Code</FieldLabel><input id="clr-icdCode" value={icdCode} onChange={(ev) => setIcdCode(ev.target.value)} placeholder="e.g. I10" className={controlClass} /></div>
          </div>
          <div><FieldLabel required htmlFor="clr-diagnosis">Diagnosis Name</FieldLabel><input id="clr-diagnosis" value={diagnosis} onChange={(ev) => setDiagnosis(ev.target.value)} placeholder="e.g. Essential Hypertension" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-diagPhysician">Diagnosing Physician</FieldLabel><input id="clr-diagPhysician" value={diagPhysician} onChange={(ev) => setDiagPhysician(ev.target.value)} placeholder="Dr. Reyes" className={controlClass} /></div>
          <div><FieldLabel htmlFor="clr-diagNotes">Notes</FieldLabel><textarea id="clr-diagNotes" rows={2} value={notes} onChange={(ev) => setNotes(ev.target.value)} className={controlClass} /></div>
        </>)}

        <DriveField value={driveLink} onChange={setDriveLink} />
      </div>
    </ClinicalModal>
  );
}

function warn(title: string) {
  Swal.fire({ title, icon: "warning" });
}
