"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Liveness (anti-spoofing) for verified clock-in. A 1:1 face match alone can be
 * fooled by holding up a printed/on-screen photo of the enrolled staff member —
 * so before we capture-and-match, the person must perform a live BLINK.
 *
 * Uses MediaPipe FaceLandmarker `eyeBlink*` blendshapes (the same engine the
 * camera monitor uses; face-api's 68-point EAR was unreliable here). A static
 * photo can't produce an open→closed→open cycle, so it fails liveness.
 * Fully client-side; models load from CDN like the monitor.
 */

let _landmarker: any = null;
let _loading: Promise<any> | null = null;

async function getFaceLandmarker(): Promise<any> {
  if (_landmarker) return _landmarker;
  if (!_loading) {
    _loading = (async () => {
      const mpv: any = await import("@mediapipe/tasks-vision");
      const { FaceLandmarker, FilesetResolver } = mpv;
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm",
      );
      _landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
      });
      return _landmarker;
    })();
  }
  return _loading;
}

/** Preload the liveness model so the first check is fast (best-effort). */
export async function warmUpLiveness(): Promise<void> {
  try { await getFaceLandmarker(); } catch { /* non-fatal */ }
}

export interface LivenessResult { ok: boolean; reason?: string }

// eyeBlink blendshape: ~1 when the eye is CLOSED, ~0 when open.
const CLOSED = 0.5;
const OPEN = 0.25;

/**
 * Watch the live video for a single blink (open → closed → open) within
 * `timeoutMs`. Resolves ok:true on a detected blink; ok:false on timeout / no
 * face / cancellation. `onClosed` fires when the eyes-closed phase is seen.
 */
export async function detectBlink(
  video: HTMLVideoElement,
  opts: { timeoutMs?: number; signal?: AbortSignal; onClosed?: () => void } = {},
): Promise<LivenessResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  let lm: any;
  try { lm = await getFaceLandmarker(); } catch { return { ok: false, reason: "Liveness check unavailable — try again." }; }

  const start = performance.now();
  let stage = 0;          // 0 need open · 1 need closed · 2 need open again → pass
  let faceSeen = false;
  let lastTs = 0;

  return new Promise<LivenessResult>((resolve) => {
    const tick = () => {
      if (opts.signal?.aborted) { resolve({ ok: false, reason: "cancelled" }); return; }
      const now = performance.now();
      if (now - start > timeoutMs) {
        resolve({ ok: false, reason: faceSeen ? "Didn't detect a blink — blink once, keeping your face centered." : "No face detected — center your face and try again." });
        return;
      }
      if (video.readyState >= 2 && video.videoWidth) {
        const ts = Math.max(lastTs + 1, Math.round(now));
        lastTs = ts;
        let res: any = null;
        try { res = lm.detectForVideo(video, ts); } catch { /* transient */ }
        const cats = res?.faceBlendshapes?.[0]?.categories;
        if (cats && cats.length) {
          faceSeen = true;
          const score = (n: string) => cats.find((c: any) => c.categoryName === n)?.score ?? 0;
          const blink = (score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2;
          if (stage === 0 && blink <= OPEN) stage = 1;
          else if (stage === 1 && blink >= CLOSED) { stage = 2; opts.onClosed?.(); }
          else if (stage === 2 && blink <= OPEN) { resolve({ ok: true }); return; }
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
