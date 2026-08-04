/**
 * Inventory operations helpers — FEFO allocation, plus migration-free vendor
 * directory and asset-maintenance schedules persisted as JSON in `app-settings`.
 */

export const INVENTORY_VENDORS_KEY = "inventory_vendors";
export const INVENTORY_ASSETS_KEY = "inventory_asset_maintenance";

export interface Vendor {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  category?: string;
}

export interface AssetSchedule {
  intervalDays: number;
  lastService?: string; // ISO
  nextService?: string; // ISO
  notes?: string;
}
export type AssetScheduleMap = Record<string, AssetSchedule>;

export interface Batch {
  id: string;
  quantity: number;
  expiryDate?: string | null;
}

/** Sort earliest-expiry first; items without an expiry date go last. */
export function byExpiry(a: Batch, b: Batch): number {
  const ax = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
  const bx = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
  return ax - bx;
}

/**
 * First-Expire-First-Out allocation: deduct `qty` across batches, consuming the
 * nearest-to-expiry batch first. Returns the per-batch plan, or an empty array
 * if there isn't enough stock.
 */
export function fefoAllocate(batches: Batch[], qty: number): { id: string; take: number }[] {
  if (qty <= 0) return [];
  const sorted = [...batches].sort(byExpiry);
  const plan: { id: string; take: number }[] = [];
  let remaining = qty;
  for (const b of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(Math.max(0, b.quantity), remaining);
    if (take > 0) { plan.push({ id: b.id, take }); remaining -= take; }
  }
  return remaining > 0 ? [] : plan;
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - Date.now()) / 86_400_000);
}

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 86_400_000);
}

export function parseVendors(raw: string | null | undefined): Vendor[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((x) => x && typeof x.name === "string") : []; } catch { return []; }
}

export function parseAssetSchedules(raw: string | null | undefined): AssetScheduleMap {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? (v as AssetScheduleMap) : {}; } catch { return {}; }
}

export function newId(prefix = "id"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}

/** UPC-A check digit for an 11-digit string. */
function upcCheckDigit(d11: string): string {
  let odd = 0, even = 0;
  for (let i = 0; i < 11; i++) {
    const n = d11.charCodeAt(i) - 48;
    if (i % 2 === 0) odd += n; else even += n; // 1-indexed odd positions
  }
  return String((10 - ((odd * 3 + even) % 10)) % 10);
}

/**
 * Auto-generated batch code: a valid 12-digit UPC-A number (11 random digits +
 * check digit). It's both the item's batch/lot number AND a real, scannable
 * barcode value that the <Barcode> component renders as UPC-A bars.
 */
export function generateBarcode(): string {
  let d = "";
  for (let i = 0; i < 11; i++) d += Math.floor(Math.random() * 10);
  return d + upcCheckDigit(d);
}
