import test from "node:test";
import assert from "node:assert/strict";
import { domainDailyAllowance, domainInPackage, overageRecommendations, type UsageEvent } from "../src/lib/lifecare/carePackage.ts";

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

// Usage overage — a resident who draws a domain more than the Level allows.
test("overageRecommendations flags a resident over their per-domain allowance", () => {
  const day = "2026-08-25";
  const ev = (domain: string, n: number): UsageEvent[] => Array.from({ length: n }, () => ({ residentId: "R1", domain, date: `${day}T10:00:00Z` }));
  const levelOf = () => 3; // L3: AS-10 (continence) allows 4/day
  const recos = overageRecommendations([...ev("AS-10", 5), ...ev("AS-04", 9)], levelOf, day);
  assert.equal(recos.length, 1); // AS-04 (cognition) is uncapped → never over
  assert.equal(recos[0].domain, "AS-10");
  assert.equal(recos[0].count, 5);
  assert.equal(recos[0].allowance, 4);
});
test("overageRecommendations ignores other days + non-AS domains", () => {
  const recos = overageRecommendations([
    { residentId: "R1", domain: "AS-01", date: "2026-08-24T10:00:00Z" }, // yesterday
    { residentId: "R1", domain: "pain", date: "2026-08-25T10:00:00Z" },  // non-AS
  ], () => 3, "2026-08-25");
  assert.equal(recos.length, 0);
});
