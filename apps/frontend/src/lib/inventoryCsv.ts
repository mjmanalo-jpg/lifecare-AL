/**
 * Inventory CSV import/export — shared by the Medication Inventory (MED) and Mini
 * Pharmacy (MINI) boards. Columns mirror the Add-item form. Import validates the
 * header format, coerces/validates each row, and rejects duplicates (by name,
 * against existing stock and within the file).
 */

import { buildCsv, parseCsv, downloadCsv } from "./csv";

export type InvVariant = "MINI" | "MED";

export interface CsvInvItem {
  id: string;
  type: "MEDICATION" | "GENERAL";
  name: string;
  generic?: string;
  brand?: string;
  category?: string;
  supplier?: string;
  unit: string;
  quantity: number;
  reorder: number;
  unitPrice?: number;      // MINI only
  location?: string;
  expiry?: string;
  notes?: string;
  residentId?: string;     // MED only
  residentName?: string;   // MED only
  updatedAt: string;
}

interface ColSpec { header: string; get: (it: CsvInvItem) => string | number }

function columns(variant: InvVariant): ColSpec[] {
  const cols: ColSpec[] = [
    { header: "Type", get: (i) => i.type },
    { header: "Name", get: (i) => i.name },
    { header: "Generic", get: (i) => i.generic ?? "" },
    { header: "Brand", get: (i) => i.brand ?? "" },
    { header: "Category", get: (i) => i.category ?? "" },
    { header: "Supplier", get: (i) => i.supplier ?? "" },
    { header: "Unit", get: (i) => i.unit },
    { header: "Quantity", get: (i) => i.quantity },
    { header: "Reorder", get: (i) => i.reorder },
  ];
  if (variant === "MINI") cols.push({ header: "Unit Price", get: (i) => i.unitPrice ?? 0 });
  cols.push({ header: "Location", get: (i) => i.location ?? "" });
  cols.push({ header: "Expiry", get: (i) => i.expiry ?? "" });
  cols.push({ header: "Notes", get: (i) => i.notes ?? "" });
  if (variant === "MED") cols.push({ header: "Resident", get: (i) => i.residentName ?? "" });
  return cols;
}

export function inventoryHeaders(variant: InvVariant): string[] {
  return columns(variant).map((c) => c.header);
}

export function exportInventoryCsv(variant: InvVariant, items: CsvInvItem[], filename: string): void {
  const cols = columns(variant);
  const rows = items.map((it) => cols.map((c) => c.get(it)));
  downloadCsv(filename, buildCsv(cols.map((c) => c.header), rows));
}

export interface ImportRowError { row: number; message: string }
export interface ImportResult {
  formatError?: string;
  added: CsvInvItem[];
  errors: ImportRowError[];
  duplicates: { row: number; name: string }[];
  totalRows: number;
}

