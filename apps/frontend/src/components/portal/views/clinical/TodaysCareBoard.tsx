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
  RefreshCw, CheckCircle2, AlertTriangle, ShieldAlert, User2,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import {
  ClinicalPage, ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill,
  DataState, MicroLabel, SearchInput, ClinicalModal,
} from "./clinical-ui";
import { pushGlobalToast } from "@/components/ui/global-toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

import { careDay } from "@/lib/lifecare/routineCompletions";
import { parseSchedules, CAREGIVER_SCHEDULE_KEY, type ShiftKey as RosterShift } from "@/lib/caregiverSchedule";
import { to12h } from "@/lib/lifecare/careTask";
import { ASSISTANCE_DISPLAY, type Assistance } from "@/lib/lifecare/assistance";
import {
  deriveState, isChartable, manilaMinutesNow, manilaDay, type OccLike,
} from "@/lib/lifecare/occurrenceStatus";
import { type WorkflowState } from "@/lib/lifecare/vocab";
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

/** Roster shift (AM/PM/NOC) → routine shift group. AM covers the Morning window,
 *  PM the Afternoon window, NOC the Night window (see SHIFTS in caregiverSchedule). */
const ROSTER_TO_ROUTINE: Record<RosterShift, ShiftKey> = { AM: "Morning", PM: "Afternoon", NOC: "Night" };

/** Care date (YYYY-MM-DD, Asia/Manila) from a RoutineOccurrence.careDate (stored as
 * the care day's Manila midnight, i.e. an instant at +08:00). Must resolve in Manila
 * — a raw UTC prefix would read the previous day and hide every occurrence. */
const rowCareDate = (v: unknown): string => manilaDay(v);


function parseAssessments(value: string | undefined): AssessmentV42[] {
  if (!value) return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? (v as AssessmentV42[]) : []; } catch { return []; }
}

