"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, AlertTriangle, Activity, Shield, Brain, Cpu, Volume2, VolumeX } from "lucide-react";
import { analyzeEmotionFromLandmarks, loadFaceAPI } from "@/utils/emotionDetector";

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
  alert: boolean;
  alertReason: string | null;
  summary: string;
  objects: Array<{ type: string; thought: string; risk: "low" | "medium" | "high" }>;
}

interface Props {
  isFallen?: boolean;
  onFallTriggered?: (analysis: VisionAnalysis) => void;
  onFallCleared?: () => void;
  cameraMode?: "local" | "tapo" | "hybrid";
  residentName?: string;
  residentRoom?: string;
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

const INIT: VisionAnalysis = {
  globalEmotion:"Neutral", emotionConfidence:0, globalBehavior:"Initializing",
  globalPosture:"Detecting", alert:false, alertReason:null,
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
  if (process.env.NEXT_PUBLIC_BACKEND_API_URL) {
    return process.env.NEXT_PUBLIC_BACKEND_API_URL;
  }
  // Fall back to local backend so Vercel can stream the local Tapo RTSP feed
  return "http://localhost:8000";
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraVisionFeed({ isFallen, onFallTriggered, onFallCleared, cameraMode = "hybrid", residentName, residentRoom }: Props) {
  // Camera Mode State (Local | Tapo IP | Hybrid)
  const [activeCamera, setActiveCamera] = useState<"local" | "tapo">(
    cameraMode === "tapo" ? "tapo" : "local"
  );
  const [tapoStatus, setTapoStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [tapoPan, setTapoPan] = useState(0);   // horizontal position (-100 to 100)
  const [tapoTilt, setTapoTilt] = useState(0); // vertical position (-100 to 100)
  const [keysPressed, setKeysPressed] = useState<Set<string>>(new Set());
  const [aiVitals, setAiVitals] = useState({
    heartRate: 72,
    respirationRate: 16,
    temperature: 36.8,
    oxygen: 98,
  });

  // DOM refs
  const videoRef   = useRef<HTMLVideoElement|null>(null);
  const imgRef     = useRef<HTMLImageElement|null>(null);
  const canvasRef  = useRef<HTMLCanvasElement|null>(null);
  const captureRef = useRef<HTMLCanvasElement|null>(null);
  const faceCropRef = useRef<HTMLCanvasElement|null>(null); // offscreen zoom-crop of the face for accurate emotion
  const tapoVideoRef = useRef<HTMLVideoElement|null>(null);
  const tapoImgRef = useRef<HTMLImageElement|null>(null);

  // Model refs
  const poseRef     = useRef<any>(null);
  const handRef     = useRef<any>(null);
  const detectorRef = useRef<any>(null);
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
  const startRef      = useRef(Date.now());

  // Live data refs (read by 60fps draw loop, written by inference)
  const posesRef    = useRef<LM[][]>([]);
  const handsRef    = useRef<LM[][]>([]);
  const detsRef     = useRef<TrackedDet[]>([]);
  const analysisRef = useRef<VisionAnalysis>(INIT);
  const waveRef     = useRef(false);
  const gemBusyRef  = useRef(false);
  const gemDeadRef  = useRef(false);  // set once the API key is confirmed dead -> stop wasteful cloud calls

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

  // FPS
  const fpsTimesRef = useRef<number[]>([]);

  // React UI state
  const [selfFallen, setSelfFallen] = useState(false); // drives the EMERGENCY render when this component detects a fall itself
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
      setIsMuted(false);
    }
  }, []);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSpokenRef = useRef<string>("");

