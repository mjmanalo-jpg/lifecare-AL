import { NextRequest, NextResponse } from "next/server";
import { getModel, isDbConfigured } from "@/lib/models";
import { DEMO } from "@/lib/demoData";
import { scopeDemoRows } from "@/lib/scope";
import { requireTenantContext, isDeniedWhere, sanitizeTenantWrite, tenantWhere, isClinicalWriteDenied } from "@/lib/tenant";
import { assertMutationEntitled, EntitlementError } from "@/lib/entitlements";
import { logAudit, snapshot } from "@/lib/audit";
import { transactionDelegate, withTenantDb } from "@/lib/tenantDb";
import { prisma } from "@/lib/prisma";
import { invalidatePortalDataPrefix } from "@/lib/dataCache";
import { createMedTaskForSchedule } from "@/lib/medTaskSync";
import { canEditResidentProfile } from "@/lib/residentAccess";
import { CAREGIVER_SCHEDULE_KEY, CAREGIVER_BREAKGLASS_KEY } from "@/lib/caregiverSchedule";
import { assignmentCompetencyIssues, assignmentEquipmentIssues, assignmentGateMessage } from "@/lib/assignmentGate";

// Roles allowed to set the caregiver roster (mirrors the scheduler roles that
// get the Caregiver Schedule board). Everyone else is read-only on it.
const SCHEDULER_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN", "ORGANIZATION_ADMIN"]);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELF_WRITABLE = new Set([
  "messages", "notifications", "visits", "call-bells", "tasks", "transport-requests",
  "resident-goals", "medication-logs", "service-requests", "concierge-bookings",
  "resident-preferences", "event-attendances", "dining-reservations",
  // Family/resident self-service: upload files + e-sign consent for their own
  // resident (the residentId guard scopes writes to their accessible resident).
  "resident-documents",
]);
const EXPLICIT_ADMIN_MODELS = new Set([
  "organizations", "communities", "users", "plans", "subscriptions",
  "organization-memberships", "community-memberships", "invitations",
]);

// Counts the org-admin overview derives from these tables (per-community
// residents / staff / rooms); drop the cached portal payload on changes so the
// Communities cards and usage stats reflect live data on the next poll.
const OVERVIEW_COUNT_MODELS = new Set(["residents", "rooms", "staff"]);

function buildQuery(url: URL, defaultOrderBy?: Record<string, unknown>) {
  const params = url.searchParams;
  const take = Math.min(Math.max(Number(params.get("take") || 200), 1), 500);
  const where: Record<string, unknown> = {};
  params.forEach((value, key) => {
    if (!key.startsWith("f_")) return;
    const field = key.slice(2);
    where[field] = value === "true" ? true : value === "false" ? false : value === "null" ? null : value;
  });
  const includeParam = params.get("include");
  const include = includeParam
    ? Object.fromEntries(includeParam.split(",").map((name) => name.trim()).filter((name) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(name)).map((name) => [name, true]))
    : undefined;
  return { take, where, include, orderBy: defaultOrderBy };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model } = await params;
  const definition = getModel(model);
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isDbConfigured()) {
    const rows = scopeDemoRows(model, DEMO[model] || [], context.role, context.userId);
    return NextResponse.json({ data: rows, count: rows.length, demo: true });
  }

  const scope = tenantWhere(model, context);
  if (isDeniedWhere(scope)) return NextResponse.json({ data: [], count: 0 });
  const { take, where, include, orderBy } = buildQuery(new URL(request.url), definition.orderBy);
  try {
    const rows = await withTenantDb(context, async (tx) => transactionDelegate(definition, tx).findMany({
      where: scope ? { AND: [where, scope] } : where,
      take,
      ...(orderBy ? { orderBy } : {}),
      ...(include ? { include } : {}),
    }));
    // Never expose internal `__`-prefixed settings (e.g. signing-PIN hashes).
    const data = model === "app-settings"
      ? (rows as Array<{ key?: string; id: string }>).filter((r) => !String(r.key || r.id).startsWith("__"))
      : rows;
    // An included `user` relation (?include=user) otherwise carries the bcrypt
    // passwordHash + Supabase authUserId straight to the client. Strip them and
    // expose only a derived first-time-setup flag (mirrors org-admin overview API).
    const sanitized = (data as Array<Record<string, unknown>>).map((row) => {
      const u = row?.user as Record<string, unknown> | undefined;
      if (u && typeof u === "object" && "passwordHash" in u) {
        const { passwordHash, authUserId, ...rest } = u;
        void authUserId;
        return { ...row, user: { ...rest, needsFirstPassword: !passwordHash } };
      }
      return row;
    });
    return NextResponse.json({ data: sanitized, count: sanitized.length });
  } catch {
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }
}

