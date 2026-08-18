"use client";

/**
 * DT-010 Emergency / Evacuation — shelter-vs-evacuate decision, accountability
 * (headcount) and recovery / all-clear.
 *
 * Shows the DT-010 protocol as a reference panel, then lets staff open an
 * emergency event with a shelter/evacuate decision, a headcount/accountability
 * record and an all-clear. Migration-free: events are a JSON array in the
 * app-setting `emergency_events`.
 */

import { useMemo, useState } from "react";
import { Plus, AlertOctagon, ShieldCheck, Users, Loader2, Clock } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { getProtocol } from "@/lib/lifecare/decisionTrees";
import ProtocolReference from "./ProtocolReference";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, StatCard, FieldLabel, controlClass, StatusPill } from "./clinical-ui";

const KEY = "emergency_events";
const newId = () => globalThis.crypto?.randomUUID?.() ?? `emg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const TYPES = ["Fire", "Flood", "Gas leak", "Utility / power failure", "Structural", "Severe weather", "Security threat", "Other"];
const DECISIONS = ["SHELTER_IN_PLACE", "PARTIAL_EVACUATION", "FULL_EVACUATION"] as const;
const DECISION_LABEL: Record<string, string> = { SHELTER_IN_PLACE: "Shelter in place", PARTIAL_EVACUATION: "Partial evacuation", FULL_EVACUATION: "Full evacuation" };
const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
type Status = (typeof STATUSES)[number];

interface EmEvent {
  id: string; occurredAt: string; type: string; decision: string; description: string;
  headExpected: number; headAccounted: number; accountabilityNote: string; agencies: string;
  allClearAt: string; status: Status; raisedBy: string; createdAt: string; updatedAt: string;
}
const parse = (raw: string | null | undefined): EmEvent[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };
const allAccounted = (r: EmEvent) => r.headExpected > 0 && r.headAccounted >= r.headExpected;

export default function EmergencyProtocolBoard({ role = "NURSE" }: { role?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(role);
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const events = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);

  const protocol = getProtocol("DT-010")!;
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = events.filter((r) => !statusFilter || r.status === statusFilter);
  const stats = { active: events.filter((r) => r.status !== "CLOSED").length, evac: events.filter((r) => r.decision !== "SHELTER_IN_PLACE" && r.status !== "CLOSED").length, closed: events.filter((r) => r.status === "CLOSED").length };

  const persist = async (next: EmEvent[]) => { await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) }); await refetch(); };

  // "All clear" closes the event and stamps the recovery time.
  const allClear = async (r: EmEvent) => {
    setBusyId(r.id);
    try { await persist(events.map((x) => (x.id === r.id ? { ...x, status: "CLOSED", allClearAt: new Date().toISOString(), updatedAt: new Date().toISOString() } : x))); }
    finally { setBusyId(null); }
  };
  const beginResponse = async (r: EmEvent) => {
    setBusyId(r.id);
    try { await persist(events.map((x) => (x.id === r.id ? { ...x, status: "IN_PROGRESS", updatedAt: new Date().toISOString() } : x))); }
    finally { setBusyId(null); }
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Emergency & Evacuation"
        subtitle="Decide shelter vs evacuate, account for every person, and only re-occupy on the official all-clear. Follow the DT-010 protocol."
        right={<ClinicalButton variant="accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Declare Emergency</ClinicalButton>}
      />

      <div className="mt-5"><ProtocolReference protocol={protocol} /></div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard value={stats.active} label="Active events" accent="coral" />
        <StatCard value={stats.evac} label="Evacuations" accent="amber" />
        <StatCard value={stats.closed} label="All-clear (closed)" accent="green" />
      </div>

      <div className="mt-5 flex items-center gap-1 self-start rounded-xl bg-[var(--clinical-surface-2)] p-1 w-fit">
        {["", ...STATUSES].map((st) => (
          <button key={st || "all"} onClick={() => setStatusFilter(st)}
            className={`min-h-9 rounded-lg px-4 text-xs font-semibold transition ${statusFilter === st ? "bg-[var(--clinical-panel)] text-white shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>
            {st ? st.replace("_", " ") : "All"}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <DataState loading={loading && events.length === 0} error={error} empty={!loading && filtered.length === 0}
          emptyTitle="No emergency events" emptyHint="Declare an emergency to drive the shelter/evacuate decision and the accountability headcount.">
          <div className="space-y-3">
            {filtered.map((r) => {
              const accounted = allAccounted(r);
              const unaccounted = r.headExpected > 0 && r.headAccounted < r.headExpected;
              return (
                <div key={r.id} className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: r.status !== "CLOSED" ? "var(--clinical-coral)" : "var(--clinical-line)" }}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <StatusPill status={r.status} />
                        <StatusPill status={r.decision === "SHELTER_IN_PLACE" ? "INFO" : "WARNING"}>{DECISION_LABEL[r.decision] ?? r.decision}</StatusPill>
                        {r.headExpected > 0 && (
                          <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.05em] text-white ${accounted ? "bg-[#7E9B6F]" : "bg-[#C0573F]"}`}>
                            <Users className="h-3 w-3" /> {r.headAccounted}/{r.headExpected} accounted
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-[var(--clinical-ink)]">{r.type}</p>
                      <p className="mt-0.5 line-clamp-2 text-sm text-[var(--clinical-muted)]">{r.description}</p>
                      {unaccounted && <p className="mt-1 text-[11px] font-semibold text-[var(--clinical-coral)]">Persons unaccounted for — search + notify responders now.</p>}
                      {r.agencies && <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Agencies: {r.agencies}</p>}
                      <p className="mt-1 text-[11px] text-[var(--clinical-muted)]"><Clock className="mr-1 inline h-3 w-3" />{fmt(r.occurredAt)} · declared by {r.raisedBy || "—"}{r.allClearAt ? ` · all-clear ${fmt(r.allClearAt)}` : ""}</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      {r.status === "OPEN" && <ClinicalButton variant="secondary" size="sm" disabled={busyId === r.id} onClick={() => void beginResponse(r)}>{busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Begin response</ClinicalButton>}
                      {r.status !== "CLOSED" && <ClinicalButton variant="accent" size="sm" disabled={busyId === r.id} onClick={() => void allClear(r)}>{busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} All clear</ClinicalButton>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </DataState>
      </div>

      {open && (
        <EventModal raisedBy={clinicianName}
          onClose={() => setOpen(false)}
          onSave={async (ev) => {
            const now = new Date().toISOString();
            await persist([{ ...ev, id: newId(), allClearAt: "", status: "OPEN", raisedBy: clinicianName, createdAt: now, updatedAt: now }, ...events]);
            setOpen(false);
            Swal.fire({ toast: true, position: "top-end", icon: "warning", title: "Emergency declared", showConfirmButton: false, timer: 1600 });
          }} />
      )}
    </ClinicalPage>
  );
}

function EventModal({ raisedBy, onClose, onSave }: {
  raisedBy: string; onClose: () => void;
  onSave: (r: Omit<EmEvent, "id" | "allClearAt" | "status" | "raisedBy" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  void raisedBy;
  const nowLocal = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [f, setF] = useState({ occurredAt: nowLocal(), type: TYPES[0], decision: "SHELTER_IN_PLACE" as string, description: "", headExpected: "", headAccounted: "", accountabilityNote: "", agencies: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.description.trim() && f.type && f.decision;

  const submit = async () => {
    if (!valid || saving) return; setSaving(true);
    try {
      await onSave({
        occurredAt: new Date(f.occurredAt).toISOString(), type: f.type, decision: f.decision, description: f.description.trim(),
        headExpected: Number(f.headExpected) || 0, headAccounted: Number(f.headAccounted) || 0,
        accountabilityNote: f.accountabilityNote.trim(), agencies: f.agencies.trim(),
      });
    } catch (err) { setSaving(false); Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" }); }
  };

  return (
    <ClinicalModal open onClose={onClose} title="Declare emergency" description="Raise the alarm and call emergency services first — then record the decision and accountability here." size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="danger" disabled={!valid || saving} onClick={() => void submit()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertOctagon className="h-4 w-4" />} Declare</ClinicalButton>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="em-when">Date / time</FieldLabel><input id="em-when" type="datetime-local" value={f.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} className={controlClass} /></div>
        <div><FieldLabel htmlFor="em-type" required>Emergency type</FieldLabel><select id="em-type" value={f.type} onChange={(e) => set("type", e.target.value)} className={controlClass}>{TYPES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="sm:col-span-2"><FieldLabel htmlFor="em-dec" required>Decision</FieldLabel>
          <select id="em-dec" value={f.decision} onChange={(e) => set("decision", e.target.value)} className={controlClass}>{DECISIONS.map((c) => <option key={c} value={c}>{DECISION_LABEL[c]}</option>)}</select>
        </div>
      </div>
      <div className="mt-4"><FieldLabel htmlFor="em-desc" required>Situation description</FieldLabel><textarea id="em-desc" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} className={controlClass} placeholder="What is happening, where, and areas affected." /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="em-exp">Persons to account for</FieldLabel><input id="em-exp" type="number" min={0} value={f.headExpected} onChange={(e) => set("headExpected", e.target.value)} className={controlClass} placeholder="Residents + staff + visitors" /></div>
        <div><FieldLabel htmlFor="em-acc">Persons accounted for</FieldLabel><input id="em-acc" type="number" min={0} value={f.headAccounted} onChange={(e) => set("headAccounted", e.target.value)} className={controlClass} placeholder="At the muster point" /></div>
      </div>
      <div className="mt-4"><FieldLabel htmlFor="em-note">Accountability note</FieldLabel><textarea id="em-note" rows={2} value={f.accountabilityNote} onChange={(e) => set("accountabilityNote", e.target.value)} className={controlClass} placeholder="Anyone unaccounted for, muster point, mobility-dependent residents moved." /></div>
      <div className="mt-4"><FieldLabel htmlFor="em-ag">External agencies notified</FieldLabel><input id="em-ag" value={f.agencies} onChange={(e) => set("agencies", e.target.value)} className={controlClass} placeholder="e.g. Fire dept, police, ambulance" /></div>
    </ClinicalModal>
  );
}
