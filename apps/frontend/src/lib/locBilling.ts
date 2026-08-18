/**
 * Level-of-Care billing — migration-free pricing for the 5 acuity Levels (1–5).
 *
 * The Care Acuity engine assigns each resident a Level of Care (1–5) through the
 * nurse → admin approval workflow. This layer maps each level to a MONTHLY fee so
 * that approving (or re-assessing) a level posts/switches the resident's charge in
 * Billing & Finance. Pricing is a JSON array in the app-setting `loc_pricing`;
 * the fee is a distinct ServiceCharge line, idempotent per resident/level/month
 * via a `[loc:<level>:<YYYY-MM>]` marker.
 *
 * Pure helpers only (client + server safe). The prisma-backed apply logic lives
 * in `locBillingServer.ts`.
 */

import { periodTag } from "./billingLibrary";
import { LEVEL_MODEL } from "./lifecare/levelModel";

export const LOC_PRICING_KEY = "loc_pricing";
export const ACUITY_ASSESSMENTS_KEY = "acuity_assessments";
export const LOC_MARKER_PREFIX = "[loc:";

/** One row per acuity Level 1–5. */
export interface LocPrice {
  level: number;    // 1..5
  label: string;    // invoice line, e.g. "Level 3 — Enhanced Assisted Care Fee"
  amount: number;   // monthly PHP
  category: string; // ServiceCharge category
  active: boolean;  // false → no charge posted for this level
}

// Level names come from the canonical care-level model (care_level_model.json)
// so the pricing table reads identically to CareAcuityBoard — one source, no drift.
export const LOC_LEVEL_META: { level: number; name: string }[] = LEVEL_MODEL.map((m) => ({ level: m.n, name: m.name }));

export const DEFAULT_LOC_PRICING: LocPrice[] = LOC_LEVEL_META.map((m) => ({
  level: m.level,
  label: `Level ${m.level} — ${m.name} Care Fee`,
  amount: 0,
  category: "Care Services",
  active: false,
}));

/** Always returns exactly 5 rows (levels 1–5), filling gaps from defaults. */
export function parseLocPricing(raw: string | null | undefined): LocPrice[] {
  let arr: Partial<LocPrice>[] = [];
  if (raw) {
    try { const v = JSON.parse(raw); if (Array.isArray(v)) arr = v as Partial<LocPrice>[]; } catch { /* ignore */ }
  }
  return LOC_LEVEL_META.map((m) => {
    const found = arr.find((x) => Number(x?.level) === m.level);
    const def = DEFAULT_LOC_PRICING[m.level - 1];
    return {
      level: m.level,
      label: (found?.label && String(found.label)) || def.label,
      amount: Number(found?.amount) || 0,
      category: (found?.category && String(found.category)) || def.category,
      active: found?.active != null ? Boolean(found.active) : def.active,
    };
  });
}

/** Idempotency + switchability marker embedded in the charge description. */
export function locMarker(level: number, tag: string): string {
  return `[loc:${level}:${tag}]`;
}

/** Parse the raw `acuity_assessments` JSON into a plain array. */
export function parseAcuityItems(raw: string | null | undefined): Array<Record<string, unknown>> {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []; } catch { return []; }
}

/** The most recently APPROVED acuity level (1–5) for a resident, or null. */
export function latestApprovedAcuityLevel(items: Array<Record<string, unknown>>, residentId: string): number | null {
  let best: { level: number; at: string } | null = null;
  for (const x of items) {
    if (!x || x.residentId !== residentId || x.status !== "APPROVED") continue;
    const level = Number(x.level);
    if (!(level >= 1 && level <= 5)) continue;
    const at = String(x.decidedAt || x.createdAt || "");
    if (!best || at > best.at) best = { level, at };
  }
  return best ? best.level : null;
}

export { periodTag };
