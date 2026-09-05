// SLMS v4.2 Routine Foundations (Sub-project #1) — self-checks + cross-file integrity.
// Acceptance criteria from docs/superpowers/specs/2026-09-05-slms-routine-foundations-design.md.
import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_STATE, CARE_OUTCOME, EXCEPTION_REASON, CLINICAL_FINDING, ESCALATION_STATE, PRIORITY,
  countsAsCompleted, fromLegacyOutcome, type LegacyOutcome,
} from "../src/lib/lifecare/vocab.ts";
import {
  assistanceForScore, ASSISTANCE_DISPLAY, parseSupport, defaultRole, ROLE_ABBR,
} from "../src/lib/lifecare/assistance.ts";
import { schemaFor, validateResult, RESULT_SCHEMAS } from "../src/lib/lifecare/resultSchema.ts";
import { bundlesForLoc, ALL_LOC_BUNDLES } from "../src/lib/lifecare/locBundles.ts";
import {
  ALL_CONDITION_PATHWAYS, memoryPathways, careDeliveryMap, pathwaysForConditions, CARE_DELIVERY_MAP,
} from "../src/lib/lifecare/conditionPathways.ts";
import domainsRaw from "../src/lib/lifecare/data/assessment_domains.json" with { type: "json" };

const DOMAIN_CODES = new Set((domainsRaw as Array<{ code: string }>).map((d) => d.code));
const SCHEMA_TYPES = new Set(RESULT_SCHEMAS.map((s) => s.eventType));

// ---- A. Controlled Vocabulary ----
test("vocab: outcomes count completed correctly", () => {
  assert.equal(countsAsCompleted("Completed as planned"), true);
  assert.equal(countsAsCompleted("Completed with variance"), true);
  assert.equal(countsAsCompleted("Not completed"), false);
});

test("vocab: fromLegacyOutcome bridges all 8 legacy outcomes; never a completed exception", () => {
  const legacy: LegacyOutcome[] = [
    "Completed", "Not Required", "Refused", "Unable", "Unsafe",
    "Increased Assist", "Frequency Variance", "Clinical Change",
  ];
  for (const o of legacy) {
    const r = fromLegacyOutcome(o);
    assert.ok(CARE_OUTCOME.includes(r.outcome), `${o} maps to a valid outcome`);
    if (r.exception) assert.ok(EXCEPTION_REASON.includes(r.exception));
    if (r.finding) assert.ok(CLINICAL_FINDING.includes(r.finding));
    // "Not completed" must carry an exception; a finding is never a completion state.
    if (r.outcome === "Not completed") assert.ok(r.exception, `${o} not-completed carries an exception`);
  }
  assert.deepEqual(fromLegacyOutcome("Refused"), { outcome: "Not completed", exception: "Resident declined" });
});

test("vocab: the six field enums are disjoint (no value shared across fields)", () => {
  const fields = [WORKFLOW_STATE, CARE_OUTCOME, EXCEPTION_REASON, CLINICAL_FINDING, ESCALATION_STATE, PRIORITY];
  const seen = new Map<string, number>();
  fields.forEach((f, i) => f.forEach((v) => {
    assert.ok(!seen.has(v) || seen.get(v) === i, `value "${v}" appears in two vocab fields`);
    seen.set(v, i);
  }));
});

// ---- E. Assistance + role ----
test("assistance: score → canonical level and facility display label", () => {
  assert.equal(assistanceForScore(0), "Independent");
  assert.equal(assistanceForScore(4), "Total Assist");
  assert.equal(ASSISTANCE_DISPLAY[assistanceForScore(4)], "Fully Dependent");
  assert.equal(ASSISTANCE_DISPLAY[assistanceForScore(0)], "Observation");
});

test("assistance: parseSupport never puts staffing/equipment in the assistance level", () => {
  const p = parseSupport("Two-person/mechanical if approved", 3);
  assert.equal(p.assistanceLevel, "Extensive Assist"); // from score, not text
  assert.equal(p.staffing, "Two-person");
  assert.match(p.equipment ?? "", /Mechanical lift/);
  assert.doesNotMatch(p.assistanceLevel, /two|mechanical/i);
  const w = parseSupport("Standby/contact guard as approved", 2);
  assert.equal(w.assistanceLevel, "Minimal Assist");
  assert.equal(w.supervision, "Standby");
});

