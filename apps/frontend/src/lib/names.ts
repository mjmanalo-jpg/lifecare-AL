// Shared name helpers — structured First / Middle (optional) / Last, with a composed
// display name kept for the many readers that still consume a single combined string.

/** Join name parts into a single display name, trimming and dropping blanks. */
export const composeName = (first?: string | null, middle?: string | null, last?: string | null): string =>
  [first, middle, last].map((x) => (x || "").trim()).filter(Boolean).join(" ");

/**
 * Split a combined name into parts for editing legacy records: first word → first,
 * everything after → last, middle left blank (matches the app's existing behaviour).
 */
export function splitName(full?: string | null): { firstName: string; middleName: string; lastName: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() || "";
  return { firstName, middleName: "", lastName: parts.join(" ") };
}

/** Prefer the structured parts when present; otherwise split the combined name. */
export function nameParts(rec: { firstName?: string | null; middleName?: string | null; lastName?: string | null; name?: string | null; residentName?: string | null }): { firstName: string; middleName: string; lastName: string } {
  const first = (rec.firstName || "").trim();
  const middle = (rec.middleName || "").trim();
  const last = (rec.lastName || "").trim();
  if (first || last || middle) return { firstName: first, middleName: middle, lastName: last };
  return splitName(rec.name || rec.residentName || "");
}
