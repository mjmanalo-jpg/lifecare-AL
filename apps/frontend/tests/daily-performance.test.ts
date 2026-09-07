// Unit test for the Resident Daily Performance seed + persistence helpers.
// Run: node --test tests/daily-performance.test.ts

import test from "node:test";
import assert from "node:assert/strict";

import {
  scoreToAssistance,
  seedFromRoutine,
  parseDailyPerformance,
  upsertDailyPerformance,
  type DailyPerformanceMap,
} from "../src/lib/lifecare/dailyPerformance.ts";
import type { RoutineEvent } from "../src/lib/lifecare/carePlanRoutine.ts";

const ev = (o: Partial<RoutineEvent>): RoutineEvent => ({
  id: "W", window: "06:00-08:00", startHour: 6, shift: "AM", shiftLabel: "Morning",
  label: "Activity", role: "Caregiver", domainCodes: [], domainNames: [], goals: [],
  interventions: [], items: [], caregiver: "", nurse: "", ...o,
});

test("scoreToAssistance maps the 0-4 scale and defaults safely", () => {
  assert.equal(scoreToAssistance(0), "Observation");
  assert.equal(scoreToAssistance(1), "Supervision");
  assert.equal(scoreToAssistance(2), "Min. Assistance");
  assert.equal(scoreToAssistance(3), "Mod. Assistance");
  assert.equal(scoreToAssistance(4), "Fully Dependent");
  assert.equal(scoreToAssistance(undefined), "Supervision");
  assert.equal(scoreToAssistance(9), "Supervision");
});

test("seedFromRoutine derives time, assisted-by and assistance from routine", () => {
  const routine: RoutineEvent[] = [
    ev({ id: "W01", window: "06:00-08:00", label: "Wake-up, hygiene", role: "Caregiver", domainCodes: ["AS-01", "AS-03"] }),
    ev({ id: "W05", window: "08:00-08:30", label: "Due Meds given", role: "Nurse", domainCodes: ["AS-07"] }),
    ev({ id: "W07", window: "11:30-12:30", label: "LUNCH", role: "Caregiver", domainCodes: [] }), // baseline, no score
  ];
  const rows = seedFromRoutine(routine, { "AS-01": 1, "AS-03": 4, "AS-07": 2 });

  assert.equal(rows.length, 3);
  // Time is HHMM from the window start.
  assert.deepEqual(rows.map((r) => r.time), ["0600", "0800", "1130"]);
  // Caregiver → CGs, Nurse → NOD.
  assert.deepEqual(rows.map((r) => r.assistedBy), ["CGs", "NOD", "CGs"]);
  // Assistance uses the MAX score across the window's domains (AS-03=4 wins).
  assert.equal(rows[0].assistance, "Fully Dependent");
  assert.equal(rows[1].assistance, "Min. Assistance");
  // Baseline window with no scored domain → default.
  assert.equal(rows[2].assistance, "Supervision");
  // Stable, unique ids.
  assert.equal(new Set(rows.map((r) => r.id)).size, 3);
});

test("parseDailyPerformance is tolerant and round-trips through upsert", () => {
  assert.deepEqual(parseDailyPerformance(null), {});
  assert.deepEqual(parseDailyPerformance("not json"), {});
  assert.deepEqual(parseDailyPerformance("[1,2,3]"), {});
  // Entry without a rows array is dropped.
  assert.deepEqual(parseDailyPerformance(JSON.stringify({ r1: { updatedAt: "x" } })), {});

  const state = { rows: [{ id: "a", time: "0800", activity: "Breakfast", assistance: "Supervision", assistedBy: "CGs" }], updatedAt: "2026-09-05" };
  let map: DailyPerformanceMap = {};
  map = upsertDailyPerformance(map, "res-1", state);
  const parsed = parseDailyPerformance(JSON.stringify(map));
  assert.deepEqual(parsed["res-1"], state);

  // Junk rows are filtered; string fields coerced.
  const dirty = JSON.stringify({ "res-2": { rows: [null, { id: "b", time: 800 }], updatedAt: 1 } });
  const p2 = parseDailyPerformance(dirty);
  assert.deepEqual(p2["res-2"].rows, [{ id: "b", time: "", activity: "", assistance: "", assistedBy: "" }]);
  assert.equal(p2["res-2"].updatedAt, "");
});
