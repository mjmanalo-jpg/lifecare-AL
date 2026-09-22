// Nurse-editable shift table: a community can re-time the shipped shifts and add
// its own, and every window/coverage answer follows that table rather than the
// hardcoded defaults. Resident routine times never move — only who is on the clock.
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SHIFT_DEFS, parseShiftDefs, validateShiftDefs, newShiftKey, resolveShiftDefs,
  parseHHMM, toHHMM, to12h, type ShiftDef,
} from "../src/lib/shiftDefinitions.ts";
import {
  shiftList, shiftMeta, shiftCoversMinutes, shiftsOverlap, shiftOwningHour, ownerShifts,
  isScheduleActiveAt, assigneeForResidentAtHour, currentShiftKey,
  type CaregiverSchedule,
} from "../src/lib/caregiverSchedule.ts";

const TZ = "Asia/Manila";
const at = (hhmm: string, day = "01") => new Date(`2026-09-${day}T${hhmm}:00+08:00`);

// A facility that runs an early day shift and adds a supervisory mid shift.
const CUSTOM: ShiftDef[] = [
  { key: "AM", label: "AM Shift", start: "06:00", end: "14:00", builtin: true },
  { key: "PM", label: "PM Shift", start: "14:00", end: "22:00", builtin: true },
  { key: "NOC", label: "Noc Shift", start: "22:00", end: "06:00", builtin: true },
  { key: "MID", label: "Mid Shift", start: "10:00", end: "18:00" },
];

test("time helpers round-trip", () => {
  assert.equal(parseHHMM("07:00"), 420);
  assert.equal(parseHHMM("23:59"), 1439);
  assert.equal(parseHHMM("24:00"), null, "hour out of range");
  assert.equal(parseHHMM("7:0"), null, "minutes must be two digits");
  assert.equal(parseHHMM(""), null);
  assert.equal(toHHMM(420), "07:00");
  assert.equal(to12h(420), "7:00 AM");
  assert.equal(to12h(0), "12:00 AM");
  assert.equal(to12h(12 * 60), "12:00 PM");
  assert.equal(to12h(15 * 60 + 30), "3:30 PM");
});

test("with no stored table the shipped defaults apply (7-3 / 3-11 / 11-7 + 12h)", () => {
  const list = shiftList();
  assert.deepEqual(list.map((s) => s.key).sort(), ["AM", "D12", "N12", "NOC", "PM"]);
  assert.equal(shiftMeta("AM").start, "07:00");
  assert.equal(shiftMeta("AM").end, "15:00");
  assert.equal(shiftMeta("NOC").nextDay, true, "11pm-7am wraps midnight");
  assert.equal(shiftMeta("D12").hours, 12);
  assert.equal(shiftOwningHour(8), "AM");
});

test("a re-timed shift moves every window answer that depends on it", () => {
  // 06:30 is Noc under the defaults (AM starts 07:00) but AM under this table.
  assert.equal(shiftOwningHour(6.5), "NOC");
  assert.equal(shiftCoversMinutes("AM", 6 * 60 + 30), false);
  assert.equal(shiftCoversMinutes("AM", 6 * 60 + 30, CUSTOM), true);
  assert.equal(shiftOwningHour(6.5, CUSTOM), "AM");
  assert.equal(shiftMeta("AM", CUSTOM).range, "6:00 AM – 2:00 PM");
  // ...and the end moves with it: 14:30 is AM by default, PM here.
  assert.equal(shiftOwningHour(14.5), "AM");
  assert.equal(shiftOwningHour(14.5, CUSTOM), "PM");
});

test("a nurse-added shift is rosterable and covers its own hours", () => {
  assert.ok(shiftList(CUSTOM).some((s) => s.key === "MID"));
  assert.equal(shiftCoversMinutes("MID", 11 * 60, CUSTOM), true);
  assert.equal(shiftCoversMinutes("MID", 9 * 60, CUSTOM), false);
  assert.equal(shiftCoversMinutes("MID", 18 * 60, CUSTOM), false, "end is exclusive");
  // It overlaps the shifts it straddles, which is allowed and drives the
  // double-booking guard in the roster form.
  assert.equal(shiftsOverlap("MID", "AM", CUSTOM), true);
  assert.equal(shiftsOverlap("MID", "NOC", CUSTOM), false);
});

test("owning shifts are the non-overlapping tiling set, so an overlay never owns a time", () => {
  // Defaults: the 8-hour trio tiles the day; the 12-hour patterns overlap it.
  assert.deepEqual(ownerShifts().map((s) => s.key), ["AM", "PM", "NOC"]);
  // With a MID overlay added, the trio still owns the clock.
  assert.deepEqual(ownerShifts(CUSTOM).map((s) => s.key), ["AM", "PM", "NOC"]);
  assert.equal(shiftOwningHour(11, CUSTOM), "AM", "11:00 belongs to AM, not the MID overlay");
});

