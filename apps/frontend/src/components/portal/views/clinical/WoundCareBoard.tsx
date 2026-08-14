"use client";

/**
 * Wound Care Tracker — register and track wound healing progress with photos.
 * Migration-free: wound records are a JSON array in the app-setting `wound_records`
 * (the WoundCare Prisma model has no notes/stage/status/photo columns). Photos are
 * downscaled client-side to a JPEG data URL before storage.
 */

import { useMemo, useState, useRef } from "react";
import { Plus, Camera, Trash2, Image as ImageIcon, Bandage, ShieldAlert, MapPin, CalendarDays, UserRound, Clock } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, DataState, FieldLabel, SearchInput, controlClass } from "./clinical-ui";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const WOUND_KEY = "wound_records";
const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `wnd-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const localNow = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmt = (isoStr: string) => (isoStr ? new Date(isoStr).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const WOUND_TYPES = ["Pressure Ulcer", "Surgical", "Traumatic", "Diabetic", "Other"];
const STAGES = ["Stage 1", "Stage 2", "Stage 3", "Stage 4", "Unstageable", "DTI"];
const STATUSES = ["Active", "Healing", "Healed", "Referred"] as const;
type WStatus = (typeof STATUSES)[number];

// Wound status → the clinical-editorial accent. Active reads as attention (coral),
// Healing as in-progress (amber), Healed as resolved (green), Referred as info (teal).
const WOUND_ACCENT: Record<WStatus, "coral" | "amber" | "green" | "teal"> = { Active: "coral", Healing: "amber", Healed: "green", Referred: "teal" };
const ACCENT_VAR: Record<"coral" | "amber" | "green" | "teal", string> = { coral: "var(--clinical-coral)", amber: "var(--clinical-amber)", green: "var(--clinical-green)", teal: "var(--clinical-panel)" };

// Theme-safe status chip: ink label + a coloured dot (no per-theme contrast traps).
function WoundStatus({ status }: { status: WStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT_VAR[WOUND_ACCENT[status]] }} />{status}
    </span>
  );
}

interface Wound { id: string; residentId: string; woundType: string; stage: string; bodyLocation: string; discoveredAt: string; discoveredBy?: string; notes?: string; status: WStatus; photo?: string; createdAt: string; updatedAt: string; }
const parseWounds = (raw: string | null | undefined): Wound[] => { if (!raw) return []; try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((w) => w && typeof w.id === "string") : []; } catch { return []; } };

// Downscale an image file to a JPEG data URL (keeps app-settings JSON small).
async function toDataUrl(file: File, maxDim = 900, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d"); if (!ctx) { reject(new Error("no canvas")); return; }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export default function WoundCareBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { name: clinicianName } = useClinician(clinicianRole);
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const { data: settingRows, loading, error, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const wounds = useMemo(() => parseWounds(settingRows.find((r) => (r.key || r.id) === WOUND_KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "Resident", room: "" }; };

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [resFilter, setResFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const query = search.trim().toLowerCase();
  const filtered = wounds.filter((w) => {
    const resident = resName(w.residentId);
    const matchesQuery = !query || [resident.name, resident.room, w.woundType, w.stage, w.bodyLocation, w.notes].some((value) => s(value).toLowerCase().includes(query));
    return matchesQuery && (!statusFilter || w.status === statusFilter) && (!resFilter || w.residentId === resFilter);
  });
  const count = (st: WStatus) => wounds.filter((w) => w.status === st).length;
  const openWounds = wounds.filter((w) => w.status === "Active" || w.status === "Healing");
  const openResidents = new Set(openWounds.map((w) => w.residentId)).size;
  const highAcuity = openWounds.filter((w) => ["Stage 3", "Stage 4", "Unstageable", "DTI"].includes(w.stage)).length;
  const photoCount = wounds.filter((w) => Boolean(w.photo)).length;

  const persist = async (next: Wound[]) => { await upsertRecord("app-settings", WOUND_KEY, { key: WOUND_KEY, value: JSON.stringify(next) }); await refetch(); };
  const create = async (w: Omit<Wound, "id" | "status" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    await persist([{ ...w, id: newId(), status: "Active", createdAt: now, updatedAt: now }, ...wounds]);
    setOpen(false);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: "Wound record created", showConfirmButton: false, timer: 1600 });
  };
  const setStatus = async (id: string, status: WStatus) => { await persist(wounds.map((w) => (w.id === id ? { ...w, status, updatedAt: new Date().toISOString() } : w))); };
  const remove = async (w: Wound) => { const c = await Swal.fire({ title: "Delete wound record?", icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626", confirmButtonText: "Delete" }); if (c.isConfirmed) await persist(wounds.filter((x) => x.id !== w.id)); };

  return (
    <ClinicalPage>
      <ClinicalHeader
        title="Wound Care"
        subtitle="Coordinate wound assessments, monitor healing status, and keep treatment documentation visible across the care team."
        right={<ClinicalButton variant="accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New Wound</ClinicalButton>}
      />

      <section className="clinical-summary-band mt-6 overflow-hidden rounded-2xl bg-[var(--clinical-panel)] text-white">
        <div className="grid gap-px bg-white/15 sm:grid-cols-[1.35fr_repeat(3,1fr)]">
          <div className="bg-[var(--clinical-panel)] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div><p className="text-sm font-semibold text-blue-100">Open wound caseload</p><p className="mt-1 text-3xl font-bold tracking-[-0.03em]">{openWounds.length}</p></div>
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Bandage className="h-6 w-6" /></div>
            </div>
            <p className="mt-4 text-xs leading-5 text-blue-100">{openResidents} {openResidents === 1 ? "resident has" : "residents have"} an active or healing wound.</p>
          </div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Active</p><p className="mt-2 text-2xl font-bold tabular-nums">{count("Active")}</p><p className="mt-1 text-xs text-blue-100">Requires monitoring</p></div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">High-acuity</p><p className="mt-2 text-2xl font-bold tabular-nums">{highAcuity}</p><p className="mt-1 text-xs text-blue-100">Stage 3+ or unstageable</p></div>
          <div className="bg-[var(--clinical-panel)] p-5"><p className="text-xs font-semibold text-blue-100">Photo documented</p><p className="mt-2 text-2xl font-bold tabular-nums">{photoCount}</p><p className="mt-1 text-xs text-blue-100">{count("Healing")} healing · {count("Healed")} healed</p></div>
        </div>
      </section>

      <div className="my-5 grid gap-3 rounded-2xl border p-3 lg:grid-cols-[minmax(260px,1fr)_auto] xl:grid-cols-[minmax(300px,1fr)_auto_260px] xl:items-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search resident, location, type, or stage..." className="min-w-0 lg:col-span-2 xl:col-span-1" />
        <div role="tablist" aria-label="Wound status" className="grid grid-cols-5 gap-1 rounded-xl bg-[var(--clinical-surface-2)] p-1">
          {([["", "All", wounds.length], ...STATUSES.map((status) => [status, status, count(status)] as const)] as const).map(([value, label, total]) => (
            <button key={value || "all"} role="tab" aria-selected={statusFilter === value} onClick={() => setStatusFilter(value)} className={`min-h-10 whitespace-nowrap rounded-lg px-2 text-xs font-semibold transition ${statusFilter === value ? "bg-[var(--clinical-surface-raised,var(--clinical-surface))] text-[var(--clinical-ink)] shadow-sm" : "text-[var(--clinical-muted)] hover:text-[var(--clinical-ink)]"}`}>{label}<span className="ml-1 tabular-nums opacity-65">{total}</span></button>
          ))}
        </div>
        <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} aria-label="Filter by resident" className={controlClass}><option value="">All residents</option>{residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}</select>
      </div>

      <div className="hidden">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status" className={`${controlClass} w-full sm:w-44`}><option value="">All Status</option>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
        <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} aria-label="Filter by resident" className={`${controlClass} w-full sm:w-64`}><option value="">All Residents</option>{residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}</select>
      </div>

      <DataState
        loading={loading && wounds.length === 0}
        error={error}
        empty={filtered.length === 0}
        emptyTitle={wounds.length === 0 ? "No wounds recorded" : "No wounds match these filters"}
        emptyHint={wounds.length === 0 ? "Log the first wound to start tracking its healing progress." : "Clear the search or filters to see all records."}
        emptyAction={wounds.length === 0 ? <ClinicalButton variant="accent" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New Wound</ClinicalButton> : undefined}
        onRetry={() => void refetch()}
        skeletonRows={3}
      >
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((w) => { const rn = resName(w.residentId); return (
            <article key={w.id} className="overflow-hidden rounded-2xl border transition hover:border-[var(--clinical-line-strong)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
              {w.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.photo} alt={`Wound on ${w.bodyLocation || "resident"}`} className="hidden" />
              ) : (
                <div className="hidden">
                  <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--clinical-surface)] text-[var(--clinical-panel)]"><Bandage className="h-6 w-6" /></span><div><p className="font-bold text-[var(--clinical-ink)]">{w.woundType}</p><p className="mt-0.5 text-xs text-[var(--clinical-muted)]">{w.stage}</p></div></div>
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--clinical-muted)]"><ImageIcon className="h-4 w-4" /> No photo</span>
                </div>
              )}
              <div className="p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    {w.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.photo} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                    ) : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--clinical-surface-2)] text-[var(--clinical-panel)]"><Bandage className="h-5 w-5" /></span>}
                    <span className="hidden">{rn.room}</span>
                    <div className="min-w-0"><p className="truncate font-bold text-[var(--clinical-ink)]">{rn.name}</p><p className="mt-0.5 truncate text-xs font-semibold text-[var(--clinical-ink-soft)]">{w.woundType} · {w.stage}</p><p className="mt-1 flex items-center gap-1 truncate text-[11px] text-[var(--clinical-muted)]"><MapPin className="h-3 w-3 shrink-0" /> {w.bodyLocation || "Location not recorded"} · Room {rn.room}</p></div>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {["Stage 3", "Stage 4", "Unstageable", "DTI"].includes(w.stage) && w.status !== "Healed" && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--clinical-coral)]"><ShieldAlert className="h-3.5 w-3.5" /> High-acuity</span>}
                    <WoundStatus status={w.status} />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-y py-3" style={{ borderColor: "var(--clinical-line)" }}>
                  <div className="flex min-w-0 items-center gap-2"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-panel)]" /><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Discovered</p><p className="truncate text-xs text-[var(--clinical-ink-soft)]">{fmt(w.discoveredAt)}</p></div></div>
                  <div className="flex min-w-0 items-center gap-2"><Clock className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-panel)]" /><div className="min-w-0"><p className="text-[9px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Updated</p><p className="truncate text-xs text-[var(--clinical-ink-soft)]">{fmt(w.updatedAt)}</p></div></div>
                  <div className="col-span-2 flex min-w-0 items-center gap-2"><UserRound className="h-3.5 w-3.5 shrink-0 text-[var(--clinical-panel)]" /><p className="truncate text-xs text-[var(--clinical-muted)]">Documented by <span className="font-semibold text-[var(--clinical-ink-soft)]">{w.discoveredBy || "Not recorded"}</span></p></div>
                </div>

                <div className="hidden">
                  <div className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-panel)]" /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Body location</p><p className="mt-0.5 text-sm font-semibold text-[var(--clinical-ink-soft)]">{w.bodyLocation || "Not recorded"}</p></div></div>
                  <div className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-panel)]" /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Discovered</p><p className="mt-0.5 text-sm text-[var(--clinical-ink-soft)]">{fmt(w.discoveredAt)}</p></div></div>
                  <div className="flex items-start gap-2"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-panel)]" /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Documented by</p><p className="mt-0.5 text-sm text-[var(--clinical-ink-soft)]">{w.discoveredBy || "Not recorded"}</p></div></div>
                  <div className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--clinical-panel)]" /><div><p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--clinical-muted)]">Last updated</p><p className="mt-0.5 text-sm text-[var(--clinical-ink-soft)]">{fmt(w.updatedAt)}</p></div></div>
                </div>

                {w.notes && <p className="mt-2.5 line-clamp-2 rounded-lg bg-[var(--clinical-surface-2)] px-2.5 py-2 text-xs leading-5 text-[var(--clinical-ink-soft)]">{w.notes}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <label className="min-w-0 flex-1"><span className="sr-only">Update wound status</span><select value={w.status} onChange={(e) => setStatus(w.id, e.target.value as WStatus)} aria-label={`Update status for ${rn.name}'s wound`} className={`${controlClass} py-2 text-xs`}>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select></label>
                  <button onClick={() => remove(w)} aria-label="Delete wound record" title="Delete wound record" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--clinical-coral)] transition hover:bg-[var(--clinical-surface-2)]"><Trash2 className="h-4 w-4" /></button>
                </div>
                <div className="hidden">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><p className="truncate font-semibold text-[var(--clinical-ink)]">{rn.name}</p><p className="text-xs text-[var(--clinical-muted)]">Rm {rn.room}</p></div>
                  <WoundStatus status={w.status} />
                </div>
                <p className="mt-2 text-sm font-semibold text-[var(--clinical-ink)]">{w.woundType} · {w.stage}</p>
                <p className="text-sm text-[var(--clinical-muted)]">{w.bodyLocation}</p>
                <p className="mt-1 text-xs text-[var(--clinical-muted)]">Discovered {fmt(w.discoveredAt)}{w.discoveredBy ? ` · ${w.discoveredBy}` : ""}</p>
                {w.notes && <p className="mt-2 text-sm text-[var(--clinical-ink-soft)]">{w.notes}</p>}
                <div className="mt-3 flex items-center gap-2">
                  <select value={w.status} onChange={(e) => setStatus(w.id, e.target.value as WStatus)} aria-label={`Update status for ${rn.name}'s wound`} className={`${controlClass} w-auto py-1.5 text-xs`}>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
                  <button onClick={() => remove(w)} aria-label="Delete wound record" className="rounded-lg p-2 text-[var(--clinical-coral)] transition hover:bg-[var(--clinical-surface-2)]"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              </div>
            </article>
          ); })}
        </div>
      </DataState>

      <NewWoundModal open={open} residents={residents} discoveredBy={clinicianName} onClose={() => setOpen(false)} onCreate={create} />
    </ClinicalPage>
  );
}

