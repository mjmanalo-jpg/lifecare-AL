"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ScanLine, X, CameraOff, Keyboard, Camera } from "lucide-react";

type ScanItem = { id: string; itemName: string; raw: { batchNumber?: string | number | null } };

/** Normalise a code for comparison — trim, drop non-alphanumerics. */
function norm(v: string | number | null | undefined): string {
  return String(v ?? "").trim().replace(/[^0-9A-Za-z]/g, "");
}

/**
 * "Scan" button + modal for inventory. Two input paths:
 *  1. Handheld USB/Bluetooth scanner — acts as a keyboard; the focused field
 *     captures the typed code + Enter. Works on every browser, no camera.
 *  2. Phone/webcam camera — uses the native BarcodeDetector API where available
 *     (Chrome/Edge/Android). Gracefully hidden when unsupported.
 * On a match we hand the found item back to the parent (which opens its detail
 * card for quick +/- stock adjustment).
 */
export default function InventoryBarcodeScanner<T extends ScanItem>({
  items,
  onFound,
  className = "",
}: {
  items: T[];
  onFound: (item: T) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [useCamera, setUseCamera] = useState(false);
  const [note, setNote] = useState("");
  const [manual, setManual] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastHitRef = useRef<{ code: string; t: number }>({ code: "", t: 0 });

  const cameraSupported =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  const resolve = useCallback((code: string): boolean => {
    const n = norm(code);
    if (!n) return false;
    const hit =
      items.find((i) => norm(i.raw.batchNumber) === n) ??
      items.find((i) => {
        const b = norm(i.raw.batchNumber);
        return b.length >= 6 && (b.endsWith(n) || n.endsWith(b));
      });
    if (hit) {
      onFound(hit);
      setOpen(false);
      return true;
    }
    setNote(`No item found for “${code}”.`);
    return false;
  }, [items, onFound]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Camera scan loop (BarcodeDetector).
  useEffect(() => {
    if (!open || !useCamera || !cameraSupported) return;
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector;
    const detector = new Detector({
      formats: ["upc_a", "upc_e", "ean_13", "ean_8", "code_128", "code_39"],
    });
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const raw = codes?.[0]?.rawValue as string | undefined;
            if (raw) {
              const now = performance.now();
              // Debounce identical repeats within 1.2s.
              if (!(raw === lastHitRef.current.code && now - lastHitRef.current.t < 1200)) {
                lastHitRef.current = { code: raw, t: now };
                if (resolve(raw)) return;
              }
            }
          } catch { /* transient decode error — keep scanning */ }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setNote("Camera unavailable — allow access, or use a handheld scanner / manual entry.");
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [open, useCamera, cameraSupported, resolve, stopCamera]);

  // Keep the wedge input focused for handheld scanners.
  useEffect(() => {
    if (open && !useCamera) inputRef.current?.focus();
  }, [open, useCamera]);

  const close = () => { setOpen(false); setUseCamera(false); setNote(""); setManual(""); stopCamera(); };

  return (
    <>
      <button
        onClick={() => { setOpen(true); setNote(""); }}
        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#2E4A48] text-white hover:bg-[#25403D] transition text-sm font-semibold ${className}`}
      >
        <ScanLine className="w-4 h-4" /> Scan
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="bg-[#2E4A48] text-white px-5 py-4 flex items-center justify-between">
              <h3 className="font-bold text-lg flex items-center gap-2"><ScanLine className="w-5 h-5" /> Scan Barcode</h3>
              <button onClick={close} className="p-1 hover:bg-white/15 rounded"><X className="w-5 h-5" /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Mode toggle */}
              <div className="flex rounded-lg border border-[#D6D8CD] overflow-hidden text-sm font-semibold">
                <button
                  onClick={() => { setUseCamera(false); stopCamera(); setNote(""); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition ${!useCamera ? "bg-[#2E4A48] text-white" : "bg-white text-[#8A8D82] hover:bg-[#F5F6F1]"}`}
                >
                  <Keyboard className="w-4 h-4" /> Handheld
                </button>
                <button
                  onClick={() => { if (cameraSupported) { setUseCamera(true); setNote(""); } }}
                  disabled={!cameraSupported}
                  title={cameraSupported ? "" : "This browser can't scan with the camera — use a handheld scanner"}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition ${useCamera ? "bg-[#2E4A48] text-white" : "bg-white text-[#8A8D82] hover:bg-[#F5F6F1]"} disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <Camera className="w-4 h-4" /> Camera
                </button>
              </div>

              {useCamera ? (
                <div className="relative aspect-square w-full bg-black rounded-xl overflow-hidden">
                  <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                  <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-red-500/80" />
                  {note && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80 text-sm text-center p-4 bg-black/50">
                      <CameraOff className="w-8 h-8" /> {note}
                    </div>
                  )}
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (resolve(manual)) return; setManual(""); inputRef.current?.focus(); }}>
                  <label className="block text-sm font-semibold text-[#2B2B27] mb-1">Scan or type a barcode</label>
                  <input
                    ref={inputRef}
                    value={manual}
                    onChange={(e) => { setManual(e.target.value); setNote(""); }}
                    autoFocus
                    placeholder="Point the handheld scanner here…"
                    className="w-full px-3 py-2.5 border border-[#D6D8CD] rounded-lg text-sm focus:ring-2 focus:ring-[#2E4A48]/30 focus:border-[#2E4A48] outline-none"
                  />
                  <p className="text-xs text-[#8A8D82] mt-1.5">A USB/Bluetooth scanner types the code and presses Enter automatically.</p>
                </form>
              )}

              {note && !useCamera && (
                <div className="text-sm text-[#C0573F] bg-[#C0573F]/10 border border-[#C0573F]/30 rounded-lg px-3 py-2">{note}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
