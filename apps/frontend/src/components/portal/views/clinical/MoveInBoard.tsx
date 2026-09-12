"use client";

/**
 * Move-in — the resident's move-in paperwork in one place, for Admin, Nurses and
 * the Resident Coordinator. Per admitted resident:
 *   • Move-in Documents — upload the filled-out paper forms (Move-In Checklist,
 *     Assistive Devices, Personal Belongings, Clothing) as files or Drive links
 *   • Medical Records — Appendix IV medical history + uploaded medical documents
 *   • Physical Exam — on-admission body check
 *   • Emergency & Family — one or more contacts (the first is the profile's primary)
 * Reuses the same panels the Resident Card uses. Only ADMITTED / ONBOARDED
 * residents are listed (a Resident row exists only after admission; discharged /
 * deceased are excluded).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Package, HeartPulse, Users, Stethoscope, Plus, X } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, updateRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { HEALTH_ASSESSMENT_KEY, parseHealthStore, healthFor, type HealthAssessmentStore, type HealthAssessment } from "@/lib/healthAssessment";
import { RESIDENT_CONTACTS_KEY, parseResidentContacts, contactsFor, cleanContacts, newContact, type ResidentContactStore } from "@/lib/residentContacts";
import DocumentSection from "./DocumentSection";
import HealthAssessmentForm from "./HealthAssessmentForm";
import PhysicalExamForm from "./PhysicalExamForm";
import { ClinicalCard, DataState, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

type TabKey = "belongings" | "medical" | "physicalexam" | "emergency";
const TABS: { key: TabKey; label: string; icon: typeof Package }[] = [
  { key: "belongings", label: "Move-in Documents", icon: Package },
  { key: "medical", label: "Medical Records", icon: HeartPulse },
  { key: "physicalexam", label: "Physical Exam", icon: Stethoscope },
  { key: "emergency", label: "Emergency & Family", icon: Users },
];

// Standard move-in paperwork — printed, filled out on paper, then uploaded here.
const BELONGINGS_DOCS = [
  "Move-In Checklist",
  "Assistive Devices Inventory",
  "Personal Belongings Inventory",
  "Clothing Inventory",
];

const MEDICAL_DOCS = [
  "Personal Health Assessment & Disclosure (Appendix IV)",
  "Physician's Order",
  "Laboratory Results",
  "Medical Certificate",
  "Discharge Summary",
  "Prescription",
];

export default function MoveInBoard({ canEdit = true }: { canEdit?: boolean }) {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, refetch: refetchSettings } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  // Admitted / onboarded only — a Resident row means they've been admitted;
  // exclude discharged/deceased so the coordinator sees current residents.
  const residents = useMemo(
    () => (resQ.data || []).map(adaptResident).filter((r) => r.status === "ACTIVE" || r.status === "ON_LEAVE"),
    [resQ.data],
  );
  const [resId, setResId] = useState("");
  const resident = residents.find((r: Row) => s(r.id) === resId);
  const raw = useMemo(() => (resQ.data || []).find((r) => s(r.id) === resId) || null, [resQ.data, resId]);
  const healthStore = useMemo(() => parseHealthStore(settingRows.find((r) => (r.key || r.id) === HEALTH_ASSESSMENT_KEY)?.value), [settingRows]);
  const contactStore = useMemo(() => parseResidentContacts(settingRows.find((r) => (r.key || r.id) === RESIDENT_CONTACTS_KEY)?.value), [settingRows]);

  return (
    <div className="space-y-4">
      <ClinicalCard className="p-4 sm:p-5">
        <label htmlFor="mi-res" className="mb-1.5 block text-sm font-semibold text-[var(--clinical-ink)]">Select Resident</label>
        <select id="mi-res" value={resId} onChange={(e) => setResId(e.target.value)} className={`${controlClass} max-w-md`}>
          <option value="">Choose a resident…</option>
          {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}
        </select>
        <p className="mt-2 text-[11px] text-[var(--clinical-muted)]">Move-in paperwork for admitted residents. Print a form, fill it out, then upload the scan or attach a link under Move-in Documents.</p>
      </ClinicalCard>

      <DataState loading={resQ.loading} error={resQ.error ? String(resQ.error) : undefined} empty={!resQ.loading && residents.length === 0} emptyTitle="No admitted residents">
        {!resId || !raw ? (
          <p className="px-1 text-sm text-[var(--clinical-muted)]">Choose a resident to view their move-in forms.</p>
        ) : (
          // Keyed by resId so per-resident form state re-initialises on switch
          // (no reset effects needed).
          <MoveInDetail
            key={resId}
            residentId={resId}
            name={s(resident?.name)}
            room={s(resident?.room)}
            raw={raw}
            healthStore={healthStore}
            contactStore={contactStore}
            canEdit={canEdit}
            onSettingsSaved={refetchSettings}
            onResidentSaved={() => resQ.refetch?.()}
          />
        )}
      </DataState>
    </div>
  );
}

function MoveInDetail({ residentId, name, room, raw, healthStore, contactStore, canEdit, onSettingsSaved, onResidentSaved }: {
  residentId: string; name: string; room: string; raw: Row;
  healthStore: HealthAssessmentStore; contactStore: ResidentContactStore; canEdit: boolean;
  onSettingsSaved: () => void | Promise<void>; onResidentSaved: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("belongings");

  const healthProfile = useMemo(() => healthFor(healthStore, residentId), [healthStore, residentId]);
  const saveHealth = async (next: HealthAssessment) => {
    const nextStore = { ...healthStore, [residentId]: { ...next, updatedAt: new Date().toISOString() } };
    await upsertRecord("app-settings", HEALTH_ASSESSMENT_KEY, { key: HEALTH_ASSESSMENT_KEY, value: JSON.stringify(nextStore) });
    await onSettingsSaved();
  };

  // Documents for this resident (scoped by documentType in DocumentSection).
  const docsUrl = `/api/db/resident-documents?f_residentId=${encodeURIComponent(residentId)}&take=500`;
  const [docs, setDocs] = useState<Row[]>([]);
  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch(docsUrl, { credentials: "same-origin", cache: "no-store" });
      const j = await r.json();
      setDocs(Array.isArray(j?.data) ? j.data : []);
    } catch { setDocs([]); }
  }, [docsUrl]);
  useEffect(() => {
    let cancelled = false;
    fetch(docsUrl, { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setDocs(Array.isArray(j?.data) ? j.data : []); })
      .catch(() => { if (!cancelled) setDocs([]); });
    return () => { cancelled = true; };
  }, [docsUrl]);

  // Emergency / family contacts — the list lives in the `resident_contacts`
  // app-setting; the first one mirrors onto the resident's profile columns
  // (key remount reinitialises on resident switch).
  const [contacts, setContacts] = useState(() => contactsFor(contactStore, residentId, s(raw.emergencyContact), s(raw.emergencyContactPhone)));
  const [savingEc, setSavingEc] = useState(false);
  const patchContact = (id: string, patch: Partial<{ name: string; phone: string; relationship: string }>) =>
    setContacts((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const saveEmergency = async () => {
    setSavingEc(true);
    try {
      const clean = cleanContacts(contacts);
      await upsertRecord("app-settings", RESIDENT_CONTACTS_KEY, { key: RESIDENT_CONTACTS_KEY, value: JSON.stringify({ ...contactStore, [residentId]: clean }) });
      const primary = clean[0];
      await updateRecord("residents", residentId, { emergencyContact: primary?.name || "", emergencyContactPhone: primary?.phone || "" });
      await onSettingsSaved();   // refetches app-settings
      await onResidentSaved();
    } finally { setSavingEc(false); }
  };

  return (
    <>
      <div className="flex flex-wrap gap-1 rounded-xl border p-1" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === key ? "bg-[var(--clinical-panel)] text-white" : "text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"}`}>
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "belongings" && (
        <ClinicalCard className="p-4 sm:p-5">
          <DocumentSection residentId={residentId} documentType="BELONGINGS" label="Move-in documents" canEdit={canEdit} docs={docs} onChanged={loadDocs} uploadedByName="Move-in" presetTitles={BELONGINGS_DOCS} />
        </ClinicalCard>
      )}
      {tab === "medical" && (
        <>
          <HealthAssessmentForm profile={healthProfile} canEdit={canEdit} residentName={name} defaultPhysician={s(raw.primaryPhysician)} defaultAllergies={s(raw.allergies)} onSave={saveHealth} />
          <ClinicalCard className="p-4 sm:p-5">
            <DocumentSection residentId={residentId} documentType="MEDICAL_HISTORY" label="Medical records" canEdit={canEdit} docs={docs} onChanged={loadDocs} uploadedByName="Move-in" presetTitles={MEDICAL_DOCS} />
          </ClinicalCard>
        </>
      )}
      {tab === "physicalexam" && (
        <PhysicalExamForm residentId={residentId} residentName={name} room={room} canEdit={canEdit} />
      )}
      {tab === "emergency" && (
        <ClinicalCard className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2"><Users className="h-4 w-4 text-[var(--clinical-panel)]" /><h2 className="text-sm font-bold text-[var(--clinical-ink)]">Emergency &amp; Family Contacts</h2></div>
            {canEdit && (
              <button type="button" onClick={() => setContacts((list) => [...list, newContact()])}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]" style={{ borderColor: "var(--clinical-line)" }}>
                <Plus className="h-3.5 w-3.5" /> Add contact
              </button>
            )}
          </div>
          <div className="space-y-3">
            {contacts.map((c, i) => (
              <div key={c.id} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">{i === 0 ? "Primary contact" : `Contact ${i + 1}`}</span>
                  <input value={c.name} onChange={(e) => patchContact(c.id, { name: e.target.value })} disabled={!canEdit} placeholder="Contact name" className={controlClass} /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Relationship</span>
                  <input value={c.relationship || ""} onChange={(e) => patchContact(c.id, { relationship: e.target.value })} disabled={!canEdit} placeholder="e.g. Daughter" className={controlClass} /></label>
                <label className="block"><span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Phone</span>
                  <input value={c.phone} onChange={(e) => patchContact(c.id, { phone: e.target.value })} disabled={!canEdit} placeholder="Phone number" className={controlClass} /></label>
                {canEdit && contacts.length > 1 && (
                  <button type="button" onClick={() => setContacts((list) => list.filter((x) => x.id !== c.id))} aria-label={`Remove contact ${i + 1}`}
                    className="self-end rounded-lg border px-2 py-2 text-[var(--clinical-muted)] hover:text-red-600" style={{ borderColor: "var(--clinical-line)" }}>
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {raw.sponsor && <p className="mt-3 text-xs text-[var(--clinical-muted)]">Family sponsor on record: <span className="font-semibold text-[var(--clinical-ink-soft)]">{s((raw.sponsor as Row).name) || s((raw.sponsor as Row).email)}</span></p>}
          {canEdit && (
            <div className="mt-4">
              <button type="button" onClick={() => void saveEmergency()} disabled={savingEc}
                className="rounded-lg bg-[var(--clinical-panel)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingEc ? "Saving…" : "Save contacts"}</button>
            </div>
          )}
          <p className="mt-3 text-[11px] text-[var(--clinical-muted)]">The primary contact is saved to the resident&apos;s profile and appears on their Resident Card; the rest are kept with their move-in record.</p>
        </ClinicalCard>
      )}
    </>
  );
}
