"use client";

/**
 * One Care · One Journey — a per-resident journey library.
 *
 * Read-only aggregator: for the selected resident it compiles EVERY record/form
 * across the system (assessment, LOC, acuity, care-plan reviews, medications,
 * incidents, wounds, referrals, clinical records, shift endorsements, weight,
 * private caregiver, documents, notes, admission) into one chronological feed.
 * The compilation lives in `lib/residentJourney.ts`; this component only sources
 * the raw records (Prisma via useLiveQuery + app-setting JSON) and renders them.
 *
 * Roles: Nurse + Care Manager (deep-links to each source board) and Family
 * (read-only, sponsor-scoped by the API — deep-links hidden). Migration-free.
 */

import { useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  Search, ChevronRight, ExternalLink, Printer,
  UserPlus, ClipboardList, Gauge, Layers, Pill, AlertTriangle, Bandage,
  Stethoscope, FolderOpen, FileText, Scale, HeartHandshake, StickyNote, ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";
import { type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, StatCard, DataState, SERIF } from "./clinical-ui";
import {
  buildJourney, JOURNEY_CATEGORY_META, JOURNEY_CATEGORY_ORDER,
  type JourneyCategory, type JourneyAccent, type JourneyEvent,
} from "@/lib/residentJourney";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const s = (v: unknown) => (v == null ? "" : String(v));
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const pick = (r: Row, ...keys: string[]) => { for (const k of keys) { const v = r?.[k]; if (v != null && v !== "") return s(v); } return ""; };
const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); };
const fmtDay = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" }); };

const ACCENT_VAR: Record<JourneyAccent, string> = {
  teal: "var(--clinical-panel)", green: "var(--clinical-green)", amber: "var(--clinical-amber)",
  coral: "var(--clinical-coral)", ink: "var(--clinical-ink-soft)",
};
const CATEGORY_ICON: Record<JourneyCategory, LucideIcon> = {
  ADMISSION: UserPlus, ASSESSMENT: ClipboardList, LOC: Gauge, CARE_PLAN: ClipboardCheck,
  ACUITY: Layers, MEDICATION: Pill, INCIDENT: AlertTriangle, WOUND: Bandage,
  REFERRAL: Stethoscope, CLINICAL_RECORD: FolderOpen, ENDORSEMENT: FileText,
  WEIGHT: Scale, PRIVATE_CARE: HeartHandshake, DOCUMENT: FileText, NOTE: StickyNote,
};

