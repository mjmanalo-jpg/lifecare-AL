import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireTenantContext } from "@/lib/tenant";
import { slaMinutes } from "@/lib/alertAccess";
import { scanCameraHealth } from "@/lib/cameraHealth";
import { isAbnormalVital, vitalSeverity } from "@/lib/vitalThresholds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// Alerts & Task Automation engine.
//
// Scans clinical/operational data for breach conditions and creates in-app
// Notifications (idempotently) for the community's nurses + facility admins.
// Also reflects state where appropriate (missed meds → MISSED, overdue
// follow-ups → OVERDUE). Meant to run on a schedule (Vercel Cron) and is also
// pinged, throttled, from the supervisor portals so it works in dev/demo.
//
// AUTOMATIC ALERT SOURCES (severity: CRITICAL / WARNING / INFO):
//   • Vital Signs — abnormal BP, SpO₂, HR, temp, RR (CRITICAL when dangerous).
//   • MAR         — missed dose windows + refused meds.
//   • Care Logs   — missing daily rounds + no shift report submitted (INFO).
//   • Incidents   — severe & critical incident reports (CRITICAL when critical).
// Plus operational guards: overdue follow-ups/tasks, low/expiring stock, weight loss.
//
// Auth: a Vercel-cron request (Bearer CRON_SECRET) scans ALL communities; a
// signed-in NURSE / FACILITY_ADMIN / SUPERADMIN scans only their community.
// ─────────────────────────────────────────────────────────────

const RELATED_TYPES = ["vitalsLog", "medicationAdministration", "followUp", "task", "inventoryItem", "dailyDoc", "weightTrend", "incident", "slaBreach", "escalation", "assessment", "purchaseRequest", "serviceRequest", "maintenance", "diningReservation"];

// SBAR SLA response windows (minutes) by priority — single source of truth is
// escalationMeta.PRIORITY_META in the UI; mirrored here so the server can
// enforce the same deadlines without importing client-side constants.
const SBAR_SLA_MIN: Record<string, number> = { EMERGENCY: 5, URGENT: 30, ROUTINE: 240 };

const VITAL_LABEL: Record<string, string> = {
  HEART_RATE: "heart rate",
  OXYGEN: "oxygen saturation",
  TEMPERATURE: "temperature",
  RESPIRATORY_RATE: "respiratory rate",
  BLOOD_GLUCOSE: "blood glucose",
  BLOOD_PRESSURE: "blood pressure",
  WEIGHT: "weight",
};

// Vital thresholds live in one shared module (lib/vitalThresholds) so the alert
// engine and the vitals UIs never disagree. `isAbnormal` aliases the shared fn.
const isAbnormal = isAbnormalVital;

type Res = { firstName?: string | null; lastName?: string | null; roomNumber?: string | null } | null;
const rname = (r: Res) => `${r?.firstName ?? ""} ${r?.lastName ?? ""}`.trim() || "Resident";
const room = (r: Res) => r?.roomNumber ?? "—";
const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString();
const fmtTime = (d: Date | string) => new Date(d).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

interface Scan {
  abnormalVitals: number;
  missedMeds: number;
  overdueFollowups: number;
  overdueTasks: number;
  lowStock: number;
  missedDocs: number;
  weightLoss: number;
  incidents: number;
  sbarEscalations: number;
}

