"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "@/lib/swal";
import { CheckCircle2, Clock, ShieldCheck, XCircle, RefreshCw, ArrowRight, Inbox } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { LOC_SIGNOFF_KEY, parseLocSignoffs, applyLocSignoff, canFinalizeLoc, type LocSignoff } from "@/lib/lifecare/locSignoff";
import { ASSESSMENTS_V42_KEY, type AssessmentV42 } from "@/lib/lifecare/assessment";
import { ClinicalCard, ClinicalButton, StatusPill, StatCard, DataState, SERIF } from "./clinical-ui";

/**
 * Pending Approval — the family sign-off queue for Level-of-Care changes. Shows
 * changes awaiting the family, changes the family approved (ready for a nurse/CM
 * to finalize & apply), and recently decided ones with the family sign-off on the
 * record. Backed by the `loc_signoffs` app-setting (see lib/lifecare/locSignoff).
 */

const s = (v: unknown) => (v == null ? "" : String(v));
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
const lvlN = (v?: string) => (v || "").replace(/^L/i, "");
const parseAssessments = (raw?: string | null): AssessmentV42[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export default function LocSignoffApprovals({ clinicianRole = "NURSE" }: { clinicianRole?: string }) {
  const roleLabel = clinicianRole === "CARE_MANAGER" || clinicianRole === "FACILITY_ADMIN" ? "Care Manager" : clinicianRole === "SUPERADMIN" ? "Superadmin" : "Nurse";
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const signoffs = useMemo(() => parseLocSignoffs(settingRows.find((r) => (r.key || r.id) === LOC_SIGNOFF_KEY)?.value), [settingRows]);
  const assessments = useMemo(() => parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value), [settingRows]);

  const [me, setMe] = useState("");
  useEffect(() => { fetch("/api/auth/session").then((r) => r.json()).then((d) => { if (d?.authenticated) setMe(d.session?.name ?? ""); }).catch(() => {}); }, []);
  const [actingId, setActingId] = useState("");

  const pendingFamily = useMemo(() => signoffs.filter((x) => x.status === "PENDING_FAMILY"), [signoffs]);
  const ready = useMemo(() => signoffs.filter((x) => x.status === "FAMILY_APPROVED"), [signoffs]);
  const decided = useMemo(() => signoffs.filter((x) => x.status === "APPLIED" || x.status === "REJECTED").sort((a, b) => s(b.appliedAt || b.familyDecidedAt).localeCompare(s(a.appliedAt || a.familyDecidedAt))), [signoffs]);
  const canFin = canFinalizeLoc(clinicianRole);

  const persist = useCallback(async (next: LocSignoff[]) => { await upsertRecord("app-settings", LOC_SIGNOFF_KEY, { key: LOC_SIGNOFF_KEY, value: JSON.stringify(next) }); await refetch(); }, [refetch]);

  const finalize = async (sg: LocSignoff) => {
    if (!canFin) { Swal.fire({ icon: "warning", title: "Not permitted", text: "Only a nurse, Care Manager, or Superadmin can finalize a level-of-care change." }); return; }
    const c = await Swal.fire({ title: "Finalize level-of-care change?", text: `The family signed off. This applies Level ${lvlN(sg.newLevel)}, updates billing, and generates a draft care plan for family sign-off.`, icon: "question", showCancelButton: true, confirmButtonColor: "#4F46E5", confirmButtonText: "Finalize & apply" });
    if (!c.isConfirmed) return;
    setActingId(sg.id);
    try {
      const assessment = assessments.find((a) => a.id === sg.assessmentId) ?? null;
      await applyLocSignoff(sg, assessment, me || roleLabel, roleLabel);
      await persist(signoffs.map((x) => (x.id === sg.id ? { ...x, status: "APPLIED" as const, appliedByName: me || roleLabel, appliedAt: new Date().toISOString() } : x)));
      Swal.fire({ icon: "success", title: "Level of care applied", html: "The new level is active and billing is updated. A <b>draft care plan</b> was generated — it now goes to the family for sign-off before it reaches caregivers.", timer: 3600, showConfirmButton: false });
    } catch (e) { Swal.fire("Couldn't finalize", e instanceof Error ? e.message : "Please try again.", "error"); }
    finally { setActingId(""); }
  };

  const LevelArrow = ({ sg }: { sg: LocSignoff }) => (
    <div className="flex shrink-0 items-center gap-2">
      <span className="rounded-lg px-2.5 py-1 text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-muted)" }}>Level {lvlN(sg.oldLevel) || "?"}</span>
      <ArrowRight className="h-4 w-4 text-[var(--clinical-muted)]" />
      <span className="rounded-lg px-2.5 py-1 text-sm font-bold text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>Level {lvlN(sg.newLevel) || "?"}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Awaiting Family" value={pendingFamily.length} accent="amber" />
        <StatCard label="Ready to Finalize" value={ready.length} accent="teal" />
        <StatCard label="Applied" value={signoffs.filter((x) => x.status === "APPLIED").length} accent="green" />
        <StatCard label="Rejected" value={signoffs.filter((x) => x.status === "REJECTED").length} accent="coral" />
      </div>

      <DataState loading={loading && signoffs.length === 0} error={error} empty={signoffs.length === 0}
        emptyTitle="No level-of-care changes" emptyHint="When a reassessment changes a resident's level, it appears here for family sign-off and finalization." onRetry={() => void refetch()} skeletonRows={3}>

        {ready.length > 0 && (
          <ClinicalCard top="green" className="p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}><ShieldCheck className="h-4 w-4" style={{ color: "var(--clinical-green)" }} /> Family-approved — ready to finalize</p>
            <div className="space-y-2">
              {ready.map((sg) => (
                <div key={sg.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[var(--clinical-ink)]">{s(sg.residentName) || "Resident"}</p>
                      <LevelArrow sg={sg} />
                    </div>
                    <p className="mt-1 text-xs font-medium" style={{ color: "var(--clinical-green)" }}>Family signed off — {sg.familyDecidedByName || "Family"} · {fmt(sg.familyDecidedAt)}</p>
                    {sg.justification && <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{sg.justification}</p>}
                  </div>
                  <ClinicalButton variant="primary" size="sm" className="shrink-0 max-sm:w-full" disabled={actingId === sg.id || !canFin} title={!canFin ? "Nurse / Care Manager / Superadmin only" : undefined} onClick={() => void finalize(sg)}>
                    {actingId === sg.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Finalize &amp; apply
                  </ClinicalButton>
                </div>
              ))}
            </div>
          </ClinicalCard>
        )}

        {pendingFamily.length > 0 && (
          <ClinicalCard className="mt-4 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}><Clock className="h-4 w-4" style={{ color: "var(--clinical-amber)" }} /> Awaiting family sign-off</p>
            <div className="space-y-2">
              {pendingFamily.map((sg) => (
                <div key={sg.id} className="flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[var(--clinical-ink)]">{s(sg.residentName) || "Resident"}</p>
                      <LevelArrow sg={sg} />
                      <StatusPill status="PENDING">Awaiting family</StatusPill>
                    </div>
                    <p className="mt-1 text-xs text-[var(--clinical-muted)]">{sg.sponsorId ? "Sent to the family sponsor for sign-off." : "No family linked — a nurse/CM can finalize directly."}{sg.submittedByName ? ` · Reassessed by ${sg.submittedByName}` : ""}{sg.createdAt ? ` · ${fmt(sg.createdAt)}` : ""}</p>
                  </div>
                  {!sg.sponsorId && (
                    <ClinicalButton variant="primary" size="sm" className="shrink-0 max-sm:w-full" disabled={actingId === sg.id || !canFin} onClick={() => void finalize(sg)}>
                      {actingId === sg.id ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Finalize &amp; apply
                    </ClinicalButton>
                  )}
                </div>
              ))}
            </div>
          </ClinicalCard>
        )}

        {decided.length > 0 && (
          <ClinicalCard className="mt-4 p-4">
            <p className="mb-3 text-sm font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Recent decisions</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b text-left text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}><th className="px-3 py-2 font-semibold">Resident</th><th className="px-3 py-2 font-semibold">Change</th><th className="px-3 py-2 font-semibold">Family sign-off</th><th className="px-3 py-2 font-semibold">Finalized</th><th className="px-3 py-2 font-semibold">Status</th></tr></thead>
                <tbody>
                  {decided.slice(0, 20).map((sg) => (
                    <tr key={sg.id} className="border-b last:border-0" style={{ borderColor: "var(--clinical-line)" }}>
                      <td className="px-3 py-2.5 font-semibold text-[var(--clinical-ink)]">{s(sg.residentName) || "Resident"}</td>
                      <td className="px-3 py-2.5 text-[var(--clinical-ink-soft)]">Level {lvlN(sg.oldLevel)} → {lvlN(sg.newLevel)}</td>
                      <td className="px-3 py-2.5 text-[var(--clinical-ink-soft)]">{sg.familyDecidedByName || "—"}{sg.familyDecidedAt ? ` · ${fmt(sg.familyDecidedAt)}` : ""}{sg.status === "REJECTED" && sg.familyRejectReason ? ` · "${sg.familyRejectReason}"` : ""}</td>
                      <td className="px-3 py-2.5 text-[var(--clinical-ink-soft)]">{sg.appliedByName ? `${sg.appliedByName} · ${fmt(sg.appliedAt)}` : "—"}</td>
                      <td className="px-3 py-2.5">{sg.status === "APPLIED" ? <StatusPill status="COMPLETED">Applied</StatusPill> : <StatusPill status="REFUSED">Rejected</StatusPill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ClinicalCard>
        )}
      </DataState>
    </div>
  );
}
