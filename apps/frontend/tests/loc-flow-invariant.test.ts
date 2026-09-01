// LOC-flow invariant — locks the chain: nurse/CM-validated Final LOC → loc_history
// → the level everything downstream (Care Plan, billing, directory) reads via
// activeLevel(). Guards against regressions where the Care Plan silently shows a
// level that disagrees with the validated assessment (the ELMA FABROS bug: an
// L1-validated resident stuck on the coarse careLevel enum → L2).
import test from "node:test";
import assert from "node:assert/strict";

import { activeLevel } from "../src/lib/lifecare/activeLevel.ts";
import type { LocHistoryEntry } from "../src/lib/lifecare/locHistory.ts";

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
