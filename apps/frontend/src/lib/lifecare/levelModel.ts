// Canonical Level-of-Care model — the single source of truth for L1–L5 names,
// need patterns, baseline packages, included domains, and the per-domain baseline
// matrix. Reads the workbook master `care_level_model.json` so UI boards and
// billing never hardcode (or diverge on) level names/packages.

import careLevelModel from "./data/care_level_model.json" with { type: "json" };
import { LEVEL_PACKAGE_DOMAINS, DOMAIN_LABEL, clampLevel } from "./carePackage.ts";
import type { DomainCode } from "./types.ts";

interface RawLevel {
  level: string; conceptualProfile: string; typicalNeedPattern: string;
  baselineCarePackage: string; reviewEscalation: string; intensity: string;
  privateCaregiverPrinciple?: string; feeSafeguard?: string;
}
interface RawBaseline { domain: string; L1?: string; L2?: string; L3?: string; L4?: string; modifierRule?: string }

const RAW = careLevelModel as { levels: RawLevel[]; baselineByDomain: RawBaseline[] };

export interface LevelMeta {
  n: number;                    // 1..5
  code: string;                 // "L1".."L5"
  name: string;                 // conceptualProfile (e.g. "Minimal Care Support")
  needPattern: string;
  packageSummary: string;
  reviewEscalation: string;
  intensity: string;            // Standard | Moderate | High | Very High | Specialized
  includedDomains: DomainCode[];
  includedDomainLabels: string[];
}

export const LEVEL_MODEL: LevelMeta[] = RAW.levels.map((l) => {
  const n = Number((l.level || "").replace(/\D/g, "")) || 0;
  const includedDomains = LEVEL_PACKAGE_DOMAINS[n] ?? [];
  return {
    n, code: l.level, name: l.conceptualProfile, needPattern: l.typicalNeedPattern,
    packageSummary: l.baselineCarePackage, reviewEscalation: l.reviewEscalation, intensity: l.intensity,
    includedDomains, includedDomainLabels: includedDomains.map((c) => DOMAIN_LABEL[c] || c),
  };
}).sort((a, b) => a.n - b.n);

export const levelMeta = (n: number): LevelMeta | undefined => LEVEL_MODEL.find((l) => l.n === clampLevel(n));
export const levelName = (n: number): string => levelMeta(n)?.name || `Level ${n}`;

/** Per-domain baseline description at each level (the rule-sourced "care activities by LOC"). */
export interface DomainBaseline { domain: string; byLevel: Record<number, string>; modifierRule?: string }
export const DOMAIN_BASELINE: DomainBaseline[] = RAW.baselineByDomain.map((d) => ({
  domain: d.domain,
  byLevel: { 1: d.L1 || "", 2: d.L2 || "", 3: d.L3 || "", 4: d.L4 || "" },
  modifierRule: d.modifierRule,
}));
