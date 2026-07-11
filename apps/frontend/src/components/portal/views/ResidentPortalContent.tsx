"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import FamilyPortalContent from "./FamilyPortalContent";
import {
  Heart,
  Activity,
  Clock,
  Plus,
  Phone,
  Settings,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Coffee,
  MessageSquare,
  Utensils,
  BookOpen,
  Sparkles,
  ShieldAlert,
  Pill,
  CheckSquare,
  Bell,
  Volume2,
  VolumeX,
  Calendar,
  X,
  PhoneCall,
  ChevronRight,
  TrendingUp,
  FileText,
  HeartPulse,
  User,
  Activity as StepIcon,
  Bot,
  Send,
  Mic,
  MicOff,
  MessageCircle,
} from "lucide-react";
import Link from "next/link";
import Swal from "sweetalert2";
import { useLiveQuery } from "@/lib/useLiveQuery";
import { createRecord, updateRecord, deleteRecord } from "@/lib/api";
import { ASSISTANT_CONFIG_KEY, parseAssistantConfig } from "@/lib/assistantConfig";

// speechSynthesis.getVoices() is empty until the async voiceschanged event on
// first load — a sync call then picks no voice and the OS default (often a
// robotic male voice) speaks instead. Wait for the list briefly.
function getBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const timer = setTimeout(() => resolve(synth.getVoices()), 1500);
    synth.onvoiceschanged = () => {
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
  });
}

interface ResidentPortalContentProps {
  tab: string;
}

interface TaskRow {
  id: string;
  title: string;
  description?: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueDate: string;
}

interface MedicationRow {
  id: string;
  name: string;
  dosage: string;
  frequency: string;
  route: string;
  status: string;
  startDate: string;
  prescribedBy?: string;
  reason?: string;
}

interface VitalRow {
  id: string;
  type: string;
  value: string;
  unit?: string;
  recordedAt: string;
}

interface ResidentRow {
  id: string;
  firstName: string;
  lastName: string;
  roomNumber: string;
  careLevel: string;
  sponsor?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
  };
}

interface AIChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Optional deep-link rendered as a button under the bubble (e.g. after the AI saves a visit). */
  link?: { href: string; label: string };
}

