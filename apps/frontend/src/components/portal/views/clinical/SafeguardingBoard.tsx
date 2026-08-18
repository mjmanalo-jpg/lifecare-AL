"use client";

/**
 * DT-007 Safeguarding — protection, reporting and escalation for suspected
 * abuse / neglect / exploitation.
 *
 * Shows the DT-007 protocol (trigger → pathway → documentation → escalation)
 * as a reference panel, then lets staff open and progress a confidential
 * safeguarding report. Migration-free: reports are a JSON array in the
 * app-setting `safeguarding_reports` (mirrors WoundCareBoard's storage pattern).
 */

import { useMemo, useState } from "react";
import { Plus, ShieldAlert, Lock, CheckCircle2, Clock, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { getProtocol } from "@/lib/lifecare/decisionTrees";
import ProtocolReference from "./ProtocolReference";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, StatCard, FieldLabel, controlClass, StatusPill } from "./clinical-ui";

type Row = Record<string, unknown>;
const KEY = "safeguarding_reports";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `sg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const CATEGORIES = ["Physical abuse", "Emotional / psychological", "Sexual abuse", "Neglect / acts of omission", "Financial exploitation", "Other"];
const SEVERITIES = ["Low", "Moderate", "High", "Critical"] as const;
const STATUSES = ["OPEN", "IN_PROGRESS", "CLOSED"] as const;
type Status = (typeof STATUSES)[number];
const NEXT: Record<Status, Status | null> = { OPEN: "IN_PROGRESS", IN_PROGRESS: "CLOSED", CLOSED: null };

interface Report {
  id: string; occurredAt: string; residentId: string; category: string; severity: string;
  description: string; immediateActions: string; reportedTo: string; authorityReferral: string;
  confidential: boolean; status: Status; raisedBy: string; createdAt: string; updatedAt: string;
}
const parse = (raw: string | null | undefined): Report[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string") : []; } catch { return []; } };

export default function SafeguardingBoard({ role = "NURSE" }: { role?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(role);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const reports = useMemo(() => parse(settingRows.find((r) => (r.key || r.id) === KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? `${s(r.name)}${r.room ? ` · Room ${s(r.room)}` : ""}` : ""; };

  const protocol = getProtocol("DT-007")!;
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = reports.filter((r) => !statusFilter || r.status === statusFilter);
  const stats = { open: reports.filter((r) => r.status === "OPEN").length, inProgress: reports.filter((r) => r.status === "IN_PROGRESS").length, closed: reports.filter((r) => r.status === "CLOSED").length };

  const persist = async (next: Report[]) => { await upsertRecord("app-settings", KEY, { key: KEY, value: JSON.stringify(next) }); await refetch(); };

  const advance = async (r: Report) => {
    const to = NEXT[r.status]; if (!to) return;
    setBusyId(r.id);
    try { await persist(reports.map((x) => (x.id === r.id ? { ...x, status: to, updatedAt: new Date().toISOString() } : x))); }
    finally { setBusyId(null); }
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Safeguarding"
        subtitle="Protect the resident first, then report. Follow the DT-007 protocol — do not investigate alone. Reports are confidential to the safeguarding lead."
        right={<ClinicalButton variant="accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New Report</ClinicalButton>}
      />

      <div className="mt-5"><ProtocolReference protocol={protocol} /></div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        <StatCard value={stats.open} label="Open" accent="coral" />
        <StatCard value={stats.inProgress} label="In Progress" accent="amber" />
        <StatCard value={stats.closed} label="Closed" accent="green" />
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
        <DataState loading={loading && reports.length === 0} error={error} empty={!loading && filtered.length === 0}
          emptyTitle="No safeguarding reports" emptyHint="Open a report when a concern is identified — the resident's safety comes first.">
          <div className="space-y-3">
            {filtered.map((r) => (
              <div key={r.id} className="rounded-2xl border p-4 sm:p-5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <StatusPill status={r.status} />
                      <StatusPill status={r.severity === "Critical" || r.severity === "High" ? "CRITICAL" : r.severity === "Moderate" ? "WARNING" : "INFO"}>{r.severity}</StatusPill>
                      {r.confidential && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-muted)]"><Lock className="h-3 w-3" /> Confidential</span>}
                    </div>
                    <p className="text-sm font-semibold text-[var(--clinical-ink)]">{r.category}{resName(r.residentId) ? <span className="font-normal text-[var(--clinical-muted)]"> · {resName(r.residentId)}</span> : null}</p>
                    <p className="mt-0.5 line-clamp-2 text-sm text-[var(--clinical-muted)]">{r.description}</p>
                    {r.reportedTo && <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Reported to: {r.reportedTo}{r.authorityReferral ? ` · Authority: ${r.authorityReferral}` : ""}</p>}
                    <p className="mt-1 text-[11px] text-[var(--clinical-muted)]"><Clock className="mr-1 inline h-3 w-3" />{fmt(r.occurredAt)} · raised by {r.raisedBy || "—"}</p>
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
        <ReportModal residents={residents}
          onClose={() => setOpen(false)}
          onSave={async (rep) => {
            const now = new Date().toISOString();
            await persist([{ ...rep, id: newId(), status: "OPEN", raisedBy: clinicianName, createdAt: now, updatedAt: now }, ...reports]);
            setOpen(false);
            Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Safeguarding report opened", showConfirmButton: false, timer: 1600 });
          }} />
      )}
    </ClinicalPage>
  );
}

function ReportModal({ residents, onClose, onSave }: {
  residents: Row[]; onClose: () => void;
  onSave: (r: Omit<Report, "id" | "status" | "raisedBy" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  const nowLocal = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  const [f, setF] = useState({ occurredAt: nowLocal(), residentId: "", category: CATEGORIES[0], severity: "Moderate", description: "", immediateActions: "", reportedTo: "", authorityReferral: "", confidential: true });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.description.trim() && f.reportedTo.trim();

  const submit = async () => {
    if (!valid || saving) return; setSaving(true);
    try { await onSave({ occurredAt: new Date(f.occurredAt).toISOString(), residentId: f.residentId, category: f.category, severity: f.severity, description: f.description.trim(), immediateActions: f.immediateActions.trim(), reportedTo: f.reportedTo.trim(), authorityReferral: f.authorityReferral.trim(), confidential: f.confidential }); }
    catch (err) { setSaving(false); Swal.fire({ title: "Failed", text: err instanceof Error ? err.message : "Could not save.", icon: "error" }); }
  };

  return (
    <ClinicalModal open onClose={onClose} title="New safeguarding report" description="Record facts only. Protect the resident, then report to the safeguarding lead." size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" disabled={!valid || saving} onClick={() => void submit()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Open report</ClinicalButton>
      </>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="sg-when">Date / time</FieldLabel><input id="sg-when" type="datetime-local" value={f.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} className={controlClass} /></div>
        <div><FieldLabel htmlFor="sg-res">Resident (if applicable)</FieldLabel>
          <select id="sg-res" value={f.residentId} onChange={(e) => set("residentId", e.target.value)} className={controlClass}>
            <option value="">— Not resident-specific —</option>
            {residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)}{r.room ? ` · Room ${s(r.room)}` : ""}</option>)}
          </select>
        </div>
        <div><FieldLabel htmlFor="sg-cat">Category</FieldLabel><select id="sg-cat" value={f.category} onChange={(e) => set("category", e.target.value)} className={controlClass}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><FieldLabel htmlFor="sg-sev">Severity</FieldLabel><select id="sg-sev" value={f.severity} onChange={(e) => set("severity", e.target.value)} className={controlClass}>{SEVERITIES.map((c) => <option key={c}>{c}</option>)}</select></div>
      </div>
      <div className="mt-4"><FieldLabel htmlFor="sg-desc" required>What was seen / heard (factual, verbatim disclosure)</FieldLabel><textarea id="sg-desc" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} className={controlClass} placeholder="Describe the concern in factual terms; quote any disclosure exactly." /></div>
      <div className="mt-4"><FieldLabel htmlFor="sg-act">Immediate protection actions taken</FieldLabel><textarea id="sg-act" rows={2} value={f.immediateActions} onChange={(e) => set("immediateActions", e.target.value)} className={controlClass} placeholder="e.g. Removed contact with alleged source, attended medical needs, preserved evidence." /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div><FieldLabel htmlFor="sg-to" required>Reported to (safeguarding lead / Facility Admin)</FieldLabel><input id="sg-to" value={f.reportedTo} onChange={(e) => set("reportedTo", e.target.value)} className={controlClass} placeholder="Name / role" /></div>
        <div><FieldLabel htmlFor="sg-auth">External authority referral</FieldLabel><input id="sg-auth" value={f.authorityReferral} onChange={(e) => set("authorityReferral", e.target.value)} className={controlClass} placeholder="Authority + reference (if a crime is suspected)" /></div>
      </div>
      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--clinical-ink)]"><input type="checkbox" checked={f.confidential} onChange={(e) => set("confidential", e.target.checked)} className="h-4 w-4 rounded" /> Mark confidential (restricted to the safeguarding lead)</label>
    </ClinicalModal>
  );
}
