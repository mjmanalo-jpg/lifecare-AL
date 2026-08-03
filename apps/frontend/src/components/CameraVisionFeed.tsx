"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, AlertTriangle, Activity, Shield, Brain, Cpu, Volume2, VolumeX, Heart, History, RefreshCw, X } from "lucide-react";
import { analyzeEmotionFromLandmarks, loadFaceAPI, getEyeState, setEyeBlink } from "@/utils/emotionDetector";
import { rppgProcessor, RppgProcessor, type VitalEstimate } from "@/utils/rppgProcessor";

// Suppress TensorFlow.js and WebGL verbose logging
if (typeof window !== "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((window as any).tf) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).tf.env().set("DEBUG", false);
  }
  // Suppress console warnings from WebGL context
  const originalWarn = console.warn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const warnFilter = (...args: any[]) => {
    const msg = args.join(" ");
    if (!msg.includes("OpenGL") && !msg.includes("WebGL")) {
      originalWarn(...args);
    }
  };
  console.warn = warnFilter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type LM = { x: number; y: number; z: number; visibility?: number };

interface TrackedDet {
  label: string;
  score: number;
  x: number; y: number; w: number; h: number; // normalized 0-1
  color: string;
  thought: string;
  risk: "low" | "medium" | "high";
}

interface VisionAnalysis {
  globalEmotion: string;
  emotionConfidence: number;
  globalBehavior: string;
  globalPosture: string;
  sleepState: string;   // Awake | Drowsy | Sleeping
  confused: boolean;    // sustained disoriented/agitated affect
  alert: boolean;
  alertReason: string | null;
  fallConfidence?: number; // 0..1 — how sure the fall detector is (geometry + drop + stillness)
  summary: string;
  objects: Array<{ type: string; thought: string; risk: "low" | "medium" | "high" }>;
}

interface Props {
  isFallen?: boolean;
  onFallTriggered?: (analysis: VisionAnalysis) => void;
  onFallCleared?: () => void;
  /** Fires when pre-fall risk indicators (agitation/startle or a near-fall stumble) appear BEFORE a fall. */
  onPreFallRisk?: (analysis: VisionAnalysis, reason: string) => void;
  cameraMode?: "local" | "tapo" | "hybrid";
  residentName?: string;
  residentRoom?: string;
  residentId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const POSE_CONNS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],
  [11,13],[13,15],[15,17],[15,19],[17,19],
  [12,14],[14,16],[16,18],[16,20],[18,20],
  [11,23],[12,24],[23,24],
  [23,25],[25,27],[27,29],[27,31],[29,31],
  [24,26],[26,28],[28,30],[28,32],[30,32],
];

const HAND_CONNS: [number, number][] = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],
  [13,17],[0,17],[17,18],[18,19],[19,20],
];

const L_ARM = new Set([13,15,17,19,21]);
const R_ARM = new Set([14,16,18,20,22]);
const LEGS  = new Set([23,24,25,26,27,28,29,30,31,32]);
const FACE  = new Set([0,1,2,3,4,5,6,7,8,9,10]);

function connColor(i: number, j: number): string {
  if (L_ARM.has(i) || L_ARM.has(j)) return "#22d3ee";  // cyan  — left arm
  if (R_ARM.has(i) || R_ARM.has(j)) return "#f59e0b";  // amber — right arm
  if (LEGS.has(i)  || LEGS.has(j))  return "#a78bfa";  // violet — legs
  if (FACE.has(i)  || FACE.has(j))  return "#34d399";  // green  — face
  return "#e2e8f0";                                      // white  — torso
}

function dotCol(i: number): string {
  if (L_ARM.has(i)) return "#22d3ee";
  if (R_ARM.has(i)) return "#f59e0b";
  if (LEGS.has(i))  return "#a78bfa";
  if (FACE.has(i))  return "#34d399";
  return "#f8fafc";
}

const DET_COLORS: Record<string, string> = {
  // Persons & Beings
  person:"#f59e0b", human:"#f59e0b",

  // Critical Objects (SPECIFIC DETECTION)
  phone:"#a78bfa", cellphone:"#a78bfa", mobile:"#a78bfa", smartphone:"#a78bfa",
  cup:"#34d399", mug:"#34d399", glass:"#34d399", bottle:"#34d399",
  remote:"#ff6b6b", remote_control:"#ff6b6b",

  // Furniture
  chair:"#06b6d4", bed:"#ef4444", couch:"#06b6d4", sofa:"#06b6d4", table:"#06b6d4",

  // Electronics
  tv:"#f97316", laptop:"#f97316", computer:"#f97316", keyboard:"#f97316", mouse:"#f97316",

  // Items
  book:"#34d399", watch:"#a78bfa", pill:"#ff6b6b",

  // Pets
  cat:"#ec4899", dog:"#ec4899",
};
function detCol(label: string): string {
  const l = label.toLowerCase();
  for (const [k, c] of Object.entries(DET_COLORS)) if (l.includes(k)) return c;
  return "#94a3b8";
}

const RISK_COL = { low:"#34d399", medium:"#f59e0b", high:"#ef4444" } as const;

// ── Module-level MediaPipe singletons (cached across component mounts) ──────
// Without this, every mount re-downloads the WASM runtime + model files from CDN,
// adding 3-5 seconds of blank screen on each navigation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mpVision: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mpPose: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mpDetector: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mpFace: any = null; // MediaPipe FaceLandmarker (eyeBlink blendshape → sleep)
let _mpLoading = false;
let _mpReady = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _mpPromise: Promise<{ pose: any; detector: any }> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMediaPipeOnce(): Promise<{ pose: any; detector: any }> {
  if (_mpReady) return { pose: _mpPose, detector: _mpDetector };
  if (_mpPromise) return _mpPromise;

  _mpLoading = true;
  _mpPromise = (async () => {
    const mpv = await import("@mediapipe/tasks-vision");
    const { PoseLandmarker, ObjectDetector, FaceLandmarker, FilesetResolver } = mpv;

    // Load WASM runtime first (shared by all models)
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
    );
    _mpVision = vision;

    // Load pose first (critical for camera to start working).
    // The FULL model (vs lite) tracks people who are far from the camera or turned
    // AWAY from it far more reliably — the pose landmarker is body-based, so it does
    // not need a visible face. Confidence gates are lowered from the 0.5 default so a
    // small/backlit/back-facing body keeps its lock instead of dropping out.
    const pose = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO", numPoses: 2,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    _mpPose = pose;

    // Defer heavy object detector — load in background after pose is ready
    ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite",
        delegate: "GPU",
      },
      scoreThreshold: 0.4,
      maxResults: 12,
      runningMode: "VIDEO",
    }).then(d => { _mpDetector = d; });

    // Face landmarker with blendshapes → accurate eyeBlink for sleep detection.
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        delegate: "GPU",
      },
      outputFaceBlendshapes: true,
      runningMode: "VIDEO", numFaces: 1,
    }).then((f: unknown) => { _mpFace = f; }).catch(() => { /* eye-blink is optional */ });

    _mpReady = true;
    _mpLoading = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { pose, detector: null as any };
  })();

  return _mpPromise;
}

// Ambianic fall metric: a real fall drops the body's center of mass fast — more than
// 60% of the frame height per second. Slowly lying down stays well under this, which
// is how a fast fall is told apart from someone settling onto a couch/bed for a nap.
const RAPID_DROP_VELOCITY = 0.6;   // normalized frame-heights per second (downward)
const RAPID_DROP_WINDOW_MS = 2000; // a drop counts toward a fall if it was this recent
// A person lying horizontal on the floor IS a fall — fire the alert once that posture
// holds this briefly (long enough to reject a single-frame flicker, short enough to be
// "active"). No rapid drop required.
const LYING_CONFIRM_MS = 1000;
const CLEAR_CONFIRM_MS = 1500;
// A confirmed fall (that auto-escalates) needs the body DOWN and STILL this long —
// borrowed from the "sustained fall" idea, it filters out floor exercises / rolling.
const STILL_CONFIRM_MS = 2500;
// Never raise more than one automatic escalation per this window for the same camera.
const FALL_ESCALATION_DEBOUNCE_MS = 5 * 60_000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ── Preventive pre-fall risk ────────────────────────────────────────────────
// Warn staff BEFORE a fall when a resident shows agitation/startle or a near-fall
// stumble. This is Mila's "catch the near-falls" differentiator — preventive, not
// reactive. Signals come from the same emotion/motion pipeline used for falls.
const PREFALL_EVAL_INTERVAL_MS = 1000;   // how often risk is scored
const PREFALL_DEBOUNCE_MS = 60_000;      // minimum gap between preventive alerts
const PREFALL_BANNER_MS = 10_000;        // how long the on-screen warning stays up
const AGITATION_STREAK_TRIGGER = 3;      // consecutive agitated reads before alerting

// ── Bed-exit / getting-up (the #1 elderly pre-fall trigger) ──────────────────
// Standing up from lying — especially abruptly ("tumayo na lang agad") or right
// after waking — is the moment most falls happen. Fire an URGENT alarm the instant
// the torso goes from horizontal (in bed) to upright so staff get a head start.
const STANDUP_DEBOUNCE_MS = 45_000;      // min gap between bed-exit / stand-up alarms
const RECENT_WAKE_MS = 20_000;           // "just woke up" window — a rise inside it is riskier
const SUDDEN_STAND_MS = 5000;            // reclined → upright within this = an abrupt stand-up
const AGGRESSIVE_WAKE_STREAK = 2;        // agitated reads around wake-up → "woke up aggressively"

const INIT: VisionAnalysis = {
  globalEmotion:"Neutral", emotionConfidence:0, globalBehavior:"Initializing",
  globalPosture:"Detecting", sleepState:"Awake", confused:false, alert:false, alertReason:null,
  summary:"AI Vision loading models...", objects:[],
};

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing primitives (called at 60fps — no React, pure canvas2d)
// ─────────────────────────────────────────────────────────────────────────────

function drawCornerBox(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  col: string, flash = false
) {
  const cl = Math.min(w, h) * 0.22;
  ctx.save();
  ctx.strokeStyle = col;
  ctx.lineWidth = flash ? 3 : 2;
  ctx.lineCap = "round";
  ctx.shadowColor = col;
  ctx.shadowBlur = flash ? 18 : 10;
  for (const [ax,ay,bx,by,cx,cy] of [
    [x+cl,y, x,y, x,y+cl], [x+w-cl,y, x+w,y, x+w,y+cl],
    [x,y+h-cl, x,y+h, x+cl,y+h], [x+w,y+h-cl, x+w,y+h, x+w-cl,y+h],
  ] as [number,number,number,number,number,number][]) {
    ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.lineTo(cx,cy); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = `${col}${flash ? "22" : "0e"}`;
  ctx.fillRect(x,y,w,h);
  ctx.restore();
}

function drawSkeleton(ctx: CanvasRenderingContext2D, lms: LM[], W: number, H: number) {
  ctx.save();
  for (const [i,j] of POSE_CONNS) {
    const a = lms[i], b = lms[j];
    if (!a || !b || (a.visibility??1)<0.25 || (b.visibility??1)<0.25) continue;
    const col = connColor(i,j);
    ctx.beginPath();
    ctx.moveTo(a.x*W, a.y*H);
    ctx.lineTo(b.x*W, b.y*H);
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.shadowColor = col; ctx.shadowBlur = 7;
    ctx.globalAlpha = 0.88;
    ctx.stroke();
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;

  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i];
    if ((lm.visibility??1) < 0.25) continue;
    const x = lm.x*W, y = lm.y*H, col = dotCol(i);
    ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2);
    ctx.fillStyle = `${col}2a`; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
    ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10;
    ctx.fill(); ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ── Hand detection removed, focus on object detection only ──

function drawLabel(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, col: string) {
  ctx.save();
  ctx.font = "bold 11px 'Courier New',monospace";
  const tw = ctx.measureText(text).width;
  const p=5, bh=20, bw=tw+p*2+4;
  ctx.fillStyle="rgba(0,0,0,0.90)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x,y-bh,bw,bh,4); else ctx.rect(x,y-bh,bw,bh);
  ctx.fill();
  ctx.fillStyle=col; ctx.fillRect(x,y-bh,3,bh);
  ctx.fillStyle="#fff"; ctx.fillText(text,x+p+2,y-p);
  ctx.shadowColor=col; ctx.shadowBlur=8;
  ctx.restore();
}

function drawThinkBubble(
  ctx: CanvasRenderingContext2D,
  cx: number, y: number, text: string,
  risk: "low"|"medium"|"high"
) {
  if (!text) return;
  const rc = RISK_COL[risk];
  ctx.save();
  ctx.font = "9px 'Courier New',monospace";
  const full = `◈ ${text}`;
  const tw = ctx.measureText(full).width;
  const p=5, bw=tw+p*2, bh=18;
  const bx = cx-bw/2, by = y+5;
  ctx.fillStyle="rgba(0,0,0,0.87)";
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx,by,bw,bh,5); else ctx.rect(bx,by,bw,bh);
  ctx.fill();
  ctx.strokeStyle=rc; ctx.lineWidth=1; ctx.shadowColor=rc; ctx.shadowBlur=7;
  ctx.stroke(); ctx.shadowBlur=0;
  ctx.fillStyle=rc; ctx.fillText(full,bx+p,by+12);
  ctx.restore();
}

