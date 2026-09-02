"use client";

import { useRef, useState } from "react";
import { FileText, Link2, Upload, X, Plus, ExternalLink, Camera } from "lucide-react";
import { createRecord, deleteRecord } from "@/lib/api";

// Reusable per-resident document list backed by the ResidentDocument model
// (model slug `resident-documents`). Each row's `fileUrl` is either an uploaded
// file (via /api/upload) or a pasted external/Google-Drive link — both viewable.
// `documentType` scopes the list to one card section (BELONGINGS, VACCINATION_CARD, …).

type Doc = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export default function DocumentSection({ residentId, documentType, label, canEdit, docs, onChanged, uploadedByName }: {
  residentId: string;
  documentType: string;
  label: string;
  canEdit: boolean;
  docs: Doc[];
  onChanged: () => void | Promise<void>;
  uploadedByName?: string;
}) {
  const mine = docs.filter((d) => s(d.documentType) === documentType);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setAdding(false); setTitle(""); setLink(""); if (fileRef.current) fileRef.current.value = ""; };

  const saveDoc = async (fileUrl: string, fileName: string) => {
    await createRecord("resident-documents", {
      residentId, documentType,
      title: title.trim() || fileName || "Document",
      fileUrl, fileName, uploadedByName: uploadedByName || undefined,
    });
    await onChanged();
    reset();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "resident-documents");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) throw new Error("upload failed");
      const data = await res.json();
      await saveDoc(s(data.url), s(data.name) || file.name);
    } catch { /* leave the form open so nothing is lost */ } finally { setBusy(false); }
  };

  const addLink = async () => {
    const url = link.trim();
    if (!url) return;
    setBusy(true);
    try { await saveDoc(url, title.trim() || url); } catch { /* keep open */ } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try { await deleteRecord("resident-documents", id); await onChanged(); } catch { /* noop */ } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-500"><FileText className="h-3.5 w-3.5" /> {label}</p>
        {canEdit && !adding && <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E4A48] hover:underline"><Plus className="h-3 w-3" /> Add</button>}
      </div>
      {mine.length === 0 && !adding && <p className="text-xs text-gray-400">No documents.</p>}
      {mine.length > 0 && (
        <ul className="space-y-1.5">
          {mine.map((d) => (
            <li key={s(d.id)} className="flex items-center justify-between gap-2">
              <a href={s(d.fileUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-sm text-[#2E4A48] hover:underline">
                <ExternalLink className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{s(d.title) || s(d.fileName) || "Document"}</span>
              </a>
              {canEdit && <button onClick={() => remove(s(d.id))} disabled={busy} aria-label="Remove document" className="shrink-0 text-gray-300 hover:text-red-500"><X className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <div className="mt-2 space-y-2 border-t border-gray-200 pt-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title (optional)" className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm" />
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" onChange={onUpload} disabled={busy} className="hidden" id={`doc-file-${documentType}`} />
            <label htmlFor={`doc-file-${documentType}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Upload className="h-3.5 w-3.5" /> Upload file</label>
            {/* Take photo — opens the device camera on mobile; falls back to the
                file picker on desktop. Reuses the same upload handler. */}
            <input type="file" accept="image/*" capture="environment" onChange={onUpload} disabled={busy} className="hidden" id={`doc-photo-${documentType}`} />
            <label htmlFor={`doc-photo-${documentType}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"><Camera className="h-3.5 w-3.5" /> Take photo</label>
            <span className="text-[11px] text-gray-400">or</span>
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste Google Drive / URL link" className="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm" />
            <button onClick={addLink} disabled={busy || !link.trim()} className="inline-flex items-center gap-1 rounded-md bg-[#2E4A48] px-2.5 py-1 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"><Link2 className="h-3.5 w-3.5" /> Add link</button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={reset} className="text-xs font-medium text-gray-500 hover:text-gray-700">Cancel</button>
            {busy && <span className="text-[11px] text-gray-400">Working…</span>}
          </div>
        </div>
      )}
    </div>
  );
}
