// Narrative assessment report — the prose report printed from the Journey feed,
// the Forms tab, Care Acuity and the LOC sign-off board.
//
// Guards the two things that make the printed form wrong for a reader:
//   - it must not assert clinical facts about domains that were never assessed;
//   - a thin Layer 1 (reassessment raised from Care Acuity) must be backfilled
//     before printing, or the Clinical Summary collapses to "<name> is a resident."
//
// Run: node --import ./tests/alias-hooks.mjs --test tests/narrative-report.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import { buildNarrativeHtml, enrichForReport } from "../src/lib/lifecare/narrativeReport.ts";
import type { AssessmentV42 } from "../src/lib/lifecare/assessment.ts";

const base = (over: Partial<AssessmentV42> = {}): AssessmentV42 => ({
  id: "av42-1",
  status: "VALIDATED",
  origin: "PREADMISSION",
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  layer1: { residentName: "Jane Cruz", assessmentDate: "2026-09-08", sex: "F", dateOfBirth: "1944-03-02" },
  domains: {},
  context: {},
  layer3: {},
  ...over,
} as AssessmentV42);

test("pre-admission vs reassessment titling", () => {
  assert.match(buildNarrativeHtml(base()), /Pre-Admission Resident Assessment Report/);
  assert.match(buildNarrativeHtml(base({ layer3: { priorAssessmentId: "av42-0" } })), /Resident Reassessment Report/);
  // Raised from the Care Acuity board = a reassessment even without a prior id.
  assert.match(buildNarrativeHtml(base({ origin: "ACUITY" })), /Resident Reassessment Report/);
});

test("clinical summary only speaks to domains that were assessed", () => {
  // AS-10 absent entirely — an unscored domain must not read as "continent".
  const blank = buildNarrativeHtml(base());
  assert.ok(!blank.includes("remains continent"), "claimed continence for an unassessed domain");
  assert.ok(!blank.includes("behavioural concerns"), "claimed behaviour finding for an unassessed domain");

  // Scored 0 → the claim is earned.
  const scored = buildNarrativeHtml(base({ domains: { "AS-10": { score: 0 }, "AS-05": { score: 0 } } } as Partial<AssessmentV42>));
  assert.ok(scored.includes("remains continent"));
  assert.ok(scored.includes("shows no significant behavioural concerns"));
});

test("enrichForReport backfills a thin Layer 1 from the prior assessment and resident row", () => {
  const prior = base({ id: "av42-0", layer1: { residentName: "Jane Cruz", residentId: "r1", dateOfBirth: "1944-03-02", diagnoses: "Type 2 diabetes", medications: "Metformin 500mg" } });
  const thin = base({ id: "av42-2", layer1: { residentName: "Jane Cruz", residentId: "r1" }, layer3: { priorAssessmentId: "av42-0" } });

  const out = enrichForReport(thin, [prior, thin], [{ id: "r1", firstName: "Jane", lastName: "Cruz", gender: "Female", allergies: "Penicillin" }]);
  assert.equal(out.layer1.diagnoses, "Type 2 diabetes");
  assert.equal(out.layer1.dateOfBirth, "1944-03-02");
  assert.equal(out.layer1.sex, "Female");      // only the Resident row has it
  assert.equal(out.layer1.allergies, "Penicillin");
  assert.equal(out.id, "av42-2");              // still the assessment being printed

  // The degenerate summary is gone once enriched.
  assert.ok(buildNarrativeHtml(thin).includes("Jane Cruz is a resident."));
  assert.ok(!buildNarrativeHtml(out).includes("Jane Cruz is a resident."));
  assert.match(buildNarrativeHtml(out), /medical history includes Type 2 diabetes/);
});
