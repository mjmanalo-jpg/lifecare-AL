import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateDomainTriggers, baselineFor, advanceCase, addManagementNote, resolveCase,
  carryForwardScores, upsertDomainLog,
  PERSIST_DAYS, PERSIST_AGE_DAYS,
  type DomainLog, type DomainCase, type TriggerReason,
} from "../src/lib/lifecare/domainMonitoring.ts";

// ── helpers ──────────────────────────────────────────────────────────────────
let seq = 0;
const log = (date: string, shift: "AM" | "PM" | "NOC", scores: Record<string, number>): DomainLog => ({
  id: `l${seq++}`, residentId: "R1", date, shift, scores: scores as DomainLog["scores"],
  by: "Nurse A", at: `${date}T08:00:00.000Z`,
});
const reasonsFor = (logs: DomainLog[], baseline: Record<string, number> = {}, code = "AS-13") =>
  (evaluateDomainTriggers("R1", logs, baseline as never).find((t) => t.domain === code)?.reasons) ?? [];

// ── evaluateDomainTriggers: the 4 rules ──────────────────────────────────────
test("R1 baseline: score >= baseline+1 fires BASELINE", () => {
  const r = reasonsFor([log("2026-08-20", "AM", { "AS-13": 3 })], { "AS-13": 1 });
  assert.ok(r.includes("BASELINE"), `expected BASELINE, got ${r}`);
});

test("R1 baseline: score at baseline does NOT fire BASELINE", () => {
  const t = evaluateDomainTriggers("R1", [log("2026-08-20", "AM", { "AS-13": 1 })], { "AS-13": 1 });
  assert.equal(t.find((x) => x.domain === "AS-13"), undefined);
});

test("R3 absolute: score >= 3 fires ABSOLUTE even with no baseline", () => {
  const r = reasonsFor([log("2026-08-20", "AM", { "AS-13": 3 })], {});
  assert.ok(r.includes("ABSOLUTE"), `expected ABSOLUTE, got ${r}`);
});

test("R4 swing: same-day shifts differing by >=2 fires SWING", () => {
  const r = reasonsFor([log("2026-08-20", "AM", { "AS-04": 1 }), log("2026-08-20", "NOC", { "AS-04": 3 })], {}, "AS-04");
  assert.ok(r.includes("SWING"), `expected SWING, got ${r}`);
});

test("R2 trend: sustained rise over 3 days fires TREND", () => {
  const r = reasonsFor([
    log("2026-08-18", "AM", { "AS-08": 1 }),
    log("2026-08-19", "AM", { "AS-08": 2 }),
    log("2026-08-20", "AM", { "AS-08": 3 }),
  ], {}, "AS-08");
  assert.ok(r.includes("TREND"), `expected TREND, got ${r}`);
});

test("stable low score with baseline fires nothing", () => {
  const t = evaluateDomainTriggers("R1", [
    log("2026-08-18", "AM", { "AS-09": 1 }),
    log("2026-08-19", "AM", { "AS-09": 1 }),
  ], { "AS-09": 1 });
  assert.equal(t.length, 0);
});

test("severe flag set when latest day has a score of 4", () => {
  const t = evaluateDomainTriggers("R1", [log("2026-08-20", "PM", { "AS-05": 4 })], {});
  assert.equal(t.find((x) => x.domain === "AS-05")?.severe, true);
});

// ── baselineFor ──────────────────────────────────────────────────────────────
test("baselineFor picks latest VALIDATED assessment, ignores DRAFT", () => {
  const assessments = [
    { id: "a1", status: "VALIDATED", updatedAt: "2026-08-01", layer1: { residentId: "R1" }, domains: { "AS-13": { score: 1 } } },
    { id: "a2", status: "VALIDATED", updatedAt: "2026-08-15", layer1: { residentId: "R1" }, domains: { "AS-13": { score: 2 } } },
    { id: "a3", status: "DRAFT", updatedAt: "2026-08-20", layer1: { residentId: "R1" }, domains: { "AS-13": { score: 4 } } },
  ];
  const b = baselineFor("R1", assessments as never);
  assert.equal(b["AS-13"], 2);
});

test("baselineFor returns empty map when no finished assessment", () => {
  assert.deepEqual(baselineFor("R1", [] as never), {});
});

// ── advanceCase lifecycle ────────────────────────────────────────────────────
const trig = (date: string, score = 3) => ({ residentId: "R1", domain: "AS-13" as DomainCase["domain"], reasons: ["ABSOLUTE"] as TriggerReason[], latestScore: score, latestDate: date, latestShift: "AM", baseline: 1, severe: score >= 4 });

test("advanceCase opens a fresh case on first trigger", () => {
  const c = advanceCase(undefined, trig("2026-08-20"), "2026-08-20");
  assert.equal(c.status, "OPEN");
  assert.equal(c.occurrences.length, 1);
});

test("advanceCase → MANAGING once a management note exists", () => {
  let c = advanceCase(undefined, trig("2026-08-20"), "2026-08-20");
  c = addManagementNote(c, "Increased checks", "Nurse A", "2026-08-20T09:00:00Z");
  c = advanceCase(c, trig("2026-08-21"), "2026-08-21");
  assert.equal(c.status, "MANAGING");
});

test("advanceCase → LOC_REVIEW_DUE after discrepancies on 3 distinct days", () => {
  let c = advanceCase(undefined, trig("2026-08-20"), "2026-08-20");
  c = advanceCase(c, trig("2026-08-21"), "2026-08-21");
  assert.notEqual(c.status, "LOC_REVIEW_DUE"); // only 2 days yet
  c = advanceCase(c, trig("2026-08-22"), "2026-08-22");
  assert.equal(PERSIST_DAYS, 3);
  assert.equal(c.status, "LOC_REVIEW_DUE");
  assert.ok(c.locReviewDueAt);
});

test("advanceCase → LOC_REVIEW_DUE when open >=5 days and still tripping", () => {
  let c = advanceCase(undefined, trig("2026-08-20"), "2026-08-20");
  // same day re-trigger doesn't add distinct days, but age crosses the gate
  c = advanceCase(c, trig("2026-08-25"), "2026-08-25");
  assert.equal(PERSIST_AGE_DAYS, 5);
  assert.equal(c.status, "LOC_REVIEW_DUE");
});

test("resolveCase closes it", () => {
  let c = advanceCase(undefined, trig("2026-08-20"), "2026-08-20");
  c = resolveCase(c, "Nurse A", "2026-08-23T10:00:00Z");
  assert.equal(c.status, "RESOLVED");
  assert.ok(c.resolvedAt);
});

// ── carry-forward + upsert ───────────────────────────────────────────────────
test("carryForwardScores returns the most recent shift's scores", () => {
  const logs = [
    log("2026-08-19", "AM", { "AS-01": 1, "AS-02": 2 }),
    log("2026-08-20", "NOC", { "AS-01": 3 }),
  ];
  assert.deepEqual(carryForwardScores("R1", logs), { "AS-01": 3 });
});

test("upsertDomainLog replaces the same resident/date/shift row", () => {
  const a = log("2026-08-20", "AM", { "AS-01": 1 });
  const next = upsertDomainLog([a], { ...a, id: "new", scores: { "AS-01": 2 } });
  assert.equal(next.length, 1);
  assert.equal(next[0].scores["AS-01"], 2);
});
