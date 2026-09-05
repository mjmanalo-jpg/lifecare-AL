"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw, CheckCircle2, AlertTriangle, ShieldAlert, User2, Stethoscope,
  ListChecks, Lock,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import {
  ClinicalPage, ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill,
  DataState, StatCard, MicroLabel, SearchInput, ClinicalModal,
} from "./clinical-ui";

import { ASSESSMENTS_V42_KEY, type AssessmentV42 } from "@/lib/lifecare/assessment.ts";
import {
  generateRoutine, domainInputsFromItems,
  type RoutineRole, type RoutineShift, type RoutineTaskItem,
} from "@/lib/lifecare/carePlanRoutine.ts";
import {
  ROUTINE_COMPLETIONS_KEY, parseRoutineCompletions, upsertRoutineCompletion, careDay,
} from "@/lib/lifecare/routineCompletions.ts";
import { type Outcome } from "@/lib/lifecare/careEvents.ts";
import { MODEL_VERSION } from "@/lib/lifecare/dataset.ts";
import { domainInPackage, DOMAIN_LABEL, recordOutOfPackageService } from "@/lib/lifecare/carePackage";
import { upsertRecord } from "@/lib/api";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, activeResidentIdsFor } from "@/lib/caregiverSchedule";

/** One care window materialised for a resident's shift — a checklist of specific tasks. */
interface RoutineEncounter {
  windowId: string;
  label: string;
  window: string;
  shift: RoutineShift;
  shiftLabel: string;
  role: RoutineRole;
  domainCode: string | null;  // primary domain (package gating)
  careTaskId?: string;        // window's governed Care Task (variance/escalation scope)
  items: RoutineTaskItem[];   // the specific tasks (checklist rows)
}
const splitEncByRole = (encs: RoutineEncounter[]): Record<RoutineRole, RoutineEncounter[]> => ({
  Caregiver: encs.filter((e) => e.role === "Caregiver"),
  Nurse: encs.filter((e) => e.role === "Nurse"),
});

/**
 * Phase 3 — Today's Care shift board (standalone; the parent wires the tab).
 *
 * Turns each VALIDATED v4.2 assessment into a resident entry and materialises a
 * per-shift operational view via the LifeCare engine — but ONLY when the linked
 * resident has a RELEASED (ACTIVE) care plan (CL-13 / B5: routines activate from
 * an approved plan version alone; a validated assessment by itself never does).
 * The view is split into a Caregiver queue and a Nurse queue. Charting is
 * exception-first: one tap Completes an encounter, or an Exception modal captures
 * a structured outcome (Refused / Unable / Unsafe / Increased Assist / Frequency
 * Variance / Clinical Change) with a short observation. Every action writes a
 * CareEvent via the governed /api/care-events route.
 *
 * DATA SOURCE (self-contained, migration-free): reads the `assessments_v42`
 * app-setting plus the `care-plans` table for release state. Residents without
 * an ACTIVE plan stay listed but LOCKED — zero encounters, no charting.
 */

const MODEL_VERSION_STRING = `${MODEL_VERSION.assessmentVersion}/${MODEL_VERSION.careModelVersion}`;

/** Exception outcomes offered in the modal (the engine's non-expected outcomes). */
const EXCEPTION_CHOICES: { outcome: Outcome; help: string }[] = [
  { outcome: "Refused", help: "Resident declined the care" },
  { outcome: "Unable", help: "Could not deliver as planned" },
  { outcome: "Unsafe", help: "Unsafe to proceed — raises an incident" },
  { outcome: "Increased Assist", help: "Needed more help than planned" },
  { outcome: "Frequency Variance", help: "Delivered off the planned schedule" },
  { outcome: "Clinical Change", help: "New / changed clinical finding" },
];

/** Current shift label (matches Task Assignment's AM/PM/Noc windows). */
function shiftLabel(): string {
  const h = new Date().getHours();
  return h >= 6 && h < 14 ? "AM" : h >= 14 && h < 22 ? "PM" : "NOC";
}

/** Roles that see BOTH the Caregiver and Nurse queues. Caregivers see only their own. */
const NURSE_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN", "ORGANIZATION_ADMIN"]);

interface MaterialisedResident {
  assessmentId: string;
  residentId: string;      // real Resident id when resolved, else the assessment id
  residentName: string;
  linked: boolean;         // residentId points at a real Resident row (charting needs this)
  finalLevel: string;
  queues: Record<RoutineRole, RoutineEncounter[]>;
  total: number;           // specific tasks (checklist rows) due this shift
  locked?: boolean;        // no released (ACTIVE) care plan → routines stay locked
}

function parseAssessments(value: string | undefined): AssessmentV42[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? (v as AssessmentV42[]) : [];
  } catch { return []; }
}

/** Stable key per checklist item within a resident. */
const itemKey = (residentId: string, itemId: string) => `${residentId}::${itemId}`;

/** finalLevel ("L1".."L5") → level number 1–5 (defaults to 2 when unparseable). */
const levelFromFinal = (finalLevel: string): number => Number(/([1-5])/.exec(finalLevel || "")?.[1] || 2);

