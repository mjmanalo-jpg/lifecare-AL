"use client";

/**
 * Domain Monitoring (tab `domainmonitoring`, Nurse + Care Manager) — per-shift
 * 0–4 scoring of the 14 scored assessment domains (AS-01..AS-14), carry-forward
 * pre-filled from the last recorded scores, each shown against the resident's
 * assessment baseline. Saving evaluates the discrepancy triggers and runs the
 * manage → persist → LOC-review case ladder. Migration-free: app-settings
 * `domain_logs` (scores) + `domain_observations` (cases). See lib/lifecare/
 * domainMonitoring. Trends for these scores render in the Vitals Trend tab.
 */

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { CalendarDays, Clock, AlertTriangle, ClipboardList, ShieldAlert, ExternalLink, Check, MessageSquarePlus, ArrowUpRight } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord, createRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, StatCard, DataState, controlClass, SERIF } from "./clinical-ui";
import { DOMAIN_CODES } from "@/lib/lifecare/types";
import type { DomainCode } from "@/lib/lifecare/types";
import { ASSESSMENTS_V42_KEY } from "@/lib/lifecare/assessment";
import assessmentDomains from "@/lib/lifecare/data/assessment_domains.json";
import {
  DOMAIN_LOGS_KEY, DOMAIN_CASES_KEY, SHIFTS, INCIDENT_SCORE,
  parseDomainLogs, parseDomainCases, baselineFor, carryForwardScores, upsertDomainLog,
  evaluateDomainTriggers, advanceCase, addManagementNote, markEscalated, markLocReviewOpened, resolveCase, findOpenCase,
  REASON_LABEL, CASE_STATUS_LABEL,
  type DomainLog, type DomainCase, type DomainScore, type Shift,
} from "@/lib/lifecare/domainMonitoring";

type Row = Record<string, unknown>;
type StaffRow = { userId?: string; user?: { role?: string } };
const s = (v: unknown) => (v == null ? "" : String(v));
const today = () => new Date().toISOString().split("T")[0];
const shiftNow = (): Shift => { const h = new Date().getHours(); return h >= 6 && h < 14 ? "AM" : h >= 14 && h < 22 ? "PM" : "NOC"; };

// Domain code → { name, anchors } from the assessment instrument (scored only).
const META: Record<string, { name: string; anchors: string[] }> = Object.fromEntries(
  (assessmentDomains as { code: string; name: string; anchors: string[] }[]).map((d) => [d.code, { name: d.name, anchors: d.anchors }]),
);
const domainName = (code: string) => META[code]?.name || code;

const SCORE_TINT = ["#16a34a", "#65a30d", "#d97706", "#ea580c", "#dc2626"]; // 0..4 green→red
const CASE_RANK: Record<string, number> = { LOC_REVIEW_DUE: 0, MANAGING: 1, OPEN: 2, RESOLVED: 3 };

