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
