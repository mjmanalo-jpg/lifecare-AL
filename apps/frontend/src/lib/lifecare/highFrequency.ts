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

// The 3 original methods drive the migration-free high_frequency.json domain path
// (expandOccurrences, date-free). The full workbook set is used by the assembly
// engine (#2) via occurrencesForDate (date-aware, Asia/Manila) — see below.
export type HFMethod =
  | "exact_time" | "defined_window" | "fixed_interval" | "completion_based"
  | "times_per_shift" | "while_awake" | "trigger_prn" | "temporary"
  | "day_of_week" | "every_other_day";

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

// ── Full frequency set (assembly engine #2, Rule 10) ───────────────────────────
// A per-event schedule shape (discriminated by method) + a DATE-AWARE occurrence
// computation. Unlike expandOccurrences (date-free), this decides whether *today*
// is a match for day_of_week / every_other_day / temporary, so #3 can generate a
// care day's occurrences. Pure + deterministic; careDateISO ("YYYY-MM-DD") is a
// plain date, interpreted as the Asia/Manila care day (matches routineCompletions).

export interface DaySchedule {
  times?: string[];        // exact_time, day_of_week, every_other_day ("HH:MM")
  window?: string;         // defined_window ("06:30-06:45")
  intervalHours?: number;  // fixed_interval, while_awake, completion_based
  wakeStart?: number;      // while_awake (hour 0-24)
  wakeEnd?: number;        // while_awake (hour 0-24)
  perShift?: number;       // times_per_shift
  fromCompletion?: boolean;// completion_based (next occ generated at runtime)
  trigger?: string;        // trigger_prn
  days?: ("Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun")[]; // day_of_week
  everyOtherDayFrom?: string; // every_other_day anchor ("YYYY-MM-DD")
  stopDate?: string;       // temporary bound ("YYYY-MM-DD")
  baseMethod?: HFMethod;   // temporary wraps a base method
}

const toMin = (t: string): number => {
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  return m ? +m[1] * 60 + +m[2] : 0;
};
const utcDays = (iso: string): number => {
  const [y, mo, d] = iso.split("-").map(Number);
  return Date.UTC(y, mo - 1, d) / 86400000; // plain-date → whole days, TZ-independent
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const weekdayOf = (iso: string): (typeof WEEKDAYS)[number] =>
  WEEKDAYS[((utcDays(iso) % 7) + 7 + 4) % 7]; // 1970-01-01 (day 0) was a Thursday (idx 4)

/**
 * Occurrences for a specific care day. Returns [] when today is not a match
 * (day_of_week / every_other_day off-day, temporary past stop, or a runtime-only
 * method: completion_based / trigger_prn). Deterministic — no Date.now/random.
 */
export function occurrencesForDate(method: HFMethod, schedule: DaySchedule, careDateISO: string): HFOccurrence[] {
  const mk = (m: number): HFOccurrence => ({ minutes: m, time: hm(m), shift: shiftForMinutes(m) });
  const fromTimes = (times?: string[]): HFOccurrence[] =>
    (times ?? []).map(toMin).sort((a, b) => a - b).map(mk);

  switch (method) {
    case "exact_time":
      return fromTimes(schedule.times);
    case "defined_window":
      return [mk(toMin((schedule.window ?? "00:00").split("-")[0]))];
    case "fixed_interval": {
      const step = (schedule.intervalHours ?? 2) * 60;
      const out: HFOccurrence[] = [];
      for (let m = 0; m < 1440; m += step) out.push(mk(m));
      return out;
    }
    case "while_awake": {
      const step = (schedule.intervalHours ?? 2) * 60;
      const start = (schedule.wakeStart ?? 6) * 60;
      const end = (schedule.wakeEnd ?? 22) * 60;
      const out: HFOccurrence[] = [];
      for (let m = start; m <= end; m += step) out.push(mk(m));
      return out;
    }
    case "times_per_shift": {
      const n = schedule.perShift ?? 3;
      const shifts = [{ s: 6 * 60, e: 14 * 60 }, { s: 14 * 60, e: 22 * 60 }, { s: 22 * 60, e: 30 * 60 }];
      const out: HFOccurrence[] = [];
      for (const sh of shifts) {
        const L = sh.e - sh.s;
        for (let i = 1; i <= n; i++) out.push(mk((sh.s + Math.round((L * i) / (n + 1))) % 1440));
      }
      return out.sort((a, b) => a.minutes - b.minutes);
    }
    case "day_of_week":
      return schedule.days?.includes(weekdayOf(careDateISO)) ? fromTimes(schedule.times) : [];
    case "every_other_day":
      if (!schedule.everyOtherDayFrom) return [];
      return (utcDays(careDateISO) - utcDays(schedule.everyOtherDayFrom)) % 2 === 0 ? fromTimes(schedule.times) : [];
    case "temporary":
      if (schedule.stopDate && utcDays(careDateISO) > utcDays(schedule.stopDate)) return [];
      return schedule.baseMethod ? occurrencesForDate(schedule.baseMethod, schedule, careDateISO) : [];
    case "completion_based": // next occurrence generated at runtime from actual completion (#3/#4)
    case "trigger_prn":      // created only when the trigger fires (#4)
      return [];
  }
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

  // Full frequency set, date-aware (assembly engine #2, Rule 10). Fixed dates:
  // 2026-09-08 = Tue, 2026-09-09 = Wed; every-other-day anchor 2026-09-05.
  const dowCfg: DaySchedule = { days: ["Mon", "Wed", "Fri"], times: ["10:00"] };
  assert(occurrencesForDate("day_of_week", dowCfg, "2026-09-09").length === 1, "day_of_week present on Wed");
  assert(occurrencesForDate("day_of_week", dowCfg, "2026-09-08").length === 0, "day_of_week absent on Tue");
  const eod: DaySchedule = { everyOtherDayFrom: "2026-09-05", times: ["09:00"] };
  assert(occurrencesForDate("every_other_day", eod, "2026-09-05").length === 1, "every_other_day on anchor");
  assert(occurrencesForDate("every_other_day", eod, "2026-09-06").length === 0, "every_other_day skips next day");
  assert(occurrencesForDate("every_other_day", eod, "2026-09-07").length === 1, "every_other_day on +2");
  assert(occurrencesForDate("exact_time", { times: ["08:00", "20:00"] }, "2026-09-05").length === 2, "exact_time two times");
  const wake6 = occurrencesForDate("while_awake", { intervalHours: 3, wakeStart: 7, wakeEnd: 22 }, "2026-09-05");
  assert(wake6.length === 6, `six-while-awake q3h 07-22 → 6 (got ${wake6.length})`);
  assert(new Set(wake6.map((o) => o.time)).size === 6, "six-while-awake occurrences are distinct");
  assert(occurrencesForDate("temporary", { baseMethod: "exact_time", times: ["08:00"], stopDate: "2026-09-04" }, "2026-09-05").length === 0, "temporary past stop → none");
  assert(occurrencesForDate("trigger_prn", { trigger: "on pain" }, "2026-09-05").length === 0, "trigger_prn schedules nothing");
}
