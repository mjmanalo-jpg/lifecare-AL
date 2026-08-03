// Option B storage: per-resident meals (breakfast/lunch/dinner) packed into a
// DietOrder's `notes` field — no schema change. Prep notes are preserved after
// the tag. Shared by the Diet Orders board (edit/display) and the Kitchen list.
export type Meals = { breakfast?: string; lunch?: string; dinner?: string };

const MEALS_RE = /^MEALS::(\{[\s\S]*?\})::/;

export function packMeals(freeNotes: string, meals: Meals): string {
  const clean: Meals = {};
  if (meals.breakfast?.trim()) clean.breakfast = meals.breakfast.trim();
  if (meals.lunch?.trim()) clean.lunch = meals.lunch.trim();
  if (meals.dinner?.trim()) clean.dinner = meals.dinner.trim();
  const prefix = Object.keys(clean).length ? `MEALS::${JSON.stringify(clean)}::` : "";
  return `${prefix}${(freeNotes ?? "").trim()}`;
}

export function parseMeals(notes: string | null | undefined): { meals: Meals; notes: string } {
  const raw = notes ?? "";
  const m = MEALS_RE.exec(raw);
  if (!m) return { meals: {}, notes: raw };
  try {
    return { meals: JSON.parse(m[1]) as Meals, notes: raw.slice(m[0].length) };
  } catch {
    return { meals: {}, notes: raw };
  }
}

export const hasMeals = (m: Meals) => Boolean(m.breakfast || m.lunch || m.dinner);