// Immediately notify the Care Manager + nurses of a SEVERE/CRITICAL incident so
// it appears in their Alert Center right away (with an SLA countdown), instead of
// waiting for the next alerts-cron tick. Best-effort — never blocks the create.
async function alertSevereIncident(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  incident: Record<string, unknown>,
) {
  try {
    const severity = String(incident.severity ?? "");
    if (!context.communityId || !["SEVERE", "CRITICAL"].includes(severity)) return;
    const crit = severity === "CRITICAL";
    const recipients = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE", role: { in: ["FACILITY_ADMIN", "NURSE"] } },
      select: { userId: true },
    });
    if (!recipients.length) return;
    const kind = String(incident.incidentType ?? "incident").replace(/_/g, " ").toLowerCase();
    await prisma.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.userId,
        type: "INCIDENT_REPORT" as const,
        title: `${crit ? "Critical" : "Severe"} incident — ${kind}`,
        message: `A ${crit ? "critical" : "severe"} ${kind} incident was reported. Review immediately.`,
        // Both severe and critical incidents are alerted at CRITICAL level so
        // they surface prominently (top lane, 15-min SLA), not buried as warnings.
        severity: "CRITICAL",
        relatedEntityId: String(incident.id),
        relatedEntityType: "incident",
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      })),
    });
  } catch (e) {
    console.error("[incident alert] failed:", e instanceof Error ? e.message : e);
  }
}

// When the fleet manager assigns a trip (creates a Trip with a driverId), ping
// the assigned driver so they know a new trip is waiting on their Trip Board.
// Drivers have no direct user link, so we resolve their login by matching the
// Driver's name (then email) to a community member. Best-effort — never blocks
// the create.
async function notifyDriverOfTrip(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  trip: Record<string, unknown>,
) {
  try {
    const driverId = trip.driverId ? String(trip.driverId) : "";
    if (!driverId || !context.communityId) return;
    const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { name: true, email: true } });
    if (!driver) return;
    const dn = (driver.name ?? "").trim().toLowerCase();
    const de = (driver.email ?? "").trim().toLowerCase();
    if (!dn && !de) return;
    const members = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE" },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    const target = members
      .map((m) => m.user)
      .find((u) => u && (((u.name ?? "").trim().toLowerCase() === dn) || (!!de && (u.email ?? "").trim().toLowerCase() === de)));
    if (!target) return;
    const when = trip.scheduledAt ? new Date(String(trip.scheduledAt)).toLocaleString() : "soon";
    await prisma.notification.create({
      data: {
        userId: target.id,
        type: "TRANSPORT_UPDATE" as const,
        title: "New trip assigned",
        message: `You've been assigned a trip to ${String(trip.destination ?? "a destination")} scheduled ${when}. Check your Trip Board.`,
        relatedEntityId: String(trip.id),
        relatedEntityType: "trip",
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      },
    });
  } catch (e) {
    console.error("[trip assign notify] failed:", e instanceof Error ? e.message : e);
  }
}

