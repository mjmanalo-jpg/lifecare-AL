import test from "node:test";
import assert from "node:assert/strict";
import { domainDailyAllowance, domainInPackage, overageRecommendations, upsertOverageEvent, type UsageEvent, type OverageEvent } from "../src/lib/lifecare/carePackage.ts";

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
test("upsertOverageEvent keeps one row per resident/domain/day at the peak count", () => {
  const base: OverageEvent = { id: "e1", residentId: "R1", domain: "AS-10", level: 3, allowance: 4, count: 5, date: "2026-08-25", firstAt: "2026-08-25T10:00:00Z", lastAt: "2026-08-25T10:00:00Z" };
  let events = upsertOverageEvent([], base);
  assert.equal(events.length, 1);
  // Same resident/domain/day, higher count → merge (peak count, keep firstAt, new lastAt).
  events = upsertOverageEvent(events, { ...base, id: "e2", count: 9, lastAt: "2026-08-25T14:00:00Z" });
  assert.equal(events.length, 1);
  assert.equal(events[0].count, 9);
  assert.equal(events[0].id, "e1");                       // kept the original row
  assert.equal(events[0].firstAt, "2026-08-25T10:00:00Z"); // firstAt preserved
  assert.equal(events[0].lastAt, "2026-08-25T14:00:00Z");
  // A different day → a new row.
  events = upsertOverageEvent(events, { ...base, id: "e3", date: "2026-08-26" });
  assert.equal(events.length, 2);
});

test("overageRecommendations ignores other days + non-AS domains", () => {
  const recos = overageRecommendations([
    { residentId: "R1", domain: "AS-01", date: "2026-08-24T10:00:00Z" }, // yesterday
    { residentId: "R1", domain: "pain", date: "2026-08-25T10:00:00Z" },  // non-AS
  ], () => 3, "2026-08-25");
  assert.equal(recos.length, 0);
});
