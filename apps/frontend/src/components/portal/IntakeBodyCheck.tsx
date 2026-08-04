"use client";

import { useState } from "react";
import { Plus, Trash2, Camera, Loader2, ShieldCheck, ScanLine, ImageOff } from "lucide-react";
import {
  type IntakeData,
  type IntakeFinding,
  type FindingType,
  type BodySide,
  FINDING_TYPES,
  BODY_PARTS,
  BODY_SIDES,
  findingTypeLabel,
} from "@/lib/patientId";

interface Props {
  value: IntakeData;
  onChange: (next: IntakeData) => void;
  /** Read-only rendering (e.g. a family/viewer looking at the record). */
  readOnly?: boolean;
  /** Name to stamp as the examiner when marks are first recorded. */
  examinerName?: string;
}

const input =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";

/**
 * Intake / move-in body check. Documents identifying marks and pre-existing
 * conditions (scars, tattoos, wounds, bruises …) with body location + photo, so
 * the facility has a dated record of the resident's condition on admission.
 * Fully controlled — the parent owns the IntakeData.
 */
export default function IntakeBodyCheck({ value, onChange, readOnly, examinerName }: Props) {
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const stamp = (patch: Partial<IntakeData>): IntakeData => ({
    ...value,
    ...patch,
    examinedAt: value.examinedAt ?? new Date().toISOString(),
    examinedBy: value.examinedBy || examinerName || "",
  });

  const setNoMarks = () => onChange(stamp({ status: "NO_MARKS", findings: [] }));

  const addFinding = () => {
    const finding: IntakeFinding = {
      id: (globalThis.crypto?.randomUUID?.() ?? `f-${Date.now()}-${value.findings.length}`),
      type: "SCAR",
      bodyPart: BODY_PARTS[0],
      side: "NA",
      description: "",
    };
    onChange(stamp({ status: "MARKS_DOCUMENTED", findings: [...value.findings, finding] }));
  };

  const patchFinding = (id: string, patch: Partial<IntakeFinding>) =>
    onChange({ ...value, findings: value.findings.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

  const removeFinding = (id: string) => {
    const findings = value.findings.filter((f) => f.id !== id);
    onChange({ ...value, findings, status: findings.length ? "MARKS_DOCUMENTED" : value.status });
  };

  const uploadPhoto = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", "resident-documents");
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok && json.url) patchFinding(id, { photoUrl: String(json.url) });
    } catch {
      /* non-fatal — a finding can be saved without a photo */
    } finally {
      setUploadingId(null);
    }
  };

  const hasMarks = value.status === "MARKS_DOCUMENTED" || value.findings.length > 0;

  // ── Read-only summary ──────────────────────────────────────────────────
  if (readOnly) {
    return (
      <div className="space-y-3">
        <IntakeMeta value={value} />
        {value.status === "NO_MARKS" && value.findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-green-700">
            <ShieldCheck className="w-4 h-4" /> No identifying marks or pre-existing conditions recorded on admission.
          </p>
        ) : value.findings.length === 0 ? (
          <p className="text-sm text-gray-500">Intake body check not yet completed.</p>
        ) : (
          <ul className="space-y-2">
            {value.findings.map((f) => (
              <li key={f.id} className="flex gap-3 rounded-lg border border-gray-200 p-3 bg-white">
                {f.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.photoUrl} alt="" className="w-14 h-14 rounded-md object-cover border border-gray-200 flex-shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-md border border-dashed border-gray-300 flex items-center justify-center text-gray-300 flex-shrink-0"><ImageOff className="w-5 h-5" /></div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {findingTypeLabel(f.type)} · {f.bodyPart}{f.side !== "NA" ? ` (${f.side.toLowerCase()})` : ""}
                  </p>
                  {f.description && <p className="text-xs text-gray-600 mt-0.5">{f.description}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {value.generalNotes && <p className="text-xs text-gray-600 whitespace-pre-wrap"><b>Notes:</b> {value.generalNotes}</p>}
      </div>
    );
  }

  // ── Editable ──────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm">
        <ScanLine className="w-4 h-4 text-blue-600" />
        <span className="font-semibold text-gray-800">On-admission body check</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={setNoMarks}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition ${
            value.status === "NO_MARKS"
              ? "bg-green-600 text-white border-green-600"
              : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          <ShieldCheck className="w-4 h-4" /> No marks / all clear
        </button>
        <button
          type="button"
          onClick={() => (value.findings.length ? undefined : addFinding())}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition ${
            hasMarks ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
          }`}
        >
          <Plus className="w-4 h-4" /> Has marks / conditions — document
        </button>
      </div>

      {hasMarks && (
        <div className="space-y-3">
          {value.findings.map((f, i) => (
            <div key={f.id} className="rounded-xl border border-gray-200 p-3 bg-gray-50 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-500">Finding {i + 1}</span>
                <button type="button" onClick={() => removeFinding(f.id)} className="p-1 text-red-500 hover:bg-red-50 rounded" title="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label className="text-xs font-medium text-gray-600">Type
                  <select className={input + " mt-1"} value={f.type} onChange={(e) => patchFinding(f.id, { type: e.target.value as FindingType })}>
                    {FINDING_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Body part
                  <select className={input + " mt-1"} value={f.bodyPart} onChange={(e) => patchFinding(f.id, { bodyPart: e.target.value })}>
                    {BODY_PARTS.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
                <label className="text-xs font-medium text-gray-600">Side
                  <select className={input + " mt-1"} value={f.side} onChange={(e) => patchFinding(f.id, { side: e.target.value as BodySide })}>
                    {BODY_SIDES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </label>
              </div>
              <textarea
                className={input + " min-h-[52px]"}
                placeholder="Description — e.g. 3cm healed scar, old surgical wound, tattoo of an anchor…"
                value={f.description}
                onChange={(e) => patchFinding(f.id, { description: e.target.value })}
              />
              <div className="flex items-center gap-2">
                {f.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.photoUrl} alt="" className="w-12 h-12 rounded-md object-cover border border-gray-200" />
                ) : null}
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
                  {uploadingId === f.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
                  {f.photoUrl ? "Replace photo" : "Add photo"}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadPhoto(f.id, file); e.target.value = ""; }} />
                </label>
              </div>
            </div>
          ))}
          <button type="button" onClick={addFinding} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 w-full justify-center">
            <Plus className="w-4 h-4" /> Add another finding
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs font-medium text-gray-600">Examined by
          <input className={input + " mt-1"} value={value.examinedBy ?? ""} onChange={(e) => onChange({ ...value, examinedBy: e.target.value })} placeholder="Staff name" />
        </label>
        <label className="text-xs font-medium text-gray-600">General notes (optional)
          <input className={input + " mt-1"} value={value.generalNotes ?? ""} onChange={(e) => onChange({ ...value, generalNotes: e.target.value })} placeholder="Overall condition on arrival…" />
        </label>
      </div>
    </div>
  );
}

function IntakeMeta({ value }: { value: IntakeData }) {
  if (!value.examinedBy && !value.examinedAt) return null;
  return (
    <p className="text-xs text-gray-500">
      {value.examinedBy ? <>Examined by <b className="text-gray-700">{value.examinedBy}</b></> : null}
      {value.examinedAt ? <> · {new Date(value.examinedAt).toLocaleDateString()}</> : null}
    </p>
  );
}
