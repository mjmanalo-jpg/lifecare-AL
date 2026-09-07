"use client";

// SLMS v4.2 — Resident Daily Routine (sub-project #4). The atomic caregiver
// execution board: one row per RoutineOccurrence for the current care day, grouped
// by shift (Night / Morning / Afternoon), rendered as the facility manual-form
// table (Time·Activity·Assistance·Assisted To·Status·Action). Charting closes ONE
// occurrence via POST /api/routine/complete (never a bundled window). Nurses / care
// managers are ungated; caregivers are time-gated to Due/Overdue occurrences.
//
// Reads RoutineOccurrence rows live (generic /api/db route, definition included),
// filtered to today's Manila care date client-side. The old bundled-encounter path
// is replaced — every consumer now sees per-occurrence rows.

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw, CheckCircle2, AlertTriangle, ShieldAlert, Pill, ClipboardList, User2,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import {
  ClinicalPage, ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill,
  DataState, StatCard, MicroLabel, SearchInput, ClinicalModal,
} from "./clinical-ui";
import MARDailyBoard from "./MARDailyBoard";
import ResultEntryForm from "./ResultEntryForm";
import { pushGlobalToast } from "@/components/ui/global-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { careDay } from "@/lib/lifecare/routineCompletions";
import { ASSISTANCE_DISPLAY, ROLE_ABBR, type Assistance, type Role } from "@/lib/lifecare/assistance";
import {
  deriveState, isChartable, isLate, countProgress, manilaMinutesNow, type OccLike,
} from "@/lib/lifecare/occurrenceStatus";
import { EXCEPTION_REASON, type ExceptionReason, type WorkflowState } from "@/lib/lifecare/vocab";
import { schemaFor } from "@/lib/lifecare/resultSchema";
import { ASSESSMENTS_V42_KEY, type AssessmentV42 } from "@/lib/lifecare/assessment.ts";

// ── Occurrence row (RoutineOccurrence + included RoutineEventDefinition) ─────────
interface DefinitionLite {
  name?: string;
  instructions?: string;
  assistanceLevel?: string | null;
  supervision?: string | null;
  staffing?: string | null;
  equipment?: string | null;
  technique?: string | null;
  conditionModifier?: string | null;
  responsibleRole?: string | null;
  resultSchemaKey?: string;
  completionControl?: string | null;
  criticality?: string | null;
  escalationPriority?: string | null;
  memoryPathwayId?: string | null;
  conditionBundleId?: string | null;
  orderRef?: string | null;
  sourceLocBundleId?: string | null;
}
interface OccurrenceRow {
  id: string;
  occId: string;
  residentId: string;
  careDate: string;
  scheduledTime: string;
  workflowState?: string | null;
  careDeliveryOutcome?: string | null;
  exceptionReason?: string | null;
  escalationState?: string | null;
  definition?: DefinitionLite | null;
}

const NURSE_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN", "ORGANIZATION_ADMIN"]);

/** scheduledTime "HH:MM" → shift group. Night 22:00-05:59, Morning 06:00-13:59, Afternoon 14:00-21:59. */
type ShiftKey = "Night" | "Morning" | "Afternoon";
const SHIFT_ORDER: ShiftKey[] = ["Night", "Morning", "Afternoon"];
function shiftOf(hhmm: string): ShiftKey {
  const h = Number(/(\d{1,2}):/.exec(hhmm || "")?.[1] ?? 0);
  if (h >= 6 && h < 14) return "Morning";
  if (h >= 14 && h < 22) return "Afternoon";
  return "Night";
}

/** Which completion control a row uses, derived from its result schema (all
 *  definitions carry "Record & Complete"; the meaningful split is schema-driven). */
