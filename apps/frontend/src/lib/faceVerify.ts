"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Facial verification (1:1) via @vladmandic/face-api, fully client-side against
 * the models in /public/models/face-api. Used at clock-in to confirm the person
 * activating the system is the enrolled staff member.
 *
 * Tuned for speed (was 30-45s → ~1-3s):
 *   • WebGL (GPU) backend forced — the CPU backend is 10-30× slower.
 *   • tinyFaceDetector (≈190KB) instead of ssdMobilenetv1 (≈5MB) for detection.
 *   • One warm inference at load so the first real capture doesn't pay shader
 *     compilation.
 *   • Enrolled-photo descriptor cached, so repeated attempts only encode the
 *     live selfie.
 * Everything stays on the device.
 */

const MODEL_URL = "/models/face-api";
let faceApiPromise: Promise<any> | null = null;
const enrolledCache = new Map<string, Float32Array | null>();

function detectorOptions(faceapi: any) {
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.4 });
}

async function getFaceApi(): Promise<any> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi: any = await import("@vladmandic/face-api");
      // GPU backend — the single biggest speedup vs. the CPU fallback.
      try { await faceapi.tf?.setBackend?.("webgl"); } catch { /* keep default */ }
      try { await faceapi.tf?.ready?.(); } catch { /* ignore */ }
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      // Warm the pipeline (compile WebGL shaders) on a throwaway canvas so the
      // first real capture is fast.
      try {
        const c = document.createElement("canvas");
        c.width = 160; c.height = 160;
        await faceapi.detectSingleFace(c, detectorOptions(faceapi)).withFaceLandmarks().withFaceDescriptor();
      } catch { /* warm-up best-effort */ }
      return faceapi;
    })();
  }
  return faceApiPromise;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = dataUrl;
  });
}

async function describe(faceapi: any, input: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement): Promise<Float32Array | null> {
  const det = await faceapi
    .detectSingleFace(input, detectorOptions(faceapi))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return det?.descriptor ?? null;
}

/** Preload models + compile shaders (call on mount so the first verify is fast). */
export async function warmUpFaceModels(): Promise<void> {
  try { await getFaceApi(); } catch { /* non-fatal */ }
}

/** Pre-compute + cache the enrolled photo's descriptor ahead of capture. */
export async function prepareEnrolled(dataUrl: string): Promise<void> {
  if (!dataUrl || enrolledCache.has(dataUrl)) return;
  try {
    const faceapi = await getFaceApi();
    enrolledCache.set(dataUrl, await describe(faceapi, await loadImage(dataUrl)));
  } catch { /* computed lazily on verify if this fails */ }
}

export async function descriptorFromDataUrl(dataUrl: string): Promise<Float32Array | null> {
  const faceapi = await getFaceApi();
  return describe(faceapi, await loadImage(dataUrl));
}

/**
 * Match threshold (euclidean distance between 128-d descriptors). This is a
 * SECURITY gate for clock-in, so it's tuned to reject a different person rather
 * than to avoid the occasional legitimate re-take: same person is typically
 * ≤0.45, different people cluster ~0.5–0.7. 0.45 keeps strangers out; the
 * enrolled staff member just re-captures in good light if a frame lands high.
 */
export const FACE_MATCH_THRESHOLD = 0.45;

export interface FaceVerifyResult { ok: boolean; distance: number; error?: string }

/** Verify a live capture (dataURL) against an enrolled photo (dataURL). */
export async function verifyDataUrls(
  enrolledDataUrl: string,
  liveDataUrl: string,
  threshold = FACE_MATCH_THRESHOLD,
): Promise<FaceVerifyResult> {
  try {
    const faceapi = await getFaceApi();
    let enrolled = enrolledCache.get(enrolledDataUrl);
    if (enrolled === undefined) {
      enrolled = await describe(faceapi, await loadImage(enrolledDataUrl));
      enrolledCache.set(enrolledDataUrl, enrolled);
    }
    if (!enrolled) return { ok: false, distance: Infinity, error: "No face found in the enrolled photo — re-take the profile photo." };
    const live = await describe(faceapi, await loadImage(liveDataUrl));
    if (!live) return { ok: false, distance: Infinity, error: "No face detected — center your face in the frame and try again." };
    const distance = faceapi.euclideanDistance(enrolled, live);
    return { ok: distance <= threshold, distance };
  } catch (err) {
    return { ok: false, distance: Infinity, error: err instanceof Error ? err.message : "Face verification failed." };
  }
}

/** True when a photo dataURL contains a detectable face (used at enrollment). */
export async function hasDetectableFace(dataUrl: string): Promise<boolean> {
  try { return (await descriptorFromDataUrl(dataUrl)) != null; } catch { return false; }
}
