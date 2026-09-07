"use client";

/**
 * Caregiver EXCEPTION capture — the quick "one additional selection" a caregiver
 * makes when a routine task did NOT go as planned. DONE is a one-tap direct
 * completion (no modal); this modal is only opened for the EXCEPTION path.
 *
 * The caregiver picks ONE short reason; each maps to a governed Care Event
 * `Outcome` so the escalation / nurse-alert / reassessment signals still fire
 * server-side (via /api/care-events). A note is required only for "Other".
 */

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Swal from "@/lib/swal";
import { updateRecord } from "@/lib/api";
import { classifyOutcome, type Outcome } from "@/lib/lifecare/careEvents";
import { ClinicalModal, ClinicalButton, FieldLabel, controlClass } from "../clinical/clinical-ui";

export interface CareEventTaskRef {
  id: string; title: string; residentId: string; residentName?: string;
  careTaskId?: string | null; carePlanId?: string | null;
}

// Six short, caregiver-facing exception reasons → governed Outcome. Kept short so
// documenting an exception is one tap (+ a note only for "Other").
const REASONS: { label: string; outcome: Outcome; requiresNote?: boolean }[] = [
  { label: "Refused", outcome: "Refused" },
  { label: "Unable", outcome: "Unable" },
  { label: "Resident Away", outcome: "Resident Away" },
  { label: "Condition Changed", outcome: "Condition Changed" },
  { label: "Completed Differently", outcome: "Increased Assist" },
  { label: "Other", outcome: "Other", requiresNote: true },
];

/** One-line hint of what logging this reason does, from the governed classifier. */
function effectHint(outcome: Outcome): string {
  const c = classifyOutcome(outcome);
  if (c.emergencyPathway) return "Alerts the nurse and raises an emergency escalation.";
  if (c.escalationAction === "notify_nurse") return c.isVariance ? "Logged as a variance; the nurse is notified." : "The nurse is notified to review.";
  if (c.escalationAction === "plan_review") return "The nurse is notified to review the care plan.";
  if (c.isVariance) return "Logged as a variance; repeated variances flag a reassessment.";
  return "Logged for the record — no alert raised.";
}

export default function CareEventModal({ task, actorName, onClose, onDone }: {
  task: CareEventTaskRef; actorName: string; onClose: () => void; onDone: () => void;
}) {
  const [reason, setReason] = useState<typeof REASONS[number] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const needsNote = !!reason?.requiresNote;
  const canSubmit = !!reason && (!needsNote || note.trim().length >= 2);

  const submit = async () => {
    if (!reason || !canSubmit) return;
    setBusy(true);
    try {
      const res = await fetch("/api/care-events", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          residentId: task.residentId, taskId: task.id,
          careTaskId: task.careTaskId || undefined, carePlanId: task.carePlanId || undefined,
          outcome: reason.outcome, exceptionDetail: note.trim() || undefined, actorName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not log the exception.");
      // The task is documented and leaves the caregiver's active list; the true
      // (not-completed) outcome lives on the governed CareEvent, not the task row.
      await updateRecord("tasks", task.id, { status: "COMPLETED", completedAt: new Date().toISOString() });
      onDone();
      const msg = json.escalated ? "Exception logged · nurse alerted + escalation raised."
        : json.notified ? "Exception logged · nurse notified." : "Exception logged.";
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: msg, showConfirmButton: false, timer: 2200 });
    } catch (e) {
      Swal.fire({ title: "Couldn't log exception", text: e instanceof Error ? e.message : "Try again.", icon: "error" });
    } finally { setBusy(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title="Log exception"
      description={task.title}
      size="md"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="primary" onClick={submit} disabled={busy || !canSubmit}>
          <AlertTriangle className="h-4 w-4" /> {busy ? "Logging…" : "Log exception"}
        </ClinicalButton>
      </>}
    >
      <div className="space-y-3">
        <FieldLabel>What happened?</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {REASONS.map((r) => {
            const on = reason?.label === r.label;
            return (
              <button
                key={r.label}
                onClick={() => setReason(r)}
                className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${on ? "border-[var(--clinical-panel)] bg-[var(--clinical-panel)] text-white" : "border-[var(--clinical-line)] text-[var(--clinical-ink)] hover:bg-[var(--clinical-surface-2)]"}`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {reason && (
          <p className="text-[11px] text-[var(--clinical-muted)]">{effectHint(reason.outcome)}</p>
        )}

        {needsNote && (
          <div>
            <FieldLabel htmlFor="ce-note" required>Note</FieldLabel>
            <textarea id="ce-note" rows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="Briefly describe what happened…" className={controlClass} />
          </div>
        )}
      </div>
    </ClinicalModal>
  );
}
