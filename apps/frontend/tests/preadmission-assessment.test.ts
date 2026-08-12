import test from "node:test";
import assert from "node:assert/strict";
import {
  mobilityScore, adlScore, continenceScore, behaviorModifier, cognitionScore,
  nursingScore, riskScore, scoreAssessment, classifyLevel, ADL_ITEMS,
  effectiveLevel, reviewIntervalDays, computeNextReview, isReassessmentDue,
  deriveProblems, cloneForReassessment,
  type PreAdmissionAssessment,
} from "../src/lib/preadmissionAssessment.ts";

// ── Section C — Mobility (max 6) ─────────────────────────────────────────────
test("mobility: walking scale maps to points, bedbound is the 6-pt ceiling", () => {
  assert.equal(mobilityScore("INDEPENDENT"), 0);
  assert.equal(mobilityScore("CANE"), 2);
  assert.equal(mobilityScore("WHEELCHAIR"), 4);
  assert.equal(mobilityScore("BEDBOUND"), 6);
  assert.equal(mobilityScore(undefined), 0);
});

// ── Section D — ADLs (max 12) ────────────────────────────────────────────────
test("adl: sums 6 items, all-dependent hits the 12 ceiling", () => {
  const allDependent = Object.fromEntries(ADL_ITEMS.map((i) => [i, "DEPENDENT"]));
  assert.equal(adlScore(allDependent), 12);
  assert.equal(adlScore({ bathing: "ASSISTANCE", dressing: "DEPENDENT" }), 3);
  assert.equal(adlScore(undefined), 0);
});

// ── Section E — Continence (max 4, worst-of-channels, never summed) ──────────
test("continence: takes the worse of urinary/bowel, capped at 4", () => {
  assert.equal(continenceScore("CATHETER", "INCONTINENT"), 4); // 4 vs 3 → 4, not 7
  assert.equal(continenceScore("OCCASIONAL", "INCONTINENT"), 3); // 1 vs 3 → 3
  assert.equal(continenceScore("CONTINENT", "CONTINENT"), 0);
  assert.equal(continenceScore("DIAPERS", undefined), 2);
});

// ── Section F — Cognition (max 8, memory + behavior modifiers, capped) ───────
test("cognition: memory plus behavior modifiers, capped at 8", () => {
  assert.equal(behaviorModifier(["WANDERING", "SUNDOWNING"]), 2);
  assert.equal(behaviorModifier(["AGGRESSIVE"]), 2);
  assert.equal(behaviorModifier(["CALM", "AGITATED"]), 0);
  assert.equal(cognitionScore("MILD", ["WANDERING"]), 3); // 2 + 1
  assert.equal(cognitionScore("SEVERE", ["AGGRESSIVE"]), 8); // 8 + 2 → capped at 8
  assert.equal(cognitionScore("NORMAL", undefined), 0);
});

// ── Section G — Nursing (max 8, 1 pt per procedure, routine flags are 0) ─────
test("nursing: counts scoring procedures only, routine flags score 0", () => {
  assert.equal(nursingScore(["WOUND_CARE", "OXYGEN", "IV_MEDICATION"]), 3);
  assert.equal(nursingScore(["MED_ADMIN", "VITAL_SIGNS", "BLOOD_SUGAR"]), 0); // all 0-pt flags
  assert.equal(nursingScore(["WOUND_CARE", "OXYGEN", "NEBULIZATION", "CATHETER_CARE", "PEG_FEEDING", "SUCTIONING", "IV_MEDICATION", "FREQUENT_RN"]), 8);
  assert.equal(nursingScore(undefined), 0);
});

// ── Section H — Clinical Risk (max 12, 4 risks × 0..3) ───────────────────────
test("risk: sums four risk channels, all-high hits the 12 ceiling", () => {
  assert.equal(riskScore({ fall: "HIGH", aspiration: "HIGH", pressure: "HIGH", infection: "HIGH" }), 12);
  assert.equal(riskScore({ fall: "MODERATE", infection: "LOW" }), 3);
  assert.equal(riskScore(undefined), 0);
});

// ── Section M — total and level classification ───────────────────────────────
test("classifyLevel: band boundaries map to Levels 1–5", () => {
  assert.equal(classifyLevel(0).level, 1);
  assert.equal(classifyLevel(10).level, 1);
  assert.equal(classifyLevel(11).level, 2);
  assert.equal(classifyLevel(20).level, 2);
  assert.equal(classifyLevel(21).level, 3);
  assert.equal(classifyLevel(30).level, 3);
  assert.equal(classifyLevel(31).level, 4);
  assert.equal(classifyLevel(40).level, 4);
  assert.equal(classifyLevel(41).level, 5);
  assert.equal(classifyLevel(50).level, 5);
});

