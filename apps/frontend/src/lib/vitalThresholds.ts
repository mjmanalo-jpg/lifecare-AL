// ─────────────────────────────────────────────────────────────
// Module 02 — Vital Signs: single source of truth for normal ranges +
// abnormality/severity. Imported by the alert engine (cron) AND the vitals
// UIs so thresholds never drift between them.
//
// Normal ranges (per the Feature Overview):
//   Blood Pressure  90–140 / 60–90 mmHg
//   Heart Rate      60–100 bpm
//   SpO₂ (Oxygen)   ≥ 95 %      (alert < 90)
//   Temperature     36.1–37.2 °C
//   Resp. Rate      12–20 /min
//   Blood Glucose   70–180 mg/dL
//   Weight          tracked (no per-reading alert)
// ─────────────────────────────────────────────────────────────

export type VitalType =
  | "BLOOD_PRESSURE" | "HEART_RATE" | "TEMPERATURE" | "OXYGEN"
  | "RESPIRATORY_RATE" | "BLOOD_GLUCOSE" | "WEIGHT";

export interface VitalMeta { label: string; unit: string; normal: string }

export const VITAL_META: Record<string, VitalMeta> = {
  BLOOD_PRESSURE:   { label: "Blood Pressure", unit: "mmHg", normal: "90–140 / 60–90" },
  HEART_RATE:       { label: "Heart Rate", unit: "bpm", normal: "60–100" },
  OXYGEN:           { label: "SpO₂", unit: "%", normal: "≥ 95" },
  TEMPERATURE:      { label: "Temperature", unit: "°C", normal: "36.1–37.2" },
  RESPIRATORY_RATE: { label: "Respiratory Rate", unit: "/min", normal: "12–20" },
  BLOOD_GLUCOSE:    { label: "Blood Glucose", unit: "mg/dL", normal: "70–180" },
  WEIGHT:           { label: "Weight", unit: "kg", normal: "tracked" },
};

/** Parse a "120/80" blood-pressure string into [systolic, diastolic]. */
export function parseBP(value: string): [number, number] {
  const parts = String(value).split("/");
  return [parseInt(parts[0], 10), parseInt(parts[1] ?? "", 10)];
}

/** True when a reading is outside its normal range (WARNING or worse). */
export function isAbnormalVital(type: string, value: string): boolean {
  const n = parseFloat(value);
  switch (type) {
    case "HEART_RATE": return !isNaN(n) && (n < 60 || n > 100);
    case "OXYGEN": return !isNaN(n) && n < 95;
    case "TEMPERATURE": return !isNaN(n) && (n < 36.1 || n > 37.2);
    case "RESPIRATORY_RATE": return !isNaN(n) && (n < 12 || n > 20);
    case "BLOOD_GLUCOSE": return !isNaN(n) && (n < 70 || n > 180);
    case "BLOOD_PRESSURE": {
      const [sys, dia] = parseBP(value);
      return (!isNaN(sys) && (sys >= 140 || sys < 90)) || (!isNaN(dia) && (dia >= 90 || dia < 60));
    }
    default: return false;
  }
}

// ── Plausibility bounds ──────────────────────────────────────────────
// Physiologically-possible limits. A value outside these is almost certainly a
// data-entry error (typo, wrong field, device glitch) and is REJECTED at capture
// rather than logged and alerted on. Distinct from "abnormal" (real but out of
// the normal range).
export const VITAL_PLAUSIBLE: Record<string, { min: number; max: number }> = {
  HEART_RATE:       { min: 20, max: 250 },
  OXYGEN:           { min: 50, max: 100 },
  TEMPERATURE:      { min: 30, max: 45 },
  RESPIRATORY_RATE: { min: 3, max: 60 },
  BLOOD_GLUCOSE:    { min: 10, max: 800 },
  WEIGHT:           { min: 1, max: 400 },
};
const BP_PLAUSIBLE = { sysMin: 40, sysMax: 300, diaMin: 20, diaMax: 200 };

export interface VitalValidation {
  ok: boolean;
  error?: string;
  abnormal: boolean;
  severity?: "CRITICAL" | "WARNING";
}

