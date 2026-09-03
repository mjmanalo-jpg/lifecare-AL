"use client";

import { useState } from "react";
import VitalsTrendBoard from "@/components/portal/views/clinical/VitalsTrendBoard";
import ADLMonitoringBoard from "@/components/portal/views/clinical/ADLMonitoringBoard";
import WeightMonitoringBoard from "@/components/portal/views/clinical/WeightMonitoringBoard";
import WoundCareBoard from "@/components/portal/views/clinical/WoundCareBoard";
import DomainMonitoringBoard from "@/components/portal/views/clinical/DomainMonitoringBoard";

type Sub = "vitals" | "adl" | "weight" | "wound" | "domain";
const SUBS: { key: Sub; label: string }[] = [
  { key: "vitals", label: "Vitals" },
  { key: "adl", label: "ADL" },
  { key: "weight", label: "Weight" },
  { key: "wound", label: "Wound" },
  { key: "domain", label: "Domain" },
];

/** The audit's "Monitoring" record tab — the per-resident trend boards folded
 *  into one sub-tabbed surface, each locked to this resident. */
export default function ResidentMonitoringTabs({ residentId, clinicianRole = "NURSE" }: { residentId: string; clinicianRole?: string }) {
  const [sub, setSub] = useState<Sub>("vitals");
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {SUBS.map(({ key, label }) => (
          <button key={key} onClick={() => setSub(key)}
            className={`text-sm font-semibold px-3 py-1.5 rounded-lg border transition ${sub === key ? "bg-[#2E4A48] text-white border-[#2E4A48]" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
            {label}
          </button>
        ))}
      </div>
      {sub === "vitals" && <VitalsTrendBoard residentId={residentId} clinicianRole={clinicianRole as never} />}
      {sub === "adl" && <ADLMonitoringBoard focusResidentId={residentId} embedded clinicianRole={clinicianRole as never} />}
      {sub === "weight" && <WeightMonitoringBoard focusResidentId={residentId} embedded clinicianRole={clinicianRole as never} />}
      {sub === "wound" && <WoundCareBoard focusResidentId={residentId} embedded clinicianRole={clinicianRole as never} />}
      {sub === "domain" && <DomainMonitoringBoard focusResidentId={residentId} embedded clinicianRole={clinicianRole as never} />}
    </div>
  );
}
