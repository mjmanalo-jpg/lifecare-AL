"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface CalItem {
  id: string;
  date: string;        // ISO — plotted on this day
  label: string;
  className: string;   // pill colour classes
  title?: string;
  onClick?: () => void;
}

/** Reusable month grid — callers map their data to CalItem[] and it plots each
 *  on its day. Used by both the Tours and Follow-ups CRM tabs. */
export default function MonthCalendar({ items, icon }: { items: CalItem[]; icon?: ReactNode }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() });

  const byDay = useMemo(() => {
    const map: Record<number, CalItem[]> = {};
    for (const it of items) {
      const d = new Date(it.date);
      if (Number.isNaN(d.getTime())) continue;
      if (d.getFullYear() === cursor.y && d.getMonth() === cursor.m) (map[d.getDate()] ??= []).push(it);
    }
    for (const day of Object.values(map)) day.sort((a, b) => (a.date < b.date ? -1 : 1));
    return map;
  }, [items, cursor]);

  const firstWeekday = new Date(cursor.y, cursor.m, 1).getDay();
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isToday = (day: number) => today.getFullYear() === cursor.y && today.getMonth() === cursor.m && today.getDate() === day;
  const shift = (n: number) => setCursor(({ y, m }) => { const d = new Date(y, m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-1.5">{icon} {monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label="Previous month" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })} className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Today</button>
          <button onClick={() => shift(1)} aria-label="Next month" className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-[11px] font-semibold text-slate-400 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => {
          const list = day ? byDay[day] ?? [] : [];
          return (
            <div key={i} className={`min-h-[92px] border-b border-r border-slate-100 p-1.5 ${i % 7 === 0 ? "border-l" : ""} ${day ? "" : "bg-slate-50/40"}`}>
              {day && (
                <>
                  <div className={`text-[11px] font-semibold mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday(day) ? "bg-blue-600 text-white" : "text-slate-500"}`}>{day}</div>
                  <div className="space-y-1">
                    {list.slice(0, 3).map((it) => (
                      <button key={it.id} onClick={it.onClick} title={it.title} className={`w-full text-left truncate text-[10px] font-medium px-1.5 py-0.5 rounded ${it.className}`}>{it.label}</button>
                    ))}
                    {list.length > 3 && <p className="text-[10px] text-slate-400 pl-1">+{list.length - 3} more</p>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
