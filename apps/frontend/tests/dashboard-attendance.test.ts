// Shift Command presence — "CG Present 0 while a caregiver is clocked in".
//
// The dashboard used to read only the best-effort TimeTracking mirror. Presence now
// derives from the authoritative `staff_clock_events` log, which every clock in/out
// writes. These cover the two rules that make that safe: latest-event-wins, and an
// IN older than the attendance window is stale, not presence.
import test from "node:test";
import assert from "node:assert/strict";

import { onDutyFromClockLog, parseClockEvents, isOnDuty, type ClockEvent } from "../src/lib/staffClock.ts";
import { resolveOnDuty, isCaregiver, isNurse, type StaffLike } from "../src/lib/dashboard/presence.ts";

const WINDOW_START = new Date("2026-09-11T06:00:00+08:00");
let seq = 0;
const ev = (userId: string, type: "IN" | "OUT", at: string): ClockEvent =>
  ({ id: `e${seq++}`, userId, name: `Staff ${userId}`, role: "CAREGIVER", type, at });

test("a clocked-in caregiver is on duty", () => {
  const onDuty = onDutyFromClockLog([ev("u1", "IN", "2026-09-11T14:05:00+08:00")], WINDOW_START);
  assert.deepEqual([...onDuty.keys()], ["u1"]);
  assert.equal(onDuty.get("u1")?.name, "Staff u1");
});

test("latest event wins regardless of array order", () => {
  // The store prepends, so newest is first — but never rely on that.
  const out = [ev("u1", "OUT", "2026-09-11T15:00:00+08:00"), ev("u1", "IN", "2026-09-11T14:00:00+08:00")];
  assert.equal(onDutyFromClockLog(out, WINDOW_START).has("u1"), false, "clocked out");
  assert.equal(onDutyFromClockLog([...out].reverse(), WINDOW_START).has("u1"), false, "same, order flipped");

  const backIn = [...out, ev("u1", "IN", "2026-09-11T16:00:00+08:00")];
  assert.equal(onDutyFromClockLog(backIn, WINDOW_START).has("u1"), true, "clocked back in");
});

test("a stale IN before the attendance window is not presence", () => {
  // Someone who clocked in days ago and never clocked out must not staff today.
  const stale = [ev("u1", "IN", "2026-09-08T06:00:00+08:00")];
  assert.equal(onDutyFromClockLog(stale, WINDOW_START).has("u1"), false);
  // ...but the shared helper alone WOULD call them on duty — which is exactly why
  // the dashboard bounds the window instead of reusing isOnDuty directly.
  assert.equal(isOnDuty(stale, "u1"), true);
});

test("presence is per user and ignores malformed rows", () => {
  const events = [
    ev("u1", "IN", "2026-09-11T14:00:00+08:00"),
    ev("u2", "OUT", "2026-09-11T14:00:00+08:00"),
    ev("u3", "IN", "not-a-date"),
    { ...ev("u4", "IN", "2026-09-11T14:00:00+08:00"), type: "BREAK" as unknown as "IN" },
  ];
  assert.deepEqual([...onDutyFromClockLog(events, WINDOW_START).keys()], ["u1"]);
});

test("parseClockEvents survives a corrupt app-setting value", () => {
  for (const raw of [null, undefined, "", "{not json", '{"a":1}']) {
    assert.deepEqual(parseClockEvents(raw), [], `raw=${String(raw)}`);
  }
  assert.equal(parseClockEvents(JSON.stringify([ev("u1", "IN", "2026-09-11T14:00:00+08:00")])).length, 1);
});

// ── resolveOnDuty: roster is the duty authority ─────────────────────────────
const EMPTY = { rostered: [], timeTracking: [], clockedIn: [], staff: [] };

