import { prisma, withDbRetry } from "./prisma";
import { getSession, type SessionData } from "./auth";
import { ACCESS_STATUSES } from "./subscriptionStatus";
import {
  CAREGIVER_SCHEDULE_KEY, CAREGIVER_BREAKGLASS_KEY,
  parseSchedules, parseBreakglass, activeResidentIdsFor, activeBreakglassResidentIds,
} from "./caregiverSchedule";

export interface TenantContext {
  session: SessionData;
  userId: string;
  role: string;
  platformRole?: string;
  organizationRole?: string;
  organizationId?: string;
  communityId?: string;
  isPlatform: boolean;
  isOrganizationAdmin: boolean;
  /**
   * When set (CAREGIVER role only), the caller may only touch these resident ids
   * — the residents they are scheduled for TODAY (whole-day access), plus any
   * unexpired break-glass grants. An empty array means "no schedule today" →
   * they see no resident-linked data. `undefined` means "not a scoped caregiver"
   * (no restriction). Resolved once per context and cached with it.
   */
  caregiverResidentIds?: string[];
}

const DIRECT_COMMUNITY = new Set([
  "residents", "staff", "rooms", "tasks", "assessments", "acuity-scores",
  "service-catalogs", "care-packages", "community-sops", "competencies",
  "staff-competencies", "resident-quality-scores", "community-quality-dashboards",
  "kpi-records", "observations", "staffing-plans", "generated-reports",
]);

const RESIDENT_SCOPED = new Set([
  "vitals", "incidents", "medications", "resident-goals", "medication-logs",
  "medical-notes", "call-bells", "visits", "invoices", "resident-notes",
  "service-charges", "insurance-validations", "transport-requests",
  "trips", "dietitian-consults", "service-requests", "concierge-bookings",
  "front-desk-visits", "resident-preferences", "event-attendances",
  "dining-reservations", "escalations", "camera-monitoring-logs", "vaccinations",
  "resident-documents", "eliminations", "pain-assessments", "wound-cares",
  "sleep-logs", "mobility-logs", "care-plans", "hospital-referrals", "follow-ups",
  "care-timeline", "medication-administrations", "daily-rounds",
  "lab-results", "allergies",
]);

const ORG_ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);
const DENY = { id: "__tenant_access_denied__" };

// ---------------------------------------------------------------------------
// Short-lived identity caches.
//
// The database lives on a remote pooler (~150ms per round-trip). Every
// /api/db request resolves the tenant context first, and a single dashboard
// fires 6-19 of those at once — so without caching each page load pays the
// identity-resolution tax (a nested user+membership lookup) dozens of times
// over. Membership / role / subscription state changes rarely, so we memoize
// the resolved context (and the workspace tree) for a few seconds, keyed by
// the signed session fields. A workspace switch rewrites those fields, which
// produces a fresh cache key, so switching is never served stale data. Only
// successful lookups are cached; failures fall through and re-query so a
// just-approved / just-activated account is never locked out for the TTL.
// ---------------------------------------------------------------------------
const IDENTITY_TTL_MS = Number(process.env.IDENTITY_CACHE_TTL_MS || 15000);

type CacheEntry<T> = { expires: number; value: T };
function makeIdentityCache<T>() {
  const store = new Map<string, CacheEntry<T>>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T) {
      // Bound memory: sweep expired entries once the map grows large.
      if (store.size > 500) {
        const now = Date.now();
        for (const [k, v] of store) if (v.expires <= now) store.delete(k);
      }
      store.set(key, { expires: Date.now() + IDENTITY_TTL_MS, value });
    },
  };
}

type Workspaces = NonNullable<Awaited<ReturnType<typeof loadWorkspaces>>>;
const workspaceCache = makeIdentityCache<Workspaces>();
const contextCache = makeIdentityCache<TenantContext>();

export async function listWorkspaces(userId: string) {
  const cached = workspaceCache.get(userId);
  if (cached !== undefined) return cached;
  const result = await loadWorkspaces(userId);
  if (result) workspaceCache.set(userId, result);
  return result;
}

