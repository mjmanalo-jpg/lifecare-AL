"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw, CheckCircle2, AlertTriangle, ShieldAlert, User2, Stethoscope,
  ClipboardList, ListChecks,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import {
  ClinicalPage, ClinicalHeader, ClinicalCard, ClinicalButton, StatusPill,
  DataState, StatCard, MicroLabel, SearchInput, ClinicalModal,
} from "./clinical-ui";

import { ASSESSMENTS_V42_KEY, domainScores, type AssessmentV42 } from "@/lib/lifecare/assessment.ts";
import { generateDraftPlan, suggestTaskIds } from "@/lib/lifecare/carePlan.ts";
import {
  materialiseShiftView, splitByRole,
  type ShiftEncounter, type ShiftRole,
} from "@/lib/lifecare/todaysCare.ts";
import { type Outcome } from "@/lib/lifecare/careEvents.ts";
import { MODEL_VERSION } from "@/lib/lifecare/dataset.ts";
import { domainCodeFromLabel, domainInPackage, DOMAIN_LABEL, recordOutOfPackageService } from "@/lib/lifecare/carePackage";
import { CAREGIVER_SCHEDULE_KEY, parseSchedules, activeResidentIdsFor } from "@/lib/caregiverSchedule";

/**
 * Phase 3 — Today's Care shift board (standalone; the parent wires the tab).
 *
 * Turns each VALIDATED v4.2 assessment (whose plan we treat as the resident's
 * APPROVED routine source) into a per-shift operational view via the LifeCare
 * engine, split into a Caregiver queue and a Nurse queue. Charting is
 * exception-first: one tap Completes an encounter, or an Exception modal captures
 * a structured outcome (Refused / Unable / Unsafe / Increased Assist / Frequency
 * Variance / Clinical Change) with a short observation. Every action writes a
 * CareEvent via the generic /api/db/care-events route.
 *
 * DATA SOURCE (self-contained, migration-free): reads the `assessments_v42`
 * app-setting, keeps VALIDATED rows with a Layer-3 finalLevel, and materialises
 * the plan client-side. No new store is introduced.
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
  queues: Record<ShiftRole, ShiftEncounter[]>;
  total: number;
}

function parseAssessments(value: string | undefined): AssessmentV42[] {
  if (!value) return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? (v as AssessmentV42[]) : [];
  } catch { return []; }
}

/** Stable key per encounter within a resident (bundle is unique in the view). */
const encKey = (residentId: string, e: ShiftEncounter) => `${residentId}::${e.bundle}`;

/** finalLevel ("L1".."L5") → level number 1–5 (defaults to 2 when unparseable). */
const levelFromFinal = (finalLevel: string): number => Number(/([1-5])/.exec(finalLevel || "")?.[1] || 2);

/** Resolve an encounter's AS-domain (via its bundle label). null = don't gate. */
const encDomainCode = (e: ShiftEncounter) => domainCodeFromLabel(e.label);

/** Is an encounter out of the resident's Level package? (null domain → never). */
const encOutOfPackage = (level: number, e: ShiftEncounter): boolean => {
  const code = encDomainCode(e);
  return code != null && !domainInPackage(level, code);
};

