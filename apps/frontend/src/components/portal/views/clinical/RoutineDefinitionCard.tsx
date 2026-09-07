"use client";

/**
 * Editable per-event card for the nurse Draft→Review→Approve routine board
 * (SLMS v4.2 sub-project #3). Renders one RoutineEventDefinition row in the
 * manual-form shape (Time·Activity·Assistance·Assisted-By) with provenance
 * badges + inline nurse edits. Every field edit is a simple
 * updateRecord("routine-definitions", id, {…}) while the row is DRAFT/RETURNED
 * (Rule 14 — unapproved rows are freely mutable). Blocking (Rule 9/11): a row
 * with a truthy blockReason shows a red banner and is excluded from approvable.
 */

import { useState } from "react";
import { AlertTriangle, Brain, Paperclip, Loader2 } from "lucide-react";
import { updateRecord } from "@/lib/api";
import { ASSISTANCE, ASSISTANCE_DISPLAY, ROLE, ROLE_ABBR, type Assistance, type Role } from "@/lib/lifecare/assistance";
import { to12h } from "@/lib/lifecare/careTask";
import { PRIORITY } from "@/lib/lifecare/vocab";
import { StatusPill, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

/** A definition row is blocked when it needs an order it doesn't have, or the
 *  engine flagged an unresolved assistance conflict. Kept here so the board and
 *  the card agree on the exact predicate (drives the disabled Approve button). */
export function blockReasonFor(d: Row): string {
  // Order gating disabled — a missing order no longer blocks. Only a real engine
  // blockReason (e.g. an unresolved staffing conflict) keeps an event out of approval.
  return s(d.blockReason);
}

/** schedule json → a one-line human summary for the Time/Window column. */
export function scheduleSummary(sched: any, freq: string): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!sched || typeof sched !== "object") return s(freq) || "—";
  if (Array.isArray(sched.times) && sched.times.length) return sched.times.map((t: string) => to12h(String(t))).join(", ");
  if (sched.window) { const [a, b] = String(sched.window).split("-"); return b ? `${to12h(a)}–${to12h(b)}` : to12h(a); }
  if (sched.intervalHours) return `every ${sched.intervalHours}h${sched.wakeStart != null ? " (while awake)" : ""}`;
  if (sched.perShift) return `${sched.perShift}× / shift`;
  if (sched.trigger) return `PRN: ${sched.trigger}`;
  return s(freq) || "—";
}

const parseSchedule = (v: unknown): Record<string, any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (v && typeof v === "object") return v as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { const p = JSON.parse(s(v) || "{}"); return p && typeof p === "object" ? p : {}; } catch { return {}; }
};
const dateVal = (v: unknown): string => { const t = s(v); return t ? t.slice(0, 10) : ""; };

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "memory" | "order" }) {
  const cls =
    tone === "memory" ? "border-[var(--clinical-coral)] text-[var(--clinical-coral)] bg-[color-mix(in_srgb,var(--clinical-coral)_10%,transparent)]"
    : tone === "order" ? "border-[var(--clinical-green)] text-[var(--clinical-green)] bg-[color-mix(in_srgb,var(--clinical-green)_12%,transparent)]"
    : "border-[var(--clinical-line-strong)] text-[var(--clinical-muted)] bg-[var(--clinical-surface-2)]";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">{label}</span>
      {children}
    </label>
  );
}

