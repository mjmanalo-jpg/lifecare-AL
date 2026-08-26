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
              <Area label="Supporting Evidence *" value={entry.evidence} onChange={(v) => onPatch(code, { evidence: v })} placeholder={dom.evidenceRequired} disabled={readOnly} />
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
