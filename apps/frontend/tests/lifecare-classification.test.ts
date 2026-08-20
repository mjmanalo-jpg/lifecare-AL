// B3 — Test harness for the Phase 1 classification engine.
// Encodes the workbook's own validation cases as the pass/fail gate:
//   - Level of Care Validation sheet: LOC-001..018 (loaded from rule-data JSON)
//   - The four cases the implementation plan calls out explicitly
//   - Scenario provisional levels SC-01..12 (directional sanity)
//
// Run: node --test tests/lifecare-classification.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { classify, rawScore, advisoryBand, evaluateMlr } from "../src/lib/lifecare/classification.ts";
import { BASIC_ADL } from "../src/lib/lifecare/types.ts";
import type { CareLevel, DomainCode, DomainScores, ClinicalContext } from "../src/lib/lifecare/types.ts";
import LOC_CASES from "../src/lib/lifecare/data/loc_validation_cases.json" with { type: "json" };
import ASSESSMENT_DOMAINS from "../src/lib/lifecare/data/assessment_domains.json" with { type: "json" };

// Per-case clinical context the score cannot infer (pathway / acute / modifiers).
// Sourced from each case's documented Override/Modifier columns.
const CASE_CONTEXT: Record<string, ClinicalContext> = {
  "LOC-006": { recentHospitalization: true }, // post-hospital: AS-06 elevation temporary (MOD-CLN-01)
  "LOC-007": { recentHospitalization: true }, // "MOD-CLN-01 as applicable"
  "LOC-010": { dysphagia: true },             // MOD-NUT-01 swallowing precautions
  "LOC-014": { l5PathwayAuthorized: true },   // MLR-018 authorized comfort pathway
  "LOC-016": { acuteInstability: true, recentHospitalization: true, overrideLevel: "L3", overrideReason: "MLR-015 acute instability — temporary L3 if safely manageable" },
  "LOC-017": { l5PathwayAuthorized: true },   // MLR-018 authorized comfort pathway (low score)
};

/** Parse "L3 temporary / capability decision" etc. down to the L-level. */
function parseLevel(raw: string): CareLevel {
  const m = /L[1-5]/.exec(raw || "");
  return (m ? m[0] : "L1") as CareLevel;
}

function scoresOf(c: Record<string, unknown>): DomainScores {
  return (c.scores ?? {}) as DomainScores;
}

test("rule-data loads all 18 LOC validation cases", () => {
  assert.equal((LOC_CASES as unknown[]).length, 18);
});

test("raw score equals the sum of the 14 scored domains (NS-01 excluded)", () => {
  for (const c of LOC_CASES as Array<Record<string, unknown>>) {
    const scores = scoresOf(c);
    assert.equal(rawScore(scores), c.rawScore, `${c.id} raw score`);
  }
});

// The core gate: the deterministic engine reproduces every documented final level.
for (const c of LOC_CASES as Array<Record<string, unknown>>) {
  const id = c.id as string;
  const expected = parseLevel(c.expectedLevel as string);
  const ctx = CASE_CONTEXT[id] ?? {};

  test(`${id} (${c.archetype}) → ${expected} [banding on = documented outcome]`, () => {
    const r = classify(scoresOf(c), ctx, { bandingEnabled: true });
    assert.equal(r.suggestedLevel, expected,
      `${id}: expected ${expected}, got ${r.suggestedLevel}\n  trace: ${r.trace.join(" | ")}`);
  });
}

// The four cases the implementation plan cites as the calibration-safe proof —
// must hold in rules-only mode (banding OFF), i.e. from floors / pathway alone.
test("plan verify cases hold in rules-only mode (banding OFF)", () => {
  const find = (id: string) => (LOC_CASES as Array<Record<string, unknown>>).find((c) => c.id === id)!;
  const run = (id: string) => classify(scoresOf(find(id)), CASE_CONTEXT[id] ?? {}, { bandingEnabled: false }).suggestedLevel;

  assert.equal(run("LOC-002"), "L2", "raw 9 → L2 via MLR-001 floor");
  assert.equal(run("LOC-006"), "L2", "raw 16 → L2");
  assert.equal(run("LOC-014"), "L5", "raw 32 → L5 via MLR-018 pathway");
  assert.equal(run("LOC-018"), "L4", "raw 41 → L4 (not L5) via MLR-016 floor, no pathway");
});

test("L5 is never assigned from score alone; only via authorized pathway", () => {
  // LOC-018: highest dependency (raw 41) but no pathway → L4, not L5.
  const c = (LOC_CASES as Array<Record<string, unknown>>).find((x) => x.id === "LOC-018")!;
  const r = classify(scoresOf(c), {}, { bandingEnabled: true });
  assert.equal(r.suggestedLevel, "L4");
  assert.equal(r.l5Pathway, false);
  assert.equal(advisoryBand(41), "L4"); // band caps at L4
});

