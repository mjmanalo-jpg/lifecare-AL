"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, AlertTriangle } from "lucide-react";
import type { HealthAssessment } from "@/lib/healthAssessment";
import { hasHealthAssessment } from "@/lib/healthAssessment";

// APPENDIX IV (LEG-4HA-018) option lists — kept here so both the editor and the
// read-only view share the same labels.
const CONDITION_OPTIONS: [string, string][] = [
  ["dm_insulin", "Insulin Type Diabetes Mellitus"],
  ["dm_noninsulin", "Non-Insulin Type Diabetes Mellitus"],
  ["htn", "Hypertension"],
  ["copd", "COPD"],
  ["post_stroke", "Post Stroke"],
  ["dementia", "Dementia"],
  ["cva", "Cerebrovascular Accident"],
  ["urinary_incontinence", "Urinary Incontinence"],
  ["asthma", "Asthma"],
  ["hep_a", "Hepatitis A"],
  ["hep_b", "Hepatitis B"],
  ["mi", "Myocardial Infarction"],
  ["peripheral_paralysis", "Peripheral Paralysis"],
  ["complete_paralysis", "Complete Paralysis"],
  ["renal_failure", "Renal Failure"],
  ["falls_injury", "Falls related injury"],
  ["vascular", "Vascular Disease"],
  ["cancer", "Cancer"],
  ["std", "Sexually Transmitted Disease"],
  ["tb", "Tuberculosis"],
  ["skin", "Skin Diseases"],
];
const SLEEP_OPTIONS: [string, string][] = [
  ["most_of_day", "Sleeps most of the day"],
  ["continuous_night", "Continuous sleep at night"],
  ["difficulty_night", "Difficulty sleeping at night"],
  ["needs_company", "Needs company when sleeping at night"],
];
const EMOTION_OPTIONS: [string, string][] = [
  ["confused", "Confused"], ["anxious", "Anxious"], ["disoriented", "Disoriented"],
  ["paranoid", "Paranoid"], ["hallucinations", "Hallucinations"],
  ["visual", "Visual"], ["auditory", "Auditory"], ["gustatory", "Gustatory"], ["tactile", "Tactile"],
];
const HOBBY_OPTIONS: [string, string][] = [
  ["reading", "Reading"], ["tv", "Watching TV"], ["gardening", "Gardening"], ["cooking", "Cooking"],
  ["exercising", "Exercising"], ["dancing", "Dancing"], ["internet", "Internet Surfing"], ["casino", "Casino"],
  ["music", "Playing Musical Instrument"], ["sleeping", "Sleeping"], ["crafts", "Crafts"], ["boardgames", "Board & Card Games"],
];

const MEMORY = { MILD: "Mild", MODERATE: "Moderate", SEVERE: "Severe" } as const;
const HOSP = { LT_1_YEAR: "< 1 year", LT_2_YEARS: "< 2 years" } as const;
const MOBILITY = { INDEPENDENT: "Can walk by himself", ASSISTED: "Walk with assistance", IMMOBILE: "Immobile" } as const;
const FEEDING = { ORAL: "Orally", TUBE: "Tube Feeding" } as const;

const labelFor = (opts: [string, string][], key: string) => opts.find(([k]) => k === key)?.[1] ?? key;
const joinLabels = (opts: [string, string][], keys?: string[]) => (keys ?? []).map((k) => labelFor(opts, k)).join(", ");
const s = (v: unknown) => (v == null ? "" : String(v));

export default function HealthAssessmentForm({
  profile, canEdit, residentName, defaultPhysician, defaultAllergies, onSave,
}: {
  profile: HealthAssessment;
  canEdit: boolean;
  residentName: string;
  defaultPhysician?: string;
  defaultAllergies?: string;
  onSave: (next: HealthAssessment) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<HealthAssessment>(profile);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!editing) setForm(profile); }, [profile, editing]);

  const set = <K extends keyof HealthAssessment>(k: K, v: HealthAssessment[K]) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: "conditions" | "sleepingPattern" | "emotionalIssues" | "hobbies", opt: string) =>
    setForm((f) => {
      const cur = new Set(f[k] ?? []);
      cur.has(opt) ? cur.delete(opt) : cur.add(opt);
      return { ...f, [k]: [...cur] };
    });

  const save = async () => { setSaving(true); try { await onSave(form); setEditing(false); } finally { setSaving(false); } };

  const filled = useMemo(() => hasHealthAssessment(profile), [profile]);

  return (
    <div className="mt-4 rounded-xl border border-gray-200 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500 flex items-center gap-1.5">
            <ClipboardList className="w-4 h-4 text-[#2E4A48]" /> Personal Health Assessment & Disclosure
          </p>
          <p className="text-[10px] text-gray-400 mt-0.5">Appendix IV · Pre-Admission Medical History (LEG-4HA-018)</p>
        </div>
        {canEdit && !editing && (
          <button onClick={() => setEditing(true)} className="shrink-0 rounded-md bg-[#2E4A48] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110">
            {filled ? "Edit form" : "Fill out form"}
          </button>
        )}
      </div>

      {editing ? (
        <Editor
          form={form} set={set} toggle={toggle} residentName={residentName}
          defaultPhysician={defaultPhysician} defaultAllergies={defaultAllergies}
          onSave={save} saving={saving} onCancel={() => setEditing(false)}
        />
      ) : filled ? (
        <ReadView profile={profile} residentName={residentName} />
      ) : (
        <p className="text-sm text-gray-400">No health assessment on file yet.{canEdit ? " Use “Fill out form” to record it." : ""}</p>
      )}
    </div>
  );
}

