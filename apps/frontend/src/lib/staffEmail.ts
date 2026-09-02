// Staff created phone-only get a synthetic login handle
// (`staff.<mobile>@<orgId>.slms.local`, minted in api/organization-admin/staff-accounts).
// It's an internal login key, never a real address — the UI must never surface it.

/** True for the internal synthetic placeholder address (not a real email). */
export const isSyntheticEmail = (email?: string | null): boolean =>
  !!email && email.endsWith(".slms.local");

/** Read-only display: the real email, or "No email" when synthetic/blank. */
export const staffEmailDisplay = (email?: string | null): string =>
  email && !isSyntheticEmail(email) ? email : "No email";

/** Pre-fill for an editable email input: the real email, or "" when synthetic/blank.
 * Leaving it blank on submit keeps the existing synthetic key — the contact API
 * (/api/staff/[id]/contact) only overwrites the stored email when a real one is given. */
export const staffEmailInput = (email?: string | null): string =>
  email && !isSyntheticEmail(email) ? email : "";
