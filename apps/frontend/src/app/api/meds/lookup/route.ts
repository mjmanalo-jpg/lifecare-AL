/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Medication name lookup → generic + brand suggestions.
 *
 * Backed by RxNorm / RxNav (US National Library of Medicine) — a free, keyless
 * public drug terminology API. Given a typed medication name it returns a short,
 * ranked list of { name, generic, brand } candidates for the inventory Add-Item
 * form.
 *
 * Strategy: resolve the ingredient (exact match) to guarantee a correct GENERIC
 * even for drugs whose single-ingredient product ranks low (metformin, etc.), and
 * add branded products from drugs.json. Rank single-ingredient exact matches with
 * a brand first. Never fabricate a brand — leave it blank when unsure.
 *
 * Best-effort only: RxNorm is US-centric, so some Philippine-specific brand names
 * won't resolve. Any failure returns an empty list — the form always allows manual
 * entry. Only the drug string is sent externally (no resident/PHI). Cached a week.
 */

import { NextRequest, NextResponse } from "next/server";

const RXNAV = "https://rxnav.nlm.nih.gov/REST";
// Prefer branded/clinical drug concepts, then brand/ingredient terms.
const TTY_PRIORITY = ["SBD", "SCD", "BPCK", "GPCK", "BN", "SBDF", "SCDF", "IN", "MIN", "PIN"];

type Sugg = { rxcui: string; name: string; generic: string; brand: string };

async function jget(url: string, ms = 4500): Promise<any | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, next: { revalidate: 604800 } });
    clearTimeout(timer);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const titleCase = (v: string) => v.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// Strip dose/strength/form tokens so "Amlodipine 5mg" → "amlodipine".
function cleanTerm(t: string): string {
  return t.toLowerCase()
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|kg|ml|l|mmol|iu|units?|meq|%)\b/g, " ")
    .replace(/\b(tabs?|tablets?|caps?|capsules?|oral|injection|inj|syrup|solution|susp|suspension|cream|ointment|drops?|patch|sr|xr|er|od|bid|tid|qid)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ").trim();
}

// Distinct candidate rxcuis from a drugs.json result, in TTY priority order.
function drugRxcuis(drug: any, cap: number): string[] {
  const groups: any[] = drug?.drugGroup?.conceptGroup || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tty of TTY_PRIORITY) {
    const g = groups.find((x) => x?.tty === tty);
    for (const c of (g?.conceptProperties || [])) {
      const rxcui = String(c?.rxcui || "");
      if (!rxcui || seen.has(rxcui)) continue;
      seen.add(rxcui);
      out.push(rxcui);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

// Resolve a concept's ingredient (generic) + first brand.
async function resolve(rxcui: string): Promise<{ generic: string; brand: string }> {
  const rel = await jget(`${RXNAV}/rxcui/${rxcui}/related.json?tty=IN+BN`);
  const rg: any[] = rel?.relatedGroup?.conceptGroup || [];
  const namesFor = (tty: string): string[] =>
    (rg.find((x) => x?.tty === tty)?.conceptProperties || [])
      .map((c: any) => String(c?.name || "")).filter(Boolean);
  const generic = namesFor("IN").map(titleCase).join(" / ");
  const brand = namesFor("BN")[0] ? titleCase(namesFor("BN")[0]) : "";
  return { generic, brand };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (q.length < 3) return NextResponse.json({ suggestions: [] });
  const base = cleanTerm(q) || q.toLowerCase();

  // Branded/clinical candidates from the name (raw, then dose-stripped).
  let rxcuis = drugRxcuis(await jget(`${RXNAV}/drugs.json?name=${encodeURIComponent(q)}`), 15);
  if (rxcuis.length === 0 && base !== q.toLowerCase() && base.length >= 3) {
    rxcuis = drugRxcuis(await jget(`${RXNAV}/drugs.json?name=${encodeURIComponent(base)}`), 15);
  }
  // Typo-tolerant fallback.
  if (rxcuis.length === 0) {
    const approx = await jget(`${RXNAV}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=8`);
    const seen = new Set<string>();
    for (const c of (approx?.approximateGroup?.candidate || [])) {
      const rxcui = String(c?.rxcui || "");
      if (rxcui && !seen.has(rxcui)) { seen.add(rxcui); rxcuis.push(rxcui); }
      if (rxcuis.length >= 8) break;
    }
  }

  const resolved = await Promise.all(rxcuis.slice(0, 12).map(async (rx) => {
    const r = await resolve(rx);
    return { rxcui: rx, name: "", ...r } as Sugg;
  }));

  // Ingredient exact match → guarantees the correct generic (brand left blank so a
  // wrong brand is never forced for multi-brand generics like metformin).
  const ing = await jget(`${RXNAV}/rxcui.json?name=${encodeURIComponent(base)}&search=1`);
  const ingId = ing?.idGroup?.rxnormId?.[0];
  const list: Sugg[] = ingId
    ? [{ rxcui: String(ingId), name: base, generic: titleCase(base), brand: "" }, ...resolved]
    : resolved;

  // Keep resolved rows, dedup by generic|brand.
  const out: Sugg[] = [];
  const dedup = new Set<string>();
  for (const r of list) {
    if (!r.generic && !r.brand) continue;
    const key = `${r.generic.toLowerCase()}|${r.brand.toLowerCase()}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    out.push(r);
  }

  // Rank: exact single-ingredient match first, fewer ingredients better, brand > none.
  const score = (r: Sugg): number => {
    const gl = r.generic.toLowerCase();
    const toks = gl.split(" / ");
    let v = 0;
    if (gl === base) v += 100;
    else if (toks.includes(base)) v += 50;
    else if (base && gl.includes(base)) v += 20;
    v += Math.max(0, 12 - toks.length * 4);
    if (r.brand) v += 4;
    return v;
  };
  out.sort((a, b) => score(b) - score(a));

  return NextResponse.json({ suggestions: out.slice(0, 6) });
}