test("scoreAssessment: the six domains sum to a 0–50 total with the right level", () => {
  // A maxed-out resident: 12 + 6 + 4 + 8 + 8 + 12 = 50 → Level 5.
  const max = scoreAssessment({
    adl: Object.fromEntries(ADL_ITEMS.map((i) => [i, "DEPENDENT"])) as never,
    walking: "BEDBOUND",
    urinary: "CATHETER", bowel: "INCONTINENT",
    memory: "SEVERE", behaviors: ["AGGRESSIVE"],
    nursing: ["WOUND_CARE", "OXYGEN", "NEBULIZATION", "CATHETER_CARE", "PEG_FEEDING", "SUCTIONING", "IV_MEDICATION", "FREQUENT_RN"],
    risk: { fall: "HIGH", aspiration: "HIGH", pressure: "HIGH", infection: "HIGH" },
  });
  assert.equal(max.total, 50);
  assert.equal(max.level, 5);
  assert.equal(max.adl, 12);
  assert.equal(max.mobility, 6);
  assert.equal(max.continence, 4);
  assert.equal(max.cognition, 8);
  assert.equal(max.nursing, 8);
  assert.equal(max.risk, 12);

  // An empty assessment scores 0 → Level 1.
  const empty = scoreAssessment({});
  assert.equal(empty.total, 0);
  assert.equal(empty.level, 1);

  // A moderate resident: ADL 5 + mobility 3 + continence 2 + cognition 5 + nursing 2 + risk 3 = 20 → Level 2.
  const mod = scoreAssessment({
    adl: { bathing: "DEPENDENT", dressing: "ASSISTANCE", grooming: "ASSISTANCE", toileting: "INDEPENDENT", feeding: "ASSISTANCE" },
    walking: "WALKER",
    urinary: "DIAPERS", bowel: "CONTINENT",
    memory: "MODERATE", behaviors: ["CALM"],
    nursing: ["WOUND_CARE", "OXYGEN"],
    risk: { fall: "MODERATE", infection: "LOW" },
  });
  assert.equal(mod.total, 20);
  assert.equal(mod.level, 2);
});

// ── Stage 5 — effective level (override wins over computed) ──────────────────
test("effectiveLevel: override beats the computed level, else falls back", () => {
  assert.equal(effectiveLevel({ scores: { level: 3 } as never }), 3);
  assert.equal(effectiveLevel({ overrideLevel: 5, scores: { level: 3 } as never }), 5);
  assert.equal(effectiveLevel({}), 1);
});

// ── Stage 13 — reassessment scheduling ───────────────────────────────────────
test("reviewIntervalDays: parses day counts; event-driven interval is null", () => {
  assert.equal(reviewIntervalDays("30 Days"), 30);
  assert.equal(reviewIntervalDays("180 Days"), 180);
  assert.equal(reviewIntervalDays("Upon Significant Change in Condition"), null);
  assert.equal(reviewIntervalDays(undefined), null);
});

test("computeNextReview / isReassessmentDue: due once the interval elapses", () => {
  const next = computeNextReview("2026-01-01T00:00:00.000Z", "30 Days");
  assert.equal(next, "2026-01-31T00:00:00.000Z");
  assert.equal(isReassessmentDue(next, "2026-01-30T00:00:00.000Z"), false);
  assert.equal(isReassessmentDue(next, "2026-01-31T00:00:00.000Z"), true);
  assert.equal(isReassessmentDue(next, "2026-02-05T00:00:00.000Z"), true);
  assert.equal(isReassessmentDue(computeNextReview("2026-01-01T00:00:00.000Z", "Upon Significant Change in Condition"), "2030-01-01T00:00:00.000Z"), false);
});

// ── Stage 8 — care-plan generation ───────────────────────────────────────────
test("deriveProblems: flagged domains seed editable problem lines", () => {
  const problems = deriveProblems({
    adl: { bathing: "DEPENDENT" },
    walking: "WALKER",
    memory: "MODERATE",
    nursing: ["WOUND_CARE", "IV_MEDICATION", "MED_ADMIN"],
    risk: { fall: "HIGH", infection: "LOW" }, // only fall (Mod/High) seeds a problem
  });
  const domains = problems.map((p) => p.domain);
  assert.ok(domains.includes("ADL"));
  assert.ok(domains.includes("MOBILITY"));
  assert.ok(domains.includes("COGNITION"));
  assert.ok(domains.includes("NURSING"));
  assert.ok(domains.includes("RISK"));
  // Nursing problem lists only the scoring procedures, not the routine flag.
  const nursing = problems.find((p) => p.domain === "NURSING")!;
  assert.ok(nursing.interventions.some((i) => i.includes("Wound")));
  assert.ok(!nursing.interventions.some((i) => i.toLowerCase().includes("medication administration")));
  // Only one RISK problem (fall); infection was Low so excluded.
  assert.equal(problems.filter((p) => p.domain === "RISK").length, 1);
  // Every seeded problem is fully formed and starts OPEN.
  for (const p of problems) {
    assert.ok(p.id && p.problem && p.goal && p.expectedOutcome && p.responsible);
    assert.equal(p.status, "OPEN");
  }
  // An empty assessment seeds no problems.
  assert.equal(deriveProblems({}).length, 0);
});

test("cloneForReassessment: carries the clinical picture, resets the lifecycle", () => {
  const prior: PreAdmissionAssessment = {
    id: "a1", status: "VALIDATED", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-10T00:00:00.000Z",
    residentName: "Jane Doe", walking: "WALKER", memory: "MODERATE",
    scores: { level: 3 } as never, overrideLevel: 4, validation: { by: "RN", role: "NURSE", at: "x", decision: "APPROVED" },
    carePlan: { problems: [], generatedAt: "x", updatedAt: "x" }, nextReviewDate: "2026-04-01T00:00:00.000Z",
  };
  const next = cloneForReassessment(prior, "a2", "2026-04-02T00:00:00.000Z");
  assert.equal(next.id, "a2");
  assert.equal(next.status, "DRAFT");
  assert.equal(next.priorAssessmentId, "a1");
  assert.equal(next.residentName, "Jane Doe"); // clinical picture carried
  assert.equal(next.walking, "WALKER");
  assert.equal(next.overrideLevel, undefined); // lifecycle reset
  assert.equal(next.validation, undefined);
  assert.equal(next.carePlan, undefined);
  assert.equal(next.scores, undefined);
  assert.equal(next.dateOfAssessment, "2026-04-02");
});