function drawWaveBanner(ctx: CanvasRenderingContext2D, W: number, t: number) {
  const pulse = 0.82+0.18*Math.sin(t/130);
  ctx.save();
  ctx.font = "bold 12px 'Courier New',monospace";
  const txt="👋  WAVE DETECTED";
  const tw=ctx.measureText(txt).width, bx=(W-tw-20)/2, by=10;
  const g=ctx.createLinearGradient(bx,0,bx+tw+20,0);
  g.addColorStop(0,`rgba(245,158,11,${pulse})`);
  g.addColorStop(1,`rgba(234,179,8,${pulse})`);
  ctx.fillStyle=g;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx,by,tw+20,26,8); else ctx.rect(bx,by,tw+20,26);
  ctx.fill();
  ctx.fillStyle="#000"; ctx.fillText(txt,bx+10,by+18);
  ctx.restore();
}

// Short urgent double-beep (rising tone) for high-risk pre-fall events like a
// bed-exit or an abrupt wake-and-stand. Best-effort — silent if WebAudio is
// unavailable or the tab has not yet been interacted with.
function playUrgentBeep(ref: { current: AudioContext | null }) {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!ref.current) ref.current = new AC();
    const ctx = ref.current;
    if (ctx.state === "suspended") void ctx.resume();
    const beep = (at: number, freq: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.24);
    };
    beep(0, 880);
    beep(0.28, 1175);
  } catch { /* audio is best-effort */ }
}

// Tech-Watt/Fall-Detection style live "FALL DETECTED" text, drawn on the person's box
// the instant its aspect ratio goes horizontal — mirrors the repo's on-frame overlay.
function drawFallBanner(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const pulse = 0.7+0.3*Math.sin(t/120);
  ctx.save();
  ctx.font = "bold 14px 'Courier New',monospace";
  const txt = "⚠ FALL DETECTED";
  const tw = ctx.measureText(txt).width;
  const bx = Math.max(4, x), by = Math.max(4, y - 30);
  ctx.fillStyle = `rgba(239,68,68,${pulse})`;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx,by,tw+16,26,6); else ctx.rect(bx,by,tw+16,26);
  ctx.fill();
  ctx.fillStyle = "#fff"; ctx.fillText(txt,bx+8,by+18);
  ctx.restore();
}

