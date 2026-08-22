import test from "node:test";
import assert from "node:assert/strict";

import { canOpenDashboard, permittedDashboardRole } from "../src/lib/dashboard/authorization.ts";

test("each operational role is limited to its own dashboard", () => {
  assert.equal(permittedDashboardRole("NURSE"), "nurse");
  assert.equal(permittedDashboardRole("CAREGIVER"), "caregiver");
  assert.equal(permittedDashboardRole("CARE_MANAGER"), "care-manager");
  assert.equal(permittedDashboardRole("RESIDENT_COORDINATOR"), "resident-coordinator");
  assert.equal(canOpenDashboard("CAREGIVER", "nurse"), false);
  assert.equal(canOpenDashboard("RESIDENT_COORDINATOR", "care-manager"), false);
});

test("professional views are explicit and superadmin oversight is intentional", () => {
  assert.equal(permittedDashboardRole("PHYSICIAN"), "professional");
  assert.equal(permittedDashboardRole("NUTRITIONIST"), null, "allied-health access stays closed until its discipline matrix is approved");
  assert.equal(permittedDashboardRole("FAMILY"), null);
  assert.equal(canOpenDashboard("SUPERADMIN", "facility-admin"), true);
});