async function scanCommunity(communityId: string, organizationId: string | null): Promise<Scan> {
  const counts: Scan = { abnormalVitals: 0, missedMeds: 0, overdueFollowups: 0, overdueTasks: 0, lowStock: 0, missedDocs: 0, weightLoss: 0, incidents: 0, sbarEscalations: 0 };

  // Recipient sets by care tier. General alerts go to the on-floor + admin team
  // (nurse + facility admin). SBAR SLA escalations follow the clinical chain of
  // command: nurse → care manager → physician → admin.
  const memberships = await prisma.communityMembership.findMany({
    where: { communityId, status: "ACTIVE", role: { in: ["NURSE", "CARE_MANAGER", "PHYSICIAN", "FACILITY_ADMIN"] } },
    select: { userId: true, role: true },
  });
  const idsForRoles = (roles: string[]) => [...new Set(memberships.filter((m) => roles.includes(m.role)).map((m) => m.userId))];
  const recipientIds = idsForRoles(["NURSE", "FACILITY_ADMIN"]);
  const escalationChainIds = idsForRoles(["NURSE", "CARE_MANAGER", "PHYSICIAN", "FACILITY_ADMIN"]);

  const now = new Date();
  const nowTs = now.getTime();

  // De-dup against notifications already raised in the last 30 days. Alerts are
  // keyed by entity id, so a longer window stops a still-open task / low-stock
  // item (which never self-heals like missed meds → MISSED or follow-ups →
  // OVERDUE do) from re-nagging every few days. Date-stamped keys (daily-doc,
  // weight month) still re-fire on their natural cadence because their key
  // changes each day/month.
  const existing = await prisma.notification.findMany({
    where: { communityId, createdAt: { gte: new Date(nowTs - 30 * 86_400_000) }, relatedEntityType: { in: RELATED_TYPES } },
    select: { type: true, relatedEntityId: true },
  });
  const seen = new Set(existing.map((e) => `${e.type}|${e.relatedEntityId}`));

  async function notify(type: string, relatedEntityType: string, relatedEntityId: string, title: string, message: string, severity: string = "WARNING", recipients: string[] = recipientIds): Promise<boolean> {
    const key = `${type}|${relatedEntityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (recipients.length) {
      await prisma.notification.createMany({
        data: recipients.map((userId) => ({ userId, type: type as never, title, message, severity, relatedEntityId, relatedEntityType, organizationId, communityId })),
      });
    }
    return true;
  }

  // Each source is isolated: a failure in one (bad data, a transient query
  // error) is logged and skipped so the remaining sources for this community
  // still run, instead of aborting the whole community's scan.
  const runSource = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      console.error(`alerts source '${label}' failed for community ${communityId}:`, e instanceof Error ? e.message : "unknown");
    }
  };

  // 1) Abnormal vitals (last 6h)
  await runSource("vitals", async () => {
    const vitals = await prisma.vitalsLog.findMany({
      where: { resident: { communityId }, recordedAt: { gte: new Date(nowTs - 6 * 3_600_000) } },
      select: { id: true, type: true, value: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const v of vitals) {
      if (!isAbnormal(v.type, v.value)) continue;
      const l = VITAL_LABEL[v.type] ?? v.type.toLowerCase();
      const sev = vitalSeverity(v.type, v.value);
      const lead = sev === "CRITICAL" ? "Critically abnormal" : "Abnormal";
      if (await notify("VITAL_ALERT", "vitalsLog", v.id, `${lead} ${l}`, `${rname(v.resident)} (Room ${room(v.resident)}) recorded ${l} of ${v.value}.${sev === "CRITICAL" ? " Immediate review required." : " Please review."}`, sev)) counts.abnormalVitals++;
    }
  });

  // 1b) Severe/critical incidents (last 12h, unresolved) — auto-alert the team.
  await runSource("incidents", async () => {
    const incidents = await prisma.incident.findMany({
      where: { resident: { communityId }, severity: { in: ["SEVERE", "CRITICAL"] }, resolvedAt: null, createdAt: { gte: new Date(nowTs - 12 * 3_600_000) } },
      select: { id: true, severity: true, incidentType: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const inc of incidents) {
      const crit = inc.severity === "CRITICAL";
      const kind = String(inc.incidentType).replace(/_/g, " ").toLowerCase();
      if (await notify("INCIDENT_REPORT", "incident", inc.id, `${crit ? "Critical" : "Severe"} incident — ${kind}`, `${rname(inc.resident)} (Room ${room(inc.resident)}): a ${crit ? "critical" : "severe"} ${kind} incident was reported. Review immediately.`, "CRITICAL")) counts.incidents++;
    }
  });

  // 2) Missed medication: still SCHEDULED > 30 min after the scheduled time.
  await runSource("missed-meds", async () => {
    const missed = await prisma.medicationAdministration.findMany({
      where: { resident: { communityId }, status: "SCHEDULED", scheduledTime: { lt: new Date(nowTs - 30 * 60_000), gte: new Date(nowTs - 24 * 3_600_000) } },
      select: { id: true, scheduledTime: true, medication: { select: { name: true } }, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const m of missed) {
      const created = await notify("MEDICATION_REMINDER", "medicationAdministration", m.id, "Missed medication", `${rname(m.resident)} (Room ${room(m.resident)}) — ${m.medication?.name ?? "medication"} scheduled ${fmtTime(m.scheduledTime)} has not been administered.`);
      await prisma.medicationAdministration.update({ where: { id: m.id }, data: { status: "MISSED" } });
      if (created) counts.missedMeds++;
    }
  });

  // 2b) Refused medications (last 12h) — flag for clinical follow-up.
  await runSource("refused-meds", async () => {
    const refused = await prisma.medicationAdministration.findMany({
      where: { resident: { communityId }, status: "REFUSED", actualTime: { gte: new Date(nowTs - 12 * 3_600_000) } },
      select: { id: true, reasonForRefusal: true, medication: { select: { name: true } }, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const m of refused) {
      const why = m.reasonForRefusal ? ` — reason: ${m.reasonForRefusal}` : "";
      if (await notify("MEDICATION_REMINDER", "medicationAdministration", `refused:${m.id}`, "Medication refused", `${rname(m.resident)} (Room ${room(m.resident)}) refused ${m.medication?.name ?? "medication"}${why}.`, "WARNING")) counts.missedMeds++;
    }
  });

  // 3) Overdue follow-ups → mark OVERDUE + notify.
  await runSource("followups", async () => {
    const followups = await prisma.followUp.findMany({
      where: { resident: { communityId }, status: { in: ["PENDING", "SCHEDULED"] }, dueDate: { lt: now } },
      select: { id: true, dueDate: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const f of followups) {
      const created = await notify("SYSTEM_ALERT", "followUp", f.id, "Overdue follow-up", `A follow-up for ${rname(f.resident)} (Room ${room(f.resident)}) was due ${fmtDate(f.dueDate)}.`);
      await prisma.followUp.update({ where: { id: f.id }, data: { status: "OVERDUE" } });
      if (created) counts.overdueFollowups++;
    }
  });

  // 4) Overdue tasks (still PENDING past due).
  await runSource("tasks", async () => {
    const tasks = await prisma.task.findMany({
      where: { resident: { communityId }, status: "PENDING", dueDate: { lt: now } },
      select: { id: true, title: true, dueDate: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
    });
    for (const t of tasks) {
      if (await notify("SYSTEM_ALERT", "task", t.id, "Overdue task", `Task "${t.title}" for ${rname(t.resident)} (Room ${room(t.resident)}) was due ${fmtDate(t.dueDate)}.`)) counts.overdueTasks++;
    }
  });

  // 5) Low stock + expiry.
  await runSource("inventory", async () => {
    const items = await prisma.inventoryItem.findMany({
      where: { communityId },
      select: { id: true, itemName: true, quantity: true, minimumStock: true, reorderPoint: true, expiryDate: true },
    });
    for (const it of items) {
      const threshold = it.reorderPoint ?? it.minimumStock;
      if (it.quantity <= threshold) {
        if (await notify("SYSTEM_ALERT", "inventoryItem", `low:${it.id}`, "Low stock", `${it.itemName} is low — ${it.quantity} left (reorder at ${threshold}).`)) counts.lowStock++;
      }
      if (it.expiryDate) {
        const days = Math.floor((new Date(it.expiryDate).getTime() - nowTs) / 86_400_000);
        if (days <= 30) {
          const kind = days < 0 ? "expired" : "expiring";
          const title = days < 0 ? "Expired stock" : "Expiring soon";
          const msg = days < 0 ? `${it.itemName} expired ${-days} day(s) ago.` : `${it.itemName} expires in ${days} day(s).`;
          if (await notify("SYSTEM_ALERT", "inventoryItem", `${kind}:${it.id}`, title, msg)) counts.lowStock++;
        }
      }
    }
  });

  // 6) Missed daily documentation (after midday, no round today).
  if (now.getHours() >= 12) {
    await runSource("daily-doc", async () => {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const dateStr = startOfDay.toISOString().slice(0, 10);
      const [residents, rounds] = await Promise.all([
        prisma.resident.findMany({ where: { communityId }, select: { id: true, firstName: true, lastName: true, roomNumber: true } }),
        prisma.dailyRound.findMany({ where: { resident: { communityId }, roundDate: { gte: startOfDay } }, select: { residentId: true } }),
      ]);
      const documented = new Set(rounds.map((r) => r.residentId));
      for (const r of residents) {
        if (documented.has(r.id)) continue;
        if (await notify("SYSTEM_ALERT", "dailyDoc", `doc:${r.id}:${dateStr}`, "Missing daily documentation", `No daily round recorded today for ${rname(r)} (Room ${room(r)}).`)) counts.missedDocs++;
      }
    });
  }

  // 6b) Missed shift documentation — no shift report submitted today (evening check).
  if (now.getHours() >= 19) {
    await runSource("shift-doc", async () => {
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const dateStr = startOfDay.toISOString().slice(0, 10);
      const reportsToday = await prisma.shiftReport.count({ where: { communityId, createdAt: { gte: startOfDay } } });
      if (reportsToday === 0) {
        if (await notify("SYSTEM_ALERT", "dailyDoc", `shiftdoc:${communityId}:${dateStr}`, "Missing shift documentation", "No shift report has been submitted today. Please complete the shift endorsement/handover.", "INFO")) counts.missedDocs++;
      }
    });
  }

  // 7) Weight loss trend (>5% drop over the last ~5 weeks).
  await runSource("weight-trend", async () => {
    const weights = await prisma.vitalsLog.findMany({
      where: { resident: { communityId }, type: "WEIGHT", recordedAt: { gte: new Date(nowTs - 35 * 86_400_000) } },
      select: { residentId: true, value: true, recordedAt: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } },
      orderBy: { recordedAt: "asc" },
    });
    const byResident = new Map<string, typeof weights>();
    for (const w of weights) {
      const arr = byResident.get(w.residentId) ?? [];
      arr.push(w);
      byResident.set(w.residentId, arr);
    }
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    for (const [residentId, arr] of byResident) {
      if (arr.length < 2) continue;
      const first = parseFloat(arr[0].value);
      const last = parseFloat(arr[arr.length - 1].value);
      if (!isFinite(first) || !isFinite(last) || first <= 0) continue;
      const dropPct = ((first - last) / first) * 100;
      if (dropPct >= 5) {
        const r = arr[arr.length - 1].resident;
        if (await notify("SYSTEM_ALERT", "weightTrend", `weight:${residentId}:${monthKey}`, "Weight loss detected", `${rname(r)} (Room ${room(r)}) is down ${dropPct.toFixed(1)}% (${first} → ${last}) over the past weeks. Consider a nutrition review.`)) counts.weightLoss++;
      }
    }
  });

  // 7a2) Facility operations queue — pending purchase (inventory) requests, open
  //      resident service tickets, due/overdue maintenance, and pending dining
  //      reservations. Operational (non-clinical) entity types so they surface
  //      in the Facility Operations bell. Sent to facility admins.
  await runSource("facility-ops", async () => {
    const opsIds = idsForRoles(["FACILITY_ADMIN"]);
    if (!opsIds.length) return;

    const prs = await prisma.purchaseRequest.findMany({ where: { communityId, status: "REQUESTED" }, select: { id: true, itemName: true, quantity: true, priority: true } });
    for (const pr of prs) {
      const pri = pr.priority && pr.priority !== "NORMAL" ? ` (${pr.priority})` : "";
      await notify("SYSTEM_ALERT", "purchaseRequest", pr.id, "Purchase request pending", `${pr.itemName} ×${pr.quantity} is awaiting approval${pri}.`, "INFO", opsIds);
    }

    const svc = await prisma.serviceRequest.findMany({ where: { communityId, status: "OPEN" }, select: { id: true, category: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } } });
    for (const sr of svc) {
      await notify("SYSTEM_ALERT", "serviceRequest", sr.id, "Service request open", `${String(sr.category).replace(/_/g, " ").toLowerCase()} request for ${rname(sr.resident)} (Room ${room(sr.resident)}).`, "INFO", opsIds);
    }

    const mnt = await prisma.facilityMaintenance.findMany({ where: { communityId, status: "SCHEDULED", scheduledDate: { lte: now } }, select: { id: true, title: true, scheduledDate: true } });
    for (const m of mnt) {
      await notify("SYSTEM_ALERT", "maintenance", m.id, "Maintenance due", `${m.title}${m.scheduledDate ? ` — scheduled ${fmtDate(m.scheduledDate)}` : ""}.`, "INFO", opsIds);
    }

    const din = await prisma.diningReservation.findMany({ where: { communityId, status: "REQUESTED", reservedAt: { gte: now } }, select: { id: true, mealType: true, reservedAt: true, partySize: true, resident: { select: { firstName: true, lastName: true, roomNumber: true } } } });
    for (const d of din) {
      await notify("SYSTEM_ALERT", "diningReservation", d.id, "Dining reservation", `${String(d.mealType).toLowerCase()} · party of ${d.partySize} for ${rname(d.resident)} — ${fmtDate(d.reservedAt)}.`, "INFO", opsIds);
    }
  });

  // 7b) Reassessment overdue — residents whose scheduled next assessment date
  //     has passed (set from the acuity level when an assessment is saved).
  //     Clinical-only recipients (nurse / care manager / physician) so it never
  //     reaches the operations-only Facility bell.
  await runSource("reassessment-due", async () => {
    const clinicalIds = idsForRoles(["NURSE", "CARE_MANAGER", "PHYSICIAN"]);
    if (!clinicalIds.length) return;
    const due = await prisma.resident.findMany({
      where: { communityId, status: { not: "DISCHARGED" }, nextAssessmentDue: { not: null, lte: now } },
      select: { id: true, firstName: true, lastName: true, roomNumber: true, nextAssessmentDue: true, currentAcuityLevel: true },
    });
    for (const r of due) {
      const dayKey = r.nextAssessmentDue ? new Date(r.nextAssessmentDue).toISOString().slice(0, 10) : "na";
      await notify(
        "SYSTEM_ALERT", "assessment", `reassess:${r.id}:${dayKey}`,
        "Reassessment due",
        `${rname(r)} (Room ${room(r)}) is due for reassessment${r.currentAcuityLevel ? ` (${r.currentAcuityLevel} acuity)` : ""}. Complete an updated assessment.`,
        "WARNING", clinicalIds,
      );
    }
  });

  // 8) SLA auto-escalation — CRITICAL alerts left unacknowledged past their
  //    response window are escalated to the on-call/admin team (Module 09 SLA
  //    enforcement, server side). Deduped per underlying alert.
  await runSource("sla-escalation", async () => {
    const cutoff = new Date(nowTs - slaMinutes("CRITICAL") * 60_000);
    const overdue = await prisma.notification.findMany({
      where: {
        communityId,
        severity: "CRITICAL",
        isRead: false,
        type: { in: ["VITAL_ALERT", "INCIDENT_REPORT"] },
        createdAt: { lt: cutoff, gte: new Date(nowTs - 24 * 3_600_000) },
        OR: [{ snoozedUntil: null }, { snoozedUntil: { lt: now } }],
      },
      select: { id: true, title: true, relatedEntityId: true },
    });
    // Multiple recipients share one underlying alert — escalate it once.
    const byEntity = new Map<string, (typeof overdue)[number]>();
    for (const o of overdue) byEntity.set(String(o.relatedEntityId ?? o.id), o);
    for (const [key, o] of byEntity) {
      await notify("SYSTEM_ALERT", "slaBreach", `sla:${key}`, "SLA breach — critical alert unacknowledged", `"${o.title}" has not been acknowledged within the ${slaMinutes("CRITICAL")}-minute SLA. Please respond now.`, "CRITICAL");
    }
  });

  // 9) SBAR SLA auto-escalation — an SBAR clinical escalation still OPEN
  //    (unacknowledged) past its priority response window is auto-escalated to
  //    the on-call/admin tier: status → ESCALATED and assignedToRole →
  //    FACILITY_ADMIN, mirroring the nurse/physician "On-call" action, then the
  //    team is notified. The status flip is itself the idempotency guard — once
  //    ESCALATED the SBAR is no longer OPEN, so it is never re-processed. Scoped
  //    via the resident's community; a 24h floor ignores stale rows.
  await runSource("sbar-escalation", async () => {
    const open = await prisma.escalation.findMany({
      where: {
        resident: { communityId },
        status: "OPEN",
        createdAt: { gte: new Date(nowTs - 24 * 3_600_000) },
      },
      select: {
        id: true, priority: true, createdAt: true,
        resident: { select: { firstName: true, lastName: true, roomNumber: true } },
      },
    });
    for (const e of open) {
      const slaMin = SBAR_SLA_MIN[String(e.priority)] ?? 30;
      if (nowTs - new Date(e.createdAt).getTime() < slaMin * 60_000) continue; // still within SLA
      await prisma.escalation.update({
        where: { id: e.id },
        data: { status: "ESCALATED", assignedToRole: "FACILITY_ADMIN" },
      });
      if (await notify(
        "SYSTEM_ALERT", "escalation", `sbar-sla:${e.id}`,
        "SBAR escalation breached — auto-escalated to on-call",
        `${rname(e.resident)} (Room ${room(e.resident)}): a ${String(e.priority).toLowerCase()} SBAR was not acknowledged within the ${slaMin}-minute SLA and has been escalated to on-call. Please respond now.`,
        "CRITICAL",
        // Notify the full clinical chain of command: nurse → care manager → physician → admin.
        escalationChainIds,
      )) counts.sbarEscalations++;
    }
  });

  return counts;
}

async function runScan(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  const isCron = Boolean(secret) && authz === `Bearer ${secret}`;

  let communities: { id: string; organizationId: string | null }[] = [];
  if (isCron) {
    communities = await prisma.community.findMany({ where: { isActive: true }, select: { id: true, organizationId: true } });
  } else {
    const ctx = await requireTenantContext({});
    if (!ctx || ctx.isPlatform || !ctx.communityId || !["FACILITY_ADMIN", "SUPERADMIN", "NURSE"].includes(ctx.role)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    communities = [{ id: ctx.communityId, organizationId: ctx.organizationId ?? null }];
  }

  const totals: Scan = { abnormalVitals: 0, missedMeds: 0, overdueFollowups: 0, overdueTasks: 0, lowStock: 0, missedDocs: 0, weightLoss: 0, incidents: 0, sbarEscalations: 0 };
  for (const c of communities) {
    try {
      const s = await scanCommunity(c.id, c.organizationId);
      for (const k of Object.keys(totals) as (keyof Scan)[]) totals[k] += s[k];
    } catch (e) {
      console.error("alerts scan failed for community", c.id, e instanceof Error ? e.message : "unknown");
    }
    // Camera health watchdog — alert on offline monitored cameras (best-effort).
    try { await scanCameraHealth(c.id, c.organizationId); }
    catch (e) { console.error("camera-health scan failed for community", c.id, e instanceof Error ? e.message : "unknown"); }
  }
  const created = Object.values(totals).reduce((a, b) => a + b, 0);
  return NextResponse.json({ ok: true, communities: communities.length, created, breakdown: totals });
}

export async function GET(request: NextRequest) {
  return runScan(request);
}
export async function POST(request: NextRequest) {
  return runScan(request);
}
