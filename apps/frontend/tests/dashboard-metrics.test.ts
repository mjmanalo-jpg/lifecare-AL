import test from "node:test";
import assert from "node:assert/strict";

import { metric } from "../src/lib/dashboard/metrics.ts";

const base = {
  key: "care_delivery", label: "Care delivery", numeratorLabel: "completed",
  denominatorLabel: "due", definition: "Completed divided by due.", window: "AM shift",
  sourceModels: ["Task"], href: "/nurse/caredelivery", baseline: "Previous shift: 80%",
};

test("metric contract preserves lineage, baseline, window, and exclusions", () => {
  const value = metric({ ...base, numerator: 9, denominator: 10, exclusions: ["Cancelled"] });
  assert.equal(value.display, "90%");
  assert.equal(value.state, "WATCH");
  assert.equal(value.baseline, "Previous shift: 80%");
  assert.deepEqual(value.exclusions, ["Cancelled"]);
  assert.deepEqual(value.sourceModels, ["Task"]);
});

test("zero denominator is explicit and never reports a false percentage", () => {
  const value = metric({ ...base, numerator: 0, denominator: 0 });
  assert.equal(value.display.includes("%"), false);
  assert.equal(value.denominator, 0);
});

test("nothing owed yet is not an alarm", () => {
  // Early in a shift no care is owed and no event is charted, so the ratio is 0/0.
  // Treating that as ACTION put three red "ACT NOW" cards on the board with a dash
  // for a value — the care manager was being paged about the absence of measurement.
  const value = metric({ ...base, numerator: 0, denominator: 0 });
  assert.equal(value.state, "GOOD");
  assert.equal(value.display, "—");
});

test("measured failure is still an alarm", () => {
  const value = metric({ ...base, numerator: 0, denominator: 12 });
  assert.equal(value.state, "ACTION");
  assert.equal(value.display, "0%");
});