async function loadWorkspaces(userId: string) {
  // Retry transient pooler timeouts — this runs during sign-in, so a cold
  // pooler here would otherwise fail the login with a 500.
  const user = await withDbRetry(() => prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      platformRole: true,
      organizationMemberships: {
        where: { status: "ACTIVE" },
        include: {
          organization: {
            include: {
              subscription: { include: { plan: { include: { entitlements: true } } } },
              communities: { where: { isActive: true }, orderBy: { name: "asc" } },
            },
          },
        },
      },
      communityMemberships: {
        where: { status: "ACTIVE" },
        include: { community: { include: { organization: true } } },
      },
    },
  }));
  if (!user) return null;

  const communityRoles = new Map(user.communityMemberships.map((membership) => [membership.communityId, membership.role]));
  return {
    user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole },
    organizations: user.organizationMemberships
      .filter((membership) => membership.organization.status === "ACTIVE")
      .map((membership) => ({
        id: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug,
        logoUrl: membership.organization.logoUrl,
        primaryColor: membership.organization.primaryColor,
        role: membership.role,
        subscriptionStatus: membership.organization.subscription?.status ?? null,
        plan: membership.organization.subscription?.plan
          ? {
              key: membership.organization.subscription.plan.key,
              name: membership.organization.subscription.plan.name,
              entitlements: membership.organization.subscription.plan.entitlements,
            }
          : null,
        communities: membership.organization.communities
          .filter((community) => ORG_ADMIN_ROLES.has(membership.role) || communityRoles.has(community.id))
          .map((community) => ({
            id: community.id,
            name: community.name,
            code: community.code,
            timezone: community.timezone,
            role: communityRoles.get(community.id) || "FACILITY_ADMIN",
          })),
      })),
  };
}

export async function requireTenantContext(options: { allowPlatform?: boolean; requireCommunity?: boolean; allowInactiveSubscription?: boolean } = {}): Promise<TenantContext | null> {
  const session = await getSession();
  if (!session?.userId) return null;

  // Reuse a recently-resolved context for the same session state. The key
  // folds in the fields that change access (active workspace, role, MFA level)
  // plus the option flags, so any change re-resolves against the DB.
  const cacheKey = `${session.userId}|${session.activeOrganizationId || ""}|${session.activeCommunityId || ""}|${session.role}|${session.authAssuranceLevel || ""}|${options.allowPlatform ? 1 : 0}|${options.requireCommunity ? 1 : 0}|${options.allowInactiveSubscription ? 1 : 0}`;
  const cachedContext = contextCache.get(cacheKey);
  if (cachedContext) return cachedContext;

  // Retry transient pooler timeouts: this runs in the [role] SSR layout, so an
  // uncaught throw here becomes a full "This page hit a snag" crash on every
  // portal page. A quick retry rides out a cold/saturated Supabase pooler.
  const user = await withDbRetry(() => prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      isActive: true,
      platformRole: true,
      organizationMemberships: session.activeOrganizationId
        ? { where: { organizationId: session.activeOrganizationId, status: "ACTIVE" }, include: { organization: { include: { subscription: true } } } }
        : { where: { id: "__none__" }, include: { organization: { include: { subscription: true } } } },
      communityMemberships: session.activeCommunityId
        ? { where: { communityId: session.activeCommunityId, status: "ACTIVE" }, include: { community: true } }
        : { where: { id: "__none__" }, include: { community: true } },
    },
  }));
  if (!user?.isActive) return null;

  const isPlatform = Boolean(user.platformRole);
  if (isPlatform && options.allowPlatform) {
    const platformContext: TenantContext = {
      session,
      userId: session.userId,
      role: session.role,
      platformRole: user.platformRole || undefined,
      organizationId: session.activeOrganizationId,
      communityId: session.activeCommunityId,
      isPlatform: true,
      isOrganizationAdmin: false,
    };
    contextCache.set(cacheKey, platformContext);
    return platformContext;
  }

  const orgMembership = user.organizationMemberships[0];
  if (!orgMembership || orgMembership.organization.status !== "ACTIVE") return null;
  const subscriptionStatus = orgMembership.organization.subscription?.status;
  // Lapsed subscriptions (SUSPENDED/CANCELED) are locked out — unless the caller
  // explicitly allows it (the billing route, so an org can pay to reactivate).
  if (!options.allowInactiveSubscription && subscriptionStatus && !ACCESS_STATUSES.has(subscriptionStatus)) return null;

  const communityMembership = user.communityMemberships[0];
  const isOrganizationAdmin = ORG_ADMIN_ROLES.has(orgMembership.role);
  if (session.activeCommunityId) {
    if (communityMembership?.community.organizationId !== orgMembership.organizationId && !isOrganizationAdmin) return null;
    if (!communityMembership && !isOrganizationAdmin) return null;
  }
  if (options.requireCommunity && !session.activeCommunityId) return null;

  const context: TenantContext = {
    session,
    userId: session.userId,
    role: communityMembership?.role || session.role,
    platformRole: user.platformRole || undefined,
    organizationRole: orgMembership.role,
    organizationId: orgMembership.organizationId,
    communityId: session.activeCommunityId,
    isPlatform,
    isOrganizationAdmin,
  };
  // Caregivers are locked to the residents they're scheduled for today (+ break-
  // glass). Resolve once here so tenantWhere() stays synchronous; cached with the
  // context (IDENTITY_TTL_MS), so a new schedule or break-glass grant takes effect
  // within that short window.
  if (context.role === "CAREGIVER" && context.communityId) {
    context.caregiverResidentIds = await resolveCaregiverResidentIds(context);
  }
  contextCache.set(cacheKey, context);
  return context;
}