export default function TodaysCareBoard({ role }: { role?: string }) {
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

  // ---- Materialise every validated assessment into a shift view -------------
  const residents = useMemo<MaterialisedResident[]>(() => {
    const raw = parseAssessments(settingRows.find((r) => (r.key || r.id) === ASSESSMENTS_V42_KEY)?.value);
    const out: MaterialisedResident[] = [];
    for (const a of raw) {
      if (a.status !== "VALIDATED") continue;
      const finalLevel = a.layer3?.finalLevel;
      if (!finalLevel) continue;
      try {
        const draft = generateDraftPlan({
          finalLevel,
          lines: suggestTaskIds(domainScores(a)).map((taskId) => ({ taskId })),
        });
        const view = materialiseShiftView({ ...draft, status: "APPROVED" });
        if (!view.length) continue;
        const queues = splitByRole(view);
        const name = a.layer1?.residentName || "Resident";
        const linkedId = (a.layer1?.residentId && realResidents.byId.has(a.layer1.residentId))
          ? a.layer1.residentId
          : realResidents.byName.get(name.trim().toLowerCase()) || "";
        out.push({
          assessmentId: a.id,
          residentId: linkedId || a.id,
          residentName: name,
          linked: !!linkedId,
          finalLevel: String(finalLevel),
          queues,
          total: view.length,
        });
      } catch { /* a bad line shouldn't sink the whole board */ }
    }
    return out.sort((x, y) => x.residentName.localeCompare(y.residentName));
  }, [settingRows, realResidents]);

  // ---- Schedule routing: a CAREGIVER sees only the residents routed to them
  // today (caregiver_schedules); nurses / care managers keep the full oversight
  // view. Unresolved role/user → unscoped until the session lands. ------------
  const isCaregiverView = effectiveRole === "CAREGIVER";
  const myResidentIds = useMemo(() => {
    if (!isCaregiverView || !userId) return null; // null = unscoped
    const schedules = parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value);
    return new Set(activeResidentIdsFor(userId, schedules, new Date(), "Asia/Manila"));
  }, [isCaregiverView, userId, settingRows]);
  const visibleResidents = useMemo(
    () => (myResidentIds ? residents.filter((r) => r.linked && myResidentIds.has(r.residentId)) : residents),
    [residents, myResidentIds],
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

  // ---- Charted state --------------------------------------------------------
  // Derived from the PERSISTED care events (today) so a card stays "charted"
  // across refreshes, merged with an optimistic session map for instant feedback
  // after a tap. Keyed `${residentId}::${bundle}` to match encKey().
  const [charted, setCharted] = useState<Map<string, Outcome>>(new Map());
  const chartedFromEvents = useMemo(() => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    const m = new Map<string, Outcome>();
    for (const e of (eventRows || [])) {
      const rid = String(e.residentId || ""); const bundle = String(e.bundle || "");
      if (!rid || !bundle) continue;
      const t = new Date(String(e.createdAt || e.occurredAt || "")).getTime();
      if (isNaN(t) || t < startMs) continue;
      m.set(`${rid}::${bundle}`, (String(e.outcome || "Completed")) as Outcome);
    }
    return m;
  }, [eventRows]);
  // Session (optimistic) entries win over the persisted snapshot.
  const chartedAll = useMemo(() => {
    const m = new Map(chartedFromEvents);
    for (const [k, v] of charted) m.set(k, v);
    return m;
  }, [chartedFromEvents, charted]);

  // ---- Exception modal ------------------------------------------------------
  const [exceptionFor, setExceptionFor] = useState<ShiftEncounter | null>(null);
  const [exOutcome, setExOutcome] = useState<Outcome>("Refused");
  const [exObservation, setExObservation] = useState("");
  const [busy, setBusy] = useState(false);

  const chartEvent = async (
    enc: ShiftEncounter,
    outcome: Outcome,
    observation: string,
  ) => {
    if (!selected) return;
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
    const code = encDomainCode(enc);
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
    setBusy(true);
    try {
      // Chart through the GOVERNED care-events route (not the generic /api/db
      // route) so exceptions fire their escalation / nurse-notification /
      // repeat-variance review server-side. careTaskId scopes the variance count.
      const res = await fetch("/api/care-events", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({
          residentId: selected.residentId,
          careTaskId: enc.taskIds[0] || undefined,
          domain: enc.label,
          outcome,
          observation: observation.trim() || undefined,
          exceptionDetail: outcome === "Completed" ? undefined : observation.trim() || undefined,
          shift: shiftLabel(),
          actorName: me || undefined,
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) throw new Error((json as { error?: string })?.error || "Could not chart the care event.");
      if (gated && code) await recordOutOfPackageService({ residentId: selected.residentId, residentName: selected.residentName, domainCode: code, domainLabel: DOMAIN_LABEL[code] ?? enc.label, level, by: me || undefined, notes: observation.trim() || undefined });
      setCharted((prev) => new Map(prev).set(encKey(selected.residentId, enc), outcome));
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
      Swal.fire({ title: "Could not chart", text: err instanceof Error ? err.message : "Please try again.", icon: "error" });
    } finally {
      setBusy(false);
    }
  };

  const openException = (enc: ShiftEncounter) => {
    setExOutcome("Refused");
    setExObservation("");
    setExceptionFor(enc);
  };
  const submitException = async () => {
    if (!exceptionFor) return;
    await chartEvent(exceptionFor, exOutcome, exObservation);
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

  return (
    <ClinicalPage>
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

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label={isCaregiverView ? "My residents today" : "Residents on shift"} value={visibleResidents.length} accent="teal" />
        <StatCard label="Encounters (selected)" value={selected?.total ?? 0} accent="ink" />
        <StatCard label="Charted today" value={chartedToday.length} accent="green" />
        <StatCard label="Model" value={MODEL_VERSION_STRING} accent="amber" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[300px_1fr]">
        {/* ---- Resident selector ---- */}
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
                : "A resident appears here once their v4.2 assessment is validated with a final level of care."}
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

        {/* ---- Selected resident's shift view ---- */}
        <div className="min-w-0 space-y-5">
          {!selected ? (
            <ClinicalCard className="p-10 text-center">
              <p className="text-sm text-[var(--clinical-muted)]">Select a resident to view their shift care.</p>
            </ClinicalCard>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-[var(--clinical-ink)]">{selected.residentName}</h2>
                <StatusPill status="APPROVED">Level {selected.finalLevel}</StatusPill>
              </div>

              {/* Caregiver queue */}
              <QueueSection
                title="Caregiver queue"
                icon={<User2 className="h-4 w-4" />}
                encounters={selected.queues.Caregiver}
                residentId={selected.residentId}
                level={levelFromFinal(selected.finalLevel)}
                charted={chartedAll}
                busy={busy}
                onComplete={(enc) => chartEvent(enc, "Completed", "")}
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
                  onComplete={(enc) => chartEvent(enc, "Completed", "")}
                  onException={openException}
                />
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
        description={exceptionFor ? `${exceptionFor.label} — ${exceptionFor.timing}` : undefined}
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
        </div>
      </ClinicalModal>
    </ClinicalPage>
  );
}

// ---------------------------------------------------------------------------
// Queue section — a labelled stack of encounter cards for one role.
// ---------------------------------------------------------------------------
function QueueSection({
  title, icon, encounters, residentId, level, charted, busy, onComplete, onException,
}: {
  title: string;
  icon: React.ReactNode;
  encounters: ShiftEncounter[];
  residentId: string;
  level: number;
  charted: Map<string, Outcome>;
  busy: boolean;
  onComplete: (enc: ShiftEncounter) => void;
  onException: (enc: ShiftEncounter) => void;
}) {
  return (
    <ClinicalCard className="p-4">
      <div className="flex items-center gap-2">
        <span className="text-[var(--clinical-muted)]">{icon}</span>
        <MicroLabel>{title}</MicroLabel>
        <span className="ml-auto inline-flex h-5 min-w-6 items-center justify-center rounded-full bg-[var(--clinical-surface-2)] px-1.5 text-xs font-semibold text-[var(--clinical-ink)]">
          {encounters.length}
        </span>
      </div>
      {encounters.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--clinical-muted)]">Nothing due this shift.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {encounters.map((enc) => (
            <EncounterCard
              key={`${residentId}::${enc.bundle}`}
              enc={enc}
              outOfPackage={encOutOfPackage(level, enc)}
              level={level}
              outcome={charted.get(`${residentId}::${enc.bundle}`)}
              busy={busy}
              onComplete={() => onComplete(enc)}
              onException={() => onException(enc)}
            />
          ))}
        </div>
      )}
    </ClinicalCard>
  );
}

