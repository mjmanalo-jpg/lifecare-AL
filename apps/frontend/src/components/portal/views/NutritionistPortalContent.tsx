"use client";

import DietOrdersBoard from "@/components/portal/views/services/DietOrdersBoard";
import KitchenCookList from "@/components/portal/views/services/KitchenCookList";
import FacilityDining from "@/components/portal/views/FacilityDining";

/**
 * Nutritionist portal — the dedicated home for diet & nutrition management.
 * Reuses the existing boards (previously only reachable via Facility Admin):
 *   - Diet & Nutrition Orders (default): per-resident diet orders
 *   - Kitchen — Cook List: read the day's active orders the kitchen cooks
 *   - Dining & Compliance: manage the daily menu + food-safety logs
 */
export default function NutritionistPortalContent({ tab }: { tab?: string }) {
  if (tab === "kitchen") return <KitchenCookList />;
  if (tab === "dining") return <FacilityDining />;
  return <DietOrdersBoard />;
}