/** Is an encounter out of the resident's Level package? (null domain → never). */
const encOutOfPackage = (level: number, e: RoutineEncounter): boolean =>
  e.domainCode != null && !domainInPackage(level, e.domainCode);

// ── Caregiver time-gate ──────────────────────────────────────────────────────
// A caregiver can only work a window once it's near its time: the window appears
// 5 min before its start and stays open (charting as "late") after its end. This
// keeps caregivers charting against the live shift, not hours ahead. Supervisors
// (Nurse / Care Manager) are never gated.
const WINDOW_LEAD_MIN = 5;
/** Parse "HH:MM-HH:MM" → [startMin, endMin] from midnight. null (→ ungated) when
 * malformed or crossing midnight (end ≤ start), e.g. the NOC "12:00-02:00" window. */
function windowRange(win: string): [number, number] | null {
  const m = /(\d{1,2}):(\d{2})\D+(\d{1,2}):(\d{2})/.exec(win || "");
  if (!m) return null;
  const start = +m[1] * 60 + +m[2], end = +m[3] * 60 + +m[4];
  return end > start ? [start, end] : null;
}
/** Time-gate state for a window at `nowMin` (minutes from midnight). Ungated
 * windows are always visible and never late. */
function windowGate(win: string, nowMin: number): { visible: boolean; late: boolean; opensAt: string } {
  const r = windowRange(win);
  if (!r) return { visible: true, late: false, opensAt: "" };
  const open = r[0] - WINDOW_LEAD_MIN;
  const opensAt = `${String(Math.floor(open / 60)).padStart(2, "0")}:${String(open % 60).padStart(2, "0")}`;
  return { visible: nowMin >= open, late: nowMin > r[1], opensAt };
}
const OCCURRENCE_GRACE_MIN = 30; // an HF occurrence charts "late" this long after its scheduled time
const fmtMin = (m: number) => { const mm = (((m % 1440) + 1440) % 1440); return `${String(Math.floor(mm / 60)).padStart(2, "0")}:${String(mm % 60).padStart(2, "0")}`; };
/** Per-item gate: a high-frequency occurrence (scheduledMinutes set) gates on its
 * OWN scheduled time (+lead / +grace); every other item falls back to the window gate. */
function itemGate(scheduledMinutes: number | undefined, win: string, nowMin: number): { locked: boolean; late: boolean; opensAt: string } {
  if (scheduledMinutes != null) {
    const open = scheduledMinutes - WINDOW_LEAD_MIN;
    return { locked: nowMin < open, late: nowMin > scheduledMinutes + OCCURRENCE_GRACE_MIN, opensAt: fmtMin(open) };
  }
  const g = windowGate(win, nowMin);
  return { locked: !g.visible, late: g.late, opensAt: g.opensAt };
}

