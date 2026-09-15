// The Pre-Admission board is admissions work-in-progress. Once a resident is
// onboarded, their finalized pre-admission assessment is read in One Care · One
// Journey — leaving it on the board makes onboarded residents look like open
// admissions. Drafts always stay: they are still being worked on.
import assert from "node:assert/strict";
import test from "node:test";

import { pendingPreadmissionAssessments, type AssessmentStatus, type AssessmentV42 } from "../src/lib/lifecare/assessment.ts";

const record = (id: string, status: AssessmentStatus, layer1: AssessmentV42["layer1"]): AssessmentV42 => ({
  id, status, modelVersion: "test", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
  layer1, domains: {}, context: {}, layer3: {},
});

test("a validated pre-admission hands off to the journey once the resident is onboarded", () => {
  const all = [
    // Real shape of the store: pre-admission records usually carry a name only.
    record("byName", "VALIDATED", { residentName: "QA Test 7867" }),
    record("byAdmission", "VALIDATED", { residentName: "awasda", convertedAdmissionId: "adm_3" }),
    record("byId", "COMPLETED", { residentName: "Mark Manalo", residentId: "res_mark" }),
    record("stillDraft", "DRAFT", { residentName: "QA Test 7867" }),
    record("notOnboarded", "VALIDATED", { residentName: "Eleanor Villanueva" }),
  ];
  const onboarded = [
    { residentId: "res_7867", admissionIds: [], residentName: "QA Test 7867" },
    { residentId: "res_3", admissionIds: ["adm_3"], residentName: "QA Test 3" },
    { residentId: "res_mark", admissionIds: [], residentName: "Mark Manalo" },
  ];

  const ids = pendingPreadmissionAssessments(all, onboarded).map((a) => a.id);
  assert.deepEqual(ids, ["stillDraft", "notOnboarded"]);
});

test("with nobody onboarded yet the board is unchanged", () => {
  const all = [record("a", "VALIDATED", { residentName: "Eleanor Villanueva" })];
  assert.equal(pendingPreadmissionAssessments(all, []).length, 1);
});