  // Tapo PTZ Control Handler
  const moveTapoCamera = useCallback(async (pan: number, tilt: number) => {
    // Clamp to valid range
    const clampedPan = Math.max(-100, Math.min(100, pan));
    const clampedTilt = Math.max(-100, Math.min(100, tilt));

    setTapoPan(clampedPan);
    setTapoTilt(clampedTilt);

    // Send to Tapo PTZ endpoint
    try {
      await fetch("/api/tapo-ptz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pan: clampedPan,
          tilt: clampedTilt,
        }),
      }).catch(() => {}); // Demo mode: just updates state, ignore any errors
    } catch (_) {}
  }, []);

  // Keyboard controls for ASWD
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        setKeysPressed((prev) => new Set([...prev, key]));
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) {
        setKeysPressed((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // Process continuous movement from held keys
  useEffect(() => {
    let newPan = tapoPan;
    let newTilt = tapoTilt;

    const interval = setInterval(async () => {
      if (keysPressed.size === 0) return;

      if (keysPressed.has("a")) newPan -= 5;  // Pan left
      if (keysPressed.has("d")) newPan += 5;  // Pan right
      if (keysPressed.has("w")) newTilt -= 5; // Tilt up
      if (keysPressed.has("s")) newTilt += 5; // Tilt down

      newPan = Math.max(-100, Math.min(100, newPan));
      newTilt = Math.max(-100, Math.min(100, newTilt));

      setTapoPan(newPan);
      setTapoTilt(newTilt);

      // Send PTZ command to API
      if (activeCamera === "tapo") {
        await moveTapoCamera(newPan, newTilt);
      }
    }, 50); // 50ms = smooth 20fps movement

    return () => clearInterval(interval);
  }, [keysPressed, activeCamera, moveTapoCamera, tapoPan, tapoTilt]);

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

  // Tapo IP Camera Connection
  // Uses backend MJPEG feed which transcodes the Tapo RTSP stream
  useEffect(() => {
    if (activeCamera !== "tapo" || !tapoVideoRef.current) return;

    const tapoIp = process.env.NEXT_PUBLIC_TAPO_CAMERA_IP || "192.168.1.36";
    const tapoPort = process.env.NEXT_PUBLIC_TAPO_CAMERA_PORT || "554";
    const tapoUser = process.env.NEXT_PUBLIC_TAPO_CAMERA_USERNAME || "";
    const tapoPass = process.env.NEXT_PUBLIC_TAPO_CAMERA_PASSWORD || "";
    const streamQuality = process.env.NEXT_PUBLIC_TAPO_STREAM || "stream1";

    // Backend MJPEG endpoint that transcodes Tapo RTSP stream
    const backendBaseUrl = getBackendUrl();
    const mjpegUrl = `${backendBaseUrl}/api/v1/camera/tapo?ip=${tapoIp}&port=${tapoPort}&user=${encodeURIComponent(tapoUser)}&pass=${encodeURIComponent(tapoPass)}&stream=${streamQuality}`;

    console.log("[Tapo] Connecting to Tapo camera:", tapoIp, "via backend MJPEG...");
    setTapoStatus("connecting");

    if (tapoVideoRef.current) {
      tapoVideoRef.current.src = mjpegUrl;
      tapoVideoRef.current.onloadstart = () => {
        console.log("[Tapo] MJPEG stream loading...");
        setTapoStatus("connecting");
      };
      tapoVideoRef.current.oncanplay = () => {
        console.log("[Tapo] MJPEG stream connected!");
        setTapoStatus("connected");
      };
      tapoVideoRef.current.onerror = (err) => {
        console.warn("[Tapo] MJPEG connection failed, fallback to local:", err);
        setTapoStatus("error");
        setTimeout(() => {
          console.log("[Tapo] Switching to local camera...");
          setActiveCamera("local");
        }, 2000);
      };

      tapoVideoRef.current.play().catch((e) => {
        console.error("[Tapo] Play error:", e.message);
        setTapoStatus("error");
        setTimeout(() => setActiveCamera("local"), 2000);
      });
    }

    return () => {
      if (tapoVideoRef.current) {
        tapoVideoRef.current.src = "";
        tapoVideoRef.current.pause();
      }
    };
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

  // ── Init MediaPipe models ─────────────────────────────────────────────────
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setModelMsg("Loading MediaPipe runtime...");
        const mpv = await import("@mediapipe/tasks-vision");
        const { PoseLandmarker, HandLandmarker, ObjectDetector, FilesetResolver } = mpv;

        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        if (dead) return;

        setModelMsg("Loading Pose AI (wave & behavior detection)...");
        poseRef.current = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:"https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate:"GPU",
          },
          runningMode:"VIDEO", numPoses:2,
        });
        if (dead) return;

        setModelMsg("Loading Object Detector (EfficientDet-Lite2)...");
        detectorRef.current = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            // Lite2 is a notably larger/more-accurate COCO detector than Lite0 —
            // much better at small objects (cup, cell phone) at camera distance.
            modelAssetPath:"https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite",
            delegate:"GPU",
          },
          // LOWER threshold = keep more true detections. 0.55 was silently dropping
          // valid cup/phone hits (~0.4–0.5 confidence) before they were ever drawn.
          scoreThreshold:0.4,
          maxResults:12,
          runningMode:"VIDEO",
        });
        if (dead) return;

        setModelsOk(true);
        setModelMsg("All systems online ✓");
      } catch (e: any) {
        setModelMsg(`Model error: ${e?.message ?? "failed"}`);
      }
    })();
    return () => { dead = true; };
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
    } catch (e: any) {
      console.warn("Local camera blocked or insecure context. Falling back to FastAPI backend feed:", e);
      setCamError(e?.message ?? "Device in use");
      const backendBaseUrl = getBackendUrl();
      setBackendFeedUrl(`${backendBaseUrl}/api/v1/camera/feed`);
      setUseBackendFeed(true);
      setCamActive(true);
    }
  }, []);

  useEffect(() => {
    loadFaceAPI();
    startLocalCamera();
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [startLocalCamera]);

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
      let visibleXs: number[] = [], visibleYs: number[] = [];
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

      if (isSideways || isHorizontalShape) return true;
      return false;
    }
    
    if (!hipVisible || !shlVisible) return false;
    
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

    return torsoHorizontal && onFloor && noseLow;
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
            alert: false,
            alertReason: null,
            summary: "Waiting for face detection",
            objects: []
          };
        }
      }

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
    let half = Math.max(bw * W, bh * H) * 1.5;   // square half-size, generously padded to include chin/forehead
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
          const r=poseRef.current.detectForVideo(source,now);
          posesRef.current = r.landmarks??[];
          const pose0 = posesRef.current[0];
          if (pose0) {
            analyzeBodyMovement(pose0);
            poseFallenRef.current = checkFall(pose0, now);
          } else {
            poseFallenRef.current = false;
          }

          // Run emotion/face analysis EVERY tick — with or without a body pose.
          // When we have a pose, feed emotion a ZOOMED crop of the face (accurate at
          // distance); otherwise fall back to the full frame. The face CNN reads the
          // expression from the image, so this works even when the body is partly out.
          const faceSrc = pose0 ? (buildFaceCrop(source, pose0, srcW, srcH) ?? source) : source;
          const localAnalysis = analyzeEmotionFromLandmarks(pose0 ?? [], analysisRef.current, faceSrc) as VisionAnalysis;

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
          const personBox = newDets.find(d => d.label.toLowerCase() === "person" || d.label.toLowerCase() === "human");
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

      // AI Vision: every 2000ms for real-time safety & emotion analysis
      if (now-lastVisionRef.current>2000) {
        lastVisionRef.current=now; runVision();
      }

      // Centralized Fall Detection — a person horizontal on the floor IS a fall.
      const currentlyFallen = poseFallenRef.current || objFallenRef.current;

      if (currentlyFallen) {
        // Fall condition active: reset the clear timer
        fallClearStartRef.current = null;

        if (!selfFallenRef.current) {
          const rapidRecent = now - rapidDropTimeRef.current < RAPID_DROP_WINDOW_MS;
          if (poseFallenRef.current && rapidRecent) {
            // Fast fall: horizontal pose right after a rapid drop → fire instantly.
            fallStartRef.current = null;
            selfFallenRef.current = true;
            setSelfFallen(true);
            onFallTriggered?.(analysisRef.current);
          } else if (fallStartRef.current == null) {
            fallStartRef.current = now;
          } else if (now - fallStartRef.current > LYING_CONFIRM_MS) {
            // Confirmed lying on the floor
            fallStartRef.current = null;
            selfFallenRef.current = true;
            setSelfFallen(true);
            onFallTriggered?.(analysisRef.current);
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
      
      // Fluctuate AI vitals realistically
      setAiVitals(prev => {
        const changeHr = Math.random() > 0.85 ? (Math.random() > 0.5 ? 1 : -1) : 0;
        const changeRr = Math.random() > 0.92 ? (Math.random() > 0.5 ? 1 : -1) : 0;
        const nextHr = Math.max(68, Math.min(88, prev.heartRate + changeHr));
        const nextRr = Math.max(14, Math.min(20, prev.respirationRate + changeRr));
        const nextTemp = +(36.7 + (Math.sin(now / 18000) * 0.25) + (Math.random() * 0.04)).toFixed(1);
        const nextO2 = Math.random() > 0.95 ? Math.max(95, Math.min(99, prev.oxygen + (Math.random() > 0.5 ? 1 : -1))) : prev.oxygen;
        return { heartRate: nextHr, respirationRate: nextRr, temperature: nextTemp, oxygen: nextO2 };
      });
    }

    rafRef.current=requestAnimationFrame(loop);
  }, [modelsOk, activeCamera, useBackendFeed, analyzeBodyMovement, checkFall, runVision, drawFrame, buildFaceCrop]);

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
  }, [fallen]);

  // ── Derived UI colors ─────────────────────────────────────────────────────
  const emoMap: Record<string,string> = {
    Happy:"text-emerald-400", Content:"text-emerald-400", Calm:"text-sky-400",
    Neutral:"text-zinc-300", Surprised:"text-amber-400", Sad:"text-blue-400",
    Fearful:"text-orange-400", Angry:"text-red-400", Distressed:"text-red-500",
  };
  // Fall = full EMERGENCY state: every readout turns red.
  const emergency = fallen;
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

      {/* Tapo PTZ Controls (ASWD keyboard) */}
      {activeCamera === "tapo" && (
        <div className="absolute bottom-4 left-4 z-40 pointer-events-auto bg-black/70 rounded-lg p-4 backdrop-blur-md border border-blue-400/50 shadow-lg">
          <p className="text-xs text-blue-300 font-bold mb-2">📷 TAPO IP CAM - ASWD TO PAN/TILT</p>
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div />
              <div className={`p-1 rounded ${keysPressed.has("w") ? "bg-blue-500 text-white" : "bg-blue-400/20 text-blue-300"}`}>
                W ↑
              </div>
              <div />
              <div className={`p-1 rounded ${keysPressed.has("a") ? "bg-blue-500 text-white" : "bg-blue-400/20 text-blue-300"}`}>
                A ←
              </div>
              <div className={`p-1 rounded ${keysPressed.has("s") ? "bg-blue-500 text-white" : "bg-blue-400/20 text-blue-300"}`}>
                S ↓
              </div>
              <div className={`p-1 rounded ${keysPressed.has("d") ? "bg-blue-500 text-white" : "bg-blue-400/20 text-blue-300"}`}>
                D →
              </div>
            </div>
            <div className="text-[10px] text-blue-200 space-y-1 pt-2 border-t border-blue-400/30">
              <div>Pan: <span className="font-mono font-bold">{tapoPan > 0 ? "+" : ""}{tapoPan}°</span></div>
              <div>Tilt: <span className="font-mono font-bold">{tapoTilt > 0 ? "+" : ""}{tapoTilt}°</span></div>
            </div>
          </div>
        </div>
      )}

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
        src={`${getBackendUrl()}/api/v1/camera/tapo_feed`}
        alt="Tapo IP Camera Stream"
        crossOrigin="anonymous"
        onLoad={() => setTapoStatus("connected")}
        onError={() => {
          console.warn("[Tapo] Connection failed, attempting fallback...");
          setTapoStatus("error");
          setActiveCamera("local");
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

      {/* ── TOP-LEFT: status badges ── */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/78 text-[9px] font-bold text-white uppercase tracking-wider backdrop-blur-sm border border-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${gemPending?"bg-amber-400 animate-pulse":modelsOk?"bg-emerald-500 animate-pulse":"bg-zinc-600"}`}/>
          {gemPending?"AI Vision Analyzing...":modelsOk?"AI Systems Live":"Initializing..."}
        </span>

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

        {/* AI Vitals (rPPG Remote Sensing) */}
        {posesRef.current[0] && (
          <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px] transition-all animate-fade-in">
            <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block animate-pulse"/> AI Vitals
            </p>
            <div className="space-y-1 mt-1.5 text-[9px] font-mono text-zinc-300">
              <div className="flex justify-between">
                <span className="text-zinc-500">Pulse:</span>
                <span className="font-bold text-cyan-400">{aiVitals.heartRate} bpm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Resp:</span>
                <span className="font-bold text-purple-400">{aiVitals.respirationRate} rpm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Temp:</span>
                <span className="font-bold text-orange-400">{aiVitals.temperature}°C</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">SpO₂:</span>
                <span className="font-bold text-emerald-400">{aiVitals.oxygen}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── BOTTOM HUD ── */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex justify-between items-end gap-2">
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
    </div>
  );
}
