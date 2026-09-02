"use client";

import { useEffect, useRef } from "react";
import { Info } from "lucide-react";
import { SCORED_DOMAINS, CLINICAL_MODIFIERS } from "@/lib/lifecare/dataset.ts";
import type { DomainEntry } from "@/lib/lifecare/assessment.ts";
import type { DomainCode } from "@/lib/lifecare/types.ts";
import { ClinicalCard, MicroLabel, controlClass } from "./clinical-ui";

// Shared v4.2 Layer-2 domain scorer (AS-01..AS-14). Controlled: the parent owns
// the `domains` map and applies patches. Used by the Resident Assessment board
// and, seeded from a pre-admission assessment, by the Admission wizard — one
// instrument, no divergent copy.

const chipOn = "bg-[var(--clinical-panel)] text-white border-[var(--clinical-panel)]";
const chipOff = "bg-[var(--clinical-surface)] text-[var(--clinical-ink-soft)] border-[var(--clinical-line-strong)] hover:border-[var(--clinical-panel)]";

// Which Clinical Modifier flags an assessor can raise under each domain. This is the
// authoritative AS-code → modifier map — mirrors suggestModifiers() in classification.ts
// (keep the two in sync). The old approach matched a modifier's `affectedDomains` short
// codes (COG/SKN/FALL…) against the domain's full-word name as a substring, which silently
// failed for most domains (e.g. "Behavior/BPSD" never contains "COG") so the chips never
// showed. Domains not listed here have no modifier flags by design.
const DOMAIN_MODIFIER_IDS: Record<string, string[]> = {
  "AS-02": ["MOD-MOB-02"],                             // reduced transfer ability
  "AS-03": ["MOD-MOB-01"],                             // high fall risk
  "AS-04": ["MOD-COG-01"],                             // cognitive impairment
  "AS-05": ["MOD-COG-02"],                             // behavioral symptoms
  "AS-06": ["MOD-CLN-01"],                             // recent hospitalization / acute change
  "AS-07": ["MOD-MED-01"],                             // medication complexity
  "AS-08": ["MOD-NUT-01", "MOD-NUT-02", "MOD-NUT-03"], // dysphagia / poor intake / weight loss
  "AS-10": ["MOD-SKN-02", "MOD-CON-01"],               // continence risk + high-frequency toileting
  "AS-11": ["MOD-SKN-01"],                             // skin/wound risk
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// The domain `scope` (e.g. AS-01 "Bathing, dressing, …") doubles as quick-add
// tags for Supporting Evidence. Chips are insert-at-caret buttons: clicking one
// drops the tag wherever the cursor is, so free-typed notes are never disturbed.
const evidenceTagsFor = (scope?: string) =>
  (scope ?? "").split(/,|;|\//).map((s) => cap(s.trim())).filter(Boolean);
const evidenceTokens = (evidence?: string) => (evidence ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// A chip lights up when its tag appears as a whole word in the note (typed or
// inserted), regardless of comma/space separation.
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasEvidenceWord = (evidence: string | undefined, tag: string) =>
  !!evidence && new RegExp(`(^|\\W)${escapeRegex(tag)}(\\W|$)`, "i").test(evidence);

// Single-select evidence dropdowns per domain (e.g. transfer assist level). Options
// live in the same comma-token evidence field; picking one replaces any prior option
// from the same group. Add a domain code here to give it a dropdown.
const EVIDENCE_SELECTS: Record<string, { label: string; options: string[] }> = {
  "AS-02": { label: "Assist level", options: ["Independent", "Standby assist", "One-person assist", "Two-person assist", "Mechanical lift / hoist"] },
};
const currentSelectValue = (evidence: string | undefined, options: string[]) =>
  evidenceTokens(evidence).find((t) => options.some((o) => o.toLowerCase() === t.toLowerCase())) ?? "";
const setSelectValue = (evidence: string | undefined, options: string[], chosen: string) => {
  const opts = new Set(options.map((o) => o.toLowerCase()));
  const kept = evidenceTokens(evidence).filter((t) => !opts.has(t.toLowerCase()));
  return (chosen ? [...kept, chosen] : kept).join(", ");
};

function Area({ label, value, onChange, placeholder, rows = 2, disabled }: { label: string; value?: string; onChange: (v: string) => void; placeholder?: string; rows?: number; disabled?: boolean }) {
  return (
    <label className="block">
      <MicroLabel className="mb-1">{label}</MicroLabel>
      <textarea rows={rows} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={controlClass} />
    </label>
  );
}

// Supporting Evidence field: free-typed textarea + Quick-add chips that insert
// their tag at the current caret position (not appended, not toggled). Each
// instance owns its textarea ref so caret tracking is scoped to one domain.
function EvidenceField({ evidence, placeholder, tags, select, onChange, readOnly }: {
  evidence?: string; placeholder?: string; tags: string[];
  select?: { label: string; options: string[] };
  onChange: (v: string) => void; readOnly?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // Restore the caret to just after the inserted tag once the controlled value updates.
  useEffect(() => {
    if (pendingCaret.current != null && ref.current) {
      ref.current.focus();
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const insertAtCaret = (tag: string) => {
    if (readOnly) return;
    const cur = evidence ?? "";
    const ta = ref.current;
    const start = ta?.selectionStart ?? cur.length;
    const end = ta?.selectionEnd ?? cur.length;
    const before = cur.slice(0, start).replace(/\s+$/, "");
    const after = cur.slice(end).replace(/^\s+/, "");
    // Comma-separate the tag from adjacent content; keep a single space after an
    // existing comma, and add none at the string edges.
    const lead = before === "" ? "" : /[,;]$/.test(before) ? " " : ", ";
    const trail = after === "" ? "" : /^[,;.]/.test(after) ? " " : ", ";
    pendingCaret.current = (before + lead + tag).length;
    onChange(before + lead + tag + trail + after);
  };

  return (
    <label className="block">
      <MicroLabel className="mb-1">Supporting Evidence *</MicroLabel>
      {tags.length > 0 && (
        <div className="mb-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)] mr-0.5">Quick add</span>
          {tags.map((tag) => {
            const on = hasEvidenceWord(evidence, tag);
            return (
              <button key={tag} type="button" disabled={readOnly} onClick={() => insertAtCaret(tag)}
                className={`px-2 py-1 rounded-md text-[11px] font-medium border transition ${on ? chipOn : chipOff} ${readOnly ? "cursor-default" : ""}`}>
                {tag}
              </button>
            );
          })}
        </div>
      )}
      {select && (
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)] shrink-0">{select.label}</span>
          <select
            value={currentSelectValue(evidence, select.options)}
            onChange={(e) => onChange(setSelectValue(evidence, select.options, e.target.value))}
            disabled={readOnly}
            className="rounded-md border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] text-[var(--clinical-ink)] text-[11px] font-medium px-2 py-1 disabled:cursor-default">
            <option value="">Select…</option>
            {select.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )}
      <textarea ref={ref} rows={2} value={evidence ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={readOnly} className={controlClass} />
    </label>
  );
}

export default function DomainScoreGrid({
  domains,
  onPatch,
  readOnly = false,
  showIntro = true,
}: {
  domains: Record<string, DomainEntry>;
  onPatch: (code: DomainCode, p: Partial<DomainEntry>) => void;
  readOnly?: boolean;
  showIntro?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showIntro && (
        <div className="rounded-lg border px-3 py-2 text-[11px] text-[var(--clinical-muted)] flex items-start gap-2" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--clinical-panel)]" />
          <span>Score each domain 0–4 against the anchor that best matches the resident&apos;s assessed need. The score is <b>advisory</b> — the deterministic rule engine sets the Level of Care. NS-01 is captured in the profile and never counted in the total.</span>
        </div>
      )}
      {SCORED_DOMAINS.map((dom) => {
        const code = dom.code as DomainCode;
        const entry = domains[code] ?? { score: 0, evidence: "" };
        const evidenceTags = evidenceTagsFor(dom.scope);
        const evidenceSelect = EVIDENCE_SELECTS[code];
        const relatedMods = (DOMAIN_MODIFIER_IDS[code] ?? [])
          .map((id) => CLINICAL_MODIFIERS.find((m) => m.id === id))
          .filter((m): m is (typeof CLINICAL_MODIFIERS)[number] => !!m);
        const flags = entry.modifierFlags ?? [];
        // Pick a score → also pre-fill the goal note from the Domain-Level Map
        // default for that score. Sticky: only fill when the note is empty or is
        // still the (unedited) default of the previously-selected score, so a
        // clinician's own wording is never clobbered by re-scoring.
        const applyScore = (i: number) => {
          const patch: Partial<DomainEntry> = { score: i };
          const def = dom.goalDefaults?.[i];
          const prevDef = dom.goalDefaults?.[entry.score ?? 0] ?? "";
          const cur = (entry.goalNote ?? "").trim();
          if (def && (cur === "" || cur === prevDef.trim())) patch.goalNote = def;
          onPatch(code, patch);
        };
        const toggleFlag = (id: string) => {
          if (readOnly) return;
          const set = new Set(flags);
          if (set.has(id)) set.delete(id); else set.add(id);
          onPatch(code, { modifierFlags: [...set] });
        };
        return (
          <ClinicalCard key={code} top="teal" className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm font-bold text-[var(--clinical-ink)]"><span className="text-[var(--clinical-panel)] mr-1.5">{code}</span>{dom.name}</h3>
              <span className="text-xs font-bold text-[var(--clinical-panel)] rounded px-2 py-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>{entry.score}<span className="text-[var(--clinical-muted)] font-medium">/4</span></span>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {dom.anchors.map((anchor, i) => {
                const on = entry.score === i;
                return (
                  <button key={i} type="button" disabled={readOnly} onClick={() => applyScore(i)}
                    className={`text-left px-3 py-2 rounded-lg text-xs border transition flex items-start gap-2 ${on ? chipOn : chipOff} ${readOnly ? "cursor-default" : ""}`}>
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${on ? "bg-white/20" : "bg-[var(--clinical-surface-2)] text-[var(--clinical-muted)]"}`}>{i}</span>
                    <span className="leading-snug">{anchor}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <EvidenceField
                evidence={entry.evidence}
                placeholder={dom.evidenceRequired}
                tags={evidenceTags}
                select={evidenceSelect}
                onChange={(v) => onPatch(code, { evidence: v })}
                readOnly={readOnly}
              />
              <Area label="Goal / Preference Note" value={entry.goalNote} onChange={(v) => onPatch(code, { goalNote: v })} placeholder="Resident-specific goal, routine or preference…" disabled={readOnly} />
            </div>
            {relatedMods.length > 0 && (
              <div className="mt-3">
                <MicroLabel className="mb-1.5">Clinical Modifier Flags</MicroLabel>
                <div className="flex flex-wrap gap-1.5">
                  {relatedMods.map((m) => {
                    const on = flags.includes(m.id);
                    return (
                      <button key={m.id} type="button" disabled={readOnly} onClick={() => toggleFlag(m.id)} title={m.taskPlanEffect}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition ${on ? chipOn : chipOff} ${readOnly ? "cursor-default" : ""}`}>
                        {m.id} · {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </ClinicalCard>
        );
      })}
    </div>
  );
}
