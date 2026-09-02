// One-off data correction: bring ELMA FABROS's active Level of Care to Level 1.
//
// Background: a duplicate, pre-fix admission left this resident's loc_history with
// a stale L2 entry and careLevel=ASSISTED, so the Care Plan (which reads the
// latest loc_history entry via activeLevel) shows Level 2 even though her
// validated Resident Assessment is Level 1 -ovr. This appends a residentId-linked
// L1 entry (so it becomes the latest) and sets careLevel=INDEPENDENT (the L1 enum).
//
// It does NOT reconcile billing — if an L2 monthly LOC fee was already posted,
// adjust that separately. Everyone onboarded AFTER the code fix is unaffected.
//
// SAFETY:
//   - Targets exactly one resident (name contains ELMA + FABROS, room 114).
//     Aborts if zero or multiple match, so it can't touch the wrong person.
//   - Dry-run by default: prints the before/after. Add --apply to write.
//   - loc_history is append-only — the old L2 entry is preserved for audit.
//
// Run from apps/frontend (uses DIRECT_URL / DATABASE_URL from your env):
//   node prisma/fix-elma-loc.mjs           # dry run
//   node prisma/fix-elma-loc.mjs --apply   # write the correction

import { PrismaClient } from "@prisma/client";

// Prefer the direct connection for one-off scripts (the pooled DATABASE_URL can
// ECHECKOUTTIMEOUT). Falls back to DATABASE_URL if DIRECT_URL isn't set.
const dbUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
const prisma = new PrismaClient(dbUrl ? { datasources: { db: { url: dbUrl } } } : undefined);
const APPLY = process.argv.includes("--apply");

const ROOM = "114";
const LEVEL = "L1";
const CARE_LEVEL_ENUM = "INDEPENDENT"; // L1 -> INDEPENDENT (matches v42LevelToEnum)
const LOC_HISTORY_KEY = "loc_history";

const nameKey = (v) => String(v ?? "").trim().toLowerCase();
const normalizeLevel = (v) => { const m = /([1-5])/.exec(String(v ?? "")); return m ? `L${m[1]}` : String(v ?? ""); };

async function main() {
  // 1) Resolve exactly one resident.
  const candidates = await prisma.resident.findMany({
    where: {
      roomNumber: ROOM,
      firstName: { contains: "ELMA", mode: "insensitive" },
      lastName: { contains: "FABROS", mode: "insensitive" },
    },
    select: { id: true, firstName: true, lastName: true, roomNumber: true, careLevel: true, organizationId: true, communityId: true },
  });
  if (candidates.length !== 1) {
    console.log(`Expected exactly 1 resident (ELMA … FABROS, room ${ROOM}); found ${candidates.length}. Aborting.`);
    candidates.forEach((r) => console.log(`  - ${r.firstName} ${r.lastName} · room ${r.roomNumber} · ${r.careLevel} · ${r.id}`));
    return;
  }
  const r = candidates[0];
  const fullName = `${r.firstName} ${r.lastName}`.trim();
  console.log(`Resident: ${fullName} · room ${r.roomNumber} · careLevel=${r.careLevel} · id=${r.id}`);
  console.log(`Org=${r.organizationId ?? "—"} Community=${r.communityId ?? "—"}\n`);

  // 2) Locate the loc_history app-setting for this resident's scope.
  const setting = await prisma.appSetting.findFirst({
    where: { key: LOC_HISTORY_KEY, organizationId: r.organizationId, communityId: r.communityId },
  });
  let items = [];
  if (setting) { try { const v = JSON.parse(setting.value); if (Array.isArray(v)) items = v; } catch { /* corrupt → treat as empty */ } }

  // 3) Her current history (matched the way activeLevel matches: id OR name).
  const nk = nameKey(fullName);
  const hers = items
    .filter((e) => (e.residentId && e.residentId === r.id) || (nk && nameKey(e.residentName) === nk))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  console.log(`loc_history row: ${setting ? `found (${items.length} total entries)` : "NOT found — will create"}`);
  console.log(`Her entries (newest first): ${hers.length}`);
  hers.slice(0, 6).forEach((e) => console.log(`  - ${normalizeLevel(e.level)} · ${e.at} · ${e.source ?? "?"} · name="${e.residentName ?? ""}" residentId=${e.residentId ?? "—"}`));
  const latest = hers[0];
  console.log(`\nCurrent active level (latest entry): ${latest ? normalizeLevel(latest.level) : `none → falls back to enum ${r.careLevel}`}`);

  if (latest && normalizeLevel(latest.level) === LEVEL) {
    console.log(`\nLatest entry is already ${LEVEL}. No loc_history change needed.`);
  }

  // 4) Build the correcting entry.
  const now = new Date().toISOString();
  const entry = {
    id: `loc-fix-${Date.now().toString(36)}`,
    residentId: r.id,
    residentName: fullName,
    level: LEVEL,
    previousLevel: latest ? normalizeLevel(latest.level) : undefined,
    source: "CLINICAL_OVERRIDE",
    by: "Data correction",
    role: "System",
    notes: "Corrected to validated Final LOC (Level 1 -ovr); duplicate pre-fix admission had left a stale L2 entry.",
    at: now,
  };
  const nextItems = [entry, ...items];

  console.log(`\n== PLANNED CHANGES ==`);
  console.log(`  resident.careLevel: ${r.careLevel} -> ${CARE_LEVEL_ENUM}`);
  console.log(`  loc_history: prepend ${LEVEL} entry (residentId-linked), total ${items.length} -> ${nextItems.length}`);

  if (!APPLY) { console.log(`\nDry run — nothing written. Re-run with --apply to commit.`); return; }

  // 5) Apply.
  await prisma.resident.update({ where: { id: r.id }, data: { careLevel: CARE_LEVEL_ENUM } });
  if (setting) {
    await prisma.appSetting.update({ where: { id: setting.id }, data: { value: JSON.stringify(nextItems) } });
  } else {
    await prisma.appSetting.create({
      data: {
        id: `${r.organizationId ?? "null"}:${r.communityId ?? "null"}:${LOC_HISTORY_KEY}`,
        key: LOC_HISTORY_KEY, value: JSON.stringify(nextItems),
        organizationId: r.organizationId, communityId: r.communityId,
      },
    });
  }
  console.log(`\n✅ Applied. ${fullName} is now Level 1. In Care Plan Governance → Care Plans, use "Update to Level 1" and Finalize to regenerate her plan.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
