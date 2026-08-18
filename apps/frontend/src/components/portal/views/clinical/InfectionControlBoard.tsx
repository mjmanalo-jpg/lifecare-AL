"use client";

/**
 * DT-008 Infection / Outbreak — precautions, isolation, notification and
 * outbreak response.
 *
 * Shows the DT-008 protocol as a reference panel, then lets staff log an
 * infection event with a precaution type and an outbreak-declaration flag,
 * and progress it OPEN → IN_PROGRESS → CLOSED. Migration-free: events are a
 * JSON array in the app-setting `infection_events`.
 */

import { useMemo, useState } from "react";
import { Plus, Biohazard, Siren, CheckCircle2, Clock, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { getProtocol } from "@/lib/lifecare/decisionTrees";
import ProtocolReference from "./ProtocolReference";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, StatCard, FieldLabel, controlClass, StatusPill } from "./clinical-ui";

type Row = Record<string, unknown>;
const KEY = "infection_events";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `inf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const PRECAUTIONS = ["Standard", "Contact", "Droplet", "Airborne", "Contact + Droplet", "Enteric (C. diff / norovirus)"];
const SEVERITIES = ["Low", "Moderate", "High", "Critical"] as const;
const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
type Status = (typeof STATUSES)[number];
const NEXT: Record<Status, Status | null> = { OPEN: "IN_PROGRESS", IN_PROGRESS: "CLOSED", CLOSED: null };

interface InfEvent {
  id: string; onsetAt: string; residentId: string; organism: string; symptoms: string;
  precaution: string; severity: string; outbreak: boolean; notifiedTo: string; actions: string;
  status: Status; raisedBy: string; createdAt: string; updatedAt: string;
}
const parse = (raw: string | null | undefined): InfEvent[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };

export default function InfectionControlBoard({ role = "NURSE" }: { role?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(role);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const events = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? `${s(r.name)}${r.room ? ` · Room ${s(r.room)}` : ""}` : ""; };

  const protocol = getProtocol("DT-008")!;
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = events.filter((r) => !statusFilter || r.status === statusFilter);
  const active = events.filter((r) => r.status !== "CLOSED");
  const stats = { active: active.length, outbreaks: active.filter((r) => r.outbreak).length, closed: events.filter((r) => r.status === "CLOSED").length };

  const persist = async (next: InfEvent[]) => { await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) }); await refetch(); };

  const advance = async (r: InfEvent) => {
    const to = NEXT[r.status]; if (!to) return;
    setBusyId(r.id);
    try { await persist(events.map((x) => (x.id === r.id ? { ...x, status: to, updatedAt: new Date().toISOString() } : x))); }
    finally { setBusyId(null); }
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Infection & Outbreak Control"
        subtitle="Apply precautions early, notify the IPC lead, and declare an outbreak when the threshold is met. Follow the DT-008 protocol."
        right={<ClinicalButton variant="accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Log Infection</ClinicalButton>}
      />

      <div className="mt-5"><ProtocolReference protocol={protocol} /></div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard value={stats.active} label="Active cases" accent="amber" />
        <StatCard value={stats.outbreaks} label="Declared outbreaks" accent="coral" />
        <StatCard value={stats.closed} label="Resolved" accent="green" />
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
          emptyTitle="No infection events" emptyHint="Log a case as soon as infection signs appear so precautions and notifications are tracked.">
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.id} className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: r.outbreak ? "var(--clinical-coral)" : "var(--clinical-line)" }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusPill status={r.status} />
                      <StatusPill status="INFO">{r.precaution}</StatusPill>
                      {r.outbreak && <StatusPill status="EMERGENCY"><span className="inline-flex items-center gap-1"><Siren className="h-3 w-3" /> Outbreak</span></StatusPill>}
                    </div>
                    <p className="text-sm font-semibold text-[var(--clinical-ink)]">{r.organism || "Suspected infection"}{resName(r.residentId) ? <span className="font-normal text-[var(--clinical-muted)]"> · {resName(r.residentId)}</span> : null}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-[var(--clinical-muted)]">{r.symptoms}</p>
                    {r.notifiedTo && <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Notified: {r.notifiedTo}</p>}
                    <p className="mt-1 text-[11px] text-[var(--clinical-muted)]"><Clock className="mr-1 inline h-3 w-3" />Onset {fmt(r.onsetAt)} · logged by {r.raisedBy || "—"}</p>
                  </div>
                  {NEXT[r.status] && (
                    <ClinicalButton variant="secondary" size="sm" disabled={busyId === r.id} onClick={() => void advance(r)}>
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark {NEXT[r.status]!.replace("_", " ")}
                    </ClinicalButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DataState>
      </div>

      {open && (
        <EventModal residents={residents}
          onClose={() => setOpen(false)}
          onSave={async (ev) => {
            const now = new Date().toISOString();
            await persist([{ ...ev, id: newId(), status: "OPEN", raisedBy: clinicianName, createdAt: now, updatedAt: now }, ...events]);
            setOpen(false);
            Swal.fire({ toast: true, position: "top-end", icon: "success", title: ev.outbreak ? "Outbreak declared & logged" : "Infection event logged", showConfirmButton: false, timer: 1600 });
          }} />
      )}
    </ClinicalPage>
  );
}

function EventModal({ residents, onClose, onSave }: {
  residents: Row[]; onClose: () => void;
  onSave: (r: Omit<InfEvent, "id" | "status" | "raisedBy" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  const nowLocal = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [f, setF] = useState({ onsetAt: nowLocal(), residentId: "", organism: "", symptoms: "", precaution: PRECAUTIONS[1], severity: "Moderate", outbreak: false, notifiedTo: "", actions: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.symptoms.trim() && f.precaution;

  const submit = async () => {
    if (!valid || saving) return; setSaving(true);
    try { await onSave({ onsetAt: new Date(f.onsetAt).toISOString(), residentId: f.residentId, organism: f.organism.trim(), symptoms: f.symptoms.trim(), precaution: f.precaution, severity: f.severity, outbreak: f.outbreak, notifiedTo: f.notifiedTo.trim(), actions: f.actions.trim() }); }
    catch (err) { setSaving(false); Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" }); }
  };

  return (
    <ClinicalModal open onClose={onClose} title="Log infection event" description="Apply precautions immediately and notify the infection-control lead." size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" disabled={!valid || saving} onClick={() => void submit()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Biohazard className="h-4 w-4" />} Save event</ClinicalButton>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="if-when">Onset date / time</FieldLabel><input id="if-when" type="datetime-local" value={f.onsetAt} onChange={(e) => set("onsetAt", e.target.value)} className={controlClass} /></div>
        <div><FieldLabel htmlFor="if-res">Resident (if applicable)</FieldLabel>
          <select id="if-res" value={f.residentId} onChange={(e) => set("residentId", e.target.value)} className={controlClass}>
            <option value="">— Not resident-specific —</option>
            {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)}{r.room ? ` · Room ${s(r.room)}` : ""}</option>)}
          </select>
        </div>
        <div><FieldLabel htmlFor="if-org">Organism / infection</FieldLabel><input id="if-org" value={f.organism} onChange={(e) => set("organism", e.target.value)} className={controlClass} placeholder="e.g. Influenza A, Norovirus, UTI" /></div>
        <div><FieldLabel htmlFor="if-sev">Severity</FieldLabel><select id="if-sev" value={f.severity} onChange={(e) => set("severity", e.target.value)} className={controlClass}>{SEVERITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><FieldLabel htmlFor="if-prec" required>Precaution type</FieldLabel><select id="if-prec" value={f.precaution} onChange={(e) => set("precaution", e.target.value)} className={controlClass}>{PRECAUTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><FieldLabel htmlFor="if-not">Notified (IPC lead / physician)</FieldLabel><input id="if-not" value={f.notifiedTo} onChange={(e) => set("notifiedTo", e.target.value)} className={controlClass} placeholder="Name / role" /></div>
      </div>
      <div className="mt-4"><FieldLabel htmlFor="if-sym" required>Symptoms / clinical findings</FieldLabel><textarea id="if-sym" rows={2} value={f.symptoms} onChange={(e) => set("symptoms", e.target.value)} className={controlClass} placeholder="e.g. Fever 38.6, productive cough, D&V x3." /></div>
      <div className="mt-4"><FieldLabel htmlFor="if-act">Control actions taken</FieldLabel><textarea id="if-act" rows={2} value={f.actions} onChange={(e) => set("actions", e.target.value)} className={controlClass} placeholder="e.g. Single-room isolation, PPE, enhanced cleaning, specimens sent." /></div>
      <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-[var(--clinical-coral)]"><input type="checkbox" checked={f.outbreak} onChange={(e) => set("outbreak", e.target.checked)} className="h-4 w-4 rounded" /> Declare outbreak (threshold met — notify public-health authority)</label>
    </ClinicalModal>
  );
}
