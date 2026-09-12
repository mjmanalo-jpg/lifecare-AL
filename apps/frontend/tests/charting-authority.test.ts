// Care is charted by the role that DELIVERS it. The board hides buttons and the API
// rejects the write from the same rule, so the two cannot drift apart.
import assert from "node:assert/strict";
import test from "node:test";

import { assistedByLabel, canChartOccurrence, isNurseOwned } from "../src/lib/lifecare/chartingAuthority.ts";

test("a nurse charts nurse-owned care and nothing else", () => {
  assert.equal(canChartOccurrence("NURSE", "Nurse"), true, "MAR / vitals are NOD work");
  assert.equal(canChartOccurrence("NURSE", "Caregiver"), false, "hygiene is the caregiver's to sign");
  assert.equal(canChartOccurrence("NURSE", "Other authorized"), false);
});

test("the care manager never charts — oversight reads the record", () => {
  for (const owner of ["Nurse", "Caregiver", "Other authorized", null]) {
    assert.equal(canChartOccurrence("CARE_MANAGER", owner), false, `owner=${owner}`);
  }
});

test("other oversight roles are read-only too", () => {
  assert.equal(canChartOccurrence("FACILITY_ADMIN", "Caregiver"), false);
  assert.equal(canChartOccurrence("PHYSICIAN", "Nurse"), false);
  assert.equal(canChartOccurrence("", "Nurse"), false, "an unknown role must not chart");
  assert.equal(canChartOccurrence(null, "Caregiver"), false);
});

test("caregivers keep charting the care they deliver", () => {
  assert.equal(canChartOccurrence("CAREGIVER", "Caregiver"), true);
  // Deliberately unchanged: whether a caregiver may sign a medication pass is a
  // separate policy question, not part of making the manager view read-only.
  assert.equal(canChartOccurrence("CAREGIVER", "Nurse"), true);
});

test("responsible role is matched regardless of casing or padding", () => {
  assert.equal(isNurseOwned(" nurse "), true);
  assert.equal(isNurseOwned("NURSE"), true);
  assert.equal(isNurseOwned("Caregiver"), false);
  assert.equal(isNurseOwned(undefined), false);
});

test("the read-only cell names who owes the care", () => {
  assert.equal(assistedByLabel("Nurse"), "NOD");
  assert.equal(assistedByLabel("Other authorized"), "OTH");
  assert.equal(assistedByLabel("Caregiver"), "CGs");
  assert.equal(assistedByLabel(null), "CGs", "an unset role defaults to the caregiver");
});
