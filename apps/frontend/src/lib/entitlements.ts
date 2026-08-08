import { prisma } from "./prisma";
import type { TenantContext } from "./tenant";
import { withTenantDb } from "./tenantDb";
import { MUTATION_STATUSES } from "./subscriptionStatus";

const MUTATION_FEATURES: Record<string, string> = {
  "camera-monitoring-logs": "camera_monitoring",
  "ai-assistant": "ai_assistant",
  "generated-reports": "advanced_reports",
  vehicles: "fleet_management",
  drivers: "fleet_management",
  "transport-requests": "fleet_management",
};

export class EntitlementError extends Error {
  constructor(message: string, public readonly code: "SUBSCRIPTION_INACTIVE" | "FEATURE_DISABLED" | "LIMIT_REACHED") {
    super(message);
  }
}

export async function getEntitlements(organizationId: string) {
  const subscription = await prisma.subscription.findUnique({
    where: { organizationId },
    include: { plan: { include: { entitlements: true } } },
  });
  if (!subscription) return null;
  const overrides = (subscription.overrides || {}) as Record<string, unknown>;
  return {
    id: subscription.id,
    status: subscription.status,
    plan: {
      key: subscription.plan.key,
      name: subscription.plan.name,
      maxCommunities: Number(overrides.maxCommunities ?? subscription.plan.maxCommunities ?? 0) || null,
      maxActiveResidents: Number(overrides.maxActiveResidents ?? subscription.plan.maxActiveResidents ?? 0) || null,
      maxStaffSeats: Number(overrides.maxStaffSeats ?? subscription.plan.maxStaffSeats ?? 0) || null,
      maxStorageBytes: String(overrides.maxStorageBytes ?? subscription.plan.maxStorageBytes ?? ""),
    },
    features: Object.fromEntries(subscription.plan.entitlements.map((item) => [item.featureKey, { enabled: item.enabled, limit: item.limit, config: item.config }])),
  };
}

export async function getUsage(context: TenantContext) {
  if (!context.organizationId) throw new EntitlementError("An organization workspace is required", "SUBSCRIPTION_INACTIVE");
  const organizationId = context.organizationId;
  const [communities, residents, staff] = await withTenantDb(context, (tx) => Promise.all([
    tx.community.count({ where: { organizationId, isActive: true } }),
    tx.resident.count({ where: { organizationId, isDeceased: false } }),
    tx.staff.count({ where: { organizationId, isActive: true } }),
  ]));
  return { activeCommunities: communities, activeResidents: residents, activeStaff: staff, storageBytes: 0 };
}

export async function assertMutationEntitled(context: TenantContext, modelKey: string): Promise<void> {
  if (!context.organizationId) throw new EntitlementError("An organization workspace is required", "SUBSCRIPTION_INACTIVE");
  const [entitlements, usage] = await Promise.all([getEntitlements(context.organizationId), getUsage(context)]);
  if (!entitlements || !MUTATION_STATUSES.has(entitlements.status)) {
    throw new EntitlementError("The organization subscription is not active", "SUBSCRIPTION_INACTIVE");
  }
  const featureKey = MUTATION_FEATURES[modelKey];
  if (featureKey && entitlements.features[featureKey]?.enabled === false) {
    throw new EntitlementError(`The ${featureKey} feature is not enabled for this plan`, "FEATURE_DISABLED");
  }
  if (modelKey === "communities" && entitlements.plan.maxCommunities !== null && usage.activeCommunities >= entitlements.plan.maxCommunities) {
    throw new EntitlementError("The active community limit has been reached", "LIMIT_REACHED");
  }
  if (modelKey === "residents" && entitlements.plan.maxActiveResidents !== null && usage.activeResidents >= entitlements.plan.maxActiveResidents) {
    throw new EntitlementError("The active resident limit has been reached", "LIMIT_REACHED");
  }
  if (modelKey === "staff" && entitlements.plan.maxStaffSeats !== null && usage.activeStaff >= entitlements.plan.maxStaffSeats) {
    throw new EntitlementError("The active staff limit has been reached", "LIMIT_REACHED");
  }
}