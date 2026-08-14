"use client";

import { useEffect, useState } from "react";
import { Plus, X, ClipboardList, BarChart3, Scale, ClipboardCheck, type LucideIcon } from "lucide-react";
import { CareLogsTimeline } from "@/components/portal/views/clinical/CareLogsBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import TaskAssignmentBoard from "@/components/portal/views/clinical/TaskAssignmentBoard";
import type { ClinicianRole } from "@/components/portal/views/clinical/useClinician";

/**
 * Floating quick-actions launcher for the dashboard. A bottom-right FAB expands
 * into a small speed-dial of the most-used clinical boards; picking one slides a
 * right-hand panel in over the dashboard widgets and renders that board inline
 * (each board is full-bleed, so the drawer body pads it back to normal margins).
 */

type ActionKey = "carelogs" | "adl" | "weight" | "tasks";
const ACTIONS: { key: ActionKey; label: string; icon: LucideIcon; color: string }[] = [
  { key: "carelogs", label: "Care Logs", icon: ClipboardList, color: "#0d9488" },
  { key: "adl", label: "ADL Monitoring", icon: BarChart3, color: "#d97706" },
  { key: "weight", label: "Weight Monitoring", icon: Scale, color: "#c026d3" },
  { key: "tasks", label: "Task Assignment", icon: ClipboardCheck, color: "#16a34a" },
];

export default function DashboardQuickActions({ clinicianRole = "FACILITY_ADMIN" }: { clinicianRole?: ClinicianRole }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<ActionKey | null>(null);
  const [shown, setShown] = useState(false); // drives the slide-in transition

  const open = (k: ActionKey) => { setShown(false); setActive(k); setMenuOpen(false); };
  const close = () => { setShown(false); setActive(null); };

  // Slide the panel in on the frame after it mounts (async setState only).
  useEffect(() => {
    if (!active) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [active]);

  // Escape closes the panel (then the menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (active) close();
      else if (menuOpen) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, menuOpen]);

  // Lock body scroll while the panel is open.
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [active]);

  const label = ACTIONS.find((a) => a.key === active)?.label ?? "";

  const renderBoard = () => {
    switch (active) {
      case "carelogs": return <CareLogsTimeline clinicianRole={clinicianRole} />;
      case "adl": return <ADLMonitoringBoard clinicianRole={clinicianRole} />;
      case "weight": return <WeightMonitoringBoard clinicianRole={clinicianRole} />;
      case "tasks": return <TaskAssignmentBoard clinicianRole={clinicianRole} />;
      default: return null;
    }
  };

  return (
    <>
      {/* Speed dial */}
      <div className="fixed bottom-24 right-4 z-40 flex flex-col items-end gap-3 print:hidden md:bottom-6 md:right-6">
        {menuOpen && (
          <div className="mb-1 w-56 overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2 zoom-in-95 duration-200">
            {ACTIONS.map((a) => (
              <button key={a.key} onClick={() => open(a.key)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50">
                <a.icon className="h-4 w-4" style={{ color: a.color }} /> {a.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          aria-label={menuOpen ? "Close quick actions" : "Open quick actions"}
          aria-expanded={menuOpen}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition hover:bg-blue-700 active:scale-95"
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
        </button>
      </div>

      {/* Slide-in panel */}
      {active && (
        <div className="fixed inset-0 z-50 m-0 h-dvh w-screen max-w-none" role="dialog" aria-modal="true" aria-label={label}>
          <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${shown ? "opacity-100" : "opacity-0"}`} onClick={close} />
          <div className={`absolute inset-y-0 right-0 ml-auto flex h-full w-full max-w-3xl flex-col bg-slate-50 shadow-2xl transition-transform duration-300 ${shown ? "translate-x-0" : "translate-x-full"}`}>
            <div className="flex flex-none items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">{label}</h2>
              <button onClick={close} aria-label="Close" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              <div className={`transition-all duration-500 ease-out ${shown ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`}>
                {renderBoard()}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
