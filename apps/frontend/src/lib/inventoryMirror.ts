/**
 * Client helper — mirror a GENERAL-supply item from a clinical inventory board
 * (Med Inventory / Mini Pharmacy) into the shared Facility Inventory. Best-effort
 * and non-blocking: returns the facility InventoryItem id to store back on the
 * clinical item (so future edits update the same mirror), or null on failure.
 */

export interface MirrorInput {
  facilityItemId?: string;
  remove?: boolean;
  name?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  reorder?: number;
  location?: string;
  supplier?: string;
  expiry?: string;
  notes?: string;
  unitCost?: number;
  source: string; // "Mini Pharmacy" | "Medication Inventory"
}

export async function mirrorFacilityInventory(input: MirrorInput): Promise<string | null> {
  try {
    const res = await fetch("/api/inventory/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => ({}));
    return json?.facilityItemId ?? null;
  } catch {
    return null;
  }
}
