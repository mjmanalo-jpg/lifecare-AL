"use client";

import KitchenCookList from "@/components/portal/views/services/KitchenCookList";

/**
 * Kitchen staff portal — a focused, read-only view. Kitchen staff only ever
 * need the day's cook list (active per-resident diet orders grouped by meal),
 * so every tab resolves to it. The nutritionist sets the orders; the kitchen
 * reads them here.
 */
export default function KitchenPortalContent(_props: { tab?: string }) {
  return <KitchenCookList />;
}
