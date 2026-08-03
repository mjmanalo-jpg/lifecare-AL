"use client";

import { useMemo, useState } from "react";
import {
  FileText, Download, Calendar, RefreshCw, Search, Eye,
  AlertTriangle, Users, CreditCard, Activity, type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend, AreaChart, Area,
} from "recharts";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptIncident, adaptResident, adaptStaff, humanize } from "@/lib/adapters";

type Incident = ReturnType<typeof adaptIncident>;
type Staff = ReturnType<typeof adaptStaff>;
type Resident = ReturnType<typeof adaptResident>;

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#ec4899", "#06b6d4", "#84cc16"];
const CARE_COLORS: Record<string, string> = { INDEPENDENT: "#22c55e", ASSISTED: "#3b82f6", MEMORY: "#a855f7", SKILLED: "#ef4444" };

const TABS = [
  { key: "incidents", label: "Incidents", icon: AlertTriangle },
  { key: "staff", label: "Staff", icon: Users },
  { key: "residents", label: "Residents", icon: Activity },
  { key: "billing", label: "Billing", icon: CreditCard },
];

export default function FacilityReports() {
  const { data: incidentRows } = useLiveQuery<Record<string, unknown>>(
    "incidents", { query: "include=resident&take=500", tables: ["Incident"] }
  );
  const { data: staffRows } = useLiveQuery<Record<string, unknown>>(
    "staff", { query: "include=user&take=200", tables: ["Staff", "User"] }
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>(
    "residents", { query: "include=incidents&take=300", tables: ["Resident", "Incident"] }
  );
  const { data: invoiceRows } = useLiveQuery<Record<string, unknown>>(
    "invoices", { query: "include=resident&take=500", tables: ["Invoice", "Resident"] }
  );

  const incidents = useMemo<Incident[]>(() => incidentRows.map(adaptIncident), [incidentRows]);
  const staff = useMemo<Staff[]>(() => staffRows.map(adaptStaff), [staffRows]);
  const residents = useMemo<Resident[]>(() => residentRows.map(adaptResident), [residentRows]);
  const invoices = useMemo(() => invoiceRows as Array<Record<string, unknown>>, [invoiceRows]);

  const [reportType, setReportType] = useState("incidents");
  const [dateRange, setDateRange] = useState("30");
  const [search, setSearch] = useState("");

  const [now] = useState(() => Date.now());
  const rangeMs = Number(dateRange) * 86400 * 1000;

  const filteredIncidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents.filter(i => {
      const t = new Date(i.timestamp).getTime();
      if (now - t > rangeMs) return false;
      if (q && !i.type.toLowerCase().includes(q) && !i.resident.toLowerCase().includes(q) && !i.room.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [incidents, rangeMs, search]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    return staff.filter(s => {
      if (q && !s.name.toLowerCase().includes(q) && !s.department.toLowerCase().includes(q) && !s.position.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [staff, search]);

  const filteredResidents = useMemo(() => {
    const q = search.trim().toLowerCase();
    return residents.filter(r => {
      if (q && !r.name.toLowerCase().includes(q) && !r.room.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [residents, search]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return invoices.filter((inv: any) => {
      const name = inv.resident ? `${inv.resident.firstName ?? ""} ${inv.resident.lastName ?? ""}`.toLowerCase() : "";
      if (q && !name.includes(q) && !(inv.invoiceNumber ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [invoices, search]);

  const exportCSV = () => {
    let csv = "";
    let filename = "";

    if (reportType === "incidents") {
      csv = "Type,Severity,Resident,Room,Date,Status,Description\n";
      filteredIncidents.forEach(i => { csv += `${i.type},${i.severity},"${i.resident}","${i.room}","${new Date(i.timestamp).toLocaleDateString()}",${i.status},"${i.description}"\n`; });
      filename = "incident_report.csv";
    } else if (reportType === "staff") {
      csv = "Name,Position,Department,Email,Status,Approved\n";
      filteredStaff.forEach(s => { csv += `"${s.name}","${s.position}","${s.department}","${s.email}",${s.active},${s.approved}\n`; });
      filename = "staff_report.csv";
    } else if (reportType === "residents") {
      csv = "Name,Room,Care Level,Age,Gender,Admission Date\n";
      filteredResidents.forEach(r => {
        const raw = r.raw;
        csv += `"${r.name}","${r.room}",${r.careLevel},${r.age ?? ""},${raw.gender ?? ""},${raw.admissionDate ? new Date(raw.admissionDate).toLocaleDateString() : ""}\n`;
      });
      filename = "residents_report.csv";
    } else if (reportType === "billing") {
      csv = "Invoice,Resident,Amount,Paid,Balance,Status,Due Date\n";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filteredInvoices.forEach((inv: any) => {
        const name = inv.resident ? `${inv.resident.firstName ?? ""} ${inv.resident.lastName ?? ""}` : "";
        const total = inv.totalAmount ?? 0;
        const paid = inv.amountPaid ?? 0;
        csv += `${inv.invoiceNumber ?? ""},"${name}",${total},${paid},${total - paid},${inv.status ?? ""},${inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : ""}\n`;
      });
      filename = "billing_report.csv";
    }

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
    Swal.fire({ title: "Exported", text: `${filename} downloaded.`, icon: "success", timer: 1500, showConfirmButton: false });
  };

  const currentTab = TABS.find(t => t.key === reportType) || TABS[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Reports & Analytics
          </h1>
          <p className="text-gray-600">Generate, filter, and export facility reports with real-time data</p>
        </div>
        <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Tabs + Filters */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setReportType(t.key); setSearch(""); }}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium whitespace-nowrap transition ${reportType === t.key ? "bg-yellow-400 text-black shadow-sm" : "text-gray-600 hover:text-gray-900"}`}>
              <t.icon className="w-4 h-4" /> {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <select value={dateRange} onChange={e => setDateRange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 outline-none bg-white">
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
            <option value="999999">All time</option>
          </select>
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input type="text" placeholder={`Search ${currentTab.label.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none" />
        </div>
      </div>

      {/* ── Incidents Report ── */}
      {reportType === "incidents" && <IncidentsReport incidents={filteredIncidents} search={search} />}

      {/* ── Staff Report ── */}
      {reportType === "staff" && <StaffReport staff={filteredStaff} search={search} />}

      {/* ── Residents Report ── */}
      {reportType === "residents" && <ResidentsReport residents={filteredResidents} search={search} />}

      {/* ── Billing Report ── */}
      {reportType === "billing" && <BillingReport invoices={filteredInvoices} search={search} />}
    </div>
  );
}

/* ── Tab: Incidents ── */

function IncidentsReport({ incidents, search: _s }: { incidents: Incident[]; search: string }) {
  const stats = useMemo(() => ({
    total: incidents.length,
    open: incidents.filter(i => !i.resolved).length,
    critical: incidents.filter(i => i.severity === "critical" || i.severity === "high").length,
    resolved: incidents.filter(i => i.resolved).length,
  }), [incidents]);

  const byType = useMemo(() => {
    const m = new Map<string, number>();
    incidents.forEach(i => m.set(i.type, (m.get(i.type) || 0) + 1));
    return Array.from(m.entries()).map(([n, v]) => ({ name: n, value: v }));
  }, [incidents]);

  const bySeverity = useMemo(() => {
    const m = new Map<string, number>();
    incidents.forEach(i => m.set(i.severity, (m.get(i.severity) || 0) + 1));
    return Array.from(m.entries()).map(([n, v]) => ({ name: n, value: v }));
  }, [incidents]);

  const timeline = useMemo(() => {
    const m = new Map<string, number>();
    incidents.forEach(i => {
      const d = new Date(i.timestamp).toLocaleDateString();
      m.set(d, (m.get(d) || 0) + 1);
    });
    return Array.from(m.entries()).map(([n, c]) => ({ name: n, count: c }));
  }, [incidents]);

  const [page, setPage] = useState(1);
  const pp = 10;
  const totalPages = Math.max(1, Math.ceil(incidents.length / pp));
  const start = (page - 1) * pp;
  const paginated = incidents.slice(start, start + pp);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatBox label="Total Incidents" value={String(stats.total)} icon={AlertTriangle} color="blue" />
        <StatBox label="Open" value={String(stats.open)} icon={AlertTriangle} color="amber" />
        <StatBox label="Critical/High" value={String(stats.critical)} icon={AlertTriangle} color="red" />
        <StatBox label="Resolved" value={String(stats.resolved)} icon={AlertTriangle} color="green" />
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4">
        <ChartCard title="Incidents by Type" icon={FileText}>
          {byType.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byType} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} width={24} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="value" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
        <ChartCard title="Severity Distribution" icon={AlertTriangle}>
          {bySeverity.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={bySeverity} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {bySeverity.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
      </div>

      {timeline.length > 0 && (
        <ChartCard title="Incident Timeline" icon={Calendar}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timeline} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs><linearGradient id="tlFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} width={24} />
              <Tooltip />
              <Area type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={2} fill="url(#tlFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      {/* Data Table */}
      {paginated.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-sm text-gray-700">Incident Records</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Type</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Resident</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Severity</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Status</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Date</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(i => (
                  <tr key={i.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{i.type}</td>
                    <td className="px-4 py-2.5 text-gray-600">{i.resident}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${SEV_BADGE[i.severity] || "bg-gray-100 text-gray-700"}`}>{i.severity.toUpperCase()}</span></td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${i.resolved ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{i.resolved ? "Resolved" : "Open"}</span></td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{i.timestamp ? new Date(i.timestamp).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {incidents.length > pp && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <span className="text-gray-500">{incidents.length} total</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Prev</button>
                <span className="px-2 py-1 text-gray-700 text-xs">Page {page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Tab: Staff ── */

function StaffReport({ staff, search: _s }: { staff: Staff[]; search: string }) {
  const stats = useMemo(() => ({
    total: staff.length,
    active: staff.filter(s => s.active === "Active").length,
    inactive: staff.filter(s => s.active === "Inactive").length,
    approved: staff.filter(s => s.approved === "Approved").length,
    disapproved: staff.filter(s => s.approved === "Disapproved").length,
    depts: new Set(staff.map(s => s.department)).size,
  }), [staff]);

  const byDept = useMemo(() => {
    const m = new Map<string, number>();
    staff.forEach(s => m.set(s.department, (m.get(s.department) || 0) + 1));
    return Array.from(m.entries()).map(([n, v]) => ({ name: n, value: v }));
  }, [staff]);

  const byStatus = useMemo(() => ([
    { name: "Active", value: stats.active, color: "#22c55e" },
    { name: "Inactive", value: stats.inactive, color: "#ef4444" },
  ].filter(d => d.value > 0)), [stats]);

  const byApproval = useMemo(() => ([
    { name: "Approved", value: stats.approved, color: "#22c55e" },
    { name: "Disapproved", value: stats.disapproved, color: "#f97316" },
  ].filter(d => d.value > 0)), [stats]);

  const [page, setPage] = useState(1);
  const pp = 10;
  const totalPages = Math.max(1, Math.ceil(staff.length / pp));
  const start = (page - 1) * pp;
  const paginated = staff.slice(start, start + pp);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Staff" value={String(stats.total)} icon={Users} color="blue" />
        <StatBox label="Active" value={String(stats.active)} icon={Users} color="green" />
        <StatBox label="Inactive" value={String(stats.inactive)} icon={Users} color="red" />
        <StatBox label="Approved" value={String(stats.approved)} icon={Users} color="green" />
        <StatBox label="Disapproved" value={String(stats.disapproved)} icon={Users} color="amber" />
        <StatBox label="Departments" value={String(stats.depts)} icon={Users} color="purple" />
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-4">
        <ChartCard title="Staff by Department" icon={Users}>
          {byDept.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={byDept} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={10} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} width={24} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
        <ChartCard title="Active Status" icon={Users}>
          {byStatus.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} label>
                  {byStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
        <ChartCard title="Approval Status" icon={Users}>
          {byApproval.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byApproval} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} label>
                  {byApproval.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
      </div>

      {paginated.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-sm text-gray-700">Staff Records</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Name</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Position</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Department</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Status</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Approved</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{s.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{s.position}</td>
                    <td className="px-4 py-2.5 text-gray-600">{s.department}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${s.active === "Active" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{s.active}</span></td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${s.approved === "Approved" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{s.approved}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {staff.length > pp && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <span className="text-gray-500">{staff.length} total</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Prev</button>
                <span className="px-2 py-1 text-gray-700 text-xs">Page {page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Tab: Residents ── */

function ResidentsReport({ residents, search: _s }: { residents: Resident[]; search: string }) {
  const [page, setPage] = useState(1);
  const pp = 10;
  const totalPages = Math.max(1, Math.ceil(residents.length / pp));
  const start = (page - 1) * pp;
  const paginated = residents.slice(start, start + pp);

  const stats = useMemo(() => ({
    total: residents.length,
    independent: residents.filter(r => r.careLevel === "INDEPENDENT").length,
    assisted: residents.filter(r => r.careLevel === "ASSISTED").length,
    memory: residents.filter(r => r.careLevel === "MEMORY").length,
    skilled: residents.filter(r => r.careLevel === "SKILLED").length,
  }), [residents]);

  const careData = useMemo(() => {
    const order = ["INDEPENDENT", "ASSISTED", "MEMORY", "SKILLED"];
    return order.map(l => ({ name: humanize(l), value: residents.filter(r => r.careLevel === l).length, color: CARE_COLORS[l] || "#6b7280" })).filter(d => d.value > 0);
  }, [residents]);

  const ageGroups = useMemo(() => {
    const groups = { "Under 60": 0, "60-69": 0, "70-79": 0, "80-89": 0, "90+": 0 };
    residents.forEach(r => {
      if (r.age == null) return;
      if (r.age < 60) groups["Under 60"]++;
      else if (r.age < 70) groups["60-69"]++;
      else if (r.age < 80) groups["70-79"]++;
      else if (r.age < 90) groups["80-89"]++;
      else groups["90+"]++;
    });
    return Object.entries(groups).map(([name, value]) => ({ name, value }));
  }, [residents]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatBox label="Total Residents" value={String(stats.total)} icon={Activity} color="blue" />
        <StatBox label="Independent" value={String(stats.independent)} icon={Activity} color="green" />
        <StatBox label="Assisted" value={String(stats.assisted)} icon={Activity} color="blue" />
        <StatBox label="Memory Care" value={String(stats.memory)} icon={Activity} color="purple" />
        <StatBox label="Skilled" value={String(stats.skilled)} icon={Activity} color="red" />
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4">
        <ChartCard title="Care Level Distribution" icon={Activity}>
          {careData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={careData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {careData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
        <ChartCard title="Age Distribution" icon={Activity}>
          {ageGroups.some(g => g.value > 0) ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={ageGroups} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} axisLine={false} width={24} />
                <Tooltip cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No age data.</p>}
        </ChartCard>
      </div>

      {paginated.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-sm text-gray-700">Resident Records</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Name</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Room</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Care Level</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Age</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Gender</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {paginated.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">{r.name}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.room}</td>
                    <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${CARE_BADGE[r.careLevel] || "bg-gray-100"}`}>{humanize(r.careLevel)}</span></td>
                    <td className="px-4 py-2.5 text-gray-600">{r.age ?? "—"}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.raw.gender || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {residents.length > pp && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <span className="text-gray-500">{residents.length} total</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Prev</button>
                <span className="px-2 py-1 text-gray-700 text-xs">Page {page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Tab: Billing ── */

function BillingReport({ invoices, search: _s }: { invoices: Record<string, unknown>[]; search: string }) {
  const [page, setPage] = useState(1);
  const pp = 10;
  const totalPages = Math.max(1, Math.ceil(invoices.length / pp));
  const start = (page - 1) * pp;
  const paginated = invoices.slice(start, start + pp);

  const stats = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all = invoices as any[];
    return {
      total: all.length,
      paid: all.filter(i => i.status === "PAID").length,
      overdue: all.filter(i => i.status === "OVERDUE").length,
      pending: all.filter(i => i.status === "DRAFT" || i.status === "SENT").length,
      revenue: all.reduce((s, i) => s + (i.totalAmount ?? 0), 0),
      collected: all.filter(i => i.status === "PAID").reduce((s, i) => s + (i.totalAmount ?? 0), 0),
    };
  }, [invoices]);

  const statusDist = useMemo(() => {
    const m = new Map<string, number>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (invoices as any[]).forEach(i => m.set(i.status, (m.get(i.status) || 0) + 1));
    return Array.from(m.entries()).map(([n, v]) => ({ name: n, value: v }));
  }, [invoices]);

  const STATUS_COLORS: Record<string, string> = { PAID: "#22c55e", OVERDUE: "#ef4444", SENT: "#3b82f6", DRAFT: "#6b7280", CANCELLED: "#a855f7" };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBox label="Total Invoices" value={String(stats.total)} icon={CreditCard} color="blue" />
        <StatBox label="Paid" value={String(stats.paid)} icon={CreditCard} color="green" />
        <StatBox label="Overdue" value={String(stats.overdue)} icon={CreditCard} color="red" />
        <StatBox label="Pending" value={String(stats.pending)} icon={CreditCard} color="amber" />
        <StatBox label="Revenue" value={`₱${stats.revenue.toLocaleString()}`} icon={CreditCard} color="purple" />
        <StatBox label="Collected" value={`₱${stats.collected.toLocaleString()}`} icon={CreditCard} color="green" />
      </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4">
        <ChartCard title="Invoice Status Distribution" icon={CreditCard}>
          {statusDist.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={statusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                  {statusDist.map((d, i) => <Cell key={i} fill={STATUS_COLORS[d.name] || COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip /><Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : <p className="text-gray-500 text-center py-8">No data.</p>}
        </ChartCard>
        <ChartCard title="Financial Summary" icon={CreditCard}>
          <div className="flex flex-col justify-center h-full gap-3 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Total Revenue</span>
              <span className="text-xl font-bold text-gray-900">₱{stats.revenue.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Amount Collected</span>
              <span className="text-xl font-bold text-green-600">₱{stats.collected.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Outstanding</span>
              <span className="text-xl font-bold text-red-600">₱{(stats.revenue - stats.collected).toLocaleString()}</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div className="bg-green-500 h-2.5 rounded-full" style={{ width: `${stats.revenue > 0 ? (stats.collected / stats.revenue) * 100 : 0}%` }} />
            </div>
            <p className="text-xs text-gray-500 text-center">{stats.revenue > 0 ? Math.round((stats.collected / stats.revenue) * 100) : 0}% collection rate</p>
          </div>
        </ChartCard>
      </div>

      {paginated.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 font-semibold text-sm text-gray-700">Invoice Records</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Invoice</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Resident</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Amount</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Status</th><th className="text-left px-4 py-2.5 font-semibold text-gray-600">Due</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {paginated.map((inv: any) => {
                  const name = inv.resident ? `${inv.resident.firstName ?? ""} ${inv.resident.lastName ?? ""}` : "—";
                  return (
                    <tr key={inv.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{inv.invoiceNumber ?? "—"}</td>
                      <td className="px-4 py-2.5 text-gray-600">{name}</td>
                      <td className="px-4 py-2.5 font-semibold">₱{(inv.totalAmount ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-bold ${STATUS_BADGE[inv.status] || "bg-gray-100 text-gray-700"}`}>{inv.status}</span></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {invoices.length > pp && (
            <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between text-sm">
              <span className="text-gray-500">{invoices.length} total</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Prev</button>
                <span className="px-2 py-1 text-gray-700 text-xs">Page {page}/{totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded text-gray-600 hover:bg-gray-50 disabled:opacity-50 text-xs">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Shared Sub-components ── */

const SEV_BADGE: Record<string, string> = { critical: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700", medium: "bg-yellow-100 text-yellow-700", low: "bg-blue-100 text-blue-700" };
const CARE_BADGE: Record<string, string> = { INDEPENDENT: "bg-green-100 text-green-700", ASSISTED: "bg-blue-100 text-blue-700", MEMORY: "bg-purple-100 text-purple-700", SKILLED: "bg-red-100 text-red-700" };
const STATUS_BADGE: Record<string, string> = { PAID: "bg-green-100 text-green-700", OVERDUE: "bg-red-100 text-red-700", SENT: "bg-blue-100 text-blue-700", DRAFT: "bg-gray-100 text-gray-700", CANCELLED: "bg-purple-100 text-purple-700" };

function StatBox({ label, value, icon: Icon, color }: { label: string; value: string; icon: LucideIcon; color: string }) {
  const COLORS: Record<string, string> = {
    blue: "text-blue-600 bg-blue-50 border-blue-200",
    green: "text-green-600 bg-green-50 border-green-200",
    red: "text-red-600 bg-red-50 border-red-200",
    amber: "text-amber-600 bg-amber-50 border-amber-200",
    purple: "text-purple-600 bg-purple-50 border-purple-200",
  };
  const c = COLORS[color] || COLORS.blue;
  return (
    <div className={`rounded-lg border p-4 ${c}`}>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs font-semibold text-gray-600">{label}</p>
        <Icon className={`w-4 h-4 ${c.split(" ")[0]}`} />
      </div>
      <p className={`text-xl sm:text-2xl font-bold ${c.split(" ")[0]}`}>{value}</p>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3.5 h-3.5 text-yellow-500" />
        <h3 className="font-semibold text-gray-900 text-sm">{title}</h3>
      </div>
      {children}
    </div>
  );
}
