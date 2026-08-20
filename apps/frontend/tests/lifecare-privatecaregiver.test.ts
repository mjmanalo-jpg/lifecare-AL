// M3 verify — DT-013 Private Caregiver metadata is sourced from pcg_rules.json
// (no hardcoded drift): every rule id the board reasons about exists in the data,
// and its label is the rule's decisionFactor.
import test from "node:test";
import assert from "node:assert/strict";

import {
  PCG_RULES, pcgRuleById, PCG_RULE_REFS, PCG_RULE_REF_IDS,
  PCG_INTENSITY_META, PCG_INTENSITY_ORDER,
} from "../src/lib/privateCaregiver.ts";
import pcgRulesData from "../src/lib/lifecare/data/pcg_rules.json" with { type: "json" };

test("PCG_RULES mirrors pcg_rules.json", () => {
  assert.equal(PCG_RULES.length, (pcgRulesData as unknown[]).length);
  assert.ok(PCG_RULES.length >= 12, "expected PCG-001..012");
});

test("every intensity's ruleId exists in pcg_rules.json", () => {
  for (const k of PCG_INTENSITY_ORDER) {
    const id = PCG_INTENSITY_META[k].ruleId;
    assert.ok(pcgRuleById(id), `intensity ${k}: ruleId ${id} not in pcg_rules.json`);
  }
});

test("PCG_RULE_REFS labels come from the rule data (decisionFactor)", () => {
  for (const ref of PCG_RULE_REFS) {
    const rule = pcgRuleById(ref.id);
    assert.ok(rule, `${ref.id} not in pcg_rules.json`);
    assert.equal(ref.label, rule!.decisionFactor);
  }
  assert.equal(PCG_RULE_REFS.length, PCG_RULE_REF_IDS.length);
});
