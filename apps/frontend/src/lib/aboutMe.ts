/**
 * "About Me" resident profile — the human, non-clinical story of a resident:
 * what they like to be called, their customs, the people around them (with a
 * who-to-call order), a blocklist, and their personal belongings.
 *
 * Migration-free: a JSON object in the app-setting `about_me_profiles`, keyed by
 * residentId (same shape as clinical_records / staff_profiles). The rcard reads
 * and edits it; the resident directory reads it for a quick preferred-name +
 * blocklist glance.
 */

export const ABOUT_ME_KEY = "about_me_profiles";

/** A person in the resident's circle. `priority` is the who-to-call order
 * (1 = call first). Role flags are independent — one person can be both the
 * 1st decision maker and an emergency contact. `blocked` = do NOT contact /
 * do not admit as a visitor. */
export interface AboutPerson {
  id: string;
  name: string;
  relationship?: string;
  phone?: string;
  priority?: number;
  decisionMaker?: boolean; // legacy — superseded by medicalPOA / financialPOA
  medicalPOA?: boolean;    // health-care decision maker
  financialPOA?: boolean;  // financial POA / legal guardian
  emergency?: boolean;
  family?: boolean;
  blocked?: boolean;
  notes?: string;
}

/** A date that matters to the resident — birthday, anniversary, memorial. */
export interface AboutKeyDate {
  id: string;
  label: string;
  date?: string; // YYYY-MM-DD (or MM-DD for recurring)
}

/** A personal belonging brought in / kept for the resident. */
export interface AboutBelonging {
  id: string;
  item: string;
  description?: string;
  broughtDate?: string; // YYYY-MM-DD
  location?: string;    // where it's kept, e.g. "bedside drawer"
  note?: string;
}

export interface AboutMeProfile {
  preferredName?: string;
  nicknames?: string[];
  religion?: string;
  culturalPreferences?: string;
  interactionNotes?: string;
  otherNotes?: string;

  // Life story & background
  birthplace?: string;
  occupation?: string;
  maritalStatus?: string;
  familyBackground?: string;
  militaryService?: string;
  languages?: string;

  // Interests & daily routine
  interests?: string;
  pets?: string;
  dailyRoutine?: string;
  foodPreferences?: string;

  // Comfort & communication
  comforts?: string;
  upsets?: string;
  communicationAids?: string;
  spiritualPractices?: string;

  // Wishes & key dates
  whatMatters?: string;
  keyDates?: AboutKeyDate[];

  people: AboutPerson[];
  belongings: AboutBelonging[];
  updatedAt?: string;
  updatedBy?: string;
}

/** The whole app-setting value: { [residentId]: AboutMeProfile }. */
export type AboutMeStore = Record<string, AboutMeProfile>;

export const emptyProfile = (): AboutMeProfile => ({
  people: [],
  belongings: [],
});

const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const newPerson = (): AboutPerson => ({ id: rid(), name: "" });
export const newBelonging = (): AboutBelonging => ({ id: rid(), item: "" });
export const newKeyDate = (): AboutKeyDate => ({ id: rid(), label: "" });

/** Parse the app-setting value into a resident-keyed map, tolerating junk. */
export function parseAboutMeStore(raw: string | null | undefined): AboutMeStore {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: AboutMeStore = {};
    for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
      const prof = (p ?? {}) as Partial<AboutMeProfile>;
      out[k] = {
        ...emptyProfile(),
        ...prof,
        nicknames: Array.isArray(prof.nicknames) ? prof.nicknames : [],
        keyDates: Array.isArray(prof.keyDates) ? prof.keyDates : [],
        people: Array.isArray(prof.people) ? prof.people : [],
        belongings: Array.isArray(prof.belongings) ? prof.belongings : [],
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** The profile for one resident (never null — empty if unset). */
export function profileFor(store: AboutMeStore, residentId: string): AboutMeProfile {
  return store[residentId] ?? emptyProfile();
}

/** People in who-to-call order: active first (by priority, unset last, then by
 * name), blocked people always sorted to the very end. */
export function sortedPeople(people: AboutPerson[]): AboutPerson[] {
  const rank = (p: AboutPerson) => (typeof p.priority === "number" && p.priority > 0 ? p.priority : Number.MAX_SAFE_INTEGER);
  return [...people].sort((a, b) => {
    if (!!a.blocked !== !!b.blocked) return a.blocked ? 1 : -1;
    const d = rank(a) - rank(b);
    return d !== 0 ? d : (a.name || "").localeCompare(b.name || "");
  });
}

/** True when any person on the profile is blocklisted. */
export function hasBlocklist(profile: AboutMeProfile | undefined): boolean {
  return !!profile?.people?.some((p) => p.blocked);
}
