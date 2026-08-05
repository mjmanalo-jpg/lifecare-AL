"use client";

import { useMemo, useState } from "react";
import { IdCard, Save, Loader2, ScanLine } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord } from "@/lib/api";
import IntakeBodyCheck from "./IntakeBodyCheck";
import {
  type IntakeData,
  EMPTY_INTAKE,
  INTAKE_CATEGORY,
  parseIntake,
  patientCode,
  resolveIntakeStatus,
  INTAKE_STATUS_META,
} from "@/lib/patientId";

interface Props {
  residentId: string;
  /** Community code used to prefix the derived Patient ID (cosmetic). */
  communityCode?: string | null;
  /** Name stamped as examiner when marks are first recorded. */
  examinerName?: string;
  /** Viewers (family/resident) get a read-only record. */
  readOnly?: boolean;
}

type NoteRow = { id: string; content: string; authorName?: string | null };

/**
 * Resident-profile panel: shows the derived Patient ID and the intake / move-in
 * body-check record, loading & persisting it as the resident's INTAKE_BODY_MAP
 * ResidentNote. Staff can complete or update it at physical move-in.
 */
export default function IntakeBodyCheckPanel({ residentId, communityCode, examinerName, readOnly }: Props) {
  const { data: notes, loading, refetch } = useLiveQuery<NoteRow>("resident-notes", {
    query: `f_residentId=${residentId}&f_category=${INTAKE_CATEGORY}`,
    tables: ["ResidentNote"],
    enabled: Boolean(residentId),
  });

  const existing = notes[0];
  const serverData = useMemo<IntakeData>(() => (existing ? parseIntake(existing.content) : { ...EMPTY_INTAKE }), [existing]);
  const [draft, setDraft] = useState<IntakeData | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? serverData;
  const dirty = draft !== null;
  const pid = patientCode(residentId, communityCode);
  const statusMeta = INTAKE_STATUS_META[resolveIntakeStatus(value)];

  const save = async () => {
    setSaving(true);
    try {
      const payload: IntakeData = { ...value, status: resolveIntakeStatus(value), examinedAt: value.examinedAt ?? new Date().toISOString() };
      const content = JSON.stringify(payload);
      if (existing) {
        await updateRecord("resident-notes", existing.id, { content, authorName: payload.examinedBy || existing.authorName || undefined });
      } else {
        await createRecord("resident-notes", { residentId, category: INTAKE_CATEGORY, title: "Intake Body Check", isPinned: true, authorName: payload.examinedBy || examinerName || "", content });
      }
      setDraft(null);
      await refetch();
      Swal.fire({ title: "Intake saved", icon: "success", timer: 1400, showConfirmButton: false });
    } catch (err) {
      Swal.fire({ title: "Save failed", text: err instanceof Error ? err.message : "Could not save intake record.", icon: "error" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      {/* Patient identity */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-sm font-bold tracking-wide text-gray-800">
            <IdCard className="w-4 h-4 text-blue-600" /> {pid}
          </span>
          <span className="text-xs text-gray-500">Patient ID</span>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${statusMeta.badge}`}>{statusMeta.label}</span>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800 mb-3">
          <ScanLine className="w-4 h-4 text-blue-600" /> Intake / Move-in Body Check
        </h4>

        {loading && !existing ? (
          <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
        ) : (
          <IntakeBodyCheck value={value} onChange={setDraft} readOnly={readOnly} examinerName={examinerName} />
        )}
      </div>

      {!readOnly && dirty && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
          <button onClick={() => setDraft(null)} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save intake
          </button>
        </div>
      )}
    </div>
  );
}
