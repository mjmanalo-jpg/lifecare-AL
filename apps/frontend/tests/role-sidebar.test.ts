import assert from "node:assert/strict";
import test from "node:test";
import { ROLES, groupSidebarLinks, type Role } from "../src/constants/roleConfig.ts";

const EXPECTED_GROUPS: Partial<Record<Role, string[]>> = {
  FACILITY_ADMIN: ["Today", "Operations", "Residents", "Staff", "Quality", "Services", "Reports", "Settings"],
  CARE_MANAGER: ["Clinical Risk Overview", "Admissions & Governance", "Care Delivery Reliability", "Safety / Transitions", "Staffing / Team Quality", "Open Decisions"],
  NURSE: ["Shift Command", "Clinical Triage Queue", "Caregiver Deployment", "Shift Watchlist", "Care Delivery Status", "Assessment & LOC", "Care Plan Governance", "Shift Endorsement"],
  CAREGIVER: ["Facility My Shift", "My Residents", "My Care Now", "Document Care", "Need Nurse / Help", "Assignment Update", "Shift Close"],
  RESIDENT_COORDINATOR: ["Today", "Residents", "Schedule", "Coordination", "Alerts", "Family Contacts", "Endorsement"],
};

test("Care360 roles follow the PDF primary navigation order", () => {
  for (const [role, expected] of Object.entries(EXPECTED_GROUPS) as Array<[Role, string[]]>) {
    const details = ROLES[role];
    const actual = groupSidebarLinks(details.sidebarLinks, details.sidebarGroupOrder).map(({ group }) => group);
    assert.deepEqual(actual, expected, role);
  }
});

test("resident coordinator navigation exposes its non-clinical work areas", () => {
  assert.deepEqual(
    ROLES.RESIDENT_COORDINATOR.sidebarLinks.map(({ route }) => route),
    [
      "/resident_coordinator/dashboard",
      "/resident_coordinator/residents",
      "/resident_coordinator/schedule",
      "/resident_coordinator/admissions",
      "/resident_coordinator/coordination",
      "/resident_coordinator/alerts",
      "/resident_coordinator/familycontacts",
      "/resident_coordinator/endorsement",
    ],
  );
});

test("caregiver sidebar omits facility-wide monitoring and governance modules", () => {
  const routes = new Set(ROLES.CAREGIVER.sidebarLinks.map(({ route }) => route));
  assert.equal(routes.has("/caregiver/cameralogs"), false);
  assert.equal(routes.has("/caregiver/vitalstrend"), false);
  assert.equal(routes.has("/caregiver/approvalworkflows"), false);
  assert.equal(routes.has("/caregiver/auditlog"), false);
});

test("clinical role sidebars use the role-based dashboard language", () => {
  assert.ok(ROLES.NURSE.sidebarLinks.some(({ name, group }) => name === "Call Bells" && group === "Clinical Triage Queue"));
  assert.ok(ROLES.NURSE.sidebarLinks.some(({ route, group }) => route === "/nurse/caredelivery" && group === "Care Delivery Status"));
  assert.ok(ROLES.CARE_MANAGER.sidebarLinks.some(({ route, group }) => route === "/care_manager/caregiverschedule" && group === "Staffing / Team Quality"));
  assert.ok(ROLES.CARE_MANAGER.sidebarLinks.some(({ route, group }) => route === "/care_manager/privatecare" && group === "Open Decisions"));
  assert.ok(ROLES.CAREGIVER.sidebarLinks.some(({ name, group }) => name === "Task Cards" && group === "My Care Now"));
  assert.ok(ROLES.CAREGIVER.sidebarLinks.some(({ route, group }) => route === "/caregiver/caregiverschedule" && group === "Assignment Update"));
});

test("Daily Rounds is retired and Daily Care Logs is available across clinical users", () => {
  // Care Manager is intentionally excluded: per Care360 v1.1 the CM sidebar is
  // governance-only (not a nurse shift screen), so bedside Daily Care Logs is
  // reached via dashboard drill-down, not a standing sidebar link.
  const careLogRoles: Role[] = [
    "SUPERADMIN",
    "FACILITY_ADMIN",
    "PHYSICIAN",
    "NURSE",
    "CAREGIVER",
  ];

  for (const [role, details] of Object.entries(ROLES) as Array<[Role, (typeof ROLES)[Role]]>) {
    assert.equal(
      details.sidebarLinks.some(({ name, route }) =>
        name.toLowerCase().includes("daily rounds") || route.endsWith("/dailyrounds")),
      false,
      `${role} still exposes Daily Rounds`,
    );
  }

  for (const role of careLogRoles) {
    assert.equal(
      ROLES[role].sidebarLinks.some(({ route }) => route.endsWith("/carelogs")),
      true,
      `${role} is missing Daily Care Logs`,
    );
  }
});
