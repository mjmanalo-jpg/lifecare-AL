"use client";

/**
 * Clinical Decision Tree Register (Phase 6) — the verification surface for all
 * 14 decision trees (DT-001..DT-014). Each row shows the tree's status:
 *   • built here            → DT-007/008/010 got a first-class board this phase
 *   • realised in module X  → the tree is operationalised by an existing module
 *   • engine-realised       → the tree is realised purely by an engine (careEvents)
 * and expands to the full protocol (trigger → pathway → documentation → escalation).
 * Read-only reference — no writes.
 */

import { useMemo, useState } from "react";
import { GitBranch, CheckCircle2, Link2, Cpu } from "lucide-react";
import { DECISION_TREES } from "@/lib/lifecare/dataset";
import { getProtocol, NEW_BOARD_TREES } from "@/lib/lifecare/decisionTrees";
import type { ClinicianRole } from "./useClinician";
import ProtocolReference from "./ProtocolReference";
import { ClinicalPage, ClinicalHeader, StatCard, SearchInput } from "./clinical-ui";

type Kind = "built" | "module" | "engine";

// How each tree is realised. Trees not listed and not in NEW_BOARD_TREES fall back
// to "module" using their protocol.linkedModule label.
const KIND_OVERRIDE: Record<string, Kind> = {
  "DT-011": "engine", // care-event exception engine (careEvents.ts)
};

// Friendly label for a linkedModule marker.
const MODULE_LABEL: Record<string, string> = {
  admissions: "Admissions wizard",
  careAcuity: "Care Acuity engine",
  careEvents: "Care-event engine",
  incidents: "Incidents / fall detection",
  EscalationsBoard: "SBAR Escalations",
  MAR: "MAR / medication",
  transport: "Referrals + transport",
  reassessment: "Reassessment / Care Acuity",
  privateCaregiver: "Private caregiver board",
  additionalServices: "Additional services pricing",
};

const NEW_SET = new Set<string>(NEW_BOARD_TREES);

function kindOf(id: string): Kind {
  if (NEW_SET.has(id)) return "built";
  return KIND_OVERRIDE[id] ?? "module";
}

const KIND_META: Record<Kind, { label: string; icon: typeof CheckCircle2; accent: string; status: string }> = {
  built: { label: "Built here", icon: CheckCircle2, accent: "var(--clinical-green)", status: "GIVEN" },
  module: { label: "Realised in module", icon: Link2, accent: "var(--clinical-panel)", status: "SCHEDULED" },
  engine: { label: "Engine-realised", icon: Cpu, accent: "var(--clinical-amber)", status: "PENDING" },
};

export default function ClinicalProtocolsBoard({ role = "NURSE" }: { role?: ClinicianRole }) {
  void role;
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return DECISION_TREES.map((t) => ({ tree: t, protocol: getProtocol(t.id), kind: kindOf(t.id) }))
      .filter(({ tree }) => !q || `${tree.id} ${tree.name} ${tree.domain} ${tree.purpose}`.toLowerCase().includes(q));
  }, [search]);

  const counts = useMemo(() => {
    const c = { built: 0, module: 0, engine: 0 };
    for (const t of DECISION_TREES) c[kindOf(t.id)]++;
    return c;
  }, []);

  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Clinical Decision Tree Register"
        subtitle="All 14 governed decision trees. Each shows how it is realised and expands to its full protocol: trigger → pathway → documentation → escalation."
      />

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard value={DECISION_TREES.length} label="Total trees" accent="ink" />
        <StatCard value={counts.built} label="Built here" accent="green" />
        <StatCard value={counts.module} label="In existing module" accent="teal" />
        <StatCard value={counts.engine} label="Engine-realised" accent="amber" />
      </div>

      <div className="mt-5 max-w-md"><SearchInput value={search} onChange={setSearch} placeholder="Search decision trees…" /></div>

      <div className="mt-4 space-y-3">
        {rows.map(({ tree, protocol, kind }) => {
          const meta = KIND_META[kind];
          const Icon = meta.icon;
          const moduleName = protocol?.linkedModule ? (MODULE_LABEL[protocol.linkedModule] ?? protocol.linkedModule) : "";
          const isOpen = openId === tree.id;
          if (!protocol) return null;
          return (
            <div key={tree.id}>
              <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ backgroundColor: `${meta.accent}1a` }}><GitBranch className="h-4 w-4" style={{ color: meta.accent }} /></span>
                <button type="button" onClick={() => setOpenId(isOpen ? null : tree.id)} className="min-w-0 flex-1 text-left">
                  <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--clinical-muted)]">{tree.id} · {tree.domain}</p>
                  <p className="truncate text-sm font-semibold text-[var(--clinical-ink)]">{tree.name}</p>
                </button>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.05em]" style={{ color: meta.accent, backgroundColor: `${meta.accent}1a` }}>
                  <Icon className="h-3 w-3" /> {kind === "module" && moduleName ? moduleName : meta.label}
                </span>
              </div>
              {isOpen && <div className="mt-2"><ProtocolReference protocol={protocol} defaultOpen /></div>}
            </div>
          );
        })}
      </div>
    </ClinicalPage>
  );
}
