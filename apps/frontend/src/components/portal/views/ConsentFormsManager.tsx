"use client";

import { useMemo, useState } from "react";
import { FileSignature, Plus, Trash2, Save, Upload, FileText, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { CONSENT_FORMS_KEY, DEFAULT_FORMS, parseConsentForms, newId, type ConsentForm } from "@/lib/consentForms";

type SettingRow = { id: string; key?: string; value: string };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";

/** Care Manager — configure the consent / move-in forms families e-sign, and
 *  attach a viewable PDF to each. Migration-free (app-settings). */
export default function ConsentFormsManager() {
  const { data: settingRows, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const saved = useMemo(() => parseConsentForms(settingRows.find((r) => (r.key || r.id) === CONSENT_FORMS_KEY)?.value), [settingRows]);
  const [draft, setDraft] = useState<ConsentForm[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const forms = draft ?? saved;
  const dirty = draft !== null;

  const save = async () => {
    setSaving(true);
    try {
      await upsertRecord("app-settings", CONSENT_FORMS_KEY, { key: CONSENT_FORMS_KEY, value: JSON.stringify(forms.filter((f) => f.name.trim())) });
      setDraft(null);
      await refetch();
      Swal.fire({ title: "Forms saved", text: "Families will see the updated forms to sign.", icon: "success", timer: 1600, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setSaving(false); }
  };

  const patch = (id: string, p: Partial<ConsentForm>) => setDraft(forms.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const add = () => setDraft([...forms, { id: newId(), name: "", description: "" }]);
  const remove = (id: string) => setDraft(forms.filter((f) => f.id !== id));

  const uploadPdf = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "documents");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
      patch(id, { fileUrl: String(json.url), fileName: json.name || file.name });
    } catch (e) {
      Swal.fire({ title: "Upload failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setUploadingId(null); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileSignature className="w-7 h-7 text-blue-600" /> Consent &amp; Move-in Forms</h1>
          <p className="text-gray-500 text-sm">Define the forms families e-sign during move-in and attach a viewable PDF to each.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start">
          {forms.length === 0 && !dirty && <button onClick={() => setDraft(DEFAULT_FORMS.map((f) => ({ ...f, id: newId() })))} className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"><RotateCcw className="w-4 h-4" /> Load default set</button>}
          <button onClick={add} className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"><Plus className="w-4 h-4" /> Add form</button>
          {dirty && <button onClick={() => void save()} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 inline-flex items-center gap-1.5">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save</button>}
        </div>
      </div>

      {forms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-gray-400">No forms configured. Add one or load the default set.</div>
      ) : (
        <div className="space-y-3">
          {forms.map((f) => (
            <div key={f.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-xs font-medium text-gray-600">Form name<input className={input + " mt-1"} value={f.name} onChange={(e) => patch(f.id, { name: e.target.value })} placeholder="e.g. Consent to Care" /></label>
                <label className="text-xs font-medium text-gray-600">Description (optional)<input className={input + " mt-1"} value={f.description ?? ""} onChange={(e) => patch(f.id, { description: e.target.value })} placeholder="Shown to families" /></label>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {f.fileUrl ? (
                  <a href={f.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100"><FileText className="w-4 h-4" /> {f.fileName || "View PDF"} <ExternalLink className="w-3 h-3" /></a>
                ) : <span className="text-xs text-gray-400">No document attached</span>}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                  {uploadingId === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} {f.fileUrl ? "Replace PDF" : "Attach PDF"}
                  <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPdf(f.id, file); e.target.value = ""; }} />
                </label>
                <button onClick={() => remove(f.id)} className="ml-auto p-1.5 text-red-500 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-400">Families see these under <b>Sign &amp; Upload</b>, can open the PDF, and e-sign each with their 4-digit signing PIN.</p>
    </div>
  );
}
