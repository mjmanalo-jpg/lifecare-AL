// LOC-flow invariant — locks the chain: nurse/CM-validated Final LOC → loc_history
// → the level everything downstream (Care Plan, billing, directory) reads via
// activeLevel(). Guards against regressions where the Care Plan silently shows a
// level that disagrees with the validated assessment (the ELMA FABROS bug: an
// L1-validated resident stuck on the coarse careLevel enum → L2).
import test from "node:test";
import assert from "node:assert/strict";

import { activeLevel } from "../src/lib/lifecare/activeLevel.ts";
import type { LocHistoryEntry } from "../src/lib/lifecare/locHistory.ts";
import type { AssessmentV42 } from "../src/lib/lifecare/assessment.ts";
import type { CareLevel } from "../src/lib/lifecare/types.ts";

// Minimal assessment fixture — activeLevel only reads status, updatedAt, layer1 keys
// and layer3.finalLevel (an explicit Final LOC short-circuits classification).
const asmt = (over: { residentId?: string; convertedAdmissionId?: string; residentName?: string; finalLevel?: CareLevel; status?: AssessmentV42["status"]; updatedAt?: string }): AssessmentV42 => ({
  id: `a-${over.residentName ?? over.residentId ?? "x"}`,
  status: over.status ?? "VALIDATED",
  modelVersion: "4.2/3.9",
  createdAt: over.updatedAt ?? "2026-09-01T00:00:00Z",
  updatedAt: over.updatedAt ?? "2026-09-01T00:00:00Z",
  layer1: { residentName: over.residentName ?? "", residentId: over.residentId, convertedAdmissionId: over.convertedAdmissionId },
  domains: {},
  context: {},
  layer3: { finalLevel: over.finalLevel },
} as AssessmentV42);

const entry = (over: Partial<LocHistoryEntry> = {}): LocHistoryEntry => ({
  id: "loc-1",
  residentId: "res-1",
  residentName: "Elma Fabros",
  level: "L1",
  source: "PRE_ADMISSION",
  at: "2026-09-01T00:00:00Z",
  ...over,
});

test("validated loc_history level wins over the coarse careLevel enum (the Elma bug)", () => {
  // Resident record still says ASSISTED (L2) but the latest validated entry is L1.
  const n = activeLevel({
    residentId: "res-1",
    careLevel: "ASSISTED",
    locHistory: [entry({ level: "L1", at: "2026-09-01T02:00:00Z" })],
    residentName: "Elma Fabros",
  });
  assert.equal(n, 1);
});

test("the most recent entry is authoritative (a validated change applied on top of a stale level)", () => {
  const n = activeLevel({
    residentId: "res-1",
    careLevel: "ASSISTED",
    locHistory: [
      entry({ id: "old", level: "L2", source: "PRE_ADMISSION", at: "2026-08-26T00:00:00Z" }),
      entry({ id: "new", level: "L1", source: "CLINICAL_OVERRIDE", at: "2026-09-01T00:00:00Z" }),
    ],
    residentName: "Elma Fabros",
  });
  assert.equal(n, 1);
});

test("matches by residentId even when the resident was later renamed", () => {
  const n = activeLevel({
    residentId: "res-1",
    careLevel: "ASSISTED",
    locHistory: [entry({ residentId: "res-1", residentName: "Elma Fabros", level: "L1" })],
    residentName: "Elma Titong Fabros", // renamed after the entry was written
  });
  assert.equal(n, 1);
});

test("name fallback surfaces a pre-admission entry captured before the resident id existed", () => {
  const n = activeLevel({
    residentId: "res-1",
    careLevel: "ASSISTED",
    locHistory: [entry({ residentId: undefined, residentName: "Elma Fabros", level: "L3" })],
    residentName: "  ELMA FABROS  ", // case-insensitive + surrounding whitespace trimmed
  });
  assert.equal(n, 3); // L3 must NOT collapse to the enum's L2 — this is why loc_history exists
});

test("no matching history → falls back to the careLevel enum", () => {
  assert.equal(activeLevel({ residentId: "res-x", careLevel: "INDEPENDENT", locHistory: [], residentName: "New Resident" }), 1);
  // An unrelated resident's entry must not leak across.
  assert.equal(activeLevel({ residentId: "res-x", careLevel: "INDEPENDENT", locHistory: [entry({ residentId: "res-other", residentName: "Someone Else", level: "L4" })], residentName: "New Resident" }), 1);
});

// --- Validated assessment Final LOC as authoritative source (Marina / Maria bug) ---

