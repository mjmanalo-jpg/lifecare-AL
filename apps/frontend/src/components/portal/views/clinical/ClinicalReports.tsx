"use client";
import { useMemo, useState } from "react";
import { BarChart3, Download, Calendar, Filter, Loader2 } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";

type ReportType = "ADMISSIONS" | "DISCHARGES" | "INCIDENTS" | "VITALS_TRENDS" | "CARE_PLANS" | "MEDICATIONS" | "COMPLIANCE";

const REPORT_TYPES: { key: ReportType; label: string; description: string }[] = [
  { key: "ADMISSIONS", label: "Admissions Report", description: "New resident admissions over a date range" },
  { key: "DISCHARGES", label: "Discharges Report", description: "Resident discharges and transfers" },
  { key: "INCIDENTS", label: "Incident Summary", description: "Incidents by type, severity, and status" },
  { key: "VITALS_TRENDS", label: "Vitals Trends", description: "Aggregate vital signs trends across residents" },
  { key: "CARE_PLANS", label: "Care Plan Status", description: "Active, draft, and completed care plans" },
  { key: "MEDICATIONS", label: "Medication Adherence", description: "MAR compliance and refusal rates" },
  { key: "COMPLIANCE", label: "Compliance Report", description: "Overall facility compliance metrics" },
];

export default function ClinicalReports() {
  const [selectedReport, setSelectedReport] = useState<ReportType | null>(null);
  const [dateFrom, setDateFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);

  const { data: resQ, loading: resLoading } = useLiveQuery("residents", { tables: ["Resident"] });
  const { data: incQ } = useLiveQuery("incidents", { query: "take=1000", tables: ["Incident"] });
  const { data: vitQ } = useLiveQuery("vitals", { query: "take=1000", tables: ["Vital"] });
  const { data: planQ } = useLiveQuery("care-plans", { query: "take=200", tables: ["CarePlan"] });
  const { data: marQ } = useLiveQuery("medication-administrations", { query: "take=1000", tables: ["MedicationAdministration"] });
  const { data: evacQ } = useLiveQuery("eliminations", { query: "take=500", tables: ["EliminationLog"] });

  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);

  const generateReport = () => {
    if (!selectedReport) return null;
    const from = new Date(dateFrom);
    const to = new Date(dateTo);

    switch (selectedReport) {
      case "ADMISSIONS": {
        const admitted = residents.filter((r: any) => {
          const d = r.admissionDate ? new Date(r.admissionDate) : null;
          return d && d >= from && d <= to;
        });
        return { title: "Admissions Report", count: admitted.length, data: admitted.map((r: any) => ({ name: r.name, room: r.room, date: r.admissionDate })) };
      }
      case "INCIDENTS": {
        const filtered = (incQ || []).filter((i: any) => {
          const d = i.incidentDate ? new Date(i.incidentDate) : null;
          return d && d >= from && d <= to;
        });
        const bySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
        const byStatus = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0 };
        filtered.forEach((i: any) => { if (bySeverity[i.severity as keyof typeof bySeverity] !== undefined) bySeverity[i.severity as keyof typeof bySeverity]++; if (byStatus[i.status as keyof typeof byStatus] !== undefined) byStatus[i.status as keyof typeof byStatus]++; });
        return { title: "Incident Summary", count: filtered.length, bySeverity, byStatus };
      }
      case "CARE_PLANS": {
        const byStatus = { DRAFT: 0, ACTIVE: 0, COMPLETED: 0, UNDER_REVIEW: 0, DISCONTINUED: 0 };
        (planQ || []).forEach((p: any) => { if (byStatus[p.status as keyof typeof byStatus] !== undefined) byStatus[p.status as keyof typeof byStatus]++; });
        return { title: "Care Plan Status", total: (planQ || []).length, byStatus };
      }
      case "MEDICATIONS": {
        const filtered = (marQ || []).filter((m: any) => {
          const d = m.administeredAt ? new Date(m.administeredAt) : null;
          return d && d >= from && d <= to;
        });
        const byStatus = { ADMINISTERED: 0, REFUSED: 0, HELD: 0, SCHEDULED: 0 };
        filtered.forEach((m: any) => { if (byStatus[m.marStatus as keyof typeof byStatus] !== undefined) byStatus[m.marStatus as keyof typeof byStatus]++; });
        const total = filtered.length;
        const adherence = total > 0 ? Math.round((byStatus.ADMINISTERED / total) * 100) : 0;
        return { title: "Medication Adherence", total, adherence, byStatus };
      }
      default:
        return { title: selectedReport, count: 0, data: [] };
    }
  };

  const report = generateReport();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-yellow-500" /> Clinical Reports</h2>
        <p className="text-sm text-gray-500">Generate analytics and compliance reports</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {REPORT_TYPES.map(rt => (
          <button key={rt.key} onClick={() => setSelectedReport(rt.key)}
            className={`p-4 rounded-xl border-2 text-left transition cursor-pointer ${selectedReport === rt.key ? "border-yellow-400 bg-yellow-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
            <h3 className="font-semibold text-gray-900 text-sm">{rt.label}</h3>
            <p className="text-xs text-gray-500 mt-1">{rt.description}</p>
          </button>
        ))}
      </div>

      {selectedReport && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
            </div>
          </div>

          {report && (
            <div className="space-y-4 pt-4 border-t border-gray-100">
              <h3 className="font-bold text-gray-900">{report.title}</h3>
              {"count" in report && <p className="text-3xl font-bold text-yellow-600">{report.count} <span className="text-sm font-medium text-gray-500">records</span></p>}

              {"bySeverity" in report && report.bySeverity && (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {Object.entries(report.bySeverity).map(([k, v]) => (
                    <div key={k} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">{k}</p>
                      <p className="text-xl font-bold text-gray-900">{String(v)}</p>
                    </div>
                  ))}
                </div>
              )}

              {"byStatus" in report && report.byStatus && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {Object.entries(report.byStatus).map(([k, v]) => (
                    <div key={k} className="bg-gray-50 rounded-lg p-3 text-center">
                      <p className="text-xs text-gray-500">{k.replace(/_/g, " ")}</p>
                      <p className="text-xl font-bold text-gray-900">{String(v)}</p>
                    </div>
                  ))}
                </div>
              )}

              {"adherence" in report && (
                <div className="bg-green-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-green-700 font-medium">Medication Adherence Rate</p>
                  <p className="text-4xl font-bold text-green-600">{report.adherence}%</p>
                </div>
              )}

              {"total" in report && "byStatus" in report && !("adherence" in report) && (
                <div className="bg-blue-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-blue-700 font-medium">Total Records</p>
                  <p className="text-4xl font-bold text-blue-600">{report.total}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