// Real-time facility-operations alerts: when a resident/staff creates one of
// these operational records, notify facility admins immediately (instead of
// waiting for the alerts-cron tick). Same SYSTEM_ALERT + operational entity type
// the cron uses, so its dedup (type|id) won't double-fire. Best-effort.
const FACILITY_OPS_NOTIFY: Record<string, { entityType: string; build: (r: Record<string, unknown>) => { title: string; message: string } }> = {
  "dining-reservations": {
    entityType: "diningReservation",
    build: (r) => ({ title: "New dining reservation", message: `${String(r.mealType ?? "meal").toLowerCase()} · party of ${r.partySize ?? 1}${r.reservedAt ? ` — ${new Date(String(r.reservedAt)).toLocaleString()}` : ""}.` }),
  },
  "service-requests": {
    entityType: "serviceRequest",
    build: (r) => ({ title: "New service request", message: `${String(r.category ?? "service").replace(/_/g, " ").toLowerCase()} request submitted.` }),
  },
  "purchase-requests": {
    entityType: "purchaseRequest",
    build: (r) => ({ title: "Purchase request submitted", message: `${r.itemName ?? "Item"} ×${r.quantity ?? 1} is awaiting approval.` }),
  },
  "facility-maintenance": {
    entityType: "maintenance",
    build: (r) => ({ title: "New maintenance request", message: `${r.title ?? "Maintenance"}${r.scheduledDate ? ` — scheduled ${new Date(String(r.scheduledDate)).toLocaleDateString()}` : ""}.` }),
  },
  "concierge-bookings": {
    entityType: "conciergeBooking",
    build: (r) => ({ title: "New concierge booking", message: `${String(r.serviceType ?? r.category ?? "Booking")} requested.` }),
  },
};

async function notifyFacilityOps(
  context: NonNullable<Awaited<ReturnType<typeof requireTenantContext>>>,
  model: string,
  record: Record<string, unknown>,
) {
  try {
    const cfg = FACILITY_OPS_NOTIFY[model];
    if (!cfg || !context.communityId) return;
    const recipients = await prisma.communityMembership.findMany({
      where: { communityId: context.communityId, status: "ACTIVE", role: "FACILITY_ADMIN" },
      select: { userId: true },
    });
    if (!recipients.length) return;
    const { title, message } = cfg.build(record);
    await prisma.notification.createMany({
      data: recipients.map((m) => ({
        userId: m.userId,
        type: "SYSTEM_ALERT" as const,
        title,
        message,
        severity: "INFO",
        relatedEntityId: String(record.id),
        relatedEntityType: cfg.entityType,
        organizationId: context.organizationId ?? null,
        communityId: context.communityId,
      })),
    });
  } catch (e) {
    console.error("[facility ops notify] failed:", e instanceof Error ? e.message : e);
  }
}

// SLICE 1 — app-settings keyed-array delta merge helpers.
// The 4 caregiver blob stores (care_log_notes, adl_logs, weight_logs,
// shift_endorsements) are a JSON array in one AppSetting row. A whole-array PUT
// silently drops concurrent writers (lost update). A delta write mutates ONE
// entry by id, under a row lock, so concurrent writers no longer clobber.
type SettingEntry = Record<string, unknown>;
function parseSettingArray(value: unknown): SettingEntry[] {
  if (typeof value !== "string") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? (v as SettingEntry[]) : [];
  } catch {
    return [];
  }
}
// Apply a single-entry delta, matching by `id`. upsert replaces an existing entry
// in place (preserving order) or prepends a new one (matching the clients'
// [new, ...rest] convention); delete removes it. Pure — unit-checked below.
function applySettingDelta(arr: SettingEntry[], op: "upsert" | "delete", entry: SettingEntry, id: string): SettingEntry[] {
  const idx = arr.findIndex((e) => e && typeof e === "object" && String((e as SettingEntry).id ?? "") === id);
  if (op === "delete") {
    if (idx >= 0) arr.splice(idx, 1);
    return arr;
  }
  if (idx >= 0) arr[idx] = entry;
  else arr.unshift(entry);
  return arr;
}

