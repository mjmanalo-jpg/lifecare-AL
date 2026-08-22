"use client";
import { useMemo, useState } from "react";
import { Shield, Search, Filter, Download, Loader2, Clock, User, FileText, Stethoscope } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const actionColors: Record<string, string> = {
  CREATE: "bg-green-100 text-green-700",
  UPDATE: "bg-blue-100 text-blue-700",
  DELETE: "bg-red-100 text-red-700",
  LOGIN: "bg-purple-100 text-purple-700",
  LOGOUT: "bg-gray-100 text-gray-600",
  VIEW: "bg-gray-100 text-gray-600",
  EXPORT: "bg-yellow-100 text-yellow-700",
  APPROVE: "bg-emerald-100 text-emerald-700",
  REJECT: "bg-red-100 text-red-700",
};
const PER_PAGE = 25;

// Care/clinical activity the Care Manager is accountable for: task completions,
// MAR, daily care logs and every backing care-log sub-record, assessments, care plans,
// escalations, incidents, referrals, follow-ups, vitals, wound care, etc.
const CLINICAL_ENTITIES = new Set<string>([
  "tasks", "medication-administrations", "medication-logs", "medications",
  "daily-rounds", "round-sleep-records", "sleep-logs", "meal-records",
  "bowel-records", "urine-records", "eliminations", "mobility-logs",
  "mobility-records", "mood-records", "edema-records", "concern-records",
  "medical-notes", "pain-records", "pain-assessments", "vaccinations",
  "assessments", "acuity-scores", "care-plans", "care-plan-items",
  "escalations", "incidents", "hospital-referrals", "follow-ups",
  "physician-communications", "vitals", "vital-signs", "wound-cares",
  "shift-reports",
  // Caregiver activity recorded outside /api/db (attendance, care delivery,
  // ADL and weight all persist via app-settings / dedicated routes).
  "attendance", "care-events", "adl-logs", "weight-logs",
  // Nurse / care-manager clinical & operational actions that persist outside
  // /api/db (mostly app-settings) — logged semantically via /api/audit.
  "med-inventory", "pharmacy-inventory", "pharmacy-dispense",
  "shift-endorsements", "admissions", "staff-profiles", "caregiver-schedules",
]);