test("MARINA: no loc_history + ASSISTED enum → validated L3 assessment wins over enum's L2", () => {
  const n = activeLevel({
    residentId: "res-marina",
    careLevel: "ASSISTED", // collapses L2/L3 → 2
    locHistory: [],
    residentName: "MARINA DACANAY DACANAY DROHMAN", // resident record has a duplicated middle name
    assessments: [asmt({ residentId: "res-marina", residentName: "MARINA DACANAY DROHMAN", finalLevel: "L3" })],
  });
  assert.equal(n, 3);
});

test("MARIA: stale older PRE_ADMISSION L2 entry loses to the newer validated L1 assessment", () => {
  const n = activeLevel({
    residentId: "res-maria",
    careLevel: "INDEPENDENT",
    locHistory: [entry({ id: "stale", residentId: undefined, residentName: "Maria Marquez", level: "L2", at: "2026-08-31T00:00:00Z" })],
    residentName: "Maria Marquez",
    assessments: [asmt({ residentName: "Maria Marquez", finalLevel: "L1", updatedAt: "2026-09-01T00:00:00Z" })],
  });
  assert.equal(n, 1);
});

test("STRICT: a validated Final LOC wins even when a NEWER loc_history entry disagrees", () => {
  // The validated assessment is authoritative — a later LOC change must come through a
  // new validated (re)assessment, not a raw loc_history write.
  const n = activeLevel({
    residentId: "res-1",
    careLevel: "ASSISTED",
    locHistory: [entry({ level: "L4", source: "CLINICAL_OVERRIDE", at: "2026-09-05T00:00:00Z" })],
    residentName: "Elma Fabros",
    assessments: [asmt({ residentId: "res-1", residentName: "Elma Fabros", finalLevel: "L1", updatedAt: "2026-09-01T00:00:00Z" })],
  });
  assert.equal(n, 1);
});

test("STRICT: a validated OVERRIDE Final LOC (below the engine floor) is honoured verbatim", () => {
  // finalLevel carries the nurse-set override value (the "-ovr" case); it must not be
  // second-guessed against loc_history or the enum.
  const n = activeLevel({
    residentId: "res-ovr",
    careLevel: "INDEPENDENT", // enum would say L1
    locHistory: [entry({ id: "old", residentId: "res-ovr", residentName: "Override Case", level: "L2", at: "2026-08-01T00:00:00Z" })],
    residentName: "Override Case",
    assessments: [asmt({ residentId: "res-ovr", residentName: "Override Case", finalLevel: "L3", updatedAt: "2026-09-01T00:00:00Z" })],
  });
  assert.equal(n, 3);
});

test("token-set name match links an assessment despite reordered/duplicated name parts", () => {
  const n = activeLevel({
    residentId: "res-nolink",
    careLevel: "ASSISTED",
    locHistory: [],
    residentName: "Drohman Marina Dacanay",
    assessments: [asmt({ residentName: "Marina Dacanay Drohman", finalLevel: "L3" })],
  });
  assert.equal(n, 3);
});

test("REASSESSMENT: a newer VALIDATED reassessment changes the level the care plan reflects", () => {
  // Pre-admission validated L3, later reassessed and validated to L2 → the newest
  // validated result is authoritative, so the care plan reflects L2.
  const n = activeLevel({
    residentId: "res-r",
    careLevel: "ASSISTED",
    locHistory: [],
    residentName: "Reassessed Resident",
    assessments: [
      asmt({ residentId: "res-r", residentName: "Reassessed Resident", finalLevel: "L3", status: "VALIDATED", updatedAt: "2026-06-01T00:00:00Z" }),
      asmt({ residentId: "res-r", residentName: "Reassessed Resident", finalLevel: "L2", status: "VALIDATED", updatedAt: "2026-09-01T00:00:00Z" }),
    ],
  });
  assert.equal(n, 2);
});

test("REASSESSMENT: an in-progress (unvalidated) reassessment does NOT move the level until validated", () => {
  // A newer DRAFT reassessment proposing L4 must not change the level — the prior
  // VALIDATED L3 still governs until the reassessment is validated.
  const n = activeLevel({
    residentId: "res-r",
    careLevel: "ASSISTED",
    locHistory: [],
    residentName: "Reassessed Resident",
    assessments: [
      asmt({ residentId: "res-r", residentName: "Reassessed Resident", finalLevel: "L3", status: "VALIDATED", updatedAt: "2026-06-01T00:00:00Z" }),
      asmt({ residentId: "res-r", residentName: "Reassessed Resident", finalLevel: "L4", status: "DRAFT", updatedAt: "2026-09-01T00:00:00Z" }),
    ],
  });
  assert.equal(n, 3);
});

test("omitting assessments keeps the legacy loc_history → enum behaviour (backward compatible)", () => {
  assert.equal(activeLevel({ residentId: "res-1", careLevel: "ASSISTED", locHistory: [entry({ level: "L1" })], residentName: "Elma Fabros" }), 1);
});
