import assert from "node:assert/strict";
import test from "node:test";

import {
  CAREGIVER_DASHBOARD_AREAS,
  CAREGIVER_DASHBOARD_SUBTITLE,
  CAREGIVER_DASHBOARD_TITLE,
  caregiverDashboardArea,
} from "../src/lib/dashboard/caregiverZones.ts";

const EXPECTED_AREA_KEYS = [
  "my-residents",
  "my-care-now",
  "my-care-next",
  "my-care-later",
  "document-care",
  "need-nurse-help",
  "assignment-update",
  "shift-close",
];

test("Caregiver dashboard follows the Facility My Shift areas in the reference", () => {
  assert.deepEqual(CAREGIVER_DASHBOARD_AREAS.map(({ key }) => key), EXPECTED_AREA_KEYS);
  assert.equal(CAREGIVER_DASHBOARD_TITLE, "Caregiver Dashboard - Facility My Shift");
});

test("Caregiver dashboard subtitle covers residents, care, documentation, help, updates, and close", () => {
  for (const phrase of ["Assigned residents", "approved care", "documentation", "help requests", "assignment updates", "shift close"]) {
    assert.match(CAREGIVER_DASHBOARD_SUBTITLE, new RegExp(phrase, "i"));
  }
});

test("Caregiver care sections preserve the Now, Next, Later sequence", () => {
  assert.deepEqual(
    CAREGIVER_DASHBOARD_AREAS.slice(1, 4).map(({ title }) => title),
    ["My Care Now", "My Care Next", "My Care Later"],
  );
});

test("Caregiver support and close sections carry the required behavior", () => {
  assert.match(caregiverDashboardArea("need-nurse-help").description, /clinical change/i);
  assert.match(caregiverDashboardArea("need-nurse-help").description, /second assist/i);
  assert.match(caregiverDashboardArea("assignment-update").description, /Acknowledge nurse reassignment/i);
  assert.match(caregiverDashboardArea("shift-close").description, /completed or given a reason/i);
});

test("each Caregiver area has actionable copy and a governed empty state", () => {
  for (const key of EXPECTED_AREA_KEYS) {
    const area = caregiverDashboardArea(key as Parameters<typeof caregiverDashboardArea>[0]);
    assert.ok(area.description.length > 45, `${key} needs decision context`);
    assert.ok(area.emptyTitle.length > 10, `${key} needs an explicit empty state`);
    assert.ok(area.emptyHint.length > 20, `${key} needs an explanatory empty hint`);
  }
});