export default function TodaysCareBoard({ role, focusResidentId, embedded }: { role?: string; focusResidentId?: string; embedded?: boolean }) {
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>(
    "app-settings", { tables: ["AppSetting"] }
  );

  // Recent care events (today) — a light "what's been charted" panel.
  const { data: eventRows } = useLiveQuery<Record<string, unknown>>(
    "care-events", { query: "take=200", tables: ["CareEvent"] }
  );

  // Real Resident rows — a CareEvent needs a valid resident FK. An assessment that
  // isn't linked to an admitted resident (or is a pre-admission lead) has no real
  // id, so we resolve by id first, then by name; unresolved → charting is blocked.
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { tables: ["Resident"] });

  // Governed release state (CL-13 / B5): a resident's routines materialise ONLY
  // from a released care plan (status ACTIVE). A validated assessment alone is
  // never treated as approval.
  const { data: planRows } = useLiveQuery<Record<string, unknown>>(
    "care-plans", { query: "take=500", tables: ["CarePlan"] }
  );
  // First ACTIVE plan per resident (newest wins via orderBy startDate desc).
  const activePlanIdByResident = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of (planRows || [])) {
      const rid = String(p.residentId || "");
      if (!rid || String(p.status || "") !== "ACTIVE") continue;
      const pid = String(p.id || "");
      if (pid && !m.has(rid)) m.set(rid, pid);
    }
    return m;
  }, [planRows]);

  // Released task lines: each INTERVENTION item of a released plan carries a
  // [task:TASK-###] marker written at generation time. Encounters are built from
  // THIS selection — never from a fresh suggestion — so the shift view matches
  // exactly what was individualised and approved.
  const { data: planItemRows } = useLiveQuery<Record<string, unknown>>(
    "care-plan-items", { query: "take=1000", tables: ["CarePlanItem"] }
  );
  const taskIdsByPlan = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const it of (planItemRows || [])) {
      if (String(it.category || "") !== "INTERVENTION" || String(it.status || "") !== "ACTIVE") continue;
      const pid = String(it.carePlanId || "");
      const marker = /\[task:([A-Za-z0-9-]+)\]/.exec(String(it.description || ""));
      if (!pid || !marker) continue;
      const list = m.get(pid) ?? [];
      if (!list.includes(marker[1])) list.push(marker[1]);
      m.set(pid, list);
    }
    return m;
  }, [planItemRows]);
  // Per-domain care reconstructed from each plan's INTERVENTION items — the input to
  // the 24-hour routine generator (the same reconstruction the task cron uses).
  const domainInputsByPlan = useMemo(() => {
    const byPlan = new Map<string, { title?: string | null; description?: string | null }[]>();
    for (const it of (planItemRows || [])) {
      if (String(it.category || "") !== "INTERVENTION" || String(it.status || "") !== "ACTIVE") continue;
      const pid = String(it.carePlanId || ""); if (!pid) continue;
      (byPlan.get(pid) ?? byPlan.set(pid, []).get(pid)!).push({ title: String(it.title ?? ""), description: String(it.description ?? "") });
    }
    const m = new Map<string, ReturnType<typeof domainInputsFromItems>>();
    for (const [pid, items] of byPlan) m.set(pid, domainInputsFromItems(items));
    return m;
  }, [planItemRows]);
  const realResidents = useMemo(() => {
    const byId = new Set<string>();
    const byName = new Map<string, string>();
    for (const r of (residentRows || [])) {
      const id = String(r.id || ""); if (!id) continue;
      byId.add(id);
      const nm = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim().toLowerCase();
      if (nm && !byName.has(nm)) byName.set(nm, id);
    }
    return { byId, byName };
  }, [residentRows]);

  // ---- Current user identity (session → name + role) ------------------------
  const [me, setMe] = useState("");
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => {
        if (!d?.authenticated) return;
        setMe(d.session?.name ?? "");
        setSessionRole(d.session?.role ?? null);
        setUserId(String(d.session?.userId ?? ""));
      })
      .catch(() => { /* non-fatal */ });
  }, []);

  const effectiveRole = (sessionRole ?? role ?? "").toUpperCase();
  const showNurseQueue = effectiveRole ? NURSE_ROLES.has(effectiveRole) : true;
  const curShift = shiftLabel() as RoutineShift;

  // ---- Materialise shift views — gated on a RELEASED care plan ---------------
  const residents = useMemo<MaterialisedResident[]>(() => {
    const raw = parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value);
    const out: MaterialisedResident[] = [];
    for (const a of raw) {
      if (a.status !== "VALIDATED") continue;
      const finalLevel = a.layer3?.finalLevel;
      if (!finalLevel) continue;
      const name = a.layer1?.residentName || "Resident";
      const linkedId = (a.layer1?.residentId && realResidents.byId.has(a.layer1.residentId))
        ? a.layer1.residentId
        : realResidents.byName.get(name.trim().toLowerCase()) || "";
      // Governance gate: no released plan → list the resident but lock routines
      // (zero encounters, charting disabled). Fail closed on unresolved links.
      const releasedPlanId = linkedId ? activePlanIdByResident.get(linkedId) : undefined;
      const releasedTaskIds = releasedPlanId ? taskIdsByPlan.get(releasedPlanId) : undefined;
      if (!linkedId || !releasedPlanId || !releasedTaskIds?.length) {
        out.push({
          assessmentId: a.id,
          residentId: linkedId || a.id,
          residentName: name,
          linked: !!linkedId,
          finalLevel: String(finalLevel),
          queues: { Caregiver: [], Nurse: [] },
          total: 0,
          locked: true,
        });
        continue;
      }
      try {
        // Release verified above — build the resident's 24-hour routine from the
        // released plan's per-domain interventions, then keep only the CURRENT
        // shift's windows (so a caregiver sees only what's due now).
        // Attach each domain's assessed score so the generator can expand
        // high-frequency domains (reposition / toileting / hydration) into timed
        // occurrences. Score comes from the validated assessment (the released
        // plan items don't carry it).
        const scored = (domainInputsByPlan.get(releasedPlanId) || []).map((d) => {
          const sc = a.domains?.[d.code]?.score;
          return typeof sc === "number" ? { ...d, score: sc } : d;
        });
        const events = generateRoutine(scored)
          .filter((ev) => ev.shift === curShift);
        const encs: RoutineEncounter[] = events.map((ev) => ({
          windowId: ev.id,
          label: ev.label,
          window: ev.window,
          shift: ev.shift,
          shiftLabel: ev.shiftLabel,
          role: ev.role,
          domainCode: ev.domainCodes[0] ?? null,
          careTaskId: ev.careTaskId,
          items: ev.items,
        }));
        if (!encs.length) continue;
        out.push({
          assessmentId: a.id,
          residentId: linkedId,
          residentName: name,
          linked: true,
          finalLevel: String(finalLevel),
          queues: splitEncByRole(encs),
          total: encs.reduce((n, e) => n + e.items.length, 0),
        });
      } catch { /* a bad line shouldn't sink the whole board */ }
    }
    return out.sort((x, y) => x.residentName.localeCompare(y.residentName));
  }, [settingRows, realResidents, activePlanIdByResident, taskIdsByPlan, domainInputsByPlan, curShift]);

  // ---- Schedule routing: a CAREGIVER sees only the residents routed to them
  // today (caregiver_schedules); nurses / care managers keep the full oversight
  // view. Unresolved role/user → unscoped until the session lands. ------------
  const isCaregiverView = effectiveRole === "CAREGIVER";
  // Re-evaluate the time-gate every 30s so a window appears (5 min before start)
  // or flips to "late" without the caregiver refreshing.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNowTick(Date.now()), 30_000); return () => clearInterval(t); }, []);
  const nowMin = useMemo(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }, [nowTick]);
  const myResidentIds = useMemo(() => {
    if (!isCaregiverView || !userId) return null; // null = unscoped
    const schedules = parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value);
    return new Set(activeResidentIdsFor(userId, schedules, new Date(), "Asia/Manila"));
  }, [isCaregiverView, userId, settingRows]);
  const visibleResidents = useMemo(
    () => {
      // Embedded single-resident view (caregiver "Open routine" on the My Shift
      // dashboard): scope to just the tapped resident. The caller already
      // authorised this resident, so bypass the caregiver-schedule scope — it uses
      // a different mechanism and would otherwise hide a validly-assigned resident.
      if (focusResidentId) return residents.filter((r) => r.residentId === focusResidentId);
      return myResidentIds ? residents.filter((r) => r.linked && myResidentIds.has(r.residentId)) : residents;
    },
    [residents, myResidentIds, focusResidentId],
  );

  // ---- Selection + search ---------------------------------------------------
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? visibleResidents.filter((r) => r.residentName.toLowerCase().includes(q)) : visibleResidents;
  }, [visibleResidents, search]);

  // Default to the first resident once data lands / narrows. Done during render
  // (React's "derive state from props" pattern) rather than in an effect, to
  // avoid a cascading-render setState-in-effect.
  const desiredId = (selectedId && filtered.some((r) => r.residentId === selectedId))
    ? selectedId
    : filtered[0]?.residentId ?? null;
  if (desiredId !== selectedId) setSelectedId(desiredId);

  const selected = useMemo(
    () => residents.find((r) => r.residentId === selectedId) ?? null,
    [residents, selectedId]
  );

  // ---- Charted state (per specific task) ------------------------------------
  // Each checklist row's outcome persists in the `routine_completions` app-setting
  // (keyed care-day|resident|itemId), so a tick survives a refresh; merged with an
  // optimistic session map for instant feedback after a tap.
  const [charted, setCharted] = useState<Map<string, Outcome>>(new Map());
  const today = careDay();
  const chartedPersisted = useMemo(() => {
    const map = parseRoutineCompletions(settingRows.find((r) => (r.key || r.id) === ROUTINE_COMPLETIONS_KEY)?.value);
    const m = new Map<string, Outcome>();
    const prefix = `${today}|`;
    for (const [k, c] of Object.entries(map)) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length); // `${residentId}|${itemId}`
      const sep = rest.indexOf("|"); if (sep < 0) continue;
      m.set(itemKey(rest.slice(0, sep), rest.slice(sep + 1)), c.outcome as Outcome);
    }
    return m;
  }, [settingRows, today]);
  const chartedAll = useMemo(() => {
    const m = new Map(chartedPersisted);
    for (const [k, v] of charted) m.set(k, v);
    return m;
  }, [chartedPersisted, charted]);

  // Latest settings snapshot for a clobber-free per-item completion write.
  const settingRowsRef = useRef(settingRows);
  useEffect(() => { settingRowsRef.current = settingRows; }, [settingRows]);
  const persistCompletion = async (residentId: string, itemId: string, outcome: Outcome) => {
    const cur = parseRoutineCompletions(settingRowsRef.current.find((r) => (r.key || r.id) === ROUTINE_COMPLETIONS_KEY)?.value);
    const next = upsertRoutineCompletion(cur, today, residentId, itemId, { outcome, at: new Date().toISOString(), by: me || undefined });
    await upsertRecord("app-settings", ROUTINE_COMPLETIONS_KEY, { key: ROUTINE_COMPLETIONS_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  // ---- Exception modal ------------------------------------------------------
  const [exceptionFor, setExceptionFor] = useState<{ enc: RoutineEncounter; item: RoutineTaskItem } | null>(null);
  const [exOutcome, setExOutcome] = useState<Outcome>("Refused");
  const [exObservation, setExObservation] = useState("");
  const [busy, setBusy] = useState(false);

  const chartEvent = async (
    enc: RoutineEncounter,
    item: RoutineTaskItem,
    outcome: Outcome,
    observation: string,
  ) => {
    if (!selected) return;
    // Time-gate (caregiver view): a task is chartable only from 5 min before its
    // time — the window's start, or a high-frequency occurrence's own scheduled
    // time. Buttons are disabled when locked, but guard so a stale client can't
    // chart something that hasn't opened yet.
    if (isCaregiverView) {
      const g = itemGate(item.scheduledMinutes, enc.window, nowMin);
      if (g.locked) {
        Swal.fire({ title: "Not open yet", text: `This opens at ${g.opensAt} (5 min before it begins).`, icon: "info" });
        return;
      }
    }
    // Governance gate (CL-13 / B5): charting is only possible against routines
    // that came from a RELEASED care plan. Locked residents have no encounters,
    // but guard anyway so a stale client can never chart around the gate.
    if (selected.locked) {
      Swal.fire({
        title: "Care plan not released",
        text: `${selected.residentName} has no released (ACTIVE) care plan yet, so shift care can't be charted. A nurse must individualise and release the plan first.`,
        icon: "warning",
      });
      return;
    }
    // A care event needs a real resident FK. If this assessment isn't linked to an
    // admitted resident yet, charting would fail with a FK error — block clearly.
    if (!selected.linked) {
      Swal.fire({
        title: "Not linked to a resident",
        text: `${selected.residentName}'s assessment isn't linked to an admitted resident record yet, so care can't be charted. Complete their admission / link the resident first.`,
        icon: "warning",
      });
      return;
    }
    // LOC package gate — charting care outside the resident's Level package is an
    // Additional Clinical Service (DT-014): warn (never block), flag on proceed.
    const level = levelFromFinal(selected.finalLevel);
    const code = enc.domainCode;
    const gated = code != null && !domainInPackage(level, code);
    if (gated && code) {
      const proceed = await Swal.fire({
        title: "Outside care package",
        text: `${DOMAIN_LABEL[code] ?? enc.label} is not in ${selected.residentName}'s Level ${level} package. Care outside the package is an Additional Clinical Service and may be chargeable (DT-014). Proceed anyway?`,
        icon: "warning", showCancelButton: true, confirmButtonColor: "#d97706",
        confirmButtonText: "Proceed & flag for DT-014", cancelButtonText: "Cancel",
      });
      if (!proceed.isConfirmed) return;
    }
    const key = itemKey(selected.residentId, item.id);
    // Charted after the window's end (caregiver view only) → mark it late in the
    // record. No `late` column exists, so it rides in the observation text.
    // ponytail: observation-encoded late flag; promote to a column if late needs querying.
    const isLate = isCaregiverView && itemGate(item.scheduledMinutes, enc.window, nowMin).late;
    // Optimistic: tick the item immediately so the tap feels instant. Each
    // round-trip to the remote pooler is ~1s from here; don't make the caregiver
    // watch a spinner for the persist. We revert the tick if the POST fails.
    setCharted((prev) => new Map(prev).set(key, outcome));
    setBusy(true);
    // Out-of-package logging is best-effort (swallows its own errors) — fire it
    // in the background instead of blocking the tick on 2 extra round-trips.
    if (gated && code) void recordOutOfPackageService({ residentId: selected.residentId, residentName: selected.residentName, domainCode: code, domainLabel: DOMAIN_LABEL[code] ?? enc.label, level, by: me || undefined, notes: observation.trim() || undefined });
    try {
      // Chart through the GOVERNED care-events route (not the generic /api/db
      // route) so exceptions fire their escalation / nurse-notification /
      // repeat-variance review server-side. careTaskId scopes the variance count;
      // the specific task text rides in the observation so the record names it.
      const res = await fetch("/api/care-events", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          residentId: selected.residentId,
          careTaskId: enc.careTaskId || undefined,
          domain: enc.label,
          outcome,
          observation: isLate ? `⏰ Late — ${observation.trim() || item.text}` : (observation.trim() || item.text) || undefined,
          exceptionDetail: outcome === "Completed" ? undefined : observation.trim() || undefined,
          shift: curShift,
          actorName: me || undefined,
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((json as { error?: string })?.error || "Could not chart the care event.");
      // Persist the per-item completion (survives refresh).
      void persistCompletion(selected.residentId, item.id, outcome);
      const escalated = !!(json as { escalated?: boolean }).escalated;
      const reviewFlagged = !!(json as { reviewAlertRaised?: boolean }).reviewAlertRaised;
      const notified = !!(json as { notified?: boolean }).notified;
      Swal.fire({
        toast: true, position: "top-end", icon: outcome === "Completed" ? "success" : escalated ? "warning" : "info",
        title: outcome === "Completed"
          ? "Charted complete"
          : escalated ? `Charted: ${outcome} · nurse alerted + escalation raised`
          : reviewFlagged ? `Charted: ${outcome} · reassessment flagged`
          : notified ? `Charted: ${outcome} · nurse notified` : `Charted: ${outcome}`,
        showConfirmButton: false, timer: escalated || reviewFlagged ? 2400 : 1400,
      });
    } catch (err) {
      // Persist failed — roll back the optimistic tick so the item is chartable again.
      setCharted((prev) => { const m = new Map(prev); m.delete(key); return m; });
      Swal.fire({ title: "Could not chart", text: err instanceof Error ? err.message : "Please try again.", icon: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openException = (enc: RoutineEncounter, item: RoutineTaskItem) => {
    setExOutcome("Refused");
    setExObservation("");
    setExceptionFor({ enc, item });
  };
  const submitException = async () => {
    if (!exceptionFor) return;
    await chartEvent(exceptionFor.enc, exceptionFor.item, exOutcome, exObservation);
    setExceptionFor(null);
  };

  // ---- Today's charted feed -------------------------------------------------
  const chartedToday = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    return eventRows
      .filter((r) => {
        const at = r.occurredAt ?? r.createdAt;
        const ts = at ? new Date(String(at)).getTime() : 0;
        return !Number.isNaN(ts) && ts >= startMs;
      })
      .sort((a, b) => String(b.occurredAt ?? b.createdAt ?? "").localeCompare(String(a.occurredAt ?? a.createdAt ?? "")))
      .slice(0, 12);
  }, [eventRows]);

  const shift = shiftLabel();

  const body = (
    <>
      {!embedded && (
      <ClinicalHeader
        title="Today's Care"
        subtitle="Only what must happen now — bundled into the encounters staff perform together, split into caregiver and nurse queues. Chart by exception: one tap to complete, or record a structured exception."
        right={
          <div className="flex items-center gap-2">
            <StatusPill status="ACTIVE">{shift} shift</StatusPill>
            <ClinicalButton variant="secondary" size="sm" onClick={() => refetch()} aria-label="Refresh">
              <RefreshCw className="h-4 w-4" /> Refresh
            </ClinicalButton>
          </div>
        }
      />
      )}

      {!embedded && (
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={isCaregiverView ? "My residents today" : "Residents on shift"} value={visibleResidents.length} accent="teal" />
        <StatCard label="Encounters (selected)" value={selected?.total ?? 0} accent="ink" />
        <StatCard label="Charted today" value={chartedToday.length} accent="green" />
        <StatCard label="Model" value={MODEL_VERSION_STRING} accent="amber" />
      </div>
      )}

      <div className={`${embedded ? "" : "mt-5 "}grid grid-cols-1 gap-5${focusResidentId ? "" : " lg:grid-cols-[300px_1fr]"}`}>
        {/* ---- Resident selector — hidden only when scoped to a single resident
             (Open routine); kept for the all-residents "Today" modal. ---- */}
        {!focusResidentId && (
        <ClinicalCard top="teal" className="p-4">
          <MicroLabel>Residents</MicroLabel>
          <div className="mt-3">
            <SearchInput value={search} onChange={setSearch} placeholder="Search residents…" />
          </div>
          <div className="mt-3">
            <DataState
              loading={loading && residents.length === 0}
              error={error}
              empty={!loading && filtered.length === 0}
              emptyTitle={myResidentIds && !search ? "No residents assigned today" : "No validated plans"}
              emptyHint={myResidentIds && !search
                ? "You're not scheduled for any residents today. Residents appear here once a nurse assigns them to your shift."
                : "A resident's shift care appears once their v4.2 assessment is validated AND their care plan is individualised and released (ACTIVE). Residents awaiting release show as locked."}
              onRetry={refetch}
              skeletonRows={4}
            >
              <ul className="space-y-2">
                {filtered.map((r) => {
                  const active = r.residentId === selectedId;
                  return (
                    <li key={r.residentId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(r.residentId)}
                        className={`w-full min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${
                          active
                            ? "border-[var(--clinical-panel)] bg-[var(--clinical-surface-2)]"
                            : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] hover:bg-[var(--clinical-surface-2)]"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span className="block truncate text-sm font-semibold text-[var(--clinical-ink)]">{r.residentName}</span>
                          {!r.linked && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 18%, transparent)", color: "var(--clinical-amber)" }} title="Assessment not linked to an admitted resident — charting is disabled">Unlinked</span>}
                          {r.linked && r.locked && <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-amber) 18%, transparent)", color: "var(--clinical-amber)" }} title="No released care plan — routines stay locked until the plan is approved">Awaiting release</span>}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--clinical-muted)]">
                          <span>Level {r.finalLevel}</span>
                          <span aria-hidden>·</span>
                          <span>{r.total} encounter{r.total === 1 ? "" : "s"}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </DataState>
          </div>
        </ClinicalCard>
        )}

        {/* ---- Selected resident's shift view ---- */}
        <div className="min-w-0 space-y-5">
          {!selected ? (
            <ClinicalCard className="p-10 text-center">
              <p className="text-sm text-[var(--clinical-muted)]">{embedded && focusResidentId ? "No active routine for this resident yet — a routine appears once their v4.2 assessment is validated and their care plan is released (ACTIVE)." : "Select a resident to view their shift care."}</p>
            </ClinicalCard>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--clinical-ink)]">{selected.residentName}</h2>
                <StatusPill status="APPROVED">Level {selected.finalLevel}</StatusPill>
              </div>

              {selected.locked ? (
                <ClinicalCard className="p-6">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[var(--clinical-amber)]" />
                    <div>
                      <p className="text-sm font-semibold text-[var(--clinical-ink)]">Routines locked — no released care plan</p>
                      <p className="mt-1 text-sm text-[var(--clinical-muted)]">
                        {selected.linked
                          ? "Shift care activates only from a released (ACTIVE) care plan. Once the nurse individualises and releases the plan in Care Plan Review, today's encounters appear here."
                          : "This assessment isn't linked to an admitted resident yet. Complete admission / linking first — then release a care plan to activate routines."}
                      </p>
                    </div>
                  </div>
                </ClinicalCard>
              ) : (
                <>
              {/* Caregiver queue */}
              <QueueSection
                title="Caregiver queue"
                icon={<User2 className="h-4 w-4" />}
                encounters={selected.queues.Caregiver}
                residentId={selected.residentId}
                level={levelFromFinal(selected.finalLevel)}
                charted={chartedAll}
                busy={busy}
                gated={isCaregiverView}
                nowMin={nowMin}
                onComplete={(enc, item) => chartEvent(enc, item, "Completed", "")}
                onException={openException}
              />

              {/* Nurse queue — hidden from caregivers */}
              {showNurseQueue && (
                <QueueSection
                  title="Nurse queue"
                  icon={<Stethoscope className="h-4 w-4" />}
                  encounters={selected.queues.Nurse}
                  residentId={selected.residentId}
                  level={levelFromFinal(selected.finalLevel)}
                  charted={chartedAll}
                  busy={busy}
                  gated={false}
                  nowMin={nowMin}
                  onComplete={(enc, item) => chartEvent(enc, item, "Completed", "")}
                  onException={openException}
                />
              )}
                </>
              )}
            </>
          )}

          {/* Recent charted feed */}
          <ClinicalCard className="p-4">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-[var(--clinical-muted)]" />
              <MicroLabel>Charted today</MicroLabel>
            </div>
            {chartedToday.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--clinical-muted)]">Nothing charted yet today.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--clinical-line)]">
                {chartedToday.map((e, i) => {
                  const outcome = String(e.outcome ?? "");
                  const when = (() => {
                    const at = e.occurredAt ?? e.createdAt;
                    const d = at ? new Date(String(at)) : null;
                    return d && !Number.isNaN(d.getTime())
                      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "";
                  })();
                  return (
                    <li key={String(e.id ?? i)} className="flex items-center gap-2 py-2 text-sm">
                      <StatusPill status={outcome === "Completed" ? "COMPLETED" : "REFUSED"}>{outcome}</StatusPill>
                      <span className="truncate text-[var(--clinical-ink)]">
                        {String(e.residentName ?? "Resident")}
                        {e.domain ? ` · ${String(e.domain)}` : ""}
                      </span>
                      <span className="ml-auto shrink-0 text-[11px] text-[var(--clinical-muted)]">{when}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </ClinicalCard>
        </div>
      </div>

      {/* ---- Exception modal ---- */}
      <ClinicalModal
        open={!!exceptionFor}
        onClose={() => setExceptionFor(null)}
        title="Record an exception"
        description={exceptionFor ? `${exceptionFor.item.text} — ${exceptionFor.enc.label}` : undefined}
        size="md"
        footer={
          <>
            <ClinicalButton variant="secondary" onClick={() => setExceptionFor(null)} disabled={busy}>Cancel</ClinicalButton>
            <ClinicalButton variant="danger" onClick={submitException} disabled={busy}>
              {busy ? "Charting…" : "Chart exception"}
            </ClinicalButton>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <MicroLabel>Outcome</MicroLabel>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EXCEPTION_CHOICES.map((c) => {
                const active = exOutcome === c.outcome;
                return (
                  <button
                    key={c.outcome}
                    type="button"
                    onClick={() => setExOutcome(c.outcome)}
                    className={`min-h-14 rounded-xl border px-3 py-2.5 text-left transition ${
                      active
                        ? "border-[var(--clinical-coral)] bg-[var(--clinical-surface-2)]"
                        : "border-[var(--clinical-line)] bg-[var(--clinical-surface)] hover:bg-[var(--clinical-surface-2)]"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--clinical-ink)]">
                      {(c.outcome === "Unsafe" || c.outcome === "Clinical Change") && <ShieldAlert className="h-3.5 w-3.5 text-[var(--clinical-coral)]" />}
                      {c.outcome}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[var(--clinical-muted)]">{c.help}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* Caregivers chart by structured outcome only — no free-text entry.
              Nurses/care managers keep an optional observation note. */}
          {!isCaregiverView && (
            <div>
              <MicroLabel>Observation (optional)</MicroLabel>
              <textarea
                value={exObservation}
                onChange={(e) => setExObservation(e.target.value)}
                rows={3}
                placeholder="Short note — what happened, what you did."
                className="mt-2 w-full resize-y rounded-lg border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface)] px-3 py-2.5 text-sm text-[var(--clinical-ink)] outline-none transition placeholder:text-[var(--clinical-muted)] focus:border-[var(--clinical-panel)] focus:ring-2 focus:ring-[var(--clinical-panel)]/20"
              />
            </div>
          )}
        </div>
      </ClinicalModal>
    </>
  );
  return embedded ? <div>{body}</div> : <ClinicalPage>{body}</ClinicalPage>;
}

// ---------------------------------------------------------------------------
// Queue section — a labelled stack of encounter cards for one role.
// ---------------------------------------------------------------------------
function QueueSection({
  title, icon, encounters, residentId, level, charted, busy, gated, nowMin, onComplete, onException,
}: {
  title: string;
  icon: React.ReactNode;
  encounters: RoutineEncounter[];
  residentId: string;
  level: number;
  charted: Map<string, Outcome>;
  busy: boolean;
  gated: boolean;   // caregiver time-gate on (hide windows until 5 min before start)
  nowMin: number;   // current minutes-from-midnight (drives the gate)
  onComplete: (enc: RoutineEncounter, item: RoutineTaskItem) => void;
  onException: (enc: RoutineEncounter, item: RoutineTaskItem) => void;
}) {
  const taskCount = encounters.reduce((n, e) => n + e.items.length, 0);
  return (
    <ClinicalCard className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-[var(--clinical-muted)]">{icon}</span>
        <MicroLabel>{title}</MicroLabel>
        <span className="ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-[var(--clinical-surface-2)] px-1.5 text-xs font-semibold text-[var(--clinical-ink)]">
          {taskCount}
        </span>
      </div>
      {encounters.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--clinical-muted)]">Nothing due this shift.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {encounters.map((enc) => (
            <EncounterCard
              key={`${residentId}::${enc.windowId}`}
              enc={enc}
              outOfPackage={encOutOfPackage(level, enc)}
              level={level}
              residentId={residentId}
              charted={charted}
              busy={busy}
              gated={gated}
              nowMin={nowMin}
              onComplete={onComplete}
              onException={onException}
            />
          ))}
        </div>
      )}
    </ClinicalCard>
  );
}

// ---------------------------------------------------------------------------
// Encounter card — one care WINDOW as a checklist of specific tasks. Each task
// is individually completed (1 tap) or excepted (structured picker) and counted.
// ---------------------------------------------------------------------------
function EncounterCard({
  enc, outOfPackage, level, residentId, charted, busy, gated, nowMin, onComplete, onException,
}: {
  enc: RoutineEncounter;
  outOfPackage: boolean;
  level: number;
  residentId: string;
  charted: Map<string, Outcome>;
  busy: boolean;
  gated: boolean;   // caregiver time-gate on
  nowMin: number;   // current minutes-from-midnight (drives the gate)
  onComplete: (enc: RoutineEncounter, item: RoutineTaskItem) => void;
  onException: (enc: RoutineEncounter, item: RoutineTaskItem) => void;
}) {
  const doneCount = enc.items.filter((it) => charted.get(itemKey(residentId, it.id))).length;
  // Window-level gate governs the bundled (non-timed) tasks; high-frequency
  // occurrences carry their own scheduledMinutes and gate per row below. Only show
  // the window badge when there ARE bundled tasks it applies to.
  const hasBundled = enc.items.some((it) => it.scheduledMinutes == null);
  const winG = gated ? itemGate(undefined, enc.window, nowMin) : { locked: false, late: false, opensAt: "" };
  return (
    <div
      className="rounded-xl border p-3.5"
      style={{
        borderColor: outOfPackage ? "var(--clinical-amber)" : "var(--clinical-line)",
        backgroundColor: "var(--clinical-surface)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--clinical-ink)]">{enc.label}</p>
          <p className="mt-0.5 text-[11px] text-[var(--clinical-muted)]">{enc.shiftLabel} · {enc.window} · {enc.role}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {outOfPackage && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em]" style={{ borderColor: "var(--clinical-amber)", color: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 12%, transparent)" }} title="Additional Clinical Service (DT-014)">Not in L{level} package</span>
          )}
          {hasBundled && winG.locked && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em] text-[var(--clinical-muted)]" title={`This window opens at ${winG.opensAt || "its start time"} (5 min before it begins)`}>
              <Lock className="h-3 w-3" /> Opens {winG.opensAt}
            </span>
          )}
          {hasBundled && winG.late && !winG.locked && (
            <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em] text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300" title="This window's time has passed — completions chart as late">Ended · late</span>
          )}
          <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-full bg-[var(--clinical-surface-2)] px-1.5 text-[11px] font-semibold text-[var(--clinical-ink)]" title="Tasks completed in this window">{doneCount}/{enc.items.length}</span>
        </div>
      </div>

      <ul className="mt-3 space-y-2">
        {enc.items.map((it) => {
          const outcome = charted.get(itemKey(residentId, it.id));
          const done = !!outcome;
          // Per-item gate: high-frequency occurrences gate on their own scheduled
          // time; other tasks fall back to the window gate.
          const g = gated ? itemGate(it.scheduledMinutes, enc.window, nowMin) : { locked: false, late: false, opensAt: "" };
          const hf = it.scheduledMinutes != null;
          return (
            <li key={it.id} className="flex items-start gap-2 rounded-lg border p-2.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: done ? "var(--clinical-surface-2)" : "var(--clinical-surface)", opacity: !done && g.locked ? 0.6 : 1 }}>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${done ? "text-[var(--clinical-muted)] line-through" : "text-[var(--clinical-ink)]"}`}>{it.text}</p>
                {done && <span className="mt-1 inline-block"><StatusPill status={outcome === "Completed" ? "COMPLETED" : "REFUSED"}>{outcome}</StatusPill></span>}
                {/* HF occurrences show their own lock / late state on the row. */}
                {!done && hf && g.locked && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full border border-[var(--clinical-line-strong)] bg-[var(--clinical-surface-2)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em] text-[var(--clinical-muted)]"><Lock className="h-3 w-3" /> Opens {g.opensAt}</span>
                )}
                {!done && hf && g.late && (
                  <span className="mt-1 inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em] text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300" title="Scheduled time has passed — charts as late">Late</span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <ClinicalButton size="sm" variant={done ? "secondary" : "primary"} onClick={() => onComplete(enc, it)} disabled={done || g.locked} aria-label={`Complete ${it.text}`}>
                  {g.locked ? <Lock className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} {done ? "Done" : "Complete"}
                </ClinicalButton>
                <ClinicalButton size="sm" variant="secondary" onClick={() => onException(enc, it)} disabled={done || g.locked} aria-label={`Record an exception for ${it.text}`}>
                  <AlertTriangle className="h-4 w-4" />
                </ClinicalButton>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
