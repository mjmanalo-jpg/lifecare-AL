"use client";

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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// The domain `scope` (e.g. AS-01 "Bathing, dressing, …") doubles as quick-add
// tags for Supporting Evidence. Treat evidence as a comma-token list: toggling
// only adds/removes the exact tag token, so free-typed notes are never touched.
const evidenceTagsFor = (scope?: string) =>
  (scope ?? "").split(/,|;|\//).map((s) => cap(s.trim())).filter(Boolean);
const evidenceTokens = (evidence?: string) => (evidence ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const hasEvidenceTag = (evidence: string | undefined, tag: string) =>
  evidenceTokens(evidence).some((t) => t.toLowerCase() === tag.toLowerCase());
const toggleEvidenceTag = (evidence: string | undefined, tag: string) => {
  const toks = evidenceTokens(evidence);
  const next = hasEvidenceTag(evidence, tag) ? toks.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...toks, tag];
  return next.join(", ");
};

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
        const relatedMods = CLINICAL_MODIFIERS.filter((m) => {
          const hay = `${dom.name} ${dom.scope}`.toUpperCase();
          return m.affectedDomains.some((d) => hay.includes(d));
        });
        const flags = entry.modifierFlags ?? [];
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
                  <button key={i} type="button" disabled={readOnly} onClick={() => onPatch(code, { score: i })}
                    className={`text-left px-3 py-2 rounded-lg text-xs border transition flex items-start gap-2 ${on ? chipOn : chipOff} ${readOnly ? "cursor-default" : ""}`}>
                    <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${on ? "bg-white/20" : "bg-[var(--clinical-surface-2)] text-[var(--clinical-muted)]"}`}>{i}</span>
                    <span className="leading-snug">{anchor}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <MicroLabel className="mb-1">Supporting Evidence *</MicroLabel>
                {evidenceTags.length > 0 && (
                  <div className="mb-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)] mr-0.5">Quick add</span>
                    {evidenceTags.map((tag) => {
                      const on = hasEvidenceTag(entry.evidence, tag);
                      return (
                        <button key={tag} type="button" disabled={readOnly}
                          onClick={() => onPatch(code, { evidence: toggleEvidenceTag(entry.evidence, tag) })}
                          className={`px-2 py-1 rounded-md text-[11px] font-medium border transition ${on ? chipOn : chipOff} ${readOnly ? "cursor-default" : ""}`}>
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                )}
                {evidenceSelect && (
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)] shrink-0">{evidenceSelect.label}</span>
                    <select
                      value={currentSelectValue(entry.evidence, evidenceSelect.options)}
                      onChange={(e) => onPatch(code, { evidence: setSelectValue(entry.evidence, evidenceSelect.options, e.target.value) })}
                      disabled={readOnly}
                      className="rounded-md border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] text-[var(--clinical-ink)] text-[11px] font-medium px-2 py-1 disabled:cursor-default">
                      <option value="">Select…</option>
                      {evidenceSelect.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                )}
                <textarea rows={2} value={entry.evidence ?? ""} onChange={(e) => onPatch(code, { evidence: e.target.value })} placeholder={dom.evidenceRequired} disabled={readOnly} className={controlClass} />
              </label>
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
