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
