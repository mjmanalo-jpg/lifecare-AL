// The care plan → 24-hour routine generator: each care window whose linked AS
// domains are in the plan becomes one routine event that bundles those domains'
// interventions, ordered by window start. Handover windows never generate.
import test from "node:test";
import assert from "node:assert/strict";

import { generateRoutine, ROUTINE_WINDOWS } from "../src/lib/lifecare/carePlanRoutine.ts";

const AS01 = { code: "AS-01", name: "ADLs / Personal Care", goal: "Maximize participation", interventions: ["Hands-on help with bathing"], taskId: "TASK-ADL-01" };
const AS08 = { code: "AS-08", name: "Nutrition / Hydration", goal: "Adequate intake", interventions: ["Meal setup", "Monitor intake"] };

test("clinical (non-baseline) windows generate only when their domain is in the plan", () => {
  const events = generateRoutine([AS01]);
  // AS-01 is scheduled in the Morning wake-up window (06:00, W04) per the sheet.
  assert.ok(events.some((e) => e.id === "W04" && e.shift === "AM"), "AS-01 wake-up window present");
  // Every NON-baseline event must have AS-01 among its domains (baseline meal/activity
  // windows are exempt — they fire for everyone).
  const baselineIds = new Set(ROUTINE_WINDOWS.filter((w) => w.baseline).map((w) => w.id));
  for (const ev of events) {
    if (baselineIds.has(ev.id)) continue;
    assert.ok(ev.domainCodes.includes("AS-01"), `${ev.id} is a clinical window driven by AS-01`);
  }
});

test("a window carries the interventions of its in-plan domains", () => {
  // AS-08 shares the 08:00 breakfast window; with AS-08 in the plan the event
  // carries AS-08's interventions (alongside the baseline meal tasks).
  const events = generateRoutine([AS08]);
  const breakfast = events.find((e) => /08:00/.test(e.window));
  assert.ok(breakfast, "breakfast window generated");
  assert.ok(breakfast!.interventions.includes("Meal setup"));
  assert.ok(breakfast!.interventions.includes("Monitor intake"));
});

test("handover / all-active-domains windows never generate", () => {
  const events = generateRoutine([AS01, AS08]);
  const handoverLabels = ROUTINE_WINDOWS.filter((w) => w.handover).map((w) => w.label);
  for (const ev of events) assert.ok(!handoverLabels.includes(ev.label));
});

test("meals & activities always generate (baseline), even with only AS-01 scored", () => {
  const events = generateRoutine([AS01]);
  // Breakfast (W05) and morning activity (W07) are baseline windows → present
  // despite AS-08 / AS-14 not being in the plan.
  const breakfast = events.find((e) => e.id === "W05");
  const activity = events.find((e) => e.id === "W07");
  assert.ok(breakfast, "baseline breakfast window generated");
  assert.ok(activity, "baseline activity window generated");
  assert.ok(breakfast!.interventions.includes("Set up meal tray and utensils"));
});

test("baseline window merges plan-domain tasks on top of baseline tasks", () => {
  const events = generateRoutine([AS08]); // AS-08 shares the breakfast window
  const breakfast = events.find((e) => e.id === "W05");
  assert.ok(breakfast!.interventions.includes("Set up meal tray and utensils"), "baseline meal task present");
  assert.ok(breakfast!.interventions.includes("Meal setup"), "AS-08 plan task merged in");
});

test("items carry stable ids for checklist rows", () => {
  const [ev] = generateRoutine([AS01]);
  assert.equal(ev.items.length, ev.interventions.length);
  assert.match(ev.items[0].id, /^W\d+#0$/);
});

test("empty plan still yields the baseline meal/activity windows", () => {
  const events = generateRoutine([]);
  assert.ok(events.length >= 5, "5 baseline windows generate with no scored domains");
  assert.ok(events.every((e) => e.interventions.length > 0));
});
