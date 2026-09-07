"use client";

/**
 * Routine Template — read-only reference for the SLMS v4.2 workbook.
 *
 *  • Top: the "24-Hour Routine" operational template — all 39 atomic care events
 *    (RT-001…RT-039) with the exact Time/Window copied from the sheet, grouped
 *    Night / Morning / Afternoon. This is what a resident's generated routine is
 *    seeded from (Phase 1).
 *  • Bottom: a Level-of-Care dropdown showing that LOC's Standard Routine Bundles
 *    — the per-level task list the Phase-2 engine tailors from.
 *
 * Pure catalog: no resident, no live data.
 */

import { useMemo, useState } from "react";
import { Clock, ListChecks } from "lucide-react";
import { templateByShift, templateForLoc, type RoutineTemplateEvent } from "@/lib/lifecare/routineTemplate";
import { ClinicalCard, MicroLabel, controlClass } from "./clinical-ui";

const LOCS = [
  { value: "LOC 1", label: "LOC 1 – Minimal Care Support" },
  { value: "LOC 2", label: "LOC 2 – Assisted Moderate" },
  { value: "LOC 3", label: "LOC 3 – Enhanced Assisted" },
  { value: "LOC 4", label: "LOC 4 – Comprehensive Care" },
  { value: "LOC 5", label: "LOC 5 – Intensive/Palliative Care" },
];

const critClass = (c: string): string => {
  const t = c.toLowerCase();
  if (t.includes("critical")) return "text-[var(--clinical-coral)]";
  if (t.includes("high")) return "text-[var(--clinical-amber)]";
  return "text-[var(--clinical-muted)]";
};

const timeDisplay = (e: RoutineTemplateEvent): string => e.timeText || e.schedule.times?.[0] || e.schedule.window || "";

export default function RoutineTemplateBoard() {
  const groups = useMemo(() => templateByShift(), []);
  const [loc, setLoc] = useState("LOC 3");
  const locEvents = useMemo(() => templateForLoc(loc), [loc]);
  const total = groups.reduce((n, g) => n + g.events.length, 0);

  return (
    <div className="space-y-4">
      {/* ── 24-Hour Routine template — all 39 rows ─────────────────────────── */}
      <ClinicalCard top="teal" className="p-4 sm:p-5">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="h-4 w-4 text-[var(--clinical-panel)]" />
          <h2 className="text-sm font-bold text-[var(--clinical-ink)]">24-Hour Routine Template</h2>
          <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{total} atomic care events · Night / Morning / Afternoon</span>
        </div>
        <p className="mb-3 text-[11px] text-[var(--clinical-muted)]">
          The workbook&apos;s operational template. A resident&apos;s generated routine is seeded from these rows, with times copied verbatim.
        </p>
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.shift}>
              <MicroLabel className="mb-1.5">{g.shift} · {g.events.length} event{g.events.length === 1 ? "" : "s"}</MicroLabel>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] table-fixed border-collapse text-[12px]">
                  <colgroup>
                    <col className="w-[12%]" />
                    <col className="w-[20%]" />
                    <col className="w-[53%]" />
                    <col className="w-[15%]" />
                  </colgroup>
                  <thead>
                    <tr className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">
                      <th className="py-1.5 pr-3 font-bold">Event</th>
                      <th className="py-1.5 pr-3 font-bold">Time / Window</th>
                      <th className="py-1.5 pr-3 font-bold">Care Event</th>
                      <th className="py-1.5 font-bold">Criticality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.events.map((e) => (
                      <tr key={e.eventId} className="border-t align-top" style={{ borderColor: "var(--clinical-line)" }}>
                        <td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--clinical-muted)]">{e.eventId}</td>
                        <td className="py-1.5 pr-3 font-semibold text-[var(--clinical-ink)] whitespace-nowrap">{timeDisplay(e)}</td>
                        <td className="py-1.5 pr-3 text-[var(--clinical-ink)]">{e.careEvent}</td>
                        <td className={`py-1.5 font-semibold ${critClass(e.criticality)}`}>{e.criticality}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </ClinicalCard>

      {/* ── Tasks per LOC — the 24-Hour Routine rows included for the chosen LOC ── */}
      <ClinicalCard className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-[var(--clinical-panel)]" />
            <h2 className="text-sm font-bold text-[var(--clinical-ink)]">Tasks by Level of Care</h2>
            <span className="text-[11px] font-medium text-[var(--clinical-muted)]">{locEvents.length} of {total} events</span>
          </div>
          <select value={loc} onChange={(e) => setLoc(e.target.value)} className={`${controlClass} max-w-xs`} aria-label="Level of Care">
            {LOCS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <p className="mb-3 text-[11px] text-[var(--clinical-muted)]">
          The 24-Hour Routine events (same RT- IDs) generated by default for {loc}. Higher levels add the higher-dependency events; the nurse adds or suppresses to finalize.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] table-fixed border-collapse text-[12px]">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[20%]" />
              <col className="w-[53%]" />
              <col className="w-[15%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">
                <th className="py-1.5 pr-3 font-bold">Event</th>
                <th className="py-1.5 pr-3 font-bold">Time / Window</th>
                <th className="py-1.5 pr-3 font-bold">Care Event</th>
                <th className="py-1.5 font-bold">Criticality</th>
              </tr>
            </thead>
            <tbody>
              {locEvents.map((e) => (
                <tr key={e.eventId} className="border-t align-top" style={{ borderColor: "var(--clinical-line)" }}>
                  <td className="py-1.5 pr-3 font-mono text-[11px] text-[var(--clinical-muted)]">{e.eventId}</td>
                  <td className="py-1.5 pr-3 font-semibold text-[var(--clinical-ink)] whitespace-nowrap">{timeDisplay(e)}</td>
                  <td className="py-1.5 pr-3 text-[var(--clinical-ink)]">{e.careEvent}</td>
                  <td className={`py-1.5 font-semibold ${critClass(e.criticality)}`}>{e.criticality}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ClinicalCard>
    </div>
  );
}
