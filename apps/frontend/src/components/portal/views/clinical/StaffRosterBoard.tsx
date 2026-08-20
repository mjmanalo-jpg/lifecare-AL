"use client";

/**
 * Staff Roster — the fortnightly staffing schedule (the client's Excel grid):
 * staff rows × date columns, each cell a coded shift/assignment. Managers import
 * the grid (paste from Excel), view it colour-coded, and edit cells (e.g. to
 * cover an absence). Phase 2 will bridge working cells into caregiver_schedules /
 * the DT-013 private-caregiver assignments.
 */

import { useMemo, useState } from "react";
import { ClipboardPaste, Users, Moon, Sun, Sunset, Clock, Bed, Plane, HelpCircle, Link2, AlertTriangle, CheckCircle2 } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import {
  ClinicalPage, ClinicalHeader, ClinicalButton, StatCard,
  DataState, MicroLabel, controlClass,
} from "./clinical-ui";
import {
  STAFF_ROSTER_KEY, parseRoster, parseRosterGrid, parseShiftCode,
  type StaffRoster, type RosterBaseRole, type ParsedCode,
} from "@/lib/caregiverRoster";
import { bridgeRoster, rosterReadiness, ROSTER_MAPPING_KEY, type RosterMapping } from "@/lib/rosterBridge";
import {
  CAREGIVER_SCHEDULE_KEY, parseSchedules, newScheduleId, type CaregiverSchedule,
} from "@/lib/caregiverSchedule";
import type { ClinicianRole } from "./useClinician";

type SettingRow = { key?: string; id?: string; value?: string };
type StaffRow = { id: string; userId?: string; user?: { name?: string; role?: string } };

const MANAGER_ROLES = new Set(["NURSE", "CARE_MANAGER", "FACILITY_ADMIN", "SUPERADMIN"]);

const ROLE_ORDER: { role: RosterBaseRole; label: string }[] = [
  { role: "CARE_MANAGER", label: "Care Management" },
  { role: "NURSE", label: "Nurses" },
  { role: "CAREGIVER", label: "Caregivers" },
];

