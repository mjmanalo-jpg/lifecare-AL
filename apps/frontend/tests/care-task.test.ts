import assert from "node:assert";
import test from "node:test";
import {
  parseCareTask, upsertCareTask, parseTicks, toggleTick, ticksKey,
  to12h, toTimeInput, mergeCareTaskRows, careDayRank, type CareTaskRow,
} from "../src/lib/lifecare/careTask.ts";

test("careDayRank orders the day 06:00 → 04:00 (Morning → Night, wrapping midnight)", () => {
  const times = ["00:00", "02:00", "04:00", "06:00", "08:00", "14:00", "22:00", "23:00"];
  const sorted = [...times].sort((a, b) => careDayRank(a) - careDayRank(b));
  assert.deepEqual(sorted, ["06:00", "08:00", "14:00", "22:00", "23:00", "00:00", "02:00", "04:00"]);
  assert.equal(careDayRank("06:00"), 0, "morning starts the day");
  assert.ok(careDayRank("04:00") > careDayRank("22:00"), "early-morning sorts after late night");
  assert.equal(careDayRank(""), Number.MAX_SAFE_INTEGER, "blank sorts last");
});

test("to12h renders PH 12-hour (not military) from HH:MM or HHMM", () => {
  assert.equal(to12h("00:00"), "12:00 AM");
  assert.equal(to12h("0800"), "8:00 AM");
  assert.equal(to12h("12:00"), "12:00 PM");
  assert.equal(to12h("18:30"), "6:30 PM");
  assert.equal(to12h("23:00"), "11:00 PM");
  assert.equal(to12h(""), "");
});

test("toTimeInput normalizes to HH:MM for a time picker", () => {
  assert.equal(toTimeInput("0800"), "08:00");
  assert.equal(toTimeInput("08:00"), "08:00");
  assert.equal(toTimeInput(""), "");
});

test("mergeCareTaskRows: draft follows the routine seed + keeps lifestyle rows; approved is frozen", () => {
  const seed: CareTaskRow[] = [
    { id: "d1@0800", time: "08:00", activity: "Breakfast", assistance: "Supervision", assistedBy: "CGs" },
    { id: "d2@0630", time: "06:30", activity: "Morning hygiene", assistance: "Extensive Assist", assistedBy: "CGs" },
  ];
  // no saved → pure seed
  assert.deepEqual(mergeCareTaskRows(undefined, seed), seed);
  // draft with an edited clinical row + a nurse-added lifestyle row (non-"@" id)
  const saved = {
    rows: [
      { id: "d1@0800", time: "08:00", activity: "Breakfast", assistance: "Observation", assistedBy: "CGs" },
      { id: "life-1", time: "09:10", activity: "Checking of VS", assistance: "Fully Dependent", assistedBy: "NOD" },
    ],
    approved: false, updatedAt: "x",
  };
  const merged = mergeCareTaskRows(saved, seed);
  assert.equal(merged.length, 3, "2 clinical + 1 lifestyle");
  assert.equal(merged.find((r) => r.id === "d1@0800")!.assistance, "Observation", "edit preserved");
  assert.ok(merged.some((r) => r.id === "life-1"), "lifestyle row kept");
  // stale clinical row whose id is no longer in the seed is dropped (not duped)
  const stale = { rows: [{ id: "OLD@0000", time: "00:00", activity: "Old", assistance: "x", assistedBy: "CGs" }], approved: false, updatedAt: "x" };
  assert.deepEqual(mergeCareTaskRows(stale, seed), seed, "stale seed rows dropped");
  // approved is frozen (verbatim), ignoring the seed
  const appr = { rows: [{ id: "z", time: "10:00", activity: "Frozen", assistance: "x", assistedBy: "CGs" }], approved: true, updatedAt: "x" };
  assert.deepEqual(mergeCareTaskRows(appr, seed), appr.rows);
});

test("parseCareTask tolerates junk and preserves approval", () => {
  assert.deepEqual(parseCareTask(null), {});
  assert.deepEqual(parseCareTask("not json"), {});
  const raw = JSON.stringify({
    r1: { rows: [{ id: "a", time: "0800", activity: "Bath", assistance: "Supervision", assistedBy: "CGs" }], approved: true, approvedAt: "x", approvedBy: "Nurse", updatedAt: "y" },
    bad: { rows: "nope" },
  });
  const m = parseCareTask(raw);
  assert.equal(Object.keys(m).length, 1);
  assert.equal(m.r1.rows.length, 1);
  assert.equal(m.r1.approved, true);
  assert.equal(m.r1.approvedBy, "Nurse");
});

test("upsertCareTask replaces only the target resident", () => {
  const m = { r1: { rows: [], updatedAt: "1" } };
  const n = upsertCareTask(m, "r2", { rows: [], updatedAt: "2" });
  assert.ok(n.r1 && n.r2);
  assert.notEqual(n, m);
});

test("toggleTick adds then removes a cell", () => {
  const k = ticksKey("r1", 2026, 9);
  assert.equal(k, "r1:2026-09");
  let m: Record<string, string[]> = {};
  m = toggleTick(m, k, "0800|3");
  assert.deepEqual(m[k], ["0800|3"]);
  m = toggleTick(m, k, "0800|3");
  assert.deepEqual(m[k], []);
});

test("parseTicks filters non-strings", () => {
  const m = parseTicks(JSON.stringify({ "r1:2026-09": ["0800|1", 5, "0900|2"] }));
  assert.deepEqual(m["r1:2026-09"], ["0800|1", "0900|2"]);
});
