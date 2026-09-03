import assert from "node:assert/strict";
import test from "node:test";
import { ROLES, groupSidebarLinks, type Role } from "../src/constants/roleConfig.ts";

const EXPECTED_GROUPS: Partial<Record<Role, string[]>> = {
  FACILITY_ADMIN: ["Today", "Operations", "Residents", "Staff", "Quality", "Services", "Reports", "Settings"],
  CARE_MANAGER: ["Clinical Risk Overview", "Admissions & Governance", "Care Delivery Reliability", "Safety / Transitions", "Staffing / Team Quality", "Open Decisions"],
  NURSE: ["Shift Command", "Residents & Care", "Clinical Hubs", "Coordination & Close"],
  CAREGIVER: ["My Shift", "Care This Shift", "Need Nurse / Help", "Shift Close"],
  RESIDENT_COORDINATOR: ["Today", "Residents", "Schedule", "Coordination", "Alerts", "Family Contacts", "Endorsement"],
  // Phase 1 nav simplification — Administrator's flat menu grouped into 4 sections.
  SUPERADMIN: ["Clinical", "Operations", "Administration", "System"],
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
      "/resident_coordinator/movein",
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

test("caregiver sidebar exposes no level-of-care / care-plan leveling surface", () => {
  // The system assigns Level of Care; a caregiver never sets it. Neither the
  // Care Acuity assessment (rounds) nor Care Plan Review (careplans) may appear.
  const routes = new Set(ROLES.CAREGIVER.sidebarLinks.map(({ route }) => route));
  assert.equal(routes.has("/caregiver/rounds"), false);
  assert.equal(routes.has("/caregiver/careplans"), false);
});

test("clinical role sidebars use the role-based dashboard language", () => {
  assert.ok(ROLES.NURSE.sidebarLinks.some(({ name, group }) => name === "Action Queue" && group === "Shift Command"));
  assert.ok(ROLES.NURSE.sidebarLinks.some(({ route, group }) => route === "/nurse/caredelivery" && group === "Residents & Care"));
  assert.ok(ROLES.CARE_MANAGER.sidebarLinks.some(({ route, group }) => route === "/care_manager/staffinghub" && group === "Staffing / Team Quality"));
  assert.ok(ROLES.CARE_MANAGER.sidebarLinks.some(({ route, group }) => route === "/care_manager/privatecare" && group === "Open Decisions"));
  assert.ok(ROLES.CAREGIVER.sidebarLinks.some(({ name, group }) => name === "Task Cards" && group === "Care This Shift"));
  assert.ok(ROLES.CAREGIVER.sidebarLinks.some(({ route, group }) => route === "/caregiver/caregiverschedule" && group === "My Shift"));
});

test("CRM is owned by the CRM role + Facility Admin + Super Admin, and hidden from Care Manager", () => {
  const hasCrm = (role: Role) => ROLES[role].sidebarLinks.some(({ route }) => route.endsWith("/crm"));
  // Dedicated CRM team portal exists and is scoped to leads + tours only.
  assert.deepEqual(
    ROLES.CRM.sidebarLinks.map(({ route }) => route),
    ["/crm/dashboard"],
  );
  assert.equal(hasCrm("FACILITY_ADMIN"), true, "Facility Admin should have CRM (full view)");
  assert.equal(hasCrm("SUPERADMIN"), true, "Super Admin keeps CRM (dropdown view)");
  assert.equal(hasCrm("CARE_MANAGER"), false, "Care Manager must not see CRM");
});

test("Daily Rounds is retired and Daily Care Logs is available across clinical users", () => {
  // Care Manager is intentionally excluded: per Care360 v1.1 the CM sidebar is
  // governance-only (not a nurse shift screen), so bedside Daily Care Logs is
  // reached via dashboard drill-down, not a standing sidebar link.
  // Caregiver is excluded too: Daily Log (and ADL / Weight / MAR) now open
  // in-place from each resident card on the Shift Dashboard, not the sidebar.
  const careLogRoles: Role[] = [
    "SUPERADMIN",
    "FACILITY_ADMIN",
    "PHYSICIAN",
    "NURSE",
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
