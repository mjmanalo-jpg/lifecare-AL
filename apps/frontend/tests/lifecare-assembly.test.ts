// SLMS v4.2 Assembly Engine (Sub-project #2) — acceptance tests are the workbook
// "Acceptance Test" column for Routine Assembly Rules steps 1-13 & 20.
import test from "node:test";
import assert from "node:assert/strict";

import { assembleRoutine, staffingConflict, demo as assemblyDemo, type AssembleInput } from "../src/lib/lifecare/assembleRoutine.ts";
import { occurrencesForDate, demo as hfDemo, type DaySchedule } from "../src/lib/lifecare/highFrequency.ts";
import { EXCEPTION_REASON } from "../src/lib/lifecare/vocab.ts";

const base = (over: Partial<AssembleInput> = {}): AssembleInput => ({
  residentId: "R1",
  finalLoc: "LOC 4",
  assessmentVersion: "v4.2",
  domains: [],
  activeConditions: [],
  orders: {},
  effectiveDate: "2026-09-05",
  ...over,
});
const locIds = (defs: { sourceLocBundleId?: string }[]) =>
  defs.map((d) => d.sourceLocBundleId).filter(Boolean).sort();

test("highFrequency + assembly self-checks (demo) pass", () => {
  hfDemo();
  assemblyDemo();
});

// Rule 10 — occurrencesForDate (frequency extension)
test("Rule 10: six-while-awake → 6 distinct; day_of_week + every_other_day gate by date", () => {
  const six = occurrencesForDate("while_awake", { intervalHours: 3, wakeStart: 7, wakeEnd: 22 }, "2026-09-05");
  assert.equal(six.length, 6);
  assert.equal(new Set(six.map((o) => o.time)).size, 6);
  const dow: DaySchedule = { days: ["Mon", "Wed", "Fri"], times: ["10:00"] };
  assert.equal(occurrencesForDate("day_of_week", dow, "2026-09-09").length, 1); // Wed
  assert.equal(occurrencesForDate("day_of_week", dow, "2026-09-08").length, 0); // Tue
  const eod: DaySchedule = { everyOtherDayFrom: "2026-09-05", times: ["09:00"] };
  assert.equal(occurrencesForDate("every_other_day", eod, "2026-09-05").length, 1);
  assert.equal(occurrencesForDate("every_other_day", eod, "2026-09-06").length, 0);
});

// Rule 1 — LOC baseline is chosen only by finalLoc
test("Rule 1: changing active conditions does not change the LOC baseline", () => {
  const plain = assembleRoutine(base());
  const withCond = assembleRoutine(base({ activeConditions: ["DM-01"], orders: { freeText: [{ orderRef: "O1", kind: "monitoring", parameter: "glucose 70-180", authorizedRole: "Nurse", startDate: "2026-09-01" }] } }));
  assert.deepEqual(locIds(plain), locIds(withCond), "LOC baseline bundle ids unchanged by a condition");
});

// Rule 2 — a domain with no active staff-action need generates no event
test("Rule 2: activeNeed:false adds no event; activeNeed:true refines with provenance", () => {
  const none = assembleRoutine(base({ finalLoc: "LOC 1" }));
  const inactive = assembleRoutine(base({ finalLoc: "LOC 1", domains: [{ code: "AS-06", name: "Clinical", score: 2, activeNeed: false }] }));
  assert.equal(inactive.length, none.length, "inactive domain adds nothing");
  const active = assembleRoutine(base({ domains: [{ code: "AS-01", name: "ADLs", score: 4, activeNeed: true, goalId: "G1" }] }));
  assert.ok(active.some((e) => e.sourceAsDomain === "AS-01" && e.asScore === 4), "AS-01 refinement carries provenance");
});

// Rule 3 / 20 — Memory pathway independent of LOC
test("Rule 3/20: same Memory pathway at LOC 2 and LOC 4; LOC never derived from memory", () => {
  const loc2 = assembleRoutine(base({ finalLoc: "LOC 2", memoryIntensity: "Enhanced" }));
  const loc4 = assembleRoutine(base({ finalLoc: "LOC 4", memoryIntensity: "Enhanced" }));
  const mem2 = loc2.find((e) => e.memoryPathwayId);
  const mem4 = loc4.find((e) => e.memoryPathwayId);
  assert.ok(mem2 && mem4 && mem2.memoryPathwayId === mem4.memoryPathwayId, "same memoryPathwayId at both LOCs");
  assert.equal((mem2!.originalRecommendation as any).finalLoc, "LOC 2");
  assert.equal((mem4!.originalRecommendation as any).finalLoc, "LOC 4");
  // memory value never written into an LOC field
  assert.ok(loc2.every((e) => e.sourceLocBundleId !== mem2!.memoryPathwayId), "memory id not in an LOC field");
  const noMem = assembleRoutine(base({ finalLoc: "LOC 4" }));
  assert.ok(noMem.every((e) => !e.memoryPathwayId), "LOC 4 without memory has no memory pathway");
});

// Rule 4 — inactive historic conditions produce no tasks
test("Rule 4: a condition not in activeConditions yields no event", () => {
  const without = assembleRoutine(base());
  assert.ok(without.every((e) => e.conditionBundleId !== "DM-01"), "DM-01 absent when not active");
});

