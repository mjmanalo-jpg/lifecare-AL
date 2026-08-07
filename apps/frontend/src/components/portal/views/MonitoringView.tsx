"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Camera, Activity, X, ArrowLeft } from "lucide-react";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import FacilityVitals from "@/components/portal/views/FacilityVitals";

/* ── Monitoring View (Dedicated Per-Resident Camera + Vitals) ──────────
   Clinical monitoring surface — lives in the clinical portals (Care Manager /
   nurse), not Facility Operations. Reads ?resident/?room from the deep-link. */

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
  const resident = searchParams.get("resident");
  const room = searchParams.get("room");
  const [showVitals, setShowVitals] = useState(false);

  return (
    <div className="space-y-6">
      {/* Resident Header Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.back()}
              className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition active:scale-95"
              title="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-green-400/20 text-green-200 text-[10px] font-bold uppercase tracking-wider border border-green-400/30">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  LIVE MONITORING
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-1">
                {resident || "Facility Monitoring"}
              </h1>
              {room && (
                <p className="text-blue-100 text-sm">
                  Room {room} &middot; Camera feed with AI-powered analysis
                </p>
              )}
            </div>
          </div>
          <Camera className="w-12 h-12 text-blue-200/50 hidden sm:block" />
        </div>
      </div>

      {/* Camera Feed — dedicated to this resident */}
      <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 shadow-lg">
        <div className="absolute inset-0 z-30">
          <CameraVisionFeed
            cameraMode="hybrid"
            residentName={resident || undefined}
            residentRoom={room || undefined}
          />
        </div>

        {/* Vitals Button Overlay */}
        <div className="absolute bottom-4 right-4 z-40">
          <button
            onClick={() => setShowVitals(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-white/90 backdrop-blur-md text-gray-900 font-semibold rounded-lg shadow-lg hover:bg-white hover:shadow-xl transition-all active:scale-95 border border-gray-200/50"
          >
            <Activity className="w-4 h-4 text-yellow-500" />
            View Vitals
          </button>
        </div>
      </div>

      {/* Camera Mode Info */}
      <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-2 border border-gray-200">
        <Camera className="w-4 h-4 text-blue-500" />
        Switch between <span className="font-semibold text-gray-700">Local</span> (browser webcam) and{" "}
        <span className="font-semibold text-gray-700">Tapo IP</span> (network camera) using the buttons on the camera feed.
      </div>

      {/* Vitals Modal */}
      {showVitals && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className={`bg-white rounded-xl shadow-2xl w-full ${resident ? "max-w-md" : "max-w-3xl"} max-h-[90vh] overflow-y-auto`}>
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-black p-5 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5" />
                <h2 className="text-xl font-bold">
                  Vital Signs{resident ? ` — ${resident}` : ""}
                </h2>
              </div>
              <button onClick={() => setShowVitals(false)} className="p-2 hover:bg-yellow-600/20 rounded-lg transition"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6">
              <FacilityVitals residentFilter={resident || undefined} />
            </div>
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
              <button onClick={() => setShowVitals(false)} className="px-6 py-2 bg-yellow-500 hover:bg-yellow-600 text-white font-semibold rounded-lg transition">Close</button>
            </div>
          </div>
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