// The 4 caregiver blob stores migrated to single-entry deltas. A stale/online
// client on the old bundle still PUTs the WHOLE array for these keys (bypassing
// the outbox diff); those writes are merged additively by id under the same lock
// instead of overwriting, so they can't clobber concurrent writers. This set is
// deliberately EXACT — every other app-settings key keeps plain overwrite, since
// many hold scalar/non-array values that an additive merge would corrupt.
const MERGE_ARRAY_SETTING_KEYS = new Set(["care_log_notes", "adl_logs", "weight_logs", "shift_endorsements"]);
function isJsonArrayString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return Array.isArray(JSON.parse(value));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ model: string }> }) {
  const context = await requireTenantContext({ allowPlatform: true });
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { model } = await params;
  const definition = getModel(model);
  if (!definition) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (EXPLICIT_ADMIN_MODELS.has(model)) return NextResponse.json({ error: "Use the dedicated administration API" }, { status: 403 });
  const selfService = context.role === "FAMILY" || context.role === "RESIDENT";
  if (selfService && !SELF_WRITABLE.has(model)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  // Clinical routine models: writes are Nurse/CM/SuperAdmin only (reads open).
  if (isClinicalWriteDenied(model, context)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!context.isPlatform && !context.communityId && model !== "app-settings") return NextResponse.json({ error: "Select a community" }, { status: 409 });
  // Module 01 — admitting a resident creates the master profile, so it is limited
  // to the profile-edit roles (Care Manager / Administrator).
  if (model === "residents" && !canEditResidentProfile(context.role, context.isPlatform)) {
    return NextResponse.json({ error: "Only a Care Manager or Administrator can admit or edit residents." }, { status: 403 });
  }

  const input = await request.json();
  if (typeof input !== "object" || !input || Array.isArray(input)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  // Protect the caregiver scheduling settings from tampering: the roster may only
  // be written by scheduling roles, and break-glass grants only by the dedicated
  // /api/caregiver/break-glass endpoint — never a caregiver rewriting their own scope.
  if (model === "app-settings" && !context.isPlatform) {
    const settingKey = String((input as { key?: unknown; id?: unknown }).key ?? (input as { id?: unknown }).id ?? "").trim();
    if (settingKey === CAREGIVER_BREAKGLASS_KEY) {
      return NextResponse.json({ error: "Break-glass access is granted through the break-glass endpoint." }, { status: 403 });
    }
    if (settingKey === CAREGIVER_SCHEDULE_KEY && !SCHEDULER_ROLES.has(context.role) && !context.isOrganizationAdmin) {
      return NextResponse.json({ error: "Only nursing/care management can set the caregiver schedule." }, { status: 403 });
    }
  }
  // SLICE 1 — detect an app-settings single-entry delta ({ key, op, entry:{id} }).
  // Legacy whole-array `value:` writes carry no `op` and fall through unchanged.
  const deltaOp = model === "app-settings" ? String((input as Record<string, unknown>).op ?? "").trim() : "";
  let deltaEntry: Record<string, unknown> | null = null;
  let deltaEntryId = "";
  if (deltaOp) {
    if (deltaOp !== "upsert" && deltaOp !== "delete") return NextResponse.json({ error: "Invalid delta op" }, { status: 400 });
    const e = (input as Record<string, unknown>).entry;
    if (!e || typeof e !== "object" || Array.isArray(e)) return NextResponse.json({ error: "A delta write requires an entry object" }, { status: 400 });
    deltaEntry = e as Record<string, unknown>;
    deltaEntryId = String(deltaEntry.id ?? "").trim();
    if (!deltaEntryId) return NextResponse.json({ error: "A delta entry requires a non-empty id" }, { status: 400 });
  }
  const data = sanitizeTenantWrite(model, input, context);
  // A present-but-empty residentId ("") is falsy, so the old truthiness check
  // skipped validation and let Prisma raise a raw foreign-key error. Validate
  // whenever a value is actually supplied (null/undefined still mean "omitted"),
  // and reject empties up front with a clean message.
  if (data.residentId !== undefined && data.residentId !== null && !context.isPlatform) {
    const residentId = String(data.residentId).trim();
    if (!residentId) return NextResponse.json({ error: "A resident must be selected" }, { status: 422 });
    const residentScope = tenantWhere("residents", context);
    const residentDefinition = getModel("residents")!;
    const resident = await withTenantDb(context, async (tx) => transactionDelegate(residentDefinition, tx).findFirst({ where: { AND: [{ id: residentId }, residentScope] }, select: { id: true } }));
    if (!resident) return NextResponse.json({ error: "Related resident not found" }, { status: 422 });
  }
  // Assignment safety gate (§4.2): a task may not be created pre-assigned to
  // someone who doesn't hold the SOP's required competencies (verified, unexpired).
  if (model === "tasks" && typeof data.assignedToId === "string" && data.assignedToId && !context.isPlatform) {
    const gateInput = {
      communityId: context.communityId ?? (typeof data.communityId === "string" ? data.communityId : ""),
      staffId: data.assignedToId,
      sopIds: typeof data.sopId === "string" ? [data.sopId] : [],
    };
    const [competencyIssues, equipmentIssues] = await Promise.all([
      assignmentCompetencyIssues(prisma, gateInput),
      assignmentEquipmentIssues(prisma, gateInput),
    ]);
    const issues = [...competencyIssues, ...equipmentIssues];
    if (issues.length) {
      return NextResponse.json({
        error: `Assignment blocked by the safety gate — required competency ${assignmentGateMessage(issues)}.`,
        code: "ASSIGNMENT_SAFETY_GATE",
        issues,
      }, { status: 422 });
    }
  }
  if (!isDbConfigured()) return NextResponse.json({ data: { id: `demo-${Date.now()}`, ...data }, demo: true }, { status: 201 });

  try {
    if (context.organizationId) await assertMutationEntitled(context, model);
    // A stale/online client on the old bundle PUTs the whole array for a migrated
    // key (no `op`, bypassing the outbox diff). Route it through the same locked
    // additive merge so it can't blind-overwrite concurrent writers. Scoped to the
    // 4 array keys only; everything else keeps the untouched legacy path below.
    const settingKey = model === "app-settings" ? String((data as Record<string, unknown>).key ?? "").trim() : "";
    const legacyArrayMerge = !deltaOp && MERGE_ARRAY_SETTING_KEYS.has(settingKey) && isJsonArrayString((data as Record<string, unknown>).value);
    const created = deltaOp || legacyArrayMerge
      ? await prisma.$transaction(async (tx) => {
          const delegate = transactionDelegate(definition, tx);
          const settingData = data as Record<string, unknown>;
          const key = String(settingData.key ?? "").trim();
          if (!key) throw new Error("An app-settings write requires a key");
          const orgId = (settingData.organizationId ?? null) as string | null;
          const commId = (settingData.communityId ?? null) as string | null;
          // Serialize every concurrent merge on this (org,comm,key). The xact-scoped
          // advisory lock releases at commit and also covers the not-yet-created row,
          // so a first-write race can't collide on the (org,community,key) unique.
          // withTenantDb is a no-op passthrough unless DB_RLS_GUCS=true, so the merge
          // MUST run in its own explicit transaction to hold the lock across the RMW.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`app-settings:${orgId ?? ""}:${commId ?? ""}:${key}`}))`;
          const existing = await delegate.findFirst({ where: { key, organizationId: orgId, communityId: commId } }) as { id: string; value?: unknown } | null;
          let next: SettingEntry[];
          if (deltaOp) {
            next = applySettingDelta(parseSettingArray(existing?.value), deltaOp as "upsert" | "delete", deltaEntry as Record<string, unknown>, deltaEntryId);
          } else {
            // Legacy whole-array write → additive merge: replay each incoming entry
            // as an upsert-by-id onto the stored array (oldest-first so the newest
            // lands on top), preserving any stored-only entries the stale client
            // never saw. A whole-array write can't express a delete without the
            // client's baseline, so server entries are never dropped here.
            next = parseSettingArray(existing?.value);
            const incoming = parseSettingArray(settingData.value);
            for (let i = incoming.length - 1; i >= 0; i--) {
              const entry = incoming[i];
              const id = String((entry as SettingEntry).id ?? "");
              if (id) next = applySettingDelta(next, "upsert", entry, id);
            }
          }
          const value = JSON.stringify(next);
          if (existing) return delegate.update({ where: { id: existing.id }, data: { value } });
          // settingData still carries the delta's `op`/`entry` — sanitizeTenantWrite
          // only strips organization/community, and AppSetting has no such columns,
          // so a FIRST-write create({ ...settingData }) throws (unknown args) and the
          // entry is silently lost. Drop them; the merged array is the value.
          const { op: _op, entry: _entry, ...rest } = settingData;
          void _op; void _entry;
          return delegate.create({ data: { ...rest, value } });
        })
      : await withTenantDb(context, async (tx) => {
          const delegate = transactionDelegate(definition, tx);
          // app-settings are keyed data: a POST means "set this key". Match the
          // existing row by its tenant-composite (organizationId, communityId, key)
          // rather than by primary key, then update in place — otherwise a legacy row
          // saved under a bare-key id (before composite ids) is never found by an
          // id-based upsert and the create collides on the (org, community, key)
          // unique. Falls back to create when the key is genuinely new.
          if (model === "app-settings") {
            const settingData = data as Record<string, unknown>;
            const key = String(settingData.key ?? "").trim();
            if (key) {
              const existing = await delegate.findFirst({
                where: { key, organizationId: settingData.organizationId ?? null, communityId: settingData.communityId ?? null },
              }) as { id: string } | null;
              if (existing) {
                const { id: _omitId, ...rest } = settingData;
                void _omitId;
                return delegate.update({ where: { id: existing.id }, data: rest });
              }
            }
            return delegate.create({ data });
          }
          return delegate.create({ data });
        });
    if (OVERVIEW_COUNT_MODELS.has(model) && context.organizationId) invalidatePortalDataPrefix(`org-admin:${context.organizationId}:`);
    // Audit snapshot. Daily-round sub-records (pain, mood, meal, vitals, …) carry
    // no residentId of their own — the resident lives on the parent DailyRound —
    // so resolve it here, otherwise the Audit Trail's Resident column is blank.
    const auditAfter = snapshot(created) as Record<string, unknown>;
    const createdRec = created as Record<string, unknown>;
    if (!auditAfter.residentId && createdRec.dailyRoundId) {
      const round = await prisma.dailyRound
        .findUnique({ where: { id: String(createdRec.dailyRoundId) }, select: { residentId: true } })
        .catch(() => null);
      if (round?.residentId) auditAfter.residentId = round.residentId;
    }
    logAudit({
      actorId: context.userId,
      actorRole: context.role,
      action: "CREATE",
      entityType: model,
      entityId: created.id,
      organizationId: context.organizationId,
      communityId: context.communityId,
      after: auditAfter,
    });
    // Severe/Critical incidents auto-alert the Care Manager (+ nurses) the moment
    // they're reported — they surface in the Alert Center with an SLA countdown.
    // The alerts cron dedups on INCIDENT_REPORT|<id>, so it won't double-fire.
    if (model === "incidents") await alertSevereIncident(context, created);
    // Assigning a trip to a driver notifies that driver of their new trip.
    if (model === "trips") await notifyDriverOfTrip(context, created);
    // Operational records (dining/service/purchase/maintenance/concierge)
    // notify facility admins in real time.
    if (FACILITY_OPS_NOTIFY[model]) await notifyFacilityOps(context, model, created);
    // A SCHEDULED dose opens an unassigned task for on-duty caregivers/nurses;
    // completing that task records the dose as GIVEN (see [id] PATCH hook).
    if (model === "medication-administrations") await createMedTaskForSchedule(context, created);
    return NextResponse.json({ data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof EntitlementError) return NextResponse.json({ error: error.message, code: error.code }, { status: 403 });
    console.error(`[db POST ${model}] create failed:`, error);
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Create failed", detail }, { status: 400 });
  }
}