test("assistance: role defaults — medication/clinical → Nurse (NOD), else Caregiver (CGs)", () => {
  assert.equal(defaultRole("Medication", true), "Nurse");
  assert.equal(defaultRole("Clinical", false), "Nurse");
  assert.equal(defaultRole("Personal Care", false), "Caregiver");
  assert.equal(ROLE_ABBR[defaultRole("Medication", true)], "NOD");
  assert.equal(ROLE_ABBR[defaultRole("Personal Care", false)], "CGs");
});

// ---- D. Result schemas ----
test("resultSchema: 16 typed schemas; validateResult gates required fields + machine rules", () => {
  assert.equal(RESULT_SCHEMAS.length, 16);
  // Hydration: consumed cannot exceed offered.
  const bad = validateResult("Hydration", { amountOffered: 100, amountConsumed: 200, tolerance: "ok" });
  assert.equal(bad.ok, false);
  assert.ok(bad.invalid.some((m) => /exceed/.test(m)));
  const good = validateResult("Hydration", { amountOffered: 240, amountConsumed: 120, tolerance: "ok" });
  assert.equal(good.ok, true);
  // Missing required field is reported.
  const missing = validateResult("Hydration", { amountOffered: 240 });
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.length > 0);
  // Medication requires a MAR outcome.
  assert.equal(validateResult("Medication Support", { actualTime: "08:00" }).ok, false);
  assert.equal(validateResult("Medication Support", { marOutcome: "Given", actualTime: "08:00" }).ok, true);
});

// ---- B. LOC bundles ----
test("locBundles: 61 events, LOC4 has 16, all domains + schema keys resolve", () => {
  assert.equal(ALL_LOC_BUNDLES.length, 61);
  assert.equal(bundlesForLoc("LOC 4").length, 16);
  assert.equal(bundlesForLoc("LOC4").length, 16); // tolerant matching
  for (const b of ALL_LOC_BUNDLES) {
    assert.ok(SCHEMA_TYPES.has(b.resultSchemaKey), `${b.bundleEventId} resultSchemaKey resolves`);
    for (const d of b.asDomains) assert.ok(DOMAIN_CODES.has(d) || d === "ALL", `${b.bundleEventId} domain ${d} exists`);
  }
});

// ---- C. Condition pathways + care delivery map ----
test("conditionPathways: 20 pathways; Memory decoupled from LOC; priorities canonical", () => {
  assert.equal(ALL_CONDITION_PATHWAYS.length, 20);
  const mem = memoryPathways();
  assert.equal(mem.length, 4);
  for (const p of mem) assert.ok(p.crossLoc && p.memoryPathway, `${p.bundleId} is cross-LOC memory`);
  for (const p of ALL_CONDITION_PATHWAYS) {
    assert.ok(["Modify", "Add", "Replace", "Suppress"].includes(p.actionType), `${p.bundleId} actionType`);
    assert.ok(PRIORITY.includes(p.priority as any), `${p.bundleId} priority ${p.priority}`);
    for (const d of p.linkedDomains) assert.ok(DOMAIN_CODES.has(d) || d === "ALL", `${p.bundleId} domain ${d} exists`);
  }
  assert.ok(pathwaysForConditions(["Dysphagia"]).some((p) => p.bundleId === "DYSPH-01"));
});

test("careDeliveryMap: 14 domains × scores 0-4 = 70 entries; lookup works", () => {
  assert.equal(CARE_DELIVERY_MAP.length, 70);
  const entry = careDeliveryMap("AS-01", 4);
  assert.ok(entry && entry.caregiverTasks.length > 0, "AS-01 score 4 has caregiver tasks");
  for (let s = 0 as number; s <= 4; s++) {
    assert.ok(careDeliveryMap("AS-02", s), `AS-02 score ${s} present`);
  }
});
