// DT-014 — Additional Clinical Services (ACS) engine tests.
import test from "node:test";
import assert from "node:assert/strict";

import {
  acsChargeAllowed, acsReassessmentDue, fromRule, normaliseInclusion,
  normaliseSeparateCharge, acsRuleById, type PackageInclusionContext,
} from "../src/lib/lifecare/acs.ts";

const noOverlap: PackageInclusionContext = {
  locIncluded: false, pcgIncluded: false, dedicatedNursingIncluded: false, otherPackageIncluded: false,
};

test("fromRule auto-fills inclusion + separate-charge from the ACS rule", () => {
  // ACS-002 discrete skilled procedure: not in LOC, separately chargeable.
  const f = fromRule("ACS-002");
  assert.ok(f);
  assert.equal(f!.acsRuleId, "ACS-002");
  assert.equal(f!.includedInLoc, "No");
  assert.equal(f!.separateChargeAllowed, true);
  // ACS-006 routine med admin: included in LOC, not separately chargeable.
  const r6 = fromRule("ACS-006");
  assert.equal(r6!.includedInLoc, "Yes");
  assert.equal(r6!.separateChargeAllowed, false);
  // Unknown rule → null.
  assert.equal(fromRule("ACS-999"), null);
});

test("normalisers map the rule free-text into Yes/No/Maybe + boolean", () => {
  assert.equal(normaliseInclusion("Yes according to LOC/package"), "Yes");
  assert.equal(normaliseInclusion("No, unless specifically bundled in package"), "No");
  assert.equal(normaliseInclusion("Define package threshold"), "Maybe");
  assert.equal(normaliseSeparateCharge("Yes + capability review"), true);
  assert.equal(normaliseSeparateCharge("Usually No"), false);
  assert.equal(normaliseSeparateCharge("Potentially, under defined recurring-service package"), true);
});

test("ACS-014 blocks charging when the service is included in LOC", () => {
  // Explicit inclusion verdict Yes → blocked.
  const inc = acsChargeAllowed({ acsRuleId: "ACS-006", separateChargeAllowed: false, includedInLoc: "Yes" }, noOverlap);
  assert.equal(inc.allowed, false);

  // A separately-chargeable service, but the SAME intervention is already in LOC → blocked.
  const overlapLoc = acsChargeAllowed(
    { acsRuleId: "ACS-004", separateChargeAllowed: true, includedInLoc: "Maybe" },
    { ...noOverlap, locIncluded: true },
  );
  assert.equal(overlapLoc.allowed, false);
  assert.match(overlapLoc.reason, /LOC/);
});

test("ACS-014 allows a discrete skilled service outside all packages", () => {
  const v = acsChargeAllowed({ acsRuleId: "ACS-002", separateChargeAllowed: true, includedInLoc: "No" }, noOverlap);
  assert.equal(v.allowed, true);

  // Not separately chargeable per rule → blocked regardless of context.
  const notChargeable = acsChargeAllowed({ acsRuleId: "ACS-006", separateChargeAllowed: false, includedInLoc: "No" }, noOverlap);
  assert.equal(notChargeable.allowed, false);
});

test("ACS-010 dedicated private-duty nursing is DISTINCT from PCG", () => {
  // An active Private Caregiver on the resident must NOT block dedicated nursing.
  const withPcg = acsChargeAllowed(
    { acsRuleId: "ACS-010", separateChargeAllowed: true, includedInLoc: "No" },
    { ...noOverlap, pcgIncluded: true },
  );
  assert.equal(withPcg.allowed, true, "ACS-010 nursing is distinct from PCG — not blocked by an active PCG");
  assert.match(withPcg.reason, /distinct from PCG/);

  // But a duplicate dedicated-nursing add-on DOES block it.
  const dupNursing = acsChargeAllowed(
    { acsRuleId: "ACS-010", separateChargeAllowed: true, includedInLoc: "No" },
    { ...noOverlap, dedicatedNursingIncluded: true },
  );
  assert.equal(dupNursing.allowed, false);

  // Conversely, a NON-nursing service IS blocked when the same care is under an active PCG.
  const nonNursingWithPcg = acsChargeAllowed(
    { acsRuleId: "ACS-002", separateChargeAllowed: true, includedInLoc: "No" },
    { ...noOverlap, pcgIncluded: true },
  );
  assert.equal(nonNursingWithPcg.allowed, false);
  assert.match(nonNursingWithPcg.reason, /Private Caregiver|PCG/);
});

test("ACS-015 temporary-to-recurring: past review date triggers reassessment (not auto-billing)", () => {
  const now = new Date("2026-08-18T00:00:00Z");
  // Active service whose review date has passed → reassessment due.
  assert.equal(acsReassessmentDue({ status: "ACTIVE", reviewDate: "2026-08-01" }, now), true);
  // Future review date → not due yet.
  assert.equal(acsReassessmentDue({ status: "ACTIVE", reviewDate: "2026-09-30" }, now), false);
  // No review date → never auto-flags.
  assert.equal(acsReassessmentDue({ status: "ACTIVE" }, now), false);
  // Stopped service is not flagged even if past review date.
  assert.equal(acsReassessmentDue({ status: "STOPPED", reviewDate: "2026-08-01" }, now), false);
});

test("ACS-015 safeguard text is available for the reassessment alert", () => {
  const rule = acsRuleById("ACS-015");
  assert.ok(rule);
  assert.match(rule!.reassessmentSafeguard, /review/i);
});