// ---- read-only view ----------------------------------------------------------
function ReadView({ profile: p, residentName }: { profile: HealthAssessment; residentName: string }) {
  const conds = [
    ...(p.conditions ?? []).map((k) => {
      if (k === "post_stroke" && p.postStrokeWhen) return `Post Stroke (${p.postStrokeWhen})`;
      if (k === "cancer" && p.cancerSpecify) return `Cancer — ${p.cancerSpecify}`;
      if (k === "skin" && p.skinSpecify) return `Skin Diseases — ${p.skinSpecify}`;
      return labelFor(CONDITION_OPTIONS, k);
    }),
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <KV label="Resident" value={residentName} />
        <KV label="Resident Contact" value={s(p.residentContact)} />
        <KV label="Primary Care Physician" value={s(p.physicianName)} />
        <KV label="Physician Contact" value={s(p.physicianContact)} />
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Previous Diagnosis / Current Conditions</p>
        {conds.length ? (
          <div className="flex flex-wrap gap-1.5">
            {conds.map((c, i) => (
              <span key={i} className="inline-flex items-center rounded-md border border-[#2E4A48]/20 bg-[#2E4A48]/5 px-2 py-0.5 text-xs font-medium text-[#2E4A48]">{c}</span>
            ))}
          </div>
        ) : <p className="text-sm text-gray-400">None reported.</p>}
      </div>

      {s(p.medications) ? <KV label="Prescribed Medications" value={s(p.medications)} /> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <KV label="Memory Loss / Dementia" value={p.memoryLoss ? MEMORY[p.memoryLoss] : ""} />
        <KV label="Last Hospitalized" value={p.lastHospitalized ? HOSP[p.lastHospitalized] : ""} />
        <KV label="Reason for Hospitalization" value={s(p.hospitalizationReason)} />
        <KV label="Major Surgery / Procedure" value={p.majorSurgery === "YES" ? `Yes${p.surgeryType ? ` — ${p.surgeryType}` : ""}` : p.majorSurgery === "NO" ? "No" : ""} />
        <KV label="Mobility" value={p.mobility ? MOBILITY[p.mobility] : ""} />
        <KV label="Sleeping Pattern" value={joinLabels(SLEEP_OPTIONS, p.sleepingPattern)} />
        <KV label="History of Falling" value={p.falling === "YES" ? `Yes${p.fallingWhen ? ` — ${p.fallingWhen}` : ""}` : p.falling === "NO" ? "No" : ""} />
        <KV label="Mode of Feeding" value={p.feedingMode ? FEEDING[p.feedingMode] : ""} />
        <KV label="Smokes" value={p.smokes === "YES" ? `Yes${p.sticksPerDay ? ` — ${p.sticksPerDay}/day` : ""}` : p.smokes === "NO" ? "No" : ""} />
        <KV label="Drinks Alcohol" value={p.drinksAlcohol === "YES" ? `Yes${p.alcoholFrequency ? ` — ${p.alcoholFrequency}` : ""}` : p.drinksAlcohol === "NO" ? "No" : ""} />
        <KV label="Physician Visit Frequency" value={s(p.physicianVisitFrequency)} />
        <KV label="Toileting" value={[p.bathroomIndependent && `Bathroom: ${p.bathroomIndependent}`, p.onDiapers && `Diapers: ${p.onDiapers}`].filter(Boolean).join(" · ")} />
      </div>

      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Emotional Issues</p>
        <p className="text-sm text-gray-800">{joinLabels(EMOTION_OPTIONS, p.emotionalIssues) || "—"}</p>
      </div>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-1">Hobbies & Favorites</p>
        <p className="text-sm text-gray-800">{[joinLabels(HOBBY_OPTIONS, p.hobbies), p.hobbiesOther].filter(Boolean).join(", ") || "—"}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Food / Drug Allergies</p>
          <p className={`text-sm mt-0.5 ${p.foodDrugAllergies ? "text-red-600 font-semibold" : "text-gray-400"}`}>
            {p.foodDrugAllergies ? <><AlertTriangle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" />{p.foodDrugAllergies}</> : "None reported"}
          </p>
        </div>
        <KV label="COVID-19 Vaccination (date / brand)" value={s(p.covidVaccination)} />
      </div>

      {(p.concurredBy || p.updatedAt) ? (
        <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-2">
          {p.concurredBy ? `Accomplished / concurred by ${p.concurredBy}${p.concurredDate ? ` on ${p.concurredDate}` : ""}. ` : ""}
          {p.updatedAt ? `Last updated ${new Date(p.updatedAt).toLocaleDateString()}${p.updatedBy ? ` by ${p.updatedBy}` : ""}.` : ""}
        </p>
      ) : null}
    </div>
  );
}

// ---- editor ------------------------------------------------------------------
function Editor({
  form, set, toggle, residentName, defaultPhysician, defaultAllergies, onSave, saving, onCancel,
}: {
  form: HealthAssessment;
  set: <K extends keyof HealthAssessment>(k: K, v: HealthAssessment[K]) => void;
  toggle: (k: "conditions" | "sleepingPattern" | "emotionalIssues" | "hobbies", opt: string) => void;
  residentName: string;
  defaultPhysician?: string;
  defaultAllergies?: string;
  onSave: () => void; saving: boolean; onCancel: () => void;
}) {
  const conds = new Set(form.conditions ?? []);
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Resident"><input value={residentName} disabled className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm text-gray-500" /></Field>
        <Field label="Resident Contact No."><Txt value={form.residentContact} onChange={(v) => set("residentContact", v)} /></Field>
        <Field label="Primary Care Physician"><Txt value={form.physicianName} onChange={(v) => set("physicianName", v)} placeholder={defaultPhysician} /></Field>
        <Field label="Physician Contact No."><Txt value={form.physicianContact} onChange={(v) => set("physicianContact", v)} /></Field>
      </div>

      {/* Conditions checklist */}
      <Group title="Please check all previous diagnosis and current health condition">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1.5">
          {CONDITION_OPTIONS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={conds.has(k)} onChange={() => toggle("conditions", k)} className="accent-[#2E4A48]" /> {label}
            </label>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
          {conds.has("post_stroke") && <Field label="Post Stroke — When?"><Txt value={form.postStrokeWhen} onChange={(v) => set("postStrokeWhen", v)} /></Field>}
          {conds.has("cancer") && <Field label="Cancer — specify"><Txt value={form.cancerSpecify} onChange={(v) => set("cancerSpecify", v)} /></Field>}
          {conds.has("skin") && <Field label="Skin Diseases — specify"><Txt value={form.skinSpecify} onChange={(v) => set("skinSpecify", v)} /></Field>}
        </div>
      </Group>

      <Field label="Prescribed medications (list all; attach a copy of the prescription if available)">
        <textarea rows={2} value={form.medications ?? ""} onChange={(e) => set("medications", e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
      </Field>

      {/* 16 questions */}
      <Radio label="1. Suffering from memory loss or dementia?" value={form.memoryLoss ?? ""} onChange={(v) => set("memoryLoss", v as HealthAssessment["memoryLoss"])} options={Object.entries(MEMORY)} />
      <Radio label="2. When was the last hospital admission?" value={form.lastHospitalized ?? ""} onChange={(v) => set("lastHospitalized", v as HealthAssessment["lastHospitalized"])} options={Object.entries(HOSP)} />
      <Field label="3. Reason for the hospitalization"><Txt value={form.hospitalizationReason} onChange={(v) => set("hospitalizationReason", v)} /></Field>
      <div>
        <Radio label="4. Undergone major surgery / medical procedure?" value={form.majorSurgery ?? ""} onChange={(v) => set("majorSurgery", v as HealthAssessment["majorSurgery"])} options={[["YES", "Yes"], ["NO", "No"]]} />
        {form.majorSurgery === "YES" && <div className="mt-1.5"><Field label="Type of surgery / procedure"><Txt value={form.surgeryType} onChange={(v) => set("surgeryType", v)} /></Field></div>}
      </div>
      <Radio label="5. Mobility" value={form.mobility ?? ""} onChange={(v) => set("mobility", v as HealthAssessment["mobility"])} options={Object.entries(MOBILITY)} />
      <Group title="6. Sleeping pattern or habit">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {SLEEP_OPTIONS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={(form.sleepingPattern ?? []).includes(k)} onChange={() => toggle("sleepingPattern", k)} className="accent-[#2E4A48]" /> {label}
            </label>
          ))}
        </div>
      </Group>
      <div>
        <Radio label="7. Incident of falling?" value={form.falling ?? ""} onChange={(v) => set("falling", v as HealthAssessment["falling"])} options={[["YES", "Yes"], ["NO", "No"]]} />
        {form.falling === "YES" && <div className="mt-1.5"><Field label="If yes, when?"><Txt value={form.fallingWhen} onChange={(v) => set("fallingWhen", v)} /></Field></div>}
      </div>
      <Radio label="8. Mode of feeding on admission" value={form.feedingMode ?? ""} onChange={(v) => set("feedingMode", v as HealthAssessment["feedingMode"])} options={Object.entries(FEEDING)} />
      <div>
        <Radio label="9. Does resident smoke?" value={form.smokes ?? ""} onChange={(v) => set("smokes", v as HealthAssessment["smokes"])} options={[["YES", "Yes"], ["NO", "No"]]} />
        {form.smokes === "YES" && <div className="mt-1.5"><Field label="Sticks per day"><Txt value={form.sticksPerDay} onChange={(v) => set("sticksPerDay", v)} /></Field></div>}
      </div>
      <div>
        <Radio label="10. Does resident drink alcohol?" value={form.drinksAlcohol ?? ""} onChange={(v) => set("drinksAlcohol", v as HealthAssessment["drinksAlcohol"])} options={[["YES", "Yes"], ["NO", "No"]]} />
        {form.drinksAlcohol === "YES" && <div className="mt-1.5"><Field label="How often?"><Txt value={form.alcoholFrequency} onChange={(v) => set("alcoholFrequency", v)} /></Field></div>}
      </div>
      <Field label="11. How often does the resident visit a physician?"><Txt value={form.physicianVisitFrequency} onChange={(v) => set("physicianVisitFrequency", v)} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="12. Goes to bathroom by himself?"><Txt value={form.bathroomIndependent} onChange={(v) => set("bathroomIndependent", v)} /></Field>
        <Field label="On diapers?"><Txt value={form.onDiapers} onChange={(v) => set("onDiapers", v)} /></Field>
      </div>
      <Group title="13. Emotional issues">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-1.5">
          {EMOTION_OPTIONS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={(form.emotionalIssues ?? []).includes(k)} onChange={() => toggle("emotionalIssues", k)} className="accent-[#2E4A48]" /> {label}
            </label>
          ))}
        </div>
      </Group>
      <Group title="14. Hobbies & favorites">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-1.5">
          {HOBBY_OPTIONS.map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={(form.hobbies ?? []).includes(k)} onChange={() => toggle("hobbies", k)} className="accent-[#2E4A48]" /> {label}
            </label>
          ))}
        </div>
        <div className="mt-2"><Field label="Others"><Txt value={form.hobbiesOther} onChange={(v) => set("hobbiesOther", v)} /></Field></div>
      </Group>
      <Field label="15. Allergies to food and/or medication"><Txt value={form.foodDrugAllergies} onChange={(v) => set("foodDrugAllergies", v)} placeholder={defaultAllergies} /></Field>
      <Field label="16. Date and brand of COVID-19 vaccination"><Txt value={form.covidVaccination} onChange={(v) => set("covidVaccination", v)} /></Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3">
        <Field label="Accomplished / concurred by (resident / legal rep.)"><Txt value={form.concurredBy} onChange={(v) => set("concurredBy", v)} /></Field>
        <Field label="Date"><input type="date" value={form.concurredDate ?? ""} onChange={(e) => set("concurredDate", e.target.value)} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" /></Field>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={onSave} disabled={saving} className="rounded-md bg-[#2E4A48] px-3 py-1.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">{saving ? "Saving…" : "Save assessment"}</button>
        <button onClick={onCancel} className="text-sm font-medium text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </div>
  );
}

// ---- small shared controls ---------------------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  );
}
function Txt({ value, onChange, placeholder }: { value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />;
}
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 p-2.5">
      <p className="text-xs font-semibold text-gray-700 mb-1.5">{title}</p>
      {children}
    </div>
  );
}
function Radio({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-700 mb-1">{label}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map(([k, lbl]) => (
          <label key={k} className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="radio" name={label} checked={value === k} onChange={() => onChange(value === k ? "" : k)} onClick={() => { if (value === k) onChange(""); }} className="accent-[#2E4A48]" /> {lbl}
          </label>
        ))}
      </div>
    </div>
  );
}
function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-0.5">{value || "—"}</p>
    </div>
  );
}
