// Package gate — care included per Level of Care + out-of-package routing.
import test from "node:test";
import assert from "node:assert/strict";

import { domainInPackage, packageForLevel, careLevelEnumToLevel, LEVEL_PACKAGE_DOMAINS } from "../src/lib/lifecare/carePackage.ts";

test("Level 1 package excludes hands-on ADL but includes monitoring & engagement", () => {
  assert.equal(domainInPackage(1, "AS-01"), false); // ADLs — NOT in L1 package
  assert.equal(domainInPackage(1, "AS-02"), false); // Mobility assist — NOT in L1
  assert.equal(domainInPackage(1, "AS-10"), false); // Continence — NOT in L1
  assert.equal(domainInPackage(1, "AS-06"), true);  // Clinical monitoring — in L1
  assert.equal(domainInPackage(1, "AS-03"), true);  // Basic fall prevention — in L1
  assert.equal(domainInPackage(1, "AS-14"), true);  // Reablement/engagement — in L1
});

test("ADL assistance becomes in-package from Level 2 up", () => {
  assert.equal(domainInPackage(2, "AS-01"), true);
  assert.equal(domainInPackage(3, "AS-01"), true);
  assert.equal(domainInPackage(4, "AS-01"), true);
});

test("Behavior (AS-05) enters the package at Level 4", () => {
  assert.equal(domainInPackage(2, "AS-05"), false);
  assert.equal(domainInPackage(3, "AS-05"), false);
  assert.equal(domainInPackage(4, "AS-05"), true);
});

test("Level 4 includes all 14 domains", () => {
  assert.equal(LEVEL_PACKAGE_DOMAINS[4].length, 14);
});

test("packageForLevel splits included vs excluded (L1)", () => {
  const { included, excluded } = packageForLevel(1);
  assert.deepEqual(included, ["AS-03", "AS-06", "AS-14"]);
  assert.equal(included.length + excluded.length, 14);
  assert.ok(excluded.includes("AS-01"));
});

test("careLevel enum maps to a level number", () => {
  assert.equal(careLevelEnumToLevel("INDEPENDENT"), 1);
  assert.equal(careLevelEnumToLevel("ASSISTED"), 2);
  assert.equal(careLevelEnumToLevel("MEMORY"), 4);
  assert.equal(careLevelEnumToLevel("SKILLED"), 5);
  assert.equal(careLevelEnumToLevel(undefined), 2);
});

test("out-of-package level clamps and unknown domains resolve safely", () => {
  assert.equal(domainInPackage(0, "AS-01"), false); // clamps to L1
  assert.equal(domainInPackage(9, "AS-05"), true);  // clamps to L5 (all but AS-14)
});
