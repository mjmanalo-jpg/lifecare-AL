"use client";

/**
 * Reusable webcam capture. Opens the front camera, previews live, and hands a
 * downscaled JPEG dataURL to `onCapture`. Used for staff face enrollment and for
 * the live selfie at verified clock-in. Cleans up the media stream on unmount.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, VideoOff } from "lucide-react";

export default function CameraCapture({
  onCapture, width = 480, captureLabel = "Capture photo", busy = false, mirrored = true,
}: {
  onCapture: (dataUrl: string) => void;
  width?: number;
  captureLabel?: string;
  busy?: boolean;
  mirrored?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 } }, audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
          setReady(true);
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Camera unavailable. Allow camera access and retry.");
      }
    })();
    return () => { cancelled = true; if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const vw = v.videoWidth, vh = v.videoHeight;
    const w = Math.min(width, vw);
    const h = Math.round((vh / vw) * w);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, w, h);
    onCapture(canvas.toDataURL("image/jpeg", 0.82));
  };

  if (err) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <VideoOff className="h-7 w-7 text-slate-400" />
        <p className="text-sm font-semibold text-slate-600">Camera unavailable</p>
        <p className="text-xs text-slate-500">{err}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-xl bg-slate-900" style={{ aspectRatio: "4 / 3" }}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" style={mirrored ? { transform: "scaleX(-1)" } : undefined} />
        {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Starting camera…</div>}
        <div className="pointer-events-none absolute inset-0 m-auto h-40 w-32 rounded-[50%] border-2 border-white/40" />
      </div>
      <button type="button" onClick={capture} disabled={!ready || busy}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--clinical-panel,#2E4A48)] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
        <Camera className="h-4 w-4" /> {busy ? "Working…" : captureLabel}
      </button>
    </div>
  );
}
