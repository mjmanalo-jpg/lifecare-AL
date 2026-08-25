import test from "node:test";
import assert from "node:assert/strict";
import { domainDailyAllowance, domainInPackage } from "../src/lib/lifecare/carePackage.ts";

// Frequency allowance (times/day) — the LOC overage gate reads these.
test("L3 ADLs allows 4×/day (the worked example)", () => {
  assert.equal(domainDailyAllowance(3, "AS-01"), 4);
});
test("uncapped domains + L1 hands-on return null (no overage)", () => {
  assert.equal(domainDailyAllowance(3, "AS-04"), null); // cognition — monitoring, uncapped
  assert.equal(domainDailyAllowance(1, "AS-01"), null); // L1 package is monitoring-only
});
test("higher levels allow more continence/ADL deliveries", () => {
  assert.equal(domainDailyAllowance(4, "AS-10"), 6);
  assert.equal(domainDailyAllowance(2, "AS-10"), 3);
});
test("level clamps out of range", () => {
  assert.equal(domainDailyAllowance(9, "AS-01"), domainDailyAllowance(5, "AS-01"));
});

// Coverage — skin (AS-11) is out-of-package at L2 (matches the UI example).
test("domainInPackage: skin is not in the Level 2 package", () => {
  assert.equal(domainInPackage(2, "AS-11"), false);
  assert.equal(domainInPackage(3, "AS-11"), true);
});