// Rule 5 / 11 — orders + clinical scope
test("Rule 5/11: orderRequired without an order is BLOCKED; dysphagia vs regular diet blocks", () => {
  const noMed = assembleRoutine(base());
  const med = noMed.find((e) => e.resultSchemaKey === "Medication Support");
  assert.ok(med && med.status === "BLOCKED" && /order/i.test(med.blockReason ?? ""), "med event blocked without order");
  const withMed = assembleRoutine(base({ orders: { medications: [{ id: "M1", name: "Amlodipine", dosage: "5mg", frequency: "OD", route: "oral", startDate: "2026-09-01" }] } }));
  const med2 = withMed.find((e) => e.resultSchemaKey === "Medication Support");
  assert.ok(med2 && med2.status === "DRAFT" && med2.orderRef === "M1", "med event has order → DRAFT");
  const dysph = assembleRoutine(base({ activeConditions: ["DYSPH-01"], orders: { diet: { id: "D1", dietType: "Regular", texture: "regular", mealType: "all", startDate: "2026-09-01" } } }));
  const meal = dysph.find((e) => e.conditionBundleId === "DYSPH-01");
  assert.ok(meal && meal.status === "BLOCKED" && /diet contradiction/i.test(meal.blockReason ?? ""), "dysphagia + regular diet blocks");
});

// Rule 6 — preferences appear in caregiver instruction
test("Rule 6: wake-time preference shifts the morning window and appears in instructions", () => {
  const out = assembleRoutine(base({ preferences: { wakeTime: "07:30" } }));
  const hygiene = out.find((e) => e.resultSchemaKey === "ADL / Personal Care" && /hygiene/i.test(e.name));
  assert.ok(hygiene, "a hygiene event exists");
  assert.match(hygiene!.instructions, /Preferred wake time 07:30/);
  assert.deepEqual(hygiene!.schedule.times, ["07:30"]);
});

// Rule 7 — atomic: one result schema + one completion control per event
test("Rule 7: every emitted event has exactly one result schema + completion control", () => {
  const out = assembleRoutine(base({ domains: [{ code: "AS-01", name: "ADLs", score: 3, activeNeed: true }], activeConditions: ["DYSPH-01"], memoryIntensity: "Enhanced" }));
  for (const e of out) {
    assert.ok(typeof e.resultSchemaKey === "string" && e.resultSchemaKey.length > 0, `${e.name} has a result schema`);
    assert.ok(typeof e.completionControl === "string" && e.completionControl.length > 0, `${e.name} has a completion control`);
  }
});

// Rule 8 — meal + dysphagia → one meal event, not duplicates
test("Rule 8: meal support + DYSPH-01 produces exactly one meal event with precautions", () => {
  const out = assembleRoutine(base({ activeConditions: ["DYSPH-01"] }));
  const meals = out.filter((e) => e.resultSchemaKey === "Meal / Supplement");
  assert.equal(meals.length, 1, "one merged meal event");
  assert.equal(meals[0].conditionBundleId, "DYSPH-01", "carries swallow precautions");
});

// Rule 9 — assistance conflict recorded; staffing conflict helper
test("Rule 9: assistance conflict recorded (never silent); staffingConflict detects 1 vs 2 person", () => {
  const out = assembleRoutine(base({ domains: [{ code: "AS-01", name: "ADLs", score: 2, activeNeed: true }] }));
  const conflicted = out.find((e) => (e.originalRecommendation as any).assistance);
  assert.ok(conflicted, "a level conflict is recorded in originalRecommendation");
  const rec = (conflicted!.originalRecommendation as any).assistance;
  assert.ok(rec.prior && rec.recommended && rec.prior !== rec.recommended, "prior + recommended captured, not silently applied");
  assert.equal(staffingConflict("Two-person", "One-person"), true);
  assert.equal(staffingConflict("Two-person", "Two caregivers"), false);
  assert.equal(staffingConflict("Standby", undefined), false);
});

// Rule 12 — exception set is canonical vocabulary and never a completion
test("Rule 12: every event's exceptionSet ⊆ EXCEPTION_REASON", () => {
  const out = assembleRoutine(base({ domains: [{ code: "AS-01", name: "ADLs", score: 3, activeNeed: true }], activeConditions: ["DYSPH-01"] }));
  for (const e of out) {
    for (const ex of e.exceptionSet) assert.ok((EXCEPTION_REASON as readonly string[]).includes(ex), `${e.name} exception "${ex}" is canonical`);
  }
});

// Rule 13 — resident-specific threshold overrides the generic escalation example
test("Rule 13: freeText threshold overrides the generic escalation trigger", () => {
  const out = assembleRoutine(base({
    activeConditions: ["HTN-01"],
    orders: { freeText: [{ orderRef: "BP1", kind: "monitoring", parameter: "BP > 160", authorizedRole: "Nurse", startDate: "2026-09-01" }] },
  }));
  const vital = out.find((e) => e.resultSchemaKey === "Vital Signs" && e.orderRef === "BP1");
  assert.ok(vital, "HTN-01 vital event bound to the monitoring order");
  assert.equal(vital!.escalationTrigger, "BP > 160", "resident-specific parameter wins");
});

// purity guard
test("assembleRoutine is deterministic (same input → identical output)", () => {
  const inp = base({ domains: [{ code: "AS-01", name: "ADLs", score: 3, activeNeed: true }], activeConditions: ["DYSPH-01"], memoryIntensity: "Enhanced" });
  assert.deepEqual(assembleRoutine(inp), assembleRoutine(inp));
});