/**
 * Validate a single reading before it is saved: correct format + physiologically
 * plausible. When valid, also reports whether it is abnormal (and how severe) so
 * the UI can require confirmation before logging + alerting.
 */
export function validateVital(type: string, raw: string): VitalValidation {
  const value = String(raw ?? "").trim();
  if (value === "") return { ok: false, error: "Enter a value.", abnormal: false };

  if (type === "BLOOD_PRESSURE") {
    if (!/^\d{1,3}\s*\/\s*\d{1,3}$/.test(value)) return { ok: false, error: "Use systolic/diastolic, e.g. 120/80.", abnormal: false };
    const [sys, dia] = parseBP(value);
    if (isNaN(sys) || isNaN(dia)) return { ok: false, error: "Enter both systolic and diastolic.", abnormal: false };
    if (sys < BP_PLAUSIBLE.sysMin || sys > BP_PLAUSIBLE.sysMax) return { ok: false, error: `Systolic ${sys} is outside the plausible range (${BP_PLAUSIBLE.sysMin}–${BP_PLAUSIBLE.sysMax}).`, abnormal: false };
    if (dia < BP_PLAUSIBLE.diaMin || dia > BP_PLAUSIBLE.diaMax) return { ok: false, error: `Diastolic ${dia} is outside the plausible range (${BP_PLAUSIBLE.diaMin}–${BP_PLAUSIBLE.diaMax}).`, abnormal: false };
    if (sys <= dia) return { ok: false, error: "Systolic must be higher than diastolic.", abnormal: false };
  } else {
    const n = parseFloat(value);
    if (isNaN(n)) return { ok: false, error: "Enter a number.", abnormal: false };
    const b = VITAL_PLAUSIBLE[type];
    if (b && (n < b.min || n > b.max)) {
      return { ok: false, error: `Outside the plausible range (${b.min}–${b.max} ${VITAL_META[type]?.unit ?? ""}) — re-check the reading.`, abnormal: false };
    }
  }

  const abnormal = isAbnormalVital(type, value);
  return { ok: true, abnormal, severity: abnormal ? vitalSeverity(type, value) : undefined };
}

// ── Measurement context / method ─────────────────────────────────────
// The context that changes how a reading is interpreted (SpO₂ on room air vs
// supplemental O₂, temperature route, BP posture). Stored with each reading as
// provenance so "94%" is never ambiguous.
export const VITAL_METHODS: Record<string, string[]> = {
  OXYGEN:         ["Room air", "On O₂ 1L", "On O₂ 2L", "On O₂ 3L", "On O₂ 4L+"],
  TEMPERATURE:    ["Oral", "Tympanic", "Temporal", "Axillary", "Rectal"],
  BLOOD_PRESSURE: ["Sitting", "Standing", "Supine"],
};

/** Dangerously-out-of-range readings escalate to CRITICAL; other abnormals are WARNING. */
export function vitalSeverity(type: string, value: string): "CRITICAL" | "WARNING" {
  const n = parseFloat(value);
  switch (type) {
    case "HEART_RATE": return !isNaN(n) && (n < 45 || n > 130) ? "CRITICAL" : "WARNING";
    case "OXYGEN": return !isNaN(n) && n < 90 ? "CRITICAL" : "WARNING";
    case "TEMPERATURE": return !isNaN(n) && (n >= 39 || n <= 35) ? "CRITICAL" : "WARNING";
    case "RESPIRATORY_RATE": return !isNaN(n) && (n < 8 || n > 28) ? "CRITICAL" : "WARNING";
    case "BLOOD_GLUCOSE": return !isNaN(n) && (n < 54 || n > 300) ? "CRITICAL" : "WARNING";
    case "BLOOD_PRESSURE": {
      const [sys, dia] = parseBP(value);
      return (!isNaN(sys) && (sys >= 180 || sys < 80)) || (!isNaN(dia) && (dia >= 120 || dia < 50)) ? "CRITICAL" : "WARNING";
    }
    default: return "WARNING";
  }
}
