"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Upload, PenLine, ShieldCheck, Loader2, Download, FileSignature } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord } from "@/lib/api";
import SignatureModal from "@/components/portal/SignatureModal";
import { CONSENT_FORMS_KEY, DEFAULT_FORMS, parseConsentForms, type ConsentForm } from "@/lib/consentForms";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Family Portal — complete move-in tasks: upload files and e-sign consent
 *  documents from home. Writes to the resident's document record (scoped to the
 *  family's own resident). */
export default function FamilyDocuments() {
  const { data: residents } = useLiveQuery<Row>("residents", { query: "take=5", tables: ["Resident"] });
  const resident = residents[0] || null;
  const residentId = resident ? s(resident.id) : "";
  const residentName = resident ? `${s(resident.firstName)} ${s(resident.lastName)}`.trim() : "";

  const { data: docs, refetch } = useLiveQuery<Row>("resident-documents", { query: residentId ? `f_residentId=${residentId}&take=200` : "take=0", tables: ["ResidentDocument"], enabled: !!residentId });

  const [me, setMe] = useState("");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => setMe(d?.session?.name || d?.workspaces?.user?.name || "Family")).catch(() => {}); }, []);

  // Forms are configured by the Care Manager (Consent & Move-in Forms); fall
  // back to the default set until they've customised them.
  const { data: settingRows } = useLiveQuery<Row>("app-settings", { tables: ["AppSetting"] });
  const forms = useMemo(() => {
    const cfg = parseConsentForms(s(settingRows.find((r) => (r.key || r.id) === CONSENT_FORMS_KEY)?.value));
    return cfg.length ? cfg : DEFAULT_FORMS;
  }, [settingRows]);

  const [uploading, setUploading] = useState(false);
  const [signForm, setSignForm] = useState<ConsentForm | null>(null);

  const { signed, files } = useMemo(() => {
    const signed = docs.filter((d) => s(d.documentType) === "E_SIGNATURE");
    const files = docs.filter((d) => s(d.documentType) !== "E_SIGNATURE");
    return { signed, files };
  }, [docs]);

  const upload = async (file: File) => {
    if (!residentId) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "resident-documents");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error || "Upload failed");
      await createRecord("resident-documents", { residentId, documentType: "FAMILY_UPLOAD", title: json.name || file.name, fileName: json.name || file.name, fileUrl: json.url, uploadedByName: me });
      await refetch();
      Swal.fire({ title: "Uploaded", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ title: "Upload failed", text: e instanceof Error ? e.message : "Try again", icon: "error" });
    } finally { setUploading(false); }
  };

  const doSign = async () => {
    if (!residentId || !signForm) return;
    const iso = new Date().toISOString();
    await createRecord("resident-documents", {
      residentId, documentType: "E_SIGNATURE", title: `Signed — ${signForm.name}`, uploadedByName: me,
      fileUrl: signForm.fileUrl || null, fileName: signForm.fileName || null,
      fileContent: JSON.stringify({ form: signForm.name, resident: residentName, signedBy: me, signedAt: iso }),
    });
    await refetch();
    Swal.fire({ title: "Signed", text: `${signForm.name} e-signed and stored.`, icon: "success", timer: 1800, showConfirmButton: false });
    setSignForm(null);
  };

  const isSigned = (form: string) => signed.some((d) => s(d.title) === `Signed — ${form}`);

  if (!resident) return <div className="p-8 text-center text-gray-500">Loading your resident’s record…</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileSignature className="w-7 h-7 text-blue-600" /> Documents &amp; Signatures</h1>
        <p className="text-gray-500 text-sm">Complete move-in tasks for <b>{residentName}</b> — e-sign forms and upload files from home.</p>
      </div>

      {/* E-sign forms */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-3"><PenLine className="w-5 h-5 text-blue-600" /> Forms to sign</h3>
        <div className="space-y-2">
          {forms.map((form) => {
            const done = isSigned(form.name);
            return (
              <div key={form.id} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{form.name}</p>
                  {form.description && <p className="text-xs text-gray-500">{form.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {form.fileUrl && <a href={form.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"><FileText className="w-3.5 h-3.5" /> View</a>}
                  {done ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-green-700"><ShieldCheck className="w-4 h-4" /> Signed</span>
                  ) : (
                    <button onClick={() => setSignForm(form)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"><PenLine className="w-4 h-4" /> E-sign</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-400">Signing uses your personal 4-digit signing PIN (Account settings) — a secure, attributable e-signature.</p>
      </section>

      {/* Upload */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-bold text-gray-900 flex items-center gap-2 mb-3"><Upload className="w-5 h-5 text-blue-600" /> Upload files</h3>
        <label className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-dashed border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Choose a file (ID, insurance, records…)
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
      </section>

      {/* Stored documents */}
      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="font-bold text-gray-900 mb-3">Stored documents ({docs.length})</h3>
        {docs.length === 0 ? <p className="text-sm text-gray-400">Nothing yet.</p> : (
          <div className="space-y-2">
            {signed.map((d) => (
              <div key={s(d.id)} className="flex items-center justify-between gap-2 rounded-lg border border-green-200 bg-green-50 p-3">
                <span className="text-sm text-gray-800 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-green-600" /> {s(d.title)}</span>
                <span className="text-xs text-gray-500">{d.createdAt ? new Date(s(d.createdAt)).toLocaleDateString() : ""} · {s(d.uploadedByName)}</span>
              </div>
            ))}
            {files.map((d) => (
              <div key={s(d.id)} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 p-3">
                <span className="text-sm text-gray-800 flex items-center gap-2 min-w-0"><FileText className="w-4 h-4 text-gray-400" /> <span className="truncate">{s(d.title) || s(d.fileName)}</span></span>
                {d.fileUrl && <a href={s(d.fileUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-xs inline-flex items-center gap-1 shrink-0"><Download className="w-3.5 h-3.5" /> Open</a>}
              </div>
            ))}
          </div>
        )}
      </section>

      <SignatureModal open={!!signForm} onClose={() => setSignForm(null)} onSigned={doSign} title={`Sign — ${signForm?.name ?? ""}`} description={`Enter your 4-digit signing PIN to e-sign "${signForm?.name ?? ""}" for ${residentName}.`} />
    </div>
  );
}