export function parseInventoryCsv(opts: {
  variant: InvVariant;
  text: string;
  existing: CsvInvItem[];
  residents?: { id: string; name: string }[];
  newId: () => string;
}): ImportResult {
  const { variant, text, existing, residents = [], newId } = opts;
  const expected = inventoryHeaders(variant);
  const result: ImportResult = { added: [], errors: [], duplicates: [], totalRows: 0 };

  const rows = parseCsv(text);
  if (!rows.length) { result.formatError = "The file is empty."; return result; }

  const headers = rows[0].map((h) => h.trim());
  const norm = (a: string[]) => [...a].map((s) => s.toLowerCase()).sort().join("|");
  if (norm(headers) !== norm(expected)) {
    result.formatError = `The CSV columns don't match the expected format.`;
    return result;
  }
  const colIndex = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const col: Record<string, number> = {};
  expected.forEach((h) => { col[h] = colIndex(h); });

  const dataRows = rows.slice(1);
  result.totalRows = dataRows.length;
  const seen = new Set(existing.map((e) => e.name.trim().toLowerCase()));
  const seenInFile = new Set<string>();
  const resByName = new Map(residents.map((r) => [r.name.trim().toLowerCase(), r.id]));

  dataRows.forEach((r, i) => {
    const rowNum = i + 2; // header is row 1
    const get = (h: string) => (col[h] >= 0 ? (r[col[h]] ?? "").trim() : "");

    const name = get("Name");
    if (!name) { result.errors.push({ row: rowNum, message: "Name is required." }); return; }

    let type: "MEDICATION" | "GENERAL" = "MEDICATION";
    const tRaw = get("Type").toUpperCase();
    if (tRaw === "GENERAL" || tRaw === "GENERAL SUPPLY") type = "GENERAL";
    else if (tRaw && tRaw !== "MEDICATION") { result.errors.push({ row: rowNum, message: `Type must be MEDICATION or GENERAL (got "${get("Type")}").` }); return; }

    const unit = get("Unit") || "pcs";

    const qtyRaw = get("Quantity");
    const quantity = qtyRaw === "" ? 0 : Number(qtyRaw);
    if (!Number.isFinite(quantity) || quantity < 0) { result.errors.push({ row: rowNum, message: `Quantity must be a non-negative number (got "${qtyRaw}").` }); return; }

    const reorderRaw = get("Reorder");
    const reorder = reorderRaw === "" ? 0 : Number(reorderRaw);
    if (!Number.isFinite(reorder) || reorder < 0) { result.errors.push({ row: rowNum, message: `Reorder must be a non-negative number (got "${reorderRaw}").` }); return; }

    let unitPrice: number | undefined;
    if (variant === "MINI") {
      const p = get("Unit Price").replace(/[^0-9.]/g, "");
      unitPrice = Number(p);
      if (!Number.isFinite(unitPrice) || unitPrice <= 0) { result.errors.push({ row: rowNum, message: `Unit Price must be greater than 0 (got "${get("Unit Price")}").` }); return; }
    }

    let expiry: string | undefined;
    const exp = get("Expiry");
    if (exp) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exp) || isNaN(new Date(exp + "T00:00:00").getTime())) { result.errors.push({ row: rowNum, message: `Expiry must be YYYY-MM-DD (got "${exp}").` }); return; }
      expiry = exp;
    }

    let residentId: string | undefined;
    let residentName: string | undefined;
    if (variant === "MED") {
      const rn = get("Resident");
      if (rn) {
        const rid = resByName.get(rn.toLowerCase());
        if (!rid) { result.errors.push({ row: rowNum, message: `Resident "${rn}" not found.` }); return; }
        residentId = rid; residentName = rn;
      }
    }

    const key = name.toLowerCase();
    if (seen.has(key) || seenInFile.has(key)) { result.duplicates.push({ row: rowNum, name }); return; }
    seenInFile.add(key);

    result.added.push({
      id: newId(),
      type, name,
      generic: get("Generic") || undefined,
      brand: get("Brand") || undefined,
      category: get("Category") || undefined,
      supplier: get("Supplier") || undefined,
      unit, quantity, reorder,
      unitPrice: variant === "MINI" ? unitPrice : undefined,
      location: get("Location") || undefined,
      expiry,
      notes: get("Notes") || undefined,
      residentId, residentName,
      updatedAt: new Date().toISOString(),
    });
  });

  return result;
}

/** HTML summary of an import result for a confirmation dialog. User content escaped. */
export function importSummaryHtml(r: ImportResult): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const parts: string[] = [`<div style="text-align:left;font-size:.9rem">`];
  parts.push(`<b>${r.added.length}</b> item(s) ready to import out of ${r.totalRows} row(s).`);
  if (r.duplicates.length) {
    parts.push(`<br/><b style="color:#b45309">${r.duplicates.length} duplicate(s) rejected:</b> ${r.duplicates.slice(0, 8).map((d) => `row ${d.row} (${esc(d.name)})`).join(", ")}${r.duplicates.length > 8 ? "…" : ""}`);
  }
  if (r.errors.length) {
    parts.push(`<br/><b style="color:#dc2626">${r.errors.length} row(s) with errors:</b><ul style="margin:.25rem 0 0 1rem;padding:0">${r.errors.slice(0, 8).map((e) => `<li>Row ${e.row}: ${esc(e.message)}</li>`).join("")}</ul>${r.errors.length > 8 ? "<i>…and more</i>" : ""}`);
  }
  parts.push(`</div>`);
  return parts.join("");
}
