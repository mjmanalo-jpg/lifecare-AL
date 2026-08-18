"use client";

/**
 * Staff Profiles & Records (tab `staffprofiles`, Care Manager) — the credibility
 * file for each nurse & caregiver: license, trainings, accreditations, and the
 * face photo used for verified clock-in. Migration-free: app-setting
 * `staff_profiles` (see lib/staffProfiles).
 */

import { useMemo, useRef, useState, type ReactNode } from "react";
import { Search, Plus, Trash2, X, BadgeCheck, GraduationCap, Upload, ShieldCheck, ScanFace } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, StatCard, DataState, FieldLabel, controlClass, SERIF } from "./clinical-ui";
import CameraCapture from "@/components/portal/CameraCapture";
import { hasDetectableFace } from "@/lib/faceVerify";
import {
  STAFF_PROFILES_KEY, parseStaffProfiles, hasFaceEnrollment, emptyProfile,
  type StaffProfile, type StaffCredential,
} from "@/lib/staffProfiles";

type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };
type Person = { userId: string; staffId: string; name: string; role: string };
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `cr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const roleLabel = (r: string) => (r === "CAREGIVER" ? "Caregiver" : r === "NURSE" ? "Nurse" : r.replace(/_/g, " "));

// Downscale an uploaded image file to a JPEG dataURL for a compact face photo.
function fileToPhoto(file: File, width = 480): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(width, img.width), h = Math.round((img.height / img.width) * w);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const ctx = c.getContext("2d"); if (!ctx) { reject(new Error("canvas")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => reject(new Error("image"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("read"));
    reader.readAsDataURL(file);
  });
}

export default function StaffProfilesBoard({ clinicianRole = "FACILITY_ADMIN" }: { clinicianRole?: ClinicianRole }) {
  const { name: me } = useClinician(clinicianRole);
  const staffQ = useLiveQuery<StaffRow>("staff", { query: "include=user&take=300", tables: ["Staff", "User"] });
  const { data: settingRows, refetch, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const profiles = useMemo(() => parseStaffProfiles(settingRows.find((r) => s(r.key || r.id) === STAFF_PROFILES_KEY)?.value), [settingRows]);
  const people = useMemo<Person[]>(() => (staffQ.data || [])
    .filter((st) => st.user?.role === "NURSE" || st.user?.role === "CAREGIVER")
    .map((st) => ({ userId: s(st.userId), staffId: s(st.id), name: s(st.user?.name) || "Staff", role: s(st.user?.role) }))
    .filter((p) => p.userId), [staffQ.data]);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [edit, setEdit] = useState<Person | null>(null);

  const q = search.trim().toLowerCase();
  const filtered = people.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!roleFilter || p.role === roleFilter));

  const stats = {
    total: people.length,
    enrolled: people.filter((p) => hasFaceEnrollment(profiles[p.userId])).length,
    accredited: people.filter((p) => profiles[p.userId]?.accredited).length,
    missing: people.filter((p) => !hasFaceEnrollment(profiles[p.userId])).length,
  };

  const save = async (prof: StaffProfile) => {
    const next = { ...profiles, [prof.userId]: { ...prof, updatedAt: new Date().toISOString(), updatedBy: me } };
    await upsertRecord("app-settings", STAFF_PROFILES_KEY, { key: STAFF_PROFILES_KEY, value: JSON.stringify(next) });
    await refetch();
    setEdit(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Profile saved", showConfirmButton: false, timer: 1500 });
  };

  return (
    <ClinicalPage>
      <ClinicalHeader title="Staff Profiles & Records" subtitle="Credibility file for each nurse & caregiver — license, training, accreditation, and the face photo used for verified clock-in." />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={stats.total} label="Staff" accent="ink" />
        <StatCard value={stats.enrolled} label="Face-enrolled" accent="ink" />
        <StatCard value={stats.accredited} label="Accredited" accent="ink" />
        <StatCard value={stats.missing} label="No face photo" accent={stats.missing > 0 ? "amber" : "ink"} />
      </div>

      <div className="mt-5 mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name…" className="w-full rounded-2xl border py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-[var(--clinical-panel)]/30" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }} />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="rounded-2xl border px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--clinical-panel)]/30" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          <option value="">All roles</option>
          <option value="NURSE">Nurses</option>
          <option value="CAREGIVER">Caregivers</option>
        </select>
      </div>

      <DataState loading={(loading || staffQ.loading) && people.length === 0} error={staffQ.error} empty={filtered.length === 0} emptyTitle={q ? "No staff match" : "No nurses or caregivers"} emptyHint={q ? "Try a different name." : "Nurse and caregiver accounts appear here once created."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((p) => {
            const prof = profiles[p.userId];
            const enrolled = hasFaceEnrollment(prof);
            return (
              <button key={p.userId} onClick={() => setEdit(p)} className="flex items-center gap-3 rounded-2xl border p-3.5 text-left transition hover:shadow-sm" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                {prof?.photo
                  ? <img src={prof.photo} alt={p.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                  : <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(p.name)}</span>}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{p.name}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{roleLabel(p.role)}</span>
                    {prof?.accredited && <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-700"><BadgeCheck className="h-3 w-3" /> Accredited</span>}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--clinical-muted)]">
                    <span className={enrolled ? "inline-flex items-center gap-1 text-[var(--clinical-green)]" : "inline-flex items-center gap-1 text-[var(--clinical-amber)]"}><ScanFace className="h-3.5 w-3.5" /> {enrolled ? "Face enrolled" : "No face photo"}</span>
                    <span><GraduationCap className="mr-1 inline h-3.5 w-3.5" />{(prof?.trainings?.length ?? 0)} training{(prof?.trainings?.length ?? 0) === 1 ? "" : "s"}</span>
                    {prof?.licenseNo && <span>Lic. {prof.licenseNo}</span>}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </DataState>

      {edit && <ProfileEditor person={edit} profile={profiles[edit.userId]} onClose={() => setEdit(null)} onSave={save} />}
    </ClinicalPage>
  );
}

function ProfileEditor({ person, profile, onClose, onSave }: { person: Person; profile?: StaffProfile; onClose: () => void; onSave: (p: StaffProfile) => Promise<void> }) {
  const base = profile ?? emptyProfile(person.userId, person.name, person.role, new Date().toISOString());
  const [photo, setPhoto] = useState(base.photo || "");
  const [licenseNo, setLicenseNo] = useState(base.licenseNo || "");
  const [hireDate, setHireDate] = useState(base.hireDate || "");
  const [status, setStatus] = useState<StaffProfile["status"]>(base.status || "ACTIVE");
  const [accredited, setAccredited] = useState(!!base.accredited);
  const [trainings, setTrainings] = useState<StaffCredential[]>(base.trainings || []);
  const [accreditations, setAccreditations] = useState<StaffCredential[]>(base.accreditations || []);
  const [notes, setNotes] = useState(base.notes || "");
  const [showCam, setShowCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const applyPhoto = async (dataUrl: string) => {
    setBusy(true);
    try {
      const ok = await hasDetectableFace(dataUrl);
      if (!ok) {
        const proceed = await Swal.fire({ title: "No face detected", text: "The system couldn't find a clear face in this photo. Use it anyway?", icon: "warning", showCancelButton: true, confirmButtonText: "Use anyway", confirmButtonColor: "#2563eb" });
        if (!proceed.isConfirmed) return;
      }
      setPhoto(dataUrl);
      setShowCam(false);
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await onSave({ ...base, name: person.name, role: person.role, staffId: person.staffId, photo: photo || undefined, licenseNo: licenseNo.trim() || undefined, hireDate: hireDate || undefined, status, accredited, trainings, accreditations, notes: notes.trim() || undefined });
    } finally { setBusy(false); }
  };

  return (
    <ClinicalModal open onClose={onClose} title={person.name} description={`${roleLabel(person.role)} · profile & records`} size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save profile"}</ClinicalButton>
      </>}>
      <div className="space-y-5">
        {/* Face photo */}
        <section className="space-y-3">
          <FieldLabel>Face photo <span className="font-normal text-[var(--clinical-muted)]">(used for clock-in verification)</span></FieldLabel>
          {showCam ? (
            <div className="space-y-2">
              <CameraCapture onCapture={applyPhoto} busy={busy} captureLabel="Capture face photo" />
              <button type="button" onClick={() => setShowCam(false)} className="text-xs font-semibold text-[var(--clinical-muted)] hover:underline">Cancel camera</button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {photo
                ? <img src={photo} alt="face" className="h-24 w-24 rounded-2xl object-cover" />
                : <span className="flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-slate-300 text-slate-400"><ScanFace className="h-8 w-8" /></span>}
              <div className="flex flex-col gap-2">
                <ClinicalButton variant="secondary" size="sm" onClick={() => setShowCam(true)}><ScanFace className="h-4 w-4" /> Use camera</ClinicalButton>
                <ClinicalButton variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload photo</ClinicalButton>
                {photo && <button type="button" onClick={() => setPhoto("")} className="text-xs font-semibold text-[var(--clinical-coral)] hover:underline">Remove photo</button>}
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await applyPhoto(await fileToPhoto(f)); } catch { Swal.fire("Upload failed", "", "error"); } } e.target.value = ""; }} />
              </div>
            </div>
          )}
        </section>

        {/* Credentials */}
        <section className="grid grid-cols-1 gap-3 border-t border-[var(--clinical-line)] pt-5 sm:grid-cols-3">
          <div><FieldLabel>License / PRC No.</FieldLabel><input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} placeholder="e.g., 0123456" className={controlClass} /></div>
          <div><FieldLabel>Hire date</FieldLabel><input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} className={controlClass} /></div>
          <div><FieldLabel>Status</FieldLabel><select value={status} onChange={(e) => setStatus(e.target.value as StaffProfile["status"])} className={controlClass}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></div>
        </section>

        <label className="flex items-start gap-2.5 rounded-xl border border-teal-200 bg-teal-50 p-3 cursor-pointer">
          <input type="checkbox" checked={accredited} onChange={(e) => setAccredited(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-teal-300 text-teal-600 focus:ring-teal-400" />
          <span><span className="flex items-center gap-1.5 text-sm font-bold text-teal-800"><ShieldCheck className="h-4 w-4" /> Accredited to take on duty</span><span className="mt-0.5 block text-xs text-teal-700">Credentials reviewed and cleared for resident care.</span></span>
        </label>

        <CredentialList label="Trainings" icon={<GraduationCap className="h-4 w-4" />} items={trainings} onChange={setTrainings} newId={newId} />
        <CredentialList label="Accreditations & certifications" icon={<BadgeCheck className="h-4 w-4" />} items={accreditations} onChange={setAccreditations} newId={newId} />

        <div><FieldLabel>Notes</FieldLabel><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} /></div>
      </div>
    </ClinicalModal>
  );
}

function CredentialList({ label, icon, items, onChange, newId }: { label: string; icon: ReactNode; items: StaffCredential[]; onChange: (v: StaffCredential[]) => void; newId: () => string }) {
  const [name, setName] = useState("");
  const [issuer, setIssuer] = useState("");
  const [expiry, setExpiry] = useState("");
  const add = () => {
    if (!name.trim()) return;
    onChange([...items, { id: newId(), name: name.trim(), issuer: issuer.trim() || undefined, expiry: expiry || undefined }]);
    setName(""); setIssuer(""); setExpiry("");
  };
  return (
    <section className="space-y-2 border-t border-[var(--clinical-line)] pt-5">
      <FieldLabel><span className="inline-flex items-center gap-1.5">{icon} {label}</span></FieldLabel>
      {items.length > 0 && (
        <ul className="space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
              <span className="min-w-0"><span className="font-semibold text-[var(--clinical-ink)]">{it.name}</span>{it.issuer ? <span className="text-[var(--clinical-muted)]"> · {it.issuer}</span> : null}{it.expiry ? <span className="text-[var(--clinical-muted)]"> · exp {it.expiry}</span> : null}</span>
              <button type="button" onClick={() => onChange(items.filter((x) => x.id !== it.id))} className="shrink-0 text-[var(--clinical-coral)] hover:opacity-80"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Add ${label.toLowerCase().split(" ")[0]}…`} className={controlClass} />
        <input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Issuer (optional)" className={controlClass} />
        <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={controlClass} title="Expiry (optional)" />
        <ClinicalButton variant="secondary" size="sm" onClick={add}><Plus className="h-4 w-4" /> Add</ClinicalButton>
      </div>
    </section>
  );
}
