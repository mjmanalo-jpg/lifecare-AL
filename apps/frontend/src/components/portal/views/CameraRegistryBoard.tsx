"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Plus, X, Trash2, Wifi, WifiOff, HelpCircle, Loader2, RefreshCw, Video } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { CAMERA_REGISTRY_KEY, parseCameras, cameraHealth, newCameraId, type CameraDevice, type CameraType } from "@/lib/cameraRegistry";

type SettingRow = { id: string; key?: string; value: string };
const input = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 bg-white";
const TAPO_STREAM_URL = "/api/camera/tapo-feed";
const TYPES: { v: CameraType; label: string }[] = [
  { v: "tapo", label: "Tapo (MJPEG proxy)" }, { v: "rtsp", label: "RTSP via gateway" },
  { v: "edge", label: "Edge worker" }, { v: "local", label: "Local webcam" },
];
const EMPTY: Omit<CameraDevice, "id"> = { name: "", roomNumber: "", type: "tapo", streamUrl: TAPO_STREAM_URL, notes: "", enabled: true };

/** Camera registry + health surface — the rooms' cameras, their stream URLs,
 *  and live online/offline status (test connection or edge heartbeat). */
export default function CameraRegistryBoard() {
  const { data: settingRows, refetch } = useLiveQuery<SettingRow>("app-settings", { tables: ["AppSetting"] });
  const cameras = useMemo(() => parseCameras(settingRows.find((r) => (r.key || r.id) === CAMERA_REGISTRY_KEY)?.value), [settingRows]);

  const [now, setNow] = useState(0);
  useEffect(() => { const t0 = setTimeout(() => setNow(Date.now()), 0); const t = setInterval(() => setNow(Date.now()), 30_000); return () => { clearTimeout(t0); clearInterval(t); }; }, []);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CameraDevice | null>(null);
  const [form, setForm] = useState<Omit<CameraDevice, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState("");
  const testingRef = useRef("");
  const cacheBustRef = useRef(0);
  const [preview, setPreview] = useState<CameraDevice | null>(null);

  const persist = async (next: CameraDevice[]) => { await upsertRecord("app-settings", CAMERA_REGISTRY_KEY, { key: CAMERA_REGISTRY_KEY, value: JSON.stringify(next) }); await refetch(); };
  const patchCamera = async (id: string, patch: Partial<CameraDevice>) => persist(cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (c: CameraDevice) => { setEditing(c); setForm({ ...EMPTY, ...c }); setShowForm(true); };
  const save = async () => {
    if (!form.name.trim() || !form.streamUrl.trim()) { Swal.fire({ title: "Name and stream URL are required", icon: "warning" }); return; }
    setSaving(true);
    try {
      if (editing) await persist(cameras.map((c) => (c.id === editing.id ? { ...c, ...form } : c)));
      else await persist([...cameras, { ...form, id: newCameraId() }]);
      setShowForm(false);
    } finally { setSaving(false); }
  };
  const remove = async (c: CameraDevice) => {
    const r = await Swal.fire({ title: "Remove camera?", text: c.name, icon: "warning", showCancelButton: true, confirmButtonColor: "#dc2626" });
    if (r.isConfirmed) await persist(cameras.filter((x) => x.id !== c.id));
  };

  // Load the stream in an <img> (works for MJPEG/image feeds like the Tapo proxy)
  // and record online/offline. Real reachability test from the viewer's network.
  const testConnection = (c: CameraDevice) => {
    if (testing) return;
    setTesting(c.id); testingRef.current = c.id;
    const img = new window.Image();
    let settled = false;
    const done = (ok: boolean) => { if (settled) return; settled = true; img.src = ""; testingRef.current = ""; setTesting(""); void patchCamera(c.id, { lastSeenAt: ok ? new Date().toISOString() : c.lastSeenAt, lastStatus: ok ? "online (tested)" : "unreachable" }); Swal.fire({ title: ok ? "Camera reachable" : "Camera unreachable", text: ok ? `${c.name} responded.` : `Could not load ${c.name}'s stream from here. Are you on the facility network / is the backend up?`, icon: ok ? "success" : "error", timer: ok ? 1800 : undefined, showConfirmButton: !ok }); };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = c.streamUrl + (c.streamUrl.includes("?") ? "&" : "?") + "t=" + (cacheBustRef.current += 1);
    setTimeout(() => done(false), 8000);
  };

  const HEALTH = { online: { icon: Wifi, cls: "text-green-600 bg-green-50 border-green-200", label: "Online" }, offline: { icon: WifiOff, cls: "text-red-600 bg-red-50 border-red-200", label: "Offline" }, unknown: { icon: HelpCircle, cls: "text-gray-500 bg-gray-50 border-gray-200", label: "Unknown" } };

  const stats = useMemo(() => { const h = cameras.map((c) => cameraHealth(c, now)); return { total: cameras.length, online: h.filter((x) => x === "online").length, offline: h.filter((x) => x === "offline").length }; }, [cameras, now]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Camera className="w-6 h-6 text-blue-600" /> Camera Registry &amp; Health</h1>
          <p className="text-gray-500 text-sm">Room cameras, their streams, and live online/offline status.</p>
        </div>
        <div className="flex gap-2 self-start">
          <button onClick={() => void refetch()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={openAdd} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700"><Plus className="w-4 h-4" /> Add Camera</button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Cameras" value={stats.total} cls="text-blue-600" />
        <Stat label="Online" value={stats.online} cls="text-green-600" />
        <Stat label="Offline" value={stats.offline} cls={stats.offline ? "text-red-600" : "text-gray-500"} />
      </div>

      {cameras.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center text-gray-400">
          <Camera className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No cameras registered</p>
          <p className="text-sm mt-1">Add a camera — use the Tapo preset to test your existing camera.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {cameras.map((c) => {
            const health = cameraHealth(c, now);
            const H = HEALTH[health]; const HIcon = H.icon;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">Room {c.roomNumber || "—"} · {c.type}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${H.cls}`}><HIcon className="w-3 h-3" /> {H.label}</span>
                </div>
                <p className="text-[11px] text-gray-400 truncate" title={c.streamUrl}>{c.streamUrl}</p>
                <div className="text-[11px] text-gray-500 space-y-0.5">
                  <p>Last seen: {c.lastSeenAt ? new Date(c.lastSeenAt).toLocaleString() : "never"}{c.lastStatus ? ` · ${c.lastStatus}` : ""}</p>
                  {c.lastEventAt && <p>Last event: {new Date(c.lastEventAt).toLocaleString()}</p>}
                  {!c.enabled && <p className="text-amber-600 font-semibold">Disabled</p>}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  <button onClick={() => testConnection(c)} disabled={!!testing} className="text-[11px] px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1 disabled:opacity-50">{testing === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />} Test connection</button>
                  <button onClick={() => setPreview(c)} className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1"><Video className="w-3 h-3" /> Preview</button>
                  <button onClick={() => openEdit(c)} className="text-[11px] px-2 py-1 rounded border border-gray-200 text-gray-600 hover:bg-gray-50">Edit</button>
                  <button onClick={() => remove(c)} className="text-[11px] px-2 py-1 rounded text-red-500 hover:bg-red-50 inline-flex items-center gap-1"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-blue-600 px-5 py-4 text-white rounded-t-xl">
              <h3 className="font-bold">{editing ? "Edit Camera" : "Add Camera"}</h3>
              <button onClick={() => setShowForm(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Name *<input className={input + " mt-1"} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Room 302 camera" /></label>
              <label className="text-xs font-medium text-gray-600">Room number<input className={input + " mt-1"} value={form.roomNumber} onChange={(e) => setForm({ ...form, roomNumber: e.target.value })} placeholder="302" /></label>
              <label className="text-xs font-medium text-gray-600">Type<select className={input + " mt-1"} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CameraType })}>{TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}</select></label>
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Stream URL * <button type="button" onClick={() => setForm({ ...form, type: "tapo", streamUrl: TAPO_STREAM_URL })} className="ml-2 text-blue-600 hover:underline">use Tapo preset</button><input className={input + " mt-1"} value={form.streamUrl} onChange={(e) => setForm({ ...form, streamUrl: e.target.value })} placeholder="/api/camera/tapo-feed or https://gateway/room302.m3u8" /></label>
              <label className="text-xs font-medium text-gray-600 sm:col-span-2">Notes<input className={input + " mt-1"} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} className="w-4 h-4 rounded" /> Enabled (monitored)</label>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">Cancel</button>
              <button onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} {editing ? "Save" : "Add"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Live preview */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setPreview(null)}>
          <div className="w-full max-w-2xl rounded-xl bg-white overflow-hidden shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-gray-900 px-5 py-3 text-white">
              <span className="font-semibold flex items-center gap-2"><Video className="w-4 h-4" /> {preview.name} — Room {preview.roomNumber || "—"}</span>
              <button onClick={() => setPreview(null)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.streamUrl} alt={preview.name} className="w-full max-h-[70vh] object-contain bg-black" />
            <p className="text-xs text-gray-500 px-5 py-2">Live preview loads from your network. If it stays black, the stream URL isn&apos;t reachable from here.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return <div className="rounded-xl border border-gray-200 bg-white p-4"><p className="text-xs font-semibold text-gray-500">{label}</p><p className={`text-2xl font-bold mt-1 ${cls}`}>{value}</p></div>;
}