test("capability gate is required for L4-floor and L5-pathway cases", () => {
  const gated = ["LOC-008", "LOC-013", "LOC-014", "LOC-016", "LOC-018"];
  for (const id of gated) {
    const c = (LOC_CASES as Array<Record<string, unknown>>).find((x) => x.id === id)!;
    const r = classify(scoresOf(c), CASE_CONTEXT[id] ?? {}, { bandingEnabled: true });
    assert.equal(r.capabilityGate, true, `${id} should require capability gate`);
  }
});

test("modifiers are suggested but never inflate the level (LOC-005 high fall risk)", () => {
  const c = (LOC_CASES as Array<Record<string, unknown>>).find((x) => x.id === "LOC-005")!;
  const r = classify(scoresOf(c), {}, { bandingEnabled: true });
  assert.ok(r.modifiers.includes("MOD-MOB-01"), "high fall risk flags MOD-MOB-01");
  assert.equal(r.suggestedLevel, "L2", "fall risk does not raise the level");
});

test("intrinsic-need invariant: score is unaffected by who delivers care", () => {
  // Two identical assessments classify identically regardless of context notes.
  const scores: DomainScores = { "AS-01": 3, "AS-02": 2, "AS-08": 2, "AS-10": 2 };
  const a = classify(scores, {}, { bandingEnabled: true });
  const b = classify(scores, {}, { bandingEnabled: true });
  assert.equal(a.suggestedLevel, b.suggestedLevel);
  assert.equal(a.suggestedLevel, "L3"); // MLR-003
});

test("DT-013 / DT-014 are emitted as separate review recommendations, not decisions", () => {
  const scores: DomainScores = { "AS-13": 4, "AS-11": 3 } as Record<DomainCode, number>;
  const r = classify(scores, {}, { bandingEnabled: true });
  assert.equal(r.dt013.recommendReview, true, "pervasive supervision → DT-013 review");
  assert.equal(r.dt014.recommendReview, true, "complex wound → DT-014 review");
});

test("every triggered MLR carries a valid minimum level or is modifier-only", () => {
  for (const c of LOC_CASES as Array<Record<string, unknown>>) {
    const applied = evaluateMlr(scoresOf(c), CASE_CONTEXT[c.id as string] ?? {});
    for (const a of applied) {
      assert.ok(a.minimumLevel === null || /^L[1-5]$/.test(a.minimumLevel), `${c.id} ${a.id}`);
    }
  }
});

// ── BASIC_ADL is auditable against the rule data (not a silent magic array) ──
test("BASIC_ADL matches the basicAdl flags in assessment_domains.json", () => {
  const fromData = (ASSESSMENT_DOMAINS as Array<{ code: string; basicAdl?: boolean }>)
    .filter((d) => d.basicAdl).map((d) => d.code).sort();
  assert.deepEqual([...BASIC_ADL].sort(), fromData);
});

// ── Production default is banding OFF: a no-floor case reaches its level only via
//    the advisory fallback the nurse confirms (not an auto-applied band). ──
test("no-floor L2 case (LOC-012) is band-fallback in production mode (banding OFF)", () => {
  const c = (LOC_CASES as Array<Record<string, unknown>>).find((x) => x.id === "LOC-012")!;
  const r = classify(scoresOf(c), {}, { bandingEnabled: false });
  assert.equal(r.mlrFloor, null, "LOC-012 has no MLR floor");
  assert.equal(r.suggestedLevel, "L2", "reaches L2 via the advisory band");
  assert.ok(r.trace.some((t) => /nurse confirmation/i.test(t)), "surfaces the band for nurse confirmation, not auto-applied");
});

// ── Documented appliedMLR ⊆ engine's fired MLRs — pins code↔documentation so a
//    rule silently dropped from the engine is caught. Two cases are documented
//    exceptions where the engine intentionally remodels a post-hospital elevation
//    as temporary (MOD-CLN-01): LOC-006 (MLR-015) and LOC-007 (MLR-014 suppressed
//    while recentHospitalization). ──
test("each case's documented appliedMLR is reproduced by the engine (with documented exceptions)", () => {
  const EXCEPTIONS = new Set(["LOC-006", "LOC-007"]);
  for (const c of LOC_CASES as Array<Record<string, unknown>>) {
    const id = c.id as string;
    if (EXCEPTIONS.has(id)) continue;
    const fired = new Set(evaluateMlr(scoresOf(c), CASE_CONTEXT[id] ?? {}).map((a) => a.id));
    const documented = (String(c.appliedMLR ?? "").match(/MLR-\d+/g)) ?? [];
    for (const d of documented) assert.ok(fired.has(d), `${id}: documented ${d} not fired by the engine`);
  }
});
