"use client";

/**
 * Wound Care Tracker — register and track wound healing progress with photos.
 * Migration-free: wound records are a JSON array in the app-setting `wound_records`
 * (the WoundCare Prisma model has no notes/stage/status/photo columns). Photos are
 * downscaled client-side to a JPEG data URL before storage.
 */

import { useMemo, useState, useRef } from "react";
import { Activity, Plus, X, Camera, Trash2, Image as ImageIcon } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { adaptResident } from "@/lib/adapters";
import { useClinician, type ClinicianRole } from "./useClinician";

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
const STATUS_META: Record<WStatus, { tone: string; badge: string; card: string }> = {
  Active: { tone: "#dc2626", badge: "bg-red-100 text-red-700", card: "bg-red-50 border-red-200" },
  Healing: { tone: "#d97706", badge: "bg-amber-100 text-amber-700", card: "bg-amber-50 border-amber-200" },
  Healed: { tone: "#16a34a", badge: "bg-green-100 text-green-700", card: "bg-green-50 border-green-200" },
  Referred: { tone: "#2563eb", badge: "bg-blue-100 text-blue-700", card: "bg-blue-50 border-blue-200" },
};

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
  const { data: settingRows, refetch } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);
  const wounds = useMemo(() => parseWounds(settingRows.find((r) => (r.key || r.id) === WOUND_KEY)?.value), [settingRows]);
  const resName = (id: string) => { const r = residents.find((x: Row) => s(x.id) === id); return r ? { name: s(r.name), room: s(r.room) } : { name: "Resident", room: "" }; };

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [resFilter, setResFilter] = useState<string>("");
  const [open, setOpen] = useState(false);

  const filtered = wounds.filter((w) => (!statusFilter || w.status === statusFilter) && (!resFilter || w.residentId === resFilter));
  const count = (st: WStatus) => wounds.filter((w) => w.status === st).length;

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
    <div className="min-h-full bg-[#F7F8FA] -m-4 sm:-m-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Wound Care Tracker</h1>
          <p className="text-sm text-slate-500 mt-1">Monitor and track wound healing progress</p>
        </div>
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> New Wound</button>
      </div>

      <div className="flex flex-wrap gap-3 mb-5">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">All Status</option>{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
        <select value={resFilter} onChange={(e) => setResFilter(e.target.value)} className="px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40"><option value="">All Residents</option>{residents.map((r: Row) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Rm {s(r.room)}</option>)}</select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {STATUSES.map((st) => { const m = STATUS_META[st]; return (
          <div key={st} className={`rounded-2xl border p-5 text-center ${m.card}`}><p className="text-3xl font-bold" style={{ color: m.tone }}>{count(st)}</p><p className="text-sm mt-1" style={{ color: m.tone }}>{st}</p></div>
        ); })}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400"><Activity className="w-12 h-12 mb-3 opacity-40" /><p>No wound records found</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((w) => { const rn = resName(w.residentId); const m = STATUS_META[w.status]; return (
            <div key={w.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              {w.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.photo} alt="Wound" className="w-full h-40 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-bold text-slate-900">{rn.name}</p><p className="text-xs text-slate-400">Rm {rn.room}</p></div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${m.badge}`}>{w.status}</span>
                </div>
                <p className="text-sm font-semibold text-slate-700 mt-2">{w.woundType} · {w.stage}</p>
                <p className="text-sm text-slate-500">{w.bodyLocation}</p>
                <p className="text-xs text-slate-400 mt-1">Discovered {fmt(w.discoveredAt)}{w.discoveredBy ? ` · ${w.discoveredBy}` : ""}</p>
                {w.notes && <p className="text-sm text-slate-600 mt-2">{w.notes}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <select value={w.status} onChange={(e) => setStatus(w.id, e.target.value as WStatus)} className="text-xs rounded-lg border border-slate-200 px-2 py-1.5 bg-white outline-none">{STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}</select>
                  <button onClick={() => remove(w)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ); })}
        </div>
      )}

      {open && <NewWoundModal residents={residents} discoveredBy={clinicianName} onClose={() => setOpen(false)} onCreate={create} />}
    </div>
  );
}

function NewWoundModal({ residents, discoveredBy, onClose, onCreate }: {
  residents: Row[]; discoveredBy: string; onClose: () => void; onCreate: (w: Omit<Wound, "id" | "status" | "createdAt" | "updatedAt">) => Promise<void>;
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

  const input = "w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:ring-2 focus:ring-blue-400/40";
  const lbl = "block text-sm font-bold text-slate-700 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-3">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100"><h2 className="font-bold text-slate-900 text-lg">New Wound Record</h2><button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          <div><label className={lbl}>Resident <span className="text-red-500">*</span></label><select value={resId} onChange={(e) => setResId(e.target.value)} className={input}><option value="">Select resident…</option>{residents.map((r) => <option key={s(r.id)} value={s(r.id)}>{s(r.name)} — Room {s(r.room)}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Wound Type <span className="text-red-500">*</span></label><select value={woundType} onChange={(e) => setWoundType(e.target.value)} className={input}>{WOUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
            <div><label className={lbl}>Initial Stage <span className="text-red-500">*</span></label><select value={stage} onChange={(e) => setStage(e.target.value)} className={input}>{STAGES.map((t) => <option key={t} value={t}>{t}</option>)}</select></div>
          </div>
          <div><label className={lbl}>Body Location <span className="text-red-500">*</span></label><input value={bodyLocation} onChange={(e) => setBodyLocation(e.target.value)} placeholder="e.g. Sacrum, Left heel" className={input} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Discovered At</label><input type="datetime-local" value={discoveredAt} onChange={(e) => setDiscoveredAt(e.target.value)} className={input} /></div>
            <div><label className={lbl}>Discovered By</label><input value={by} onChange={(e) => setBy(e.target.value)} className={input} /></div>
          </div>

          {/* Photo upload / take photo */}
          <div>
            <label className={lbl}>Wound Photo</label>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
            {photo ? (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo} alt="Wound preview" className="w-full h-44 object-cover rounded-xl border border-slate-200" />
                <button type="button" onClick={() => setPhoto(undefined)} className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70"><Trash2 className="w-4 h-4" /></button>
              </div>
            ) : (
              <button type="button" onClick={() => fileRef.current?.click()} className="w-full flex flex-col items-center justify-center gap-1.5 py-6 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-blue-300 hover:text-blue-500">
                <div className="flex items-center gap-2"><Camera className="w-5 h-5" /><ImageIcon className="w-5 h-5" /></div>
                <span className="text-sm font-medium">Take photo or upload</span>
              </button>
            )}
          </div>

          <div><label className={lbl}>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Initial observations…" className={input} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? "Saving…" : "Create Wound Record"}</button>
        </div>
      </div>
    </div>
  );
}
