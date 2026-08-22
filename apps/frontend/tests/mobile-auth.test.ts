// Company + mobile login helpers.
import test from "node:test";
import assert from "node:assert/strict";

import { normalizeMobile, mobilesMatch, roleMatchesPortal } from "../src/lib/mobileAuth.ts";

test("normalizeMobile canonicalises PH formats to the last 10 digits", () => {
  assert.equal(normalizeMobile("0917 123 4567"), "9171234567");
  assert.equal(normalizeMobile("+63 917 123 4567"), "9171234567");
  assert.equal(normalizeMobile("639171234567"), "9171234567");
  assert.equal(normalizeMobile("(0917) 123-4567"), "9171234567");
  assert.equal(normalizeMobile(""), "");
});

test("mobilesMatch compares canonically and rejects too-short input", () => {
  assert.equal(mobilesMatch("0917 123 4567", "+639171234567"), true);
  assert.equal(mobilesMatch("09171234567", "09990000000"), false);
  assert.equal(mobilesMatch("123", "123"), false); // below 7-digit floor
});

test("roleMatchesPortal splits client roles from staff", () => {
  for (const r of ["FAMILY", "RESIDENT"]) {
    assert.equal(roleMatchesPortal(r, "FAMILY"), true);
    assert.equal(roleMatchesPortal(r, "EMPLOYEE"), false);
  }
  for (const r of ["NURSE", "CAREGIVER", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"]) {
    assert.equal(roleMatchesPortal(r, "EMPLOYEE"), true);
    assert.equal(roleMatchesPortal(r, "FAMILY"), false);
  }
});
