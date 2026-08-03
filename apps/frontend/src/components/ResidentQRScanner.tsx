"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode, X, Upload, CameraOff } from "lucide-react";
import jsQR from "jsqr";

/**
 * "Scan QR" button + camera modal for the resident records. Staff point the
 * rear camera at a resident's QR care card; on decode we open /rcard/<id>.
 * Falls back to scanning a photo if the camera is unavailable.
 */
export default function ResidentQRScanner({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const go = useCallback((text: string) => {
    if (doneRef.current) return;
    const m = text.match(/\/rcard\/([^/?#\s]+)/);
    const id = (m ? m[1] : text.trim()).replace(/[^\w-]/g, "");
    if (!id) { setError("That doesn't look like a resident QR."); return; }
    doneRef.current = true;
    setOpen(false);
    router.push(`/rcard/${id}`);
  }, [router]);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) { stop(); return; }
    doneRef.current = false;
    setError("");
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          if (doneRef.current || !ctx || !videoRef.current) return;
          const v = videoRef.current;
          if (v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth) {
            canvas.width = v.videoWidth; canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data) { go(code.data); return; }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setError("Camera unavailable — allow camera access, or scan a photo below.");
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [open, stop, go]);

  // Fallback: decode a QR from an uploaded/taken photo.
  const onPhoto = async (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height);
      URL.revokeObjectURL(url);
      if (code?.data) go(code.data); else setError("No QR code found in that photo.");
    };
    img.onerror = () => { URL.revokeObjectURL(url); setError("Could not read that image."); };
    img.src = url;
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-[#2E4A48] text-white hover:bg-[#25403D] transition text-sm font-semibold ${className}`}>
        <QrCode className="w-4 h-4" /> Scan QR
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><QrCode className="w-5 h-5" /> Scan Resident QR</h3>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="relative aspect-square w-full bg-black rounded-xl overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                <div className="pointer-events-none absolute inset-8 border-2 border-white/70 rounded-xl" />
                {error && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80 text-sm text-center p-4 bg-black/50">
                    <CameraOff className="w-8 h-8" /> {error}
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />
              <p className="text-xs text-gray-500 text-center">Point the camera at the resident&apos;s QR card.</p>
              <label className="flex items-center justify-center gap-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 cursor-pointer">
                <Upload className="w-4 h-4" /> Scan from a photo
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={e => void onPhoto(e.target.files?.[0])} />
              </label>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
