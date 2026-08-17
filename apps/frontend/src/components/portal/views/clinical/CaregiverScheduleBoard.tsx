"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Plus, X, Trash2, ChevronLeft, ChevronRight, CalendarDays,
  Users, Sun, Sunset, Moon, Pencil, Info, ShieldAlert, Search, Loader2,
} from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { upsertRecord } from "@/lib/api";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalCard, StatCard,
  DataState, MicroLabel, controlClass,
} from "./clinical-ui";
import {
  CAREGIVER_SCHEDULE_KEY, SHIFTS, shiftMeta, parseSchedules, newScheduleId,
  toDateStr, todayStr, type CaregiverSchedule, type ShiftKey,
} from "@/lib/caregiverSchedule";
import type { ClinicianRole } from "./useClinician";

type SettingRow = { key?: string; id?: string; value?: string };
type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };

/** Roles that own the roster (create/edit). Everyone else views their own shifts. */
const MANAGER_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN", "ORGANIZATION_ADMIN"]);

const SHIFT_UI: Record<ShiftKey, { icon: typeof Sun; dot: string }> = {
  AM: { icon: Sun, dot: "var(--clinical-amber)" },
  PM: { icon: Sunset, dot: "var(--clinical-coral)" },
  NOC: { icon: Moon, dot: "var(--clinical-panel)" },
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type FormState = { id?: string; date: string; shift: ShiftKey; caregiverStaffId: string; residentIds: string[]; note: string };

export default function CaregiverScheduleBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { data: settingRows, loading, error, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const schedules = useMemo(
    () => parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value),
    [settingRows]
  );

  const { data: staffRows } = useLiveQuery<StaffRow>("staff", { query: "include=user&take=300", tables: ["Staff"] });
  const caregivers = useMemo(
    () => staffRows
      .filter((s) => String(s.user?.role ?? "").toUpperCase() === "CAREGIVER")
      .map((s) => ({ id: s.id, userId: s.userId, name: s.user?.name ?? "Caregiver" })),
    [staffRows]
  );

  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=300", tables: ["Resident"] });
  const residents = useMemo(() => residentRows.map(adaptResident), [residentRows]);
  const resById = useMemo(() => {
    const m = new Map<string, { name: string; room: string }>();
    residents.forEach((r) => m.set(r.id, { name: r.name, room: r.room }));
    return m;
  }, [residents]);

  // ---- Identity: managers roster; caregivers see only their own shifts --------
  const [sessionRole, setSessionRole] = useState<string | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [me, setMe] = useState("");
  useEffect(() => {
    fetch("/api/auth/session").then((r) => r.json()).then((d) => {
      if (!d?.authenticated) return;
      setSessionRole(d.session?.role ?? null);
      setSessionUserId(d.session?.userId ?? null);
      setMe(d.session?.name ?? "");
    }).catch(() => {});
  }, []);
  const isManager = sessionRole ? MANAGER_ROLES.has(sessionRole) : MANAGER_ROLES.has(clinicianRole);

  const schedulesByDate = useMemo(() => {
    const m = new Map<string, CaregiverSchedule[]>();
    for (const s of schedules) { const a = m.get(s.date) ?? []; a.push(s); m.set(s.date, a); }
    return m;
  }, [schedules]);

  const persist = async (next: CaregiverSchedule[]) => {
    await upsertRecord("app-settings", CAREGIVER_SCHEDULE_KEY, { key: CAREGIVER_SCHEDULE_KEY, value: JSON.stringify(next) });
    await refetch();
  };

  // ---- Manager calendar state ------------------------------------------------
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [dayOpen, setDayOpen] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [bgOpen, setBgOpen] = useState(false);

  const monthCells = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1);
    const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
    const cells: (string | null)[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(toDateStr(new Date(cursor.y, cursor.m, d)));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);
  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
  const stepMonth = (delta: number) => setCursor((c) => {
    const d = new Date(c.y, c.m + delta, 1); return { y: d.getFullYear(), m: d.getMonth() };
  });

  const today = todayStr();

  // Today's coverage — residents rostered to any caregiver today vs. the census.
  const coverage = useMemo(() => {
    const covered = new Set<string>();
    (schedulesByDate.get(today) ?? []).forEach((s) => s.residentIds.forEach((r) => covered.add(r)));
    const caregiversToday = new Set((schedulesByDate.get(today) ?? []).map((s) => s.caregiverStaffId));
    return { covered: covered.size, uncovered: Math.max(0, residents.length - covered.size), caregivers: caregiversToday.size };
  }, [schedulesByDate, today, residents.length]);

  // ---- Assignment form -------------------------------------------------------
  const openAdd = (date: string, shift: ShiftKey = "AM") => setForm({ date, shift, caregiverStaffId: "", residentIds: [], note: "" });
  const openEdit = (s: CaregiverSchedule) => setForm({ id: s.id, date: s.date, shift: s.shift, caregiverStaffId: s.caregiverStaffId, residentIds: [...s.residentIds], note: s.note ?? "" });

  const saveForm = async () => {
    if (!form) return;
    const cg = caregivers.find((c) => c.id === form.caregiverStaffId);
    if (!cg) { Swal.fire({ title: "Pick a caregiver", icon: "warning" }); return; }
    if (form.residentIds.length === 0) { Swal.fire({ title: "Assign at least one resident", icon: "warning" }); return; }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      // A caregiver has at most one entry per date+shift — editing or re-adding
      // the same slot updates it in place (residents replace the prior set).
      const dupe = schedules.find((s) => s.id !== form.id && s.date === form.date && s.shift === form.shift && s.caregiverStaffId === form.caregiverStaffId);
      const targetId = form.id ?? dupe?.id;
      const base: CaregiverSchedule = {
        id: targetId ?? newScheduleId(),
        date: form.date, shift: form.shift,
        caregiverStaffId: cg.id, caregiverUserId: cg.userId, caregiverName: cg.name,
        residentIds: form.residentIds,
        // Snapshot names now (manager sees all residents) so the caregiver can
        // read them on future shifts without live resident access.
        residents: form.residentIds.map((id) => { const r = resById.get(id); return { id, name: r?.name ?? "Resident", room: r?.room ?? "" }; }),
        note: form.note.trim() || undefined,
        createdBy: me, createdAt: now, updatedAt: now,
      };
      const next = targetId
        ? schedules.map((s) => (s.id === targetId ? { ...s, ...base, createdAt: s.createdAt } : s))
        : [base, ...schedules];
      await persist(next);
      setForm(null);
      Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Schedule saved", showConfirmButton: false, timer: 1400 });
    } catch (e) {
      Swal.fire({ title: "Save failed", text: e instanceof Error ? e.message : "Could not save.", icon: "error" });
    } finally { setSaving(false); }
  };

  const remove = async (s: CaregiverSchedule) => {
    const c = await Swal.fire({ title: "Remove schedule?", text: `${s.caregiverName} — ${shiftMeta(s.shift).label}, ${s.date}`, icon: "warning", showCancelButton: true, confirmButtonColor: "#e11d48", confirmButtonText: "Remove" });
    if (!c.isConfirmed) return;
    await persist(schedules.filter((x) => x.id !== s.id));
  };

  // ── Worker (caregiver) view: their own shifts, read-only ────────────────────
  if (!isManager) {
    const mine = schedules
      .filter((s) => (sessionUserId && s.caregiverUserId === sessionUserId))
      .filter((s) => s.date >= today)
      .sort((a, b) => (a.date + a.shift).localeCompare(b.date + b.shift));
    return (
      <ClinicalPage className="space-y-6">
        <ClinicalHeader title="My Schedule" subtitle="Your assigned shifts and the residents in your care. Set by the nursing team."
          right={<ClinicalButton variant="secondary" onClick={() => setBgOpen(true)}><ShieldAlert className="w-4 h-4" /> Break-glass access</ClinicalButton>} />
        <DataState loading={loading && schedules.length === 0} error={error} empty={mine.length === 0}
          emptyTitle="No upcoming shifts" emptyHint="When the nursing team rosters you to residents, your shifts appear here." onRetry={() => void refetch()} skeletonRows={3}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {mine.map((s) => <ShiftCard key={s.id} s={s} resById={resById} isToday={s.date === today} />)}
          </div>
        </DataState>
        {bgOpen && <BreakGlassModal onClose={() => setBgOpen(false)} />}
      </ClinicalPage>
    );
  }

  // ── Manager view: month roster ──────────────────────────────────────────────
  return (
    <ClinicalPage className="space-y-6">
      <ClinicalHeader
        title="Caregiver Schedule"
        subtitle="Roster a caregiver to a group of residents per shift. Assignments scope each caregiver's residents to their own shift."
        right={<ClinicalButton variant="accent" onClick={() => openAdd(today)}><Plus className="w-4 h-4" /> New Schedule</ClinicalButton>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Caregivers on today" value={coverage.caregivers} accent="teal" />
        <StatCard label="Residents covered today" value={coverage.covered} accent="green" />
        <StatCard label="Uncovered residents" value={coverage.uncovered} accent={coverage.uncovered ? "coral" : "green"} />
        <StatCard label="Total residents" value={residents.length} accent="ink" />
      </div>

      {/* Month toolbar */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-[var(--clinical-ink)] flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[var(--clinical-panel)]" /> {monthLabel}</h3>
        <div className="flex items-center gap-1">
          <button onClick={() => stepMonth(-1)} aria-label="Previous month" className="p-2 rounded-lg border border-[var(--clinical-line-strong)] text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"><ChevronLeft className="w-4 h-4" /></button>
          <ClinicalButton variant="secondary" size="sm" onClick={() => setCursor(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })}>Today</ClinicalButton>
          <button onClick={() => stepMonth(1)} aria-label="Next month" className="p-2 rounded-lg border border-[var(--clinical-line-strong)] text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Calendar grid */}
      <ClinicalCard top="teal" className="p-2 sm:p-3">
        <div className="grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w) => <div key={w} className="text-center text-[11px] font-bold uppercase tracking-wide text-[var(--clinical-muted)] py-1.5">{w}</div>)}
          {monthCells.map((date, i) => {
            if (!date) return <div key={`e${i}`} className="min-h-[76px] rounded-lg bg-[var(--clinical-surface)]/40" />;
            const day = Number(date.slice(-2));
            const items = schedulesByDate.get(date) ?? [];
            const isToday = date === today;
            // Residents left with no caregiver on a day that IS being rostered —
            // the actionable gap (an empty future day isn't flagged as noise).
            const coveredCount = new Set(items.flatMap((x) => x.residentIds)).size;
            const uncovered = items.length > 0 ? Math.max(0, residents.length - coveredCount) : 0;
            return (
              <button key={date} onClick={() => setDayOpen(date)}
                className={`min-h-[76px] rounded-lg border p-1.5 text-left transition hover:border-[var(--clinical-panel)] ${isToday ? "border-[var(--clinical-panel)] bg-[color-mix(in_srgb,var(--clinical-panel)_8%,transparent)]" : "border-[var(--clinical-line)] bg-[var(--clinical-surface)]"}`}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold ${isToday ? "text-[var(--clinical-panel)]" : "text-[var(--clinical-ink-soft)]"}`}>{day}</span>
                  {uncovered > 0 && <span title={`${uncovered} resident(s) with no caregiver`} className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[var(--clinical-coral)] text-white text-[9px] font-bold">{uncovered}</span>}
                </div>
                <div className="mt-1 space-y-0.5">
                  {SHIFTS.map((sh) => {
                    const n = items.filter((x) => x.shift === sh.key).length;
                    if (!n) return null;
                    return (
                      <div key={sh.key} className="flex items-center gap-1 text-[10px] font-medium text-[var(--clinical-ink-soft)]">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: SHIFT_UI[sh.key].dot }} />
                        <span className="truncate">{sh.key} · {n}</span>
                      </div>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </ClinicalCard>

      {/* Day detail modal */}
      {dayOpen && (
        <DayModal
          date={dayOpen}
          items={schedulesByDate.get(dayOpen) ?? []}
          resById={resById}
          allResidents={residents}
          onClose={() => setDayOpen(null)}
          onAdd={(shift) => openAdd(dayOpen, shift)}
          onEdit={openEdit}
          onDelete={remove}
        />
      )}

      {/* Assignment form modal */}
      {form && (
        <AssignmentModal
          form={form} setForm={setForm} caregivers={caregivers} residents={residents}
          saving={saving} onClose={() => setForm(null)} onSave={saveForm}
        />
      )}
    </ClinicalPage>
  );
}

// ── A single shift assignment card ────────────────────────────────────────────
function ShiftCard({ s, resById, isToday }: { s: CaregiverSchedule; resById: Map<string, { name: string; room: string }>; isToday: boolean }) {
  const meta = shiftMeta(s.shift);
  const Icon = SHIFT_UI[s.shift].icon;
  return (
    <ClinicalCard top={isToday ? "green" : "teal"} className="p-4">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}><Icon className="w-4 h-4 text-[var(--clinical-panel)]" /></span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--clinical-ink)]">{meta.label} <span className="text-[var(--clinical-muted)] font-medium">{meta.range}</span></p>
          <p className="text-xs text-[var(--clinical-muted)]">{s.date}{isToday ? " · Today" : ""}</p>
        </div>
        <span className="ml-auto text-xs font-bold text-[var(--clinical-panel)] rounded px-2 py-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--clinical-panel) 12%, transparent)" }}>{s.residentIds.length} resident{s.residentIds.length === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {s.residentIds.map((rid) => {
          // Prefer the assign-time snapshot (works on future shifts); fall back to live.
          const snap = s.residents?.find((x) => x.id === rid);
          const r = snap ?? resById.get(rid);
          return (
            <span key={rid} className="text-[11px] font-medium px-2 py-0.5 rounded bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)]">{r?.name ?? "Resident"}{r?.room ? ` · Rm ${r.room}` : ""}</span>
          );
        })}
      </div>
      {s.note && <p className="mt-2 text-xs text-[var(--clinical-muted)] flex items-start gap-1"><Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />{s.note}</p>}
    </ClinicalCard>
  );
}

// ── Day detail modal (manager) ────────────────────────────────────────────────
function DayModal({ date, items, resById, allResidents, onClose, onAdd, onEdit, onDelete }: {
  date: string; items: CaregiverSchedule[]; resById: Map<string, { name: string; room: string }>;
  allResidents: { id: string; name: string; room: string }[];
  onClose: () => void; onAdd: (shift: ShiftKey) => void; onEdit: (s: CaregiverSchedule) => void; onDelete: (s: CaregiverSchedule) => void;
}) {
  const pretty = new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const covered = new Set(items.flatMap((x) => x.residentIds));
  const uncovered = allResidents.filter((r) => !covered.has(r.id));
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl" style={{ backgroundColor: "var(--clinical-ground)" }}>
        <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">Caregiver Schedule</p>
            <h2 className="text-lg font-bold">{pretty}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {uncovered.length > 0 && (
            <div className="rounded-lg border p-3" style={{ borderColor: "var(--clinical-coral)", backgroundColor: "color-mix(in srgb, var(--clinical-coral) 8%, transparent)" }}>
              <p className="text-xs font-bold text-[var(--clinical-coral)] flex items-center gap-1.5"><Info className="w-3.5 h-3.5" /> {uncovered.length} resident{uncovered.length === 1 ? "" : "s"} with no caregiver this day</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
                {uncovered.map((r) => <span key={r.id} className="text-[11px] font-medium px-2 py-0.5 rounded bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)]">{r.name}{r.room ? ` · Rm ${r.room}` : ""}</span>)}
              </div>
            </div>
          )}
          {SHIFTS.map((sh) => {
            const rows = items.filter((x) => x.shift === sh.key);
            const Icon = SHIFT_UI[sh.key].icon;
            return (
              <div key={sh.key}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-[var(--clinical-ink)] flex items-center gap-1.5"><Icon className="w-4 h-4" style={{ color: SHIFT_UI[sh.key].dot }} /> {sh.label} <span className="text-[var(--clinical-muted)] font-medium">{sh.range}</span></h3>
                  <ClinicalButton variant="secondary" size="sm" onClick={() => onAdd(sh.key)}><Plus className="w-3.5 h-3.5" /> Assign</ClinicalButton>
                </div>
                {rows.length === 0 ? (
                  <p className="text-xs text-[var(--clinical-muted)] px-1 pb-1">No caregivers scheduled.</p>
                ) : (
                  <div className="space-y-2">
                    {rows.map((s) => (
                      <ClinicalCard key={s.id} top="none" className="p-3">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-[var(--clinical-panel)]" />
                          <span className="text-sm font-bold text-[var(--clinical-ink)]">{s.caregiverName}</span>
                          <span className="text-xs text-[var(--clinical-muted)]">{s.residentIds.length} resident{s.residentIds.length === 1 ? "" : "s"}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <button onClick={() => onEdit(s)} aria-label="Edit" className="p-1.5 rounded text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)]"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => onDelete(s)} aria-label="Remove" className="p-1.5 rounded text-[var(--clinical-coral)] hover:bg-[var(--clinical-surface-2)]"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {s.residentIds.map((rid) => { const r = resById.get(rid); return (
                            <span key={rid} className="text-[11px] font-medium px-2 py-0.5 rounded bg-[var(--clinical-surface-2)] text-[var(--clinical-ink-soft)]">{r?.name ?? "Resident"}{r?.room ? ` · Rm ${r.room}` : ""}</span>
                          ); })}
                        </div>
                        {s.note && <p className="mt-1.5 text-xs text-[var(--clinical-muted)]">{s.note}</p>}
                      </ClinicalCard>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Break-glass modal (caregiver emergency access) ────────────────────────────
type BgResident = { id: string; name: string; room: string; assigned: boolean };
function BreakGlassModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<BgResident[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<BgResident | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/caregiver/break-glass").then((r) => r.json()).then((d) => {
      if (alive) setList(Array.isArray(d?.data) ? d.data : []);
    }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Only residents NOT already on the caregiver's shift need break-glass.
    return list.filter((r) => !r.assigned).filter((r) => !s || r.name.toLowerCase().includes(s) || r.room.toLowerCase().includes(s)).slice(0, 40);
  }, [list, q]);

  const submit = async () => {
    if (!picked || reason.trim().length < 4) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/caregiver/break-glass", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ residentId: picked.id, reason: reason.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Failed");
      onClose();
      Swal.fire({ icon: "success", title: "Access granted", text: `You can now open ${d.residentName ?? picked.name} for this shift. The nursing team has been notified.`, timer: 2600, showConfirmButton: false });
    } catch (e) {
      Swal.fire({ icon: "error", title: "Could not grant access", text: e instanceof Error ? e.message : "Try again." });
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl" style={{ backgroundColor: "var(--clinical-ground)" }}>
        <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-coral)" }}>
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5" />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/80">Emergency override</p>
              <h2 className="text-lg font-bold">Break-glass access</h2>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <p className="text-xs text-[var(--clinical-muted)]">Open a resident who isn&apos;t on your shift. Access lasts until the end of this shift and is logged and reported to the nursing team.</p>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--clinical-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resident by name or room…" className={`${controlClass} pl-9`} />
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--clinical-muted)] py-6 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading residents…</div>
          ) : (
            <div className="max-h-52 overflow-y-auto rounded-lg border divide-y scrollbar-thin" style={{ borderColor: "var(--clinical-line-strong)" }}>
              {matches.length === 0 ? (
                <p className="text-xs text-[var(--clinical-muted)] p-3">No other residents match.</p>
              ) : matches.map((r) => (
                <button key={r.id} type="button" onClick={() => setPicked(r)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-[var(--clinical-surface-2)] ${picked?.id === r.id ? "bg-[color-mix(in_srgb,var(--clinical-coral)_10%,transparent)]" : ""}`} style={{ borderColor: "var(--clinical-line)" }}>
                  <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${picked?.id === r.id ? "bg-[var(--clinical-coral)] border-[var(--clinical-coral)]" : "border-[var(--clinical-line-strong)]"}`} />
                  <span className="text-[var(--clinical-ink)]">{r.name}</span>{r.room && <span className="text-[var(--clinical-muted)]">· Rm {r.room}</span>}
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <MicroLabel className="mb-1">Reason <span className="text-[var(--clinical-coral)]">*</span></MicroLabel>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Responding to a fall in Room 210 while the assigned caregiver is off-floor." className={controlClass} />
          </label>
        </div>
        <div className="flex flex-none items-center justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
          <ClinicalButton variant="secondary" size="sm" onClick={onClose} disabled={submitting}>Cancel</ClinicalButton>
          <ClinicalButton variant="danger" onClick={submit} disabled={submitting || !picked || reason.trim().length < 4}>
            <ShieldAlert className="w-4 h-4" /> {submitting ? "Granting…" : "Grant emergency access"}
          </ClinicalButton>
        </div>
      </div>
    </div>
  );
}

// ── Assignment form modal ─────────────────────────────────────────────────────
function AssignmentModal({ form, setForm, caregivers, residents, saving, onClose, onSave }: {
  form: FormState; setForm: (f: FormState) => void;
  caregivers: { id: string; userId?: string; name: string }[];
  residents: { id: string; name: string; room: string }[];
  saving: boolean; onClose: () => void; onSave: () => void;
}) {
  const toggle = (id: string) => {
    const set = new Set(form.residentIds);
    if (set.has(id)) set.delete(id); else set.add(id);
    setForm({ ...form, residentIds: [...set] });
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl shadow-2xl sm:max-h-[90vh] sm:max-w-lg sm:rounded-2xl" style={{ backgroundColor: "var(--clinical-ground)" }}>
        <div className="flex flex-none items-center justify-between px-5 py-4 text-white" style={{ backgroundColor: "var(--clinical-panel)" }}>
          <h2 className="text-lg font-bold">{form.id ? "Edit assignment" : "New schedule"}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="w-5 h-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <MicroLabel className="mb-1">Date</MicroLabel>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={controlClass} />
            </label>
            <label className="block">
              <MicroLabel className="mb-1">Shift</MicroLabel>
              <select value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value as ShiftKey })} className={controlClass}>
                {SHIFTS.map((s) => <option key={s.key} value={s.key}>{s.label} ({s.range})</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <MicroLabel className="mb-1">Caregiver</MicroLabel>
            <select value={form.caregiverStaffId} onChange={(e) => setForm({ ...form, caregiverStaffId: e.target.value })} className={controlClass}>
              <option value="">Select caregiver…</option>
              {caregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div>
            <div className="flex items-center justify-between mb-1">
              <MicroLabel>Residents ({form.residentIds.length} selected)</MicroLabel>
              <div className="text-xs">
                <button type="button" onClick={() => setForm({ ...form, residentIds: residents.map((r) => r.id) })} className="text-[var(--clinical-panel)] hover:underline">Select all</button>
                <span className="text-[var(--clinical-muted)] mx-1.5">|</span>
                <button type="button" onClick={() => setForm({ ...form, residentIds: [] })} className="text-[var(--clinical-panel)] hover:underline">Clear</button>
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border divide-y scrollbar-thin" style={{ borderColor: "var(--clinical-line-strong)" }}>
              {residents.length === 0 ? (
                <p className="text-xs text-[var(--clinical-muted)] p-3">No residents found.</p>
              ) : residents.map((r) => (
                <label key={r.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm text-[var(--clinical-ink-soft)] hover:bg-[var(--clinical-surface-2)] cursor-pointer" style={{ borderColor: "var(--clinical-line)" }}>
                  <input type="checkbox" checked={form.residentIds.includes(r.id)} onChange={() => toggle(r.id)} style={{ minHeight: 0, minWidth: 0 }} className="h-4 w-4 shrink-0 rounded accent-[var(--clinical-panel)]" />
                  <span className="truncate">{r.name} — Rm {r.room}</span>
                </label>
              ))}
            </div>
          </div>
          <label className="block">
            <MicroLabel className="mb-1">Note (optional)</MicroLabel>
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Cover for the AM medication pass." className={controlClass} />
          </label>
        </div>
        <div className="flex flex-none items-center justify-end gap-2 border-t px-5 py-3.5" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
          <ClinicalButton variant="secondary" size="sm" onClick={onClose} disabled={saving}>Cancel</ClinicalButton>
          <ClinicalButton variant="accent" onClick={onSave} disabled={saving}><Plus className="w-4 h-4" /> {saving ? "Saving…" : "Save schedule"}</ClinicalButton>
        </div>
      </div>
    </div>
  );
}
