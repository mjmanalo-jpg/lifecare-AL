"use client";

/**
 * Time In (Clock In / Out) — verified attendance for nurses & caregivers.
 *
 * Before a clock event is recorded the system BLOCKS unless BOTH pass:
 *   1. Facial verification — a live selfie matches the staff member's enrolled
 *      face photo (Staff Profiles), proving they themselves activated it.
 *   2. Geofence — the device is inside the Super-Admin-configured facility radius.
 * Migration-free: events in app-setting `staff_clock_events`.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, ScanFace, LogIn, LogOut, CheckCircle2, XCircle, Loader2, Clock, ShieldAlert } from "lucide-react";
import Swal from "@/lib/swal";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { upsertRecord } from "@/lib/api";
import { useClinician, type ClinicianRole } from "./useClinician";
import { ClinicalPage, ClinicalHeader, ClinicalButton, ClinicalModal, StatCard, SERIF } from "./clinical-ui";
import CameraCapture from "@/components/portal/CameraCapture";
import { verifyDataUrls, warmUpFaceModels, prepareEnrolled, type FaceVerifyResult } from "@/lib/faceVerify";
import { STAFF_PROFILES_KEY, parseStaffProfiles, hasFaceEnrollment } from "@/lib/staffProfiles";
import { GEOFENCE_KEY, parseGeofence, checkAgainstLocations, getCurrentPosition, geofenceRequired } from "@/lib/geofence";
import { STAFF_CLOCK_KEY, parseClockEvents, isOnDuty, lastEventFor, eventsOnDay, localDay, type ClockEvent, type ClockType } from "@/lib/staffClock";

const s = (v: unknown) => (v == null ? "" : String(v));
const newId = () => globalThis.crypto?.randomUUID?.() ?? `clk-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const fmtTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); };
const sinceLabel = (iso: string) => { const ms = Date.now() - new Date(iso).getTime(); if (!isFinite(ms) || ms < 0) return ""; const h = Math.floor(ms / 3.6e6); const m = Math.floor((ms % 3.6e6) / 6e4); return h ? `${h}h ${m}m` : `${m}m`; };

export default function ClockInBoard({ clinicianRole = "NURSE" }: { clinicianRole?: ClinicianRole }) {
  const { userId, name, role } = useClinician(clinicianRole);
  const { data: settingRows, refetch, loading } = useLiveQuery<{ key?: string; id?: string; value?: string }>("app-settings", { tables: ["AppSetting"] });

  const profile = useMemo(() => parseStaffProfiles(settingRows.find((r) => s(r.key || r.id) === STAFF_PROFILES_KEY)?.value)[userId], [settingRows, userId]);
  const geofence = useMemo(() => parseGeofence(settingRows.find((r) => s(r.key || r.id) === GEOFENCE_KEY)?.value), [settingRows]);
  const events = useMemo(() => parseClockEvents(settingRows.find((r) => s(r.key || r.id) === STAFF_CLOCK_KEY)?.value), [settingRows]);

  const onDuty = isOnDuty(events, userId);
  const last = lastEventFor(events, userId);
  const today = eventsOnDay(events, userId, localDay(new Date().toISOString()));
  const enrolled = hasFaceEnrollment(profile);
  const geoRequired = geofenceRequired(geofence, userId);

  const [verifying, setVerifying] = useState<ClockType | null>(null);

  const record = async (type: ClockType, face: FaceVerifyResult, geoOk: boolean, geoDistanceM: number, lat?: number, lng?: number) => {
    const ev: ClockEvent = {
      id: newId(), userId, name, role, type, at: new Date().toISOString(),
      faceOk: face.ok, faceDistance: Number.isFinite(face.distance) ? Math.round(face.distance * 1000) / 1000 : undefined,
      geoOk, geoDistanceM: Number.isFinite(geoDistanceM) ? Math.round(geoDistanceM) : undefined, lat, lng,
    };
    await upsertRecord("app-settings", STAFF_CLOCK_KEY, { key: STAFF_CLOCK_KEY, value: JSON.stringify([ev, ...events]) });
    await refetch();
    setVerifying(null);
    Swal.fire({ toast: true, position: "top-end", icon: "success", title: `Clocked ${type === "IN" ? "in" : "out"} · ${fmtTime(ev.at)}`, showConfirmButton: false, timer: 2000 });
  };

  return (
    <ClinicalPage>
      <ClinicalHeader title="Time In · Clock In / Out" subtitle="Verified attendance — a live face match plus your location confirm it's you, on-site, activating the system." />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard value={onDuty ? "On duty" : "Off duty"} label={onDuty && last ? `since ${fmtTime(last.at)}` : "not clocked in"} accent={onDuty ? "ink" : "ink"} />
        <StatCard value={today.filter((e) => e.type === "IN").length} label="Clock-ins today" accent="ink" />
        <StatCard value={geoRequired ? "Required" : "Off"} label="Geofence" accent="ink" />
        <StatCard value={enrolled ? "Ready" : "No photo"} label="Face enrollment" accent={enrolled ? "ink" : "amber"} />
      </div>

      {/* Primary action */}
      <div className="mt-6 rounded-2xl border p-6 text-center" style={{ backgroundColor: "var(--clinical-surface)", borderColor: onDuty ? "var(--clinical-green)" : "var(--clinical-line)" }}>
        <p className="text-sm text-[var(--clinical-muted)]">{name}</p>
        <p className="mt-1 text-2xl font-bold text-[var(--clinical-ink)]" style={{ fontFamily: SERIF }}>{onDuty ? "You're on duty" : "You're off duty"}</p>
        {onDuty && last && <p className="mt-1 text-sm text-[var(--clinical-muted)]">Clocked in at {fmtTime(last.at)} · {sinceLabel(last.at)} elapsed</p>}

        {!enrolled ? (
          <div className="mx-auto mt-4 max-w-md rounded-xl border p-3 text-sm" style={{ borderColor: "var(--clinical-amber)", backgroundColor: "color-mix(in srgb, var(--clinical-amber) 12%, var(--clinical-surface))", color: "var(--clinical-amber)" }}>
            <span className="flex items-center justify-center gap-1.5 font-bold"><ShieldAlert className="h-4 w-4" /> No face photo on file</span>
            <span className="mt-1 block text-xs" style={{ color: "color-mix(in srgb, var(--clinical-amber) 80%, var(--clinical-ink))" }}>Ask your Care Manager to add your profile photo in Staff Profiles &amp; Records before you can clock in.</span>
          </div>
        ) : (
          <div className="mt-5">
            {onDuty
              ? <ClinicalButton variant="accent" onClick={() => setVerifying("OUT")}><LogOut className="h-4 w-4" /> Clock Out</ClinicalButton>
              : <ClinicalButton variant="accent" onClick={() => setVerifying("IN")}><LogIn className="h-4 w-4" /> Clock In</ClinicalButton>}
            <p className="mt-3 flex items-center justify-center gap-3 text-[11px] text-[var(--clinical-muted)]">
              <span className="inline-flex items-center gap-1"><ScanFace className="h-3.5 w-3.5" /> Face match</span>
              <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {geoRequired ? "On-site required" : "Location not required"}</span>
            </p>
          </div>
        )}
      </div>

      {/* Today's history */}
      <div className="mt-6">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-[var(--clinical-muted)]">Today</p>
        {loading && events.length === 0 ? (
          <div className="rounded-xl border p-4 text-sm text-[var(--clinical-muted)]" style={{ borderColor: "var(--clinical-line)" }}>Loading…</div>
        ) : today.length === 0 ? (
          <div className="rounded-xl border p-6 text-center text-sm text-[var(--clinical-muted)]" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>No clock events yet today.</div>
        ) : (
          <div className="space-y-2">
            {today.map((e) => (
              <div key={e.id} className="flex items-center gap-3 rounded-xl border p-3" style={{ backgroundColor: "var(--clinical-surface)", borderColor: "var(--clinical-line)" }}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${e.type === "IN" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>{e.type === "IN" ? <LogIn className="h-4 w-4" /> : <LogOut className="h-4 w-4" />}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--clinical-ink)]">Clock {e.type === "IN" ? "in" : "out"} · {fmtTime(e.at)}</p>
                  <p className="text-[11px] text-[var(--clinical-muted)]">
                    <span className="inline-flex items-center gap-1"><ScanFace className="h-3 w-3" /> face {e.faceOk ? "ok" : "—"}</span>
                    {e.geoDistanceM != null && <span className="ml-2 inline-flex items-center gap-1"><MapPin className="h-3 w-3" /> {e.geoDistanceM}m</span>}
                  </p>
                </div>
                <Clock className="h-4 w-4 text-[var(--clinical-muted)]" />
              </div>
            ))}
          </div>
        )}
      </div>

      {verifying && profile?.photo && (
        <VerifyModal type={verifying} enrolledPhoto={profile.photo} geofence={geofence} geoRequired={geoRequired} userId={userId} onClose={() => setVerifying(null)} onVerified={record} />
      )}
    </ClinicalPage>
  );
}