export default function DomainMonitoringBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const router = useRouter();
  const pathname = usePathname();
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const staffQ = useLiveQuery<StaffRow>("staff", { query: "include=user&take=300", tables: ["Staff"] });
  const { data: settingRows, refetch, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const logs = useMemo(() => parseDomainLogs(settingRows.find((r) => (r.key || r.id) === DOMAIN_LOGS_KEY)?.value), [settingRows]);
  const cases = useMemo(() => parseDomainCases(settingRows.find((r) => (r.key || r.id) === DOMAIN_CASES_KEY)?.value), [settingRows]);
  const assessments = useMemo(() => { try { const v = JSON.parse(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } }, [settingRows]);

  const nurseCmUserIds = useMemo(() => {
    const set = new Set<string>();
    (staffQ.data || []).forEach((st) => { if ((st.user?.role === "NURSE" || st.user?.role === "CARE_MANAGER") && st.userId) set.add(s(st.userId)); });
    return [...set];
  }, [staffQ.data]);

  const [todayStr] = useState(() => today());
  const [resId, setResId] = useState("");
  const [date, setDate] = useState(() => today());
  const [shift, setShift] = useState<Shift>(() => shiftNow());
  const [edits, setEdits] = useState<Partial<Record<DomainCode, DomainScore>>>({});
  const [busy, setBusy] = useState(false);

  const resident = residents.find((r: Row) => s(r.id) === resId) || null;
  const resNameById = useMemo(() => new Map(residents.map((r: Row) => [s(r.id), s(r.name)])), [residents]);
  const resRoomById = useMemo(() => new Map(residents.map((r: Row) => [s(r.id), s(r.room)])), [residents]);

  const baseline = useMemo(() => (resId ? baselineFor(resId, assessments) : {}), [resId, assessments]);

  // Existing scores for this exact resident/date/shift, else carry-forward from the
  // resident's most recent shift. edits[] override; changing scope clears edits.
  const seeded = useMemo(() => {
    const exact = logs.find((l) => l.residentId === resId && l.date === date && l.shift === shift);
    return exact ? exact.scores : carryForwardScores(resId, logs);
  }, [logs, resId, date, shift]);
  const scoreOf = (code: DomainCode): DomainScore | undefined => edits[code] ?? seeded[code];
  const scoredCount = DOMAIN_CODES.filter((c) => scoreOf(c) != null).length;

  const changeScope = (fn: () => void) => { fn(); setEdits({}); };

  const persistLogs = async (next: DomainLog[]) => { await upsertRecord("app-settings", DOMAIN_LOGS_KEY, { key: DOMAIN_LOGS_KEY, value: JSON.stringify(next) }); };
  const persistCases = async (next: DomainCase[]) => { await upsertRecord("app-settings", DOMAIN_CASES_KEY, { key: DOMAIN_CASES_KEY, value: JSON.stringify(next) }); };

  const openLocReview = (residentId: string) => {
    const seg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
    router.push(`/${seg}/careacuity?resident=${encodeURIComponent(residentId)}&reason=locreview`);
  };

  const save = async () => {
    if (!resId) { Swal.fire({ title: "Select a resident", icon: "warning" }); return; }
    const scores: Partial<Record<DomainCode, DomainScore>> = {};
    DOMAIN_CODES.forEach((c) => { const v = scoreOf(c); if (v != null) scores[c] = v; });
    if (Object.keys(scores).length === 0) { Swal.fire({ title: "Score at least one domain", icon: "warning" }); return; }
    setBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const existing = logs.find((l) => l.residentId === resId && l.date === date && l.shift === shift);
      // Domains that already raised an incident for this resident+date (dedupe).
      const incidentedToday = new Set<DomainCode>();
      logs.filter((l) => l.residentId === resId && l.date === date).forEach((l) => (l.incidentDomains || []).forEach((d) => incidentedToday.add(d)));
      const row: DomainLog = {
        id: existing?.id || crypto.randomUUID(), residentId: resId, date, shift, scores,
        by: clinicianName, at: nowIso, notified: existing?.notified, incidentDomains: existing?.incidentDomains ? [...existing.incidentDomains] : [],
      };
      const nextLogs = upsertDomainLog(logs, row);

      // Evaluate + advance cases against the updated log set.
      const triggers = evaluateDomainTriggers(resId, nextLogs, baseline);
      let nextCases = cases.slice();
      const notify: { kind: "open" | "locreview"; domain: DomainCode }[] = [];
      const incidents: DomainCode[] = [];
      for (const t of triggers) {
        const prev = findOpenCase(nextCases, resId, t.domain);
        const prevStatus = prev?.status;
        const updated = advanceCase(prev, t, date);
        nextCases = prev ? nextCases.map((c) => (c.id === prev.id ? updated : c)) : [updated, ...nextCases];
        if (!prev) notify.push({ kind: "open", domain: t.domain });
        else if (updated.status === "LOC_REVIEW_DUE" && prevStatus !== "LOC_REVIEW_DUE") notify.push({ kind: "locreview", domain: t.domain });
        if (t.severe && t.latestScore >= INCIDENT_SCORE && !incidentedToday.has(t.domain)) incidents.push(t.domain);
      }
      row.incidentDomains = [...new Set([...(row.incidentDomains || []), ...incidents])];

      await persistLogs(upsertDomainLog(nextLogs, row));
      if (triggers.length) await persistCases(nextCases);
      await refetch();

      // Fire notifications (Nurse + CM) for newly-open / newly-LOC-due cases.
      const rname = s(resident?.name), rroom = s(resident?.room);
      for (const n of notify) {
        const title = n.kind === "locreview" ? "LOC review due — persistent discrepancy" : "Domain discrepancy flagged";
        const message = n.kind === "locreview"
          ? `${rname}${rroom ? ` (Rm ${rroom})` : ""} — ${domainName(n.domain)} has persisted despite management. Call for a Level of Care review.`
          : `${rname}${rroom ? ` (Rm ${rroom})` : ""} — ${domainName(n.domain)} flagged this shift. Review and manage.`;
        for (const uid of nurseCmUserIds) {
          createRecord("notifications", { userId: uid, type: "TASK_ASSIGNMENT", title, message, relatedEntityType: "assessment", severity: n.kind === "locreview" ? "WARNING" : "INFO" }).catch(() => null);
        }
      }
      // Raise incidents for severe (=4) domains, once per resident/domain/day.
      for (const d of incidents) {
        createRecord("incidents", { residentId: resId, incidentType: "CLINICAL_CHANGE", severity: "SEVERE", description: `${domainName(d)} scored ${INCIDENT_SCORE} (severe) on ${date} ${shift} — domain monitoring`, followUpRequired: true, incidentDate: nowIso }).catch(() => null);
      }

      setEdits({});
      const flagged = triggers.length;
      Swal.fire({ toast: true, position: "top-end", icon: flagged ? "warning" : "success", title: flagged ? `Saved — ${flagged} discrepancy${flagged > 1 ? "" : ""} flagged` : "Shift scores saved", showConfirmButton: false, timer: 2000 });
    } finally { setBusy(false); }
  };

  // ── Monitoring cases (open, across the community) ────────────────────────────
  const openCases = useMemo(() => cases.filter((c) => c.status !== "RESOLVED")
    .sort((a, b) => (CASE_RANK[a.status] - CASE_RANK[b.status]) || (b.openedAt || "").localeCompare(a.openedAt || "")), [cases]);

  const mutateCase = async (id: string, fn: (c: DomainCase) => DomainCase) => {
    await persistCases(cases.map((c) => (c.id === id ? fn(c) : c))); await refetch();
  };
  const onAddNote = async (c: DomainCase) => {
    const { value } = await Swal.fire({ title: "Management note", input: "textarea", inputPlaceholder: "Intervention / observation…", showCancelButton: true, confirmButtonText: "Add note" });
    if (!value) return;
    await mutateCase(c.id, (x) => addManagementNote(x, String(value), clinicianName, new Date().toISOString()));
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Note added", showConfirmButton: false, timer: 1400 });
  };
  const onEscalate = async (c: DomainCase) => { await mutateCase(c.id, (x) => markEscalated(x, new Date().toISOString())); Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Escalated", showConfirmButton: false, timer: 1400 }); };
  const onResolve = async (c: DomainCase) => {
    const res = await Swal.fire({ title: "Resolve case?", text: `Mark ${domainName(c.domain)} for ${resNameById.get(c.residentId) || "this resident"} back to baseline?`, icon: "question", showCancelButton: true, confirmButtonText: "Resolve" });
    if (!res.isConfirmed) return;
    await mutateCase(c.id, (x) => resolveCase(x, clinicianName, new Date().toISOString()));
  };
  const onCallLocReview = async (c: DomainCase) => { await mutateCase(c.id, (x) => markLocReviewOpened(x, new Date().toISOString())); openLocReview(c.residentId); };

  const stats = {
    open: openCases.length,
    locDue: openCases.filter((c) => c.status === "LOC_REVIEW_DUE").length,
    scoredToday: new Set(logs.filter((l) => l.date === todayStr).map((l) => l.residentId)).size,
  };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Domain Monitoring"
        subtitle="Score the 14 assessment domains each shift. Discrepancies from baseline open a monitoring case that escalates to a Level of Care review if it persists."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              <CalendarDays className="h-4 w-4 text-[var(--clinical-panel)]" />
              <span className="hidden lg:inline">{new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span><span className="lg:hidden">Date</span>
              <input type="date" value={date} onChange={(e) => changeScope(() => setDate(e.target.value))} aria-label="date" className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
            <label className="relative inline-flex min-h-11 items-center gap-2 rounded-xl border px-3 text-sm font-semibold text-[var(--clinical-ink-soft)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              <Clock className="h-4 w-4 text-[var(--clinical-amber)]" />
              <span>{shift} Shift</span>
              <select value={shift} onChange={(e) => changeScope(() => setShift(e.target.value as Shift))} aria-label="shift" className="absolute inset-0 cursor-pointer opacity-0">
                {SHIFTS.map((item) => <option key={item.v} value={item.v}>{item.label}</option>)}
              </select>
            </label>
          </div>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={stats.open} label="Open cases" accent={stats.open > 0 ? "amber" : "ink"} />
        <StatCard value={stats.locDue} label="LOC review due" accent={stats.locDue > 0 ? "coral" : "ink"} />
        <StatCard value={stats.scoredToday} label="Residents scored today" accent="ink" />
        <StatCard value={residents.length} label="Residents" accent="ink" />
      </div>

      <DataState loading={loading && logs.length === 0} error={resQ.error} empty={false}>
        {/* Capture */}
        <div className="mt-5 rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>Score domains · {shift} shift</p>
              <p className="text-xs text-[var(--clinical-muted)]">Pre-filled from the last recorded scores — change only what moved. Baseline = latest assessment.</p>
            </div>
            <select value={resId} onChange={(e) => changeScope(() => setResId(e.target.value))} aria-label="Select resident" className={`${controlClass} w-full sm:w-72`}>
              <option value="">Select resident…</option>
              {residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>Rm {s(r.room)} — {s(r.name)}</option>)}
            </select>
          </div>

          {!resId ? (
            <p className="mt-6 text-center text-sm text-[var(--clinical-muted)]">Select a resident to score their 14 domains for this shift.</p>
          ) : (
            <>
              <div className="mt-4 grid gap-2">
                {DOMAIN_CODES.map((code) => {
                  const val = scoreOf(code);
                  const bl = baseline[code];
                  const off = val != null && typeof bl === "number" && val > bl;
                  return (
                    <div key={code} className="grid grid-cols-1 items-center gap-2 rounded-xl border px-3 py-2 sm:grid-cols-[1fr_auto]" style={{ borderColor: off ? "var(--clinical-amber)" : "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--clinical-ink)]"><span className="text-[var(--clinical-muted)]">{code}</span> · {domainName(code)}</p>
                        <p className="truncate text-[11px] text-[var(--clinical-muted)]" title={val != null ? META[code]?.anchors?.[val] : undefined}>
                          {typeof bl === "number" ? <>Baseline {bl}{off ? <span className="text-[var(--clinical-amber)] font-semibold"> · above baseline</span> : null} · </> : null}
                          {val != null ? META[code]?.anchors?.[val] : "Not scored"}
                        </p>
                      </div>
                      <div className="inline-flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--clinical-line-strong)" }}>
                        {[0, 1, 2, 3, 4].map((n) => {
                          const on = val === n;
                          return (
                            <button key={n} type="button" onClick={() => setEdits((e) => ({ ...e, [code]: n as DomainScore }))}
                              className="h-9 w-9 text-sm font-bold transition"
                              style={on ? { backgroundColor: SCORE_TINT[n], color: "#fff" } : { color: "var(--clinical-ink-soft)", backgroundColor: "var(--clinical-surface)" }}
                              title={META[code]?.anchors?.[n]}>{n}</button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--clinical-muted)]">{scoredCount}/14 domains scored</p>
                <button onClick={save} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "var(--clinical-panel)" }}>
                  <ClipboardList className="h-4 w-4" /> {busy ? "Saving…" : "Save shift scores"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Monitoring cases */}
        <div className="mt-5">
          <h2 className="mb-3 flex items-center gap-2 font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}><ShieldAlert className="h-5 w-5 text-[var(--clinical-panel)]" /> Monitoring cases</h2>
          {openCases.length === 0 ? (
            <p className="rounded-xl border p-4 text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>No open discrepancies. Cases open automatically when a scored domain trips a trigger.</p>
          ) : (
            <div className="space-y-3">
              {openCases.map((c) => {
                const days = new Set(c.occurrences.map((o) => o.date)).size;
                const latest = c.occurrences[c.occurrences.length - 1];
                const due = c.status === "LOC_REVIEW_DUE";
                return (
                  <div key={c.id} className="rounded-2xl border p-4" style={{ backgroundColor: "var(--clinical-surface)", borderColor: due ? "var(--clinical-coral)" : c.status === "MANAGING" ? "var(--clinical-panel)" : "var(--clinical-amber)" }}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{resNameById.get(c.residentId) || "Resident"}{resRoomById.get(c.residentId) ? ` · Rm ${resRoomById.get(c.residentId)}` : ""}</p>
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: due ? "var(--clinical-coral)" : c.status === "MANAGING" ? "var(--clinical-panel)" : "var(--clinical-amber)" }}>{CASE_STATUS_LABEL[c.status]}</span>
                          <span className="text-sm font-semibold text-[var(--clinical-ink-soft)]">{c.domain} · {domainName(c.domain)}</span>
                        </div>
                        <p className="mt-1 text-xs text-[var(--clinical-muted)]">{days} day{days > 1 ? "s" : ""} · {c.occurrences.length} obs · {c.managementNotes.length} note{c.managementNotes.length === 1 ? "" : "s"}{latest ? ` · latest ${latest.date} ${latest.shift}` : ""}</p>
                        {latest && <p className="mt-1 flex flex-wrap gap-1.5">{latest.reasons.map((r) => <span key={r} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}><AlertTriangle className="h-3 w-3 text-[var(--clinical-amber)]" />{REASON_LABEL[r]}</span>)}</p>}
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {due && <button onClick={() => onCallLocReview(c)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: "var(--clinical-coral)" }}><ExternalLink className="h-3.5 w-3.5" /> Call for LOC review</button>}
                      <button onClick={() => onAddNote(c)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)" }}><MessageSquarePlus className="h-3.5 w-3.5" /> Add note</button>
                      {!c.escalatedAt && <button onClick={() => onEscalate(c)} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line-strong)" }}><ArrowUpRight className="h-3.5 w-3.5" /> Escalate</button>}
                      <button onClick={() => onResolve(c)} className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50"><Check className="h-3.5 w-3.5" /> Resolve</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DataState>
    </ClinicalPage>
  );
}
