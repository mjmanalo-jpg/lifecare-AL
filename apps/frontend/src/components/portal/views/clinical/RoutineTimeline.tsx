"use client";

import type { RoutineEvent } from "@/lib/lifecare/carePlanRoutine";

// Read-only 24-hour routine timeline — one card per care window, shift-colour
// coded, with the bundled interventions. Shared by the Care Plan Generator
// preview and the Routine Generator board so both render identically.
const shiftColor = (shift: RoutineEvent["shift"]) => (shift === "NOC" ? "#4c6ef5" : shift === "AM" ? "#2f9e44" : "#e8590c");

export default function RoutineTimeline({ events }: { events: RoutineEvent[] }) {
  if (!events.length) return null;
  return (
    <div className="space-y-2">
      {events.map((ev) => (
        <div key={ev.id} className="rounded-xl border p-3" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: shiftColor(ev.shift) }}>{ev.shiftLabel}</span>
            <span className="font-mono text-xs font-semibold text-[var(--clinical-ink-soft)]">{ev.window}</span>
            <span className="text-sm font-bold text-[var(--clinical-ink)]">{ev.label}</span>
            <span className="text-[10px] font-medium text-[var(--clinical-muted)]">{ev.domainCodes.join(" · ")}</span>
          </div>
          {ev.interventions.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 pl-1">
              {ev.interventions.map((iv, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-[var(--clinical-ink-soft)]">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ backgroundColor: "var(--clinical-panel)" }} />
                  <span>{iv}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
