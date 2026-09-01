// Per-shift care-plan task routing: each frequency occurrence is owned by the
// caregiver rostered for THE SHIFT that occurrence falls in — so a BID task lands
// on the AM caregiver at 08:00 and the PM caregiver at 18:00, not both on one.
import test from "node:test";
import assert from "node:assert/strict";

import { occurrencesFor } from "../src/lib/carePlanTaskRouting.ts";
import { assigneeForResidentShift, type CaregiverSchedule } from "../src/lib/caregiverSchedule.ts";

// A 3-shift roster for one resident on 2026-09-01: CG1 AM, CG2 PM, CG3 NOC.
const RID = "arthur";
const at = new Date("2026-09-01T10:00:00+08:00"); // any moment on the rostered day
const base = { residentIds: [RID], createdAt: "", caregiverUserId: undefined } as const;
const roster: CaregiverSchedule[] = [
  { ...base, id: "a", date: "2026-09-01", shift: "AM", caregiverStaffId: "cg1", caregiverName: "Caregiver 1", residentIds: [RID] },
  { ...base, id: "b", date: "2026-09-01", shift: "PM", caregiverStaffId: "cg2", caregiverName: "Caregiver 2", residentIds: [RID] },
  { ...base, id: "c", date: "2026-09-01", shift: "NOC", caregiverStaffId: "cg3", caregiverName: "Caregiver 3", residentIds: [RID] },
];

test("BID splits across the AM and PM caregivers", () => {
  const occ = occurrencesFor("Twice daily (BID)");
  assert.deepEqual(occ.map((o) => o.shift), ["AM", "PM"]);
  const assignees = occ.map((o) => assigneeForResidentShift(roster, RID, o.shift, at, "Asia/Manila")?.caregiverStaffId);
  assert.deepEqual(assignees, ["cg1", "cg2"]);
});

test("Every shift routes one card to each of the 3 shift caregivers", () => {
  const occ = occurrencesFor("Every shift");
  assert.deepEqual(occ.map((o) => o.shift), ["AM", "PM", "NOC"]);
  const assignees = occ.map((o) => assigneeForResidentShift(roster, RID, o.shift, at, "Asia/Manila")?.caregiverStaffId);
  assert.deepEqual(assignees, ["cg1", "cg2", "cg3"]);
});

test("a single-occurrence Daily task is owned by the AM caregiver, due end of AM shift", () => {
  const occ = occurrencesFor("Daily");
  assert.equal(occ.length, 1);
  assert.equal(occ[0].shift, "AM");
  assert.equal(occ[0].hour, 14); // AM shift end
  assert.equal(assigneeForResidentShift(roster, RID, occ[0].shift, at, "Asia/Manila")?.caregiverStaffId, "cg1");
});

test("PRN yields no auto occurrences", () => {
  assert.equal(occurrencesFor("PRN / as needed").length, 0);
});

test("an occurrence whose shift has no rostered caregiver resolves to null (unassigned card)", () => {
  const amOnly = roster.filter((r) => r.shift === "AM");
  assert.equal(assigneeForResidentShift(amOnly, RID, "PM", at, "Asia/Manila"), null);
  assert.equal(assigneeForResidentShift(amOnly, RID, "AM", at, "Asia/Manila")?.caregiverStaffId, "cg1");
});
