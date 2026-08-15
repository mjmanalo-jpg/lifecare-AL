"use client";

import { useMemo, useState } from "react";
import { Siren, ShieldCheck, ArrowUpRight, Eye, X } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { useRelative, TabLoading, EmptyState, LiveBadge, type Row } from "./shared";

/**
 * Family SBAR Escalations — the clinical escalations (SBAR) raised to the care
 * team for the family's own resident. Distinct from Incident Alerts (incidents).
 * The `escalations` model is RESIDENT_SCOPED, so useLiveQuery returns only the
 * sponsor's resident's escalations. Read-only, with a per-row full-detail modal.
 */

const priorityMeta = (p: string) => {
  const s = String(p || "").toUpperCase();
  return s === "EMERGENCY" ? { label: "Emergency", cls: "bg-red-100 text-red-700" }
    : s === "ROUTINE" ? { label: "Routine", cls: "bg-blue-100 text-blue-700" }
    : { label: "Urgent", cls: "bg-orange-100 text-orange-700" };
};
const statusMeta = (s: string) => {
  const v = String(s || "").toUpperCase();
  return v === "RESOLVED" ? { label: "Resolved", cls: "bg-green-100 text-green-700" }
    : v === "ACKNOWLEDGED" ? { label: "Acknowledged", cls: "bg-yellow-100 text-yellow-700" }
    : { label: "Open", cls: "bg-red-100 text-red-700" };
};
const fmt = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "");

export default function FamilyEscalations() {
  const { relative, loading: resLoading } = useRelative();
  const { data: rows, loading } = useLiveQuery<Row>("escalations", { query: "take=100", tables: ["Escalation"] });
  const [selected, setSelected] = useState<Row | null>(null);

  const escalations = useMemo(
    () => (rows || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    [rows],
  );
  const open = escalations.filter((e) => String(e.status).toUpperCase() !== "RESOLVED").length;

  if ((resLoading || loading) && escalations.length === 0) {
    return <div className="space-y-6"><h2 className="text-2xl font-bold text-gray-900">SBAR Escalations</h2><TabLoading label="Loading escalations..." /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center gap-2"><Siren className="w-6 h-6 text-red-500" /> SBAR Escalations</h1>
        <p className="text-gray-600 flex items-center gap-2 text-sm mt-1">
          <LiveBadge /> Clinical escalations the care team raised{relative?.name ? ` for ${relative.name}` : ""}
          {escalations.length > 0 && <span className="text-gray-400">· {open} open of {escalations.length}</span>}
        </p>
      </div>

      {escalations.length === 0 ? (
        <EmptyState message="No SBAR escalations have been raised for your relative." />
      ) : (
        <div className="space-y-3">
          {escalations.map((e) => {
            const p = priorityMeta(String(e.priority));
            const st = statusMeta(String(e.status));
            return (
              <div key={String(e.id)} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm transition hover:border-gray-300">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600"><Siren className="w-4 h-4" /></span>
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{String(e.situation || "Escalation")}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Raised by {String(e.raisedBy || "Care team")}{e.raisedByRole ? ` (${String(e.raisedByRole).toLowerCase()})` : ""} · {fmt(e.createdAt)}</p>
                      <p className="text-xs text-gray-400 mt-0.5 inline-flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> Routed to {String(e.assignedToRole || "Physician").toLowerCase()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${p.cls}`}>{p.label}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.cls}`}>{st.label}</span>
                  </div>
                </div>

                {(e.recommendation || e.assessment) && (
                  <p className="mt-3 line-clamp-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    {String(e.recommendation || e.assessment)}
                  </p>
                )}

                <div className="mt-3 flex justify-end">
                  <button onClick={() => setSelected(e)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 hover:text-gray-900">
                    <Eye className="w-3.5 h-3.5" /> View details
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <EscalationModal e={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function EscalationModal({ e, onClose }: { e: Row; onClose: () => void }) {
  const p = priorityMeta(String(e.priority));
  const st = statusMeta(String(e.status));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Escalation details">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5">
        <div className="flex flex-none items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600"><Siren className="h-5 w-5" /></span>
            <div>
              <h2 className="text-base font-bold text-gray-900">SBAR Escalation</h2>
              <div className="mt-1 flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${p.cls}`}>{p.label}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.label}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <SbarField label="Situation" value={String(e.situation || "")} />
          <SbarField label="Background" value={String(e.background || "")} />
          <SbarField label="Assessment" value={String(e.assessment || "")} />
          <SbarField label="Recommendation" value={String(e.recommendation || "")} />

          <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3">
            <Meta label="Raised by" value={`${String(e.raisedBy || "—")}${e.raisedByRole ? ` (${String(e.raisedByRole).toLowerCase()})` : ""}`} />
            <Meta label="Routed to" value={String(e.assignedToRole || "—").toLowerCase()} />
            <Meta label="Raised at" value={fmt(e.createdAt)} />
            {e.acknowledgedAt ? <Meta label="Acknowledged" value={`${e.acknowledgedBy ? `${String(e.acknowledgedBy)} · ` : ""}${fmt(e.acknowledgedAt)}`} /> : null}
          </div>

          {e.response ? (
            <div className="rounded-xl border border-green-100 bg-green-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-green-700">Care team response</p>
              <p className="mt-0.5 text-sm text-gray-700">{String(e.response)}</p>
              {e.resolvedAt ? <p className="mt-1 text-xs font-semibold text-green-700">Resolved{e.resolvedBy ? ` by ${String(e.resolvedBy)}` : ""} · {fmt(e.resolvedAt)}</p> : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-none justify-end border-t border-gray-100 px-5 py-3">
          <button onClick={onClose} className="rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white transition hover:bg-gray-800">Close</button>
        </div>
      </div>
    </div>
  );
}

function SbarField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-line">{value}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-800">{value || "—"}</p>
    </div>
  );
}
