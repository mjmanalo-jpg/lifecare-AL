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
  // PM is 15:00–23:00, so the lead-in opens 14:45 and the grace closes 00:00.
  assert.equal(isScheduleActiveAt(pm, at("14:40"), TZ), false); // 20 min out — still closed
  assert.equal(isScheduleActiveAt(pm, at("14:45"), TZ), true);  // lead-in opens
  assert.equal(isScheduleActiveAt(pm, at("15:00"), TZ), true);
  assert.equal(isScheduleActiveAt(pm, at("23:59"), TZ), true);  // 60 min grace
  assert.equal(isScheduleActiveAt(pm, at("00:05", "02"), TZ), false);
});

test("assigned residents resolve during the lead-in", () => {
  assert.deepEqual(activeResidentIdsFor("u2", [pm], at("14:50"), TZ), ["arthur"]);
  assert.deepEqual(activeResidentIdsFor("u2", [pm], at("14:30"), TZ), []);
});

test("currentShiftKey rolls forward into the incoming shift", () => {
  // `at()` builds Manila instants, so the zone must be passed — without it the
  // assertion silently re-reads the SERVER's clock and only held on a PH machine.
  assert.equal(currentShiftKey(at("14:30"), TZ), "AM");
  assert.equal(currentShiftKey(at("14:50"), TZ), "PM");
  assert.equal(currentShiftKey(at("22:50"), TZ), "NOC");
  assert.equal(currentShiftKey(at("06:50"), TZ), "AM");
  assert.equal(currentShiftKey(at("23:50"), TZ), "NOC"); // no midnight wrap into AM
});

test("currentShiftKey buckets in the FACILITY zone, not the server's", () => {
  // 15:10 Manila is 07:10 UTC — a UTC server must still call this PM.
  const manilaPM = new Date("2026-09-01T15:10:00+08:00");
  assert.equal(currentShiftKey(manilaPM, TZ), "PM");
  assert.equal(currentShiftKey(new Date("2026-09-01T14:50:00+08:00"), TZ), "PM"); // lead-in
});

test("AM and NOC lead-ins do not underflow the day boundary", () => {
  const am = { ...pm, id: "s2", shift: "AM" as const };     // 07:00–15:00
  assert.equal(isScheduleActiveAt(am, at("06:45"), TZ), true);
  assert.equal(isScheduleActiveAt(am, at("06:30"), TZ), false);
  const noc = { ...pm, id: "s3", shift: "NOC" as const };    // 23:00–07:00
  assert.equal(isScheduleActiveAt(noc, at("22:45"), TZ), true);
  assert.equal(isScheduleActiveAt(noc, at("22:30"), TZ), false);
  assert.equal(isScheduleActiveAt(noc, at("06:00", "02"), TZ), true); // next-day tail
});

test("the 12-hour patterns cover their full window, lead-in and grace included", () => {
  const d12 = { ...pm, id: "s4", shift: "D12" as const };    // 07:00–19:00
  assert.equal(isScheduleActiveAt(d12, at("06:45"), TZ), true);   // lead-in
  assert.equal(isScheduleActiveAt(d12, at("15:30"), TZ), true);   // past the 8-hour AM end
  assert.equal(isScheduleActiveAt(d12, at("19:59"), TZ), true);   // 60 min grace
  assert.equal(isScheduleActiveAt(d12, at("20:05"), TZ), false);
  const n12 = { ...pm, id: "s5", shift: "N12" as const };    // 19:00–07:00
  assert.equal(isScheduleActiveAt(n12, at("18:45"), TZ), true);   // lead-in
  assert.equal(isScheduleActiveAt(n12, at("18:30"), TZ), false);
  assert.equal(isScheduleActiveAt(n12, at("23:30"), TZ), true);
  assert.equal(isScheduleActiveAt(n12, at("06:00", "02"), TZ), true); // next-day tail
  assert.equal(isScheduleActiveAt(n12, at("08:05", "02"), TZ), false);
});
