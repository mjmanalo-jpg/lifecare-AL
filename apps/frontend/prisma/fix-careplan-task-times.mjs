/**
 * One-off: repair stale care-plan Task due times for a resident (default: Robert Chen).
 *
 * WHY: earlier test runs stored some care-plan tasks at wrong hours (e.g. a Daily card
 * at 15:59 instead of 23:59, a "· AM" card at 00:00 instead of 08:00). The CURRENT
 * materializer (api/cron/care-plan-tasks) anchors every occurrence to Asia/Manila:
 *   Every shift → AM 08:00 / PM 16:00 / NOC 23:00 ;  TID → 08/14/20 ;  BID → 08/18 ;
 *   single card (Daily / Per care plan / Weekly) → end of day 23:59.
 * This recomputes each of TODAY's care-plan tasks' dueDate from its title suffix
 * (· AM/PM/NOC/…) + the Frequency: stamped in its description, and UPDATEs any that drifted.
 * In-place: preserves status/notes/assignee. Idempotent — re-running is a no-op once clean.
 *
 * Run from apps/frontend:   node prisma/fix-careplan-task-times.mjs ["Resident Name"]
 * Pass "*" to repair every resident's care-plan tasks for today.
 */
import nextEnv from "@next/env";
import { PrismaClient } from "@prisma/client";

nextEnv.loadEnvConfig(process.cwd());

const TARGET = (process.argv[2] || "Robert Chen").trim();
const TZ = "Asia/Manila";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } },
});

// --- mirror of api/cron/care-plan-tasks occurrence table ---
const freqOf = (desc) => (/Frequency:\s*([^·[]+)/.exec(desc || "")?.[1] || "Daily").trim();
function occurrencesFor(freq) {
  const f = freq.toLowerCase();
  if (/every shift/.test(f)) return [{ label: "AM", hour: 8 }, { label: "PM", hour: 16 }, { label: "NOC", hour: 23 }];
  if (/\btid\b|three times/.test(f)) return [{ label: "Morning", hour: 8 }, { label: "Afternoon", hour: 14 }, { label: "Evening", hour: 20 }];
  if (/\bbid\b|twice/.test(f)) return [{ label: "AM", hour: 8 }, { label: "PM", hour: 18 }];
  return [{ label: "", hour: 0 }]; // single card → end of day
}
const localDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

async function main() {
  const todayStr = localDay(new Date());
  const dayStart = new Date(`${todayStr}T00:00:00+08:00`);
  const dayEnd = new Date(`${todayStr}T23:59:00+08:00`);

  // Resolve residents (name column varies; try `name`, fall back to first+last contains).
  let residentIds = null; // null = all
  if (TARGET !== "*") {
    const parts = TARGET.split(/\s+/);
    const residents = await prisma.resident.findMany({
      where: { AND: parts.map((p) => ({ OR: [
        { firstName: { contains: p, mode: "insensitive" } },
        { lastName: { contains: p, mode: "insensitive" } },
      ] })) },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!residents.length) throw new Error(`No resident matched "${TARGET}"`);
    residentIds = residents.map((r) => r.id);
    console.log(`Resident(s): ${residents.map((r) => `${r.firstName} ${r.lastName} (${r.id})`).join(", ")}`);
  }

  const tasks = await prisma.task.findMany({
    where: {
      generatedFrom: { not: null },
      dueDate: { gte: dayStart, lte: dayEnd },
      ...(residentIds ? { residentId: { in: residentIds } } : {}),
    },
    select: { id: true, title: true, description: true, dueDate: true },
  });
  console.log(`Care-plan tasks today: ${tasks.length}`);

  let fixed = 0;
  for (const t of tasks) {
    const occs = occurrencesFor(freqOf(t.description));
    // Match the task to its occurrence by the "· LABEL" title suffix; no suffix → single card.
    const suffix = /·\s*([^·]+)$/.exec(t.title)?.[1]?.trim() || "";
    const occ = occs.find((o) => o.label && o.label.toLowerCase() === suffix.toLowerCase())
      || occs.find((o) => !o.label) // single-card fallback
      || occs[0];
    const correct = occ.label
      ? new Date(`${todayStr}T${String(occ.hour).padStart(2, "0")}:00:00+08:00`)
      : dayEnd;
    if (t.dueDate && Math.abs(new Date(t.dueDate).getTime() - correct.getTime()) < 60_000) continue; // already correct
    await prisma.task.update({ where: { id: t.id }, data: { dueDate: correct } });
    fixed++;
    console.log(`  fixed  ${t.title.padEnd(40)}  ${new Date(t.dueDate).toISOString()} → ${correct.toISOString()}`);
  }
  console.log(`\nDone. ${fixed} task(s) repaired, ${tasks.length - fixed} already correct.`);
}

main()
  .catch((e) => { console.error("Repair failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