test("a custom wrapping shift keeps access across midnight, lead-in and grace", () => {
  const row: CaregiverSchedule = {
    id: "s1", date: "2026-09-01", shift: "NOC", caregiverStaffId: "cg1",
    caregiverUserId: "u1", caregiverName: "CG", residentIds: ["r1"], createdAt: "",
  };
  // CUSTOM Noc is 22:00-06:00, so it opens at 21:45 and closes at 07:00 next day.
  assert.equal(isScheduleActiveAt(row, at("21:45"), TZ, CUSTOM), true);
  assert.equal(isScheduleActiveAt(row, at("21:30"), TZ, CUSTOM), false);
  assert.equal(isScheduleActiveAt(row, at("05:00", "02"), TZ, CUSTOM), true);
  assert.equal(isScheduleActiveAt(row, at("06:59", "02"), TZ, CUSTOM), true, "60-min grace");
  assert.equal(isScheduleActiveAt(row, at("07:30", "02"), TZ, CUSTOM), false);
  // The same row under the DEFAULT table (23:00-07:00) is not yet live at 21:45.
  assert.equal(isScheduleActiveAt(row, at("21:45"), TZ), false);
});

test("routing follows the community's clock, not the shift's name", () => {
  const roster: CaregiverSchedule[] = [
    { id: "a", date: "2026-09-01", shift: "AM", caregiverStaffId: "cg1", caregiverName: "Early", residentIds: ["r1"], createdAt: "" },
    { id: "b", date: "2026-09-01", shift: "MID", caregiverStaffId: "cg2", caregiverName: "Mid", residentIds: ["r1"], createdAt: "" },
  ];
  const now = at("09:00");
  const who = (hour: number) => assigneeForResidentAtHour(roster, "r1", hour, now, TZ, CUSTOM)?.caregiverStaffId;
  assert.equal(who(6.5), "cg1", "06:30 is inside this facility's AM shift");
  assert.equal(who(11), "cg1", "both cover 11:00 - the tighter 8h shift wins");
  assert.equal(who(16), "cg2", "only the MID overlay is still on at 16:00");
  assert.equal(who(20), undefined, "nobody rostered - the card stays unassigned");
});

test("currentShiftKey reads the community's boundaries", () => {
  assert.equal(currentShiftKey(at("06:30"), TZ), "NOC");
  assert.equal(currentShiftKey(at("06:30"), TZ, CUSTOM), "AM");
});

test("parseShiftDefs rejects junk and falls back rather than emptying the roster", () => {
  assert.equal(parseShiftDefs(null), null);
  assert.equal(parseShiftDefs("not json"), null);
  assert.equal(parseShiftDefs('{"key":"AM"}'), null, "must be an array");
  assert.equal(parseShiftDefs("[]"), null, "empty table falls back to defaults");
  assert.equal(parseShiftDefs('[{"key":"AM","label":"AM","start":"25:00","end":"15:00"}]'), null);
  const ok = parseShiftDefs(JSON.stringify(CUSTOM));
  assert.equal(ok?.length, 4);
  // A null table resolves to the shipped defaults, never to no shifts at all.
  assert.equal(resolveShiftDefs(null).length, DEFAULT_SHIFT_DEFS.length);
});

test("validation blocks tables that would strand the roster", () => {
  assert.deepEqual(validateShiftDefs(CUSTOM), []);
  const dup = [...CUSTOM, { key: "MID", label: "Another", start: "01:00", end: "02:00" }];
  assert.ok(validateShiftDefs(dup).some((e) => /duplicate/i.test(e)));
  const zero = [...CUSTOM.slice(0, 3), { key: "X", label: "X", start: "08:00", end: "08:00" }];
  assert.ok(validateShiftDefs(zero).some((e) => /same time/i.test(e)));
  const noName = [...CUSTOM.slice(0, 3), { key: "X", label: "  ", start: "08:00", end: "09:00" }];
  assert.ok(validateShiftDefs(noName).some((e) => /give the shift a name/i.test(e)));
  // The three tiling shifts are named directly by task routing, so losing one is an error.
  assert.ok(validateShiftDefs(CUSTOM.filter((d) => d.key !== "NOC")).some((e) => /NOC/.test(e)));
  assert.ok(validateShiftDefs([]).some((e) => /at least one shift/i.test(e)));
});

test("newShiftKey derives a readable key and never collides", () => {
  assert.equal(newShiftKey("Mid Shift", []), "MID_SHIFT");
  assert.equal(newShiftKey("Mid Shift", ["MID_SHIFT"]), "MID_SHIFT_2");
  assert.equal(newShiftKey("", ["SHIFT"]), "SHIFT_2");
});

test("an unknown shift key still resolves, so a deleted shift never crashes a roster row", () => {
  const meta = shiftMeta("GONE", CUSTOM);
  assert.ok(meta, "falls back to the first shift rather than throwing");
  assert.equal(typeof meta.range, "string");
});