test("a rostered caregiver is on duty with NO clock-in at all", () => {
  // The exact shape that reported "CG Present 0": one roster row for the active
  // shift, clock-in disabled, so no clock event and no TimeTracking row exists.
  const staff: StaffLike[] = [{
    id: "b9140680", userId: "90e1cf13", position: "Caregiver", user: { name: "QA Test 4", role: "CAREGIVER" },
  }];
  const onDuty = resolveOnDuty({
    ...EMPTY, staff,
    rostered: [{ caregiverStaffId: "b9140680", caregiverUserId: "90e1cf13", caregiverName: "QA Test 4" }],
  });
  assert.equal(onDuty.length, 1);
  assert.equal(onDuty.filter(isCaregiver).length, 1, "CG PRESENT must be 1, not 0");
  assert.equal(onDuty[0].name, "QA Test 4");
  assert.equal(onDuty[0].source, "roster");
});

test("one human rostered AND clocked in AND time-tracked counts once", () => {
  const staff: StaffLike[] = [{ id: "s1", userId: "u1", position: "Caregiver", user: { name: "Maria", role: "CAREGIVER" } }];
  const onDuty = resolveOnDuty({
    staff,
    rostered: [{ caregiverStaffId: "s1", caregiverUserId: "u1", caregiverName: "Maria" }],
    timeTracking: [{ staffId: "s1" }],
    clockedIn: [{ userId: "u1", name: "Maria", role: "CAREGIVER" }],
  });
  assert.equal(onDuty.length, 1, "must not triple count");
  assert.equal(onDuty[0].source, "roster", "roster evidence wins");
});

test("roster row implies caregiver duty even when the login role differs", () => {
  // A staffer whose account role is CARE_MANAGER still works the shift as a
  // caregiver when rostered — inferring discipline from User.role dropped them.
  const staff: StaffLike[] = [{ id: "s2", userId: "u2", position: "Care Manager", user: { name: "Grace", role: "CARE_MANAGER" } }];
  const onDuty = resolveOnDuty({ ...EMPTY, staff, rostered: [{ caregiverStaffId: "s2", caregiverUserId: "u2", caregiverName: "Grace" }] });
  assert.equal(onDuty.filter(isCaregiver).length, 1);
});

test("a clocked-in caregiver with no Staff row still counts", () => {
  const onDuty = resolveOnDuty({ ...EMPTY, clockedIn: [{ userId: "u9", name: "Temp Aide", role: "CAREGIVER" }] });
  assert.equal(onDuty.length, 1);
  assert.equal(onDuty[0].key, "user:u9", "falls back to the user id as the dedupe key");
  assert.equal(onDuty.filter(isCaregiver).length, 1);
});

test("discipline falls back to the position title", () => {
  // "Nurse Aide" is a real caregiver position in this roster (Maria Santos) and it
  // contains the word "nurse" — so the aide test must beat the nurse test.
  for (const position of ["Nurse Aide", "Care Aide", "Daily Assistance", "Care Assistant"]) {
    const staff: StaffLike[] = [{ id: "s3", userId: "u3", position, user: { name: "Ana", role: null } }];
    const onDuty = resolveOnDuty({ ...EMPTY, staff, timeTracking: [{ staffId: "s3" }] });
    assert.equal(onDuty.filter(isCaregiver).length, 1, `${position} is a caregiver`);
    assert.equal(onDuty.filter(isNurse).length, 0, `${position} is NOT the nurse on duty`);
  }
});

test("User.role wins over a misleading position title", () => {
  // Maria Santos really is role=CAREGIVER with position="Nurse Aide".
  const staff: StaffLike[] = [{ id: "s5", userId: "u5", position: "Nurse Aide", user: { name: "Maria Santos", role: "CAREGIVER" } }];
  const onDuty = resolveOnDuty({ ...EMPTY, staff, timeTracking: [{ staffId: "s5" }] });
  assert.equal(onDuty.filter(isCaregiver).length, 1);
  assert.equal(onDuty.filter(isNurse).length, 0);
});

test("nurses are identified separately from caregivers", () => {
  const staff: StaffLike[] = [{ id: "s4", userId: "u4", position: "Registered Nurse", user: { name: "Sarah", role: "NURSE" } }];
  const onDuty = resolveOnDuty({ ...EMPTY, staff, timeTracking: [{ staffId: "s4" }] });
  assert.equal(onDuty.filter(isNurse).length, 1);
  assert.equal(onDuty.filter(isCaregiver).length, 0);
});

test("an empty shift reports nobody on duty", () => {
  assert.deepEqual(resolveOnDuty(EMPTY), []);
});