function NewWoundModal({ open, residents, discoveredBy, onClose, onCreate }: {
  open: boolean; residents: Row[]; discoveredBy: string; onClose: () => void; onCreate: (w: Omit<Wound, "id" | "status" | "createdAt" | "updatedAt">) => Promise<void>;
}) {
  const [resId, setResId] = useState("");
  const [woundType, setWoundType] = useState("Pressure Ulcer");
  const [stage, setStage] = useState("Stage 1");
  const [bodyLocation, setBodyLocation] = useState("");
  const [discoveredAt, setDiscoveredAt] = useState(localNow());
  const [by, setBy] = useState(discoveredBy);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { setPhoto(await toDataUrl(file)); } catch { Swal.fire({ title: "Could not read photo", icon: "error" }); }
    e.target.value = "";
  };

  const submit = async () => {
    if (!resId || !woundType || !stage || !bodyLocation.trim()) { Swal.fire({ title: "Missing required fields", text: "Resident, wound type, stage, and body location are required.", icon: "warning" }); return; }
    setSaving(true);
    try { await onCreate({ residentId: resId, woundType, stage, bodyLocation: bodyLocation.trim(), discoveredAt: new Date(discoveredAt).toISOString(), discoveredBy: by || undefined, notes: notes || undefined, photo }); }
    finally { setSaving(false); }
  };

  return (
    <ClinicalModal
      open={open}
      onClose={onClose}
      title="New Wound Record"
      description="Register a wound and its initial assessment"
      footer={<>
        <ClinicalButton variant="ghost" size="sm" onClick={onClose}>Cancel</ClinicalButton>
        <ClinicalButton variant="accent" onClick={submit} disabled={saving}>{saving ? "Saving…" : "Create Wound Record"}</ClinicalButton>
      </>}
    >
      <div className="space-y-4">
        <div><FieldLabel required htmlFor="wnd-res">Resident</FieldLabel><select id="wnd-res" value={resId} onChange={(e) => setResId(e.target.value)} className={controlClass}><option value="">Select resident…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}</select></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><FieldLabel required htmlFor="wnd-type">Wound Type</FieldLabel><select id="wnd-type" value={woundType} onChange={(e) => setWoundType(e.target.value)} className={controlClass}>{WOUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><FieldLabel required htmlFor="wnd-stage">Initial Stage</FieldLabel><select id="wnd-stage" value={stage} onChange={(e) => setStage(e.target.value)} className={controlClass}>{STAGES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
        </div>
        <div><FieldLabel required htmlFor="wnd-loc">Body Location</FieldLabel><input id="wnd-loc" value={bodyLocation} onChange={(e) => setBodyLocation(e.target.value)} placeholder="e.g. Sacrum, Left heel" className={controlClass} /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><FieldLabel htmlFor="wnd-at">Discovered At</FieldLabel><input id="wnd-at" type="datetime-local" value={discoveredAt} onChange={(e) => setDiscoveredAt(e.target.value)} className={controlClass} /></div>
          <div><FieldLabel htmlFor="wnd-by">Discovered By</FieldLabel><input id="wnd-by" value={by} onChange={(e) => setBy(e.target.value)} className={controlClass} /></div>
        </div>

        {/* Photo upload / take photo */}
        <div>
          <FieldLabel>Wound Photo</FieldLabel>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
          {photo ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt="Wound preview" className="h-44 w-full rounded-xl border object-cover" style={{ borderColor: "var(--clinical-line)" }} />
              <button type="button" onClick={() => setPhoto(undefined)} aria-label="Remove photo" className="absolute right-2 top-2 rounded-lg bg-black/50 p-1.5 text-white hover:bg-black/70"><Trash2 className="h-4 w-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-6 text-[var(--clinical-muted)] transition hover:border-[var(--clinical-panel)] hover:text-[var(--clinical-ink)]" style={{ borderColor: "var(--clinical-line-strong)" }}>
              <div className="flex items-center gap-2"><Camera className="h-5 w-5" /><ImageIcon className="h-5 w-5" /></div>
              <span className="text-sm font-medium">Take photo or upload</span>
            </button>
          )}
        </div>

        <div><FieldLabel htmlFor="wnd-notes">Notes</FieldLabel><textarea id="wnd-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Initial observations…" className={controlClass} /></div>
      </div>
    </ClinicalModal>
  );
}
