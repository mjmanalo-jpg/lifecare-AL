"use client";

/**
 * Private Caregivers (tab `privatecare`, Nurse + Care Manager) — assign a dedicated
 * 1:1 caregiver to a resident. The request is sent to the family sponsor for
 * approval (with the cost) before it goes ACTIVE and bills. Migration-free:
 * app-setting `private_caregiver_assignments` (see lib/privateCaregiver).
 * Phase 1: assign + list + end. Family approval + billing + caregiver view follow.
 */

import { useMemo, useState } from "react";
import { HeartHandshake, Plus, UserRound, CalendarClock, Ban, AlertTriangle, ShieldCheck } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord, createRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, StatCard, DataState,
  FieldLabel, controlClass, SERIF,
} from "./clinical-ui";
import {
  PRIVATE_CARE_KEY, parsePrivateCare, RATE_UNIT_LABEL, PRIVATE_CARE_STATUS_META,
  monthlyEquivalent, pcgAntiDoubleCharge, pcgReviewOverdue,
  PCG_INTENSITY_META, PCG_INTENSITY_ORDER, PCG_RULE_REFS,
  type PrivateCareAssignment, type RateUnit, type PcgIntensity,
} from "@/lib/privateCaregiver";

type Row = Record<string, unknown>;
type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `pcg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

type ResOpt = { id: string; name: string; room: string; sponsorId: string; sponsorName: string };

export default function PrivateCaregiverBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const { data: settingRows, refetch, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const resQ = useLiveQuery<Row>("residents", { query: "include=sponsor", tables: ["Resident", "User"] });
  const staffQ = useLiveQuery<StaffRow>("staff", { query: "include=user&take=300", tables: ["Staff"] });

  const assignments = useMemo(() => parsePrivateCare(settingRows.find((r) => (r.key || r.id) === PRIVATE_CARE_KEY)?.value), [settingRows]);
  const residents = useMemo<ResOpt[]>(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const sp = (raw.sponsor ?? null) as { id?: unknown; name?: unknown } | null;
    return { id: String(a.id), name: String(a.name), room: String(a.room ?? ""), sponsorId: sp?.id ? String(sp.id) : "", sponsorName: sp?.name ? String(sp.name) : "" };
  }), [resQ.data]);
  const caregivers = useMemo(() => (staffQ.data || []).filter((st) => st.user?.role === "CAREGIVER").map((st) => ({ id: s(st.id), userId: s(st.userId), name: s(st.user?.name) || "Caregiver" })), [staffQ.data]);

  const [assignOpen, setAssignOpen] = useState(false);

  const save = async (next: PrivateCareAssignment[]) => {
    await upsertRecord("app-settings", PRIVATE_CARE_KEY, { key: PRIVATE_CARE_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  const createAssignment = async (a: Omit<PrivateCareAssignment, "id" | "status" | "requestedBy" | "requestedAt">) => {
    const nowIso = new Date().toISOString();
    const rec: PrivateCareAssignment = { ...a, id: newId(), status: "PENDING_FAMILY", requestedBy: clinicianName, requestedAt: nowIso, authorisedBy: clinicianName, authorisedAt: nowIso };
    await save([rec, ...assignments]);
    setAssignOpen(false);
    // Notify the assigned caregiver that they've been assigned this resident.
    const cgUserId = caregivers.find((c) => c.id === rec.caregiverId)?.userId;
    if (cgUserId) {
      createRecord("notifications", {
        userId: cgUserId,
        type: "TASK_ASSIGNMENT",
        title: "Private caregiver assignment",
        message: `You've been assigned as ${rec.residentName}'s private (1:1) caregiver — ${rec.schedule}. Pending family approval.`,
        relatedEntityType: "task",
        severity: "INFO",
      }).catch(() => null);
    }
    // Route the request to the family sponsor — it surfaces in their
    // "Requests & Approvals" board (and notification bell) for approval.
    if (rec.sponsorId) {
      createRecord("notifications", {
        userId: rec.sponsorId,
        type: "TASK_ASSIGNMENT",
        title: "Private caregiver — approval needed",
        message: `A dedicated 1:1 caregiver (${rec.caregiverName}) was requested for ${rec.residentName} at ₱${Number(rec.rate).toLocaleString()} ${RATE_UNIT_LABEL[rec.rateUnit]}. Review and approve or decline in Requests & Approvals.`,
        relatedEntityType: "approval",
        severity: "WARNING",
      }).catch(() => null);
    }
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Sent for family approval · family & caregiver notified", showConfirmButton: false, timer: 2200 });
  };

  const endAssignment = async (a: PrivateCareAssignment) => {
    const res = await Swal.fire({ title: "End private caregiver?", html: `End <b>${a.caregiverName}</b>'s dedicated care for <b>${a.residentName}</b>? This stops the recurring charge.`, icon: "warning", showCancelButton: true, confirmButtonText: "End assignment", confirmButtonColor: "#dc2626" });
    if (!res.isConfirmed) return;
    await save(assignments.map((x) => (x.id === a.id ? { ...x, status: "ENDED", endDate: new Date().toISOString() } : x)));
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Assignment ended", showConfirmButton: false, timer: 1600 });
  };

  const stats = {
    active: assignments.filter((a) => a.status === "ACTIVE").length,
    pending: assignments.filter((a) => a.status === "PENDING_FAMILY").length,
    ended: assignments.filter((a) => a.status === "ENDED").length,
    monthly: assignments.filter((a) => a.status === "ACTIVE").reduce((sum, a) => sum + monthlyEquivalent(a), 0),
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Private Caregivers"
        subtitle="Assign a dedicated 1:1 caregiver — the family approves the cost before it goes active and bills."
        right={<ClinicalButton onClick={() => setAssignOpen(true)}><Plus className="h-4 w-4" /> Assign Private Caregiver</ClinicalButton>}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={stats.active} label="Active" accent="ink" />
        <StatCard value={stats.pending} label="Pending family" accent={stats.pending > 0 ? "amber" : "ink"} />
        <StatCard value={stats.ended} label="Ended" accent="ink" />
        <StatCard value={peso(stats.monthly)} label="Active billing / mo" accent="ink" />
      </div>

      <div className="mt-5">
        <DataState loading={loading && assignments.length === 0} error={null} empty={assignments.length === 0} emptyTitle="No private caregivers yet" emptyHint="Assign a dedicated caregiver to a resident — the request goes to their family for approval.">
          <div className="space-y-3">
            {assignments.map((a) => {
              const meta = PRIVATE_CARE_STATUS_META[a.status];
              const intensity = (a.intensity ?? "none") as PcgIntensity;
              const im = PCG_INTENSITY_META[intensity];
              const overdue = pcgReviewOverdue(a);
              const guard = pcgAntiDoubleCharge(a);
              return (
                <div key={a.id} className="rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: overdue ? "var(--clinical-amber)" : "var(--clinical-line)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{a.residentName}{a.room ? ` · Room ${a.room}` : ""}</p>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${im.mandatory ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-600"}`}>{im.label} · {im.ruleId}</span>
                        {overdue && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> Review overdue</span>}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--clinical-ink-soft)]"><UserRound className="h-4 w-4 text-[var(--clinical-panel)]" /> {a.caregiverName} <span className="text-[var(--clinical-muted)]">· {a.schedule}</span></p>
                      <p className="mt-1 text-sm font-semibold text-[var(--clinical-ink)]">{peso(a.rate)} <span className="font-normal text-[var(--clinical-muted)]">{RATE_UNIT_LABEL[a.rateUnit]}</span></p>
                      {a.rationale ? <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]"><span className="font-semibold">Rationale:</span> {a.rationale}</p> : null}
                      {guard.overlaps && !guard.allowed ? <p className="mt-1 flex items-start gap-1 text-xs text-[var(--clinical-coral)]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {guard.reason}</p> : null}
                      {guard.overlaps && a.incrementalConfirmed ? <p className="mt-1 flex items-start gap-1 text-xs text-[var(--clinical-muted)]"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> Reviewer confirmed incremental dedicated staffing only (PCG-011).</p> : null}
                      {a.sponsorName ? <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">Billed to family sponsor: {a.sponsorName}</p> : <p className="mt-0.5 text-xs text-[var(--clinical-amber)]">No family sponsor on file — approval/billing needs one</p>}
                      <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">Requested by {a.requestedBy} · {fmtDate(a.requestedAt)}{a.reviewDate ? ` · Review by ${fmtDate(a.reviewDate)}` : ""}{a.status === "ACTIVE" && a.startDate ? ` · Active since ${fmtDate(a.startDate)}` : ""}{a.status === "ENDED" && a.endDate ? ` · Ended ${fmtDate(a.endDate)}` : ""}{a.status === "DECLINED" && a.declineReason ? ` · Declined: ${a.declineReason}` : ""}</p>
                    </div>
                    {(a.status === "ACTIVE" || a.status === "PENDING_FAMILY") && (
                      <button onClick={() => endAssignment(a)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"><Ban className="h-3.5 w-3.5" /> End</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DataState>
      </div>

      {assignOpen && <AssignModal residents={residents} caregivers={caregivers} onClose={() => setAssignOpen(false)} onCreate={createAssignment} />}
    </ClinicalPage>
  );
}

function AssignModal({ residents, caregivers, onClose, onCreate }: {
  residents: ResOpt[];
  caregivers: { id: string; name: string }[];
  onClose: () => void;
  onCreate: (a: Omit<PrivateCareAssignment, "id" | "status" | "requestedBy" | "requestedAt">) => Promise<void>;
}) {
  const [residentId, setResidentId] = useState("");
  const [caregiverId, setCaregiverId] = useState("");
  const [schedule, setSchedule] = useState("");
  const [rate, setRate] = useState("");
  const [rateUnit, setRateUnit] = useState<RateUnit>("month");
  const [notes, setNotes] = useState("");
  const [intensity, setIntensity] = useState<PcgIntensity>("none");
  const [rationale, setRationale] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [incrementalConfirmed, setIncrementalConfirmed] = useState(false);
  const [expectedDurationDays, setExpectedDurationDays] = useState("");
  const [exitCriteria, setExitCriteria] = useState("");
  const [busy, setBusy] = useState(false);

  const resident = residents.find((r) => r.id === residentId);
  const caregiver = caregivers.find((c) => c.id === caregiverId);
  const amount = Number(rate) || 0;
  const im = PCG_INTENSITY_META[intensity];
  const mandatory = im.mandatory;
  const isTemporary = intensity === "temporary";
  // Live anti-double-charge preview (BR-013.05 / PCG-011).
  const guard = pcgAntiDoubleCharge({ rationale, intensity, incrementalConfirmed });

  const submit = async () => {
    if (!residentId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return; }
    if (!caregiverId) { Swal.fire({ title: "Select a caregiver", icon: "warning" }); return; }
    if (!schedule.trim()) { Swal.fire({ title: "Enter a schedule", text: "e.g. Day shift · 8h/day", icon: "warning" }); return; }
    if (!(amount > 0)) { Swal.fire({ title: "Enter a valid rate", icon: "warning" }); return; }
    if (mandatory && !rationale.trim()) { Swal.fire({ title: "Rationale required", text: `A mandatory PCG (${im.ruleId}) needs a documented reason why shared 1:6 staffing is insufficient.`, icon: "warning" }); return; }
    if (mandatory && !reviewDate) { Swal.fire({ title: "Review date required", text: "A mandatory PCG needs a review date (PCG-002/004/011).", icon: "warning" }); return; }
    if (isTemporary && (!expectedDurationDays.trim() || !exitCriteria.trim())) { Swal.fire({ title: "Temporary PCG details required", text: "PCG-005: temporary intensity needs an expected duration + exit criteria.", icon: "warning" }); return; }
    if (!guard.allowed) { Swal.fire({ title: "Confirm incremental staffing", text: guard.reason, icon: "warning" }); return; }
    setBusy(true);
    try {
      await onCreate({
        residentId, residentName: resident?.name || "", room: resident?.room || undefined,
        sponsorId: resident?.sponsorId || undefined, sponsorName: resident?.sponsorName || undefined,
        caregiverId, caregiverName: caregiver?.name || "",
        schedule: schedule.trim(), rate: amount, rateUnit, notes: notes.trim() || undefined,
        intensity, rationale: rationale.trim() || undefined, reviewDate: reviewDate || undefined,
        incrementalConfirmed: guard.overlaps ? incrementalConfirmed : undefined,
        expectedDurationDays: isTemporary ? Number(expectedDurationDays) || undefined : undefined,
        exitCriteria: isTemporary ? exitCriteria.trim() || undefined : undefined,
      });
    } finally { setBusy(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title="Assign Private Caregiver"
      description="A 1:1 dedicated caregiver — the family approves the cost before it activates."
      size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton onClick={submit} disabled={busy}><HeartHandshake className="h-4 w-4" /> {busy ? "Sending…" : "Send for family approval"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel>Resident</FieldLabel>
          <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={controlClass}>
            <option value="">Select resident…</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Rm ${r.room}` : ""}</option>)}
          </select>
          {resident && (resident.sponsorName
            ? <p className="mt-1 text-xs text-[var(--clinical-muted)]">Family sponsor (payer): <b>{resident.sponsorName}</b></p>
            : <p className="mt-1 text-xs text-[var(--clinical-amber)]">This resident has no family sponsor on file — approval &amp; billing need one.</p>)}
        </div>
        <div>
          <FieldLabel>Caregiver</FieldLabel>
          <select value={caregiverId} onChange={(e) => setCaregiverId(e.target.value)} className={controlClass}>
            <option value="">Select caregiver…</option>
            {caregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {caregivers.length === 0 && <p className="mt-1 text-xs text-[var(--clinical-muted)]">No caregivers found for this community.</p>}
        </div>
        <div>
          <FieldLabel>Schedule</FieldLabel>
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder="e.g. Day shift · 8h/day" className={controlClass} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Rate (₱)</FieldLabel>
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={controlClass} />
          </div>
          <div>
            <FieldLabel>Cadence</FieldLabel>
            <select value={rateUnit} onChange={(e) => setRateUnit(e.target.value as RateUnit)} className={controlClass}>
              <option value="month">Per month</option>
              <option value="day">Per day</option>
            </select>
          </div>
        </div>
        <div>
          <FieldLabel>Dedicated-staffing intensity <span className="font-normal text-[var(--clinical-muted)]">(DT-013 / PCG rule)</span></FieldLabel>
          <select value={intensity} onChange={(e) => setIntensity(e.target.value as PcgIntensity)} className={controlClass}>
            {PCG_INTENSITY_ORDER.map((k) => <option key={k} value={k}>{PCG_INTENSITY_META[k].label} — {PCG_INTENSITY_META[k].ruleId}</option>)}
          </select>
          <p className="mt-1 text-xs text-[var(--clinical-muted)]">{im.hint}</p>
        </div>

        <div>
          <FieldLabel required={mandatory}>Rationale <span className="font-normal text-[var(--clinical-muted)]">(why shared 1:6 staffing is insufficient)</span></FieldLabel>
          <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Trigger → intervention → frequency/duration → shared-staffing insufficiency → alternatives attempted" className={controlClass} />
        </div>

        {guard.overlaps && (
          <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-amber)" }}>
            <p className="flex items-start gap-1.5 text-xs font-semibold text-[var(--clinical-amber)]"><AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" /> Anti-double-charge check (BR-013.05 / PCG-011)</p>
            <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]">This rationale references care that may already be in the resident&apos;s LOC package ({guard.matchedTerms.join(", ")}). A PCG fee is permitted only for <b>incremental</b> dedicated staffing.</p>
            <label className="mt-2 flex items-start gap-2 text-xs font-medium text-[var(--clinical-ink)]">
              <input type="checkbox" checked={incrementalConfirmed} onChange={(e) => setIncrementalConfirmed(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--clinical-line-strong)]" />
              I confirm this fee is for <b>incremental dedicated staffing only</b>, not care already covered by the LOC package.
            </label>
          </div>
        )}

        {mandatory && (
          <div>
            <FieldLabel required>Review date <span className="font-normal text-[var(--clinical-muted)]">(mandatory review-date gate)</span></FieldLabel>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className={controlClass} />
          </div>
        )}

        {isTemporary && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel required>Expected duration (days)</FieldLabel>
              <input inputMode="numeric" value={expectedDurationDays} onChange={(e) => setExpectedDurationDays(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 14" className={controlClass} />
            </div>
            <div>
              <FieldLabel required>Exit criteria</FieldLabel>
              <input value={exitCriteria} onChange={(e) => setExitCriteria(e.target.value)} placeholder="e.g. mobility restored to baseline" className={controlClass} />
            </div>
          </div>
        )}

        <div className="rounded-xl border px-4 py-2.5 text-[11px] text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
          <span className="font-semibold text-[var(--clinical-ink-soft)]">PCG rule references:</span> {PCG_RULE_REFS.map((r) => `${r.id} ${r.label}`).join(" · ")}
        </div>

        <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1.5 font-medium text-[var(--clinical-ink-soft)]"><CalendarClock className="h-4 w-4" /> Charge on approval</span>
            <span className="text-lg font-extrabold text-[var(--clinical-panel)]">{peso(amount)} <span className="text-xs font-medium text-[var(--clinical-muted)]">{RATE_UNIT_LABEL[rateUnit]}</span></span>
          </div>
        </div>
        <div>
          <FieldLabel>Notes <span className="font-normal text-[var(--clinical-muted)]">(optional)</span></FieldLabel>
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={controlClass} />
        </div>
      </div>
    </ClinicalModal>
  );
}
