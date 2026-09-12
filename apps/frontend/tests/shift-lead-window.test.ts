// Shift lead-in: a caregiver who logs in shortly BEFORE their rostered shift
// starts already sees the shift and its assigned residents/routine.
import test from "node:test";
import assert from "node:assert/strict";

import {
  SHIFT_LEAD_MINUTES, currentShiftKey, isScheduleActiveAt, activeResidentIdsFor,
  type CaregiverSchedule,
} from "../src/lib/caregiverSchedule.ts";

const TZ = "Asia/Manila";
const pm: CaregiverSchedule = {
  id: "s1", date: "2026-09-01", shift: "PM", caregiverStaffId: "cg2",
  caregiverUserId: "u2", caregiverName: "Caregiver 2", residentIds: ["arthur"], createdAt: "",
};
const at = (hhmm: string, day = "01") => new Date(`2026-09-${day}T${hhmm}:00+08:00`);

test("lead-in is 15 minutes", () => assert.equal(SHIFT_LEAD_MINUTES, 15));

test("PM shift opens 15 min early and still closes on the grace window", () => {
  assert.equal(isScheduleActiveAt(pm, at("13:40"), TZ), false); // 20 min out — still closed
  assert.equal(isScheduleActiveAt(pm, at("13:45"), TZ), true);  // lead-in opens
  assert.equal(isScheduleActiveAt(pm, at("14:00"), TZ), true);
  assert.equal(isScheduleActiveAt(pm, at("22:59"), TZ), true);  // 60 min grace
  assert.equal(isScheduleActiveAt(pm, at("23:05"), TZ), false);
});

test("assigned residents resolve during the lead-in", () => {
  assert.deepEqual(activeResidentIdsFor("u2", [pm], at("13:50"), TZ), ["arthur"]);
  assert.deepEqual(activeResidentIdsFor("u2", [pm], at("13:30"), TZ), []);
});

test("currentShiftKey rolls forward into the incoming shift", () => {
  // `at()` builds Manila instants, so the zone must be passed — without it the
  // assertion silently re-reads the SERVER's clock and only held on a PH machine.
  assert.equal(currentShiftKey(at("13:30"), TZ), "AM");
  assert.equal(currentShiftKey(at("13:50"), TZ), "PM");
  assert.equal(currentShiftKey(at("21:50"), TZ), "NOC");
  assert.equal(currentShiftKey(at("05:50"), TZ), "AM");
  assert.equal(currentShiftKey(at("23:50"), TZ), "NOC"); // no midnight wrap into AM
});

test("currentShiftKey buckets in the FACILITY zone, not the server's", () => {
  // 14:10 Manila is 06:10 UTC — a UTC server must still call this PM.
  const manilaPM = new Date("2026-09-01T14:10:00+08:00");
  assert.equal(currentShiftKey(manilaPM, TZ), "PM");
  assert.equal(currentShiftKey(new Date("2026-09-01T13:50:00+08:00"), TZ), "PM"); // lead-in
});

test("AM and NOC lead-ins do not underflow the day boundary", () => {
  const am = { ...pm, id: "s2", shift: "AM" as const };
  assert.equal(isScheduleActiveAt(am, at("05:45"), TZ), true);
  assert.equal(isScheduleActiveAt(am, at("05:30"), TZ), false);
  const noc = { ...pm, id: "s3", shift: "NOC" as const };
  assert.equal(isScheduleActiveAt(noc, at("21:45"), TZ), true);
  assert.equal(isScheduleActiveAt(noc, at("21:30"), TZ), false);
  assert.equal(isScheduleActiveAt(noc, at("05:00", "02"), TZ), true); // next-day tail
});
