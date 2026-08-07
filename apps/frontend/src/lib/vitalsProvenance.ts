// ─────────────────────────────────────────────────────────────
// Module 02 — Vital-sign provenance & measurement context.
//
// Records HOW a reading was captured so a number is never ambiguous:
//   • source     — MANUAL entry, a connected DEVICE, or CAMERA_RPPG estimate
//   • deviceId   — which device produced it (name/id)
//   • method     — measurement context (e.g. "Room air", "Tympanic", "Sitting")
//   • confidence — 0..1 (device = 1, rPPG = processor confidence)
//
// Migration-free by design (per the project's "no mid-session Prisma migration"
// constraint): the provenance is encoded into the existing VitalsLog.notes
// column as a leading `⟦vp:{…}⟧` token, leaving any human note after it. Decoding
// splits the two back apart so the UI can show badges + the plain note.
// ─────────────────────────────────────────────────────────────

export type VitalSource = "MANUAL" | "DEVICE" | "CAMERA_RPPG";

export interface VitalProvenance {
  source: VitalSource;
  deviceId?: string;
  method?: string;
  confidence?: number;
}

export const SOURCE_LABEL: Record<VitalSource, string> = {
  MANUAL: "Manual",
  DEVICE: "Device",
  CAMERA_RPPG: "Camera (rPPG)",
};

const OPEN = "⟦vp:"; // ⟦vp:
const CLOSE = "⟧"; //   ⟧
const TOKEN_RE = /^⟦vp:(\{.*?\})⟧\s?/;

/** Encode provenance (+ optional human note) into a single notes string. */
export function encodeVitalNotes(prov: VitalProvenance, note = ""): string {
  // Drop empty/default fields to keep the token compact.
  const compact: VitalProvenance = { source: prov.source };
  if (prov.deviceId) compact.deviceId = prov.deviceId;
  if (prov.method) compact.method = prov.method;
  if (typeof prov.confidence === "number") compact.confidence = Math.round(prov.confidence * 100) / 100;
  const token = `${OPEN}${JSON.stringify(compact)}${CLOSE}`;
  return note.trim() ? `${token} ${note.trim()}` : token;
}

/** Split a notes string into its provenance token and the remaining human note. */
export function decodeVitalNotes(raw: string | null | undefined): { prov: VitalProvenance | null; note: string } {
  const s = String(raw ?? "");
  const m = s.match(TOKEN_RE);
  if (!m) return { prov: null, note: s };
  try {
    const parsed = JSON.parse(m[1]) as VitalProvenance;
    if (parsed && typeof parsed.source === "string") {
      return { prov: parsed, note: s.slice(m[0].length) };
    }
  } catch {
    /* malformed token — treat the whole thing as a note */
  }
  return { prov: null, note: s };
}

/** Short human label for a provenance, e.g. "Device · Room air · 98%". */
export function provenanceLabel(prov: VitalProvenance | null): string {
  if (!prov) return "";
  const parts: string[] = [SOURCE_LABEL[prov.source] ?? prov.source];
  if (prov.deviceId) parts.push(prov.deviceId);
  if (prov.method) parts.push(prov.method);
  if (typeof prov.confidence === "number" && prov.source !== "MANUAL") parts.push(`${Math.round(prov.confidence * 100)}%`);
  return parts.join(" · ");
}
