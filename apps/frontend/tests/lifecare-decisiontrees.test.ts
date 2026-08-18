// Phase 6 verify — Clinical Decision Trees protocol engine.
import test from "node:test";
import assert from "node:assert/strict";

import { DECISION_TREES } from "../src/lib/lifecare/dataset.ts";
import {
  PROTOCOLS, getProtocol, allProtocols, NEW_BOARD_TREES,
} from "../src/lib/lifecare/decisionTrees.ts";

test("all 14 decision trees have a protocol", () => {
  assert.equal(DECISION_TREES.length, 14);
  for (const t of DECISION_TREES) {
    const p = getProtocol(t.id);
    assert.ok(p, `missing protocol for ${t.id}`);
    // Register metadata is inherited from the dataset (single source of truth).
    assert.equal(p!.name, t.name);
    assert.equal(p!.domain, t.domain);
    assert.equal(p!.purpose, t.purpose);
  }
  assert.equal(Object.keys(PROTOCOLS).length, 14);
  assert.equal(allProtocols().length, 14);
});

test("every protocol has non-empty trigger/pathway/documentation/escalation", () => {
  for (const p of allProtocols()) {
    assert.ok(p.trigger.length > 0, `${p.id} trigger`);
    assert.ok(p.pathway.length > 0, `${p.id} pathway`);
    assert.ok(p.documentation.length > 0, `${p.id} documentation`);
    assert.ok(p.escalation.length > 0, `${p.id} escalation`);
    for (const s of p.pathway) { assert.ok(s.step && s.action, `${p.id} step`); }
    for (const e of p.escalation) { assert.ok(e.condition && e.to, `${p.id} escalation rule`); }
  }
});

test("DT-007/008/010 (new boards) have fully populated protocols", () => {
  for (const id of NEW_BOARD_TREES) {
    const p = getProtocol(id);
    assert.ok(p, `missing ${id}`);
    assert.ok(p!.trigger.length >= 2, `${id} trigger`);
    assert.ok(p!.pathway.length >= 3, `${id} pathway`);
    assert.ok(p!.documentation.length >= 2, `${id} documentation`);
    assert.ok(p!.escalation.length >= 1, `${id} escalation`);
    // These three are NOT realised elsewhere — no linkedModule.
    assert.equal(p!.linkedModule, undefined, `${id} should have no linkedModule`);
  }
});

test("linkedModule set for trees realised in existing modules", () => {
  const linked: Record<string, string> = {
    "DT-004": "incidents",
    "DT-005": "EscalationsBoard",
    "DT-006": "MAR",
    "DT-009": "transport",
    "DT-011": "careEvents",
    "DT-012": "reassessment",
  };
  for (const [id, mod] of Object.entries(linked)) {
    const p = getProtocol(id);
    assert.ok(p, `missing ${id}`);
    assert.equal(p!.linkedModule, mod, `${id} linkedModule`);
  }
});
