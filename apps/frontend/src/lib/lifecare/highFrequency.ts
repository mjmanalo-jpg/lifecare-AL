// High-Frequency Tasks (SLMS v4.2) — "one approved intervention, multiple
// auditable occurrences". A high-frequency domain (skin/repositioning,
// toileting, hydration) generates several timed occurrences across the care
// day instead of one bundled routine item. Pure + deterministic: the occurrence
// times are the same every care day, so no date input is needed here — the
// board prepends the care day when keying completions.
//
// v1 methods: fixed_interval, while_awake, times_per_shift. See
// docs/superpowers/specs/2026-09-04-high-frequency-routine-occurrences-design.md.

import hfData from "./data/high_frequency.json" with { type: "json" };
import type { RoutineShift } from "./carePlanRoutine.ts";

export type HFMethod = "fixed_interval" | "while_awake" | "times_per_shift";

export interface HFConfig {
  method: HFMethod;
  /** Activation threshold — HF only applies when the domain's assessed score is ≥ this. */
  minScore: number;
  label: string;
  intervalHours?: number; // fixed_interval / while_awake
  wakeStart?: number;     // while_awake, hour 0-24 (default 6)
  wakeEnd?: number;       // while_awake, hour 0-24 (default 22)
  perShift?: number;      // times_per_shift (default 3)
}

const HF = hfData as Record<string, HFConfig>;

/** The high-frequency config for a domain code, or undefined if it isn't high-frequency. */
export function hfConfigFor(code: string): HFConfig | undefined {
  return HF[code];
}

/** True when this domain should expand into timed occurrences for the given score. */
export function isHighFrequency(code: string, score: number | undefined): boolean {
  const cfg = HF[code];
  return !!cfg && (score ?? 0) >= cfg.minScore;
}

export interface HFOccurrence {
  minutes: number;      // minutes from midnight (0-1439)
  time: string;         // "HH:MM"
  shift: RoutineShift;  // AM | PM | NOC
}

/** Shift for a minute-of-day (spec Shift Rules: Night 22-06 / Morning 06-14 / Afternoon 14-22). */
function shiftForMinutes(m: number): RoutineShift {
  const h = Math.floor((((m % 1440) + 1440) % 1440) / 60);
  if (h >= 6 && h < 14) return "AM";
  if (h >= 14 && h < 22) return "PM";
  return "NOC";
}

function hm(m: number): string {
  const mm = (((m % 1440) + 1440) % 1440);
  return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`;
}

/**
 * Expand a high-frequency config into its timed occurrences (sorted by time).
 * Deterministic — same config always yields the same clock times.
 */
export function expandOccurrences(cfg: HFConfig): HFOccurrence[] {
  const out: HFOccurrence[] = [];
  const push = (m: number) => out.push({ minutes: m, time: hm(m), shift: shiftForMinutes(m) });

  if (cfg.method === "fixed_interval") {
    const step = (cfg.intervalHours ?? 2) * 60;
    for (let m = 0; m < 1440; m += step) push(m);
  } else if (cfg.method === "while_awake") {
    const step = (cfg.intervalHours ?? 2) * 60;
    const start = (cfg.wakeStart ?? 6) * 60;
    const end = (cfg.wakeEnd ?? 22) * 60;
    for (let m = start; m <= end; m += step) push(m);
  } else if (cfg.method === "times_per_shift") {
    const n = cfg.perShift ?? 3;
    // Spread n occurrences at interior points of each shift window (never on the boundary).
    const shifts = [
      { start: 6 * 60, end: 14 * 60 },   // Morning
      { start: 14 * 60, end: 22 * 60 },  // Afternoon
      { start: 22 * 60, end: 30 * 60 },  // Night (wraps midnight)
    ];
    for (const s of shifts) {
      const L = s.end - s.start;
      for (let i = 1; i <= n; i++) push((s.start + Math.round((L * i) / (n + 1))) % 1440);
    }
  }
  return out.sort((a, b) => a.minutes - b.minutes);
}

// ── Self-check ────────────────────────────────────────────────────────────────
// Runnable assertion of the generation rules. Not imported anywhere in the app;
// call from a scratch node script or a test to guard the math.
export function demo(): void {
  const assert = (cond: boolean, msg: string) => { if (!cond) throw new Error(`highFrequency demo: ${msg}`); };

  const reposition = expandOccurrences({ method: "fixed_interval", intervalHours: 2, minScore: 3, label: "Reposition" });
  assert(reposition.length === 12, `fixed q2h → 12 (got ${reposition.length})`);
  assert(reposition[0].time === "00:00" && reposition[11].time === "22:00", "fixed q2h spans 00:00..22:00");

  const toileting = expandOccurrences({ method: "while_awake", intervalHours: 2, wakeStart: 6, wakeEnd: 22, minScore: 3, label: "Toileting" });
  assert(toileting.length === 9, `while-awake 06-22 q2h → 9 (got ${toileting.length})`);
  assert(toileting[0].time === "06:00" && toileting[8].time === "22:00", "while-awake spans 06:00..22:00");
  assert(!toileting.some((o) => o.minutes < 6 * 60 || o.minutes > 22 * 60), "while-awake never at night");

  const hydration = expandOccurrences({ method: "times_per_shift", perShift: 3, minScore: 3, label: "Hydration" });
  assert(hydration.length === 9, `3×/shift → 9 (got ${hydration.length})`);
  const byShift = (s: string) => hydration.filter((o) => o.shift === s).length;
  assert(byShift("AM") === 3 && byShift("PM") === 3 && byShift("NOC") === 3, "3 per shift");
  // 00:00 is interior to the Night shift (22:00→06:00), NOT a boundary.
  const boundaries = new Set([6 * 60, 14 * 60, 22 * 60]);
  assert(!hydration.some((o) => boundaries.has(o.minutes)), "no occurrence on a shift boundary");

  assert(isHighFrequency("AS-11", 3) && !isHighFrequency("AS-11", 2) && !isHighFrequency("AS-01", 4), "score threshold + non-HF domain");
}
