"use client";

/**
 * Monitoring hub — resident-first. The landing state is the resident card grid;
 * picking a resident opens the five monitoring panes (Vitals / ADL / Weight /
 * Wound Care / Domain) for THAT resident inside the card, so switching panes no
 * longer means re-picking the resident on every board.
 *
 * No new data layer: each pane is the same board it was as a standalone tab,
 * rendered in its existing per-resident mode (`focusResidentId` + `embedded`).
 */

import { useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import HubTabs from "@/components/portal/HubTabs";
import { ClinicalPage, ClinicalHeader, DataState, ResidentPickerGrid, SERIF } from "./clinical-ui";
import type { ClinicianRole } from "./useClinician";
import VitalsTrendBoard from "./VitalsTrendBoard";
import ADLMonitoringBoard from "./ADLMonitoringBoard";
import WeightMonitoringBoard from "./WeightMonitoringBoard";
import WoundCareBoard from "./WoundCareBoard";
import DomainMonitoringBoard from "./DomainMonitoringBoard";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));

export default function MonitoringHub({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const [residentId, setResidentId] = useState("");
  const selected = useMemo(() => residents.find((r: Row) => s(r.id) === residentId) || null, [residents, residentId]);

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Monitoring"
        subtitle="Pick a resident once — vitals, ADL, weight, wounds and domain drift all stay on that resident."
        right={selected ? (
          <button
            onClick={() => setResidentId("")}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold text-[var(--clinical-panel)]"
            style={{ borderColor: "var(--clinical-line-strong)" }}
          >
            <ArrowLeft className="h-4 w-4" /> All residents
          </button>
        ) : undefined}
      />

      <div className="mt-5">
        <DataState loading={resQ.loading && residents.length === 0} error={resQ.error} empty={false}>
          {!selected ? (
            <ResidentPickerGrid
              residents={residents.map((r: Row) => ({ id: s(r.id), name: s(r.name), room: s(r.room) }))}
              onPick={setResidentId}
              title="Select a resident to monitor"
              hint="Tap a resident to open their vitals, ADL, weight, wound care and domain monitoring"
            />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl leading-none" style={{ backgroundColor: "var(--clinical-surface-2)" }}>
                  <span className="text-[9px] font-semibold text-[var(--clinical-muted)]">Rm</span>
                  <span className="text-sm font-bold text-[var(--clinical-panel)]">{s(selected.room)}</span>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{s(selected.name)}</p>
                  <p className="text-xs text-[var(--clinical-muted)]">Monitoring record</p>
                </div>
              </div>

              {/* Remount every pane when the resident changes so each board
                  re-seeds its own resident-scoped state from focusResidentId. */}
              <HubTabs
                key={residentId}
                storageKey={`${clinicianRole.toLowerCase()}-monitoringhub`}
                tabs={[
                  { key: "vitalstrend", label: "Vitals", node: <VitalsTrendBoard clinicianRole={clinicianRole} residentId={residentId} embedded /> },
                  { key: "adlmonitoring", label: "ADL", node: <ADLMonitoringBoard clinicianRole={clinicianRole} focusResidentId={residentId} embedded /> },
                  { key: "weightmonitoring", label: "Weight", node: <WeightMonitoringBoard clinicianRole={clinicianRole} focusResidentId={residentId} embedded /> },
                  { key: "woundcare", label: "Wound Care", node: <WoundCareBoard clinicianRole={clinicianRole} focusResidentId={residentId} embedded /> },
                  { key: "domainmonitoring", label: "Domain", node: <DomainMonitoringBoard clinicianRole={clinicianRole} focusResidentId={residentId} embedded /> },
                ]}
              />
            </div>
          )}
        </DataState>
      </div>
    </ClinicalPage>
  );
}
