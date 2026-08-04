/**
 * Consent / move-in forms library — migration-free. Staff (Care Manager)
 * configure the list and attach a viewable PDF per form; the config is stored as
 * JSON in an `app-setting` keyed `consent_forms` (community-scoped, non-secret so
 * families can read it). Families view the PDF and e-sign each form.
 */

export const CONSENT_FORMS_KEY = "consent_forms";

export interface ConsentForm {
  id: string;
  name: string;
  description?: string;
  fileUrl?: string;   // uploaded PDF/doc, viewable
  fileName?: string;
}

/** Seed set used when nothing is configured yet. */
export const DEFAULT_FORMS: ConsentForm[] = [
  { id: "consent-care",     name: "Consent to Care & Treatment" },
  { id: "financial",        name: "Financial Responsibility Agreement" },
  { id: "movein-checklist", name: "Move-in Checklist Acknowledgment" },
  { id: "media-release",    name: "Photo / Media Release" },
  { id: "rights",           name: "Resident Rights Acknowledgment" },
];

export function parseConsentForms(raw: string | null | undefined): ConsentForm[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((f) => f && typeof f.name === "string") : [];
  } catch {
    return [];
  }
}

export function newId(prefix = "form"): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(performance.now())}`;
}