/** The residents a caregiver may access right now: active-shift assignments plus
 *  unexpired break-glass grants. On a DB error, fail safe (empty = no access). */
async function resolveCaregiverResidentIds(context: TenantContext): Promise<string[]> {
  try {
    const rows = await withDbRetry(() => prisma.appSetting.findMany({
      where: {
        organizationId: context.organizationId,
        communityId: context.communityId,
        key: { in: [CAREGIVER_SCHEDULE_KEY, CAREGIVER_BREAKGLASS_KEY] },
      },
      select: { key: true, value: true },
    }));
    const now = new Date();
    // Schedule dates are picked in facility-local time; resolve "today" in that
    // zone so a UTC server doesn't shift the day for a Manila facility.
    const tz = process.env.FACILITY_TZ || "Asia/Manila";
    const schedRaw = rows.find((r) => r.key === CAREGIVER_SCHEDULE_KEY)?.value;
    const bgRaw = rows.find((r) => r.key === CAREGIVER_BREAKGLASS_KEY)?.value;
    const ids = new Set<string>();
    activeResidentIdsFor(context.userId, parseSchedules(schedRaw), now, tz).forEach((i) => ids.add(i));
    activeBreakglassResidentIds(context.userId, parseBreakglass(bgRaw), now).forEach((i) => ids.add(i));
    return [...ids];
  } catch (e) {
    console.error("[tenant] caregiver scope resolution failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

function residentAccessWhere(context: TenantContext) {
  const legacy = context.role === "RESIDENT"
    ? { userId: context.userId }
    : { sponsorId: context.userId };
  return {
    communityId: context.communityId,
    OR: [
      { authorizedUsers: { some: { userId: context.userId, isActive: true } } },
      legacy,
    ],
  };
}

export function tenantWhere(modelKey: string, context: TenantContext): Record<string, unknown> | null {
  if (context.isPlatform) return null;
  if (!context.organizationId) return DENY;

  if (modelKey === "organizations") return { id: context.organizationId };
  if (modelKey === "communities") return { organizationId: context.organizationId };
  if (modelKey === "app-settings") {
    return context.communityId
      ? { OR: [{ communityId: context.communityId }, { communityId: null, organizationId: context.organizationId }] }
      : { communityId: null, organizationId: context.organizationId };
  }
  if (modelKey === "users") {
    return context.communityId
      ? { communityMemberships: { some: { communityId: context.communityId, status: "ACTIVE" } } }
      : { organizationMemberships: { some: { organizationId: context.organizationId, status: "ACTIVE" } } };
  }
  if (modelKey === "messages") return { OR: [{ senderId: context.userId }, { recipientId: context.userId }] };
  if (modelKey === "notifications") return { userId: context.userId };
  if (modelKey === "audit-logs") return context.communityId ? { communityId: context.communityId } : DENY;
  if (!context.communityId) return DENY;

  const selfService = context.role === "FAMILY" || context.role === "RESIDENT";
  // A scheduled caregiver is narrowed to their active-shift residents. An empty
  // set becomes `{ id: { in: [] } }`, which Prisma resolves to zero rows — so
  // off-shift they see no resident-linked data at all.
  const cgScoped = Array.isArray(context.caregiverResidentIds);
  const cgIds = context.caregiverResidentIds ?? [];
  // The staff-side resident where-clause, further narrowed for caregivers.
  const residentWhere: Record<string, unknown> = selfService
    ? residentAccessWhere(context)
    : cgScoped
    ? { communityId: context.communityId, id: { in: cgIds } }
    : { communityId: context.communityId };

  if (modelKey === "residents") return residentWhere;
  if (modelKey === "admissions") {
    // Admissions are community-scoped, NOT resident-scoped: an in-progress
    // admission has no linked resident yet (the Resident is created only on
    // completion), so scoping by the resident relation would hide every
    // in-progress move-in. Staff see the community's admissions; a family/
    // resident sees only their own resident's admission. (Caregivers don't
    // manage intake, so they keep community-level visibility here.)
    return selfService ? { resident: residentAccessWhere(context) } : { communityId: context.communityId };
  }
  if (modelKey === "tasks") {
    // Tasks carry a required residentId. Staff see the whole community's tasks;
    // a caregiver sees only their active-shift residents' tasks; a resident/
    // family may only see (and complete) their own.
    if (selfService) return { resident: residentAccessWhere(context) };
    if (cgScoped) return { communityId: context.communityId, residentId: { in: cgIds } };
    return { communityId: context.communityId };
  }
  if (RESIDENT_SCOPED.has(modelKey)) {
    return { resident: residentWhere };
  }
  if (modelKey === "payments") {
    return { invoice: { resident: residentWhere } };
  }
  if (modelKey === "time-tracking") return { staff: { communityId: context.communityId } };
  if (modelKey === "care-plan-items" || modelKey === "care-plan-reviews") {
    return { carePlan: { resident: residentWhere } };
  }
  if (modelKey === "medication-change-logs") {
    return { medication: { resident: residentWhere } };
  }
  if (["bowel-records", "urine-records", "edema-records", "concern-records", "pain-records", "mood-records", "round-sleep-records", "mobility-records", "meal-records", "vital-signs"].includes(modelKey)) {
    return { dailyRound: { resident: residentWhere } };
  }
  if (DIRECT_COMMUNITY.has(modelKey)) return { communityId: context.communityId };
  // All remaining application models receive direct organization/community
  // ownership columns in the SaaS foundation migration.
  return { communityId: context.communityId, organizationId: context.organizationId };
}

export function sanitizeTenantWrite(modelKey: string, body: Record<string, unknown>, context: TenantContext) {
  const data = { ...body };
  delete data.organizationId;
  delete data.communityId;
  if (modelKey === "app-settings") {
    data.organizationId = context.organizationId;
    data.communityId = context.communityId || null;
    // AppSetting rows are keyed data, scoped per tenant. The client passes the
    // bare key as the id; derive a tenant-composite id so two communities/orgs
    // can hold the same key without colliding on the global primary key (the
    // bug where a scoped update missed and the create hit a duplicate id).
    const key = String(data.key ?? data.id ?? "").trim();
    if (key) {
      data.key = key;
      data.id = `${context.organizationId ?? "_"}:${context.communityId ?? "_"}:${key}`;
    }
  } else if (!new Set(["organizations", "communities", "users"]).has(modelKey)) {
    data.organizationId = context.organizationId;
    data.communityId = context.communityId;
  }
  return data;
}

export function canManageOrganization(context: TenantContext): boolean {
  return context.isPlatform || ORG_ADMIN_ROLES.has(context.organizationRole || "");
}

export function isDeniedWhere(where: Record<string, unknown> | null): boolean {
  return Boolean(where && where.id === DENY.id);
}
export function requiresPrivilegedMfa(_context: TenantContext): boolean {
  // MFA enforcement is disabled for all users. No account — privileged or
  // otherwise — is gated behind authenticator MFA. This is the single
  // chokepoint every API route calls, so returning false here clears the
  // MFA_REQUIRED gate everywhere at once.
  return false;
}