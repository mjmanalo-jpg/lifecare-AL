import { prisma } from "@/lib/prisma";

// Public-facing metadata for subscription plans that the Plan model does not
// carry columns for (price, currency, landing-page visibility, ordering,
// tagline, highlight). Kept migration-free: stored as a single platform-global
// AppSetting JSON row (organizationId/communityId null) keyed by plan id. This
// mirrors how billing/inventory config is persisted elsewhere in the app.

const ROW_ID = "platform::public-plans";
const ROW_KEY = "public-plans";

export interface PlanMeta {
  priceMonthly: number | null;
  currency: string;
  public: boolean;
  order: number;
  tagline: string;
  highlight: boolean;
}

// New plans default to visible so "all created plans reflect on the landing
// page" holds without extra steps; the admin can hide or price them after.
export const DEFAULT_PLAN_META: PlanMeta = { priceMonthly: null, currency: "PHP", public: true, order: 100, tagline: "", highlight: false };

export function sanitizePlanMeta(input: Partial<PlanMeta> | undefined | null): PlanMeta {
  const meta = input || {};
  const price = typeof meta.priceMonthly === "number" ? meta.priceMonthly : Number(meta.priceMonthly);
  return {
    priceMonthly: Number.isFinite(price) && price >= 0 ? Math.round(price) : null,
    currency: typeof meta.currency === "string" && meta.currency.trim() ? meta.currency.trim().slice(0, 8).toUpperCase() : "PHP",
    public: meta.public !== false,
    order: Number.isFinite(Number(meta.order)) ? Number(meta.order) : 100,
    tagline: typeof meta.tagline === "string" ? meta.tagline.slice(0, 160) : "",
    highlight: meta.highlight === true,
  };
}

export async function readPlanMeta(): Promise<Record<string, PlanMeta>> {
  const row = await prisma.appSetting.findUnique({ where: { id: ROW_ID }, select: { value: true } }).catch(() => null);
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, Partial<PlanMeta>>;
    const out: Record<string, PlanMeta> = {};
    for (const [id, meta] of Object.entries(parsed)) out[id] = sanitizePlanMeta(meta);
    return out;
  } catch {
    return {};
  }
}

async function persist(all: Record<string, PlanMeta>): Promise<void> {
  const value = JSON.stringify(all);
  await prisma.appSetting.upsert({
    where: { id: ROW_ID },
    update: { value },
    create: { id: ROW_ID, key: ROW_KEY, value, organizationId: null, communityId: null },
  });
}

export async function writePlanMeta(planId: string, meta: Partial<PlanMeta>): Promise<void> {
  const all = await readPlanMeta();
  all[planId] = sanitizePlanMeta(meta);
  await persist(all);
}

export async function deletePlanMeta(planId: string): Promise<void> {
  const all = await readPlanMeta();
  if (all[planId]) {
    delete all[planId];
    await persist(all);
  }
}
