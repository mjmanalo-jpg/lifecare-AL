"use client";

/**
 * Shared reference panel that renders a clinical decision-tree protocol
 * (trigger → pathway → documentation → escalation) from decisionTrees.ts.
 * Used by the DT-007/008/010 protocol boards and the register board so the
 * protocol always displays the same way.
 */

import { useState } from "react";
import { AlertTriangle, ListOrdered, FileText, ArrowUpCircle, ChevronDown, Scale } from "lucide-react";
import type { Protocol } from "@/lib/lifecare/decisionTrees";
import { MicroLabel } from "./clinical-ui";

function Section({ icon: Icon, title, accent, children }: { icon: typeof AlertTriangle; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md" style={{ backgroundColor: `${accent}1a` }}>
          <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        </span>
        <MicroLabel>{title}</MicroLabel>
      </div>
      {children}
    </div>
  );
}

export default function ProtocolReference({ protocol, defaultOpen = true }: { protocol: Protocol; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
      >
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--clinical-coral)]">{protocol.id} · {protocol.domain}</p>
          <p className="mt-0.5 truncate text-base font-bold text-[var(--clinical-ink)]">{protocol.name}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-[var(--clinical-muted)]">{protocol.purpose}</p>
        </div>
        <ChevronDown className={`h-5 w-5 shrink-0 text-[var(--clinical-muted)] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="grid gap-5 border-t px-5 py-4 sm:grid-cols-2" style={{ borderColor: "var(--clinical-line)" }}>
          <Section icon={AlertTriangle} title="Trigger" accent="var(--clinical-coral)">
            <ul className="space-y-1">
              {protocol.trigger.map((t, i) => (
                <li key={i} className="flex gap-2 text-sm text-[var(--clinical-ink)]"><span className="text-[var(--clinical-coral)]">•</span>{t}</li>
              ))}
            </ul>
          </Section>

          <Section icon={ArrowUpCircle} title="Escalation" accent="var(--clinical-amber)">
            <ul className="space-y-1.5">
              {protocol.escalation.map((e, i) => (
                <li key={i} className="text-sm text-[var(--clinical-ink)]">
                  <span className="font-semibold">If {e.condition.charAt(0).toLowerCase() + e.condition.slice(1)}</span>
                  <span className="text-[var(--clinical-muted)]"> → {e.to}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section icon={ListOrdered} title="Pathway" accent="var(--clinical-panel)">
            <ol className="space-y-2">
              {protocol.pathway.map((p, i) => (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--clinical-panel)] text-[11px] font-bold text-white">{i + 1}</span>
                  <span><span className="font-semibold text-[var(--clinical-ink)]">{p.step}.</span> <span className="text-[var(--clinical-muted)]">{p.action}</span></span>
                </li>
              ))}
            </ol>
          </Section>

          <Section icon={FileText} title="Documentation" accent="var(--clinical-green)">
            <ul className="space-y-1">
              {protocol.documentation.map((d, i) => (
                <li key={i} className="flex gap-2 text-sm text-[var(--clinical-ink)]"><span className="text-[var(--clinical-green)]">•</span>{d}</li>
              ))}
            </ul>
          </Section>

          {protocol.atomicRules && protocol.atomicRules.length > 0 && (
            <div className="sm:col-span-2">
              <Section icon={Scale} title={`Atomic rules (${protocol.atomicRules.length})`} accent="var(--clinical-panel)">
                <div className="space-y-2">
                  {protocol.atomicRules.map((r) => (
                    <div key={r.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--clinical-line)" }}>
                      <p className="text-sm font-semibold text-[var(--clinical-ink)]">
                        <span className="text-[var(--clinical-coral)]">{r.id}</span> · {r.name}
                      </p>
                      {r.decisionQuestion && <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{r.decisionQuestion}</p>}
                      {r.ruleOutcome && <p className="mt-1 text-xs text-[var(--clinical-ink)]"><span className="font-semibold">Outcome:</span> {r.ruleOutcome}</p>}
                    </div>
                  ))}
                </div>
              </Section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