// ---------------------------------------------------------------------------
// Encounter card — bundle label, timing, task ids, precautions, expected
// events, plus large Complete / Exception tap targets.
// ---------------------------------------------------------------------------
function EncounterCard({
  enc, outOfPackage, level, outcome, busy, onComplete, onException,
}: {
  enc: ShiftEncounter;
  outOfPackage: boolean;
  level: number;
  outcome: Outcome | undefined;
  busy: boolean;
  onComplete: () => void;
  onException: () => void;
}) {
  const done = !!outcome;
  return (
    <div
      className="rounded-xl border p-3.5"
      style={{
        borderColor: enc.temporary ? "var(--clinical-coral)" : outOfPackage ? "var(--clinical-amber)" : "var(--clinical-line)",
        backgroundColor: "var(--clinical-surface)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--clinical-ink)]">{enc.label}</p>
          <p className="mt-0.5 text-[11px] text-[var(--clinical-muted)]">{enc.role} · {enc.timing}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {enc.temporary && <StatusPill status="URGENT">Change of condition</StatusPill>}
          {outOfPackage && (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.03em]" style={{ borderColor: "var(--clinical-amber)", color: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 12%, transparent)" }} title="Additional Clinical Service (DT-014)">Not in L{level} package</span>
          )}
          {done && (
            <StatusPill status={outcome === "Completed" ? "COMPLETED" : "REFUSED"}>{outcome}</StatusPill>
          )}
        </div>
      </div>

      {enc.taskIds.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {enc.taskIds.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded bg-[var(--clinical-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--clinical-ink-soft,var(--clinical-ink))]">
              <ClipboardList className="h-3 w-3" /> {t}
            </span>
          ))}
        </div>
      )}

      {enc.precautions.length > 0 && (
        <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--clinical-surface-2)] px-2.5 py-1.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--clinical-amber)]" />
          <p className="text-[11px] leading-relaxed text-[var(--clinical-ink)]">{enc.precautions.join(" · ")}</p>
        </div>
      )}

      {enc.expectedEvents.length > 0 && (
        <p className="mt-2 text-[11px] text-[var(--clinical-muted)]">
          <span className="font-semibold">Expected:</span> {enc.expectedEvents.join(", ")}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <ClinicalButton
          variant={done ? "secondary" : "primary"}
          className="flex-1"
          onClick={onComplete}
          disabled={busy || done}
        >
          <CheckCircle2 className="h-4 w-4" /> {done ? "Charted" : "Complete"}
        </ClinicalButton>
        <ClinicalButton variant="secondary" onClick={onException} disabled={busy}>
          <AlertTriangle className="h-4 w-4" /> Exception
        </ClinicalButton>
      </div>
    </div>
  );
}