export default function RoutineDefinitionCard({ def, onChanged, readOnly = false }: { def: Row; onChanged: () => void; readOnly?: boolean }) {
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const id = s(def.id);
  const sched = parseSchedule(def.schedule);
  const block = blockReasonFor(def);
  const assist = (s(def.assistanceLevel) || "Setup/Cueing") as Assistance;
  const role = (s(def.responsibleRole).replace(/_/g, " ") || "Caregiver") as Role;

  // Every edit routes through this: patch the row, refetch. On assistance/role
  // changes the caller passes a revisionReason so the override is captured.
  const patch = async (body: Record<string, unknown>) => {
    if (readOnly || saving) return;
    setSaving(true);
    try { await updateRecord("routine-definitions", id, body); onChanged(); }
    finally { setSaving(false); }
  };

  const changeAssistance = async (next: string) => {
    if (next === assist) return;
    const reason = window.prompt(`Override reason for changing assistance to "${ASSISTANCE_DISPLAY[next as Assistance] ?? next}":`, s(def.revisionReason));
    if (reason == null) return; // cancelled
    await patch({ assistanceLevel: next, revisionReason: reason || `Assistance overridden to ${next}` });
  };

  const patchSchedule = (partial: Record<string, unknown>) => patch({ schedule: { ...sched, ...partial } });

  return (
    <div className="rounded-lg border" style={{ borderColor: block ? "var(--clinical-coral)" : "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
      {block && (
        <div className="flex items-start gap-2 rounded-t-lg px-3 py-2 text-[11px] font-semibold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Blocked: {block}
        </div>
      )}
      {/* Manual-form row: Time/Window | Activity | Assistance | Assisted By | criticality */}
      <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-[9rem_1fr_auto_auto_auto] sm:items-center">
        <div className="text-xs font-semibold text-[var(--clinical-ink)]">{scheduleSummary(sched, s(def.frequencyMethod))}</div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[var(--clinical-ink)]">{s(def.name) || "Untitled event"}</p>
          {s(def.instructions) && <p className="mt-0.5 line-clamp-2 text-[11px] text-[var(--clinical-muted)]">{s(def.instructions)}</p>}
        </div>
        <div className="text-xs text-[var(--clinical-ink)]" title={assist}>{ASSISTANCE_DISPLAY[assist] ?? assist}</div>
        <div className="text-xs font-semibold text-[var(--clinical-panel)]" title={role}>{ROLE_ABBR[role] ?? "CGs"}</div>
        <StatusPill status={s(def.criticality) || "Routine"} />
      </div>

      {/* provenance + staffing chips */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">
        {s(def.sourceLocBundleId) && <Chip>{s(def.sourceLocBundleId)}</Chip>}
        {s(def.sourceAsDomain) && <Chip>{s(def.sourceAsDomain)}{def.asScore != null ? ` · ${def.asScore}` : ""}</Chip>}
        {s(def.conditionBundleId) && <Chip>{s(def.conditionBundleId)}</Chip>}
        {s(def.memoryPathwayId) && <Chip tone="memory"><Brain className="h-3 w-3" /> {s(def.memoryPathwayId)}</Chip>}
        <Chip tone="order"><Paperclip className="h-3 w-3" /> {s(def.orderRef) ? `Order ${s(def.orderRef)}` : "No order"}</Chip>
        {s(def.staffing) && <Chip>{s(def.staffing)}</Chip>}
        {s(def.equipment) && <Chip>{s(def.equipment)}</Chip>}
        {s(def.technique) && <Chip>{s(def.technique)}</Chip>}
        {s(def.supervision) && <Chip>{s(def.supervision)}</Chip>}
        {def.supersedesVersion != null && <Chip>revision of v{s(def.supersedesVersion)}</Chip>}
        {s(def.revisionReason) && <Chip>reason: {s(def.revisionReason)}</Chip>}
      </div>

      {!readOnly && (
        <div className="border-t px-3 py-2" style={{ borderColor: "var(--clinical-line)" }}>
          <button onClick={() => setExpanded((v) => !v)} className="text-[11px] font-semibold text-[var(--clinical-panel)]">
            {saving ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Saving…</span> : expanded ? "Hide edits" : "Edit event"}
          </button>
          {expanded && (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Window (HH:MM-HH:MM)">
                <input defaultValue={s(sched.window)} onBlur={(e) => e.target.value !== s(sched.window) && patchSchedule({ window: e.target.value })} className={controlClass} placeholder="06:30-06:45" />
              </Field>
              <Field label="Exact times (comma)">
                <input defaultValue={(sched.times || []).join(", ")} onBlur={(e) => patchSchedule({ times: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className={controlClass} placeholder="08:00, 20:00" />
              </Field>
              <Field label="Frequency method">
                <input defaultValue={s(def.frequencyMethod)} onBlur={(e) => e.target.value !== s(def.frequencyMethod) && patch({ frequencyMethod: e.target.value })} className={controlClass} />
              </Field>
              <Field label="Assistance level">
                <select value={assist} onChange={(e) => changeAssistance(e.target.value)} className={controlClass}>
                  {ASSISTANCE.map((a) => <option key={a} value={a}>{ASSISTANCE_DISPLAY[a]} ({a})</option>)}
                </select>
              </Field>
              <Field label="Assisted by">
                <select value={role} onChange={(e) => patch({ responsibleRole: e.target.value.replace(/ /g, "_") })} className={controlClass}>
                  {ROLE.map((r) => <option key={r} value={r}>{ROLE_ABBR[r]} — {r}</option>)}
                </select>
              </Field>
              <Field label="Supervision"><input defaultValue={s(def.supervision)} onBlur={(e) => e.target.value !== s(def.supervision) && patch({ supervision: e.target.value })} className={controlClass} /></Field>
              <Field label="Staffing"><input defaultValue={s(def.staffing)} onBlur={(e) => e.target.value !== s(def.staffing) && patch({ staffing: e.target.value })} className={controlClass} placeholder="Two-person" /></Field>
              <Field label="Equipment"><input defaultValue={s(def.equipment)} onBlur={(e) => e.target.value !== s(def.equipment) && patch({ equipment: e.target.value })} className={controlClass} /></Field>
              <Field label="Technique"><input defaultValue={s(def.technique)} onBlur={(e) => e.target.value !== s(def.technique) && patch({ technique: e.target.value })} className={controlClass} /></Field>
              <Field label="Condition modifier"><input defaultValue={s(def.conditionModifier)} onBlur={(e) => e.target.value !== s(def.conditionModifier) && patch({ conditionModifier: e.target.value })} className={controlClass} /></Field>
              <Field label="Order ref (clears block)"><input defaultValue={s(def.orderRef)} onBlur={(e) => {
                const val = e.target.value.trim();
                if (val === s(def.orderRef)) return;
                // Attaching an order resolves the order-required block: strip that clause
                // from the persisted blockReason (keeping any other block, e.g. staffing).
                const remaining = s(def.blockReason).split("; ").filter((r) => r && !/order\s*required|no matching current order/i.test(r)).join("; ");
                patch({ orderRef: val, blockReason: val ? (remaining || null) : def.blockReason });
              }} className={controlClass} placeholder="MAR/TAR/diet id" /></Field>
              <Field label="Escalation trigger"><input defaultValue={s(def.escalationTrigger)} onBlur={(e) => e.target.value !== s(def.escalationTrigger) && patch({ escalationTrigger: e.target.value })} className={controlClass} /></Field>
              <Field label="Escalation priority">
                <select value={s(def.escalationPriority)} onChange={(e) => patch({ escalationPriority: e.target.value })} className={controlClass}>
                  <option value="">—</option>
                  {PRIORITY.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Escalation recipient"><input defaultValue={s(def.escalationRecipient)} onBlur={(e) => e.target.value !== s(def.escalationRecipient) && patch({ escalationRecipient: e.target.value })} className={controlClass} /></Field>
              <Field label="Effective date"><input type="date" defaultValue={dateVal(def.effectiveDate)} onChange={(e) => patch({ effectiveDate: e.target.value || null })} className={controlClass} /></Field>
              <Field label="Review date"><input type="date" defaultValue={dateVal(def.reviewDate)} onChange={(e) => patch({ reviewDate: e.target.value || null })} className={controlClass} /></Field>
              <Field label="Stop date"><input type="date" defaultValue={dateVal(def.stopDate)} onChange={(e) => patch({ stopDate: e.target.value || null })} className={controlClass} /></Field>
              <Field label="Override / revision reason"><input defaultValue={s(def.revisionReason)} onBlur={(e) => e.target.value !== s(def.revisionReason) && patch({ revisionReason: e.target.value })} className={controlClass} /></Field>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