export default function TodaysCareBoard({ role, focusResidentId, embedded }: { role?: string; focusResidentId?: string; embedded?: boolean }) {
  const { confirmDialog } = useConfirm();

  // ---- Identity / role -------------------------------------------------------
  const [me, setMe] = useState("");
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (!d?.authenticated) return;
      setMe(d.session?.name ?? "");
      setSessionRole(d.session?.role ?? null);
      setSessionUserId(d.session?.userId ?? null);
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

  // Occurrences are materialized ON-DEMAND (#3 §5): opening a resident's routine
  // triggers an idempotent GET that creates the day's rows from the APPROVED
  // definitions, then we refetch the live query so they render. Without this the
  // board only ever shows rows a prior read already created (→ empty on first open).
  // ponytail: focus-scoped; the My Shift aggregate materializes each resident as it's opened.
  useEffect(() => {
    if (!focusResidentId) return;
    let cancelled = false;
    fetch(`/api/routine/occurrences?residentId=${encodeURIComponent(focusResidentId)}&careDate=${today}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => { if (!cancelled && res && res.count > 0) refetch(); })
      .catch(() => { /* non-fatal — the live query still shows any existing rows */ });
    return () => { cancelled = true; };
  }, [focusResidentId, today, refetch]);

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

  // A caregiver sees ONLY the tasks for the shift(s) they are ROSTERED to for the
  // selected resident today (caregiver_schedules) — NOT the wall-clock shift.
  // Assigned AM only → only Morning tasks; not rostered to this resident → nothing;
  // rostered a new shift → those tasks appear. Nurses / CM see the full 24h routine.
  const schedules = useMemo(
    () => parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value),
    [settingRows],
  );
  // null = unrestricted (nurse/CM); a Set = the caregiver's rostered routine shifts
  // for the selected resident today (empty Set = not rostered → no tasks).
  const rosterShifts = useMemo<Set<ShiftKey> | null>(() => {
    if (!isCaregiverView) return null;
    const set = new Set<ShiftKey>();
    if (!sessionUserId || !selectedId) return set;
    for (const s of schedules) {
      if (s.caregiverUserId === sessionUserId && s.date === today && s.residentIds.includes(selectedId)) {
        set.add(ROSTER_TO_ROUTINE[s.shift]);
      }
    }
    return set;
  }, [isCaregiverView, sessionUserId, selectedId, schedules, today]);

  // The shift live RIGHT NOW by Manila clock (Morning 06–14, Afternoon 14–22, else Night).
  const currentShift: ShiftKey = (() => {
    const h = Math.floor(nowMin / 60);
    return h >= 6 && h < 14 ? "Morning" : h >= 14 && h < 22 ? "Afternoon" : "Night";
  })();
  // A caregiver sees a shift's tasks only while it is the CURRENT shift AND they are
  // rostered to it for this resident. So a past shift drops off the moment it ends
  // (AM tasks gone after 14:00) and a shift they aren't rostered to never appears.
  const activeShift: ShiftKey | null = rosterShifts && rosterShifts.has(currentShift) ? currentShift : null;
  const viewRows = useMemo(
    () => (rosterShifts ? (activeShift ? selectedRows.filter((r) => shiftOf(r.scheduledTime) === activeShift) : []) : selectedRows),
    [selectedRows, rosterShifts, activeShift],
  );

  // ---- Optimistic close state ------------------------------------------------
  // occId → optimistic patch (so a tapped row shows Closed instantly). Server rows
  // win once the refetch lands; a failed POST reverts the entry.
  const [optimistic, setOptimistic] = useState<Map<string, { workflowState: WorkflowState; careDeliveryOutcome?: string | null; exceptionReason?: string | null }>>(new Map());
  const [busy, setBusy] = useState(false);

  const applyOptimistic = (row: OccurrenceRow): OccurrenceRow => {
    const o = optimistic.get(row.occId);
    return o ? { ...row, ...o } : row;
  };

  // ---- Complete / exception --------------------------------------------------
  // Two primary caregiver actions only: DONE (one-tap complete) and EXCEPTION.
  const [exceptionFor, setExceptionFor] = useState<OccurrenceRow | null>(null);
  const [exReason, setExReason] = useState<string>(EXCEPTION_REASONS[0].label);
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

  // DONE — one tap, finished. Closes the occurrence "Completed as planned"; SLMS
  // records caregiver/time/resident/task + the plan-prescribed assistance. No form.
  const doComplete = async (row: OccurrenceRow) => {
    await post(row, { outcome: "Completed as planned" }, { workflowState: "Closed", careDeliveryOutcome: "Completed as planned" });
  };

  const submitException = async () => {
    if (!exceptionFor) return;
    const r = EXCEPTION_REASONS.find((x) => x.label === exReason) ?? EXCEPTION_REASONS[0];
    if (r.requiresNote && !exObservation.trim()) { pushGlobalToast("error", "Note required", "Add a short note for “Other”."); return; }
    // Post the mapped legacy outcome; /api/routine/complete derives the v4.2
    // exceptionReason/finding + the escalation from it (classifyOutcome).
    const ok = await post(
      exceptionFor,
      { outcome: r.outcome, observation: exObservation.trim() || undefined },
      { workflowState: "Closed", careDeliveryOutcome: r.care, exceptionReason: r.care === "Not completed" ? r.label : null },
    );
    if (ok) setExceptionFor(null);
  };

  const openException = (row: OccurrenceRow) => { setExReason(EXCEPTION_REASONS[0].label); setExObservation(""); setExceptionFor(row); };

  // Chartable guard (caregiver time-lock; nurses/CM ungated). Also warns on a row
  // outside its schema's allowed window via isLate.
  const canChart = (row: OccurrenceRow): boolean => {
    if (!isCaregiverView) return true;
    return isChartable({ scheduledTime: row.scheduledTime, workflowState: row.workflowState } as OccLike, nowMin);
  };

  // ---- Render ----------------------------------------------------------------
  const grouped = useMemo(() => {
    const g: Record<ShiftKey, OccurrenceRow[]> = { Night: [], Morning: [], Afternoon: [] };
    for (const r of viewRows) g[shiftOf(r.scheduledTime)].push(applyOptimistic(r));
    return g;
  }, [viewRows, optimistic]);

  const body = (
    <>
      {!embedded && (
        <ClinicalHeader
          title="Resident Daily Routine"
          subtitle={isCaregiverView
            ? (activeShift
              ? `Your ${activeShift} shift tasks for this resident — one atomic row per event. Chart each on its own: one tap to complete, record a result, open the MAR, or log an exception.`
              : (rosterShifts && rosterShifts.size
                ? "Your rostered shift for this resident isn’t active right now. Tasks show during your scheduled shift and close when it ends."
                : "You are not rostered to this resident today. Tasks appear once the nursing team assigns you a shift for them."))
            : "Every scheduled care occurrence for today, one atomic row per event, grouped by shift. Chart each occurrence on its own: one tap to complete, record a result, open the MAR, or log an exception."}
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
              {/* Resident header — ONCE. In the single-resident modal the name is
                  already the modal title, so collapse to a slim details strip
                  (Room · date · Level + pathway badges) instead of a duplicate
                  name/photo card. Standalone / multi-resident views keep the card. */}
              {embedded && focusResidentId ? (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-[var(--clinical-muted)]">
                  <span>Room {selectedResident?.room || "—"} · {today}</span>
                  <StatusPill status="APPROVED">Level {selectedLevel}</StatusPill>
                  {badges.condition && <StatusPill status="WARNING">Condition</StatusPill>}
                  {badges.memory && <StatusPill status="WATCH">Memory Care</StatusPill>}
                </div>
              ) : (
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
                </ClinicalCard>
              )}

              {/* Caregiver rostered to no shift for this resident (or no tasks left
                  in their rostered shift) — say so instead of a silent blank. */}
              {isCaregiverView && viewRows.length === 0 && (
                <ClinicalCard className="p-8 text-center">
                  <p className="text-sm text-[var(--clinical-muted)]">
                    {rosterShifts && rosterShifts.size === 0
                      ? "You're not rostered to this resident today. Tasks appear when the nursing team assigns you a shift for them."
                      : activeShift
                        ? "No tasks in your current shift for this resident."
                        : "Your rostered shift for this resident isn’t active right now. Tasks show during your scheduled shift, then close when it ends."}
                  </p>
                </ClinicalCard>
              )}

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
                              onDone={doComplete}
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
              {EXCEPTION_REASONS.map((r) => {
                const active = exReason === r.label;
                return (
                  <button key={r.label} type="button" onClick={() => setExReason(r.label)}
                    className={`min-h-12 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${active ? "border-[var(--clinical-coral)] bg-[var(--clinical-surface-2)] text-[var(--clinical-ink)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] text-[var(--clinical-ink)] hover:bg-[var(--clinical-surface-2)]"}`}>
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
          {/* Note field only when clinically necessary — i.e. "Other" (required). */}
          {EXCEPTION_REASONS.find((x) => x.label === exReason)?.requiresNote && (
            <div>
              <MicroLabel>Note (required)</MicroLabel>
              <textarea value={exObservation} onChange={(e) => setExObservation(e.target.value)} rows={3} autoFocus
                placeholder="Briefly describe what happened."
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

/** The six short caregiver EXCEPTION reasons (spec) → the legacy outcome posted to
 *  /api/routine/complete, which derives the v4.2 exceptionReason/finding + escalation.
 *  `care` is the optimistic careDeliveryOutcome; a note is required only for "Other". */
const EXCEPTION_REASONS: { label: string; outcome: string; care: "Not completed" | "Completed with variance"; requiresNote?: boolean }[] = [
  { label: "Refused", outcome: "Refused", care: "Not completed" },
  { label: "Unable", outcome: "Unable", care: "Not completed" },
  { label: "Resident Away", outcome: "Resident Away", care: "Not completed" },
  { label: "Condition Changed", outcome: "Condition Changed", care: "Not completed" },
  { label: "Completed Differently", outcome: "Increased Assist", care: "Completed with variance" },
  { label: "Other", outcome: "Other", care: "Not completed", requiresNote: true },
];

// ── One occurrence row ───────────────────────────────────────────────────────
function OccurrenceRowView({
  row, nowMin, busy, chartable, showNurseControls, onDone, onException,
}: {
  row: OccurrenceRow;
  nowMin: number;
  busy: boolean;
  chartable: boolean;
  showNurseControls: boolean;
  onDone: (row: OccurrenceRow) => void;
  onException: (row: OccurrenceRow) => void;
}) {
  const state = deriveState({ scheduledTime: row.scheduledTime, workflowState: row.workflowState } as OccLike, nowMin) as WorkflowState;
  const closed = state === "Closed" || state === "Cancelled";
  const def = row.definition;
  const assist = def?.assistanceLevel && (ASSISTANCE_DISPLAY as Record<string, string>)[def.assistanceLevel]
    ? ASSISTANCE_DISPLAY[def.assistanceLevel as Assistance]
    : (def?.assistanceLevel || "—");
  const critical = def?.criticality === "Critical" || def?.escalationPriority === "P1";

  // Execution detail chips the nurse set on the event (supervision/staffing/
  // equipment/technique/condition modifier + any attached order). Same fields the
  // Routine Review card shows, so the caregiver's open routine reflects them too.
  const detailChips = [
    def?.supervision, def?.staffing, def?.equipment, def?.technique, def?.conditionModifier,
    def?.orderRef ? `Order ${def.orderRef}` : null,
  ].map((v) => (v == null ? "" : String(v).trim())).filter(Boolean);

  const locked = !chartable && !closed;

  return (
    <tr className="border-t border-[var(--clinical-line)] align-top">
      <td className="px-2 py-2.5 whitespace-nowrap font-semibold tabular-nums text-[var(--clinical-ink)]">{to12h(row.scheduledTime)}</td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1.5">
          {critical && <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-coral)]" aria-label="Critical" />}
          <span className={`font-medium ${closed ? "text-[var(--clinical-muted)] line-through" : "text-[var(--clinical-ink)]"}`}>{def?.name || "Care task"}</span>
        </div>
        {def?.instructions && <p className="mt-0.5 text-[11px] text-[var(--clinical-muted)]">{def.instructions}</p>}
        {detailChips.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {detailChips.map((c) => (
              <span key={c} className="inline-flex items-center rounded-full border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--clinical-muted)]">{c}</span>
            ))}
          </div>
        )}
      </td>
      <td className="px-2 py-2.5 text-[var(--clinical-ink-soft)]">{assist}</td>
      <td className="px-2 py-2.5">
        <div className="flex items-center justify-end gap-1.5">
          {closed ? (
            <span className="text-[11px] font-semibold text-[var(--clinical-muted)]">Charted</span>
          ) : (
            <>
              <ClinicalButton size="sm" variant="primary" disabled={busy || locked} onClick={() => onDone(row)} aria-label={`Done — ${def?.name || "care"}`}>
                <CheckCircle2 className="h-4 w-4" /> Done
              </ClinicalButton>
              <ClinicalButton size="sm" variant="secondary" disabled={busy || locked} onClick={() => onException(row)} aria-label={`Log an exception for ${def?.name || "care"}`}>
                <AlertTriangle className="h-4 w-4" /> Exception
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
