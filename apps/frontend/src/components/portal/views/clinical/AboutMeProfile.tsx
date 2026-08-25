"use client";

/**
 * "About Me" — the editable, human profile on the resident care card.
 * View for everyone; inline editor only when `canEdit` (Nurse / Care Manager).
 * Persistence is owned by the parent (rcard) via `onSave`.
 */

import { useState } from "react";
import {
  Heart, Users, Phone, ShieldAlert, Package, Pencil, Plus, Trash2,
  Save, X, Ban, Sparkles, BookOpen, Palette, MessageCircle, CalendarHeart,
} from "lucide-react";
import {
  AboutMeProfile as Profile, AboutPerson, AboutBelonging, AboutKeyDate,
  emptyProfile, newPerson, newBelonging, newKeyDate, sortedPeople,
} from "@/lib/aboutMe";

const s = (v: unknown) => (v == null ? "" : String(v));
const ACCENT = "#2E4A48";

/* ---------- small view helpers ---------- */

function Field({ label, value, empty = "—" }: { label: string; value?: string; empty?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-wrap">{value?.trim() ? value : <span className="text-gray-400">{empty}</span>}</p>
    </div>
  );
}

function Panel({ icon: Icon, title, children }: { icon: typeof Heart; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2.5">
        <Icon className="h-4 w-4" style={{ color: ACCENT }} />
        <h3 className="text-sm font-bold text-gray-800">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function RoleChips({ p }: { p: AboutPerson }) {
  const chips: { label: string; cls: string }[] = [];
  if (p.medicalPOA) chips.push({ label: "Medical POA", cls: "bg-teal-100 text-teal-800 border-teal-200" });
  if (p.financialPOA) chips.push({ label: "Financial POA / Guardian", cls: "bg-indigo-100 text-indigo-800 border-indigo-200" });
  if (p.decisionMaker && !p.medicalPOA && !p.financialPOA) chips.push({ label: "Decision Maker", cls: "bg-teal-100 text-teal-800 border-teal-200" });
  if (p.emergency) chips.push({ label: "Emergency", cls: "bg-amber-100 text-amber-800 border-amber-200" });
  if (p.family) chips.push({ label: "Family", cls: "bg-blue-100 text-blue-800 border-blue-200" });
  if (p.blocked) chips.push({ label: "Blocked", cls: "bg-red-100 text-red-700 border-red-200" });
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span key={c.label} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${c.cls}`}>{c.label}</span>
      ))}
    </div>
  );
}

/* ---------- read view ---------- */

function ReadView({ profile }: { profile: Profile }) {
  const people = sortedPeople(profile.people);
  return (
    <div className="space-y-4">
      <Panel icon={Sparkles} title="Identity & Preferences">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Preferred name" value={profile.preferredName} empty="No preferred name recorded" />
          <Field label="Nicknames" value={(profile.nicknames || []).join(", ")} />
          <Field label="Religious affiliation" value={profile.religion} />
          <Field label="Cultural preferences / customs" value={profile.culturalPreferences} />
        </div>
      </Panel>

      <Panel icon={BookOpen} title="Life Story & Background">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Birthplace / hometown" value={profile.birthplace} />
          <Field label="Occupation / career" value={profile.occupation} />
          <Field label="Marital status" value={profile.maritalStatus} />
          <Field label="Languages spoken" value={profile.languages} />
          <Field label="Family background" value={profile.familyBackground} />
          <Field label="Military service" value={profile.militaryService} />
        </div>
      </Panel>

      <Panel icon={Palette} title="Interests & Daily Routine">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hobbies / interests / music / TV" value={profile.interests} />
          <Field label="Pets" value={profile.pets} />
          <Field label="Daily routine (wake / sleep / bathing / meals)" value={profile.dailyRoutine} />
          <Field label="Food likes & dislikes" value={profile.foodPreferences} />
        </div>
      </Panel>

      <Panel icon={MessageCircle} title="Comfort & Communication">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="How to interact / greet me" value={profile.interactionNotes} empty="No notes yet" />
          <Field label="What comforts me" value={profile.comforts} />
          <Field label="What upsets me (triggers)" value={profile.upsets} />
          <Field label="Communication aids (hearing / vision / speech)" value={profile.communicationAids} />
          <Field label="Spiritual practices" value={profile.spiritualPractices} />
        </div>
      </Panel>

      <Panel icon={CalendarHeart} title="Wishes & Key Dates">
        <Field label="What matters to me now / goals" value={profile.whatMatters} />
        {(profile.keyDates || []).length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {(profile.keyDates || []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <CalendarHeart className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                <span className="font-medium text-gray-800">{d.label || "—"}</span>
                {d.date && <span className="text-gray-500">· {d.date}</span>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel icon={Users} title={`People (${people.length})`}>
        {people.length === 0 ? (
          <p className="text-sm text-gray-400">No people recorded yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {people.map((p) => (
              <li key={p.id} className={`flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between ${p.blocked ? "opacity-90" : ""}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {!p.blocked && typeof p.priority === "number" && p.priority > 0 && (
                      <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-600 text-[11px] font-bold text-white" title={`Call priority ${p.priority}`}>{p.priority}</span>
                    )}
                    {p.blocked && <Ban className="h-4 w-4 shrink-0 text-red-500" />}
                    <p className={`truncate font-semibold ${p.blocked ? "text-red-700 line-through" : "text-gray-900"}`}>{p.name || "Unnamed"}</p>
                    {p.relationship && <span className="truncate text-sm text-gray-500">· {p.relationship}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {p.phone && <a href={`tel:${p.phone}`} className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><Phone className="h-3 w-3" />{p.phone}</a>}
                    <RoleChips p={p} />
                  </div>
                  {p.notes && <p className="mt-1 text-xs text-gray-500">{p.notes}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel icon={Package} title={`Personal Belongings (${profile.belongings.length})`}>
        {profile.belongings.length === 0 ? (
          <p className="text-sm text-gray-400">No belongings recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5 pr-3 font-semibold">Item</th>
                  <th className="py-1.5 pr-3 font-semibold">Description</th>
                  <th className="py-1.5 pr-3 font-semibold">Kept</th>
                  <th className="py-1.5 pr-3 font-semibold">Brought</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {profile.belongings.map((b) => (
                  <tr key={b.id}>
                    <td className="py-1.5 pr-3 font-medium text-gray-800">{b.item || "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{b.description || "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{b.location || "—"}</td>
                    <td className="py-1.5 pr-3 text-gray-600">{b.broughtDate || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {profile.otherNotes?.trim() && (
        <Panel icon={ShieldAlert} title="Other details">
          <p className="whitespace-pre-wrap text-sm text-gray-800">{profile.otherNotes}</p>
        </Panel>
      )}
    </div>
  );
}

/* ---------- edit view ---------- */

const inputCls = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";
const labelCls = "block text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1";

function Check({ label, checked, onChange }: { label: string; checked?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-teal-600 focus:ring-teal-500" />
      {label}
    </label>
  );
}

function TI({ label, value, onChange, placeholder }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input className={inputCls} value={s(value)} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function TA({ label, value, onChange, rows = 2, placeholder }: { label: string; value?: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <textarea className={inputCls} rows={rows} value={s(value)} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function EditView({ initial, saving, onCancel, onSave }: {
  initial: Profile; saving: boolean;
  onCancel: () => void; onSave: (p: Profile) => void;
}) {
  const [draft, setDraft] = useState<Profile>(() => ({
    ...emptyProfile(), ...initial,
    nicknames: [...(initial.nicknames || [])],
    keyDates: (initial.keyDates || []).map((d) => ({ ...d })),
    people: initial.people.map((p) => ({ ...p })),
    belongings: initial.belongings.map((b) => ({ ...b })),
  }));

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setPerson = (id: string, patch: Partial<AboutPerson>) =>
    setDraft((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setBelonging = (id: string, patch: Partial<AboutBelonging>) =>
    setDraft((d) => ({ ...d, belongings: d.belongings.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  const setKeyDate = (id: string, patch: Partial<AboutKeyDate>) =>
    setDraft((d) => ({ ...d, keyDates: (d.keyDates || []).map((k) => (k.id === id ? { ...k, ...patch } : k)) }));

  return (
    <div className="space-y-4">
      <Panel icon={Sparkles} title="Identity & Preferences">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Preferred name (what they respond to)</label>
            <input className={inputCls} value={s(draft.preferredName)} onChange={(e) => set("preferredName", e.target.value)} placeholder="e.g. Lolo Ben" />
          </div>
          <div>
            <label className={labelCls}>Nicknames (comma-separated)</label>
            <input className={inputCls} value={(draft.nicknames || []).join(", ")} onChange={(e) => set("nicknames", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))} />
          </div>
          <div>
            <label className={labelCls}>Religious affiliation</label>
            <input className={inputCls} value={s(draft.religion)} onChange={(e) => set("religion", e.target.value)} placeholder="e.g. Roman Catholic" />
          </div>
          <div>
            <label className={labelCls}>Cultural preferences / customs</label>
            <textarea className={inputCls} rows={2} value={s(draft.culturalPreferences)} onChange={(e) => set("culturalPreferences", e.target.value)} placeholder="Food, holidays, customs to observe…" />
          </div>
        </div>
      </Panel>

      <Panel icon={BookOpen} title="Life Story & Background">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TI label="Birthplace / hometown" value={draft.birthplace} onChange={(v) => set("birthplace", v)} />
          <TI label="Occupation / career" value={draft.occupation} onChange={(v) => set("occupation", v)} />
          <TI label="Marital status" value={draft.maritalStatus} onChange={(v) => set("maritalStatus", v)} placeholder="e.g. Widowed" />
          <TI label="Languages spoken" value={draft.languages} onChange={(v) => set("languages", v)} placeholder="e.g. Tagalog, English" />
          <TA label="Family background" value={draft.familyBackground} onChange={(v) => set("familyBackground", v)} placeholder="Children, where family lives…" />
          <TA label="Military service" value={draft.militaryService} onChange={(v) => set("militaryService", v)} />
        </div>
      </Panel>

      <Panel icon={Palette} title="Interests & Daily Routine">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TA label="Hobbies / interests / music / TV" value={draft.interests} onChange={(v) => set("interests", v)} />
          <TI label="Pets" value={draft.pets} onChange={(v) => set("pets", v)} />
          <TA label="Daily routine (wake / sleep / bathing / meals)" value={draft.dailyRoutine} onChange={(v) => set("dailyRoutine", v)} />
          <TA label="Food likes & dislikes" value={draft.foodPreferences} onChange={(v) => set("foodPreferences", v)} />
        </div>
      </Panel>

      <Panel icon={MessageCircle} title="Comfort & Communication">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TA label="How to interact / greet me" value={draft.interactionNotes} onChange={(v) => set("interactionNotes", v)} placeholder="Tone, how to greet…" />
          <TA label="What comforts me" value={draft.comforts} onChange={(v) => set("comforts", v)} placeholder="Music, a blanket, a routine…" />
          <TA label="What upsets me (triggers)" value={draft.upsets} onChange={(v) => set("upsets", v)} placeholder="Triggers & how to de-escalate…" />
          <TI label="Communication aids (hearing / vision / speech)" value={draft.communicationAids} onChange={(v) => set("communicationAids", v)} />
          <TI label="Spiritual practices" value={draft.spiritualPractices} onChange={(v) => set("spiritualPractices", v)} placeholder="Prayer times, clergy visits…" />
        </div>
      </Panel>

      <Panel icon={CalendarHeart} title="Wishes & Key Dates">
        <TA label="What matters to me now / goals" value={draft.whatMatters} onChange={(v) => set("whatMatters", v)} />
        <div className="mt-3 space-y-2">
          {(draft.keyDates || []).map((d) => (
            <div key={d.id} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input className={`${inputCls} sm:col-span-7`} value={s(d.label)} onChange={(e) => setKeyDate(d.id, { label: e.target.value })} placeholder="e.g. Wedding anniversary" />
              <input type="date" className={`${inputCls} sm:col-span-4`} value={s(d.date)} onChange={(e) => setKeyDate(d.id, { date: e.target.value })} />
              <button onClick={() => setDraft((dd) => ({ ...dd, keyDates: (dd.keyDates || []).filter((x) => x.id !== d.id) }))} className="inline-flex items-center justify-center rounded-lg bg-gray-100 text-red-600 hover:bg-red-50 sm:col-span-1" aria-label="Remove date"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setDraft((dd) => ({ ...dd, keyDates: [...(dd.keyDates || []), newKeyDate()] }))} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:border-teal-400 hover:text-teal-700"><Plus className="h-4 w-4" /> Add date</button>
      </Panel>

      <Panel icon={Users} title="People">
        <p className="mb-2 text-xs text-gray-500">Priority = who to call first (1, 2, 3…). Flag roles below. Blocked people are excluded from the call order and flagged red.</p>
        <div className="space-y-3">
          {draft.people.map((p) => (
            <div key={p.id} className="rounded-lg border border-gray-200 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <input className={`${inputCls} sm:col-span-4`} value={s(p.name)} onChange={(e) => setPerson(p.id, { name: e.target.value })} placeholder="Full name" />
                <input className={`${inputCls} sm:col-span-3`} value={s(p.relationship)} onChange={(e) => setPerson(p.id, { relationship: e.target.value })} placeholder="Relationship" />
                <input className={`${inputCls} sm:col-span-3`} value={s(p.phone)} onChange={(e) => setPerson(p.id, { phone: e.target.value })} placeholder="Phone" />
                <input type="number" min={1} className={`${inputCls} sm:col-span-2`} value={p.priority ?? ""} onChange={(e) => setPerson(p.id, { priority: e.target.value ? Number(e.target.value) : undefined })} placeholder="Priority" />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Check label="Medical POA" checked={p.medicalPOA} onChange={(v) => setPerson(p.id, { medicalPOA: v })} />
                <Check label="Financial POA / guardian" checked={p.financialPOA} onChange={(v) => setPerson(p.id, { financialPOA: v })} />
                <Check label="Emergency contact" checked={p.emergency} onChange={(v) => setPerson(p.id, { emergency: v })} />
                <Check label="Important family" checked={p.family} onChange={(v) => setPerson(p.id, { family: v })} />
                <Check label="Blocked" checked={p.blocked} onChange={(v) => setPerson(p.id, { blocked: v })} />
                <button onClick={() => setDraft((d) => ({ ...d, people: d.people.filter((x) => x.id !== p.id) }))} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
              </div>
              <input className={`${inputCls} mt-2`} value={s(p.notes)} onChange={(e) => setPerson(p.id, { notes: e.target.value })} placeholder="Notes (optional)" />
            </div>
          ))}
        </div>
        <button onClick={() => setDraft((d) => ({ ...d, people: [...d.people, newPerson()] }))} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:border-teal-400 hover:text-teal-700"><Plus className="h-4 w-4" /> Add person</button>
      </Panel>

      <Panel icon={Package} title="Personal Belongings">
        <div className="space-y-3">
          {draft.belongings.map((b) => (
            <div key={b.id} className="grid grid-cols-1 gap-2 rounded-lg border border-gray-200 p-3 sm:grid-cols-12">
              <input className={`${inputCls} sm:col-span-3`} value={s(b.item)} onChange={(e) => setBelonging(b.id, { item: e.target.value })} placeholder="Item" />
              <input className={`${inputCls} sm:col-span-3`} value={s(b.description)} onChange={(e) => setBelonging(b.id, { description: e.target.value })} placeholder="Description" />
              <input className={`${inputCls} sm:col-span-2`} value={s(b.location)} onChange={(e) => setBelonging(b.id, { location: e.target.value })} placeholder="Kept in…" />
              <input type="date" className={`${inputCls} sm:col-span-3`} value={s(b.broughtDate)} onChange={(e) => setBelonging(b.id, { broughtDate: e.target.value })} />
              <button onClick={() => setDraft((d) => ({ ...d, belongings: d.belongings.filter((x) => x.id !== b.id) }))} className="inline-flex items-center justify-center rounded-lg bg-gray-100 text-red-600 hover:bg-red-50 sm:col-span-1" aria-label="Remove belonging"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
        <button onClick={() => setDraft((d) => ({ ...d, belongings: [...d.belongings, newBelonging()] }))} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm font-medium text-gray-600 hover:border-teal-400 hover:text-teal-700"><Plus className="h-4 w-4" /> Add belonging</button>
      </Panel>

      <Panel icon={ShieldAlert} title="Other details">
        <textarea className={inputCls} rows={3} value={s(draft.otherNotes)} onChange={(e) => set("otherNotes", e.target.value)} placeholder="Anything else worth recording…" />
      </Panel>

      <div className="flex items-center justify-end gap-2">
        <button onClick={onCancel} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"><X className="h-4 w-4" /> Cancel</button>
        <button onClick={() => onSave(draft)} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: ACCENT }}><Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}

/* ---------- shell ---------- */

export default function AboutMeProfile({ profile, canEdit, onSave }: {
  profile: Profile;
  canEdit: boolean;
  onSave: (next: Profile) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (next: Profile) => {
    setSaving(true);
    try {
      await onSave(next);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  if (editing) return <EditView initial={profile} saving={saving} onCancel={() => setEditing(false)} onSave={save} />;

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-white" style={{ backgroundColor: ACCENT }}>
            <Pencil className="h-4 w-4" /> Edit About Me
          </button>
        </div>
      )}
      <ReadView profile={profile} />
      {profile.updatedAt && (
        <p className="text-right text-[11px] text-gray-400">Last updated {new Date(profile.updatedAt).toLocaleString()}{profile.updatedBy ? ` by ${profile.updatedBy}` : ""}</p>
      )}
    </div>
  );
}
