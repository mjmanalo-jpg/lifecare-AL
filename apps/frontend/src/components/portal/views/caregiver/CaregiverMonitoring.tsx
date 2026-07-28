"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Camera, Activity, X } from "lucide-react";
import CameraVisionFeed from "@/components/CameraVisionFeed";
import FacilityVitals from "@/components/portal/views/FacilityVitals";
import { createRecord } from "@/lib/api";
import { useLiveQuery } from "@/lib/useLiveQuery";

export default function CaregiverMonitoring() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const resident = searchParams.get("resident");
  const room = searchParams.get("room");
  const residentId = searchParams.get("residentId");
  const [showVitals, setShowVitals] = useState(false);
  const [isFallen, setIsFallen] = useState(false);

  // On-duty clinical staff — recipients for fall / pre-fall push alerts (bell icon).
  const { data: staffRows } = useLiveQuery<{ id: string; userId?: string; isActive?: boolean; user?: { role?: string } }>(
    "staff", { query: "include=user&take=300", tables: ["Staff"] }
  );
  const clinicalUserIds = useMemo(
    () => staffRows
      .filter((s) => s.isActive !== false && (s.user?.role === "NURSE" || s.user?.role === "CAREGIVER") && !!s.userId)
      .map((s) => s.userId as string),
    [staffRows]
  );
  const notifyClinicalStaff = async (type: "INCIDENT_REPORT" | "VITAL_ALERT", title: string, message: string) => {
    await Promise.allSettled(
      clinicalUserIds.map((userId) => createRecord("notifications", { userId, type, title, message }))
    );
  };

  // Persist camera-detected events as real incidents so they surface in Active Incidents,
  // notify on-duty staff, and (for a confirmed fall) raise a call bell into the response queue.
  // Previously the caregiver feed only logged to the camera activity log and created NO
  // incident/notification (unlike the nurse portal), so falls/pre-falls never reached staff.
  const fallCooldownRef = useRef(0);
  const preFallCooldownRef = useRef(0);
  const recordIncident = async (
    kind: "FALL" | "PRE_FALL",
    analysis: { globalEmotion?: string; globalBehavior?: string; globalPosture?: string; summary?: string },
    reason?: string,
  ) => {
    // Debounce so a sustained fall / repeated pre-fall signal doesn't spam duplicates.
    const now = Date.now();
    const ref = kind === "FALL" ? fallCooldownRef : preFallCooldownRef;
    if (now - ref.current < 60_000) return;
    ref.current = now;
    const vision = `Emotion: ${analysis.globalEmotion || "Unknown"}; Behavior: ${analysis.globalBehavior || "Unknown"}; Posture: ${analysis.globalPosture || "Unknown"}.`;
    const who = `${resident || "A resident"}${room ? ` (Room ${room})` : ""}`;
    try {
      await createRecord("incidents", {
        incidentType: kind === "FALL" ? "FALL" : "BEHAVIORAL",
        severity: kind === "FALL" ? "CRITICAL" : "MODERATE",
        description: kind === "FALL"
          ? `AUTOMATED CAMERA FALL DETECTION\n\n${analysis.summary || "Fall detected from monitoring camera."}`
          : `PRE-FALL RISK (PREVENTIVE ALERT)\n\n${reason || "Pre-fall risk indicators detected."}`,
        notes: kind === "FALL"
          ? `AI Vision Analysis — ${vision}`
          : `AI Vision early warning — ${vision} Check the resident before a fall occurs.`,
        incidentDate: new Date().toISOString(),
        // Link to the monitored resident so the incident shows their name/room and ties to their record.
        ...(residentId ? { residentId } : {}),
      });
      // Notify on-duty nurses/caregivers via their notification bell.
      await notifyClinicalStaff(
        kind === "FALL" ? "INCIDENT_REPORT" : "VITAL_ALERT",
        kind === "FALL" ? "🚨 Fall detected" : "⚠️ Pre-fall risk",
        kind === "FALL"
          ? `Camera detected a fall for ${who}. Respond immediately.`
          : `${who} may be at risk of a fall — ${reason || "pre-fall indicators detected."}`,
      );
      // Confirmed fall → raise a call bell so it enters the active response queue
      // (needs a resident to attach to; call bells require a residentId).
      if (kind === "FALL" && residentId) {
        await createRecord("call-bells", {
          residentId,
          status: "PENDING",
          reason: `🚨 AI FALL DETECTION${room ? ` — Room ${room}` : ""}`,
          notes: `Auto-raised by AI camera monitoring — respond immediately. ${vision}`,
        });
      }
    } catch { /* non-critical — the on-camera banner + activity log still fired */ }
  };

  return (
    <div className="space-y-6">
      {/* Resident Header Card */}
      <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-xl p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/caregiver/residents")}
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
                <p className="text-emerald-100 text-sm">
                  Room {room} &middot; Camera feed with AI-powered analysis
                </p>
              )}
            </div>
          </div>
          <Camera className="w-12 h-12 text-emerald-200/50 hidden sm:block" />
        </div>
      </div>

      {/* Camera Feed */}
      <div className="relative aspect-video rounded-xl overflow-hidden border border-gray-200 shadow-lg">
        <div className="absolute inset-0 z-30">
          <CameraVisionFeed
            cameraMode="hybrid"
            residentName={resident || undefined}
            residentRoom={room || undefined}
            residentId={residentId || undefined}
            isFallen={isFallen}
            onFallTriggered={(analysis) => { setIsFallen(true); void recordIncident("FALL", analysis); }}
            onPreFallRisk={(analysis, reason) => { void recordIncident("PRE_FALL", analysis, reason); }}
            onFallCleared={() => setIsFallen(false)}
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
        <Camera className="w-4 h-4 text-emerald-500" />
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
