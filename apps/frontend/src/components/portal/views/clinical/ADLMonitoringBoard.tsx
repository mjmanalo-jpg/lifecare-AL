"use client";

/**
 * ADL Monitoring — track Activities of Daily Living per resident, shift, and
 * domain (matches the LifeCare screens). Ten domains, each logged per shift with
 * a Level of Assistance + Change-from-Baseline, safety flags, and staff notes.
 * Baselines are derived from the resident's latest pre-admission assessment
 * (Section D + mobility/continence/cognition). Migration-free: entries are a JSON
 * array in the app-setting `adl_logs`; an optional follow-up Task is created when
 * "Create Task" is checked.
 */

import { useMemo, useState } from "react";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Activity, CheckCircle2,
  Bath, Shirt, Scissors, Toilet, ArrowLeftRight, Utensils, Footprints, Droplets, Brain, Moon,
  type LucideIcon,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord, createRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { PREADMISSION_KEY, parseAssessments, continenceScore, newId, type AdlItem } from "@/lib/preadmissionAssessment";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, FieldLabel, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ADL_KEY = "adl_logs";
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const today = () => new Date().toISOString().split("T")[0];
const shiftNow = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? "AM" : h >= 14 && h < 22 ? "PM" : "NOC"; };

const DOMAINS: { key: string; label: string; icon: LucideIcon; adl: AdlItem | null }[] = [
  { key: "bathing", label: "Bathing", icon: Bath, adl: "bathing" as AdlItem | null },
  { key: "dressing", label: "Dressing", icon: Shirt, adl: "dressing" as AdlItem | null },
  { key: "grooming", label: "Grooming", icon: Scissors, adl: "grooming" as AdlItem | null },
  { key: "toileting", label: "Toileting", icon: Toilet, adl: "toileting" as AdlItem | null },
  { key: "transfers", label: "Transfers", icon: ArrowLeftRight, adl: "transfers" as AdlItem | null },
  { key: "feeding", label: "Feeding", icon: Utensils, adl: "feeding" as AdlItem | null },
  { key: "mobility", label: "Mobility", icon: Footprints, adl: null },
  { key: "continence", label: "Continence", icon: Droplets, adl: null },
  { key: "cognition", label: "Cognition/Behavior", icon: Brain, adl: null },
  { key: "sleep", label: "Sleep/Rest", icon: Moon, adl: null },
];
type DomainKey = (typeof DOMAINS)[number]["key"];

const SHIFTS = [{ v: "AM", label: "AM Shift (6am–2pm)" }, { v: "PM", label: "PM Shift (2pm–10pm)" }, { v: "NOC", label: "Noc Shift (10pm–6am)" }];
const ASSIST = ["Independent", "Supervision/Cueing", "One-Person Assist", "Two-Person Assist", "Full Assist", "Refused"];

// Change-from-baseline → the clinical-editorial accent (green=improved, teal=steady,
// amber=declined, coral=significant). One accent var drives the dot, chip, and toggle.
type ChangeAccent = "green" | "teal" | "amber" | "coral";
const ACCENT_VAR: Record<ChangeAccent, string> = { green: "var(--clinical-green)", teal: "var(--clinical-panel)", amber: "var(--clinical-amber)", coral: "var(--clinical-coral)" };
const CHANGES: { v: string; icon: typeof TrendingUp; accent: ChangeAccent }[] = [
  { v: "Improved", icon: TrendingUp, accent: "green" },
  { v: "Same as Baseline", icon: Minus, accent: "teal" },
  { v: "Declined", icon: TrendingDown, accent: "amber" },
  { v: "Significant Decline", icon: AlertTriangle, accent: "coral" },
];
const FLAGS = [{ k: "safety", label: "Safety Concern" }, { k: "followUp", label: "Follow-up Needed" }, { k: "createTask", label: "Create Task" }, { k: "escalate", label: "Escalate" }] as const;
type FlagKey = (typeof FLAGS)[number]["k"];

interface AdlEntry {
  id: string; residentId: string; date: string; shift: string; domain: DomainKey;
  assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes?: string;
  baseline?: string; by?: string; at: string;
}
const parseLogs = (raw: string | null | undefined): AdlEntry[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string") : []; } catch { return []; }
};

type BaselineLabel = "Independent" | "Needs Assistance" | "Dependent";
type Baseline = { label: BaselineLabel; score: number } | null;
const BL = (label: BaselineLabel): Baseline => ({ label, score: label === "Independent" ? 2 : label === "Needs Assistance" ? 1 : 0 });