type CompletionKind = "complete" | "record" | "mar" | "tar";
function completionKind(def: DefinitionLite | null | undefined): CompletionKind {
  const key = def?.resultSchemaKey || "";
  if (key === "Medication Support") return "mar";
  if (def?.orderRef && (key === "Skin Check" || key === "Blood Glucose" || key === "Vital Signs")) return "tar";
  // A schema with required result fields needs the entry form; else one-tap complete.
  try {
    return schemaFor(key).requiredFields.length > 0 ? "record" : "complete";
  } catch {
    return "complete";
  }
}

/** Care date (YYYY-MM-DD) from a RoutineOccurrence.careDate (a DateTime at 00:00 +08:00). */
const rowCareDate = (v: unknown): string => {
  const s = String(v ?? "");
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(d);
};

const STATE_PILL: Record<WorkflowState, string> = {
  Upcoming: "INFO", Due: "PENDING", Overdue: "OVERDUE", Closed: "COMPLETED", Cancelled: "CANCELLED",
};

function parseAssessments(value: string | undefined): AssessmentV42[] {
  if (!value) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? (v as AssessmentV42[]) : []; } catch { return []; }
}

export default function TodaysCareBoard({ role, focusResidentId, embedded }: { role?: string; focusResidentId?: string; embedded?: boolean }) {
  const { confirm, confirmDialog } = useConfirm();

  // ---- Identity / role -------------------------------------------------------
  const [me, setMe] = useState("");
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (!d?.authenticated) return;
      setMe(d.session?.name ?? "");
      setSessionRole(d.session?.role ?? null);
    }).catch(() => { /* non-fatal */ });
  }, []);
  const effectiveRole = (sessionRole ?? role ?? "").toUpperCase();
  const isCaregiverView = effectiveRole === "CAREGIVER";

  // ---- Data ------------------------------------------------------------------
  // Residents (header: name / room / photo).
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { tables: ["Resident"] });
  // Occurrences — all RoutineOccurrence rows (with definition), filtered to today
  // client-side. When scoped to one resident, filter server-side by residentId.
  const { data: occRows, loading, error, refetch } = useLiveQuery<OccurrenceRow>(
    "routine-occurrences",
    { tables: ["RoutineOccurrence"], query: `include=definition&take=500${focusResidentId ? `&f_residentId=${focusResidentId}` : ""}` },
  );
  // Assessments (Final LOC + condition/memory badges) — the established source.
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const today = careDay();

  // Live tick so the derived state (Due/Overdue) advances without a manual refresh.
  const [, setNowTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const nowMin = manilaMinutesNow();

  const residentsById = useMemo(() => {
    const m = new Map<string, { name: string; room: string; photo: string }>();
    for (const r of (residentRows || [])) {
      const id = String(r.id || ""); if (!id) continue;
      m.set(id, {
        name: `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim() || "Resident",
        room: String(r.roomNumber ?? "—"),
        photo: String(r.photoUrl ?? r.photo ?? ""),
      });
    }
    return m;
  }, [residentRows]);

  // finalLevel by resident (id or name) from validated assessments.
  const finalLevelByResident = useMemo(() => {
    const byId = new Map<string, string>(); const byName = new Map<string, string>();
    for (const a of parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value)) {
      const lvl = a.layer3?.finalLevel; if (!lvl) continue;
      if (a.layer1?.residentId) byId.set(a.layer1.residentId, String(lvl));
      const nm = (a.layer1?.residentName || "").trim().toLowerCase();
      if (nm && !byName.has(nm)) byName.set(nm, String(lvl));
    }
    return { byId, byName };
  }, [settingRows]);

  // Today's occurrences, grouped by resident.
  const todaysByResident = useMemo(() => {
    const m = new Map<string, OccurrenceRow[]>();
    for (const o of (occRows || [])) {
      if (rowCareDate(o.careDate) !== today) continue;
      const rid = String(o.residentId || ""); if (!rid) continue;
      (m.get(rid) ?? m.set(rid, []).get(rid)!).push(o);
    }
    for (const rows of m.values()) rows.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
    return m;
  }, [occRows, today]);

  // ---- Resident selection ----------------------------------------------------
  const residentList = useMemo(() => {
    const ids = focusResidentId ? [focusResidentId] : [...todaysByResident.keys()];
    return ids
      .map((id) => ({ id, name: residentsById.get(id)?.name || "Resident", count: (todaysByResident.get(id) || []).length }))
      .filter((r) => focusResidentId || r.count > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [todaysByResident, residentsById, focusResidentId]);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? residentList.filter((r) => r.name.toLowerCase().includes(q)) : residentList;
  }, [residentList, search]);
  const desiredId = (selectedId && filtered.some((r) => r.id === selectedId)) ? selectedId : filtered[0]?.id ?? null;
  if (desiredId !== selectedId) setSelectedId(desiredId);

  const selectedRows = useMemo(() => (selectedId ? todaysByResident.get(selectedId) || [] : []), [todaysByResident, selectedId]);
  const selectedResident = selectedId ? residentsById.get(selectedId) : undefined;
  const selectedLevel = selectedId
    ? finalLevelByResident.byId.get(selectedId)
      || finalLevelByResident.byName.get((selectedResident?.name || "").toLowerCase())
      || "—"
    : "—";

  // Condition / Memory badges from the selected resident's definitions.
  const badges = useMemo(() => {
    let memory = false, condition = false;
    for (const o of selectedRows) {
      if (o.definition?.memoryPathwayId) memory = true;
      if (o.definition?.conditionBundleId || o.definition?.conditionModifier) condition = true;
    }
    return { memory, condition };
  }, [selectedRows]);

  const progress = useMemo(() => countProgress(selectedRows, nowMin), [selectedRows, nowMin]);

  // ---- Optimistic close state ------------------------------------------------
  // occId → optimistic patch (so a tapped row shows Closed instantly). Server rows
  // win once the refetch lands; a failed POST reverts the entry.
  const [optimistic, setOptimistic] = useState<Map<string, { workflowState: WorkflowState; careDeliveryOutcome?: string | null; exceptionReason?: string | null }>>(new Map());
  const [busy, setBusy] = useState(false);

  const applyOptimistic = (row: OccurrenceRow): OccurrenceRow => {
    const o = optimistic.get(row.occId);
    return o ? { ...row, ...o } : row;
  };

  // ---- Complete / exception / record / MAR -----------------------------------
  const [recordFor, setRecordFor] = useState<OccurrenceRow | null>(null);
  const [marFor, setMarFor] = useState<OccurrenceRow | null>(null);
  const [exceptionFor, setExceptionFor] = useState<OccurrenceRow | null>(null);
  const [exReason, setExReason] = useState<ExceptionReason>("Resident declined");
  const [exObservation, setExObservation] = useState("");

  const post = async (row: OccurrenceRow, body: Record<string, unknown>, optimisticPatch: { workflowState: WorkflowState; careDeliveryOutcome?: string | null; exceptionReason?: string | null }) => {
    setOptimistic((prev) => new Map(prev).set(row.occId, optimisticPatch));
    setBusy(true);
    try {
      const res = await fetch("/api/routine/complete", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ occId: row.occId, actorName: me || undefined, shift: shiftOf(row.scheduledTime), ...body }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const detail = [(json as { missing?: string[] }).missing?.join(", "), (json as { invalid?: string[] }).invalid?.join(", ")].filter(Boolean).join(" · ");
        throw new Error(`${(json as { error?: string }).error || "Could not chart."}${detail ? ` (${detail})` : ""}`);
      }
      const escalated = !!(json as { escalated?: boolean }).escalated;
      const reviewFlagged = !!(json as { reviewAlertRaised?: boolean }).reviewAlertRaised;
      const notified = !!(json as { notified?: boolean }).notified;
      const out = String(optimisticPatch.careDeliveryOutcome || "Charted");
      pushGlobalToast(
        escalated ? "warning" : "success",
        optimisticPatch.workflowState === "Closed" && !escalated ? "Charted" : `Charted: ${out}`,
        escalated ? "Nurse alerted · escalation raised" : reviewFlagged ? "Reassessment flagged" : notified ? "Nurse notified" : undefined,
      );
      void refetch();
      return true;
    } catch (err) {
      setOptimistic((prev) => { const m = new Map(prev); m.delete(row.occId); return m; });
      pushGlobalToast("error", "Could not chart", err instanceof Error ? err.message : "Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doComplete = async (row: OccurrenceRow) => {
    await post(row, { outcome: "Completed as planned" }, { workflowState: "Closed", careDeliveryOutcome: "Completed as planned" });
  };

  const submitRecord = async (payload: { results: Record<string, unknown>; outcome: string }) => {
    if (!recordFor) return;
    const ok = await post(recordFor, { outcome: payload.outcome, results: payload.results }, { workflowState: "Closed", careDeliveryOutcome: payload.outcome });
    if (ok) setRecordFor(null);
  };

  const submitException = async () => {
    if (!exceptionFor) return;
    const ok = await post(
      exceptionFor,
      { outcome: "Not completed", exceptionReason: exReason, observation: isCaregiverView ? undefined : (exObservation.trim() || undefined) },
      { workflowState: "Closed", careDeliveryOutcome: "Not completed", exceptionReason: exReason },
    );
    if (ok) setExceptionFor(null);
  };

  const openException = (row: OccurrenceRow) => { setExReason("Resident declined"); setExObservation(""); setExceptionFor(row); };

  // Chartable guard (caregiver time-lock; nurses/CM ungated). Also warns on a row
  // outside its schema's allowed window via isLate.
  const canChart = (row: OccurrenceRow): boolean => {
    if (!isCaregiverView) return true;
    return isChartable({ scheduledTime: row.scheduledTime, workflowState: row.workflowState } as OccLike, nowMin);
  };

  const onAction = async (row: OccurrenceRow, kind: CompletionKind) => {
    // ponytail: no per-occurrence package gate here — the assembly engine already
    // scoped definitions to the resident's LOC (#3). Warn-only stays a #5 knob.
    if (kind === "mar") { setMarFor(row); return; }
    if (kind === "record" || kind === "tar") { setRecordFor(row); return; }
    // One-tap Complete: confirm so a mis-tap doesn't silently close it.
    const ok = await confirm({ title: "Complete this care?", description: `${row.definition?.name || "Care task"} — ${row.scheduledTime}`, confirmText: "Complete" });
    if (ok) await doComplete(row);
  };

  // ---- Render ----------------------------------------------------------------
  const grouped = useMemo(() => {
    const g: Record<ShiftKey, OccurrenceRow[]> = { Night: [], Morning: [], Afternoon: [] };
    for (const r of selectedRows) g[shiftOf(r.scheduledTime)].push(applyOptimistic(r));
    return g;
  }, [selectedRows, optimistic]);

  const body = (
    <>
      {!embedded && (
        <ClinicalHeader
          title="Resident Daily Routine"
          subtitle="Every scheduled care occurrence for today, one atomic row per event, grouped by shift. Chart each occurrence on its own: one tap to complete, record a result, open the MAR, or log an exception."
          right={
            <ClinicalButton variant="secondary" size="sm" onClick={() => refetch()} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" /> Refresh
            </ClinicalButton>
          }
        />
      )}

      <div className={`${embedded ? "" : "mt-5 "}grid grid-cols-1 gap-5${focusResidentId ? "" : " lg:grid-cols-[280px_1fr]"}`}>
        {/* Resident selector (hidden when scoped to one resident). */}
        {!focusResidentId && (
          <ClinicalCard top="teal" className="p-4">
            <MicroLabel>Residents</MicroLabel>
            <div className="mt-3"><SearchInput value={search} onChange={setSearch} placeholder="Search residents…" /></div>
            <div className="mt-3">
              <DataState
                loading={loading && (occRows || []).length === 0}
                error={error ? new Error(error) : null}
                empty={!loading && filtered.length === 0}
                emptyTitle="No routines today"
                emptyHint="A resident appears here once their approved routine has materialised occurrences for today."
                onRetry={refetch}
                skeletonRows={4}
              >
                <ul className="space-y-2">
                  {filtered.map((r) => {
                    const active = r.id === selectedId;
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => setSelectedId(r.id)}
                          className={`w-full min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-[var(--clinical-panel)] bg-[var(--clinical-surface-2)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] hover:bg-[var(--clinical-surface-2)]"}`}>
                          <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{r.name}</span>
                          <span className="mt-0.5 block text-[11px] text-[var(--clinical-muted)]">{r.count} occurrence{r.count === 1 ? "" : "s"} today</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </DataState>
            </div>
          </ClinicalCard>
        )}

        {/* Selected resident's routine */}
        <div className="min-w-0 space-y-5">
          {!selectedId ? (
            <ClinicalCard className="p-10 text-center">
              <p className="text-sm text-[var(--clinical-muted)]">{focusResidentId ? "No routine occurrences for this resident today." : "Select a resident to view their daily routine."}</p>
            </ClinicalCard>
          ) : (
            <>
              {/* Resident header — ONCE */}
              <ClinicalCard className="p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[var(--clinical-surface-2)]">
                    {selectedResident?.photo
                      ? <img src={selectedResident.photo} alt="" className="h-full w-full object-cover" />
                      : <User2 className="h-6 w-6 text-[var(--clinical-muted)]" />}
                  </div>
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-bold text-[var(--clinical-ink)]">{selectedResident?.name || "Resident"}</h2>
                    <p className="text-[11px] text-[var(--clinical-muted)]">Room {selectedResident?.room || "—"} · {today}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status="APPROVED">Level {selectedLevel}</StatusPill>
                    {badges.condition && <StatusPill status="WARNING">Condition</StatusPill>}
                    {badges.memory && <StatusPill status="WATCH">Memory Care</StatusPill>}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <StatCard label="Completed" value={`${progress.completed}/${progress.total}`} accent="green" />
                  <StatCard label="Overdue" value={progress.overdue} accent={progress.overdue ? "coral" : "ink"} />
                  <StatCard label="Pending review" value={progress.pendingReview} accent={progress.pendingReview ? "amber" : "ink"} />
                  <StatCard label={isCaregiverView ? "You" : "Assigned"} value={me ? "CGs" : "—"} accent="teal" />
                </div>
              </ClinicalCard>

              {/* Shift groups */}
              {SHIFT_ORDER.map((shiftKey) => {
                const rows = grouped[shiftKey];
                if (!rows.length) return null;
                return (
                  <ClinicalCard key={shiftKey} className="p-4">
                    <div className="flex items-center gap-2">
                      <MicroLabel>{shiftKey} shift</MicroLabel>
                      <span className="ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-[var(--clinical-surface-2)] px-1.5 text-xs font-semibold text-[var(--clinical-ink)]">{rows.length}</span>
                    </div>
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[640px] text-left text-sm">
                        <thead>
                          <tr className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--clinical-muted)]">
                            <th className="px-2 py-1.5">Time</th>
                            <th className="px-2 py-1.5">Activity</th>
                            <th className="px-2 py-1.5">Assistance</th>
                            <th className="px-2 py-1.5">Assisted To</th>
                            <th className="px-2 py-1.5">Status</th>
                            <th className="px-2 py-1.5 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <OccurrenceRowView
                              key={row.occId}
                              row={row}
                              nowMin={nowMin}
                              busy={busy}
                              chartable={canChart(row)}
                              showNurseControls={!isCaregiverView && NURSE_ROLES.has(effectiveRole)}
                              onAction={onAction}
                              onException={openException}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ClinicalCard>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Record & Complete modal */}
      <ClinicalModal
        open={!!recordFor}
        onClose={() => setRecordFor(null)}
        title="Record & Complete"
        description={recordFor ? `${recordFor.definition?.name || "Care"} — ${recordFor.scheduledTime}` : undefined}
        size="md"
      >
        {recordFor && (
          <ResultEntryForm
            resultSchemaKey={recordFor.definition?.resultSchemaKey || ""}
            busy={busy}
            onSubmit={submitRecord}
            onCancel={() => setRecordFor(null)}
          />
        )}
      </ClinicalModal>

      {/* Open MAR modal */}
      <ClinicalModal
        open={!!marFor}
        onClose={() => setMarFor(null)}
        title={`MAR — ${marFor ? residentsById.get(marFor.residentId)?.name || "Resident" : ""}`}
        description="Chart the medication in the MAR; the routine occurrence stays open until it is recorded there."
        size="xl"
      >
        {marFor && <MARDailyBoard clinicianRole="CAREGIVER" focusResidentId={marFor.residentId} embedded />}
      </ClinicalModal>

      {/* Exception modal */}
      <ClinicalModal
        open={!!exceptionFor}
        onClose={() => setExceptionFor(null)}
        title="Record an exception"
        description={exceptionFor ? `${exceptionFor.definition?.name || "Care"} — ${exceptionFor.scheduledTime}` : undefined}
        size="md"
        footer={
          <>
            <ClinicalButton variant="secondary" onClick={() => setExceptionFor(null)} disabled={busy}>Cancel</ClinicalButton>
            <ClinicalButton variant="danger" onClick={submitException} disabled={busy}>{busy ? "Charting…" : "Chart exception"}</ClinicalButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <MicroLabel>Reason</MicroLabel>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(exceptionFor?.definition?.resultSchemaKey
                ? allowedExceptionsFor(exceptionFor.definition.resultSchemaKey)
                : (EXCEPTION_REASON as readonly ExceptionReason[])
              ).map((reason) => {
                const active = exReason === reason;
                return (
                  <button key={reason} type="button" onClick={() => setExReason(reason)}
                    className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${active ? "border-[var(--clinical-coral)] bg-[var(--clinical-surface-2)] text-[var(--clinical-ink)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] text-[var(--clinical-ink)] hover:bg-[var(--clinical-surface-2)]"}`}>
                    {reason}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Caregivers chart by structured reason only — no free-text observation. */}
          {!isCaregiverView && (
            <div>
              <MicroLabel>Observation (optional)</MicroLabel>
              <textarea value={exObservation} onChange={(e) => setExObservation(e.target.value)} rows={3}
                placeholder="Short note — what happened, what you did."
                className="mt-2 w-full resize-y rounded-lg border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] px-3 py-2.5 text-sm text-[var(--clinical-ink)] outline-none transition placeholder:text-[var(--clinical-muted)] focus:border-[var(--clinical-panel)] focus:ring-2 focus:ring-[var(--clinical-panel)]/20" />
            </div>
          )}
        </div>
      </ClinicalModal>

      {confirmDialog}
    </>
  );

  return embedded ? <div>{body}</div> : <ClinicalPage>{body}</ClinicalPage>;
}

/** The reasons a schema allows (falls back to the full vocab if unknown). */
function allowedExceptionsFor(resultSchemaKey: string): ExceptionReason[] {
  try {
    const allowed = schemaFor(resultSchemaKey).allowedExceptions.filter((e) => (EXCEPTION_REASON as readonly string[]).includes(e)) as ExceptionReason[];
    return allowed.length ? allowed : [...(EXCEPTION_REASON as readonly ExceptionReason[])];
  } catch {
    return [...(EXCEPTION_REASON as readonly ExceptionReason[])];
  }
}

// ── One occurrence row ───────────────────────────────────────────────────────
function OccurrenceRowView({
  row, nowMin, busy, chartable, showNurseControls, onAction, onException,
}: {
  row: OccurrenceRow;
  nowMin: number;
  busy: boolean;
  chartable: boolean;
  showNurseControls: boolean;
  onAction: (row: OccurrenceRow, kind: CompletionKind) => void;
  onException: (row: OccurrenceRow) => void;
}) {
  const state = deriveState({ scheduledTime: row.scheduledTime, workflowState: row.workflowState } as OccLike, nowMin) as WorkflowState;
  const closed = state === "Closed" || state === "Cancelled";
  const late = isLate({ scheduledTime: row.scheduledTime, workflowState: row.workflowState } as OccLike, nowMin);
  const def = row.definition;
  const kind = completionKind(def);
  const assist = def?.assistanceLevel && (ASSISTANCE_DISPLAY as Record<string, string>)[def.assistanceLevel]
    ? ASSISTANCE_DISPLAY[def.assistanceLevel as Assistance]
    : (def?.assistanceLevel || "—");
  const roleAbbr = def?.responsibleRole && (ROLE_ABBR as Record<string, string>)[def.responsibleRole]
    ? ROLE_ABBR[def.responsibleRole as Role]
    : (def?.responsibleRole || "CGs");
  const critical = def?.criticality === "Critical" || def?.escalationPriority === "P1";

  const actionLabel = kind === "mar" ? "Open MAR" : kind === "tar" ? "Open Treatment" : kind === "record" ? "Record" : "Complete";
  const ActionIcon = kind === "mar" ? Pill : kind === "tar" ? ClipboardList : CheckCircle2;
  const locked = !chartable && !closed;

  return (
    <tr className="border-t border-[var(--clinical-line)] align-top">
      <td className="px-2 py-2.5 whitespace-nowrap font-semibold tabular-nums text-[var(--clinical-ink)]">{row.scheduledTime}</td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          {critical && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-coral)]" aria-label="Critical" />}
          <span className={`font-medium ${closed ? "text-[var(--clinical-muted)] line-through" : "text-[var(--clinical-ink)]"}`}>{def?.name || "Care task"}</span>
        </div>
        {def?.instructions && <p className="mt-0.5 max-w-md text-[11px] text-[var(--clinical-muted)]">{def.instructions}</p>}
        {(def?.equipment || def?.staffing) && <p className="mt-0.5 text-[10px] text-[var(--clinical-muted)]">{[def.staffing, def.equipment].filter(Boolean).join(" · ")}</p>}
      </td>
      <td className="px-2 py-2.5 text-[var(--clinical-ink-soft)]">{assist}</td>
      <td className="px-2 py-2.5 text-[var(--clinical-ink-soft)]">{roleAbbr}</td>
      <td className="px-2 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <StatusPill status={STATE_PILL[state]}>{closed ? (row.careDeliveryOutcome === "Not completed" ? "Not done" : "Done") : state}</StatusPill>
          {!closed && late && <StatusPill status="OVERDUE" className="!bg-transparent !text-[var(--clinical-coral)] !px-1">late</StatusPill>}
          {row.escalationState && row.escalationState !== "Not required" && <StatusPill status="WARNING">Review</StatusPill>}
        </div>
        {closed && row.exceptionReason && <p className="mt-0.5 text-[10px] text-[var(--clinical-muted)]">{row.exceptionReason}</p>}
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          {closed ? (
            <span className="text-[11px] font-semibold text-[var(--clinical-muted)]">Charted</span>
          ) : (
            <>
              <ClinicalButton size="sm" variant="primary" disabled={busy || locked} onClick={() => onAction(row, kind)} aria-label={`${actionLabel} ${def?.name || "care"}`}>
                <ActionIcon className="h-4 w-4" /> {actionLabel}
              </ClinicalButton>
              <ClinicalButton size="sm" variant="secondary" disabled={busy || locked} onClick={() => onException(row)} aria-label={`Record an exception for ${def?.name || "care"}`}>
                <AlertTriangle className="h-4 w-4" />
              </ClinicalButton>
            </>
          )}
          {showNurseControls && !closed && <span className="sr-only">nurse controls available</span>}
        </div>
        {locked && <p className="mt-0.5 text-right text-[10px] text-[var(--clinical-muted)]">Opens near its time</p>}
      </td>
    </tr>
  );
}
