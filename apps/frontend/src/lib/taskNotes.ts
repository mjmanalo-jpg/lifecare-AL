/**
 * Task notes — caregiver-authored notes on a task explaining status or blockers
 * ("can't give the medication, resident hasn't eaten"; "can't bathe, slight
 * fever"). Stored (migration-free) as a JSON array string in the Task's
 * otherwise-unused `documentationRequired` column, so the notes live ON the task
 * record and therefore reflect automatically to every task viewer — the nurse,
 * other caregivers, and the resident's QR profile (all read the same Task).
 *
 * Centralised here so the storage field can later be swapped for a dedicated
 * column by changing one module.
 */

/** The Task field repurposed to hold the notes JSON. */
export const TASK_NOTES_FIELD = "documentationRequired" as const;

export interface TaskNote {
  id: string;
  text: string;
  author: string;
  at: string; // ISO
}

export function parseTaskNotes(raw: unknown): TaskNote[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((n): n is TaskNote => Boolean(n) && typeof n.text === "string")
      .map((n) => ({ id: String(n.id ?? ""), text: String(n.text), author: String(n.author ?? "Staff"), at: String(n.at ?? "") }));
  } catch {
    return [];
  }
}

/** Read the notes off a raw task row (any shape that carries the field). */
export function taskNotesOf(row: Record<string, unknown> | null | undefined): TaskNote[] {
  return parseTaskNotes(row?.[TASK_NOTES_FIELD]);
}

/** Append a note and return the serialized JSON to persist into the field. */
export function withAppendedNote(raw: unknown, text: string, author: string): string {
  const notes = parseTaskNotes(raw);
  notes.push({
    id: globalThis.crypto?.randomUUID?.() ?? `n-${Date.now()}-${notes.length}`,
    text: text.trim(),
    author: author || "Staff",
    at: new Date().toISOString(),
  });
  return JSON.stringify(notes);
}

/** Serialized JSON for a notes array with one removed (by id). */
export function withoutNote(raw: unknown, id: string): string {
  return JSON.stringify(parseTaskNotes(raw).filter((n) => n.id !== id));
}