// Human-readable labels for entity slugs (used everywhere; falls back to the
// slug prettified). Keeps both the Admin firehose and the Care Manager view legible.
const ENTITY_LABELS: Record<string, string> = {
  tasks: "Task", "medication-administrations": "Medication (MAR)", "medication-logs": "Medication log",
  medications: "Medication order", "daily-rounds": "Daily round", "round-sleep-records": "Round · sleep",
  "sleep-logs": "Sleep log", "meal-records": "Round · meal", "bowel-records": "Round · bowel",
  "urine-records": "Round · urine", eliminations: "Round · elimination", "mobility-logs": "Mobility",
  "mobility-records": "Round · mobility", "mood-records": "Round · mood", "edema-records": "Round · edema",
  "concern-records": "Round · concern", "medical-notes": "Medical note", "pain-records": "Round · pain",
  "pain-assessments": "Pain assessment", vaccinations: "Vaccination", assessments: "Assessment",
  "acuity-scores": "Acuity score", "care-plans": "Care plan", "care-plan-items": "Care plan item",
  escalations: "Escalation", incidents: "Incident", "hospital-referrals": "Referral",
  "follow-ups": "Follow-up", "physician-communications": "Physician comms", vitals: "Vitals",
  "vital-signs": "Vitals", "wound-cares": "Wound care", "shift-reports": "Shift report",
  residents: "Resident", invoices: "Invoice", payments: "Payment", "app-settings": "System setting",
  attendance: "Attendance (clock in/out)", "care-events": "Care delivery", "adl-logs": "Daily living (ADL)",
  "weight-logs": "Weight check", "med-inventory": "Medication inventory", "pharmacy-inventory": "Pharmacy inventory",
  "pharmacy-dispense": "Pharmacy dispense", "shift-endorsements": "Shift endorsement", admissions: "Admission",
  "staff-profiles": "Staff profile", "caregiver-schedules": "Caregiver schedule",
};
function entityLabel(slug?: string): string {
  if (!slug) return "—";
  return ENTITY_LABELS[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Turn a raw audit row into a plain-language activity line for the Care Manager.
function describeActivity(log: any): string {
  const after = log.after || {};
  const status = typeof after.status === "string" ? after.status : null;
  const noun = entityLabel(log.entityType);
  if (log.entityType === "attendance") {
    if (log.action === "LOGIN") return "Clocked in";
    if (log.action === "LOGOUT") return "Clocked out";
  }
  if (log.entityType === "care-events") return "Care delivered";
  if (log.entityType === "adl-logs") return "Daily living (ADL) logged";
  if (log.entityType === "weight-logs") return "Weight recorded";
  if (log.entityType === "tasks") {
    if (status === "COMPLETED") return "Task completed";
    if (status) return `Task marked ${status.toLowerCase().replace(/_/g, " ")}`;
    if (log.action === "CREATE") return "Task assigned";
  }
  if ((log.entityType === "medication-administrations" || log.entityType === "medication-logs") && log.action === "CREATE") {
    return "Medication administered (MAR)";
  }
  if (log.entityType === "daily-rounds") return log.action === "CREATE" ? "Daily round recorded" : "Daily round updated";
  if (status) return `${noun} → ${status.toLowerCase().replace(/_/g, " ")}`;
  const verb = { CREATE: "recorded", UPDATE: "updated", DELETE: "removed", APPROVE: "approved", REJECT: "rejected" }[log.action as string] || log.action?.toLowerCase();
  return `${noun} ${verb}`;
}

// Resolve the resident an audit entry concerns. Two sources: a name/id stashed
// in the `after`/`before` snapshot — /api/db writes snapshot `residentId`, and
// semantic /api/audit entries carry `residentName`/`residentId`. Returns "" when
// the action isn't resident-specific (e.g. attendance, staff profiles).
function resolveResidentName(
  log: { after?: Record<string, unknown> | null; before?: Record<string, unknown> | null },
  byId: Map<string, string>,
): string {
  const after = (log.after || {}) as Record<string, unknown>;
  const before = (log.before || {}) as Record<string, unknown>;
  const name = after.residentName ?? before.residentName;
  if (typeof name === "string" && name.trim()) return name.trim();
  const rid = after.residentId ?? before.residentId;
  if (typeof rid === "string" && byId.has(rid)) return byId.get(rid) || "";
  return "";
}

export default function AuditLogViewer({ focus = "all" }: { focus?: "all" | "clinical" }) {
  const isClinical = focus === "clinical";
  const { data: auditRows, loading } = useLiveQuery("audit-logs", { query: "take=1000", tables: ["AuditLog"] });
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=500", tables: ["Resident"] });
  const residentsById = useMemo(() => {
    const m = new Map<string, string>();
    (residentRows || []).forEach((raw) => { const r = adaptResident(raw); if (r.id) m.set(String(r.id), String(r.name)); });
    return m;
  }, [residentRows]);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  // Care Manager only ever sees care/clinical activity; Admin sees everything.
  const scopedRows = useMemo(
    () => isClinical ? (auditRows || []).filter((a: any) => CLINICAL_ENTITIES.has(a.entityType)) : (auditRows || []),
    [auditRows, isClinical]
  );

  const filtered = useMemo(() => {
    return scopedRows.filter((a: any) => {
      if (actionFilter !== "ALL" && a.action !== actionFilter) return false;
      if (entityFilter !== "ALL" && a.entityType !== entityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (a.actorName || "").toLowerCase().includes(q) || entityLabel(a.entityType).toLowerCase().includes(q) || (a.entityType || "").toLowerCase().includes(q) || (a.reason || "").toLowerCase().includes(q) || describeActivity(a).toLowerCase().includes(q) || resolveResidentName(a, residentsById).toLowerCase().includes(q);
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [scopedRows, actionFilter, entityFilter, search, residentsById]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const uniqueActions = useMemo(() => [...new Set(scopedRows.map((a: any) => a.action).filter(Boolean))], [scopedRows]);
  const uniqueEntities = useMemo(() => [...new Set(scopedRows.map((a: any) => a.entityType).filter(Boolean))], [scopedRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            {isClinical ? <Stethoscope className="w-5 h-5 text-teal-500" /> : <Shield className="w-5 h-5 text-yellow-500" />}
            {isClinical ? "Care Activity Log" : "Audit Log"}
          </h2>
          <p className="text-sm text-gray-500">
            {isClinical
              ? "Task completions, MAR, daily care logs, assessments, incidents and other clinical activity"
              : "Track all system activity for compliance and governance"}
          </p>
        </div>
        <div className="text-sm text-gray-500">{filtered.length} entries</div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search user, entity, or description..." className={`${inputCls} pl-9`} />
        </div>
        <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1); }} className={`${inputCls} w-full sm:w-auto`}>
          <option value="ALL">All Actions</option>
          {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entityFilter} onChange={e => { setEntityFilter(e.target.value); setPage(1); }} className={`${inputCls} w-full sm:w-auto`}>
          <option value="ALL">{isClinical ? "All Activity" : "All Entities"}</option>
          {uniqueEntities.map(e => <option key={e} value={e}>{entityLabel(e)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No audit entries found</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Timestamp</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">User</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Action</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">{isClinical ? "Activity" : "Entity"}</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Resident</th>
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paged.map((log: any) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-gray-400" />
                          <span className="text-gray-900 font-medium">{log.actorName || "System"}</span>
                          {log.actorRole && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{log.actorRole}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${actionColors[log.action] || "bg-gray-100 text-gray-600"}`}>{log.action}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {isClinical ? (
                          <span className="font-medium text-gray-800">{describeActivity(log)}</span>
                        ) : (
                          <>{entityLabel(log.entityType)} {log.entityId && <span className="text-xs text-gray-400">({log.entityId.slice(0, 8)}...)</span>}</>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 text-sm whitespace-nowrap">
                        {resolveResidentName(log, residentsById) || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{log.reason || (isClinical ? entityLabel(log.entityType) : describeActivity(log))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-1">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 cursor-pointer">Prev</button>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-30 cursor-pointer">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
