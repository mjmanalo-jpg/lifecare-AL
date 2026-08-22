import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_MANAGER_DASHBOARD_SUBTITLE,
  CARE_MANAGER_DASHBOARD_TITLE,
  CARE_MANAGER_DASHBOARD_ZONES,
  careManagerZone,
} from "../src/lib/dashboard/careManagerZones.ts";

const EXPECTED_ZONE_KEYS = [
  "clinical-risk",
  "assessment-loc",
  "care-plan-governance",
  "care-delivery-reliability",
  "safety-transitions",
  "staffing-team-quality",
  "open-decisions",
];

test("Care Manager dashboard follows the seven governance zones in the reference", () => {
  assert.deepEqual(CARE_MANAGER_DASHBOARD_ZONES.map(({ key }) => key), EXPECTED_ZONE_KEYS);
  assert.deepEqual(
    CARE_MANAGER_DASHBOARD_ZONES.map(({ title }) => title.slice(0, 2)),
    ["A.", "B.", "C.", "D.", "E.", "F.", "G."],
  );
});

test("Care Manager dashboard is aggregate-first rather than a second nurse shift screen", () => {
  assert.equal(CARE_MANAGER_DASHBOARD_TITLE, "Care Manager / Clinical Lead Dashboard");
  assert.match(CARE_MANAGER_DASHBOARD_SUBTITLE, /across residents and shifts/i);
  assert.match(CARE_MANAGER_DASHBOARD_SUBTITLE, /drill-downs/i);
});

test("each governance zone has actionable copy and a governed empty state", () => {
  for (const key of EXPECTED_ZONE_KEYS) {
    const zone = careManagerZone(key as Parameters<typeof careManagerZone>[0]);
    assert.ok(zone.description.length > 45, `${key} needs decision context`);
    assert.ok(zone.emptyTitle.length > 10, `${key} needs an explicit empty state`);
    assert.ok(zone.emptyHint.length > 20, `${key} needs an explanatory empty hint`);
  }
});