const todayISO = () => new Date().toISOString().slice(0, 10);
const dayNum = (iso: string) => iso.slice(8, 10);
const weekday = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
const isWeekend = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00`).getDay());

/** Colour a cell by its parsed code. */
function cellStyle(c: ParsedCode): React.CSSProperties {
  if (c.kind === "REST") return { background: "var(--clinical-surface-2)", color: "var(--clinical-muted)" };
  if (c.kind === "LEAVE") return { background: "color-mix(in srgb, var(--clinical-panel) 14%, transparent)", color: "var(--clinical-panel)" };
  if (c.kind === "OFF") return { background: "transparent", color: "var(--clinical-muted)" };
  if (c.kind === "UNKNOWN") return { background: "color-mix(in srgb, var(--clinical-coral) 12%, transparent)", color: "var(--clinical-coral)" };
  const byShift: Record<string, string> = { AM: "var(--clinical-amber)", PM: "var(--clinical-coral)", NIGHT: "var(--clinical-panel)", MID: "var(--clinical-teal)" };
  const accent = byShift[c.shift ?? "MID"] ?? "var(--clinical-teal)";
  return {
    background: `color-mix(in srgb, ${accent} 15%, transparent)`,
    color: `color-mix(in srgb, ${accent} 70%, var(--clinical-ink))`,
    boxShadow: c.private ? `inset 0 0 0 1.5px ${accent}` : undefined,
    fontWeight: c.private ? 700 : 500,
  };
}

export default function StaffRosterBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { data: settingRows, loading, error, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const roster = useMemo(
    () => parseRoster(settingRows.find((r) => (r.key || r.id) === STAFF_ROSTER_KEY)?.value),
    [settingRows],
  );
  const mapping = useMemo<RosterMapping>(
    () => { try { return JSON.parse(settingRows.find((r) => (r.key || r.id) === ROSTER_MAPPING_KEY)?.value || "{}"); } catch { return {}; } },
    [settingRows],
  );
  const canManage = MANAGER_ROLES.has(String(clinicianRole).toUpperCase());

  // Staff + residents power the roster → caregiver-schedule bridge (Phase 2).
  const { data: staffRows } = useLiveQuery<StaffRow>("staff", { query: "include=user&take=400", tables: ["Staff"] });
  const caregivers = useMemo(
    () => staffRows
      .filter((s) => String(s.user?.role ?? "").toUpperCase() === "CAREGIVER")
      .map((s) => ({ id: s.id, userId: s.userId, name: s.user?.name ?? "" })),
    [staffRows],
  );
  const { data: residentRows } = useLiveQuery<Record<string, unknown>>("residents", { query: "take=400", tables: ["Resident"] });
  const residents = useMemo(
    () => residentRows.map(adaptResident).map((r) => ({ id: String(r.id), name: r.name ?? "", room: String(r.room ?? "").trim() })),
    [residentRows],
  );

  const [importOpen, setImportOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState(todayISO());
  const [pasteText, setPasteText] = useState("");
  const [preview, setPreview] = useState<StaffRoster | null>(null);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<{ row: number; date: string } | null>(null);

  const today = todayISO();

  const persist = async (next: StaffRoster) => {
    setSaving(true);
    try {
      await upsertRecord("app-settings", STAFF_ROSTER_KEY, { key: STAFF_ROSTER_KEY, value: JSON.stringify(next) });
      await refetch();
    } catch {
      Swal.fire({ title: "Couldn't save", text: "The roster change didn't save — try again.", icon: "error" });
    } finally { setSaving(false); }
  };

  const doPreview = () => {
    const parsed = parseRosterGrid(pasteText, { periodStartISO: periodStart });
    if (!parsed.rows.length || !parsed.dates.length) {
      Swal.fire({ title: "Nothing parsed", text: "Couldn't find a schedule grid in the paste. Include the row of day numbers and set the correct period start date.", icon: "warning" });
      return;
    }
    setPreview(parsed);
  };

  const saveImport = async () => {
    if (!preview) return;
    await persist({ ...preview, importedAt: new Date().toISOString() });
    setImportOpen(false); setPreview(null); setPasteText("");
  };

  // Pre-sync readiness — which rostered staff / residents aren't set up yet.
  const readiness = useMemo(
    () => (roster ? rosterReadiness(roster, { staff: caregivers, residents, mapping }) : null),
    [roster, caregivers, residents, mapping],
  );
  const [readyOpen, setReadyOpen] = useState(false);

  const saveMapping = async (next: RosterMapping) => {
    try {
      await upsertRecord("app-settings", ROSTER_MAPPING_KEY, { key: ROSTER_MAPPING_KEY, value: JSON.stringify(next) });
      await refetch();
    } catch {
      Swal.fire({ title: "Couldn't save mapping", text: "Try again.", icon: "error" });
    }
  };
  const mapStaff = (code: string, staffId: string) =>
    saveMapping({ ...mapping, staffByCode: { ...mapping.staffByCode, ...(staffId ? { [code]: staffId } : {}) } });
  const mapResidentCode = (code: string, residentId: string) =>
    saveMapping({ ...mapping, residentByCode: { ...mapping.residentByCode, ...(residentId ? { [code]: residentId } : {}) } });

  // Phase 2 — push the roster's working caregiver cells into caregiver_schedules
  // (the store that drives task routing + the shift access lock). Roster-sourced
  // entries in this period are replaced; hand-made assignments are preserved.
  const [syncing, setSyncing] = useState(false);
  const syncToSchedule = async () => {
    if (!roster) return;
    setSyncing(true);
    try {
      const { assignments, unresolved } = bridgeRoster(roster, { staff: caregivers, residents, mapping });
      const now = new Date().toISOString();
      const generated: CaregiverSchedule[] = assignments.map((a) => ({
        id: newScheduleId(), date: a.date, shift: a.shift,
        caregiverStaffId: a.caregiverStaffId, caregiverUserId: a.caregiverUserId, caregiverName: a.caregiverName,
        residentIds: a.residentIds, residents: a.residents,
        note: a.private ? `Private 1:1 (${a.code})` : `Roster ${a.code}`,
        source: "roster", createdBy: "Staff Roster", createdAt: now,
      }));
      const periodDates = new Set(roster.dates);
      const existing = parseSchedules(settingRows.find((r) => (r.key || r.id) === CAREGIVER_SCHEDULE_KEY)?.value);
      // Keep hand-made entries + any roster entries outside this period.
      const kept = existing.filter((s) => s.source !== "roster" || !periodDates.has(s.date));
      await upsertRecord("app-settings", CAREGIVER_SCHEDULE_KEY, { key: CAREGIVER_SCHEDULE_KEY, value: JSON.stringify([...kept, ...generated]) });
      await refetch();

      const reasons = [...new Set(unresolved.map((u) => u.reason))].slice(0, 4);
      await Swal.fire({
        icon: unresolved.length ? "warning" : "success",
        title: `Synced ${generated.length} assignment${generated.length === 1 ? "" : "s"}`,
        html: unresolved.length
          ? `Pushed to the caregiver schedule.<br/><b>${unresolved.length}</b> cell(s) couldn't be mapped:<br/><span style="font-size:12px">${reasons.map((r) => `• ${r}`).join("<br/>")}</span>`
          : "The roster now drives the caregiver schedule for this period.",
      });
    } catch {
      Swal.fire({ title: "Sync failed", text: "Couldn't push the roster to the caregiver schedule — try again.", icon: "error" });
    } finally { setSyncing(false); }
  };

  const commitEdit = async (rowIdx: number, date: string, value: string) => {
    if (!roster) return;
    setEdit(null);
    const rows = roster.rows.map((r, i) => {
      if (i !== rowIdx) return r;
      const cells = { ...r.cells };
      const v = value.trim();
      if (v) cells[date] = v; else delete cells[date];
      return { ...r, cells };
    });
    await persist({ ...roster, rows });
  };

  // Today's snapshot.
  const stats = useMemo(() => {
    if (!roster) return { staff: 0, onDuty: 0, privateCg: 0, offToday: 0 };
    let onDuty = 0, privateCg = 0, offToday = 0;
    for (const r of roster.rows) {
      const c = parseShiftCode(r.cells[today] ?? "");
      if (c.kind === "WORK") { onDuty++; if (c.private) privateCg++; }
      else if (c.kind === "REST" || c.kind === "LEAVE" || c.kind === "OFF") offToday++;
    }
    return { staff: roster.rows.length, onDuty, privateCg, offToday };
  }, [roster, today]);

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Staff Roster"
        subtitle={roster ? `${roster.periodStart} – ${roster.periodEnd} · ${roster.rows.length} staff` : "Fortnightly staffing schedule & assignments"}
        right={canManage ? (
          <div className="flex gap-2">
            {roster && (
              <ClinicalButton variant="secondary" onClick={() => setReadyOpen(true)}>
                {readiness?.ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                Readiness{readiness && !readiness.ready ? ` (${readiness.missingStaff.length + readiness.missingResidentCodes.length + readiness.unmappedStations.length})` : ""}
              </ClinicalButton>
            )}
            {roster && (
              <ClinicalButton variant="secondary" onClick={syncToSchedule} disabled={syncing}>
                <Link2 className="h-4 w-4" /> {syncing ? "Syncing…" : "Sync to Caregiver Schedule"}
              </ClinicalButton>
            )}
            <ClinicalButton variant="primary" onClick={() => { setImportOpen(true); setPreview(null); }}>
              <ClipboardPaste className="h-4 w-4" /> Import from Excel
            </ClinicalButton>
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Staff on roster" value={stats.staff} accent="teal" />
        <StatCard label="On duty today" value={stats.onDuty} accent="green" />
        <StatCard label="Private (1:1) today" value={stats.privateCg} accent="amber" />
        <StatCard label="Off / leave today" value={stats.offToday} accent="coral" />
      </div>

      <DataState loading={loading} error={error} empty={!roster} emptyTitle="No roster imported yet" emptyHint="Use “Import from Excel” to paste the fortnightly schedule." emptyAction={canManage ? <ClinicalButton variant="primary" onClick={() => setImportOpen(true)}><ClipboardPaste className="h-4 w-4" /> Import from Excel</ClinicalButton> : undefined}>
        {roster && (
          <div className="overflow-hidden rounded-xl border" style={{ borderColor: "var(--clinical-line)", backgroundColor: "var(--clinical-surface)" }}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-[var(--clinical-surface)] px-3 py-2 text-left" style={{ minWidth: 190 }}>
                      <MicroLabel>Staff</MicroLabel>
                    </th>
                    {roster.dates.map((d) => (
                      <th key={d} className="px-1.5 py-2 text-center" style={{ background: d === today ? "var(--clinical-teal-wash, color-mix(in srgb, var(--clinical-teal) 12%, transparent))" : undefined, color: isWeekend(d) ? "var(--clinical-muted)" : "var(--clinical-ink-soft)" }}>
                        <div className="font-mono text-[13px] leading-none">{dayNum(d)}</div>
                        <div className="text-[9px] uppercase tracking-wide">{weekday(d)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROLE_ORDER.map(({ role, label }) => {
                    const group = roster.rows.map((r, i) => ({ r, i })).filter((x) => x.r.baseRole === role);
                    if (!group.length) return null;
                    return (
                      <RoleGroup key={role} label={label} span={roster.dates.length + 1}>
                        {group.map(({ r, i }) => (
                          <tr key={`${r.employeeCode}-${i}`} className="border-t" style={{ borderColor: "var(--clinical-line)" }}>
                            <td className="sticky left-0 z-10 bg-[var(--clinical-surface)] px-3 py-1.5">
                              <div className="font-medium text-[var(--clinical-ink)]">{r.name || r.employeeCode || "—"}</div>
                              <div className="text-[10px] text-[var(--clinical-muted)]">{r.employeeCode}{r.designation ? ` · ${r.designation}` : ""}{r.status ? ` · ${r.status}` : ""}</div>
                            </td>
                            {roster.dates.map((d) => {
                              const raw = r.cells[d] ?? "";
                              const c = parseShiftCode(raw);
                              const editing = edit?.row === i && edit?.date === d;
                              return (
                                <td key={d} className="p-0.5 text-center">
                                  {editing ? (
                                    <input
                                      autoFocus
                                      defaultValue={raw}
                                      className={controlClass}
                                      style={{ width: 74, padding: "2px 4px", fontSize: 11, textAlign: "center" }}
                                      onBlur={(e) => commitEdit(i, d, e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      title={c.label}
                                      disabled={!canManage}
                                      onClick={() => canManage && setEdit({ row: i, date: d })}
                                      className="mx-auto block w-full rounded px-1 py-1 font-mono text-[10px] leading-tight"
                                      style={{ ...cellStyle(c), cursor: canManage ? "pointer" : "default", minWidth: 58 }}
                                    >
                                      {raw || "·"}
                                    </button>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </RoleGroup>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Legend />
          </div>
        )}
      </DataState>

      {readyOpen && readiness && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setReadyOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[var(--clinical-surface)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-2">
              {readiness.ready
                ? <CheckCircle2 className="h-5 w-5 text-[var(--clinical-green)]" />
                : <AlertTriangle className="h-5 w-5 text-[var(--clinical-amber)]" />}
              <h3 className="text-lg font-semibold text-[var(--clinical-ink)]">Roster readiness</h3>
            </div>
            <p className="mb-4 text-sm text-[var(--clinical-ink-soft)]">
              {readiness.matchedStaff}/{readiness.caregiverRows} caregivers matched · {readiness.resolvableAssignments} assignments ready to sync.
              {readiness.ready ? " Everything on this roster is registered — you can sync." : " Fix the gaps below (or sync now and resolve them later)."}
            </p>

            {readiness.missingStaff.length > 0 && (
              <section className="mb-4">
                <MicroLabel>Unregistered / unmatched staff ({readiness.missingStaff.length})</MicroLabel>
                <p className="mb-2 text-xs text-[var(--clinical-muted)]">Register them in Staff Profiles, or link the roster code to an existing caregiver here.</p>
                <div className="space-y-1.5">
                  {readiness.missingStaff.map((m) => (
                    <div key={m.code} className="flex items-center gap-2 text-sm">
                      <span className="w-40 shrink-0 truncate"><b className="font-mono text-xs">{m.code}</b> {m.name}</span>
                      <select className={controlClass} style={{ maxWidth: 260 }} defaultValue="" onChange={(e) => e.target.value && mapStaff(m.code, e.target.value)}>
                        <option value="">Link to caregiver…</option>
                        {caregivers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {readiness.missingResidentCodes.length > 0 && (
              <section className="mb-4">
                <MicroLabel>Residents not admitted / mapped ({readiness.missingResidentCodes.length})</MicroLabel>
                <p className="mb-2 text-xs text-[var(--clinical-muted)]">Admit the resident with the matching room number, or link the PCG code to an admitted resident.</p>
                <div className="space-y-1.5">
                  {readiness.missingResidentCodes.map((code) => (
                    <div key={code} className="flex items-center gap-2 text-sm">
                      <span className="w-40 shrink-0"><b className="font-mono text-xs">PCG{code}</b></span>
                      <select className={controlClass} style={{ maxWidth: 260 }} defaultValue="" onChange={(e) => e.target.value && mapResidentCode(code, e.target.value)}>
                        <option value="">Link to resident…</option>
                        {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room ? ` · Rm ${r.room}` : ""}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {readiness.unmappedStations.length > 0 && (
              <section className="mb-4">
                <MicroLabel>Stations without a resident mapping ({readiness.unmappedStations.length})</MicroLabel>
                <p className="mb-1 text-xs text-[var(--clinical-muted)]">Each shared station (CG#) needs the set of residents it covers. Stations pending: {readiness.unmappedStations.map((s) => `CG${s}`).join(", ")}.</p>
              </section>
            )}

            {readiness.ready && (
              <div className="rounded-lg border p-4 text-sm text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line)" }}>
                All rostered staff and residents are set up. Use “Sync to Caregiver Schedule” to push assignments.
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <ClinicalButton variant="primary" onClick={() => setReadyOpen(false)}>Done</ClinicalButton>
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setImportOpen(false)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[var(--clinical-surface)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-lg font-semibold text-[var(--clinical-ink)]">Import roster from Excel</h3>
            <p className="mb-3 text-sm text-[var(--clinical-ink-soft)]">Copy the schedule grid from Excel (including the row of day numbers) and paste it below. Set the period’s first date so columns map correctly.</p>
            <div className="mb-3 flex items-center gap-2">
              <MicroLabel>Period start</MicroLabel>
              <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={controlClass} style={{ maxWidth: 180 }} />
            </div>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={8}
              placeholder="Paste the tab-separated grid here…"
              className={controlClass}
              style={{ fontFamily: "var(--mono, monospace)", fontSize: 11 }}
            />
            {preview && (
              <div className="mt-3 rounded-lg border p-3 text-sm" style={{ borderColor: "var(--clinical-line)" }}>
                Parsed <b>{preview.rows.length}</b> staff across <b>{preview.dates.length}</b> days ({preview.periodStart} – {preview.periodEnd}).
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <ClinicalButton variant="ghost" onClick={() => setImportOpen(false)}>Cancel</ClinicalButton>
              {!preview
                ? <ClinicalButton variant="primary" onClick={doPreview}>Preview</ClinicalButton>
                : <ClinicalButton variant="primary" onClick={saveImport} disabled={saving}>{saving ? "Saving…" : "Save roster"}</ClinicalButton>}
            </div>
          </div>
        </div>
      )}
    </ClinicalPage>
  );
}

function RoleGroup({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <td colSpan={span} className="bg-[var(--clinical-surface-2)] px-3 py-1">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--clinical-muted)]">{label}</span>
        </td>
      </tr>
      {children}
    </>
  );
}

function Legend() {
  const items: { icon: typeof Sun; label: string; hint: string }[] = [
    { icon: Sun, label: "A · AM", hint: "AM shift" },
    { icon: Sunset, label: "P · PM", hint: "PM shift" },
    { icon: Moon, label: "N · Night", hint: "Night shift" },
    { icon: Clock, label: "MID / …12", hint: "Mid / flex · 12-hour" },
    { icon: Users, label: "PCG### = private 1:1", hint: "boxed = private caregiver → DT-013" },
    { icon: Bed, label: "RD", hint: "Rest day" },
    { icon: Plane, label: "VL", hint: "Vacation leave" },
    { icon: HelpCircle, label: "x", hint: "Off / unfilled" },
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-3 py-2.5 text-[11px] text-[var(--clinical-ink-soft)]" style={{ borderColor: "var(--clinical-line)" }}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5" title={it.hint}>
          <it.icon className="h-3 w-3 text-[var(--clinical-muted)]" /> {it.label}
        </span>
      ))}
    </div>
  );
}