export default function ResidentPortalContent({ tab }: ResidentPortalContentProps) {
  if (tab && tab !== "dashboard") {
    return <FamilyPortalContent tab={tab} />;
  }

  const [now, setNow] = useState<Date>(new Date());
  const [complianceMap, setComplianceMap] = useState<Record<string, boolean>>({});
  const [goalsChecked, setGoalsChecked] = useState<Record<string, boolean>>({});
  const [customGoals, setCustomGoals] = useState<{ id: string; name: string; checked: boolean }[]>([]);
  const [newGoalText, setNewGoalText] = useState("");
  
  // Modal states
  const [familyModalOpen, setFamilyModalOpen] = useState(false);
  const [roomServiceModalOpen, setRoomServiceModalOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [medsModalOpen, setMedsModalOpen] = useState(false);
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [vitalsModalOpen, setVitalsModalOpen] = useState(false);

  // AI Voice Assistant States
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AIChatMessage[]>([
    { id: "welcome", role: "assistant", text: "Hello! I am your companion assistant. Talk to me by pressing the mic, or type below. Ask me about your vitals, schedule, or dinner menu!" }
  ]);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantThinking, setAssistantThinking] = useState(false);
  const [assistantListening, setAssistantListening] = useState(false);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [assistantAutoSpeak, setAssistantAutoSpeak] = useState(true);
  const [interimSpeech, setInterimSpeech] = useState("");
  const [voice, setVoice] = useState("Kore");

  const [serviceRequestText, setServiceRequestText] = useState("");
  const [requestingService, setRequestingService] = useState(false);
  const [menuSubText, setMenuSubText] = useState("");
  const [submittingMenuSub, setSubmittingMenuSub] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Auto-updating clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Fetch logged-in resident profile
  const { data: residents, loading: profileLoading } = useLiveQuery<ResidentRow>("residents", {
    query: "include=sponsor&take=1",
    tables: ["Resident"],
  });
  const resident = residents[0] || null;

  // Fetch resident's tasks for today
  const { data: tasks, loading: tasksLoading, refetch: refetchTasks } = useLiveQuery<TaskRow>("tasks", {
    query: "orderBy=dueDate:asc",
    tables: ["Task"],
  });

  // Fetch resident's active medications
  const { data: medications, loading: medsLoading } = useLiveQuery<MedicationRow>("medications", {
    tables: ["Medication"],
  });

  // Fetch resident's latest vitals log
  const { data: vitals, loading: vitalsLoading } = useLiveQuery<VitalRow>("vitals", {
    query: "orderBy=recordedAt:desc&take=30",
    tables: ["VitalsLog"],
  });

  // Fetch app settings (voice sync)
  const { data: settingRows } = useLiveQuery<{ id: string; value: string }>("app-settings", {
    tables: ["AppSetting"],
  });

  useEffect(() => {
    const saved = settingRows.find((r) => r.id === "assistantVoice")?.value;
    if (saved) setVoice(saved);
  }, [settingRows]);

  // Personality configured by the Super Admin — live-synced via AppSetting,
  // so name/tone/greeting changes reach this dashboard without a refresh.
  const assistantCfg = useMemo(
    () => parseAssistantConfig(settingRows.find((r) => r.id === ASSISTANT_CONFIG_KEY)?.value),
    [settingRows]
  );

  // Keep the welcome bubble in sync with the configured greeting as long as
  // the resident hasn't started chatting yet.
  useEffect(() => {
    setAssistantMessages((prev) =>
      prev.length === 1 && prev[0].id === "welcome" && prev[0].text !== assistantCfg.greeting
        ? [{ ...prev[0], text: assistantCfg.greeting }]
        : prev
    );
  }, [assistantCfg.greeting]);

  // Load custom goals and checkbox states from localStorage (persists across refreshes)
  useEffect(() => {
    if (resident?.id) {
      const savedGoals = localStorage.getItem(`goals_${resident.id}`);
      if (savedGoals) {
        try { setGoalsChecked(JSON.parse(savedGoals)); } catch (e) { console.error(e); }
      }
      
      const savedMeds = localStorage.getItem(`meds_${resident.id}`);
      if (savedMeds) {
        try { setComplianceMap(JSON.parse(savedMeds)); } catch (e) { console.error(e); }
      }

      const savedCustomGoals = localStorage.getItem(`custom_goals_${resident.id}`);
      if (savedCustomGoals) {
        try { setCustomGoals(JSON.parse(savedCustomGoals)); } catch (e) { console.error(e); }
      }
    }
  }, [resident?.id]);

  // Scroll to bottom of chat transcript when messages update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [assistantMessages, assistantThinking, interimSpeech]);

  // Speech cleanup on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
      }
      if (audioRef.current) audioRef.current.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const toggleGoal = (goalKey: string) => {
    if (!resident?.id) return;
    const nextGoals = { ...goalsChecked, [goalKey]: !goalsChecked[goalKey] };
    setGoalsChecked(nextGoals);
    localStorage.setItem(`goals_${resident.id}`, JSON.stringify(nextGoals));
  };

  const toggleCustomGoal = (id: string) => {
    if (!resident?.id) return;
    const nextCustom = customGoals.map(g => g.id === id ? { ...g, checked: !g.checked } : g);
    setCustomGoals(nextCustom);
    localStorage.setItem(`custom_goals_${resident.id}`, JSON.stringify(nextCustom));
  };

  const addCustomGoal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resident?.id || !newGoalText.trim()) return;
    const newGoal = {
      id: `cg-${Date.now()}`,
      name: newGoalText.trim(),
      checked: false
    };
    const nextCustom = [...customGoals, newGoal];
    setCustomGoals(nextCustom);
    localStorage.setItem(`custom_goals_${resident.id}`, JSON.stringify(nextCustom));
    setNewGoalText("");
    Swal.fire({
      title: "Goal Added",
      icon: "success",
      timer: 1000,
      showConfirmButton: false,
      toast: true,
      position: "top-end"
    });
  };

  const deleteCustomGoal = (id: string) => {
    if (!resident?.id) return;
    const nextCustom = customGoals.filter(g => g.id !== id);
    setCustomGoals(nextCustom);
    localStorage.setItem(`custom_goals_${resident.id}`, JSON.stringify(nextCustom));
  };

  const toggleMedicationCompliance = (medId: string) => {
    if (!resident?.id) return;
    const nextCompliance = { ...complianceMap, [medId]: !complianceMap[medId] };
    setComplianceMap(nextCompliance);
    localStorage.setItem(`meds_${resident.id}`, JSON.stringify(nextCompliance));
  };

  // Generate dynamic wellness score based on variables
  const wellnessScore = useMemo(() => {
    if (!resident) return 94; // Premium default fallback
    const totalTodayTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === "COMPLETED").length;
    const taskRatio = totalTodayTasks > 0 ? completedTasks / totalTodayTasks : 1;
    
    let score = 85 + Math.round(taskRatio * 10);
    
    const latestHeartRate = vitals.find((v) => v.type === "HEART_RATE");
    if (latestHeartRate) {
      const hrVal = parseInt(latestHeartRate.value);
      if (hrVal >= 60 && hrVal <= 100) score += 5;
    } else {
      score += 4;
    }
    
    return Math.min(Math.max(score, 65), 100);
  }, [resident, tasks, vitals]);

  const wellnessLabel = (score: number) => {
    if (score >= 90) return { text: "Optimal", color: "bg-emerald-500 text-white" };
    if (score >= 80) return { text: "Good", color: "bg-blue-500 text-white" };
    return { text: "Stable", color: "bg-amber-500 text-white" };
  };

  // Filter tasks to show today's schedule
  const todayTasks = useMemo(() => {
    return tasks.filter((t) => true);
  }, [tasks]);

  const handleTaskToggle = async (task: TaskRow) => {
    const nextStatus = task.status === "COMPLETED" ? "PENDING" : "COMPLETED";
    try {
      await updateRecord("tasks", task.id, {
        status: nextStatus,
        completedAt: nextStatus === "COMPLETED" ? new Date().toISOString() : null,
      });
      await refetchTasks();
      Swal.fire({
        title: nextStatus === "COMPLETED" ? "Task Completed!" : "Task Reset",
        icon: "success",
        timer: 1000,
        showConfirmButton: false,
        toast: true,
        position: "top-end",
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Action Failed",
        text: "Could not update task status.",
        icon: "error",
      });
    }
  };

  // Trigger SOS call bell
  const handleSOS = async () => {
    if (!resident) return;
    const result = await Swal.fire({
      title: "Request Emergency Help?",
      text: "This will notify the head nurse and care staff immediately. Help is on the way.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      confirmButtonText: "Yes, Send SOS",
      cancelButtonText: "Cancel",
    });

    if (result.isConfirmed) {
      try {
        await createRecord("call-bells", {
          residentId: resident.id,
          status: "PENDING",
          reason: "Emergency SOS Alert from Resident Portal Dashboard",
        });
        Swal.fire({
          title: "Emergency SOS Dispatched!",
          text: "Head Nurse Sarah Jenkins and Caregiver Caleb Randall have been alerted.",
          icon: "success",
          confirmButtonColor: "#10b981",
        });
      } catch (err) {
        console.error(err);
        Swal.fire({
          title: "SOS Send Failed",
          text: "Connection issue. Please use physical emergency cord or call front desk.",
          icon: "error",
        });
      }
    }
  };

  // Trigger Room Service request task
  const handleRoomServiceRequest = async () => {
    if (!resident) return;
    if (!serviceRequestText.trim()) {
      Swal.fire({ title: "Please enter a request", icon: "warning" });
      return;
    }
    setRequestingService(true);
    try {
      await createRecord("tasks", {
        residentId: resident.id,
        title: `Room Service Request: Room ${resident.roomNumber}`,
        description: serviceRequestText,
        status: "PENDING",
        priority: "MEDIUM",
        dueDate: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      await refetchTasks();
      setRoomServiceModalOpen(false);
      setServiceRequestText("");
      Swal.fire({
        title: "Request Dispatched",
        text: "Your room service request was logged and assigned to daily caregivers.",
        icon: "success",
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Submission Failed",
        text: "Could not create room service task.",
        icon: "error",
      });
    } finally {
      setRequestingService(false);
    }
  };

  // Trigger Menu substitution request
  const handleMenuSubstitution = async () => {
    if (!resident) return;
    if (!menuSubText.trim()) {
      Swal.fire({ title: "Please specify your request", icon: "warning" });
      return;
    }
    setSubmittingMenuSub(true);
    try {
      await createRecord("tasks", {
        residentId: resident.id,
        title: `Diet Substitution: Room ${resident.roomNumber}`,
        description: `Diet request: ${menuSubText}`,
        status: "PENDING",
        priority: "LOW",
        dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      });
      await refetchTasks();
      setMenuModalOpen(false);
      setMenuSubText("");
      Swal.fire({
        title: "Substitution Dispatched",
        text: "Your request was logged. The kitchen and caregiver staff have been notified.",
        icon: "success",
      });
    } catch (err) {
      console.error(err);
      Swal.fire({
        title: "Submission Failed",
        text: "Could not submit diet substitution request.",
        icon: "error",
      });
    } finally {
      setSubmittingMenuSub(false);
    }
  };

  // Helper icons for tasks based on names/descriptions
  const getTaskIcon = (title: string) => {
    const t = title.toLowerCase();
    if (t.includes("medication") || t.includes("pill") || t.includes("pass")) return Pill;
    if (t.includes("breakfast") || t.includes("lunch") || t.includes("dinner") || t.includes("meal") || t.includes("feed")) return Utensils;
    if (t.includes("therapy") || t.includes("exercise") || t.includes("walk") || t.includes("pt")) return Activity;
    return Clock;
  };

  // Resolve Vitals metrics
  const heartRate = useMemo(() => {
    const hr = vitals.find((v) => v.type === "HEART_RATE");
    return hr ? `${hr.value} BPM` : "72 BPM";
  }, [vitals]);

  const activitySteps = useMemo(() => {
    return "3,240 Steps";
  }, [vitals]);


  // ── AI ASSISTANT CHAT TRANSCRIPT & CONTEXT INJECTIONS ──
  const buildResidentContext = () => {
    if (!resident) return "";
    const taskStr = todayTasks.map(t => `- ${t.title} at ${new Date(t.dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${t.status})`).join("\n");
    const medStr = medications.map(m => `- ${m.name} (${m.dosage}, ${m.frequency})`).join("\n");
    const latestHR = vitals.find(v => v.type === "HEART_RATE")?.value || "72";
    const sponsorName = resident.sponsor?.name || "None";
    
    // Data only — the persona/tone is built server-side from the Super Admin's
    // live assistantConfig, so it can't drift from the rest of the app.
    return `Resident Profile:
- Name: ${resident.firstName} ${resident.lastName}
- Room Number: ${resident.roomNumber}
- Care Level: ${resident.careLevel}
- Family Sponsor: ${sponsorName}

Today's Schedule Tasks:
${taskStr || "No tasks scheduled today."}

Active Medications:
${medStr || "No medications active."}

Vitals:
- Latest Heart Rate: ${latestHR} BPM
- Daily Activity Steps: 3,240 Steps`;
  };

  const handleSendAssistantMessage = async (text: string) => {
    const query = text.trim();
    if (!query || assistantThinking) return;
    
    setAssistantInput("");
    setAssistantThinking(true);
    
    // Add user message
    const userMsg: AIChatMessage = { id: `u-${Date.now()}`, role: "user", text: query };
    setAssistantMessages((prev) => [...prev, userMsg]);

    const context = buildResidentContext();
    const history = assistantMessages
      .filter((m) => m.id !== "welcome")
      .slice(-6)
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", text: m.text }));

    let reply = "";
    let link: AIChatMessage["link"];
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "chat", message: query, context, history, audience: "resident" }),
      });
      const data = await res.json();
      reply = data.reply || "I am here, but I couldn't compute a reply. Let me call a caregiver if needed.";
      // The AI saved something real (visit request, call bell) — offer a direct
      // link so the resident can see it immediately.
      const actions: { name: string; ok?: boolean }[] = Array.isArray(data.actions) ? data.actions : [];
      if (actions.some((a) => a.name === "request_visit" && a.ok)) {
        link = { href: "/resident/appointments", label: "View my appointments" };
      }
    } catch {
      reply = "I couldn't reach my cloud companion service. Please check our network connection.";
    }

    setAssistantMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", text: reply, ...(link ? { link } : {}) }]);
    setAssistantThinking(false);

    if (assistantAutoSpeak) {
      speakTTS(reply);
    }
  };

  // Base64 helper for neural audio playback
  const base64ToBlob = (base64: string, mime: string): Blob => {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
  };

  // Text-To-Speech (Gemini with browser fallback)
  const speakTTS = async (text: string) => {
    stopTTS();
    setAssistantSpeaking(true);
    try {
      const res = await fetch("/api/ai-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tts", text, provider: "gemini", voiceId: voice }),
      });
      const data = await res.json();
      if (!data.fallback && data.audio) {
        const blob = base64ToBlob(data.audio, data.mimeType || "audio/mpeg");
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        await new Promise<void>((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => resolve());
        });
        setAssistantSpeaking(false);
        return;
      }
    } catch (err) {
      console.warn("TTS fetch failed, falling back to Web Speech Synthesis", err);
    }

    // Fallback: Web Speech API — prefer a warm neural/female voice over the
    // OS default (often a robotic male voice).
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const voices = await getBrowserVoices();
      await new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-US";
        u.rate = 1.0;
        u.pitch = 1.05;
        const preferred =
          voices.find((v) => /aria|jenny|natural/i.test(v.name) && v.lang.startsWith("en")) ??
          voices.find((v) => /zira|samantha|female/i.test(v.name) && v.lang.startsWith("en")) ??
          voices.find((v) => v.lang === "en-US") ??
          null;
        if (preferred) u.voice = preferred;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      });
    }
    setAssistantSpeaking(false);
  };

  const stopTTS = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setAssistantSpeaking(false);
  };

  // ── Speech-To-Text ────────────────────────────────────────────────────────
  // Cloud-first: record with MediaRecorder and let Gemini transcribe — it
  // understands English, Tagalog, Cebuano/Bisaya, other dialects, and mixes.
  // Browser SpeechRecognition (English-only) remains the fallback.
  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const startCloudSTT = async (): Promise<boolean> => {
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = MediaRecorder.isTypeSupported("audio/webm")
        ? new MediaRecorder(stream, { mimeType: "audio/webm" })
        : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaRecorderRef.current = null;
        setAssistantListening(false);
        setInterimSpeech("");
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        if (blob.size < 2000) return; // accidental tap — nothing meaningful recorded
        try {
          setAssistantThinking(true);
          const base64 = await blobToBase64(blob);
          const res = await fetch("/api/ai-assistant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "stt", audio: base64, mimeType: blob.type }),
          });
          const data = await res.json();
          setAssistantThinking(false);
          if (data.text?.trim()) {
            handleSendAssistantMessage(data.text.trim());
          } else if (data.fallback) {
            startBrowserSTT(); // no cloud key — let the resident retry via browser STT
          }
        } catch {
          setAssistantThinking(false);
        }
      };
      mediaRecorderRef.current = rec;
      setAssistantListening(true);
      setInterimSpeech("Listening… tap the mic again when you're done");
      rec.start();
      // Safety net: stop automatically after 30 seconds.
      setTimeout(() => {
        if (mediaRecorderRef.current === rec && rec.state === "recording") rec.stop();
      }, 30000);
      return true;
    } catch {
      return false; // mic denied or unsupported — try the browser engine
    }
  };

  const startSpeechToText = async () => {
    stopTTS();
    if (await startCloudSTT()) return;
    startBrowserSTT();
  };

  // Browser Web Speech API fallback (English-only).
  const startBrowserSTT = () => {
    if (typeof window === "undefined") return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      Swal.fire({
        title: "Microphone Speech Blocked",
        text: "Your browser does not support native speech recognition speech inputs.",
        icon: "info"
      });
      return;
    }
    const recognition = new SR();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalTranscript = "";
    recognition.onresult = (e: any) => {
      let interim = "";
      finalTranscript = "";
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTranscript += t;
        else interim += t;
      }
      setInterimSpeech(finalTranscript || interim);
    };

    recognition.onend = () => {
      setAssistantListening(false);
      recognitionRef.current = null;
      const text = finalTranscript.trim();
      if (text) {
        handleSendAssistantMessage(text);
      }
      setInterimSpeech("");
    };

    recognition.onerror = (err: any) => {
      console.warn("Speech error:", err);
      setAssistantListening(false);
      recognitionRef.current = null;
      setInterimSpeech("");
    };

    setAssistantListening(true);
    recognition.start();
  };

  const stopSpeechToText = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop(); // onstop transcribes + sends
      return;
    }
    recognitionRef.current?.stop();
    setAssistantListening(false);
  };

  const toggleMic = () => {
    if (assistantListening) {
      stopSpeechToText();
    } else {
      startSpeechToText();
    }
  };


  // Loading state skeleton
  if (profileLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-gray-500">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500 mb-4" />
        <span className="text-sm font-semibold">Syncing with Golden Hearth Database...</span>
      </div>
    );
  }

  const residentName = resident ? `${resident.firstName} ${resident.lastName}` : "Eleanor";
  const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-8 select-none relative">
      
      {/* ── TOP GREETING HEADER ── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-gradient-to-r from-blue-50/50 to-amber-50/30 p-6 rounded-2xl border border-blue-100/50 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-extrabold text-blue-900 tracking-tight">
            Good Morning, {resident?.firstName || "Eleanor"}
          </h1>
          <p className="text-gray-600 text-sm md:text-base max-w-xl leading-relaxed">
            It's a beautiful {dayName}. You have <span className="font-semibold text-blue-900">{todayTasks.filter(t => t.status !== "COMPLETED").length} activities</span> left scheduled today, and your wellness score is looking excellent.
          </p>
        </div>
        
        {/* Wellness Score Widget */}
        <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-100 shadow-md w-full md:w-auto md:min-w-[200px] hover:shadow-lg transition">
          <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
            <TrendingUp className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-black text-gray-400 tracking-wider">Wellness Score</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-black text-blue-900">{wellnessScore}</span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${wellnessLabel(wellnessScore).color}`}>
                {wellnessLabel(wellnessScore).text}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── GRID LAYOUT (Mockup style) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* ── COL 1: Today's Schedule (span 4) ── */}
        <div 
          onClick={() => setScheduleModalOpen(true)}
          className="lg:col-span-4 bg-white rounded-2xl border border-gray-200 p-6 shadow-sm flex flex-col h-[600px] hover:border-blue-400 hover:shadow-md transition cursor-pointer"
        >
          <div className="flex items-center justify-between pb-4 border-b border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
              <Calendar className="w-5 h-5 text-blue-600" /> Today's Schedule
            </h2>
            <span className="text-xs font-semibold text-blue-600 px-2.5 py-1 bg-blue-50 rounded-full">
              {now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto pt-4 space-y-6 pr-1 custom-scrollbar">
            {todayTasks.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <CheckCircle2 className="w-12 h-12 mx-auto text-gray-200 mb-3" />
                <p className="font-semibold text-sm">No activities scheduled</p>
                <p className="text-xs">Enjoy your leisure time!</p>
              </div>
            ) : (
              <div className="relative border-l-2 border-blue-100 ml-4 pl-6 space-y-6 py-2">
                {todayTasks.slice(0, 4).map((task) => {
                  const TaskIcon = getTaskIcon(task.title);
                  const isDone = task.status === "COMPLETED";
                  return (
                    <div key={task.id} className="relative group" onClick={(e) => { e.stopPropagation(); handleTaskToggle(task); }}>
                      {/* Timeline dot */}
                      <button
                        className={`absolute -left-[35px] top-1 w-6 h-6 rounded-full flex items-center justify-center border-2 transition active:scale-95 ${
                          isDone
                            ? "bg-emerald-500 border-emerald-500 text-white"
                            : "bg-white border-blue-300 text-blue-500 hover:bg-blue-50"
                        }`}
                      >
                        {isDone ? <CheckSquare className="w-3.5 h-3.5" /> : <TaskIcon className="w-3.5 h-3.5" />}
                      </button>

                      {/* Content Card */}
                      <div
                        className={`p-3 rounded-xl border transition ${
                          isDone
                            ? "bg-emerald-50/20 border-emerald-100"
                            : "bg-white border-gray-100 group-hover:border-blue-200"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-blue-600">
                            {new Date(task.dueDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                          </span>
                          {task.priority === "URGENT" && (
                            <span className="px-1.5 py-0.5 bg-red-100 text-red-600 rounded text-[9px] font-bold">URGENT</span>
                          )}
                        </div>
                        <h4 className={`text-sm font-bold mt-1 text-gray-900 ${isDone ? "line-through text-gray-400" : ""}`}>
                          {task.title}
                        </h4>
                        {task.description && (
                          <p className={`text-xs mt-1 leading-relaxed line-clamp-2 ${isDone ? "text-gray-400" : "text-gray-500"}`}>
                            {task.description}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <div className="pt-3 border-t border-gray-100 text-center text-xs text-blue-500 font-bold flex items-center justify-center gap-1">
            Tap to open complete schedule planner <ChevronRight className="w-4 h-4" />
          </div>
        </div>

        {/* ── COL 2: Medications & Vitals & SOS (span 5) ── */}
        <div className="lg:col-span-5 space-y-6 flex flex-col h-[600px] justify-between">
          
          {/* Medications Card */}
          <div 
            onClick={() => setMedsModalOpen(true)}
            className="bg-blue-600 rounded-2xl p-6 text-white shadow-md flex-1 flex flex-col justify-between mb-2 hover:bg-blue-700 hover:shadow-lg transition cursor-pointer border border-blue-500"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-blue-500/30">
                <h3 className="text-lg font-bold flex items-center gap-2 text-white">
                  <Pill className="w-5 h-5 text-white" /> Upcoming Medications
                </h3>
                <span className="text-[10px] uppercase font-black bg-blue-700/50 px-2 py-1 rounded text-blue-200 tracking-wider">
                  Next Dose: 2:00 PM
                </span>
              </div>
              
              <div className="space-y-3 mt-4 overflow-y-auto max-h-[140px] pr-1 custom-scrollbar">
                {medications.length === 0 ? (
                  <p className="text-sm text-blue-100 italic py-4">No medications scheduled.</p>
                ) : (
                  medications.slice(0, 2).map((med) => {
                    const isChecked = complianceMap[med.id] || false;
                    return (
                      <div
                        key={med.id}
                        onClick={(e) => { e.stopPropagation(); toggleMedicationCompliance(med.id); }}
                        className={`p-3 rounded-xl border flex items-center justify-between transition ${
                          isChecked
                            ? "bg-blue-700/40 border-blue-400/50"
                            : "bg-blue-500/20 border-blue-400/30 hover:bg-blue-500/30"
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <Pill className="w-4 h-4 text-blue-200" />
                          <div>
                            <div className={`text-sm font-bold ${isChecked ? "text-blue-200 line-through" : "text-white"}`}>
                              {med.name}
                            </div>
                            <div className="text-xs text-blue-200">
                              {med.dosage} • {med.frequency}
                            </div>
                          </div>
                        </div>
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center transition border ${
                          isChecked ? "bg-emerald-500 border-emerald-500 text-white" : "border-blue-300"
                        }`}>
                          {isChecked && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            <div className="flex items-center justify-between text-xs text-blue-200/80 pt-2 border-t border-blue-500/30">
              <span>Tap to check compliance</span>
              <span className="font-bold flex items-center gap-0.5">View details <ChevronRight className="w-3.5 h-3.5" /></span>
            </div>
          </div>

          {/* Vitals Grid */}
          <div className="grid grid-cols-2 gap-4">
            
            {/* Heart Rate */}
            <div 
              onClick={() => setVitalsModalOpen(true)}
              className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:border-red-400 hover:shadow-md transition cursor-pointer"
            >
              <div className="flex items-center gap-2 pb-2">
                <Heart className="w-5 h-5 text-red-500 fill-red-50" />
                <span className="text-xs font-semibold text-gray-500">Heart Rate</span>
              </div>
              <div className="text-3xl font-black text-gray-900">{heartRate}</div>
              <span className="text-[10px] text-emerald-600 font-bold px-2 py-0.5 bg-emerald-50 rounded-full mt-2 inline-block">
                Within Range
              </span>
            </div>

            {/* Activity Steps */}
            <div 
              onClick={() => setVitalsModalOpen(true)}
              className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:border-blue-400 hover:shadow-md transition cursor-pointer"
            >
              <div className="flex items-center gap-2 pb-2">
                <Activity className="w-5 h-5 text-blue-500" />
                <span className="text-xs font-semibold text-gray-500">Activity</span>
              </div>
              <div className="text-3xl font-black text-gray-900">{activitySteps}</div>
              <span className="text-[10px] text-blue-600 font-bold px-2 py-0.5 bg-blue-50 rounded-full mt-2 inline-block">
                Daily Goal: 80%
              </span>
            </div>

          </div>

          {/* Quick Action buttons at bottom */}
          <div className="grid grid-cols-3 gap-3">
            
            {/* SOS BUTTON */}
            <button
              onClick={handleSOS}
              className="py-3 bg-red-50 border border-red-200 hover:bg-red-100 active:scale-95 text-red-700 font-black rounded-xl text-center shadow-sm transition flex flex-col items-center justify-center gap-1"
            >
              <span className="text-xs font-extrabold tracking-wider bg-red-200 px-2 py-0.5 rounded-full mb-1">SOS</span>
              <span className="text-[10px] uppercase">Request Help</span>
            </button>

            {/* CALL FAMILY */}
            <button
              onClick={() => setFamilyModalOpen(true)}
              className="py-3 bg-blue-50 border border-blue-200 hover:bg-blue-100 active:scale-95 text-blue-700 font-black rounded-xl text-center shadow-sm transition flex flex-col items-center justify-center gap-1"
            >
              <PhoneCall className="w-5 h-5 mb-1" />
              <span className="text-[10px] uppercase">Call Family</span>
            </button>

            {/* ROOM SERVICE */}
            <button
              onClick={() => setRoomServiceModalOpen(true)}
              className="py-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 active:scale-95 text-amber-700 font-black rounded-xl text-center shadow-sm transition flex flex-col items-center justify-center gap-1"
            >
              <Coffee className="w-5 h-5 mb-1" />
              <span className="text-[10px] uppercase">Room Service</span>
            </button>

          </div>

        </div>

        {/* ── COL 3: Dining Menu & Daily Goals (span 3) ── */}
        <div className="lg:col-span-3 space-y-6 flex flex-col h-[600px] justify-between">
          
          {/* Today's Menu */}
          <div 
            onClick={() => setMenuModalOpen(true)}
            className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex-1 overflow-y-auto custom-scrollbar flex flex-col justify-between mb-2 hover:border-amber-400 hover:shadow-md transition cursor-pointer"
          >
            <div>
              <h3 className="text-sm font-bold text-gray-900 pb-3 border-b border-gray-100 flex items-center gap-2">
                <Utensils className="w-4 h-4 text-amber-500" /> Today's Menu
              </h3>
              
              <div className="mt-3 space-y-4">
                {/* Lunch */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-600">Lunch (12:30 PM)</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">Low Sodium</span>
                  </div>
                  {/* Salad image mockup */}
                  <div className="h-20 w-full bg-cover bg-center rounded-lg relative border border-gray-100" style={{ backgroundImage: "url('https://images.unsplash.com/photo-1512621776951-a57141f2eefd?q=80&w=300')" }}>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent rounded-lg flex items-end p-2">
                      <span className="text-white text-xs font-black truncate">Grilled Chicken Salad</span>
                    </div>
                  </div>
                </div>

                {/* Dinner */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wider font-extrabold text-amber-600">Dinner (6:00 PM)</span>
                  <h4 className="text-xs font-bold text-gray-900">Baked Salmon</h4>
                  <p className="text-[10px] text-gray-500 leading-normal line-clamp-2">
                    With steamed asparagus, herb-seasoned wild rice, and organic lemon dressing.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="text-[10px] text-amber-500 font-bold text-center pt-2 flex items-center justify-center gap-0.5 border-t border-gray-50">
              View complete dining menu <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>

          {/* Daily Goals */}
          <div 
            onClick={() => setGoalsModalOpen(true)}
            className="bg-teal-800 rounded-2xl p-5 text-white shadow-md flex flex-col justify-between h-[210px] hover:bg-teal-900 hover:shadow-lg transition cursor-pointer border border-teal-700"
          >
            <div>
              <h3 className="text-sm font-bold flex items-center gap-2 pb-2 border-b border-teal-700/50 text-white">
                <CheckCircle2 className="w-4 h-4 text-teal-300" /> Daily Goals
              </h3>
              
              <div className="space-y-2 mt-3">
                {/* Goal 1 */}
                <label className="flex items-center gap-3 cursor-pointer text-xs select-none" onClick={(e) => { e.stopPropagation(); toggleGoal("goal1"); }}>
                  <input
                    type="checkbox"
                    checked={goalsChecked["goal1"] || false}
                    readOnly
                    className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500 bg-teal-900"
                  />
                  <span className={goalsChecked["goal1"] ? "line-through text-teal-300" : "text-white"}>
                    Morning Walk (15 mins)
                  </span>
                </label>

                {/* Goal 2 */}
                <label className="flex items-center gap-3 cursor-pointer text-xs select-none" onClick={(e) => { e.stopPropagation(); toggleGoal("goal2"); }}>
                  <input
                    type="checkbox"
                    checked={goalsChecked["goal2"] || false}
                    readOnly
                    className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500 bg-teal-900"
                  />
                  <span className={goalsChecked["goal2"] ? "line-through text-teal-300" : "text-white"}>
                    Drink 2 Liters of Water
                  </span>
                </label>
              </div>
            </div>

            <div className="text-[10px] text-teal-300 text-center font-bold flex items-center justify-center gap-0.5 pt-2 border-t border-teal-700/30">
              Manage & Add custom goals <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </div>

        </div>

      </div>

      {/* ── 1. TODAY'S SCHEDULE DETAIL VIEW MODAL ── */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-blue-600 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Calendar className="w-5 h-5" /> Today's Complete Schedule
              </h3>
              <button onClick={() => setScheduleModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-sm text-gray-500">Below are your scheduled activities and checklists for today. Tap the checkbox to check them off as completed.</p>
              
              <div className="space-y-3 mt-4">
                {todayTasks.length === 0 ? (
                  <p className="text-sm text-gray-400 italic text-center py-8">No tasks recorded in your schedule today.</p>
                ) : (
                  todayTasks.map((t) => {
                    const TaskIcon = getTaskIcon(t.title);
                    const isDone = t.status === "COMPLETED";
                    return (
                      <div
                        key={t.id}
                        onClick={() => handleTaskToggle(t)}
                        className={`p-4 rounded-xl border flex items-start gap-4 transition cursor-pointer ${
                          isDone 
                            ? "bg-emerald-50/20 border-emerald-100 hover:bg-emerald-50/40" 
                            : "bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm"
                        }`}
                      >
                        <div className={`mt-1 w-5 h-5 rounded-full flex items-center justify-center border transition ${
                          isDone ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-300 text-gray-400"
                        }`}>
                          {isDone && <CheckCircle2 className="w-4 h-4 text-white" />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-blue-600">
                              {new Date(t.dueDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                              t.priority === "URGENT" ? "bg-red-100 text-red-700" :
                              t.priority === "HIGH" ? "bg-orange-100 text-orange-700" :
                              "bg-gray-100 text-gray-600"
                            }`}>
                              {t.priority}
                            </span>
                          </div>
                          <h4 className={`text-base font-extrabold text-gray-900 mt-1 ${isDone ? "line-through text-gray-400" : ""}`}>
                            {t.title}
                          </h4>
                          {t.description && (
                            <p className={`text-xs mt-1 leading-relaxed ${isDone ? "text-gray-400" : "text-gray-600"}`}>
                              {t.description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setScheduleModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close Schedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. UPCOMING MEDICATIONS DETAIL VIEW MODAL ── */}
      {medsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-blue-700 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Pill className="w-5 h-5" /> Active Medications & Prescriptions
              </h3>
              <button onClick={() => setMedsModalOpen(false)} className="p-1 hover:bg-blue-800 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-sm text-gray-500">Your doctor-approved prescription list. If you take your medication, mark it below to log compliance for today.</p>
              
              <div className="space-y-4 mt-2">
                {medications.length === 0 ? (
                  <p className="text-sm text-gray-400 italic text-center py-8">No medications currently active.</p>
                ) : (
                  medications.map((m) => {
                    const isChecked = complianceMap[m.id] || false;
                    return (
                      <div
                        key={m.id}
                        onClick={() => toggleMedicationCompliance(m.id)}
                        className={`p-4 rounded-xl border flex items-start justify-between gap-4 transition cursor-pointer ${
                          isChecked 
                            ? "bg-blue-50/20 border-blue-200 hover:bg-blue-50/40" 
                            : "bg-white border-gray-200 hover:border-blue-400"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Pill className="w-5 h-5 text-blue-600 mt-1" />
                          <div>
                            <h4 className={`text-base font-extrabold text-gray-900 ${isChecked ? "line-through text-gray-400" : ""}`}>
                              {m.name} <span className="font-normal text-gray-500 text-sm">{m.dosage}</span>
                            </h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 mt-2 text-xs text-gray-600">
                              <div><span className="font-semibold text-gray-500">Frequency:</span> {m.frequency}</div>
                              <div><span className="font-semibold text-gray-500">Route:</span> {m.route}</div>
                              {m.prescribedBy && <div><span className="font-semibold text-gray-500">Prescribed By:</span> {m.prescribedBy}</div>}
                              {m.reason && <div><span className="font-semibold text-gray-500">Reason:</span> {m.reason}</div>}
                            </div>
                          </div>
                        </div>

                        <div className={`mt-1 w-6 h-6 rounded-full flex items-center justify-center border transition ${
                          isChecked ? "bg-emerald-500 border-emerald-500 text-white" : "border-gray-300 text-gray-400"
                        }`}>
                          {isChecked && <CheckCircle2 className="w-4 h-4 text-white" />}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setMedsModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close List
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. TODAY'S MENU DETAIL VIEW MODAL ── */}
      {menuModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-amber-500 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <Utensils className="w-5 h-5" /> Today's Dining & Substitutions
              </h3>
              <button onClick={() => setMenuModalOpen(false)} className="p-1 hover:bg-amber-600 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Breakfast */}
                <div className="border border-gray-200 rounded-xl p-4 bg-amber-50/20">
                  <div className="text-[10px] font-black uppercase text-amber-600 tracking-wider">Breakfast (08:30 AM)</div>
                  <h4 className="font-black text-gray-900 mt-1 text-sm">Organic Oatmeal</h4>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    With fresh organic berries, low-fat Greek yogurt, and warm chamomile tea.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[8px] px-1 bg-amber-100 text-amber-800 rounded font-bold">Low Sodium</span>
                    <span className="text-[8px] px-1 bg-emerald-100 text-emerald-800 rounded font-bold">Diabetic Ok</span>
                  </div>
                </div>

                {/* Lunch */}
                <div className="border border-gray-200 rounded-xl p-4 bg-amber-50/20">
                  <div className="text-[10px] font-black uppercase text-amber-600 tracking-wider">Lunch (12:30 PM)</div>
                  <h4 className="font-black text-gray-900 mt-1 text-sm">Grilled Chicken Salad</h4>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Lean chicken breast over organic baby spinach, cherry tomatoes, and light balsamic.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[8px] px-1 bg-amber-100 text-amber-800 rounded font-bold">Low Sodium</span>
                    <span className="text-[8px] px-1 bg-blue-100 text-blue-800 rounded font-bold">High Protein</span>
                  </div>
                </div>

                {/* Dinner */}
                <div className="border border-gray-200 rounded-xl p-4 bg-amber-50/20">
                  <div className="text-[10px] font-black uppercase text-amber-600 tracking-wider">Dinner (06:00 PM)</div>
                  <h4 className="font-black text-gray-900 mt-1 text-sm">Baked Salmon Fillet</h4>
                  <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
                    Atlantic salmon with wild rice, steamed organic asparagus, and lemon wedge.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-[8px] px-1 bg-blue-100 text-blue-800 rounded font-bold">Gluten Free</span>
                    <span className="text-[8px] px-1 bg-red-100 text-red-800 rounded font-bold">Omega 3</span>
                  </div>
                </div>
              </div>

              {/* Substitution input */}
              <div className="border-t border-gray-100 pt-5 space-y-3">
                <h4 className="text-sm font-bold text-gray-900">Request Meal Substitution</h4>
                <p className="text-xs text-gray-500">Not feeling like having salmon or salad? Type your dietary preference below to alert the chef.</p>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={menuSubText}
                    onChange={(e) => setMenuSubText(e.target.value)}
                    placeholder="e.g. Request grilled chicken instead of salmon for dinner..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-400 outline-none text-gray-900 text-sm"
                  />
                  <button
                    onClick={handleMenuSubstitution}
                    disabled={submittingMenuSub}
                    className="px-5 py-2 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 transition text-sm flex items-center gap-1.5"
                  >
                    {submittingMenuSub && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />}
                    Submit
                  </button>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setMenuModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. DAILY GOALS VIEW MODEL MODAL ── */}
      {goalsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-teal-800 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-teal-300" /> Daily Health Goals Planner
              </h3>
              <button onClick={() => setGoalsModalOpen(false)} className="p-1 hover:bg-teal-900 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              <div>
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">Native Goals</h4>
                <div className="space-y-2">
                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["goal1"] || false}
                      onChange={() => toggleGoal("goal1")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["goal1"] ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                      Morning Walk (15 mins) - Maintain aerobic cardiovascular health
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["goal2"] || false}
                      onChange={() => toggleGoal("goal2")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["goal2"] ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                      Drink 2 Liters of Water - Essential hydration log
                    </span>
                  </label>

                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-teal-50/20 border border-gray-100 rounded-xl text-sm select-none">
                    <input
                      type="checkbox"
                      checked={goalsChecked["goal3"] || false}
                      onChange={() => toggleGoal("goal3")}
                      className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                    />
                    <span className={goalsChecked["goal3"] ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                      Cognitive Puzzles Session - Mind sharpness and mental drills
                    </span>
                  </label>
                </div>
              </div>

              {/* Custom Goals */}
              <div className="border-t border-gray-100 pt-5">
                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-2">My Custom Goals</h4>
                
                {customGoals.length === 0 ? (
                  <p className="text-xs text-gray-400 italic py-2">No custom goals added yet. Add one below!</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {customGoals.map((g) => (
                      <div key={g.id} className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-xl">
                        <label className="flex items-center gap-3 cursor-pointer text-sm select-none flex-1">
                          <input
                            type="checkbox"
                            checked={g.checked}
                            onChange={() => toggleCustomGoal(g.id)}
                            className="w-4 h-4 rounded border-teal-600 text-teal-600 focus:ring-teal-500"
                          />
                          <span className={g.checked ? "line-through text-gray-400 font-semibold" : "text-gray-800 font-bold"}>
                            {g.name}
                          </span>
                        </label>
                        <button
                          onClick={() => deleteCustomGoal(g.id)}
                          className="p-1 hover:bg-red-50 rounded text-red-500 transition"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <form onSubmit={addCustomGoal} className="flex gap-2 mt-2">
                  <input
                    type="text"
                    value={newGoalText}
                    onChange={(e) => setNewGoalText(e.target.value)}
                    placeholder="e.g. Read book for 20 mins, Stretch exercises..."
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-xl focus:ring-2 focus:ring-teal-600 outline-none text-gray-900 text-sm"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2 bg-teal-800 hover:bg-teal-900 text-white font-bold rounded-xl transition text-sm flex items-center gap-1"
                  >
                    <Plus className="w-4 h-4" /> Add
                  </button>
                </form>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setGoalsModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close Planner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. VITALS LOG DETAIL VIEW MODAL ── */}
      {vitalsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-blue-600 text-white flex items-center justify-between flex-shrink-0">
              <h3 className="font-bold text-lg flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-white" /> Vitals History Logs
              </h3>
              <button onClick={() => setVitalsModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-sm text-gray-500">Your recent health measurements. Clinical staff records these logs during checkups.</p>
              
              <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider">
                      <th className="px-4 py-3">Measurement</th>
                      <th className="px-4 py-3">Reading Value</th>
                      <th className="px-4 py-3">Logged Date</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-800">
                    {vitals.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-gray-400 italic">No vital logs recorded yet.</td>
                      </tr>
                    ) : (
                      vitals.map((v) => {
                        const isHR = v.type === "HEART_RATE";
                        const isBP = v.type === "BLOOD_PRESSURE";
                        const isOxy = v.type === "OXYGEN";
                        
                        let displayType = v.type.replace(/_/g, " ");
                        let alert = false;
                        if (isHR) {
                          const val = parseInt(v.value);
                          if (val > 100 || val < 55) alert = true;
                        }

                        return (
                          <tr key={v.id} className="hover:bg-gray-50 transition">
                            <td className="px-4 py-3 font-semibold flex items-center gap-2">
                              {isHR ? <Heart className="w-4 h-4 text-red-500" /> :
                               isOxy ? <Volume2 className="w-4 h-4 text-blue-500" /> :
                               <Activity className="w-4 h-4 text-gray-500" />}
                              {displayType}
                            </td>
                            <td className="px-4 py-3 font-black text-gray-900">{v.value} {v.unit || ""}</td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {new Date(v.recordedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                alert ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                              }`}>
                                {alert ? "Attention Needed" : "Normal"}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end flex-shrink-0">
              <button
                onClick={() => setVitalsModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CALL FAMILY MODAL ── */}
      {familyModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-blue-600 text-white flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Phone className="w-5 h-5" /> Family Contact Details
              </h3>
              <button onClick={() => setFamilyModalOpen(false)} className="p-1 hover:bg-blue-700 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              {resident?.sponsor ? (
                <div className="space-y-4">
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-xl">
                      {resident.sponsor.name.charAt(0)}
                    </div>
                    <div>
                      <h4 className="font-black text-blue-900">{resident.sponsor.name}</h4>
                      <p className="text-xs text-gray-500">Family Sponsor</p>
                    </div>
                  </div>

                  <div className="space-y-2.5 pt-2">
                    {resident.sponsor.phone && (
                      <a
                        href={`tel:${resident.sponsor.phone}`}
                        className="w-full py-2.5 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-bold flex items-center justify-between hover:bg-gray-50 transition active:scale-95"
                      >
                        <span className="text-sm">Phone: {resident.sponsor.phone}</span>
                        <Phone className="w-4 h-4 text-blue-600" />
                      </a>
                    )}
                    <a
                      href={`mailto:${resident.sponsor.email}`}
                      className="w-full py-2.5 px-4 bg-white border border-gray-200 text-gray-800 rounded-xl font-bold flex items-center justify-between hover:bg-gray-50 transition active:scale-95"
                    >
                      <span className="text-sm">Email: {resident.sponsor.email}</span>
                      <MessageSquare className="w-4 h-4 text-blue-600" />
                    </a>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-gray-500">
                  <AlertTriangle className="w-10 h-10 mx-auto text-amber-400 mb-2" />
                  <p className="font-semibold text-sm">No family sponsor linked</p>
                  <p className="text-xs mt-1">Please ask front office staff to coordinate.</p>
                </div>
              )}
            </div>
            
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setFamilyModalOpen(false)}
                className="px-5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold rounded-lg transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ROOM SERVICE REQUEST MODAL ── */}
      {roomServiceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 bg-amber-500 text-white flex items-center justify-between">
              <h3 className="font-bold flex items-center gap-2">
                <Coffee className="w-5 h-5 text-white" /> Request Room Service
              </h3>
              <button onClick={() => setRoomServiceModalOpen(false)} className="p-1 hover:bg-amber-600 rounded transition">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">
                  What do you need help with?
                </label>
                <textarea
                  value={serviceRequestText}
                  onChange={(e) => setServiceRequestText(e.target.value)}
                  rows={4}
                  placeholder="e.g. Please bring fresh water to room 302, assist with bed cleaning, or request standard tea..."
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-400 outline-none text-gray-900 text-sm resize-none"
                />
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
              <button
                onClick={() => setRoomServiceModalOpen(false)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleRoomServiceRequest}
                disabled={requestingService}
                className="px-5 py-2 bg-gradient-to-r from-amber-400 to-amber-500 text-black font-semibold rounded-lg hover:shadow-lg transition active:scale-95 text-sm flex items-center gap-2"
              >
                {requestingService && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black" />}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. FLOATING VOICE AND TEXT CHAT COMPANION MODAL ── */}
      {/* Floating Action Button */}
      <div className="fixed bottom-6 right-6 z-40">
        <button
          onClick={() => setAssistantOpen(true)}
          className="w-16 h-16 rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition duration-300 animate-bounce group relative border border-blue-400"
          title="Talk with AI Companion"
        >
          <Bot className="w-8 h-8 text-white group-hover:rotate-12 transition duration-300" />
          <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
          </span>
        </button>
      </div>

      {/* Slide-out Assistant Modal Panel */}
      {assistantOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white w-full sm:w-[480px] h-[80vh] sm:h-[600px] rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden animate-slide-in">
            
            {/* Header */}
            <div className="px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center relative">
                  <Bot className="w-5 h-5 text-white" />
                  {assistantSpeaking && (
                    <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping"></span>
                  )}
                </div>
                <div>
                  <h3 className="font-black text-sm">{assistantCfg.name || "AI Companion"}</h3>
                  <div className="flex items-center gap-1">
                    <span className={`w-2 h-2 rounded-full ${
                      assistantListening ? "bg-red-500 animate-pulse" :
                      assistantSpeaking ? "bg-emerald-400 animate-pulse" : "bg-blue-300"
                    }`} />
                    <span className="text-[10px] text-blue-100 font-semibold uppercase tracking-wider">
                      {assistantListening ? "Listening..." :
                       assistantSpeaking ? "Speaking..." : "Online"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAssistantAutoSpeak(!assistantAutoSpeak)}
                  className={`p-1.5 rounded transition ${assistantAutoSpeak ? "bg-white/20 text-white" : "text-blue-200 hover:bg-white/10"}`}
                  title={assistantAutoSpeak ? "Mute Voice output" : "Enable Voice output"}
                >
                  {assistantAutoSpeak ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => { stopTTS(); stopSpeechToText(); setAssistantOpen(false); }}
                  className="p-1.5 hover:bg-white/10 rounded transition"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Chat Messages */}
            <div 
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 custom-scrollbar"
            >
              {assistantMessages.map((m) => {
                const isAI = m.role === "assistant";
                return (
                  <div key={m.id} className={`flex ${isAI ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                      isAI
                        ? "bg-white text-gray-900 border border-gray-100 rounded-tl-none"
                        : "bg-blue-600 text-white rounded-tr-none font-medium"
                    }`}>
                      <p className="leading-relaxed">{m.text}</p>
                      {m.link && (
                        <Link
                          href={m.link.href}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 active:scale-95 transition"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          {m.link.label}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {/* Voice recognition interim display */}
              {interimSpeech && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-blue-500/20 text-blue-900 rounded-tr-none italic border border-blue-200">
                    <p>{interimSpeech}</p>
                  </div>
                </div>
              )}

              {/* Thinking loader */}
              {assistantThinking && (
                <div className="flex justify-start">
                  <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-none px-4 py-3 flex items-center gap-1.5 shadow-sm text-gray-500 text-xs">
                    <span className="animate-bounce">●</span>
                    <span className="animate-bounce [animation-delay:0.2s]">●</span>
                    <span className="animate-bounce [animation-delay:0.4s]">●</span>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive prompts (Quick chips) */}
            <div className="p-3 bg-gray-50 border-t border-gray-100 flex gap-2 overflow-x-auto flex-shrink-0 select-none custom-scrollbar">
              <button 
                onClick={() => handleSendAssistantMessage("What is my schedule for today?")}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-blue-900 font-bold rounded-full text-xs flex-shrink-0 transition active:scale-95"
              >
                🗓️ Today's Schedule
              </button>
              <button 
                onClick={() => handleSendAssistantMessage("What is on the dining menu?")}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-blue-900 font-bold rounded-full text-xs flex-shrink-0 transition active:scale-95"
              >
                🥗 Today's Menu
              </button>
              <button 
                onClick={() => handleSendAssistantMessage("How are my heart rate vitals looking?")}
                className="px-3 py-1 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-300 text-blue-900 font-bold rounded-full text-xs flex-shrink-0 transition active:scale-95"
              >
                ❤️ Vitals Status
              </button>
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-gray-100 bg-white flex items-center gap-3 flex-shrink-0">
              {/* Voice Mic Trigger */}
              <button
                onClick={toggleMic}
                className={`w-12 h-12 rounded-xl flex items-center justify-center shadow transition active:scale-90 flex-shrink-0 ${
                  assistantListening
                    ? "bg-red-500 hover:bg-red-600 text-white animate-pulse"
                    : "bg-blue-50 hover:bg-blue-100 text-blue-600"
                }`}
                title={assistantListening ? "Stop listening" : "Start speaking"}
              >
                {assistantListening ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5" />}
              </button>

              <input
                type="text"
                value={assistantInput}
                onChange={(e) => setAssistantInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendAssistantMessage(assistantInput)}
                placeholder={assistantListening ? "Listening..." : "Type or speak to assistant..."}
                disabled={assistantListening}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-600 outline-none text-gray-900 text-sm"
              />

              <button
                onClick={() => handleSendAssistantMessage(assistantInput)}
                disabled={!assistantInput.trim() || assistantThinking}
                className="w-10 h-10 rounded-xl bg-blue-600 text-white shadow flex items-center justify-center hover:bg-blue-700 active:scale-90 transition disabled:opacity-50 disabled:scale-100 flex-shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
