import assert from "node:assert/strict";
import test from "node:test";

import {
  NURSE_COMMAND_SHORTCUTS,
  NURSE_DASHBOARD_SUBTITLE,
  NURSE_DASHBOARD_TITLE,
  NURSE_DASHBOARD_ZONES,
  nurseDashboardZone,
} from "../src/lib/dashboard/nurseZones.ts";

const EXPECTED_ZONE_KEYS = [
  "clinical-triage",
  "caregiver-deployment",
  "shift-watchlist",
  "care-delivery-status",
  "next-two-hours",
  "new-since-shift",
  "shift-endorsement",
];

test("Nurse dashboard follows the seven shift-command zones in the reference", () => {
  assert.deepEqual(NURSE_DASHBOARD_ZONES.map(({ key }) => key), EXPECTED_ZONE_KEYS);
  assert.equal(NURSE_DASHBOARD_TITLE, "Nurse Dashboard - Shift Command");
});

test("Nurse dashboard states the four immediate shift questions", () => {
  assert.match(NURSE_DASHBOARD_SUBTITLE, /clinical attention/i);
  assert.match(NURSE_DASHBOARD_SUBTITLE, /caring for whom/i);
  assert.match(NURSE_DASHBOARD_SUBTITLE, /safely and on time/i);
  assert.match(NURSE_DASHBOARD_SUBTITLE, /carry forward/i);
});

test("Nurse command bar follows the six quick anchors in the reference", () => {
  assert.deepEqual(
    NURSE_COMMAND_SHORTCUTS.map(({ label }) => label),
    ["Act now", "Nurse review", "Due this shift", "Overdue", "Caregiver / coverage issue", "Handover"],
  );
});

test("clinical triage documents all four governed priorities", () => {
  const triage = nurseDashboardZone("clinical-triage");
  for (const priority of ["P1", "P2", "P3", "P4"]) {
    assert.match(triage.description, new RegExp(priority));
  }
});

test("each Nurse zone has actionable copy and a governed empty state", () => {
  for (const key of EXPECTED_ZONE_KEYS) {
    const zone = nurseDashboardZone(key as Parameters<typeof nurseDashboardZone>[0]);
    assert.ok(zone.description.length > 45, `${key} needs decision context`);
    assert.ok(zone.emptyTitle.length > 10, `${key} needs an explicit empty state`);
    assert.ok(zone.emptyHint.length > 20, `${key} needs an explanatory empty hint`);
  }
});
