// Per-resident belongings paperwork — migration-free, stored as JSON in the
// app-setting `belongings_forms` keyed by residentId. Four forms mirror LifeCare's
// paper forms: a Move-In Checklist and three identical inventory tables
// (Assistive Devices, Personal Belongings, Clothing).

export const BELONGINGS_FORMS_KEY = "belongings_forms";

export interface InventoryRow {
  id: string;
  particulars: string;
  begQty: string;
  add: string;
  less: string;
  actualCount: string;
  remarks: string;
}
export interface InventoryForm {
  period?: string;        // covered month / period
  preparedBy?: string;
  checkedBy?: string;
  rows: InventoryRow[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked?: boolean;
  quantity?: string;
  checkedBy?: string;    // name & date / signature line
}
export interface MoveInChecklist {
  moveInDate?: string;
  items: ChecklistItem[];
}

export interface BelongingsForms {
  moveIn: MoveInChecklist;
  assistiveDevices: InventoryForm;
  belongings: InventoryForm;
  clothing: InventoryForm;
  updatedAt?: string;
  updatedBy?: string;
}
export type BelongingsFormsStore = Record<string, BelongingsForms>;

// Standard Move-In Checklist particulars (from the paper form).
export const MOVE_IN_ITEMS: string[] = [
  "Senior Citizens ID",
  "Passport ID",
  "COVID Vaccination Card",
  "Clothes (for daily use and special occasions)",
  "Underwear",
  "Wheelchair / Cane",
  "Shoes (Casual & Formal)",
  "Slippers / Sandals",
  "Body Soap / Wash",
  "Shampoo",
  "Toothpaste",
  "Tooth brush",
  "Mouth Wash",
  "Shaver / Razor",
  "Hair Comb",
  "Deodorant",
  "Cologne / Perfume",
  "Baby Powder",
  "Personal Belongings (Family pictures, books, etc.)",
];

const rid = () => (globalThis.crypto?.randomUUID?.() ?? `bf-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
export const newInventoryRow = (): InventoryRow => ({ id: rid(), particulars: "", begQty: "", add: "", less: "", actualCount: "", remarks: "" });
export const newChecklistItem = (label = ""): ChecklistItem => ({ id: rid(), label, checked: false, quantity: "", checkedBy: "" });

export const emptyInventory = (): InventoryForm => ({ rows: [newInventoryRow()] });
export const emptyForms = (): BelongingsForms => ({
  moveIn: { items: MOVE_IN_ITEMS.map((l) => newChecklistItem(l)) },
  assistiveDevices: emptyInventory(),
  belongings: emptyInventory(),
  clothing: emptyInventory(),
});

/** Total for an inventory row = beg + add − less (blank when all inputs blank). */
export function rowTotal(r: InventoryRow): string {
  const n = (v?: string) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
  if (!r.begQty && !r.add && !r.less) return "";
  return String(n(r.begQty) + n(r.add) - n(r.less));
}

export function parseBelongingsForms(raw: string | null | undefined): BelongingsFormsStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as BelongingsFormsStore;
  } catch { return {}; }
}

/** The forms for one resident, backfilling any missing form with an empty default. */
export function formsFor(store: BelongingsFormsStore, residentId: string): BelongingsForms {
  const base = emptyForms();
  const f = store[residentId];
  if (!f) return base;
  return {
    moveIn: f.moveIn && Array.isArray(f.moveIn.items) && f.moveIn.items.length ? f.moveIn : base.moveIn,
    assistiveDevices: f.assistiveDevices?.rows ? f.assistiveDevices : base.assistiveDevices,
    belongings: f.belongings?.rows ? f.belongings : base.belongings,
    clothing: f.clothing?.rows ? f.clothing : base.clothing,
    updatedAt: f.updatedAt,
    updatedBy: f.updatedBy,
  };
}
