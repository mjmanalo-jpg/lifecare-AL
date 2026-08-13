/**
 * Resident-medication inventory consumption — the MAR → inventory bridge.
 *
 * When a dose is administered (MAR "Given"), the matching resident medication in
 * the app-setting `inventory_items` is decremented. If that crosses the reorder
 * point (low) or hits zero (out), a purchase request is auto-created in
 * `inventory_purchase_requests` (unless one is already pending). Pure planner —
 * the caller persists the returned arrays via upsertRecord.
 *
 * Shapes mirror MedicationInventoryBoard exactly so both read/write the same JSON.
 */

export const INV_ITEMS_KEY = "inventory_items";
export const INV_PR_KEY = "inventory_purchase_requests";

export interface InvItem {
  id: string; type: "MEDICATION" | "GENERAL"; name: string; generic?: string; brand?: string;
  category?: string; supplier?: string; unit: string; quantity: number; reorder: number;
  location?: string; expiry?: string; notes?: string; residentId?: string; residentName?: string; updatedAt: string;
}
export interface InvPR {
  id: string; itemId: string; itemName: string; unit: string; quantity: number; urgency: string;
  notes?: string; status: "PENDING" | "APPROVED" | "ORDERED" | "REJECTED"; by?: string; byAt: string; approvedBy?: string;
}
export type StockLevel = "ok" | "low" | "out";

const newId = () => globalThis.crypto?.randomUUID?.() ?? `pr-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const parse = <T,>(raw: unknown): T[] => { try { const v = JSON.parse(String(raw ?? "") || "[]"); return Array.isArray(v) ? (v as T[]).filter((x) => x && typeof (x as { id?: unknown }).id === "string") : []; } catch { return []; } };
export const parseInvItems = (raw: unknown) => parse<InvItem>(raw);
export const parseInvPRs = (raw: unknown) => parse<InvPR>(raw);
export const invStockLevel = (it: InvItem): StockLevel => (it.quantity <= 0 ? "out" : it.quantity <= it.reorder ? "low" : "ok");

const norm = (v: unknown) => String(v ?? "").toLowerCase().trim();
/** Find the resident's medication in inventory by name (also generic / brand). */
export function findResidentMed(items: InvItem[], residentId: string, medName: string): InvItem | undefined {
  const n = norm(medName);
  if (!n || !residentId) return undefined;
  return items.find((it) =>
    it.type === "MEDICATION" && it.residentId === residentId &&
    [it.name, it.generic, it.brand].map(norm).filter((c) => c.length >= 3).some((c) => n === c || n.includes(c) || c.includes(n))
  );
}

/**
 * Plan the inventory effect of administering `qty` doses of `medName` to a resident:
 * decrement the matched item and, if it goes low/out with no pending request, queue
 * an auto purchase request. Returns new arrays + a summary. `matched:false` → no
 * inventory item for this med (nothing to do).
 */
export function planMedConsumption(opts: {
  items: InvItem[]; prs: InvPR[]; residentId: string; medName: string; qty?: number; by?: string;
}): { matched: boolean; items: InvItem[]; prs: InvPR[]; item?: InvItem; level?: StockLevel; remaining?: number; createdPR?: boolean } {
  const qty = opts.qty && opts.qty > 0 ? opts.qty : 1;
  const item = findResidentMed(opts.items, opts.residentId, opts.medName);
  if (!item) return { matched: false, items: opts.items, prs: opts.prs };

  const remaining = Math.max(0, item.quantity - qty);
  const updated: InvItem = { ...item, quantity: remaining, updatedAt: new Date().toISOString() };
  const items = opts.items.map((x) => (x.id === item.id ? updated : x));
  const level = invStockLevel(updated);

  let prs = opts.prs;
  let createdPR = false;
  if (level !== "ok" && !opts.prs.some((p) => p.itemId === item.id && p.status === "PENDING")) {
    const orderQty = Math.max(1, item.reorder * 2 - remaining); // top up to ~2× the reorder point
    prs = [{
      id: newId(), itemId: item.id, itemName: item.name, unit: item.unit, quantity: orderQty,
      urgency: level === "out" ? "Urgent" : "Routine",
      notes: `Auto-generated — ${item.name} ${level === "out" ? "out of stock" : "low"} after MAR administration.`,
      status: "PENDING", by: opts.by || "MAR auto-reorder", byAt: new Date().toISOString(),
    }, ...opts.prs];
    createdPR = true;
  }
  return { matched: true, items, prs, item: updated, level, remaining, createdPR };
}
