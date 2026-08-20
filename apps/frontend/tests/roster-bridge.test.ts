// Phase 2 — roster → caregiver-schedule bridge.
import test from "node:test";
import assert from "node:assert/strict";

import { bridgeRoster } from "../src/lib/rosterBridge.ts";
import { parseRosterGrid } from "../src/lib/caregiverRoster.ts";

const roster = parseRosterGrid([
  "CODE\tNAME\tSTATUS\t11\t12",
  "CG1\tJULIAN, MAY ANN\tREG\tPCG107A12\tCG2N",
  "NURSES",
  "NOD1\tROCO, MARY GRACE\tREG\tNOD-A\tNOD-A",
].join("\n"), { periodStartISO: "2026-08-11" });

const staff = [
  { id: "s1", userId: "u1", name: "May Ann Julian" },
];
const residents = [
  { id: "r107", name: "Juan Cruz", room: "107" },
  { id: "r201", name: "Ana Reyes", room: "201" },
  { id: "r202", name: "Ben Santos", room: "202" },
];

test("a private (PCG) cell maps the caregiver to the resident by room, on the AM shift", () => {
  const { assignments } = bridgeRoster(roster, { staff, residents });
  const a = assignments.find((x) => x.date === "2026-08-11")!;
  assert.equal(a.caregiverStaffId, "s1");
  assert.equal(a.shift, "AM");
  assert.deepEqual(a.residentIds, ["r107"]);
  assert.equal(a.private, true);
});

test("a shared (CG station) cell uses the station→residents mapping, Night→NOC", () => {
  const { assignments } = bridgeRoster(roster, {
    staff, residents,
    mapping: { stationResidents: { "2": ["r201", "r202"] } },
  });
  const a = assignments.find((x) => x.date === "2026-08-12")!;
  assert.equal(a.shift, "NOC");
  assert.deepEqual(a.residentIds.sort(), ["r201", "r202"]);
  assert.equal(a.private, false);
});

test("nurses are not turned into resident coverage", () => {
  const { assignments } = bridgeRoster(roster, { staff, residents, mapping: { stationResidents: { "2": ["r201"] } } });
  assert.ok(assignments.every((a) => a.caregiverStaffId === "s1"));
});

test("unresolved codes are reported, not dropped", () => {
  // No station mapping → CG2N unresolved; unknown staff name → all unresolved.
  const r1 = bridgeRoster(roster, { staff, residents }); // no station map
  assert.ok(r1.unresolved.some((u) => /Station 2/.test(u.reason)));

  const r2 = bridgeRoster(roster, { staff: [], residents });
  assert.ok(r2.assignments.length === 0);
  assert.ok(r2.unresolved.some((u) => /No matching staff/.test(u.reason)));
});

test("a private code with no matching room is reported", () => {
  const noRoom = bridgeRoster(roster, { staff, residents: [{ id: "rX", name: "X", room: "999" }] });
  assert.ok(noRoom.unresolved.some((u) => /code 107 not mapped/.test(u.reason)));
});
