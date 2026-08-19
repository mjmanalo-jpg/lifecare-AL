"use client";

/**
 * Care Event capture — the governed documentation a caregiver completes when
 * finishing (or varying) a care-plan task. The outcome maps to a Care Event
 * Master archetype (EV-*); on save it posts the event (which fires the escalation
 * / nurse-alert / reassessment signals server-side) and marks the task complete.
 */

import { useState } from "react";
import { CheckCircle2, ShieldAlert, Info } from "lucide-react";
import Swal from "@/lib/swal";
import { updateRecord } from "@/lib/api";
import { OUTCOMES, classifyOutcome, careTaskDoc, type Outcome } from "@/lib/lifecare/careEvents";
import { ClinicalModal, ClinicalButton, FieldLabel, controlClass } from "../clinical/clinical-ui";

export interface CareEventTaskRef {
  id: string; title: string; residentId: string; residentName?: string;
  careTaskId?: string | null; carePlanId?: string | null;
}

export default function CareEventModal({ task, actorName, onClose, onDone }: {
  task: CareEventTaskRef; actorName: string; onClose: () => void; onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<Outcome>("Completed");
  const [assistanceDelivered, setAssistance] = useState("");
  const [quantValue, setQuant] = useState("");
  const [residentResponse, setResponse] = useState("");
  const [observation, setObservation] = useState("");
  const [exceptionDetail, setExceptionDetail] = useState("");
  const [busy, setBusy] = useState(false);

  const doc = careTaskDoc(task.careTaskId);
  const cls = classifyOutcome(outcome);
  const exception = cls.isException;

  const submit = async () => {
    if (exception && !exceptionDetail.trim() && !observation.trim()) {
      Swal.fire({ title: "Detail required", text: "Describe the variance (what happened) before logging this outcome.", icon: "warning" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/care-events", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          residentId: task.residentId, taskId: task.id,
          careTaskId: task.careTaskId || undefined, carePlanId: task.carePlanId || undefined,
          outcome, assistanceDelivered: assistanceDelivered || undefined, quantValue: quantValue || undefined,
          residentResponse: residentResponse || undefined, observation: observation || undefined,
          exceptionDetail: exceptionDetail || undefined, actorName,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Could not log the care event.");
      // Mark the task complete now that its outcome is documented.
      await updateRecord("tasks", task.id, { status: "COMPLETED", completedAt: new Date().toISOString() });
      onDone();
      const msg = json.escalated
        ? "Logged · nurse alerted + escalation raised."
        : json.reviewAlertRaised
          ? "Logged · reassessment flagged to the nurse."
          : json.notified ? "Logged · nurse notified." : "Care event logged.";
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: msg, showConfirmButton: false, timer: 2200 });
    } catch (e) {
      Swal.fire({ title: "Couldn't complete", text: e instanceof Error ? e.message : "Try again.", icon: "error" });
    } finally { setBusy(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title="Document & complete"
      description={task.title}
      size="md"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="primary" onClick={submit} disabled={busy}><CheckCircle2 className="h-4 w-4" /> {busy ? "Saving…" : "Log & complete"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        {doc?.template && (
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clinical-panel)]" />
            <span className="text-[var(--clinical-ink-soft)]">{doc.template}</span>
          </div>
        )}

        <div>
          <FieldLabel htmlFor="ce-outcome">Outcome</FieldLabel>
          <select id="ce-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)} className={controlClass}>
            {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {cls.archetype && <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Governed archetype: <b>{cls.archetype}</b>{cls.linkedDecisionTree ? ` · ${cls.linkedDecisionTree}` : ""}</p>}
        </div>

        {exception && (
          <div className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 10%, transparent)" }}>
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clinical-amber)]" />
            <span className="text-[var(--clinical-ink-soft)]">{cls.immediateEscalation ? "Safety exception — this alerts the nurse and raises an escalation." : "Variance — the nurse is notified; repeated variances trigger a reassessment review."}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><FieldLabel htmlFor="ce-assist">Assistance delivered</FieldLabel><input id="ce-assist" value={assistanceDelivered} onChange={(e) => setAssistance(e.target.value)} placeholder="e.g. Min / SBA / Full" className={controlClass} /></div>
          <div><FieldLabel htmlFor="ce-quant">Value / measure</FieldLabel><input id="ce-quant" value={quantValue} onChange={(e) => setQuant(e.target.value)} placeholder="e.g. 75% intake, 200 mL" className={controlClass} /></div>
        </div>

        <div><FieldLabel htmlFor="ce-resp">Resident response</FieldLabel><input id="ce-resp" value={residentResponse} onChange={(e) => setResponse(e.target.value)} placeholder="How did the resident respond / tolerate it?" className={controlClass} /></div>

        <div><FieldLabel htmlFor="ce-obs">Observation</FieldLabel><textarea id="ce-obs" rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="Any relevant observation…" className={controlClass} /></div>

        {exception && (
          <div><FieldLabel htmlFor="ce-exc">Variance detail{exception ? " *" : ""}</FieldLabel><textarea id="ce-exc" rows={2} value={exceptionDetail} onChange={(e) => setExceptionDetail(e.target.value)} placeholder="What happened and what was done…" className={controlClass} /></div>
        )}
      </div>
    </ClinicalModal>
  );
}