type GeoState = { status: "checking" | "ok" | "fail" | "skip"; distanceM: number; lat?: number; lng?: number; label?: string; message?: string };

function VerifyModal({ type, enrolledPhoto, geofence, geoRequired, userId, onClose, onVerified }: {
  type: ClockType;
  enrolledPhoto: string;
  geofence: ReturnType<typeof parseGeofence>;
  geoRequired: boolean;
  userId: string;
  onClose: () => void;
  onVerified: (type: ClockType, face: FaceVerifyResult, geoOk: boolean, geoDistanceM: number, lat?: number, lng?: number) => Promise<void>;
}) {
  const [geo, setGeo] = useState<GeoState>({ status: geoRequired ? "checking" : "skip", distanceM: Infinity });
  const [busy, setBusy] = useState(false);
  const [faceErr, setFaceErr] = useState("");
  // Remount key — a failed match resets the camera so liveness (blink) re-runs
  // for the next attempt, keeping the live check tied to each captured frame.
  const [attempt, setAttempt] = useState(0);

  // Kick off model warm-up + location check as soon as the modal opens.
  const runGeo = async () => {
    if (!geoRequired) { setGeo({ status: "skip", distanceM: 0 }); return; }
    setGeo({ status: "checking", distanceM: Infinity });
    try {
      const pos = await getCurrentPosition();
      const { ok, distanceM, location } = checkAgainstLocations(geofence, userId, pos.coords.latitude, pos.coords.longitude);
      const label = location?.label || "your assigned location";
      setGeo({ status: ok ? "ok" : "fail", distanceM, lat: pos.coords.latitude, lng: pos.coords.longitude, label, message: ok ? undefined : `You're ${Math.round(distanceM)}m from ${label} — must be within ${location?.radiusMeters ?? 0}m to clock in.` });
    } catch (e) {
      setGeo({ status: "fail", distanceM: Infinity, message: e instanceof Error ? e.message : "Location unavailable — enable location and retry." });
    }
  };

  // Start warm-up + geo once on mount via a ref-guarded effect (async, lint-safe).
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void warmUpFaceModels();
    void prepareEnrolled(enrolledPhoto);
    void runGeo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const geoPass = geo.status === "ok" || geo.status === "skip";

  const onCapture = async (dataUrl: string) => {
    if (!geoPass) return;
    setBusy(true); setFaceErr("");
    try {
      const face = await verifyDataUrls(enrolledPhoto, dataUrl);
      if (!face.ok) { setFaceErr(face.error || `Face didn't match (distance ${face.distance.toFixed(2)}). Center your face in good light and try again.`); setAttempt((a) => a + 1); return; }
      await onVerified(type, face, geo.status !== "fail", geo.distanceM, geo.lat, geo.lng);
    } finally { setBusy(false); }
  };

  return (
    <ClinicalModal open onClose={onClose} title={`Verify to clock ${type === "IN" ? "in" : "out"}`} description="Confirm it's you, on-site." size="sm"
      footer={<ClinicalButton variant="ghost" onClick={onClose}>Cancel</ClinicalButton>}>
      <div className="space-y-4">
        {/* Location step */}
        <div className="rounded-xl border p-3" style={{ borderColor: geo.status === "fail" ? "var(--clinical-coral)" : "var(--clinical-line)", backgroundColor: "var(--clinical-surface-2)" }}>
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--clinical-ink)]">
            <MapPin className="h-4 w-4 text-[var(--clinical-panel)]" /> Location
            {geo.status === "checking" && <Loader2 className="ml-auto h-4 w-4 animate-spin text-[var(--clinical-muted)]" />}
            {geo.status === "ok" && <CheckCircle2 className="ml-auto h-4 w-4 text-[var(--clinical-green)]" />}
            {geo.status === "skip" && <span className="ml-auto text-[11px] text-[var(--clinical-muted)]">not required</span>}
            {geo.status === "fail" && <XCircle className="ml-auto h-4 w-4 text-[var(--clinical-coral)]" />}
          </div>
          {geo.status === "ok" && <p className="mt-1 text-xs text-[var(--clinical-muted)]">Inside {geo.label || "the facility"} ({Math.round(geo.distanceM)}m).</p>}
          {geo.status === "fail" && <p className="mt-1 text-xs text-[var(--clinical-coral)]">{geo.message}</p>}
          {geo.status === "fail" && <button type="button" onClick={runGeo} className="mt-1 text-xs font-semibold text-[var(--clinical-panel)] hover:underline">Retry location</button>}
        </div>

        {/* Face step */}
        {geoPass ? (
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--clinical-ink)]"><ScanFace className="h-4 w-4 text-[var(--clinical-panel)]" /> Face verification</p>
            <CameraCapture key={attempt} requireLiveness onCapture={onCapture} busy={busy} captureLabel={busy ? "Verifying…" : `Capture & clock ${type === "IN" ? "in" : "out"}`} />
            {faceErr && <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--clinical-coral)]"><XCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> {faceErr}</p>}
          </div>
        ) : (
          <p className="text-center text-xs text-[var(--clinical-muted)]">Resolve your location above to continue.</p>
        )}
      </div>
    </ClinicalModal>
  );
}