const settingVal = (rows: Row[], key: string) => rows.find((r) => s(r.key || r.id) === key)?.value as string | undefined;
const parseArr = (raw: string | undefined): Row[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; } };
const parseObj = (raw: string | undefined): Record<string, Row[]> => { if (!raw) return {}; try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

export default function ResidentJourneyBoard({ clinicianRole = "NURSE", readOnly = false }: { clinicianRole?: ClinicianRole; readOnly?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  // Portal segment from the live URL (nurse / care_manager / …) — the Care Manager
  // portal passes clinicianRole="FACILITY_ADMIN", so the URL is the reliable source.
  const roleSeg = (pathname || "").split("/").filter(Boolean)[0] || clinicianRole.toLowerCase();
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });
  const medQ = useLiveQuery<Row>("medications", { query: "take=2000", tables: ["Medication"] });
  const incQ = useLiveQuery<Row>("incidents", { query: "take=2000", tables: ["Incident"] });
  const refQ = useLiveQuery<Row>("hospital-referrals", { query: "take=1000", tables: ["HospitalReferral"] });
  const docQ = useLiveQuery<Row>("resident-documents", { query: "take=1000", tables: ["ResidentDocument"] });
  const noteQ = useLiveQuery<Row>("resident-notes", { query: "take=2000", tables: ["ResidentNote"] });

  const residents = useMemo(() => (resQ.data || []).map((raw) => {
    const a = adaptResident(raw);
    const room = s(a.room ?? raw.room ?? "");
    return {
      id: s(a.id), name: s(a.name), room,
      admittedAt: pick(raw, "moveInDate", "admissionDate", "createdAt"),
      admissionSummary: [room ? `Room ${room}` : "", s(raw.careLevel) ? s(raw.careLevel) : ""].filter(Boolean).join(" · ") || undefined,
    };
  }), [resQ.data]);

  const [resId, setResId] = useState("");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<JourneyCategory | "ALL">("ALL");

  const resident = useMemo(() => residents.find((r) => r.id === resId) || null, [residents, resId]);

  const journey = useMemo<JourneyEvent[]>(() => {
    if (!resident) return [];
    return buildJourney({
      residentId: resident.id,
      admittedAt: resident.admittedAt || undefined,
      admissionSummary: resident.admissionSummary,
      locHistory: parseArr(settingVal(settingRows, "loc_history")),
      assessmentsV42: parseArr(settingVal(settingRows, "assessments_v42")),
      carePlanReviews: parseArr(settingVal(settingRows, "care_plan_reviews")),
      acuity: parseArr(settingVal(settingRows, "acuity_assessments")),
      woundRecords: parseArr(settingVal(settingRows, "wound_records")),
      endorsements: parseArr(settingVal(settingRows, "shift_endorsements")),
      weightLogs: parseArr(settingVal(settingRows, "weight_logs")),
      clinicalRecords: parseObj(settingVal(settingRows, "clinical_records")),
      privateCare: parseArr(settingVal(settingRows, "private_caregiver_assignments")),
      medications: medQ.data || [],
      incidents: incQ.data || [],
      referrals: refQ.data || [],
      documents: docQ.data || [],
      notes: noteQ.data || [],
    });
  }, [resident, settingRows, medQ.data, incQ.data, refQ.data, docQ.data, noteQ.data]);

  // Counts per category (for the filter chips) + the filtered feed.
  const counts = useMemo(() => {
    const m = new Map<JourneyCategory, number>();
    journey.forEach((e) => m.set(e.category, (m.get(e.category) || 0) + 1));
    return m;
  }, [journey]);
  const events = useMemo(() => (cat === "ALL" ? journey : journey.filter((e) => e.category === cat)), [journey, cat]);

  const span = useMemo(() => {
    if (journey.length === 0) return "—";
    const last = journey[0].date, first = journey[journey.length - 1].date;
    return first === last ? fmtDate(first) : `${fmtDate(first)} → ${fmtDate(last)}`;
  }, [journey]);

  const q = search.trim().toLowerCase();
  const filteredResidents = residents.filter((r) => !q || r.name.toLowerCase().includes(q) || r.room.toLowerCase().includes(q));

  // Deep-link to a source board. The assessment board (careacuity) opens straight
  // to this resident via ?resident=; other boards just switch tab.
  const openTab = (tab?: string) => {
    if (!tab || readOnly) return;
    const q = tab === "careacuity" && resident ? `?resident=${encodeURIComponent(resident.id)}` : "";
    router.push(`/${roleSeg}/${tab}${q}`);
  };

  // Group the filtered feed by calendar day for the timeline rails.
  const groups = useMemo(() => {
    const g: { day: string; items: JourneyEvent[] }[] = [];
    for (const e of events) {
      const day = (e.date || "").slice(0, 10);
      const last = g[g.length - 1];
      if (last && last.day === day) last.items.push(e); else g.push({ day, items: [e] });
    }
    return g;
  }, [events]);

  // ── Resident picker ─────────────────────────────────────────────────────────
  if (!resident) {
    return (
      <ClinicalPage>
        <ClinicalHeader title="One Care · One Journey" subtitle="Every record and form for a resident, compiled into one continuous journey." />
        <div className="relative mt-5 mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--clinical-muted)]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search resident by name or room…" aria-label="Search residents" className="w-full rounded-2xl border py-3 pl-11 pr-4 text-sm outline-none focus:ring-2 focus:ring-[var(--clinical-panel)]/30" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }} />
        </div>
        <DataState loading={resQ.loading && residents.length === 0} error={resQ.error} empty={filteredResidents.length === 0} emptyTitle={q ? "No residents match" : "No residents yet"} emptyHint={q ? "Try a different name or room." : "Residents appear here once admitted."} onRetry={() => void resQ.refetch()} skeletonRows={5}>
          <div className="space-y-2">
            {filteredResidents.map((r) => (
              <button key={r.id} onClick={() => setResId(r.id)} className="group flex w-full items-center gap-3 rounded-xl border p-3.5 text-left transition hover:shadow-sm" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold" style={{ backgroundColor: "var(--clinical-surface-2)", color: "var(--clinical-ink-soft)" }}>{initials(r.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--clinical-ink)]">{r.name}</p>
                  <p className="text-xs text-[var(--clinical-muted)]">{r.room ? `Room ${r.room}` : "—"}{r.admittedAt ? ` · admitted ${fmtDate(r.admittedAt)}` : ""}</p>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--clinical-muted)] transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </DataState>
      </ClinicalPage>
    );
  }

  // ── Resident journey ─────────────────────────────────────────────────────────
  return (
    <ClinicalPage>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClinicalButton variant="secondary" size="sm" onClick={() => { setResId(""); setCat("ALL"); }}><ChevronRight className="h-4 w-4 rotate-180" /> Residents</ClinicalButton>
          <div>
            <h1 className="text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{resident.name}</h1>
            <p className="text-sm text-[var(--clinical-muted)]">One Care · One Journey{resident.room ? ` — Room ${resident.room}` : ""}</p>
          </div>
        </div>
        <ClinicalButton variant="secondary" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</ClinicalButton>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={journey.length} label="Journey entries" accent="ink" />
        <StatCard value={counts.size} label="Record types" accent="ink" />
        <StatCard value={span} label="Span" accent="ink" />
        <StatCard value={journey[0] ? fmtDate(journey[0].date) : "—"} label="Latest entry" accent="ink" />
      </div>

      {/* Category filter chips */}
      <div className="mb-5 flex flex-wrap gap-2">
        <FilterChip active={cat === "ALL"} label="All" count={journey.length} onClick={() => setCat("ALL")} />
        {JOURNEY_CATEGORY_ORDER.filter((c) => counts.get(c)).map((c) => (
          <FilterChip key={c} active={cat === c} label={JOURNEY_CATEGORY_META[c].label} count={counts.get(c) || 0} accent={JOURNEY_CATEGORY_META[c].accent} onClick={() => setCat(c)} />
        ))}
      </div>

      {events.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
          {journey.length === 0 ? "No records compiled for this resident yet. As forms and records are added anywhere in the system, they appear here automatically." : "No entries in this category."}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((grp) => (
            <div key={grp.day}>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">{fmtDay(grp.day)}</p>
              <div className="space-y-2.5">
                {grp.items.map((e) => {
                  const m = JOURNEY_CATEGORY_META[e.category];
                  const Icon = CATEGORY_ICON[e.category];
                  const color = ACCENT_VAR[m.accent];
                  return (
                    <div key={e.id} className="flex gap-3 rounded-xl border p-3.5" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, var(--clinical-surface))`, color }}><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, var(--clinical-surface))`, color }}>{m.label}</span>
                          {e.status ? <span className="text-[11px] font-semibold text-[var(--clinical-ink-soft)]">{e.status}</span> : null}
                          <span className="ml-auto text-[11px] tabular-nums text-[var(--clinical-muted)]">{fmtDate(e.date)}</span>
                        </div>
                        <p className="mt-1 font-semibold text-[var(--clinical-ink)]">{e.title}</p>
                        {e.summary ? <p className="mt-0.5 line-clamp-2 text-sm text-[var(--clinical-ink-soft)]">{e.summary}</p> : null}
                        <div className="mt-1 flex flex-wrap items-center gap-3">
                          {e.by ? <span className="text-[11px] text-[var(--clinical-muted)]">by {e.by}</span> : null}
                          {e.href ? <a href={e.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-panel)] hover:underline">View document <ExternalLink className="h-3 w-3" /></a> : null}
                          {!readOnly && e.tab ? <button onClick={() => openTab(e.tab)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-panel)] hover:underline">Open in {m.label} <ChevronRight className="h-3 w-3" /></button> : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </ClinicalPage>
  );
}

function FilterChip({ active, label, count, accent = "ink", onClick }: { active: boolean; label: string; count: number; accent?: JourneyAccent; onClick: () => void }) {
  const color = ACCENT_VAR[accent];
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
      style={active
        ? { backgroundColor: color, borderColor: color, color: "#ffffff" }
        : { backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line-strong)", color: "var(--clinical-ink-soft)" }}>
      {label}
      <span className="rounded-full px-1.5 text-[10px] tabular-nums" style={active ? { backgroundColor: "rgba(255,255,255,0.25)" } : { backgroundColor: "var(--clinical-surface-2)" }}>{count}</span>
    </button>
  );
}
