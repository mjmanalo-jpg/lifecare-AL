"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, ArrowLeft, User } from "lucide-react";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { adaptResident } from "@/lib/adapters";

/* ── Camera Monitoring (Per-Resident Camera) ──────────────────────────
   Clinical monitoring surface — lives in the clinical portals (Care Manager /
   nurse). Pick a resident from the selector to watch their camera; also honours
   a ?resident/?room deep-link as the initial selection. */

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

function MonitoringViewFallback() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-lg font-semibold text-gray-700">
        <Camera className="w-5 h-5" /> Camera Feed
      </div>
      <div className="bg-black rounded-xl aspect-video flex items-center justify-center">
        <p className="text-white/60">Loading camera feed...</p>
      </div>
    </div>
  );
}

function MonitoringViewInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const resQ = useLiveQuery<Row>("residents", { tables: ["Resident"] });
  const residents = useMemo(() => (resQ.data || []).map(adaptResident), [resQ.data]);

  // Initial selection can come from a ?resident deep-link; the dropdown overrides it.
  const urlName = searchParams.get("resident");
  const urlId = useMemo(() => (urlName ? s(residents.find((r: Row) => s(r.name) === urlName)?.id) : ""), [residents, urlName]);
  const [picked, setPicked] = useState<string | null>(null);
  const currentId = picked ?? urlId;
  const selected = useMemo(() => residents.find((r: Row) => s(r.id) === currentId) || null, [residents, currentId]);

  const residentName = selected ? s(selected.name) : undefined;
  const room = selected ? s(selected.room) : (searchParams.get("room") || undefined);

  return (
    <div className="space-y-6">
      {/* Resident Header Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
              title="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-400/20 text-green-200 text-[10px] font-bold uppercase tracking-wider border border-green-400/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE MONITORING
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-1 truncate">
                {residentName || "Camera Monitoring"}
              </h1>
              <p className="text-blue-100 text-sm">
                {room ? `Room ${room} · ` : ""}Select a resident to watch their camera feed
              </p>
            </div>
          </div>
          {/* Resident selector */}
          <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm ring-1 ring-black/5">
            <User className="w-4 h-4 text-gray-500 shrink-0" />
            <select
              value={currentId}
              onChange={(e) => setPicked(e.target.value)}
              className="bg-white text-gray-900 text-sm font-semibold outline-none min-w-[180px] cursor-pointer"
            >
              <option value="">Select resident…</option>
              {residents.map((r: Row) => (
                <option key={s(r.id)} value={s(r.id)}>{s(r.name)}{s(r.room) ? ` — Rm ${s(r.room)}` : ""}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {selected ? (
        <>
          {/* Camera Feed — dedicated to the selected resident */}
          <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 shadow-lg">
            <div className="absolute inset-0 z-30">
              <CameraVisionFeed
                cameraMode="hybrid"
                residentId={selected ? s(selected.id) : undefined}
                residentName={residentName}
                residentRoom={room}
              />
            </div>
          </div>

          {/* Camera Mode Info */}
          <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
            <Camera className="w-4 h-4 text-blue-500" />
            Switch between <span className="font-semibold text-gray-700">Local</span> (browser webcam) and{" "}
            <span className="font-semibold text-gray-700">Tapo IP</span> (network camera) using the buttons on the camera feed.
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-16 flex flex-col items-center justify-center text-center">
          <Camera className="w-10 h-10 text-gray-300 mb-3" />
          <p className="font-bold text-gray-600">Select a resident to view their camera</p>
          <p className="text-sm text-gray-400 mt-1">Choose a resident from the dropdown above to start monitoring their live feed</p>
        </div>
      )}
    </div>
  );
}

export default function MonitoringView() {
  return (
    <Suspense fallback={<MonitoringViewFallback />}>
      <MonitoringViewInner />
    </Suspense>
  );
}
