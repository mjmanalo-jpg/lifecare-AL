// B5 — Governance guard tests.
import test from "node:test";
import assert from "node:assert/strict";

import {
  canActivate, assertActivatable, feeOrLevelChangeAllowed,
  capabilityOutcome, canLowerLevel, traceChain,
} from "../src/lib/lifecare/governance.ts";

test("care plan / routine only activates when APPROVED", () => {
  assert.equal(canActivate("DRAFT"), false);
  assert.equal(canActivate("PENDING_APPROVAL"), false);
  assert.equal(canActivate("APPROVED"), true);
  assert.throws(() => assertActivatable("DRAFT"), /not APPROVED/);
  assert.doesNotThrow(() => assertActivatable("APPROVED"));
});

test("no event/variance/score auto-changes fee or level; only manual authorised", () => {
  assert.equal(feeOrLevelChangeAllowed({ reason: "CARE_EVENT" }), false);
  assert.equal(feeOrLevelChangeAllowed({ reason: "VARIANCE_COUNTER" }), false);
  assert.equal(feeOrLevelChangeAllowed({ reason: "MODIFIER" }), false);
  assert.equal(feeOrLevelChangeAllowed({ reason: "MANUAL_AUTHORISED" }), false); // needs an authoriser
  assert.equal(feeOrLevelChangeAllowed({ reason: "MANUAL_AUTHORISED", authorisedBy: "RN Cruz" }), true);
});

test("capability gate: emergency never delayed; beyond-capability escalates", () => {
  assert.equal(capabilityOutcome({ gateRequired: false, withinCapability: true }), "PROCEED");
  assert.equal(capabilityOutcome({ gateRequired: true, withinCapability: true }), "CONDITIONAL");
  assert.equal(capabilityOutcome({ gateRequired: true, withinCapability: false }), "ESCALATE_TRANSFER");
  assert.equal(capabilityOutcome({ gateRequired: true, withinCapability: false, emergency: true }), "EMERGENCY_PATHWAY");
});

test("level downgrade requires an authorised reassessment", () => {
  assert.equal(canLowerLevel("L3", "L4", { reassessed: false }), true); // upgrade ok
  assert.equal(canLowerLevel("L3", "L1", { reassessed: false }), false);
  assert.equal(canLowerLevel("L3", "L1", { reassessed: true, approvedBy: "RN Cruz" }), true);
});

test("trace chain renders the assessment→level→…→plan-change spine", () => {
  const chain = traceChain([
    { from: "assessment", to: "L4", ruleId: "MLR-011" },
    { from: "MLR-011", to: "task TASK-COG-01" },
  ]);
  assert.match(chain, /assessment → L4 \[MLR-011\]/);
  assert.match(chain, /task TASK-COG-01/);
});