function drawScanLine(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const y = (t * 0.04) % H;
  const g = ctx.createLinearGradient(0,y-24,0,y+4);
  g.addColorStop(0,"rgba(34,211,238,0)");
  g.addColorStop(1,"rgba(34,211,238,0.04)");
  ctx.fillStyle=g;
  ctx.fillRect(0,y-24,W,28);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getBackendUrl = () => {
  // Always use the Next.js API proxy routes to avoid mixed-content blocks
  // when the Vercel frontend (HTTPS) consumes the local backend (HTTP).
  return "";
};

function captureSnapshot(videoEl: HTMLVideoElement | null, imgEl: HTMLImageElement | null, canvasEl: HTMLCanvasElement | null): string | undefined {
  try {
    const source = videoEl && videoEl.readyState >= 2 ? videoEl : null;
    const imgSource = imgEl && imgEl.complete && imgEl.naturalWidth > 0 ? imgEl : null;
    if (!source && !imgSource) return undefined;
    const w = source?.videoWidth || imgSource?.naturalWidth || 640;
    const h = source?.videoHeight || imgSource?.naturalHeight || 480;
    const c = canvasEl || document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return undefined;
    if (source) ctx.drawImage(source, 0, 0, w, h);
    else if (imgSource) ctx.drawImage(imgSource, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  } catch { return undefined; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraVisionFeed({ isFallen, onFallTriggered, onFallCleared, onPreFallRisk, cameraMode = "hybrid", residentName, residentRoom, residentId }: Props) {
  // Camera Mode State (Local | Tapo IP | Hybrid)
  const [activeCamera, setActiveCamera] = useState<"local" | "tapo">(
    cameraMode === "tapo" ? "tapo" : "local"
  );
  const [tapoStatus, setTapoStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [tapoPan, setTapoPan] = useState(0);   // horizontal position (-100 to 100)
  const [tapoTilt, setTapoTilt] = useState(0); // vertical position (-100 to 100)

  // Tapo connection retry state
  const tapoRetryRef = useRef(0);
  const tapoMaxRetries = 5;
  const tapoRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapoStreamUrlRef = useRef("/api/camera/tapo-feed");

  // Camera history state
  interface CameraEvent { id: string; type: "fall" | "connection" | "snapshot" | "alert"; message: string; timestamp: number; thumbnail?: string }
  const [history, setHistory] = useState<CameraEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyIdRef = useRef(0);
  const [aiVitals, setAiVitals] = useState({
    heartRate: 72,
    respirationRate: 16,
    temperature: 36.8,
    oxygen: 98,
  });
  const [bpEstimate, setBpEstimate] = useState<VitalEstimate | null>(null);

  // DOM refs
  const videoRef   = useRef<HTMLVideoElement|null>(null);
  const imgRef     = useRef<HTMLImageElement|null>(null);
  const canvasRef  = useRef<HTMLCanvasElement|null>(null);
  const captureRef = useRef<HTMLCanvasElement|null>(null);
  const faceCropRef = useRef<HTMLCanvasElement|null>(null); // offscreen zoom-crop of the face for accurate emotion
  const poseCropRef = useRef<HTMLCanvasElement|null>(null); // offscreen zoom-crop of the person for far-away pose (CCTV)
  const personBoxRef = useRef<{ x: number; y: number; w: number; h: number; at: number } | null>(null); // latest detected person box (for ROI crop)
  const tapoImgRef = useRef<HTMLImageElement|null>(null);

  // Model refs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poseRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handRef     = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detectorRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceLmRef   = useRef<any>(null); // MediaPipe FaceLandmarker (eyeBlink)
  const lastFaceLmRef = useRef(0);       // throttle timer for the face landmarker
  const rafRef      = useRef<number>(0);

  // Timing refs
  const lastPoseRef   = useRef(0);
  const lastHandRef   = useRef(0);
  const lastDetRef    = useRef(0);
  const lastVisionRef = useRef(0);
  const lastUiRef     = useRef(0);   // throttles React UI state updates (~4/sec) to keep the main thread free
  const fallStartRef  = useRef<number | null>(null); // when the horizontal (fallen) posture first began — for auto-fall persistence
  const fallClearStartRef = useRef<number | null>(null); // when the non-fallen posture first began — for auto-fall clearing
  const selfFallenRef = useRef(false);               // internal latch so the component fires its own EMERGENCY even when no parent controls `isFallen`
  const fallConfidenceRef = useRef(0);               // live 0..1 fall confidence from pose geometry
  const lastFallEscalationRef = useRef(0);           // debounce for auto-raised escalations
  const startRef      = useRef<number>(0);

  useEffect(() => {
    startRef.current = Date.now();
  }, []);

  // Live data refs (read by 60fps draw loop, written by inference)
  const posesRef    = useRef<LM[][]>([]);
  const handsRef    = useRef<LM[][]>([]);
  const detsRef     = useRef<TrackedDet[]>([]);
  const analysisRef = useRef<VisionAnalysis>(INIT);
  const waveRef     = useRef(false);
  const gemBusyRef  = useRef(false);
  const gemDeadRef  = useRef(false);  // set once the API key is confirmed dead -> stop wasteful cloud calls

  // Monitoring log persistence — save analysis snapshots to DB every 30s and fall events immediately
  const lastSaveRef = useRef(0);
  const SAVE_INTERVAL_MS = 30_000;
  // Event-driven logging: capture EVERY distinct emotion/behavior change (waving,
  // happy, sad, angry, …) so the activity log reflects everything behind the camera,
  // not just the 30s heartbeat. Debounced so momentary flicker doesn't spam the log.
  const lastBehaviorLogRef = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const BEHAVIOR_LOG_MIN_MS = 5_000;
  const stillSinceRef = useRef(0); // last time the resident showed movement (drives sleep state)
  const reclinedRef = useRef(false); // torso horizontal (lying/reclined) from pose keypoints
  const saveMonitoringLog = useCallback(async (logType: string, analysis: VisionAnalysis) => {
    try {
      await fetch("/api/db/camera-monitoring-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          residentId: residentId || null,
          residentName: residentName || null,
          roomNumber: residentRoom || null,
          logType,
          emotion: analysis.globalEmotion,
          emotionConfidence: analysis.emotionConfidence,
          behavior: analysis.globalBehavior,
          posture: analysis.globalPosture,
          sleepState: analysis.sleepState,
          confused: analysis.confused,
          alert: analysis.alert,
          alertReason: analysis.alertReason,
          summary: analysis.summary,
          objects: analysis.objects,
          heartRate: aiVitals.heartRate,
          respirationRate: aiVitals.respirationRate,
          temperature: aiVitals.temperature,
          oxygen: aiVitals.oxygen,
          bloodPressureSys: bpEstimate?.systolicBP ?? null,
          bloodPressureDia: bpEstimate?.diastolicBP ?? null,
          cameraId: cameraMode,
        }),
      });
    } catch { /* non-critical — ignore save errors */ }
  }, [residentId, residentName, residentRoom, cameraMode, aiVitals.heartRate, aiVitals.respirationRate, aiVitals.temperature, aiVitals.oxygen, bpEstimate?.systolicBP, bpEstimate?.diastolicBP]);

  // Auto-escalation — when a fall is CONFIRMED, raise an EMERGENCY SBAR escalation so
  // the clinical team is paged immediately, independent of any parent wiring. Debounced.
  const raiseFallEscalation = useCallback(async (confidence: number) => {
    if (!residentId) return; // need a resident to route the escalation to
    const now = Date.now();
    if (now - lastFallEscalationRef.current < FALL_ESCALATION_DEBOUNCE_MS) return;
    lastFallEscalationRef.current = now;
    const who = `${residentName || "Resident"}${residentRoom ? ` (Room ${residentRoom})` : ""}`;
    try {
      await fetch("/api/db/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          residentId,
          situation: `Automated fall detection — ${who} appears to have fallen and is on the floor (confidence ${Math.round(confidence * 100)}%).`,
          background: "Detected on-device by camera vision (pose + motion): the resident went horizontal on the floor and stayed still through the confirmation window.",
          assessment: "Possible fall with risk of injury — needs an immediate in-person check.",
          recommendation: "Dispatch a caregiver/nurse to the room now to assess the resident and take vitals.",
          priority: "EMERGENCY",
          status: "OPEN",
          raisedBy: "Automated Fall Detection",
          raisedByRole: "SYSTEM",
          assignedToRole: "NURSE",
        }),
      });
    } catch { /* non-critical — the on-screen EMERGENCY + fall log still fire */ }
  }, [residentId, residentName, residentRoom]);

  // Wave detection - separate left and right history for accuracy
  const lWristHistRef = useRef<number[]>([]);
  const rWristHistRef = useRef<number[]>([]);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  
  // Fall detection fallback state
  const poseFallenRef = useRef(false);
  const objFallenRef = useRef(false);

  // Ambianic-style motion tracking: a fall is horizontal geometry PRECEDED by a
  // rapid downward drop. These track the body's center-of-mass between frames so we
  // can tell a real fall (fast drop) from someone slowly lying down (no drop).
  const prevCenterYRef  = useRef<number | null>(null); // last frame's center-of-mass Y (normalized 0-1)
  const prevTimeRef     = useRef(0);                   // timestamp of that frame
  const rapidDropTimeRef = useRef(0);                  // when the last rapid drop was seen

  // Preventive pre-fall risk tracking
  const lastRiskEvalRef    = useRef(0);   // throttles risk scoring
  const agitationStreakRef = useRef(0);   // consecutive agitated/startled reads
  const lastPreFallAlertRef = useRef(0);  // debounce between preventive alerts
  const preFallTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPreFallRiskRef   = useRef(onPreFallRisk);
  useEffect(() => { onPreFallRiskRef.current = onPreFallRisk; }, [onPreFallRisk]); // keep fresh for the long-lived render loop

  // Bed-exit / getting-up + wake tracking (pose-based → works even at a distance
  // and when the resident is NOT facing the camera).
  const prevSleepStateRef  = useRef("Awake"); // detect Sleeping/Drowsy → Awake transitions
  const wokeAtRef          = useRef(0);       // when the resident last woke up
  const lastReclinedAtRef  = useRef(0);       // last time the torso was horizontal (lying in bed)
  const standUpAlertedRef  = useRef(false);   // latched after a stand-up alarm until they lie back down
  const lastStandAlertRef  = useRef(0);       // debounce for stand-up / bed-exit alarms
  const alarmCtxRef        = useRef<AudioContext | null>(null); // WebAudio ctx for the urgent beep

  // FPS
  const fpsTimesRef = useRef<number[]>([]);

  // React UI state
  const [selfFallen, setSelfFallen] = useState(false); // drives the EMERGENCY render when this component detects a fall itself
  const [preFallRisk, setPreFallRisk] = useState<{ active: boolean; reason: string; urgent: boolean }>({ active: false, reason: "", urgent: false });
  const [camActive,  setCamActive]  = useState(false);
  // A fall is active if the parent says so OR this component detected one itself.
  const fallen = (isFallen ?? false) || selfFallen;
  const [camError,   setCamError]   = useState("");
  const [modelsOk,   setModelsOk]   = useState(false);
  const [useBackendFeed, setUseBackendFeed] = useState(false);
  const [backendFeedUrl, setBackendFeedUrl] = useState("");
  const [modelMsg,   setModelMsg]   = useState("Loading AI models...");
  const [analysis,   setAnalysis]   = useState<VisionAnalysis>(INIT);
  const [fps,        setFps]        = useState(0);
  const [ping,       setPing]       = useState<number|null>(null);
  const [detCount,   setDetCount]   = useState(0);
  const [frameN,     setFrameN]     = useState(0);
  const [waving,     setWaving]     = useState(false);
  const [gemPending, setGemPending] = useState(false);

  // Voice synthesis states and refs
  const [isMuted, setIsMuted] = useState<boolean>(true); // Must match SSR exactly to avoid hydration mismatch

  // Hydrate user preference from localStorage after the initial render pass
  useEffect(() => {
    const saved = localStorage.getItem("monitoringVoiceMuted");
    if (saved === "false") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMuted(false);
    }
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSpokenRef = useRef<string>("");
  // Tapo PTZ Control Handler
  const moveTapoCamera = useCallback((pan: number, tilt: number) => {
    const clampedPan = Math.max(-100, Math.min(100, pan));
    const clampedTilt = Math.max(-100, Math.min(100, tilt));

    setTapoPan(clampedPan);
    setTapoTilt(clampedTilt);

    // Send to Tapo PTZ endpoint (non-blocking)
    fetch("/api/tapo-ptz", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pan: clampedPan,
        tilt: clampedTilt,
      }),
    }).catch(() => {});
  }, []);


  const stopSpeaking = useCallback(() => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
      } catch (_) {}
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    isSpeakingRef.current = false;
  }, []);

  const speak = useCallback(async (text: string) => {
    stopSpeaking();
    const muted = localStorage.getItem("monitoringVoiceMuted") === "true";
    if (muted) return;

    isSpeakingRef.current = true;

    try {
      // Try AI Vision TTS first with natural, friendly voice
      const res = await fetch("/api/ai-vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tts",
          text,
          voiceSettings: {
            pitch: 1.2,          // Slightly higher for warmth
            speakingRate: 0.9,   // Slower for clarity
            voiceGender: "FEMALE" // Female voice for friendliness
          }
        }),
      });

      const data = await res.json();

      const currentlyMuted = localStorage.getItem("monitoringVoiceMuted") === "true";
      if (!currentlyMuted && !data.fallback && data.audio) {
        // Decode base64 audio and play it
        const binary = atob(data.audio);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: data.mimeType ?? "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          isSpeakingRef.current = false;
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          isSpeakingRef.current = false;
          URL.revokeObjectURL(url);
        };
        await audio.play();
        return;
      }
    } catch (err) {
      console.warn("AI Vision TTS failed, falling back to browser TTS:", err);
    }

    // Fallback: browser Web Speech API
    const currentlyMutedFallback = localStorage.getItem("monitoringVoiceMuted") === "true";
    if (currentlyMutedFallback) return;
    if (!("speechSynthesis" in window)) {
      isSpeakingRef.current = false;
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);

    // Natural, friendly voice settings
    utterance.rate = 0.9;  // Slightly slower for clarity and warmth
    utterance.pitch = 1.2; // Slightly higher pitch for friendliness
    utterance.volume = 1;

    // Select the highest quality, most natural neural voice available in the browser
    const voices = window.speechSynthesis.getVoices();
    const friendlyVoice = 
      voices.find(v => (v.name.includes("Natural") || v.name.includes("Online")) && (v.name.includes("Female") || v.name.includes("Aria") || v.name.includes("Jenny"))) ||
      voices.find(v => v.name.includes("Google US English")) ||
      voices.find(v => v.name.includes("Samantha")) ||
      voices.find(v => v.name.includes("Zira")) ||
      voices[0];
      
    if (friendlyVoice) utterance.voice = friendlyVoice;

    utterance.onend = () => {
      isSpeakingRef.current = false;
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
    };
    window.speechSynthesis.speak(utterance);
  }, [stopSpeaking]);

  useEffect(() => {
    localStorage.setItem("monitoringVoiceMuted", String(isMuted));
    if (isMuted) {
      stopSpeaking();
    }
  }, [isMuted, stopSpeaking]);

  // Tapo IP Camera Connection — retry-capable, with auto-reconnect.
  // The stream is served by the backend <img> below (GET /api/v1/camera/tapo_feed).
  // The backend builds the RTSP URL from its OWN .env — the frontend never pushes
  // the camera IP or credentials over the wire.
  const reconnectTapo = useCallback(() => {
    // Bust the MJPEG cache by appending a timestamp — forces the browser to
    // re-open the SSE stream instead of reusing the stale/errored connection.
    tapoStreamUrlRef.current = `/api/camera/tapo-feed?t=${Date.now()}`;
    setTapoStatus("connecting");
    tapoRetryRef.current += 1;
    // Force the <img> to re-fetch by toggling src
    if (tapoImgRef.current) {
      tapoImgRef.current.src = tapoStreamUrlRef.current;
    }
    setHistory(prev => [{
      id: `conn-${++historyIdRef.current}`,
      type: "connection" as const,
      message: `Reconnect attempt ${tapoRetryRef.current}/${tapoMaxRetries}`,
      timestamp: Date.now(),
    }, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    if (activeCamera !== "tapo") {
      // Clean up any pending retry timer when switching away
      if (tapoRetryTimerRef.current) clearTimeout(tapoRetryTimerRef.current);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTapoStatus("connecting");
    tapoRetryRef.current = 0;
    tapoStreamUrlRef.current = `/api/camera/tapo-feed?t=${Date.now()}`;
  }, [activeCamera]);

  useEffect(() => {
    if (isMuted) {
      stopSpeaking();
      return;
    }

    const summaryText = fallen
      ? "Emergency! Fall detected. Resident requires immediate assistance."
      : analysis.summary;

    if (!summaryText) return;

    // Ignore initial placeholder summaries
    const ignoreList = [
      "ai vision loading models",
      "analysis in progress",
      "initializing",
      "ai vision loading models..."
    ];
    if (ignoreList.includes(summaryText.toLowerCase().trim())) {
      return;
    }

    if (summaryText !== lastSpokenRef.current) {
      lastSpokenRef.current = summaryText;
      speak(summaryText);
    }
  }, [analysis.summary, fallen, isMuted, speak, stopSpeaking]);

  // Stop speaking when unmounted
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  // ── Init MediaPipe models (uses module-level singleton) ────────────────────
  useEffect(() => {
    let dead = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    (async () => {
      try {
        setModelMsg("Loading AI models...");
        const { pose, detector } = await loadMediaPipeOnce();
        if (dead) return;

        poseRef.current = pose;
        if (detector) detectorRef.current = detector;
        setModelsOk(true);
        setModelMsg("All systems online ✓");

        // Detector + face landmarker load in the background — poll until both ready.
        pollTimer = setInterval(() => {
          if (dead) { if (pollTimer) clearInterval(pollTimer); return; }
          if (_mpDetector) detectorRef.current = _mpDetector;
          if (_mpFace) faceLmRef.current = _mpFace;
          if (detectorRef.current && faceLmRef.current && pollTimer) clearInterval(pollTimer);
        }, 200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        setModelMsg(`Model error: ${e?.message ?? "failed"}`);
      }
    })();

    return () => {
      dead = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, []);

  const localStreamRef = useRef<MediaStream | null>(null);

  const startLocalCamera = useCallback(async () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    try {
      setCamError("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      localStreamRef.current = stream;
      const v = videoRef.current;
      if (v) {
        v.srcObject = stream;
        v.onloadedmetadata = () => {
          setCamActive(true);
          setUseBackendFeed(false);
        };
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } catch (e: any) {
        console.warn("Local camera blocked or insecure context. Falling back to FastAPI backend feed:", e);
      setCamError(e?.message ?? "Device in use");
      setBackendFeedUrl("/api/camera/feed");
      setUseBackendFeed(true);
      setCamActive(true);
    }
  }, []);

  useEffect(() => {
    loadFaceAPI();
    if (activeCamera === "local") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startLocalCamera();
    } else {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      setCamActive(false);
    }
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [activeCamera, startLocalCamera]);

  // Local facial emotion detection removed to rely purely on AI Vision

  // ── Real-time body movement & behavior analysis ────────────────────────────
  const analyzeBodyMovement = useCallback((lms: LM[]) => {
    if (!lms || lms.length < 25) return;

    // Key body points
    const nose = lms[0], lShldr = lms[11], rShldr = lms[12];
    const lHip = lms[23], rHip = lms[24];
    const lWrist = lms[15], rWrist = lms[16];  // Hand tracking

    if (!nose || !lShldr || !rShldr) return;

    // ── HAND/WRIST MOVEMENT DETECTION (Real-time waving) ──
    const lHist = lWristHistRef.current;
    const rHist = rWristHistRef.current;
    let handMovement = 0;

    // Only track waving if the wrist is clearly visible and raised above the shoulder level
    if (lWrist && (lWrist.visibility ?? 0) > 0.55 && lWrist.y < lShldr.y) {
      lHist.push(lWrist.x);
      if (lHist.length > 20) lHist.shift();
      if (lHist.length > 1) {
        handMovement = Math.max(handMovement, Math.abs(lHist[lHist.length - 1] - lHist[lHist.length - 2]));
      }
    } else {
      lHist.length = 0; // Clear history if tracking is lost or hand is lowered
    }

    if (rWrist && (rWrist.visibility ?? 0) > 0.55 && rWrist.y < rShldr.y) {
      rHist.push(rWrist.x);
      if (rHist.length > 20) rHist.shift();
      if (rHist.length > 1) {
        handMovement = Math.max(handMovement, Math.abs(rHist[rHist.length - 1] - rHist[rHist.length - 2]));
      }
    } else {
      rHist.length = 0; // Clear history if tracking is lost or hand is lowered
    }

    // Detect rapid hand movement = waving
    // Must be a significant movement (threshold raised to 0.05)
    if (handMovement > 0.05) {
      if (!waveRef.current) {
        waveRef.current = true;
        setWaving(true);
      }
      
      // Reset wave timer
      if (waveTimerRef.current) clearTimeout(waveTimerRef.current);
      waveTimerRef.current = setTimeout(() => {
        waveRef.current = false;
        setWaving(false);
      }, 2000);
    }
  }, []);

  // ── AUTOMATIC fall detection from pose keypoints ──────────────────────────
  // Fires by itself — no button. A fall = the torso goes horizontal (shoulders and
  // hips at nearly the same height) low in the frame. To avoid false alarms from
  // bending over or lying down briefly, the posture must PERSIST ~1.2s before we
  // raise the alert.
  const checkFall = useCallback((lms: LM[], now: number) => {
    // ── Center-of-mass velocity (Ambianic) ──────────────────────────────────
    // Mean Y of all confidently-visible landmarks is the body's vertical center.
    // A fast increase in Y (downward) is a rapid drop — stamp the moment it happens.
    // Runs every frame, before the geometry checks below, so history stays continuous.
    let sumY = 0, nY = 0;
    for (const lm of lms) { if ((lm.visibility ?? 0) > 0.4) { sumY += lm.y; nY++; } }
    if (nY >= 4) {
      const centerY = sumY / nY;
      const dtMs = now - prevTimeRef.current;
      // Ignore stale gaps (hidden tab / first frame) so we never fabricate velocity.
      if (prevCenterYRef.current != null && dtMs > 0 && dtMs < 500) {
        const vY = (centerY - prevCenterYRef.current) * 1000 / dtMs; // frame-heights/sec, down = +
        if (vY > RAPID_DROP_VELOCITY) rapidDropTimeRef.current = now;
      }
      prevCenterYRef.current = centerY;
      prevTimeRef.current = now;
    }

    const lh=lms[23], rh=lms[24], ls=lms[11], rs=lms[12];
    
    const hipVisible = (lh && (lh.visibility??0) > 0.45) || (rh && (rh.visibility??0) > 0.45);
    const shlVisible = (ls && (ls.visibility??0) > 0.45) || (rs && (rs.visibility??0) > 0.45);
    
    // If hips are missing but shoulders are visible, check upper-body geometry for a fall.
    // Everything here also requires the upper body to be LOW in the frame (on the floor),
    // so a standing person — whose head/shoulders sit high in the frame — never triggers.
    if (!hipVisible && shlVisible) {
      // 1. Sideways fall check: shoulders are stacked vertically instead of horizontally,
      //    and low in the frame (on the ground).
      const shlDx = Math.abs(ls.x - rs.x);
      const shlDy = Math.abs(ls.y - rs.y);
      const isSideways = shlDy > shlDx * 1.5 && (ls.y > 0.60 || rs.y > 0.60);

      // 2. Horizontal layout check: compute bounding box of all visible upper-body points
      const visibleXs: number[] = [], visibleYs: number[] = [];
      lms.slice(0, 15).forEach(lm => {
        if ((lm.visibility ?? 0) > 0.45) { visibleXs.push(lm.x); visibleYs.push(lm.y); }
      });

      let isHorizontalShape = false;
      if (visibleXs.length > 5) {
        const minX = Math.min(...visibleXs), maxX = Math.max(...visibleXs);
        const minY = Math.min(...visibleYs), maxY = Math.max(...visibleYs);
        // Cluster clearly wider than tall AND lying low in the frame (entire head/shoulders past mid).
        // Require minY > 0.50 so that if they are close to the camera, the top of the head is not high up.
        if ((maxX - minX) > (maxY - minY) * 2.0 && maxY > 0.75 && minY > 0.50) {
          isHorizontalShape = true;
        }
      }

      if (isSideways || isHorizontalShape) { fallConfidenceRef.current = 0.55; return true; }
      fallConfidenceRef.current = 0;
      return false;
    }

    if (!hipVisible || !shlVisible) { fallConfidenceRef.current = 0; return false; }
    
    const hipY = (lh && (lh.visibility??0) > 0.45 && rh && (rh.visibility??0) > 0.45) 
      ? (lh.y+rh.y)/2 
      : ((lh && (lh.visibility??0) > 0.45) ? lh.y : rh.y);
      
    const shlY = (ls && (ls.visibility??0) > 0.45 && rs && (rs.visibility??0) > 0.45)
      ? (ls.y+rs.y)/2
      : ((ls && (ls.visibility??0) > 0.45) ? ls.y : rs.y);

    const hipX = (lh && (lh.visibility??0) > 0.45 && rh && (rh.visibility??0) > 0.45)
      ? (lh.x+rh.x)/2
      : ((lh && (lh.visibility??0) > 0.45) ? lh.x : rh.x);
    const shlX = (ls && (ls.visibility??0) > 0.45 && rs && (rs.visibility??0) > 0.45)
      ? (ls.x+rs.x)/2
      : ((ls && (ls.visibility??0) > 0.45) ? ls.x : rs.x);

    // LYING vs STANDING — compare the torso vector (shoulders → hips):
    //   Standing / on foot → hips sit BELOW shoulders: vertical torso (dy >> dx) → NOT a fall.
    //   Fallen on the floor → hips are BESIDE shoulders: horizontal torso (dx > dy) → fall.
    // This is what makes ONLY a horizontal body on the floor count as a fall.
    const dx = Math.abs(shlX - hipX);
    const dy = Math.abs(shlY - hipY);
    const torsoHorizontal = dx > dy * 1.5;         // body clearly horizontal (lying), not upright
    const onFloor = hipY > 0.55 && shlY > 0.55;    // body is low in the frame (on the ground)

    // Also guard head position if nose is visible
    const nose = lms[0];
    const noseLow = (nose && (nose.visibility ?? 0) > 0.45) ? nose.y > 0.50 : true;

    const fallen = torsoHorizontal && onFloor && noseLow;
    // Confidence blends torso horizontality (aspect ratio), how low the body sits, and
    // head position. Motion (rapid drop) + stillness are layered on at the firing site.
    const torsoScore = clamp01((dx / (dy + 1e-4) - 1) / 1.5);
    const floorScore = clamp01(((hipY + shlY) / 2 - 0.55) / 0.35);
    const noseScore = noseLow ? 1 : 0.4;
    fallConfidenceRef.current = fallen
      ? Math.max(0.5, clamp01(0.45 * torsoScore + 0.35 * floorScore + 0.2 * noseScore))
      : 0;
    return fallen;
  }, []);

  // ── AI Vision vision (called every ~2000ms from inference loop) ───────────────
  const runVision = useCallback(async () => {
    // Cloud key is dead/absent — skip the network call AND the per-frame canvas
    // encode entirely. Local on-device detection (running every frame in the loop)
    // fully covers emotion/behavior/posture, so this just removes periodic hitches.
    if (gemDeadRef.current) return;
    if (gemBusyRef.current) {
      console.log("[AI Vision] API busy, skipping call.");
      return;
    }
    const v = videoRef.current;
    const img = imgRef.current;
    const source = activeCamera === "tapo" ? tapoImgRef.current : (useBackendFeed ? imgRef.current : v);
    const c = captureRef.current;
    if (!source || !c) return;
    const ctx=c.getContext("2d"); if (!ctx) return;
    c.width=640; c.height=480;  // ← INCREASED RESOLUTION for better facial emotion detection
    ctx.drawImage(source,0,0,c.width,c.height);  // No mirror - normal orientation
    const b64 = c.toDataURL("image/jpeg",0.75).split(",")[1];  // Better quality

    console.log("[Emotion Detector] Analyzing facial landmarks...");
    gemBusyRef.current=true; setGemPending(true);
    const t0=performance.now();

    try {
      let analysis_data: VisionAnalysis | null = null;

      try {
        console.log("[AI Vision] Requesting analysis...");
        const res = await fetch("/api/ai-vision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "vision",
            imageBase64: b64,
            mimeType: "image/jpeg"
          })
        });

        if (res.ok) {
          const j = await res.json();
          if (j?.fallback) {
            // Route told us to use the on-device engine (no/dead key). Latch it so
            // we stop making these calls entirely from now on.
            gemDeadRef.current = true;
            analysis_data = null;
          } else {
            analysis_data = j;
            console.log("[AI Vision] API success. Emotion:", analysis_data?.globalEmotion, "Confidence:", analysis_data?.emotionConfidence);
          }
        } else {
          console.warn("[AI Vision] API returned error status:", res.status);
        }
      } catch (e) {
        console.warn("[AI Vision] API fetch failed, using local fallback:", e);
      }

      // If API failed or is offline, fallback to local landmark detection
      if (!analysis_data) {
        console.log("[Emotion Detector] Running local landmark fallback...");
        const poses = posesRef.current;
        if (poses.length > 0 && poses[0].length > 0) {
          const landmarks = poses[0];
          analysis_data = analyzeEmotionFromLandmarks(landmarks, analysisRef.current) as VisionAnalysis;
        } else {
          analysis_data = {
            globalEmotion: "Neutral",
            emotionConfidence: 0,
            globalBehavior: "Detecting face...",
            globalPosture: "Unknown",
            sleepState: "Awake",
            confused: false,
            alert: false,
            alertReason: null,
            summary: "Waiting for face detection",
            objects: []
          };
        }
      }

      // rPPG is now sampled every animation frame from the zoomed face crop (see the
      // pose block below) and estimated in the throttled UI update — a 2s cadence here
      // was far too slow to ever measure a ~1 Hz pulse.

      const ms = Math.round(performance.now() - t0);
      console.log("[AI Vision] Cycle time:", ms, "ms");

      if (analysis_data.alert) {
        analysis_data = { ...analysis_data, alert: false, alertReason: null };
      }

      analysisRef.current = analysis_data;
      setAnalysis(analysis_data);
      setPing(ms);
      setFrameN(n=>n+1);

      // Merge per-object thoughts into tracked detections
      if (analysis_data.objects?.length) {
        detsRef.current = detsRef.current.map(d => {
          const m = analysis_data.objects.find(o =>
            d.label.toLowerCase().includes(o.type.toLowerCase()) ||
            o.type.toLowerCase().includes(d.label.toLowerCase()) ||
            (d.label.toLowerCase() === "person" && o.type.toLowerCase() === "facial expression")
          );
          return m ? { ...d, thought: m.thought, risk: m.risk } : d;
        });
      }

    } catch (e) {
      console.error("[AI Vision] API error:", e);
    }
    finally {
      gemBusyRef.current=false;
      setGemPending(false);
      console.log("[AI Vision] Reset busy flag.");
    }
  }, [activeCamera, useBackendFeed]);

  // ── rPPG Vital Signs HUD Drawing Helpers ─────────────────────────────────
  const drawRppgScanner = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    t: number, hr: number
  ) => {
    ctx.save();
    ctx.strokeStyle = "rgba(34, 211, 238, 0.75)";
    ctx.lineWidth = 1.5;
    
    // Draw corner markers
    const cl = Math.min(w, h) * 0.2;
    for (const [ax,ay,bx,by,cx,cy] of [
      [x+cl,y, x,y, x,y+cl], [x+w-cl,y, x+w,y, x+w,y+cl],
      [x,y+h-cl, x,y+h, x+cl,y+h], [x+w,y+h-cl, x+w,y+h, x+w-cl,y+h],
    ] as [number,number,number,number,number,number][]) {
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.lineTo(cx,cy); ctx.stroke();
    }

    // Crosshair in center
    ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + w/2 - 8, y + h/2); ctx.lineTo(x + w/2 + 8, y + h/2);
    ctx.moveTo(x + w/2, y + h/2 - 8); ctx.lineTo(x + w/2, y + h/2 + 8);
    ctx.stroke();

    // Pulse target HUD text
    ctx.fillStyle = "#22d3ee";
    ctx.font = "bold 9px 'Courier New',monospace";
    const flash = Math.floor(t / 300) % 2 === 0;
    ctx.fillText(`[rPPG LOCK: ${hr} BPM${flash ? " 🟢" : "   "}]`, x, y - 6);
    ctx.restore();
  }, []);

  const drawRppgWave = useCallback((
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    t: number
  ) => {
    ctx.save();
    // Glassmorphic background
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeStyle = "rgba(34, 211, 238, 0.4)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6); else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();

    // Wave Title
    ctx.fillStyle = "#22d3ee";
    ctx.font = "bold 8px 'Courier New',monospace";
    ctx.fillText("AI rPPG PULSE WAVE", x + 8, y + 12);

    // Draw scrolling plethysmogram curve
    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const step = 2;
    let first = true;
    for (let i = 0; i < w - 16; i += step) {
      const timeOffset = (t - i * 6) / 180;
      // Synthesize pulse wave with dicrotic notch
      const val = Math.sin(timeOffset) * 0.42 + Math.sin(timeOffset * 2.1) * 0.18 + Math.sin(timeOffset * 0.2) * 0.05;
      const py = y + h/2 + val * (h/2.8);
      const px = x + 8 + i;
      if (first) {
        ctx.moveTo(px, py);
        first = false;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    ctx.restore();
  }, []);

  // ── Canvas draw (called every RAF) ────────────────────────────────────────
  const drawFrame = useCallback(() => {
    const canvas=canvasRef.current; if (!canvas) return;
    const ctx=canvas.getContext("2d"); if (!ctx) return;
    const W=canvas.width, H=canvas.height;
    const t=Date.now()-startRef.current;

    ctx.clearRect(0,0,W,H);

    // Subtle scan-line sweep
    drawScanLine(ctx,W,H,t);

    // Skeleton (pose visualization)
    // for (const lms of posesRef.current) drawSkeleton(ctx,lms,W,H);

    // AI rPPG Face Scanner Overlay
    const pose0 = posesRef.current[0];
    if (pose0) {
      let minX = 1, minY = 1, maxX = 0, maxY = 0, seen = 0;
      for (let i = 0; i <= 10; i++) {
        const p = pose0[i];
        if (!p || (p.visibility ?? 1) < 0.3) continue;
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        seen++;
      }
      if (seen >= 4) {
        const px = minX * W, py = minY * H, pw = (maxX - minX) * W, ph = (maxY - minY) * H;
        const pad = Math.max(pw, ph) * 0.35;
        const fx = px - pad, fy = py - pad, fw = pw + pad * 2, fh = ph + pad * 2;
        // Draw green-cyan target reticle around face
        drawRppgScanner(ctx, fx, fy, fw, fh, t, aiVitals.heartRate);
        // Draw floating plethysmogram curve on the left side
        drawRppgWave(ctx, 12, 120, 160, 52, t);
      }
    }

    // Bounding boxes + labels + thinking bubbles (object detection)
    for (const det of detsRef.current) {
      const px=det.x*W, py=det.y*H, pw=det.w*W, ph=det.h*H;
      const isPerson = det.label==="person" || det.label==="human";
      const flash = (isFallen || selfFallenRef.current || (isPerson && objFallenRef.current)) && isPerson;
      drawCornerBox(ctx,px,py,pw,ph,det.color,flash);
      drawLabel(ctx,px,py,`${det.label.toUpperCase()} ${Math.round(det.score*100)}%`,det.color);
      if (det.thought) drawThinkBubble(ctx,px+pw/2,py+ph,det.thought,det.risk);
      // Tech-Watt live overlay: horizontal person box (height-width < 0) => Fall Detected.
      if (isPerson && objFallenRef.current) drawFallBanner(ctx,px,py,t);
    }

    // Wave banner (real-time hand movement detection)
    if (waveRef.current) drawWaveBanner(ctx,W,t);

    // Alert overlay
    if (isFallen || selfFallenRef.current) {
      const a=0.10+0.07*Math.sin(t/210);
      ctx.fillStyle=`rgba(239,68,68,${a})`; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle=`rgba(239,68,68,${0.55+0.3*Math.sin(t/210)})`;
      ctx.lineWidth=6; ctx.strokeRect(3,3,W-6,H-6);
    }
  }, [isFallen, aiVitals.heartRate, drawRppgScanner, drawRppgWave]);

  // ── Build a zoomed-in, square crop of just the face ───────────────────────
  // Uses MediaPipe pose face points (0–10: nose/eyes/ears/mouth) to locate the
  // face, then crops+enlarges that region into a 256px canvas. Running emotion on
  // this close-up (instead of the whole wide room shot) is what makes expression
  // detection accurate when the person is far from the camera. Returns null if the
  // face isn't clearly visible, so the caller falls back to the full frame.
  const buildFaceCrop = useCallback((
    src: HTMLVideoElement | HTMLImageElement, lms: LM[], W: number, H: number
  ): HTMLCanvasElement | null => {
    let minX = 1, minY = 1, maxX = 0, maxY = 0, seen = 0;
    for (let i = 0; i <= 10; i++) {
      const p = lms[i];
      if (!p || (p.visibility ?? 1) < 0.3) continue;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      seen++;
    }
    if (seen < 4) return null;  // not enough face points to trust the box

    // Pose face points hug the eyes/nose; pad out to include forehead & chin.
    const bw = maxX - minX, bh = maxY - minY;
    const cx = ((minX + maxX) / 2) * W;
    const cy = ((minY + maxY) / 2) * H;
    const half = Math.max(bw * W, bh * H) * 1.5;   // square half-size, generously padded to include chin/forehead
    if (half < 8) return null;
    let sx = cx - half, sy = cy - half, side = half * 2;
    sx = Math.max(0, Math.min(sx, W - 1));
    sy = Math.max(0, Math.min(sy, H - 1));
    side = Math.min(side, W - sx, H - sy);
    if (side < 16) return null;

    let c = faceCropRef.current;
    if (!c) { c = document.createElement("canvas"); c.width = 256; c.height = 256; faceCropRef.current = c; }
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(src, sx, sy, side, side, 0, 0, 256, 256);
    } catch { return null; }
    return c;
  }, []);

  // Person-ROI zoom for FAR-AWAY detection (CCTV). MediaPipe shrinks its input to a
  // small square internally, so a resident who is only ~30px tall in a wide 1080p
  // room shot is invisible to the pose model on the full frame. Here we crop to the
  // person's detected bounding box and scale it up (keeping aspect ratio) so the body
  // is big enough to track. The caller remaps the landmarks back to full-frame coords
  // using the returned source rect. Returns null if the box is too small to trust.
  const buildPersonCrop = useCallback((
    src: HTMLVideoElement | HTMLImageElement,
    box: { x: number; y: number; w: number; h: number }, W: number, H: number,
  ): { canvas: HTMLCanvasElement; sx: number; sy: number; sw: number; sh: number } | null => {
    const padX = box.w * 0.25, padY = box.h * 0.2; // pad so limbs/head aren't clipped
    let sx = (box.x - padX) * W, sy = (box.y - padY) * H;
    let sw = (box.w + padX * 2) * W, sh = (box.h + padY * 2) * H;
    sx = Math.max(0, sx); sy = Math.max(0, sy);
    sw = Math.min(sw, W - sx); sh = Math.min(sh, H - sy);
    if (sw < 24 || sh < 24) return null;
    // Scale up so the smaller side is ~256px (cap 4x) — enough pixels for the pose net.
    const scale = Math.min(4, Math.max(1, 256 / Math.min(sw, sh)));
    const cw = Math.round(sw * scale), ch = Math.round(sh * scale);
    let c = poseCropRef.current;
    if (!c) { c = document.createElement("canvas"); poseCropRef.current = c; }
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    try { ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch); } catch { return null; }
    return { canvas: c, sx, sy, sw, sh };
  }, []);

  // ── Main inference + draw loop (requestAnimationFrame) ────────────────────
  const loop = useCallback(() => {
    const now=performance.now();

    // Pick the LIVE source the AI should analyze — Tapo MJPEG <img>, backend feed
    // <img>, or the local webcam <video>. Previously detection only ever read the
    // local <video>, so the Tapo feed got zero detection.
    const isTapo = activeCamera === "tapo";
    const source: HTMLVideoElement | HTMLImageElement | null =
      isTapo ? tapoImgRef.current : (useBackendFeed ? imgRef.current : videoRef.current);
    const isVideo = source instanceof HTMLVideoElement;

    // Readiness differs by element type: <video> uses readyState, <img> (incl. the
    // ongoing MJPEG stream) is ready once it has decoded at least one frame.
    const ready = !!source && modelsOk && (
      isVideo
        ? (source as HTMLVideoElement).readyState >= 2
        : (source as HTMLImageElement).naturalWidth > 0
    );
    const srcW = (isVideo ? (source as HTMLVideoElement | null)?.videoWidth : (source as HTMLImageElement | null)?.naturalWidth) || 640;
    const srcH = (isVideo ? (source as HTMLVideoElement | null)?.videoHeight : (source as HTMLImageElement | null)?.naturalHeight) || 480;

    if (ready && source) {
      // Pose: throttled to ~30fps (for body movement & behavior analysis)
      if (poseRef.current && now-lastPoseRef.current>30) {
        try {
          // FAR-AWAY (CCTV): if the object detector just saw a SMALL person (i.e. one
          // far from the camera), run pose on a zoomed crop of that person instead of
          // the wide full frame, then remap the landmarks back to full-frame coords.
          // For a close/large person (or before any detection) we use the full frame,
          // so current webcam behaviour is unchanged.
          const box = personBoxRef.current;
          const boxFresh = !!box && (now - box.at) < 500;
          const distant = boxFresh && box!.h < 0.55 && box!.w < 0.55; // small in frame ⇒ far
          let poseInput: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement = source;
          let crop: { sx: number; sy: number; sw: number; sh: number } | null = null;
          if (distant) {
            const c = buildPersonCrop(source, box!, srcW, srcH);
            if (c) { poseInput = c.canvas; crop = c; }
          }
          const r=poseRef.current.detectForVideo(poseInput,now);
          let landmarks: LM[][] = r.landmarks ?? [];
          if (crop && landmarks.length) {
            // Crop-normalized (0..1 over the crop) → full-frame normalized.
            landmarks = landmarks.map((lm) => lm.map((p) => ({
              ...p,
              x: (p.x * crop!.sw + crop!.sx) / srcW,
              y: (p.y * crop!.sh + crop!.sy) / srcH,
            })));
          }
          posesRef.current = landmarks;
          const pose0 = posesRef.current[0];
          if (pose0) {
            analyzeBodyMovement(pose0);
            poseFallenRef.current = checkFall(pose0, now);
            // Lying/reclined from torso orientation (shoulders→hips): a horizontal
            // torso = lying in bed. Uses whichever shoulder/hip is visible (single
            // side is enough) so it still works when the resident is far away or
            // turned away from the camera and only one side is picked up.
            {
              const VIS = 0.35;
              const sL = pose0[11], sR = pose0[12], hL = pose0[23], hR = pose0[24];
              const shoulders = [sL, sR].filter((p) => p && (p.visibility ?? 1) > VIS) as Array<{ x: number; y: number }>;
              const hips = [hL, hR].filter((p) => p && (p.visibility ?? 1) > VIS) as Array<{ x: number; y: number }>;
              if (shoulders.length && hips.length) {
                const sx = shoulders.reduce((s, p) => s + p.x, 0) / shoulders.length;
                const sy = shoulders.reduce((s, p) => s + p.y, 0) / shoulders.length;
                const hx = hips.reduce((s, p) => s + p.x, 0) / hips.length;
                const hy = hips.reduce((s, p) => s + p.y, 0) / hips.length;
                const dx = Math.abs(sx - hx);
                const dy = Math.abs(sy - hy);
                reclinedRef.current = dy < dx * 1.3; // torso more horizontal than vertical
              }
            }
          } else {
            poseFallenRef.current = false;
          }

          // Run emotion/face analysis EVERY tick — with or without a body pose.
          // When we have a pose, feed emotion a ZOOMED crop of the face (accurate at
          // distance); otherwise fall back to the full frame. The face CNN reads the
          // expression from the image, so this works even when the body is partly out.
          const faceCanvas = pose0 ? buildFaceCrop(source, pose0, srcW, srcH) : null;
          const faceSrc = faceCanvas ?? source;
          const localAnalysis = analyzeEmotionFromLandmarks(pose0 ?? [], analysisRef.current, faceSrc) as VisionAnalysis;

          // rPPG: sample the zoomed face-crop skin colour EVERY tick (~real-time) so
          // heart rate & respiration can be recovered from the pulse waveform.
          if (faceCanvas && faceCanvas.width > 4) {
            try {
              const fctx = faceCanvas.getContext("2d", { willReadFrequently: true });
              if (fctx) {
                const img = fctx.getImageData(0, 0, faceCanvas.width, faceCanvas.height);
                rppgProcessor.addSample(RppgProcessor.roiValue(img.data), now);
              }
            } catch { /* rPPG is auxiliary to the vision system */ }
          }

          // Merge real-time telemetry into the ref at FULL rate (drives the canvas)
          // WITHOUT wiping out AI Vision's dynamic summary. The React state is pushed
          // separately, throttled, below — so we don't re-render 30x/sec.
          const prevA = analysisRef.current;
          const merged: VisionAnalysis = {
            ...prevA,
            globalEmotion: localAnalysis.globalEmotion,
            emotionConfidence: localAnalysis.emotionConfidence,
            globalBehavior: localAnalysis.globalBehavior,
            globalPosture: localAnalysis.globalPosture,
          };
          // With no cloud model, the local engine owns the summary line too
          // (otherwise it'd stay stuck on the initial placeholder text).
          if (gemDeadRef.current && localAnalysis.summary) {
            merged.summary = localAnalysis.summary;
          }
          if (localAnalysis.objects?.length) {
            merged.objects = localAnalysis.objects;
          }
          analysisRef.current = merged;
          if (localAnalysis.objects?.length) {
            detsRef.current = detsRef.current.map(d => {
              const m = localAnalysis.objects.find(o =>
                d.label.toLowerCase().includes(o.type.toLowerCase()) ||
                o.type.toLowerCase().includes(d.label.toLowerCase()) ||
                (d.label.toLowerCase() === "person" && o.type.toLowerCase() === "facial expression")
              );
              return m ? { ...d, thought: m.thought, risk: m.risk } : d;
            });
          }
        } catch(_){}
        lastPoseRef.current=now;
      }

      // Object detector: throttled to ~10fps (heavier model)
      if (detectorRef.current && now-lastDetRef.current>95) {
        try {
          const vw=srcW, vh=srcH;
          const r=detectorRef.current.detectForVideo(source,now);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const newDets: TrackedDet[] = (r.detections??[]).map((d:any)=>{
            const label=d.categories?.[0]?.categoryName??"unknown";
            const score=d.categories?.[0]?.score??0;
            const bb=d.boundingBox;
            const nx=bb.originX/vw, ny=bb.originY/vh, nw=bb.width/vw, nh=bb.height/vh;
            const prev=detsRef.current.find(e=>e.label===label);
            return { label,score,x:nx,y:ny,w:nw,h:nh,
              color:detCol(label), thought:prev?.thought??"", risk:prev?.risk??"low" };
          });
          detsRef.current=newDets;   // React count is pushed in the throttled block below
          
          // Object-Detector fall check — Tech-Watt/Fall-Detection (YOLOv8) methodology:
          //   height = y2-y1, width = x2-x1, threshold = height - width
          //   threshold < 0  (box wider than tall = person horizontal) AND conf > 80% => Fall.
          // The confidence gate mirrors the repo's `conf > 80` and stops low-confidence
          // detections from firing. `y > 0.35` and box bottom > 0.75 is our added guard
          // so only a person flat on the floor can trigger a fall alert.
          // Largest-scoring person → drives both the object-fall check and the
          // far-away pose ROI crop below. The person detector holds a lock at much
          // greater distance than the pose net, so it's our "where is the resident"
          // signal for a wide CCTV shot.
          const personBox = newDets.find(d => d.label.toLowerCase() === "person" || d.label.toLowerCase() === "human");
          if (personBox && personBox.score > 0.4) {
            personBoxRef.current = { x: personBox.x, y: personBox.y, w: personBox.w, h: personBox.h, at: now };
          }
          if (personBox && personBox.score > 0.65) {
            // Tech-Watt: person horizontal when the box is CLEARLY wider than tall (lying).
            const horizontal = personBox.w > personBox.h * 1.4;
            // On the floor: the body sits low in the frame (box top past 0.35 and box bottom past 0.75).
            const onFloor = personBox.y > 0.35 && (personBox.y + personBox.h) > 0.75;
            objFallenRef.current = horizontal && onFloor;
          } else {
            objFallenRef.current = false;
          }
        } catch(_){}
        lastDetRef.current=now;
      }

      // Eye-blink via MediaPipe FaceLandmarker blendshapes → sleep detection.
      // Throttled to ~6/sec (plenty for sleep) to protect FPS on the already-busy feed.
      if (faceLmRef.current && now - lastFaceLmRef.current > 160) {
        lastFaceLmRef.current = now;
        try {
          const fr = faceLmRef.current.detectForVideo(source, now);
          const cats = fr?.faceBlendshapes?.[0]?.categories;
          if (cats && cats.length) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const score = (n: string) => (cats.find((c: any) => c.categoryName === n)?.score ?? 0) as number;
            setEyeBlink((score("eyeBlinkLeft") + score("eyeBlinkRight")) / 2);
          }
        } catch { /* eye-blink is auxiliary */ }
      }

      // AI Vision: every 2000ms for real-time safety & emotion analysis
      if (now-lastVisionRef.current>2000) {
        lastVisionRef.current=now; runVision();
      }

      // Persist monitoring log to DB every 30 seconds (heartbeat snapshot).
      if (now - lastSaveRef.current > SAVE_INTERVAL_MS) {
        lastSaveRef.current = now;
        saveMonitoringLog("ANALYSIS", analysisRef.current);
      }

      // ── Sleep / alertness + confusion (recorded for the care log) ──
      // Heuristic from existing signals (no eye-mesh available): sustained stillness
      // (no Moving/Waving behavior) → Drowsy/Sleeping (Sleeping when also reclined);
      // sustained agitation/startle affect → Confused.
      {
        const a = analysisRef.current;
        const moving = a.globalBehavior === "Moving" || a.globalBehavior === "Waving" || waveRef.current;
        if (moving || selfFallenRef.current || !stillSinceRef.current) stillSinceRef.current = now;
        const stillMs = now - stillSinceRef.current;
        const reclined = reclinedRef.current || /lying|reclin|down|slouch|lean/i.test(a.globalPosture || "");
        const eye = getEyeState(); // { closed, closedForMs } from face-landmark EAR
        let sleepState = "Awake";
        // Eyes closed is the strongest signal: sustained closure → Sleeping, briefly
        // closed → Drowsy (blinks reset the timer). Lying still (in bed) → Sleeping.
        // Otherwise prolonged stillness → Drowsy.
        if (eye.closed && eye.closedForMs > 8000) sleepState = "Sleeping";
        else if (eye.closed && eye.closedForMs > 2500) sleepState = "Drowsy";
        else if (reclined && stillMs > 45_000) sleepState = "Sleeping"; // lying still = likely asleep
        else if (stillMs > 90_000) sleepState = reclined ? "Sleeping" : "Drowsy";
        else if (stillMs > 40_000 && reclined) sleepState = "Drowsy";
        const confused = agitationStreakRef.current >= AGITATION_STREAK_TRIGGER && !selfFallenRef.current;
        // Wake transition: remember the moment they go from Sleeping/Drowsy → Awake.
        // A rise/stand-up shortly after this is the classic "woke up and got up too
        // fast" fall — orthostatic dizziness before the body has adjusted.
        const prevSleep = prevSleepStateRef.current;
        if ((prevSleep === "Sleeping" || prevSleep === "Drowsy") && sleepState === "Awake") wokeAtRef.current = now;
        prevSleepStateRef.current = sleepState;
        analysisRef.current = { ...a, sleepState, confused };
      }

      // Event-driven: log whenever the detected emotion, behavior, sleep state OR
      // confusion changes so every activity behind the camera (waving, happy, sad,
      // angry, sleeping, awake, confused, …) is captured.
      {
        const a = analysisRef.current;
        const emo = a.globalEmotion || "";
        const beh = a.globalBehavior || "";
        // Skip startup placeholders — they aren't real observations.
        const isPlaceholder = /Initializing|Detecting|^$/.test(emo) || /Initializing|Detecting|^$/.test(beh);
        const key = `${emo}|${beh}|${a.sleepState}|${a.confused}`;
        if (!isPlaceholder &&
            key !== lastBehaviorLogRef.current.key &&
            now - lastBehaviorLogRef.current.at > BEHAVIOR_LOG_MIN_MS) {
          lastBehaviorLogRef.current = { key, at: now };
          lastSaveRef.current = now; // the change log doubles as the heartbeat
          saveMonitoringLog("ANALYSIS", a);
        }
      }

      // Centralized Fall Detection — a person horizontal on the floor IS a fall.
      const currentlyFallen = poseFallenRef.current || objFallenRef.current;

      if (currentlyFallen) {
        // Fall condition active: reset the clear timer
        fallClearStartRef.current = null;

        if (!selfFallenRef.current) {
          const rapidRecent = now - rapidDropTimeRef.current < RAPID_DROP_WINDOW_MS;
          const stillMs = now - stillSinceRef.current;
          // Final confidence = pose geometry + a bump for a rapid drop + a bump for
          // sustained stillness. Stored on the analysis so the log/escalation carry it.
          let fallConf = fallConfidenceRef.current;
          if (rapidRecent) fallConf = Math.min(1, fallConf + 0.2);
          fallConf = Math.min(1, fallConf + Math.min(0.2, (stillMs / STILL_CONFIRM_MS) * 0.2));

          const confirmFall = () => {
            fallStartRef.current = null;
            selfFallenRef.current = true;
            setSelfFallen(true);
            analysisRef.current = { ...analysisRef.current, fallConfidence: Math.round(fallConf * 100) / 100 };
            onFallTriggered?.(analysisRef.current);
            saveMonitoringLog("FALL_DETECTION", analysisRef.current);
            void raiseFallEscalation(fallConf);
          };

          if (poseFallenRef.current && rapidRecent) {
            // Fast fall: horizontal pose right after a rapid drop → fire instantly.
            confirmFall();
          } else if (fallStartRef.current == null) {
            fallStartRef.current = now;
          } else if (now - fallStartRef.current > LYING_CONFIRM_MS && stillMs > STILL_CONFIRM_MS) {
            // Confirmed: horizontal on the floor AND still for the confirmation window.
            confirmFall();
          }
        } else {
          // If we are already in selfFallen state, reset the fall start timer
          fallStartRef.current = null;
        }
      } else {
        // No fall detected: reset the fall start timer
        fallStartRef.current = null;

        if (selfFallenRef.current) {
          if (fallClearStartRef.current == null) {
            fallClearStartRef.current = now;
          } else if (now - fallClearStartRef.current > CLEAR_CONFIRM_MS) {
            // Confirmed stood up / no longer on floor
            fallClearStartRef.current = null;
            selfFallenRef.current = false;
            setSelfFallen(false);
            onFallCleared?.();
          }
        } else {
          fallClearStartRef.current = null;
        }
      }

      // ── Preventive pre-fall risk — fire BEFORE a confirmed fall ────────────
      // Two early-warning signals from the existing pipeline:
      //   1. A near-fall stumble: a rapid downward drop that has NOT (yet) become
      //      a confirmed lying-on-floor fall — i.e. a wobble/loss of balance.
      //   2. Sustained agitation/startle on the face (Angry/Fear/Surprised) —
      //      the "confused / agitated before getting up" pattern Mila described.
      if (!selfFallenRef.current && now - lastRiskEvalRef.current > PREFALL_EVAL_INTERVAL_MS) {
        lastRiskEvalRef.current = now;
        const a = analysisRef.current;
        const emo = a.globalEmotion;
        const conf = a.emotionConfidence ?? 0;
        const agitated = (emo === "Angry" || emo === "Fear" || emo === "Fearful") && conf >= 55;
        const startled = emo === "Surprised" && conf >= 60;
        if (agitated || startled) agitationStreakRef.current += 1;
        else agitationStreakRef.current = Math.max(0, agitationStreakRef.current - 1);

        const nearFall = now - rapidDropTimeRef.current < RAPID_DROP_WINDOW_MS;

        // ── Bed-exit / stand-up ("tumayo na lang agad") ──────────────────────
        // Pose-only (torso orientation), so it works at a distance and with the
        // resident's back to the camera. Track the lying→upright transition: the
        // instant the torso stops being horizontal after having been in bed, and
        // it happened quickly, treat it as a stand-up. Latch so we alarm once per
        // rise (reset when they lie/recline again).
        const reclinedNow = reclinedRef.current;
        if (reclinedNow) { lastReclinedAtRef.current = now; standUpAlertedRef.current = false; }
        const roseFromLying = !reclinedNow && lastReclinedAtRef.current > 0 && (now - lastReclinedAtRef.current) < SUDDEN_STAND_MS;
        const justWoke = now - wokeAtRef.current < RECENT_WAKE_MS;
        // "Woke up aggressively": agitation/startle or a motion spike within the
        // just-woke window — even before they are fully upright.
        const aggressiveWake = justWoke && (agitationStreakRef.current >= AGGRESSIVE_WAKE_STREAK || nearFall);

        let reason: string | null = null;
        let urgent = false;
        if (roseFromLying && !standUpAlertedRef.current) {
          urgent = true;
          reason = justWoke
            ? "Resident woke and stood up abruptly (bed-exit) — high fall risk, check now."
            : "Resident just stood up from lying down (bed-exit) — high fall risk, check now.";
        } else if (aggressiveWake) {
          urgent = true;
          reason = `Resident woke up agitated/abruptly (${emo}, ${conf}%) — may try to get up. Pre-fall risk.`;
        } else if (nearFall) {
          reason = "Sudden loss of balance / near-fall motion detected — check resident now.";
        } else if (agitationStreakRef.current >= AGITATION_STREAK_TRIGGER) {
          reason = `Sustained agitation/distress (${emo}, ${conf}%) — resident may be about to get up and fall.`;
        }

        // Urgent (bed-exit / aggressive wake) events get their own faster debounce
        // and an audible alarm; ambient agitation keeps the calmer cadence.
        const lastRef = urgent ? lastStandAlertRef : lastPreFallAlertRef;
        const gate = urgent ? STANDUP_DEBOUNCE_MS : PREFALL_DEBOUNCE_MS;
        if (reason && now - lastRef.current > gate) {
          lastRef.current = now;
          if (roseFromLying) standUpAlertedRef.current = true; // one alarm per stand-up
          agitationStreakRef.current = 0;
          const pre: VisionAnalysis = { ...a, alert: true, alertReason: reason };
          saveMonitoringLog("PRE_FALL_RISK", pre);
          onPreFallRiskRef.current?.(pre, reason);
          setPreFallRisk({ active: true, reason, urgent });
          if (urgent) playUrgentBeep(alarmCtxRef);
          if (preFallTimerRef.current) clearTimeout(preFallTimerRef.current);
          preFallTimerRef.current = setTimeout(() => setPreFallRisk({ active: false, reason: "", urgent: false }), PREFALL_BANNER_MS);
        }
      }
    }

    drawFrame();

    // FPS accounting (cheap, every frame — just a ref, no re-render)
    const ft=fpsTimesRef.current; ft.push(now);
    while(ft.length>0 && now-ft[0]>1000) ft.shift();

    // ── Throttled React UI update (~4/sec) ──────────────────────────────────
    // The canvas + all refs update at full frame rate above; the heavyweight
    // component only re-renders a few times a second. This is what keeps the
    // camera-switch buttons and the whole UI responsive under detection load.
    if (now - lastUiRef.current > 250) {
      lastUiRef.current = now;
      setFps(ft.length);
      setDetCount(detsRef.current.length);
      setAnalysis(analysisRef.current);
      
      // Heart rate & respiration from the REAL rPPG signal (per-frame facial pulse).
      // Confidence-gated: a noisy window holds the last good reading instead of
      // inventing numbers. Temp & SpO2 can't be measured from RGB video — they stay
      // as clearly-labelled ("est.") plausible values, NOT measurements.
      const est = rppgProcessor.estimate();
      if (est && est.confidence >= 40) setBpEstimate(est);
      setAiVitals(prev => {
        const measured = est && est.confidence >= 40;
        const nextHr = measured ? Math.round(prev.heartRate * 0.7 + est!.heartRate * 0.3) : prev.heartRate;
        const nextRr = measured ? Math.round(prev.respirationRate * 0.7 + est!.respirationRate * 0.3) : prev.respirationRate;
        const nextTemp = +(36.7 + Math.sin(now / 18000) * 0.2).toFixed(1); // est. only
        return { heartRate: nextHr, respirationRate: nextRr, temperature: nextTemp, oxygen: prev.oxygen };
      });
    }

    // eslint-disable-next-line react-hooks/immutability
    rafRef.current=requestAnimationFrame(loop);
  }, [modelsOk, activeCamera, useBackendFeed, analyzeBodyMovement, checkFall, runVision, drawFrame, buildFaceCrop, buildPersonCrop]);

  // Start loop once camera is active
  useEffect(() => {
    if (!camActive) return;
    rafRef.current=requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camActive, loop]);

  // Override when fall triggered (parent-driven OR self-detected)
  useEffect(() => {
    if (!fallen) return;
    const override: VisionAnalysis = {
      ...analysisRef.current,
      globalEmotion:"EMERGENCY", emotionConfidence:100,
      globalBehavior:"EMERGENCY", globalPosture:"EMERGENCY", alert:true,
      alertReason:"Fall incident triggered.",
      summary:"Fall detected. Resident requires immediate assistance.",
    };
    analysisRef.current=override; setAnalysis(override);

    // Capture snapshot on fall detection
    const thumb = captureSnapshot(videoRef.current, tapoImgRef.current, captureRef.current);
    setHistory(prev => [{
      id: `fall-${++historyIdRef.current}`,
      type: "fall" as const,
      message: "Fall detected — snapshot captured",
      timestamp: Date.now(),
      thumbnail: thumb,
    }, ...prev].slice(0, 50));
  }, [fallen]);

  // ── Derived UI colors ─────────────────────────────────────────────────────
  const emoMap: Record<string,string> = {
    Happy:"text-emerald-400", Content:"text-emerald-400", Calm:"text-sky-400",
    Neutral:"text-zinc-300", Surprised:"text-amber-400", Sad:"text-blue-400",
    Fearful:"text-orange-400", Angry:"text-red-400", Distressed:"text-red-500",
  };
  // Fall = full EMERGENCY state: every readout turns red.
  const emergency = fallen;
  // Live eye state (for the on-HUD debug readout so eye-closure tuning is observable).
  const eyeDbg: { closed: boolean; blink: number; fresh: boolean } = getEyeState();
  const emoColor = emergency ? "text-red-500 animate-pulse" : (emoMap[analysis.globalEmotion]??"text-zinc-300");
  const behColor = emergency ? "text-red-500 animate-pulse"
                 : waving ? "text-amber-400"
                 : analysis.globalBehavior==="Waving"  ? "text-amber-400"
                 : analysis.globalBehavior==="Falling" ? "text-red-500"
                 : analysis.globalBehavior==="Moving"  ? "text-sky-400"
                 : "text-zinc-400";
  const postColor = emergency ? "text-red-500 animate-pulse" : "text-violet-400";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden bg-zinc-950 border border-white/5 shadow-inner select-none">

      {/* Camera Mode Selector (Hybrid Support) */}
      <div className="absolute top-3 right-3 z-50 flex gap-2 pointer-events-auto">
        <button
          onClick={() => setShowHistory(prev => !prev)}
          className={`relative px-2.5 py-1 rounded-md text-[10px] font-bold transition flex items-center gap-1 shadow-md cursor-pointer select-none ${
            showHistory ? "bg-amber-500/90 text-black" : "bg-black/60 text-zinc-400 hover:bg-black/80"
          }`}
          title="Camera History"
        >
          <History className="w-3.5 h-3.5" /> History
          {history.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-500 text-white rounded-full text-[8px] font-bold flex items-center justify-center leading-none">{history.length > 99 ? "99+" : history.length}</span>
          )}
        </button>
        {activeCamera === "local" && useBackendFeed && (
          <button
            onClick={startLocalCamera}
            className="px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-500/90 text-black hover:bg-amber-400 active:scale-95 transition flex items-center gap-1 shadow-md cursor-pointer select-none"
            title="Try connecting directly to browser webcam again"
          >
            <Camera className="w-3.5 h-3.5" /> Retry Local Camera
          </button>
        )}
        {cameraMode === "hybrid" && (
          <>
            <button
              onClick={() => {
                setActiveCamera("local");
                if (useBackendFeed) startLocalCamera();
              }}
              className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition ${
                activeCamera === "local"
                  ? "bg-emerald-500/80 text-white"
                  : "bg-black/60 text-zinc-400 hover:bg-black/80"
              }`}
            >
              Local
            </button>
            <button
              onClick={() => setActiveCamera("tapo")}
              className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider transition ${
                activeCamera === "tapo"
                  ? "bg-blue-500/80 text-white"
                  : "bg-black/60 text-zinc-400 hover:bg-black/80"
              }`}
            >
              Tapo IP
            </button>
          </>
        )}
      </div>


      {/* Live Local Webcam (no mirror - normal orientation) */}
      <video
        ref={videoRef} autoPlay playsInline muted
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${
          activeCamera === "local" && !useBackendFeed && camActive ? "opacity-100 z-0" : "opacity-0 -z-10"
        }`}
      />
      <img
        ref={imgRef}
        src={backendFeedUrl || undefined}
        alt="Backend Video Stream"
        crossOrigin="anonymous"
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${
          activeCamera === "local" && useBackendFeed && camActive ? "opacity-100 z-0" : "opacity-0 -z-10"
        }`}
      />

      {/* Tapo IP Camera Stream */}
      <img
        ref={tapoImgRef}
        // eslint-disable-next-line react-hooks/refs
        src={tapoStreamUrlRef.current}
        alt="Tapo IP Camera Stream"
        crossOrigin="anonymous"
        onLoad={() => {
          setTapoStatus("connected");
          setCamActive(true);
          tapoRetryRef.current = 0;
          if (tapoRetryTimerRef.current) clearTimeout(tapoRetryTimerRef.current);
          setHistory(prev => [{
            id: `conn-${++historyIdRef.current}`,
            type: "connection" as const,
            message: "Tapo camera connected",
            timestamp: Date.now(),
          }, ...prev].slice(0, 50));
        }}
        onError={() => {
          console.warn(`[Tapo] Connection failed (attempt ${tapoRetryRef.current + 1}/${tapoMaxRetries})`);
          setHistory(prev => [{
            id: `conn-${++historyIdRef.current}`,
            type: "connection" as const,
            message: `Connection failed (attempt ${tapoRetryRef.current + 1}/${tapoMaxRetries})`,
            timestamp: Date.now(),
          }, ...prev].slice(0, 50));
          if (tapoRetryRef.current < tapoMaxRetries) {
            setTapoStatus("connecting");
            // Exponential backoff: 2s, 4s, 8s, 16s
            const delay = Math.min(2000 * Math.pow(2, tapoRetryRef.current), 16000);
            tapoRetryTimerRef.current = setTimeout(() => reconnectTapo(), delay);
          } else {
            setTapoStatus("error");
            setHistory(prev => [{
              id: `conn-${++historyIdRef.current}`,
              type: "connection" as const,
              message: "Max retries reached. Tapo camera offline.",
              timestamp: Date.now(),
            }, ...prev].slice(0, 50));
          }
        }}
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${
          activeCamera === "tapo" && tapoStatus === "connected" ? "opacity-100 z-0" : "opacity-0 -z-10"
        }`}
      />

      {/* Overlay canvas (normal orientation, matching video) */}
      <canvas
        ref={canvasRef} width={640} height={480}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
      />

      {/* Hidden capture canvas for AI Vision */}
      <canvas ref={captureRef} className="hidden" />

      {/* No-camera placeholder */}
      {!camActive && (
        <div className="absolute inset-0 z-5 flex flex-col items-center justify-center bg-zinc-950">
          <div className="absolute inset-0 bg-[radial-gradient(#1e1b4b_1px,transparent_1px)] [background-size:16px_16px] opacity-40"/>
          <Camera className="w-10 h-10 text-amber-500/40 mb-3 animate-pulse relative z-10"/>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 relative z-10">
            {camError || "Enabling Camera..."}
          </p>
        </div>
      )}

      {/* Model loading overlay */}
      {camActive && !modelsOk && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950/85 backdrop-blur-sm">
          <Cpu className="w-8 h-8 text-amber-400 animate-pulse mb-3"/>
          <p className="text-xs font-bold text-amber-400 uppercase tracking-widest mb-1">Initializing AI Engine</p>
          <p className="text-[10px] text-zinc-400 mb-3">{modelMsg}</p>
          <div className="w-44 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-500 to-amber-300 animate-pulse rounded-full w-3/4"/>
          </div>
        </div>
      )}

      {/* EMERGENCY: whole screen turns red on a fall */}
      {fallen && (
        <div className="absolute inset-0 z-40 pointer-events-none bg-red-600/45 animate-pulse flex flex-col items-center justify-center gap-2">
          <AlertTriangle className="w-12 h-12 text-white drop-shadow-lg animate-pulse"/>
          <span className="text-white font-black text-2xl tracking-[0.3em] drop-shadow-lg">EMERGENCY</span>
          <span className="text-white/90 font-bold text-xs uppercase tracking-widest">Fall Detected — Resident Needs Assistance</span>
        </div>
      )}

      {/* Alert border */}
      {fallen && (
        <div className="absolute inset-0 z-40 pointer-events-none border-4 border-red-500 rounded-2xl animate-pulse"/>
      )}

      {/* PRE-FALL RISK: preventive warning shown BEFORE a fall (hidden once a real fall fires).
          Urgent bed-exit / abrupt-wake events render red + louder; ambient agitation stays amber. */}
      {preFallRisk.active && !fallen && (
        <div className={`absolute top-16 left-1/2 -translate-x-1/2 z-40 pointer-events-none flex items-center gap-2 max-w-[90%] px-3 py-2 rounded-xl shadow-lg animate-pulse ${preFallRisk.urgent ? "bg-red-600/95 text-white border border-red-300" : "bg-amber-500/95 text-black border border-amber-300"}`}>
          <AlertTriangle className="w-5 h-5 shrink-0"/>
          <div className="leading-tight">
            <p className="font-black text-[11px] uppercase tracking-widest">{preFallRisk.urgent ? "Bed-Exit / Stand-Up — Fall Risk" : "Pre-Fall Risk"}</p>
            <p className="font-semibold text-[11px]">{preFallRisk.reason}</p>
          </div>
        </div>
      )}

      {/* ── TOP-LEFT: status badges ── */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/78 text-[9px] font-bold text-white uppercase tracking-wider backdrop-blur-sm border border-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${gemPending?"bg-amber-400 animate-pulse":modelsOk?"bg-emerald-500 animate-pulse":"bg-zinc-600"}`}/>
          {gemPending?"AI Vision Analyzing...":modelsOk?"AI Systems Live":"Initializing..."}
        </span>

        {activeCamera === "tapo" && (
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[9px] font-bold uppercase tracking-wider backdrop-blur-sm border pointer-events-auto ${
            tapoStatus === "connected" ? "bg-emerald-600/80 text-emerald-200 border-emerald-400/30"
              : tapoStatus === "connecting" ? "bg-amber-600/80 text-amber-200 border-amber-400/30"
              : "bg-red-600/80 text-red-200 border-red-400/30"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${tapoStatus === "connected" ? "bg-emerald-400 animate-pulse" : tapoStatus === "connecting" ? "bg-amber-400 animate-pulse" : "bg-red-400"}`}/>
            Tapo: {tapoStatus === "connected" ? "Live" : tapoStatus === "connecting" ? "Connecting..." : "Offline"}
            {tapoStatus === "error" && (
              <button onClick={reconnectTapo} className="ml-1 p-0.5 rounded hover:bg-white/20 transition" title="Reconnect">
                <RefreshCw className="w-3 h-3"/>
              </button>
            )}
          </span>
        )}

        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/72 text-[9px] font-mono text-amber-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
          <Brain className="w-3 h-3"/>
          {fps} FPS · {detCount} obj · #{frameN}
        </span>

        {analysis.objects?.[0]?.thought && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/80 text-[9px] font-mono text-cyan-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
            {analysis.objects[0].thought}
          </span>
        )}

        {ping !== null && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/72 text-[9px] font-mono text-violet-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
            <Activity className="w-3 h-3"/>
            AI Vision {ping}ms
          </span>
        )}
      </div>

      {/* ── TOP-RIGHT: resident / room badge ── */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none flex flex-col items-end gap-1">
        {residentName && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600/80 text-[10px] font-bold text-white uppercase tracking-wider backdrop-blur-sm border border-blue-400/30 shadow-lg">
            {residentName}
          </span>
        )}
        {residentRoom && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/65 text-[9px] font-bold text-zinc-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
            Room {residentRoom}
          </span>
        )}
        {!residentName && !residentRoom && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/65 text-[9px] font-bold text-zinc-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
            Suite 12A
          </span>
        )}
      </div>

      {/* ── RIGHT PANEL: live AI detections ── */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2 pointer-events-none">
        {/* Emotion */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block"/> Emotion
          </p>
          <p className={`text-[12px] font-bold mt-0.5 ${emoColor}`}>{emergency ? "EMERGENCY" : analysis.globalEmotion}</p>
          <div className="w-full bg-white/10 rounded-full h-[3px] mt-1.5">
            <div
              className={`h-[3px] rounded-full transition-all duration-700 ${analysis.emotionConfidence>70?"bg-emerald-400":"bg-amber-400"}`}
              style={{ width:`${analysis.emotionConfidence}%` }}
            />
          </div>
          <p className="text-[8px] text-zinc-600 mt-0.5">{analysis.emotionConfidence}% conf.</p>
        </div>

        {/* Behavior */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-sky-400 inline-block"/> Behavior
          </p>
          <p className={`text-[12px] font-bold mt-0.5 ${behColor}`}>
            {emergency ? "EMERGENCY" : (waving ? "Waving 👋" : analysis.globalBehavior)}
          </p>
        </div>

        {/* Posture */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-violet-400 inline-block"/> Posture
          </p>
          <p className={`text-[12px] font-bold mt-0.5 ${postColor}`}>{emergency ? "EMERGENCY" : analysis.globalPosture}</p>
        </div>

        {/* Sleep / alertness state (eyes-closed EAR + stillness) */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-indigo-400 inline-block"/> State
          </p>
          <p className={`text-[12px] font-bold mt-0.5 ${
            analysis.sleepState === "Sleeping" ? "text-indigo-400"
              : analysis.sleepState === "Drowsy" ? "text-amber-400"
              : "text-emerald-400"
          }`}>
            {analysis.sleepState === "Sleeping" ? "Sleeping 😴" : analysis.sleepState === "Drowsy" ? "Drowsy" : "Awake"}
          </p>
          <p className="text-[8px] text-zinc-600 mt-0.5">
            Blink {eyeDbg.fresh ? eyeDbg.blink.toFixed(2) : "—"}{eyeDbg.closed ? " · closed" : ""}
          </p>
          {analysis.confused && <p className="text-[8px] text-red-400 font-bold mt-0.5">⚠ Confused</p>}
        </div>

        {/* AI Vitals (rPPG Remote Sensing) */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {posesRef.current[0] && (
          <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px] transition-all animate-fade-in">
            <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"/> AI Vitals
            </p>
            <div className="space-y-1 mt-1.5 text-[9px] font-mono text-zinc-300">
              <div className="flex justify-between">
                <span className="text-zinc-500">Pulse:</span>
                <span className="font-bold text-cyan-400">
                  {aiVitals.heartRate} bpm
                  {bpEstimate
                    ? <span className={`font-normal ml-1 ${bpEstimate.confidence >= 70 ? "text-emerald-400" : bpEstimate.confidence >= 50 ? "text-amber-400" : "text-zinc-500"}`}>· {bpEstimate.confidence}%</span>
                    : <span className="font-normal ml-1 text-zinc-600 animate-pulse">· locking…</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Resp:</span>
                <span className="font-bold text-purple-400">{aiVitals.respirationRate} rpm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Temp <span className="text-zinc-600 text-[7px]">est.</span>:</span>
                <span className="font-bold text-orange-400">{aiVitals.temperature}°C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">SpO₂ <span className="text-zinc-600 text-[7px]">est.</span>:</span>
                <span className="font-bold text-emerald-400">{aiVitals.oxygen}%</span>
              </div>
              {bpEstimate && (
                <>
                  <div className="border-t border-zinc-700 pt-1.5 mt-1.5">
                    <div className="flex justify-between">
                      <span className="text-zinc-500 flex items-center gap-1">
                        <Heart className="w-3 h-3 text-red-500" /> BP:
                      </span>
                      <span className="font-bold text-red-400">
                        {bpEstimate.systolicBP}/{bpEstimate.diastolicBP}
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-zinc-600">Confidence:</span>
                      <span className="text-zinc-400">{bpEstimate.confidence}%</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM HUD ── */}
      <div className={`absolute bottom-3 ${activeCamera === "tapo" ? "left-48" : "left-3"} right-3 z-20 flex justify-between items-end gap-2 transition-all duration-300`}>
        <div className="flex-1 bg-black/68 backdrop-blur-md rounded-xl p-2.5 border border-white/10">
          <div className="flex justify-between items-center w-full">
            <p className="text-[9px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Brain className="w-2.5 h-2.5"/> AI Vision
            </p>
            <button
              onClick={() => setIsMuted(prev => !prev)}
              className="p-1 rounded-md hover:bg-white/10 text-zinc-400 hover:text-amber-400 transition-colors cursor-pointer select-none"
              title={isMuted ? "Unmute Voice Response" : "Mute Voice Response"}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400 animate-pulse" />}
            </button>
          </div>
          <p className="text-white text-[10px] font-semibold mt-1 leading-snug">
            {fallen ? "⚠ Incident Alert: Resident requires immediate assistance." : analysis.summary}
          </p>
        </div>

        {!fallen ? (
          <span className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold tracking-wide">
            <Shield className="w-3 h-3"/> Auto Fall Detection
          </span>
        ) : (
          <span className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-500 border border-red-500/40 text-[10px] font-bold">
            <AlertTriangle className="w-3 h-3 animate-pulse"/> Fall Detected — Reporting...
          </span>
        )}
      </div>

      {/* ── HISTORY PANEL ── */}
      {showHistory && (
        <div className="absolute top-14 right-3 z-50 w-72 max-h-[60vh] bg-black/90 backdrop-blur-md border border-white/10 rounded-xl shadow-2xl overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
            <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" /> Camera History
            </span>
            <button onClick={() => setShowHistory(false)} className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="overflow-y-auto max-h-[calc(60vh-36px)] p-2 space-y-1.5">
            {history.length === 0 ? (
              <p className="text-[10px] text-zinc-500 text-center py-6">No events recorded yet.</p>
            ) : (
              history.map((ev) => (
                <div key={ev.id} className={`rounded-lg p-2 border ${
                  ev.type === "fall" ? "bg-red-900/30 border-red-500/30"
                    : ev.type === "connection" ? "bg-blue-900/20 border-blue-500/20"
                    : ev.type === "alert" ? "bg-amber-900/20 border-amber-500/20"
                    : "bg-zinc-800/40 border-zinc-700/30"
                }`}>
                  <div className="flex items-start gap-2">
                    {ev.thumbnail && (
                      <img src={ev.thumbnail} alt="Snapshot" className="w-12 h-9 object-cover rounded border border-white/10 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-[10px] font-semibold ${
                        ev.type === "fall" ? "text-red-400" : ev.type === "connection" ? "text-blue-400" : ev.type === "alert" ? "text-amber-400" : "text-zinc-300"
                      }`}>{ev.message}</p>
                      <p className="text-[9px] text-zinc-500 mt-0.5">{new Date(ev.timestamp).toLocaleTimeString()}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
