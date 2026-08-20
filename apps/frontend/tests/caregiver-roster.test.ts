// Staff roster — shift-code grammar + paste-grid import.
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseShiftCode, roleForEmployee, parseRosterGrid, addDaysISO, assignmentsOn,
} from "../src/lib/caregiverRoster.ts";

test("private caregiver code carries resident + shift + hours", () => {
  const c = parseShiftCode("PCG107A12");
  assert.equal(c.kind, "WORK");
  assert.equal(c.type, "PCG");
  assert.equal(c.private, true);
  assert.equal(c.residentCode, "107");
  assert.equal(c.shift, "AM");
  assert.equal(c.hours, 12);
});

test("shared caregiver code carries station + shift", () => {
  const c = parseShiftCode("CG2N");
  assert.equal(c.type, "CG");
  assert.equal(c.station, "2");
  assert.equal(c.shift, "NIGHT");
  assert.equal(c.hours, 8);
  assert.equal(c.private, undefined);
});

test("nurse-on-duty, mid/flex, and P12 codes parse", () => {
  assert.deepEqual(
    ["NOD-A", "NOD-P12", "MIDFLX", "MID", "CG3P"].map((x) => parseShiftCode(x).shift),
    ["AM", "PM", "MID", "MID", "PM"],
  );
  assert.equal(parseShiftCode("NOD-P12").hours, 12);
  assert.equal(parseShiftCode("NOD-A").type, "NOD");
});

test("non-working states classify correctly", () => {
  assert.equal(parseShiftCode("RD").kind, "REST");
  assert.equal(parseShiftCode("VL").kind, "LEAVE");
  assert.equal(parseShiftCode("x").kind, "OFF");
  assert.equal(parseShiftCode("").kind, "OFF");
  assert.equal(parseShiftCode("ZZZ9").kind, "UNKNOWN");
});

test("employee code + section map to the three base roles with designations", () => {
  assert.deepEqual(roleForEmployee("CM1"), { baseRole: "CARE_MANAGER", designation: "Care Manager" });
  assert.deepEqual(roleForEmployee("CC1"), { baseRole: "CARE_MANAGER", designation: "Care Coordinator" });
  assert.deepEqual(roleForEmployee("NOD3"), { baseRole: "NURSE", designation: "Nurse" });
  assert.deepEqual(roleForEmployee("LCG2"), { baseRole: "CAREGIVER", designation: "Lead Caregiver" });
  assert.deepEqual(roleForEmployee("CG7"), { baseRole: "CAREGIVER", designation: "Caregiver" });
  // section header fallback when no code prefix
  assert.equal(roleForEmployee("", "NURSES").baseRole, "NURSE");
});

test("addDaysISO rolls across month boundaries", () => {
  assert.equal(addDaysISO("2026-08-11", 0), "2026-08-11");
  assert.equal(addDaysISO("2026-08-11", 14), "2026-08-25");
  assert.equal(addDaysISO("2026-08-30", 3), "2026-09-02");
});

test("parseRosterGrid imports a pasted TSV grid into dated rows", () => {
  const tsv = [
    "HEAD COUNT\tEMPLOYEE CODE\tEMPLOYEE NAME\tSTATUS\t11\t12\t13",
    "\t\t\t\tTUE\tWED\tTHU",
    "1\tCM1\tLLANZANA, MA. JESSICA\tREG\tMIDFLX\tMIDFLX\tRD",
    "NURSES",
    "3\tNOD1\tROCO, MARY GRACE\tREG\tNOD-A\tNOD-A\tNOD-A12",
    "CAREGIVERS",
    "8\tCG1\tJULIAN, MAY ANN\tREG\tCG1A\tPCG114A12\tRD",
  ].join("\n");

  const r = parseRosterGrid(tsv, { periodStartISO: "2026-08-11" });
  assert.deepEqual(r.dates, ["2026-08-11", "2026-08-12", "2026-08-13"]);
  assert.equal(r.periodEnd, "2026-08-13");
  assert.equal(r.rows.length, 3);

  const cm = r.rows[0];
  assert.equal(cm.employeeCode, "CM1");
  assert.equal(cm.name, "LLANZANA, MA. JESSICA");
  assert.equal(cm.baseRole, "CARE_MANAGER");
  assert.equal(cm.cells["2026-08-11"], "MIDFLX");

  const nurse = r.rows[1];
  assert.equal(nurse.baseRole, "NURSE"); // via NOD prefix / NURSES section
  assert.equal(nurse.cells["2026-08-13"], "NOD-A12");

  const cg = r.rows[2];
  assert.equal(cg.baseRole, "CAREGIVER");
  assert.equal(cg.cells["2026-08-12"], "PCG114A12");
});

test("assignmentsOn returns only working shifts, parsed", () => {
  const tsv = [
    "CODE\tNAME\tSTATUS\t11\t12",
    "CG1\tJULIAN\tREG\tCG1A\tRD",
    "CG3\tGASALAO\tREG\tPCG114A12\tPCG103A12",
  ].join("\n");
  const r = parseRosterGrid(tsv, { periodStartISO: "2026-08-11" });
  const day1 = assignmentsOn(r, "2026-08-11");
  assert.equal(day1.length, 2);
  const day2 = assignmentsOn(r, "2026-08-12");
  assert.equal(day2.length, 1); // CG1 is RD on the 12th
  assert.equal(day2[0].code.residentCode, "103");
});
