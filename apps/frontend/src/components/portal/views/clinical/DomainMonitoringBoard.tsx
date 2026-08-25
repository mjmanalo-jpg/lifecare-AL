"use client";

/**
 * Domain Monitoring (tab `domainmonitoring`, Nurse + Care Manager) — READ-ONLY.
 * There is no scoring here: the care team scores the 14 domains in "Document care"
 * (Daily Care Logs). This board adapts those 0–4 status logs (app-setting
 * `care_log_notes`), runs the discrepancy engine against each resident's assessment
 * baseline, surfaces who is drifting, and decides who needs a Level of Care review.
 * See lib/lifecare/domainMonitoring. Trends for the same data live in Vitals Trend.
 */

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Gauge, AlertTriangle, ExternalLink, ShieldCheck, ClipboardList } from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, StatCard, DataState, SERIF } from "./clinical-ui";
import { DOMAIN_CODES } from "@/lib/lifecare/types";
import type { DomainCode } from "@/lib/lifecare/types";
import { ASSESSMENTS_V42_KEY } from "@/lib/lifecare/assessment";
import assessmentDomains from "@/lib/lifecare/data/assessment_domains.json";
import {
  CARE_LOG_NOTES_KEY, INCIDENT_SCORE, PERSIST_DAYS,
  careLogNotesToDomainLogs, baselineFor, evaluateDomainTriggers, discrepancyDayCount,
  REASON_LABEL, type CareLogNote,
} from "@/lib/lifecare/domainMonitoring";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const today = () => new Date().toISOString().split("T")[0];

const DOMAIN_NAME: Record<string, string> = Object.fromEntries(
  (assessmentDomains as { code: string; name: string }[]).map((d) => [d.code, d.name]),
);

const parseNotes = (raw: string | undefined): CareLogNote[] => {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
};

interface DomainRow { domain: DomainCode; reasons: string[]; latestScore: number; baseline: number | null; days: number; needsReassess: boolean }
interface ResidentSummary { id: string; name: string; room: string; rows: DomainRow[]; needsReassessment: boolean }

export default function DomainMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  void useClinician(clinicianRole); // read-only; kept for parity with sibling boards
  const router = useRouter();
  const pathname = usePathname();
  const [todayStr] = useState(() => today());
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const notes = useMemo(() => parseNotes(settingRows.find((r) => (r.key || r.id) === CARE_LOG_NOTES_KEY)?.value), [settingRows]);
  const assessments = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);
  const allLogs = useMemo(() => careLogNotesToDomainLogs(notes), [notes]);

  // Per-resident discrepancy summary, straight from the daily care logs.
  const summaries = useMemo<ResidentSummary[]>(() => {
    const out: ResidentSummary[] = [];
    for (const r of residents) {
      const rid = s(r.id);
      const logs = allLogs.filter((l) => l.residentId === rid);
      if (logs.length === 0) continue;
      const baseline = baselineFor(rid, assessments);
      const triggers = evaluateDomainTriggers(rid, logs, baseline);
      if (triggers.length === 0) continue;
      const rows: DomainRow[] = triggers.map((t) => {
        const days = discrepancyDayCount(rid, logs, t.domain, baseline);
        return { domain: t.domain, reasons: t.reasons, latestScore: t.latestScore, baseline: t.baseline, days, needsReassess: days >= PERSIST_DAYS || t.latestScore >= INCIDENT_SCORE };
      }).sort((a, b) => Number(b.needsReassess) - Number(a.needsReassess) || b.latestScore - a.latestScore);
      out.push({ id: rid, name: s(r.name), room: s(r.room), rows, needsReassessment: rows.some((x) => x.needsReassess) });
    }
    return out.sort((a, b) => Number(b.needsReassessment) - Number(a.needsReassessment) || b.rows.length - a.rows.length);
  }, [residents, allLogs, assessments]);

  const scoredToday = useMemo(() => new Set(notes.filter((n) => typeof n.status === "number" && String(n.at || "").slice(0, 10) === todayStr && DOMAIN_CODES.includes(n.domain as DomainCode)).map((n) => n.residentId)).size, [notes, todayStr]);
  const needingReview = summaries.filter((x) => x.needsReassessment).length;

  const openLocReview = (residentId: string) => {
    const seg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
    router.push(`/${seg}/careacuity?resident=${encodeURIComponent(residentId)}&reason=locreview`);
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Domain Monitoring"
        subtitle="Auto-updated from the daily care logs — no scoring here. The engine flags each resident's domain discrepancies from their assessment baseline and who needs a Level of Care review."
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={summaries.length} label="Residents with discrepancies" accent={summaries.length > 0 ? "amber" : "ink"} />
        <StatCard value={needingReview} label="Need LOC review" accent={needingReview > 0 ? "coral" : "ink"} />
        <StatCard value={scoredToday} label="Residents scored today" accent="ink" />
        <StatCard value={residents.length} label="Residents" accent="ink" />
      </div>

      <div className="mt-5">
        <DataState loading={loading && notes.length === 0} error={resQ.error} empty={summaries.length === 0}
          emptyTitle="No domain discrepancies"
          emptyHint="Every resident's logged domains are within their assessment baseline. Discrepancies appear here automatically as caregivers log daily care.">
          <div className="space-y-3">
            {summaries.map((r) => (
              <div key={r.id} className="rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: r.needsReassessment ? "var(--clinical-coral)" : "var(--clinical-amber)" }}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{r.name}{r.room ? ` · Room ${r.room}` : ""}</p>
                      {r.needsReassessment
                        ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}><AlertTriangle className="h-3 w-3" /> LOC review due</span>
                        : <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-amber)" }}>Monitoring</span>}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{r.rows.length} domain{r.rows.length > 1 ? "s" : ""} drifting from baseline</p>
                  </div>
                  {r.needsReassessment && (
                    <button onClick={() => openLocReview(r.id)} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>
                      <ClipboardList className="h-3.5 w-3.5" /> Re-assess · LOC review <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {r.rows.map((d) => (
                    <div key={d.domain} className="rounded-xl border px-3 py-2" style={{ backgroundColor: "var(--clinical-surface-2)", borderColor: d.needsReassess ? "var(--clinical-coral)" : "var(--clinical-line)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-[var(--clinical-ink)]"><span className="text-[var(--clinical-muted)]">{d.domain}</span> · {DOMAIN_NAME[d.domain] || d.domain}</p>
                        <span className="shrink-0 text-xs font-bold" style={{ color: "var(--clinical-coral)" }}>{d.latestScore}{typeof d.baseline === "number" ? <span className="font-normal text-[var(--clinical-muted)]"> / base {d.baseline}</span> : null}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {d.reasons.map((rn) => <span key={rn} className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "var(--clinical-surface)", color: "var(--clinical-ink-soft)" }}><AlertTriangle className="h-3 w-3 text-[var(--clinical-amber)]" />{REASON_LABEL[rn as keyof typeof REASON_LABEL] ?? rn}</span>)}
                        {d.days >= PERSIST_DAYS && <span className="text-[10px] font-semibold text-[var(--clinical-coral)]">· {d.days} days persistent</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </DataState>

        {summaries.length > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-[var(--clinical-muted)]"><ShieldCheck className="h-3.5 w-3.5" /> Scores come from the caregivers&apos; Daily Care Logs. A domain flags when it drifts above the resident&apos;s assessment baseline; {PERSIST_DAYS}+ discrepancy days (or a severe {INCIDENT_SCORE}) recommends a Level of Care review.</p>
        )}
      </div>
    </ClinicalPage>
  );
}
