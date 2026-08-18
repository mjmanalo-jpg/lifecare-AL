"use client";

/**
 * Additional Clinical Services (DT-014, tab `additionalservices`, Nurse + Care
 * Manager) — discrete skilled services beyond a resident's LOC package (skilled
 * procedures, IV therapy, wound care, dedicated private-duty nursing, supplies,
 * transport…). Each is an ACS determination tied to an ACS rule (ACS-001..015).
 *
 * Governance (see lib/lifecare/acs):
 *   • ACS-014 anti-double-charge — never bill for care already in LOC / PCG /
 *     dedicated nursing / another package.
 *   • ACS-010 dedicated private-duty nursing is DISTINCT from a private caregiver.
 *   • ACS-015 temporary-to-recurring — a service past its review date triggers a
 *     reassessment alert instead of auto-continuing billing.
 * A charge posts only on explicit authorisation (no auto-fee). Migration-free:
 * app-setting `additional_clinical_services` (JSON array).
 */

import { useMemo, useState } from "react";
import { Stethoscope, Plus, AlertTriangle, ShieldCheck, Ban, CalendarClock, Receipt } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord, createRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, StatCard, DataState,
  FieldLabel, controlClass, SERIF,
} from "./clinical-ui";
import { ACS_RULES } from "@/lib/lifecare/dataset";
import {
  ACS_KEY, ACS_CATEGORY, acsMarker, periodTag, parseAcsDeterminations,
  acsRuleById, fromRule, acsChargeAllowed, acsReassessmentDue, ACS_STATUS_META,
  type AcsDetermination, type PackageInclusionContext,
} from "@/lib/lifecare/acs";
import {
  PRIVATE_CARE_KEY, parsePrivateCare,
} from "@/lib/privateCaregiver";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `acs-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const peso = (n: number) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

type ResOpt = { id: string; name: string; room: string };

export default function AdditionalServicesBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const { data: settingRows, refetch, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });

  const determinations = useMemo(() => parseAcsDeterminations(settingRows.find((r) => (r.key || r.id) === ACS_KEY)?.value), [settingRows]);
  const residents = useMemo<ResOpt[]>(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    return { id: String(a.id), name: String(a.name), room: String(a.room ?? "") };
  }), [resQ.data]);

  // Active PCG assignments per resident — feed the ACS-014 anti-double-charge context.
  const activePcgByResident = useMemo(() => {
    const raw = settingRows.find((r) => (r.key || r.id) === PRIVATE_CARE_KEY)?.value;
    const set = new Set<string>();
    for (const a of parsePrivateCare(raw)) if (a.status === "ACTIVE") set.add(a.residentId);
    return set;
  }, [settingRows]);

  // Active ACS-010 dedicated-nursing per resident — its own overlap dimension.
  const dedicatedNursingByResident = useMemo(() => {
    const set = new Set<string>();
    for (const d of determinations) if (d.status === "ACTIVE" && d.acsRuleId === "ACS-010") set.add(d.residentId);
    return set;
  }, [determinations]);

  const [addOpen, setAddOpen] = useState(false);

  const save = async (next: AcsDetermination[]) => {
    await upsertRecord("app-settings", ACS_KEY, { key: ACS_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  const createDetermination = async (d: Omit<AcsDetermination, "id" | "status" | "createdBy" | "createdAt">, opts: { authorise: boolean }) => {
    const nowIso = new Date().toISOString();
    const rec: AcsDetermination = {
      ...d, id: newId(), status: "ACTIVE", createdBy: clinicianName, createdAt: nowIso,
      ...(opts.authorise ? { authorisedBy: clinicianName, authorisedAt: nowIso } : {}),
    };
    await save([rec, ...determinations]);
    setAddOpen(false);

    // Post the charge ONLY on explicit authorisation + when it clears anti-double-charge.
    if (opts.authorise && rec.authorisedBy && (rec.amount ?? 0) > 0) {
      const ctx: PackageInclusionContext = {
        locIncluded: rec.includedInLoc === "Yes",
        pcgIncluded: activePcgByResident.has(rec.residentId),
        dedicatedNursingIncluded: rec.acsRuleId !== "ACS-010" && dedicatedNursingByResident.has(rec.residentId),
      };
      const verdict = acsChargeAllowed(rec, ctx);
      if (verdict.allowed) {
        const tag = periodTag(new Date());
        const marker = acsMarker(rec.id, tag);
        createRecord("service-charges", {
          residentId: rec.residentId,
          description: `Additional clinical service — ${rec.service} (${rec.acsRuleId}) for ${rec.residentName} ${marker}`,
          amount: rec.amount,
          category: ACS_CATEGORY,
          serviceDate: nowIso,
        }).catch(() => null);
        Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Authorised · charge posted", showConfirmButton: false, timer: 2200 });
        return;
      }
      Swal.fire({ title: "Charge blocked (ACS-014)", text: verdict.reason, icon: "warning" });
      return;
    }
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Determination saved", showConfirmButton: false, timer: 1800 });
  };

  const stopDetermination = async (d: AcsDetermination) => {
    const res = await Swal.fire({ title: "Stop this service?", html: `Stop <b>${d.service}</b> for <b>${d.residentName}</b>? Future billing stops.`, icon: "warning", showCancelButton: true, confirmButtonText: "Stop service", confirmButtonColor: "#dc2626" });
    if (!res.isConfirmed) return;
    await save(determinations.map((x) => (x.id === d.id ? { ...x, status: "STOPPED", stopDate: new Date().toISOString() } : x)));
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Service stopped", showConfirmButton: false, timer: 1600 });
  };

  const stats = {
    active: determinations.filter((d) => d.status === "ACTIVE").length,
    chargeable: determinations.filter((d) => d.status === "ACTIVE" && d.separateChargeAllowed).length,
    reassess: determinations.filter((d) => acsReassessmentDue(d)).length,
    stopped: determinations.filter((d) => d.status === "STOPPED").length,
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Additional Clinical Services"
        subtitle="Discrete skilled services beyond the LOC package — anti-double-charge checked, charged only on authorisation (DT-014 / ACS)."
        right={<ClinicalButton onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add Service</ClinicalButton>}
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={stats.active} label="Active" accent="ink" />
        <StatCard value={stats.chargeable} label="Chargeable" accent="ink" />
        <StatCard value={stats.reassess} label="Reassessment due" accent={stats.reassess > 0 ? "amber" : "ink"} />
        <StatCard value={stats.stopped} label="Stopped" accent="ink" />
      </div>

      <div className="mt-5">
        <DataState loading={loading && determinations.length === 0} error={null} empty={determinations.length === 0} emptyTitle="No additional services yet" emptyHint="Add a discrete skilled service — the anti-double-charge check runs before any fee posts.">
          <div className="space-y-3">
            {determinations.map((d) => {
              const meta = ACS_STATUS_META[d.status];
              const reassess = acsReassessmentDue(d);
              const rule = acsRuleById(d.acsRuleId);
              return (
                <div key={d.id} className="rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: reassess ? "var(--clinical-amber)" : "var(--clinical-line)" }}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{d.residentName}{d.room ? ` · Room ${d.room}` : ""}</p>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.cls}`}>{meta.label}</span>
                        <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">{d.acsRuleId}</span>
                        {reassess && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700"><AlertTriangle className="h-3 w-3" /> Reassessment due</span>}
                      </div>
                      <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--clinical-ink-soft)]"><Stethoscope className="h-4 w-4 text-[var(--clinical-panel)]" /> {d.service}</p>
                      <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]">Included in LOC: <b>{d.includedInLoc}</b> · Separate charge {d.separateChargeAllowed ? "allowed" : "not allowed"}{d.amount ? ` · ${peso(d.amount)}` : ""}</p>
                      {d.rationale ? <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]"><span className="font-semibold">Rationale:</span> {d.rationale}</p> : null}
                      {d.authorisedBy ? <p className="mt-1 flex items-center gap-1 text-xs text-[var(--clinical-muted)]"><ShieldCheck className="h-3.5 w-3.5" /> Authorised by {d.authorisedBy} · charge posted</p> : <p className="mt-1 text-xs text-[var(--clinical-amber)]">Not yet authorised — no charge posted</p>}
                      {reassess && rule ? <p className="mt-1 text-xs text-[var(--clinical-amber)]">ACS-015: {rule.reassessmentSafeguard}</p> : null}
                      <p className="mt-1 text-[11px] text-[var(--clinical-muted)]">{d.startDate ? `Started ${fmtDate(d.startDate)}` : `Created ${fmtDate(d.createdAt)}`}{d.reviewDate ? ` · Review by ${fmtDate(d.reviewDate)}` : ""}{d.status === "STOPPED" && d.stopDate ? ` · Stopped ${fmtDate(d.stopDate)}` : ""}</p>
                    </div>
                    {d.status === "ACTIVE" && (
                      <button onClick={() => stopDetermination(d)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50"><Ban className="h-3.5 w-3.5" /> Stop</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DataState>
      </div>

      {addOpen && <AddModal residents={residents} activePcgByResident={activePcgByResident} dedicatedNursingByResident={dedicatedNursingByResident} onClose={() => setAddOpen(false)} onCreate={createDetermination} />}
    </ClinicalPage>
  );
}

function AddModal({ residents, activePcgByResident, dedicatedNursingByResident, onClose, onCreate }: {
  residents: ResOpt[];
  activePcgByResident: Set<string>;
  dedicatedNursingByResident: Set<string>;
  onClose: () => void;
  onCreate: (d: Omit<AcsDetermination, "id" | "status" | "createdBy" | "createdAt">, opts: { authorise: boolean }) => Promise<void>;
}) {
  const [residentId, setResidentId] = useState("");
  const [acsRuleId, setAcsRuleId] = useState("");
  const [rationale, setRationale] = useState("");
  const [amount, setAmount] = useState("");
  const [startDate, setStartDate] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [locOverlap, setLocOverlap] = useState(false);
  const [busy, setBusy] = useState(false);

  const resident = residents.find((r) => r.id === residentId);
  const rule = acsRuleId ? acsRuleById(acsRuleId) : undefined;
  const filled = acsRuleId ? fromRule(acsRuleId) : null;
  const amt = Number(amount) || 0;

  // Live ACS-014 anti-double-charge verdict.
  const ctx: PackageInclusionContext = {
    locIncluded: (filled?.includedInLoc === "Yes") || locOverlap,
    pcgIncluded: residentId ? activePcgByResident.has(residentId) : false,
    dedicatedNursingIncluded: acsRuleId !== "ACS-010" && residentId ? dedicatedNursingByResident.has(residentId) : false,
  };
  const verdict = filled ? acsChargeAllowed({ acsRuleId, separateChargeAllowed: filled.separateChargeAllowed, includedInLoc: filled.includedInLoc }, ctx) : null;

  const build = (): Omit<AcsDetermination, "id" | "status" | "createdBy" | "createdAt"> | null => {
    if (!residentId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return null; }
    if (!acsRuleId || !filled) { Swal.fire({ title: "Pick an ACS rule", icon: "warning" }); return null; }
    if (!rationale.trim()) { Swal.fire({ title: "Rationale required", text: "Document the clinical indication and package comparison (ACS-014).", icon: "warning" }); return null; }
    return {
      residentId, residentName: resident?.name || "", room: resident?.room || undefined,
      acsRuleId, service: filled.service, includedInLoc: filled.includedInLoc, separateChargeAllowed: filled.separateChargeAllowed,
      rationale: rationale.trim(), startDate: startDate || undefined, reviewDate: reviewDate || undefined,
      amount: amt > 0 ? amt : undefined,
    };
  };

  const saveOnly = async () => {
    const d = build(); if (!d) return;
    setBusy(true);
    try { await onCreate(d, { authorise: false }); } finally { setBusy(false); }
  };

  const authoriseAndCharge = async () => {
    const d = build(); if (!d) return;
    if (!(amt > 0)) { Swal.fire({ title: "Enter a charge amount", text: "Authorising posts a ServiceCharge — enter the fee.", icon: "warning" }); return; }
    if (verdict && !verdict.allowed) { Swal.fire({ title: "Charge blocked (ACS-014)", text: verdict.reason, icon: "warning" }); return; }
    setBusy(true);
    try { await onCreate(d, { authorise: true }); } finally { setBusy(false); }
  };

  return (
    <ClinicalModal
      open
      onClose={onClose}
      title="Add Additional Clinical Service"
      description="Pick the ACS rule — inclusion + charge policy auto-fill. The anti-double-charge check runs before any fee posts."
      size="lg"
      footer={<>
        <ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="secondary" onClick={saveOnly} disabled={busy}>Save without charging</ClinicalButton>
        <ClinicalButton onClick={authoriseAndCharge} disabled={busy}><Receipt className="h-4 w-4" /> {busy ? "Working…" : "Authorise & charge"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        <div>
          <FieldLabel required>Resident</FieldLabel>
          <select value={residentId} onChange={(e) => setResidentId(e.target.value)} className={controlClass}>
            <option value="">Select resident…</option>
            {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` — Rm ${r.room}` : ""}</option>)}
          </select>
        </div>

        <div>
          <FieldLabel required>ACS rule / service</FieldLabel>
          <select value={acsRuleId} onChange={(e) => setAcsRuleId(e.target.value)} className={controlClass}>
            <option value="">Select ACS rule…</option>
            {ACS_RULES.map((r) => <option key={r.id} value={r.id}>{r.id} — {r.service}</option>)}
          </select>
          {rule && (
            <div className="mt-2 rounded-xl border px-4 py-3 text-xs" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: "var(--clinical-line)" }}>
              <p className="text-[var(--clinical-ink-soft)]"><span className="font-semibold">Decision rule:</span> {rule.decisionRule}</p>
              <p className="mt-1 text-[var(--clinical-muted)]">Included in LOC: <b>{filled?.includedInLoc}</b> · Separate charge: <b>{rule.separateCharge}</b></p>
              <p className="mt-1 text-[var(--clinical-muted)]"><span className="font-semibold">Reassessment safeguard:</span> {rule.reassessmentSafeguard}</p>
            </div>
          )}
        </div>

        <div>
          <FieldLabel required>Rationale / clinical indication</FieldLabel>
          <textarea rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Clinical indication, order reference, and package comparison" className={controlClass} />
        </div>

        {filled && filled.includedInLoc !== "Yes" && (
          <label className="flex items-start gap-2 text-xs font-medium text-[var(--clinical-ink)]">
            <input type="checkbox" checked={locOverlap} onChange={(e) => setLocOverlap(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-[var(--clinical-line-strong)]" />
            The same intervention/time/material is already covered by this resident&apos;s LOC package (ACS-014).
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel>Start date</FieldLabel>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={controlClass} />
          </div>
          <div>
            <FieldLabel>Review date <span className="font-normal text-[var(--clinical-muted)]">(ACS-015)</span></FieldLabel>
            <input type="date" value={reviewDate} onChange={(e) => setReviewDate(e.target.value)} className={controlClass} />
          </div>
        </div>

        <div>
          <FieldLabel>Charge amount (₱) <span className="font-normal text-[var(--clinical-muted)]">(required to authorise a fee)</span></FieldLabel>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.00" className={controlClass} />
        </div>

        {verdict && (
          <div className="rounded-xl border px-4 py-3" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: verdict.allowed ? "var(--clinical-line)" : "var(--clinical-amber)" }}>
            <p className={`flex items-start gap-1.5 text-xs font-semibold ${verdict.allowed ? "text-[var(--clinical-green)]" : "text-[var(--clinical-amber)]"}`}>
              {verdict.allowed ? <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />}
              Anti-double-charge check (ACS-014)
            </p>
            <p className="mt-1 text-xs text-[var(--clinical-ink-soft)]">{verdict.reason}</p>
            {acsRuleId === "ACS-010" && <p className="mt-1 flex items-center gap-1 text-[11px] text-[var(--clinical-muted)]"><CalendarClock className="h-3.5 w-3.5" /> Dedicated private-duty nursing is distinct from a Private Caregiver (PCG).</p>}
          </div>
        )}
      </div>
    </ClinicalModal>
  );
}
