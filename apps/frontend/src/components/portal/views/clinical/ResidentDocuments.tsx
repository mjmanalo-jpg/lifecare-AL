"use client";
import { useMemo, useState } from "react";
import { FileText, Plus, X, Trash2, Search, Download, Eye, Upload, Loader2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { createRecord, deleteRecord } from "@/lib/api";

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-400 focus:border-transparent outline-none text-sm";
const labelCls = "block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1";
const typeColors: Record<string, string> = {
  ADMISSION: "bg-blue-100 text-blue-700",
  INSURANCE: "bg-green-100 text-green-700",
  LEGAL: "bg-purple-100 text-purple-700",
  MEDICAL: "bg-red-100 text-red-700",
  CONSENT: "bg-yellow-100 text-yellow-700",
  ADVANCE_DIRECTIVE: "bg-orange-100 text-orange-700",
  DISCHARGE: "bg-gray-100 text-gray-700",
  OTHER: "bg-gray-100 text-gray-600",
};

export default function ResidentDocuments() {
  const { data: docRows, loading, refetch } = useLiveQuery("resident-documents", { query: "take=500", tables: ["ResidentDocument"] });
  const { data: resQ } = useLiveQuery("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ || []).map(adaptResident), [resQ]);
  const resMap = useMemo(() => new Map(residents.map((r: any) => [r.id, r])), [residents]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const filtered = useMemo(() => {
    return (docRows || []).filter((d: any) => {
      const name = resMap.get(d.residentId)?.name || "";
      if (filter !== "ALL" && d.documentType !== filter) return false;
      if (search && !name.toLowerCase().includes(search.toLowerCase()) && !(d.title || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [docRows, filter, search, resMap]);

  const handleDelete = async (id: string) => {
    const r = await Swal.fire({ title: "Delete Document?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) { await deleteRecord("resident-documents", id); refetch(); Swal.fire("Deleted", "", "success"); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-yellow-500" /> Resident Documents</h2>
          <p className="text-sm text-gray-500">Admission papers, insurance, consent forms, advance directives</p>
        </div>
        <button onClick={() => setCreating(true)} className="w-full sm:w-auto px-4 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 flex items-center justify-center gap-1.5">
          <Plus className="w-4 h-4" /> Upload Document
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by resident or document title..." className={`${inputCls} pl-9`} />
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className={`${inputCls} sm:w-auto`}>
          <option value="ALL">All Types</option>
          {Object.keys(typeColors).map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border p-8 text-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No documents found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((doc: any) => (
            <div key={doc.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4 hover:bg-gray-50 transition">
              <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                <FileText className="w-5 h-5 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 truncate">{doc.title || "Untitled Document"}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeColors[doc.documentType] || "bg-gray-100 text-gray-600"}`}>
                    {doc.documentType?.replace(/_/g, " ") || "Other"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {resMap.get(doc.residentId)?.name || "Unknown"} &middot; {doc.uploadedAt ? new Date(doc.uploadedAt).toLocaleDateString() : "—"}
                  {doc.expiryDate && ` • Expires: ${new Date(doc.expiryDate).toLocaleDateString()}`}
                </p>
                {doc.notes && <p className="text-xs text-gray-500 mt-1 truncate">{doc.notes}</p>}
              </div>
              <div className="flex items-center gap-1">
                {doc.fileUrl && (
                  <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 text-blue-500 hover:bg-blue-50 rounded cursor-pointer">
                    <Download className="w-4 h-4" />
                  </a>
                )}
                <button onClick={() => handleDelete(doc.id)} className="p-1.5 text-red-400 hover:text-red-500 cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-yellow-500 to-amber-500 px-6 py-4 rounded-t-xl flex items-center justify-between">
              <h3 className="text-white font-bold text-lg">Upload Document</h3>
              <button onClick={() => setCreating(false)} className="text-white/80 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>
            <DocumentUploadForm residents={residents} onClose={() => setCreating(false)} onSaved={() => { refetch(); setCreating(false); }} />
          </div>
        </div>
      )}
    </div>
  );
}

function DocumentUploadForm({ residents, onClose, onSaved }: { residents: any[]; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ residentId: "", title: "", documentType: "OTHER", expiryDate: "", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const set = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.residentId || !form.title) return;
    setSaving(true);
    try {
      let fileUrl = null;
      let fileName = null;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("folder", "resident-documents");
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await res.json();
        fileUrl = data.url;
        fileName = data.name;
      }
      await createRecord("resident-documents", {
        residentId: form.residentId,
        title: form.title,
        documentType: form.documentType,
        fileUrl,
        fileName,
        expiryDate: form.expiryDate || null,
        uploadedAt: new Date().toISOString(),
        notes: form.notes || null,
      });
      onSaved();
      Swal.fire({ icon: "success", title: "Uploaded!", timer: 1500, showConfirmButton: false });
    } catch { Swal.fire("Error", "Failed", "error"); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      <div>
        <label className={labelCls}>Resident *</label>
        <select value={form.residentId} onChange={e => set("residentId", e.target.value)} className={inputCls} required>
          <option value="">Select...</option>
          {residents.map((r: any) => <option key={r.id} value={r.id}>{r.name} — Room {r.room}</option>)}
        </select>
      </div>
      <div><label className={labelCls}>Document Title *</label><input value={form.title} onChange={e => set("title", e.target.value)} className={inputCls} required placeholder="e.g., Admission Form, Power of Attorney" /></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className={labelCls}>Type</label><select value={form.documentType} onChange={e => set("documentType", e.target.value)} className={inputCls}>
          {Object.keys(typeColors).map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
        </select></div>
        <div><label className={labelCls}>Expiry Date</label><input type="date" value={form.expiryDate} onChange={e => set("expiryDate", e.target.value)} className={inputCls} /></div>
      </div>
      <div><label className={labelCls}>File</label><input type="file" onChange={e => setFile(e.target.files?.[0] || null)} className={inputCls} /></div>
      <div><label className={labelCls}>Notes</label><textarea value={form.notes} onChange={e => set("notes", e.target.value)} className={inputCls} rows={2} /></div>
      <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3 -mx-6 -mb-6 rounded-b-xl flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 cursor-pointer">Cancel</button>
        <button type="submit" disabled={saving || !form.residentId || !form.title} className="px-5 py-2 rounded-lg bg-yellow-500 text-white text-sm font-semibold hover:bg-yellow-600 disabled:opacity-50 cursor-pointer">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Upload"}
        </button>
      </div>
    </form>
  );
}
