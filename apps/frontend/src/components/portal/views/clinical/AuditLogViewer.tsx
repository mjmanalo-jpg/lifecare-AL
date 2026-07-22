"use client";
import { useMemo, useState } from "react";
import { Shield, Search, Filter, Download, Loader2, Clock, User, FileText } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";

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

export default function AuditLogViewer() {
  const { data: auditRows, loading } = useLiveQuery("audit-logs", { query: "take=1000", tables: ["AuditLog"] });
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [entityFilter, setEntityFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    return (auditRows || []).filter((a: any) => {
      if (actionFilter !== "ALL" && a.action !== actionFilter) return false;
      if (entityFilter !== "ALL" && a.entityType !== entityFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (a.actorName || "").toLowerCase().includes(q) || (a.entityType || "").toLowerCase().includes(q) || (a.reason || "").toLowerCase().includes(q);
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }, [auditRows, actionFilter, entityFilter, search]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paged = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  const uniqueActions = useMemo(() => [...new Set((auditRows || []).map((a: any) => a.action).filter(Boolean))], [auditRows]);
  const uniqueEntities = useMemo(() => [...new Set((auditRows || []).map((a: any) => a.entityType).filter(Boolean))], [auditRows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5 text-yellow-500" /> Audit Log</h2>
          <p className="text-sm text-gray-500">Track all system activity for compliance and governance</p>
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
          <option value="ALL">All Entities</option>
          {uniqueEntities.map(e => <option key={e} value={e}>{e}</option>)}
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
                    <th className="px-4 py-3 text-left font-semibold text-gray-600">Entity</th>
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
                      <td className="px-4 py-3 text-gray-700">{log.entityType || "—"} {log.entityId && <span className="text-xs text-gray-400">({log.entityId.slice(0, 8)}...)</span>}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{log.reason || "—"}</td>
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
