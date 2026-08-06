import { prisma, withDbRetry } from "./prisma";
import { getSession, type SessionData } from "./auth";

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
  "admissions", "service-charges", "insurance-validations", "transport-requests",
  "trips", "dietitian-consults", "service-requests", "concierge-bookings",
  "front-desk-visits", "resident-preferences", "event-attendances",
  "dining-reservations", "escalations", "camera-monitoring-logs", "vaccinations",
  "resident-documents", "eliminations", "pain-assessments", "wound-cares",
  "sleep-logs", "mobility-logs", "care-plans", "hospital-referrals", "follow-ups",
  "care-timeline", "medication-administrations", "daily-rounds",
]);

const ORG_ADMIN_ROLES = new Set(["OWNER", "ADMIN"]);
const ACTIVE_SUBSCRIPTIONS = new Set(["TRIALING", "ACTIVE"]);
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

export async function requireTenantContext(options: { allowPlatform?: boolean; requireCommunity?: boolean } = {}): Promise<TenantContext | null> {
  const session = await getSession();
  if (!session?.userId) return null;

  // Reuse a recently-resolved context for the same session state. The key
  // folds in the fields that change access (active workspace, role, MFA level)
  // plus the option flags, so any change re-resolves against the DB.
  const cacheKey = `${session.userId}|${session.activeOrganizationId || ""}|${session.activeCommunityId || ""}|${session.role}|${session.authAssuranceLevel || ""}|${options.allowPlatform ? 1 : 0}|${options.requireCommunity ? 1 : 0}`;
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
  if (subscriptionStatus && !ACTIVE_SUBSCRIPTIONS.has(subscriptionStatus)) return null;

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
  contextCache.set(cacheKey, context);
  return context;
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
  if (modelKey === "residents") return selfService ? residentAccessWhere(context) : { communityId: context.communityId };
  if (modelKey === "tasks") {
    // Tasks carry a required residentId. Staff see the whole community's tasks;
    // a resident/family may only see (and complete) their own.
    return selfService ? { resident: residentAccessWhere(context) } : { communityId: context.communityId };
  }
  if (RESIDENT_SCOPED.has(modelKey)) {
    return { resident: selfService ? residentAccessWhere(context) : { communityId: context.communityId } };
  }
  if (modelKey === "payments") {
    return { invoice: { resident: selfService ? residentAccessWhere(context) : { communityId: context.communityId } } };
  }
  if (modelKey === "time-tracking") return { staff: { communityId: context.communityId } };
  if (modelKey === "care-plan-items" || modelKey === "care-plan-reviews") {
    return { carePlan: { resident: selfService ? residentAccessWhere(context) : { communityId: context.communityId } } };
  }
  if (modelKey === "medication-change-logs") {
    return { medication: { resident: selfService ? residentAccessWhere(context) : { communityId: context.communityId } } };
  }
  if (["bowel-records", "urine-records", "edema-records", "concern-records", "pain-records", "mood-records", "round-sleep-records", "mobility-records", "meal-records", "vital-signs"].includes(modelKey)) {
    return { dailyRound: { resident: selfService ? residentAccessWhere(context) : { communityId: context.communityId } } };
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
    if (!data.key && data.id) data.key = data.id;
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
export function requiresPrivilegedMfa(context: TenantContext): boolean {
  const privileged = Boolean(context.platformRole) || ORG_ADMIN_ROLES.has(context.organizationRole || "");
  if (!privileged) return false;
  if (process.env.NODE_ENV !== "production" && !context.session.authUserId) return false;
  return context.session.authAssuranceLevel !== "aal2";
}