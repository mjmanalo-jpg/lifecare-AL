import assert from "node:assert/strict";
import test from "node:test";

import {
  currentShiftKey,
  resolveShift,
  schedulesForShift,
  shiftWindow,
  type CaregiverSchedule,
} from "../src/lib/caregiverSchedule.ts";

const TZ = "Asia/Manila"; // UTC+8, no DST

// 07:53 on 12 Sep in Manila — which is still 11 Sep, 23:53 in UTC. A dashboard that
// resolves the shift with the SERVER's clock calls this NOC on the 11th; the facility
// is on its AM shift of the 12th. Vercel runs functions in UTC, so this is production.
const MANILA_MORNING = new Date("2026-09-11T23:53:00Z");

test("the active shift is resolved in the facility zone, not the server's", () => {
  const shift = resolveShift(MANILA_MORNING, TZ);
  assert.equal(shift.key, "AM");
  assert.equal(shift.date, "2026-09-12");
});

test("the shift window is a true instant range, not a server-local wall clock", () => {
  const { start, end } = shiftWindow("2026-09-12", "AM", TZ);
  assert.equal(start.toISOString(), "2026-09-11T22:00:00.000Z"); // 06:00 Manila
  assert.equal(end.toISOString(), "2026-09-12T06:00:00.000Z"); // 14:00 Manila
});

test("a NOC shift after midnight still belongs to the day it started", () => {
  // 00:30 Manila on 12 Sep = 16:30 UTC on 11 Sep.
  const shift = resolveShift(new Date("2026-09-11T16:30:00Z"), TZ);
  assert.equal(shift.key, "NOC");
  assert.equal(shift.date, "2026-09-11");
  assert.equal(shift.end.toISOString(), "2026-09-11T22:00:00.000Z"); // 06:00 Manila, 12 Sep
});

test("a resident on the published AM roster is covered, so no coverage gap is raised", () => {
  const roster: CaregiverSchedule[] = [
    {
      id: "cs_1", date: "2026-09-12", shift: "AM", caregiverStaffId: "staff_1",
      caregiverName: "Ana", residentIds: ["res_1"], createdAt: "2026-09-12T06:00:00+08:00",
    },
  ];
  const shift = resolveShift(MANILA_MORNING, TZ);
  const covered = new Set(schedulesForShift(roster, shift).flatMap((item) => item.residentIds));
  assert.ok(covered.has("res_1"), "AM roster must cover the resident during the AM shift");
});

test("the roster of another shift does not count as coverage", () => {
  const roster: CaregiverSchedule[] = [
    {
      id: "cs_2", date: "2026-09-12", shift: "PM", caregiverStaffId: "staff_2",
      caregiverName: "Ben", residentIds: ["res_1"], createdAt: "2026-09-12T06:00:00+08:00",
    },
  ];
  const shift = resolveShift(MANILA_MORNING, TZ);
  assert.equal(schedulesForShift(roster, shift).length, 0);
});

test("currentShiftKey keeps its facility-zone contract", () => {
  assert.equal(currentShiftKey(MANILA_MORNING, TZ), "AM");
});