// Theme-safe change chip: ink label + a coloured dot (matches WoundCare's status chip).
function ChangeChip({ change }: { change: string }) {
  const c = CHANGES.find((x) => x.v === change);
  if (!c) return null;
  const Icon = c.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <Icon className="h-3 w-3" style={{ color: ACCENT_VAR[c.accent] }} />{change}
    </span>
  );
}

export default function ADLMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const logs = useMemo(() => parseLogs(settingRows.find((r) => (r.key || r.id) === ADL_KEY)?.value), [settingRows]);
  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === PREADMISSION_KEY)?.value), [settingRows]);

  const [resId, setResId] = useState("");
  const [date, setDate] = useState(today());
  const [shift, setShift] = useState(shiftNow());
  const [view, setView] = useState<"log" | "alerts">("log");
  const [logDomain, setLogDomain] = useState<DomainKey | null>(null);

  const resident = residents.find((r: Row) => s(r.id) === resId) || null;

  // Baseline per domain from the resident's latest pre-admission assessment
  // (matched by name — assessments are name-keyed).
  const baselineFor = (domain: DomainKey): Baseline => {
    if (!resident) return null;
    const a = assessments.filter((x) => (x.residentName || "").trim().toLowerCase() === s(resident.name).trim().toLowerCase())
      .sort((p, q) => (q.updatedAt || "").localeCompare(p.updatedAt || ""))[0];
    if (!a) return null;
    const d = DOMAINS.find((x) => x.key === domain)!;
    if (d.adl) { const lv = a.adl?.[d.adl]; return lv === "INDEPENDENT" ? BL("Independent") : lv === "ASSISTANCE" ? BL("Needs Assistance") : lv === "DEPENDENT" ? BL("Dependent") : null; }
    if (domain === "mobility") return a.walking ? (a.walking === "INDEPENDENT" ? BL("Independent") : a.walking === "BEDBOUND" || a.walking === "WHEELCHAIR" ? BL("Dependent") : BL("Needs Assistance")) : null;
    if (domain === "continence") { if (!a.urinary && !a.bowel) return null; const c = continenceScore(a.urinary, a.bowel); return c === 0 ? BL("Independent") : c >= 3 ? BL("Dependent") : BL("Needs Assistance"); }
    if (domain === "cognition") return a.memory ? (a.memory === "NORMAL" ? BL("Independent") : a.memory === "MILD" ? BL("Needs Assistance") : BL("Dependent")) : null;
    return null;
  };

  const shiftLogs = useMemo(() => logs.filter((l) => l.residentId === resId && l.date === date && l.shift === shift), [logs, resId, date, shift]);
  const loggedByDomain = useMemo(() => new Map(shiftLogs.map((l) => [l.domain, l])), [shiftLogs]);
  const declines = useMemo(() => logs.filter((l) => (!resId || l.residentId === resId) && (l.change === "Declined" || l.change === "Significant Decline")).sort((a, b) => (b.at || "").localeCompare(a.at || "")), [logs, resId]);

  const persist = async (next: AdlEntry[]) => { await upsertRecord("app-settings", ADL_KEY, { key: ADL_KEY, value: JSON.stringify(next) }); await refetch(); };

  const saveEntry = async (domain: DomainKey, payload: { assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes: string }) => {
    const now = new Date().toISOString();
    const baseline = baselineFor(domain);
    const rec: AdlEntry = { id: newId("adl"), residentId: resId, date, shift, domain, assistance: payload.assistance, change: payload.change, flags: payload.flags, notes: payload.notes || undefined, baseline: baseline?.label, by: clinicianName, at: now };
    // Replace any existing entry for this domain+shift (re-log), else prepend.
    const rest = logs.filter((l) => !(l.residentId === resId && l.date === date && l.shift === shift && l.domain === domain));
    await persist([rec, ...rest]);
    if (payload.flags.createTask) {
      const label = DOMAINS.find((d) => d.key === domain)!.label;
      await createRecord("tasks", { residentId: resId, title: `ADL follow-up — ${label}`, description: payload.notes || `${label}: ${payload.assistance} (${payload.change}).`, status: "PENDING", priority: payload.change === "Significant Decline" ? "HIGH" : "MEDIUM", category: "Personal Care" }).catch(() => null);
    }
    setLogDomain(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "ADL entry logged", showConfirmButton: false, timer: 1500 });
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        subtitle="Track Activities of Daily Living per resident, shift, and domain"
      />

      {/* Controls */}
      <div className="mt-5 grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-4 items-end mb-5">
        <div><FieldLabel htmlFor="adl-res">Resident</FieldLabel>
          <select id="adl-res" value={resId} onChange={(e) => setResId(e.target.value)} className={controlClass}>
            <option value="">Select resident</option>
            {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}
          </select>
        </div>
        <div><FieldLabel htmlFor="adl-date">Date</FieldLabel>
          <input id="adl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={controlClass} />
        </div>
        <div><FieldLabel htmlFor="adl-shift">Shift</FieldLabel>
          <select id="adl-shift" value={shift} onChange={(e) => setShift(e.target.value)} className={controlClass}>
            {SHIFTS.map((sh) => <option key={sh.v} value={sh.v}>{sh.label}</option>)}
          </select>
        </div>
        <div className="text-sm text-[var(--clinical-muted)] sm:text-right sm:pb-2.5">{resId ? `${loggedByDomain.size}/10 domains logged this shift` : ""}</div>
      </div>

      {!resId ? (
        <div className="@container">
          <div className="mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-[var(--clinical-panel)]" />
            <div>
              <p className="text-base font-bold text-[var(--clinical-ink)]">Select a resident to begin ADL monitoring</p>
              <p className="text-sm text-[var(--clinical-muted)]">Tap a resident to start tracking their ADLs</p>
            </div>
          </div>
          {residents.length === 0 ? (
            <p className="text-center text-sm text-[var(--clinical-muted)] py-8">No residents found.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 @lg:grid-cols-3 @3xl:grid-cols-4 @5xl:grid-cols-5">
              {residents.map((r: Row, i: number) => (
                <button key={s(r.id)} onClick={() => setResId(s(r.id))}
                  className="group flex flex-col items-center gap-2.5 rounded-xl border p-4 text-center shadow-sm transition hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300"
                  style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)", animationDelay: `${i * 40}ms`, animationFillMode: "backwards" }}>
                  <span className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-panel)" }}>{initials(s(r.name))}</span>
                  <span className="block w-full min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{s(r.name)}</span>
                    <span className="block text-xs text-[var(--clinical-muted)]">Room {s(r.room)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="inline-flex gap-1 rounded-xl p-1 mb-4" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
            {([["log", "Shift Log"], ["alerts", "Decline Alerts"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} aria-pressed={view === v} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${view === v ? "bg-[var(--clinical-surface)] shadow-sm text-[var(--clinical-ink)]" : "text-[var(--clinical-muted)]"}`}>
                {label}{v === "alerts" && declines.length ? ` (${declines.length})` : ""}
              </button>
            ))}
          </div>

          {view === "log" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {DOMAINS.map((d) => {
                const bl = baselineFor(d.key);
                const logged = loggedByDomain.get(d.key);
                const Icon = d.icon;
                return (
                  <button key={d.key} onClick={() => setLogDomain(d.key)} aria-label={`Log ${d.label}`} className="text-left rounded-xl border p-4 transition relative hover:shadow-sm" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                    <div className="flex items-start justify-between">
                      <Icon className="h-6 w-6" style={{ color: "var(--clinical-panel)" }} />
                      <span className="w-6 h-6 rounded-full border flex items-center justify-center text-[var(--clinical-muted)] text-lg leading-none" style={{ borderColor: "var(--clinical-line-strong)" }}>+</span>
                    </div>
                    <p className="font-bold text-[var(--clinical-ink)] mt-3">{d.label}</p>
                    {bl ? <p className="text-[11px] text-[var(--clinical-muted)] mt-0.5">Baseline: {bl.label}</p> : <p className="text-[11px] text-[var(--clinical-muted)] opacity-70 mt-0.5">No baseline</p>}
                    {logged && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface-2)" }}>{logged.assistance}</span>
                        <ChangeChip change={logged.change} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-2">
              {declines.length === 0 ? (
                <div className="rounded-xl border p-8 text-center text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>No decline alerts{resId ? " for this resident" : ""}.</div>
              ) : declines.map((l) => {
                const d = DOMAINS.find((x) => x.key === l.domain);
                const rn = residents.find((r: Row) => s(r.id) === l.residentId);
                const sig = l.change === "Significant Decline";
                const accent = sig ? "var(--clinical-coral)" : "var(--clinical-amber)";
                const DIcon = d?.icon;
                return (
                  <div key={l.id} className="rounded-xl border p-3 flex items-start gap-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)", borderLeftWidth: 3, borderLeftColor: accent }}>
                    {DIcon && <DIcon className="h-5 w-5 shrink-0" style={{ color: "var(--clinical-panel)" }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--clinical-ink)]">{d?.label} — {sig ? "Significant Decline" : "Declined"} <span className="font-normal text-[var(--clinical-muted)]">· {l.assistance}</span></p>
                      <p className="text-xs text-[var(--clinical-muted)]">{s(rn?.name) || "Resident"} · {l.date} · {l.shift} shift{l.baseline ? ` · baseline ${l.baseline}` : ""}</p>
                      {l.notes && <p className="text-xs text-[var(--clinical-ink-soft)] mt-1">{l.notes}</p>}
                    </div>
                    {sig ? <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: accent }} /> : <TrendingDown className="w-4 h-4 shrink-0" style={{ color: accent }} />}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {logDomain && resident && (
        <LogModal
          domain={DOMAINS.find((d) => d.key === logDomain)!}
          resident={resident}
          baseline={baselineFor(logDomain)}
          existing={loggedByDomain.get(logDomain)}
          onClose={() => setLogDomain(null)}
          onSave={(p) => saveEntry(logDomain, p)}
        />
      )}
    </ClinicalPage>
  );
}

function LogModal({ domain, resident, baseline, existing, onClose, onSave }: {
  domain: (typeof DOMAINS)[number]; resident: Row; baseline: Baseline; existing?: AdlEntry;
  onClose: () => void; onSave: (p: { assistance: string; change: string; flags: Partial<Record<FlagKey, boolean>>; notes: string }) => Promise<void>;
}) {
  const [assistance, setAssistance] = useState(existing?.assistance || "");
  const [change, setChange] = useState(existing?.change || "Same as Baseline");
  const [flags, setFlags] = useState<Partial<Record<FlagKey, boolean>>>(existing?.flags || {});
  const [notes, setNotes] = useState(existing?.notes || "");
  const [saving, setSaving] = useState(false);
  const toggle = (k: FlagKey) => setFlags((p) => ({ ...p, [k]: !p[k] }));

  const submit = async () => {
    if (!assistance) { Swal.fire({ title: "Level of Assistance required", icon: "warning" }); return; }
    setSaving(true);
    try { await onSave({ assistance, change, flags, notes }); } finally { setSaving(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title={`Log ${domain.label}`}
      description={s(resident.name)}
      size="md"
      footer={
        <ClinicalButton variant="accent" onClick={submit} disabled={saving || !assistance} className="w-full sm:w-auto">
          <CheckCircle2 className="w-4 h-4" /> {saving ? "Saving…" : "Log ADL Entry"}
        </ClinicalButton>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border px-3 py-2 text-sm font-medium text-[var(--clinical-ink)]" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
          Current Baseline: {baseline ? `${baseline.label} (Score: ${baseline.score}/2)` : "Not set"}
        </div>

        <div>
          <FieldLabel required>Level of Assistance</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {ASSIST.map((a) => { const on = assistance === a; return (
              <button key={a} type="button" onClick={() => setAssistance(a)} aria-pressed={on} className="px-3 py-2.5 rounded-lg border text-sm font-medium transition" style={on ? { backgroundColor: "var(--clinical-panel)", color: "#fff", borderColor: "var(--clinical-panel)" } : { backgroundColor: "var(--clinical-surface)", color: "var(--clinical-ink-soft)", borderColor: "var(--clinical-line-strong)" }}>{a}</button>
            ); })}
          </div>
        </div>

        <div>
          <FieldLabel>Change from Baseline</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {CHANGES.map((c) => { const on = change === c.v; const color = ACCENT_VAR[c.accent]; const Icon = c.icon; return (
              <button key={c.v} type="button" onClick={() => setChange(c.v)} aria-pressed={on} className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-lg border text-sm font-medium transition" style={on ? { backgroundColor: color, color: "#fff", borderColor: color } : { backgroundColor: "var(--clinical-surface)", color: "var(--clinical-ink-soft)", borderColor: "var(--clinical-line-strong)" }}><Icon className="w-4 h-4" style={on ? undefined : { color }} />{c.v}</button>
            ); })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {FLAGS.map((fl) => (
            <button key={fl.k} type="button" onClick={() => toggle(fl.k)} aria-pressed={!!flags[fl.k]} className="flex items-center gap-2 text-sm text-[var(--clinical-ink-soft)]">
              <span className="w-9 h-5 rounded-full transition relative" style={{ backgroundColor: flags[fl.k] ? "var(--clinical-panel)" : "var(--clinical-line-strong)" }}><span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left: flags[fl.k] ? "18px" : "2px" }} /></span>
              {fl.label}
            </button>
          ))}
        </div>

        <div>
          <FieldLabel htmlFor="adl-notes">Staff Notes</FieldLabel>
          <textarea id="adl-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, interventions, resident response…" className={controlClass} />
        </div>
      </div>
    </ClinicalModal>
  );
}
