// Emergency & family contacts — a resident can have several (spouse, child,
// guardian…). The Resident model only carries ONE pair of columns
// (`emergencyContact` / `emergencyContactPhone`), so the full list lives in the
// migration-free `resident_contacts` app-setting keyed by residentId, and the
// FIRST contact is mirrored back onto those columns as the primary — that keeps
// the Resident Card, family portal and every existing reader working unchanged.

export const RESIDENT_CONTACTS_KEY = "resident_contacts";

export interface ResidentContact {
  id: string;
  name: string;
  phone: string;
  relationship?: string;
}
export type ResidentContactStore = Record<string, ResidentContact[]>;

export const newContact = (name = "", phone = "", relationship = ""): ResidentContact => ({
  id: globalThis.crypto?.randomUUID?.() ?? `rc-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  name, phone, relationship,
});

export function parseResidentContacts(raw: string | null | undefined): ResidentContactStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    return v as ResidentContactStore;
  } catch { return {}; }
}

/**
 * One resident's contacts. Falls back to the profile's single emergency contact
 * (and always yields at least one editable row) so residents saved before the
 * list existed still show what's on file.
 */
export function contactsFor(store: ResidentContactStore, residentId: string, fallbackName = "", fallbackPhone = ""): ResidentContact[] {
  const saved = store[residentId];
  if (Array.isArray(saved) && saved.length) return saved.map((c) => ({ ...newContact(), ...c }));
  return [newContact(fallbackName, fallbackPhone)];
}

/** Drops blank rows — what actually gets persisted. */
export const cleanContacts = (list: ResidentContact[]): ResidentContact[] =>
  list
    .map((c) => ({ ...c, name: c.name.trim(), phone: c.phone.trim(), relationship: (c.relationship || "").trim() }))
    .filter((c) => c.name || c.phone);
