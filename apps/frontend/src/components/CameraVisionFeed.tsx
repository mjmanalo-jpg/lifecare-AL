"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Camera, AlertTriangle, Activity, Shield, Brain, Cpu, Volume2, VolumeX } from "lucide-react";

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
  isFallen: boolean;
  onFallTriggered: () => void;
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

const INIT: VisionAnalysis = {
  globalEmotion:"Neutral", emotionConfidence:0, globalBehavior:"Initializing",
  globalPosture:"Detecting", alert:false, alertReason:null,
  summary:"Gemini Vision AI loading models...", objects:[],
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

function drawScanLine(ctx: CanvasRenderingContext2D, W: number, H: number, t: number) {
  const y = (t * 0.04) % H;
  const g = ctx.createLinearGradient(0,y-24,0,y+4);
  g.addColorStop(0,"rgba(34,211,238,0)");
  g.addColorStop(1,"rgba(34,211,238,0.04)");
  ctx.fillStyle=g;
  ctx.fillRect(0,y-24,W,28);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function CameraVisionFeed({ isFallen, onFallTriggered }: Props) {
  // DOM refs
  const videoRef   = useRef<HTMLVideoElement|null>(null);
  const canvasRef  = useRef<HTMLCanvasElement|null>(null);
  const captureRef = useRef<HTMLCanvasElement|null>(null);

  // Model refs
  const poseRef     = useRef<any>(null);
  const handRef     = useRef<any>(null);
  const detectorRef = useRef<any>(null);
  const rafRef      = useRef<number>(0);

  // Timing refs
  const lastPoseRef   = useRef(0);
  const lastHandRef   = useRef(0);
  const lastDetRef    = useRef(0);
  const lastGeminiRef = useRef(0);
  const startRef      = useRef(Date.now());

  // Live data refs (read by 60fps draw loop, written by inference)
  const posesRef    = useRef<LM[][]>([]);
  const handsRef    = useRef<LM[][]>([]);
  const detsRef     = useRef<TrackedDet[]>([]);
  const analysisRef = useRef<VisionAnalysis>(INIT);
  const waveRef     = useRef(false);
  const gemBusyRef  = useRef(false);

  // Wave detection - separate left and right history for accuracy
  const lWristHistRef = useRef<number[]>([]);
  const rWristHistRef = useRef<number[]>([]);
  const waveTimerRef = useRef<ReturnType<typeof setTimeout>|null>(null);

  // FPS
  const fpsTimesRef = useRef<number[]>([]);

  // React UI state
  const [camActive,  setCamActive]  = useState(false);
  const [camError,   setCamError]   = useState("");
  const [modelsOk,   setModelsOk]   = useState(false);
  const [modelMsg,   setModelMsg]   = useState("Loading AI models...");
  const [analysis,   setAnalysis]   = useState<VisionAnalysis>(INIT);
  const [fps,        setFps]        = useState(0);
  const [ping,       setPing]       = useState<number|null>(null);
  const [detCount,   setDetCount]   = useState(0);
  const [frameN,     setFrameN]     = useState(0);
  const [waving,     setWaving]     = useState(false);
  const [gemPending, setGemPending] = useState(false);

  // Voice synthesis states and refs
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("monitoringVoiceMuted");
      return saved === null ? true : saved === "true"; // default to muted
    }
    return true;
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const lastSpokenRef = useRef<string>("");

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
      // Try Gemini TTS first with natural, friendly voice
      const res = await fetch("/api/gemini", {
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
      console.warn("Gemini TTS failed, falling back to browser TTS:", err);
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

    // Select a female voice if available (typically sounds friendlier)
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v => v.name.includes("Female") || v.name.includes("female") || v.name.includes("Woman")) ||
                        voices.find(v => !v.name.includes("Male") && !v.name.includes("male")) ||
                        voices[0];
    if (femaleVoice) utterance.voice = femaleVoice;

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

  useEffect(() => {
    if (isMuted) {
      stopSpeaking();
      return;
    }

    const summaryText = isFallen
      ? "Incident Alert: Resident requires immediate assistance."
      : analysis.summary;

    if (!summaryText) return;

    // Ignore initial placeholder summaries
    const ignoreList = [
      "gemini vision ai loading models",
      "analysis in progress",
      "initializing",
      "gemini vision ai loading models..."
    ];
    if (ignoreList.includes(summaryText.toLowerCase().trim())) {
      return;
    }

    if (summaryText !== lastSpokenRef.current) {
      lastSpokenRef.current = summaryText;
      speak(summaryText);
    }
  }, [analysis.summary, isFallen, isMuted, speak, stopSpeaking]);

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

        setModelMsg("Loading Object Detector (YOLOv8-class)...");
        detectorRef.current = await ObjectDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:"https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
            delegate:"GPU",
          },
          scoreThreshold:0.55, runningMode:"VIDEO",  // ← HIGHER THRESHOLD FOR ACCURACY (was 0.4)
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

  // ── Camera setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    let stream: MediaStream|null = null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video:{ width:640, height:480, facingMode:"user" },
        });
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.onloadedmetadata = () => setCamActive(true); }
      } catch (e: any) { setCamError(e.message || "Camera denied."); }
    })();
    return () => { stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  // Local facial emotion detection removed to rely purely on Gemini Vision

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

  // ── Fall detection from pose keypoints ───────────────────────────────────
  const checkFall = useCallback((lms: LM[]) => {
    if (isFallen) return;
    const lh=lms[23], rh=lms[24], ls=lms[11], rs=lms[12];
    if (!lh||!rh||!ls||!rs||(lh.visibility??0)<0.5) return;
    const hipY   = (lh.y+rh.y)/2;
    const shlY   = (ls.y+rs.y)/2;
    if (Math.abs(hipY-shlY)<0.1 && hipY>0.3) onFallTriggered();
  }, [isFallen, onFallTriggered]);

  // ── Gemini vision (called every ~2000ms from inference loop) ───────────────
  const runGemini = useCallback(async () => {
    if (gemBusyRef.current) {
      console.log("[Gemini] API busy, skipping call.");
      return;
    }
    const v=videoRef.current, c=captureRef.current;
    if (!v||!c) {
      console.log("[Gemini] Video or capture canvas is null, skipping call.");
      return;
    }
    if (v.readyState<2) {
      console.log("[Gemini] Video readyState is less than 2, skipping call. ReadyState:", v.readyState);
      return;
    }

    const ctx=c.getContext("2d"); if (!ctx) return;
    c.width=640; c.height=480;  // ← INCREASED RESOLUTION for better facial emotion detection
    ctx.drawImage(v,0,0,c.width,c.height);  // No mirror - normal orientation
    const b64 = c.toDataURL("image/jpeg",0.75).split(",")[1];  // Better quality

    console.log("[Gemini] Starting vision analysis API call...");
    gemBusyRef.current=true; setGemPending(true);
    const t0=performance.now();

    try {
      const res = await fetch("/api/gemini",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"vision",imageBase64:b64,mimeType:"image/jpeg"}),
      });
      if (!res.ok) throw new Error("HTTP "+res.status);
      const data: VisionAnalysis = await res.json();
      const ms = Math.round(performance.now()-t0);
      console.log("[Gemini] API success in", ms, "ms. Data:", data);

      analysisRef.current = data;
      setAnalysis(data);
      setPing(ms);
      setFrameN(n=>n+1);

      // Merge per-object thoughts into tracked detections
      if (data.objects?.length) {
        detsRef.current = detsRef.current.map(d => {
          const m = data.objects.find(o =>
            d.label.toLowerCase().includes(o.type.toLowerCase()) ||
            o.type.toLowerCase().includes(d.label.toLowerCase())
          );
          return m ? { ...d, thought:m.thought, risk:m.risk } : d;
        });
      }

      if (data.alert && !isFallen) onFallTriggered();
    } catch (e) {
      console.error("[Gemini] API error:", e);
    }
    finally {
      gemBusyRef.current=false;
      setGemPending(false);
      console.log("[Gemini] Reset busy flag.");
    }
  }, [isFallen, onFallTriggered]);

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

    // Bounding boxes + labels + thinking bubbles (object detection)
    for (const det of detsRef.current) {
      const px=det.x*W, py=det.y*H, pw=det.w*W, ph=det.h*H;
      const flash = isFallen && det.label==="person";
      drawCornerBox(ctx,px,py,pw,ph,det.color,flash);
      drawLabel(ctx,px,py,`${det.label.toUpperCase()} ${Math.round(det.score*100)}%`,det.color);
      if (det.thought) drawThinkBubble(ctx,px+pw/2,py+ph,det.thought,det.risk);
    }

    // Wave banner (real-time hand movement detection)
    if (waveRef.current) drawWaveBanner(ctx,W,t);

    // Alert overlay
    if (isFallen || analysisRef.current.alert) {
      const a=0.10+0.07*Math.sin(t/210);
      ctx.fillStyle=`rgba(239,68,68,${a})`; ctx.fillRect(0,0,W,H);
      ctx.strokeStyle=`rgba(239,68,68,${0.55+0.3*Math.sin(t/210)})`;
      ctx.lineWidth=6; ctx.strokeRect(3,3,W-6,H-6);
    }
  }, [isFallen]);

  // ── Main inference + draw loop (requestAnimationFrame) ────────────────────
  const loop = useCallback(() => {
    const video=videoRef.current;
    const now=performance.now();

    if (video && video.readyState>=2 && modelsOk) {
      // Pose: throttled to ~30fps (for body movement & behavior analysis)
      if (poseRef.current && now-lastPoseRef.current>30) {
        try {
          const r=poseRef.current.detectForVideo(video,now);
          posesRef.current = r.landmarks??[];
          if (posesRef.current[0]) {
            analyzeBodyMovement(posesRef.current[0]);
            checkFall(posesRef.current[0]);
          }
        } catch(_){}
        lastPoseRef.current=now;
      }

      // Object detector: throttled to ~10fps (heavier model)
      if (detectorRef.current && now-lastDetRef.current>95) {
        try {
          const vw=video.videoWidth||640, vh=video.videoHeight||480;
          const r=detectorRef.current.detectForVideo(video,now);
          const newDets: TrackedDet[] = (r.detections??[]).map((d:any)=>{
            const label=d.categories?.[0]?.categoryName??"unknown";
            const score=d.categories?.[0]?.score??0;
            const bb=d.boundingBox;
            const nx=bb.originX/vw, ny=bb.originY/vh, nw=bb.width/vw, nh=bb.height/vh;
            const prev=detsRef.current.find(e=>e.label===label);
            return { label,score,x:nx,y:ny,w:nw,h:nh,
              color:detCol(label), thought:prev?.thought??"", risk:prev?.risk??"low" };
          });
          detsRef.current=newDets; setDetCount(newDets.length);
        } catch(_){}
        lastDetRef.current=now;
      }

      // Gemini Vision: every 2000ms for real-time safety & emotion analysis
      if (now-lastGeminiRef.current>2000) {
        lastGeminiRef.current=now; runGemini();
      }
    }

    drawFrame();

    // FPS
    const ft=fpsTimesRef.current; ft.push(now);
    while(ft.length>0 && now-ft[0]>1000) ft.shift();
    setFps(ft.length);

    rafRef.current=requestAnimationFrame(loop);
  }, [modelsOk, analyzeBodyMovement, checkFall, runGemini, drawFrame]);

  // Start loop once camera is active
  useEffect(() => {
    if (!camActive) return;
    rafRef.current=requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [camActive, loop]);

  // Override when fall manually triggered
  useEffect(() => {
    if (!isFallen) return;
    const override: VisionAnalysis = {
      ...analysisRef.current,
      globalEmotion:"Distressed", emotionConfidence:98,
      globalBehavior:"Falling", alert:true,
      alertReason:"Fall incident triggered.",
      summary:"⚠ Resident requires immediate assistance!",
    };
    analysisRef.current=override; setAnalysis(override);
  }, [isFallen]);

  // ── Derived UI colors ─────────────────────────────────────────────────────
  const emoMap: Record<string,string> = {
    Happy:"text-emerald-400", Content:"text-emerald-400", Calm:"text-sky-400",
    Neutral:"text-zinc-300", Surprised:"text-amber-400", Sad:"text-blue-400",
    Fearful:"text-orange-400", Angry:"text-red-400", Distressed:"text-red-500",
  };
  const emoColor = emoMap[analysis.globalEmotion]??"text-zinc-300";
  const behColor = waving ? "text-amber-400"
                 : analysis.globalBehavior==="Waving"  ? "text-amber-400"
                 : analysis.globalBehavior==="Falling" ? "text-red-500"
                 : analysis.globalBehavior==="Moving"  ? "text-sky-400"
                 : "text-zinc-400";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-zinc-950 border border-white/5 shadow-inner select-none">

      {/* Live webcam (no mirror - normal orientation) */}
      <video
        ref={videoRef} autoPlay playsInline muted
        className={`absolute inset-0 w-full h-full object-cover pointer-events-none transition-opacity duration-500 ${camActive?"opacity-100":"opacity-0"}`}
      />

      {/* Overlay canvas (normal orientation, matching video) */}
      <canvas
        ref={canvasRef} width={640} height={480}
        className="absolute inset-0 w-full h-full object-cover pointer-events-none z-10"
      />

      {/* Hidden capture canvas for Gemini */}
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

      {/* Alert border */}
      {(isFallen || analysis.alert) && (
        <div className="absolute inset-0 z-30 pointer-events-none border-2 border-red-500/80 rounded-2xl animate-pulse"/>
      )}

      {/* ── TOP-LEFT: status badges ── */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/78 text-[9px] font-bold text-white uppercase tracking-wider backdrop-blur-sm border border-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${gemPending?"bg-amber-400 animate-pulse":modelsOk?"bg-emerald-500 animate-pulse":"bg-zinc-600"}`}/>
          {gemPending?"Gemini Thinking...":modelsOk?"AI Systems Live":"Initializing..."}
        </span>

        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/72 text-[9px] font-mono text-amber-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
          <Brain className="w-3 h-3"/>
          {fps} FPS · {detCount} obj · #{frameN}
        </span>

        {ping !== null && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/72 text-[9px] font-mono text-violet-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
            <Activity className="w-3 h-3"/>
            Gemini {ping}ms
          </span>
        )}
      </div>

      {/* ── TOP-RIGHT: room badge ── */}
      <div className="absolute top-3 right-3 z-20 pointer-events-none">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-black/65 text-[9px] font-bold text-zinc-400 uppercase tracking-wider backdrop-blur-sm border border-white/10">
          Suite 12A
        </span>
      </div>

      {/* ── RIGHT PANEL: live AI detections ── */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2 pointer-events-none">
        {/* Emotion */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block"/> Emotion
          </p>
          <p className={`text-[12px] font-bold mt-0.5 ${emoColor}`}>{analysis.globalEmotion}</p>
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
            {waving ? "Waving 👋" : analysis.globalBehavior}
          </p>
        </div>

        {/* Posture */}
        <div className="bg-black/78 backdrop-blur-md border border-white/10 rounded-lg px-2.5 py-2 min-w-[92px]">
          <p className="text-[8px] text-zinc-500 uppercase tracking-wider font-bold flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-violet-400 inline-block"/> Posture
          </p>
          <p className="text-[12px] font-bold mt-0.5 text-violet-400">{analysis.globalPosture}</p>
        </div>
      </div>

      {/* ── BOTTOM HUD ── */}
      <div className="absolute bottom-3 left-3 right-3 z-20 flex justify-between items-end gap-2">
        <div className="flex-1 bg-black/68 backdrop-blur-md rounded-xl p-2.5 border border-white/10">
          <div className="flex justify-between items-center w-full">
            <p className="text-[9px] text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Brain className="w-2.5 h-2.5"/> Gemini AI Vision
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
            {isFallen ? "⚠ Incident Alert: Resident requires immediate assistance." : analysis.summary}
          </p>
          {analysis.alertReason && !isFallen && (
            <p className="text-red-400 text-[9px] mt-0.5 font-bold">⚠ {analysis.alertReason}</p>
          )}
        </div>

        {!isFallen ? (
          <button
            onClick={onFallTriggered}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[10px] font-bold tracking-wide transition-colors flex items-center gap-1 cursor-pointer"
          >
            <AlertTriangle className="w-3 h-3"/> Trigger Fall
          </button>
        ) : (
          <span className="flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-500 border border-red-500/40 text-[10px] font-bold">
            <Shield className="w-3 h-3 animate-pulse"/> Reporting...
          </span>
        )}
      </div>
    </div>
  );
}
