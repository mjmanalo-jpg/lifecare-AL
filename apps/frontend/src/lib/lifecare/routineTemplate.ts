// SLMS v4.2 — the "24-Hour Routine" operational template (39 atomic care events,
// RT-001…RT-039). Extracted verbatim from the workbook's "24-Hour Routine" sheet:
// each row is one observable action at one exact Time/Window. This is the Phase-1
// baseline for a resident's generated routine — every row, real clock times copied
// from the sheet — refined only by assistance-from-score and order gating.
// (Phase 2 tailors the set per Final LOC; the per-LOC bundles live in locBundles.ts.)
//
// Data: data/routine_24h.json (regenerate from the .xlsx, do not hand-edit).

import raw from "./data/routine_24h.json" with { type: "json" };
import type { DaySchedule, HFMethod } from "./highFrequency.ts";

export interface RoutineTemplateEvent {
  eventId: string;          // "RT-001"
  careEvent: string;        // "Night safety round"
  shift: "Night" | "Morning" | "Afternoon";
  shiftOwner: "NOC" | "AM" | "PM";
  timeText: string;         // raw sheet cell, e.g. "6:30–7:00 AM"
  frequencyMethod: HFMethod; // exact_time | defined_window (schedule-driving)
  schedule: DaySchedule;    // { times: ["06:15"] } | { window: "06:30-07:00" }
  frequencyLabel: string;   // original sheet "Frequency Method" wording (display)
  asDomains: string[];      // ["AS-12","AS-13"] ([] when "All active domains")
  asDomainsNote: string;    // "All active domains" etc. when not enumerated
  goalIds: string[];        // ["G-AS-12-[level]", …] — [level] filled at generation
  residentGoal: string;
  caregiverInstruction: string;
  nurseResponsibility: string;
  criticality: string;      // Routine | High | Critical
  requiredResult: string;
  completionControl: string;
  orderRequired: boolean;   // med / ordered-clinical / treatment rows
}

export const ROUTINE_24H_TEMPLATE = raw as RoutineTemplateEvent[];

/**
 * Phase 2 tailoring — the minimum Final LOC at which a template row is included by
 * default. A row not listed here defaults to LOC 1 (universal: meals, hydration,
 * hygiene, activities, handovers, meds/treatment which are order-gated anyway).
 * The gated rows are the higher-dependency ones; the mapping is aligned with the
 * workbook's per-LOC Standard Routine Bundles (e.g. repositioning first appears in
 * the LOC-4 bundle, night safety round in LOC-3). Provisional — tune to SOP. The
 * nurse always adds/suppresses to finalize the resident's day.
 * ponytail: static map; move to a workbook column if the sheet later encodes it.
 */
export const TEMPLATE_MIN_LOC: Record<string, number> = {
  "RT-001": 3, // Night safety round
  "RT-002": 4, // Repositioning (2 AM)
  "RT-003": 3, // Scheduled toileting (4 AM)
  "RT-037": 2, // Night resident check
  "RT-005": 2, // Morning toileting
  "RT-008": 2, // Transfer to dining
  "RT-016": 2, // Pre-lunch toileting
  "RT-026": 2, // Pre-dinner toileting
  "RT-032": 2, // Bedtime toileting
  "RT-033": 3, // Skin observation
  "RT-034": 3, // Bedtime positioning
  "RT-035": 2, // Night safety setup
};

/** Final LOC label ("LOC 3", "Level 3", "3") → its number, defaulting to 1. */
export const locNumber = (finalLoc: string): number => {
  const n = Number(/\d/.exec(finalLoc ?? "")?.[0]);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/** The template rows appropriate for a resident's Final LOC (Phase-2 baseline). */
export function templateForLoc(finalLoc: string): RoutineTemplateEvent[] {
  const loc = locNumber(finalLoc);
  return ROUTINE_24H_TEMPLATE.filter((e) => loc >= (TEMPLATE_MIN_LOC[e.eventId] ?? 1));
}

const MIN = (t: string): number => {
  const m = /(\d{1,2}):(\d{2})/.exec(t);
  return m ? +m[1] * 60 + +m[2] : 0;
};

/** First clock minute of a template event's schedule (for time-sorting). */
export function templateStartMinutes(e: RoutineTemplateEvent): number {
  return MIN(e.schedule.times?.[0] ?? e.schedule.window?.split("-")[0] ?? "00:00");
}

/**
 * The template events grouped for the care day, which runs Morning → Afternoon →
 * Night (06:00 → 04:00). Within Night, times wrap past midnight (…22:00, 00:00, 04:00).
 */
export function templateByShift(): { shift: string; events: RoutineTemplateEvent[] }[] {
  const order = ["Morning", "Afternoon", "Night"];
  const rank = (e: RoutineTemplateEvent) => (templateStartMinutes(e) - 360 + 1440) % 1440; // day starts 06:00
  return order.map((shift) => ({
    shift,
    events: ROUTINE_24H_TEMPLATE.filter((e) => e.shift === shift).sort((a, b) => rank(a) - rank(b)),
  })).filter((g) => g.events.length);
}
